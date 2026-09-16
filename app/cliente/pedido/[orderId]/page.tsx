import { activePhoto } from '@/lib/tryon/active-photo';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { isOrderFinalized, orderStatusLabel } from '@/lib/order-status';
import { OrderTabs } from '@/components/client-area/order-tabs';
import { QuotesStep } from '@/components/client-area/quotes-step';
import type { PatientFrameChoice } from '@/components/client-area/frame-step';
import { FrameStep, type ArmacaoModel } from '@/components/order/frame-step';
import { ClientCartStep } from '@/components/client-area/cart-step';
import { PhotoUpload } from '@/components/client-area/photo-upload';
import { PrescriptionCard } from '@/components/client-area/prescription-card';
import { isCurrentTryon, tryonRevision } from '@/lib/tryon/revision';
import { patientPayment, patientTracking } from '@/lib/client-order-view';

export const metadata: Metadata = { title: 'Meu pedido' };

const BUCKET = 'try-on-photos';
const CATALOG_PHOTOS_BUCKET = 'catalog-product-photos';

type CatalogColorRow = {
  id: string;
  color_name: string;
  color_principal: string | null;
  color_secondary: string | null;
  color_variant_number: number | null;
  catalog_product_color_display_images: { image_path: string | null; position: number; validated_at: string | null }[] | null;
  processed_image_path: string | null;
  display_order: number | null;
  catalog_products: { id: string; model_name: string; sku_optotica: string; position_image_path: string | null; lens_width_mm: number | null; frame_total_width_mm: number | null } | null;
};

type QuoteRow = { id: string; total: number; quote_items: { description: string }[] | null };
// Carrinho (16/09/2026) — mesma ideia da tela nova do profissional (ver
// components/order/cart-step.tsx): reúne, aqui na área do próprio paciente,
// os orçamentos (já existia) e as armações que o profissional marcou GOSTEI
// no atendimento (novo, só leitura — a confirmação final e a remoção de uma
// cor curtida continuam sendo feitas pelo profissional). A escolha do
// paciente usa o mesmo catálogo publicado da prova online.
type LikedReactionRow = {
  catalog_color_image_id: string;
  status: string;
  catalog_product_color_images: {
    id: string; color_name: string; color_variant_number: number | null; processed_image_path: string | null;
    catalog_product_color_display_images: { image_path: string | null; position: number; validated_at: string | null }[] | null;
    catalog_products: { id: string; model_name: string; sku_optotica: string } | null;
  } | null;
};
type PatientDisplayImageRow = { product_id: string; color_name: string; image_path: string | null };

function formatWhatsApp(e164?: string | null) {
  if (!e164) return '—';
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    return `+55 (${ddd}) 9${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
  }
  return `+${digits}`;
}

export default async function ClientOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) redirect('/cliente');

  const { data: client } = await admin
    .from('clients')
    .select('id, full_name, whatsapp_e164, dnp_od, dnp_oe, dnp_measured_at, tryon_face_validated_at, organization_id, status')
    .eq('id', account.client_id)
    .maybeSingle();
  if (!client || client.status !== 'active') redirect('/cliente');

  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, status, client_id, professional_id, selected_quote_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || order.client_id !== client.id) redirect('/cliente');

  const [
    { data: allOrders },
    { data: prescription },
    { data: quotesData },
    { data: orderFrame },
    { data: fulfillment },
    { data: catalogColorsData },
    { data: professional },
    { data: likedReactionsData },
    { data: patientDisplaysData }
  ] = await Promise.all([
    admin.from('orders').select('id, order_number, status').eq('client_id', client.id).order('order_number', { ascending: false }),
    admin.from('prescriptions').select('prescription_data').eq('order_id', orderId).maybeSingle(),
    admin.from('quotes').select('id, total, quote_items(description)').eq('order_id', orderId),
    admin.from('order_frames').select('frame_name, sku, color, catalog_color_image_id').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    admin
      .from('catalog_product_color_images')
      .select('id, color_name, color_principal, color_secondary, color_variant_number, processed_image_path, display_order, catalog_product_color_display_images(image_path, position, validated_at), catalog_products!inner(id, model_name, sku_optotica, position_image_path, lens_width_mm, frame_total_width_mm, status)')
      .eq('status', 'validada')
      // ATIVAR/OCULTAR por cor (15/09/2026, migração 202609151700) — só
      // cores que o master ativou explicitamente aparecem pro paciente.
      .eq('is_active', true)
      .not('processed_image_path', 'is', null)
      .eq('catalog_products.status', 'publicado'),
    order.professional_id
      ? admin.from('professional_profiles').select('display_name, council_registration').eq('user_id', order.professional_id).maybeSingle()
      : Promise.resolve({ data: null as { display_name: string; council_registration: string | null } | null }),
    // Carrinho (16/09/2026) — cores marcadas GOSTEI pelo profissional
    // (order_frame_reactions), pra exibir na nova seção "Carrinho" desta
    // página (só leitura, ver comentário do tipo LikedReactionRow acima).
    admin
      .from('order_frame_reactions')
      .select('catalog_color_image_id, status, catalog_product_color_images!inner(id, color_name, color_variant_number, processed_image_path, catalog_product_color_display_images(image_path, position, validated_at), catalog_products!inner(id, model_name, sku_optotica))')
      .eq('order_id', orderId),
    admin.from('catalog_patient_display_images').select('product_id, color_name, image_path').eq('client_id', client.id)
  ]);

  const clientName = client.full_name || 'Paciente';
  const whatsapp = formatWhatsApp(client.whatsapp_e164);

  const { data: issued } = await admin.from('issued_prescriptions').select('id,prescription_data').eq('order_id', orderId).eq('status', 'active').maybeSingle();
  const rx = (issued?.prescription_data || prescription?.prescription_data || null) as { od?: Record<string, unknown>; oe?: Record<string, unknown> } | null;
  const toEye = (e?: Record<string, unknown>) => e ? {
    esferico: String(e.esferico ?? ''), cilindrico: String(e.cilindrico ?? ''),
    eixo: String(e.eixo ?? ''), adicao: String(e.adicao ?? '')
  } : null;

  const quotes = ((quotesData || []) as unknown as QuoteRow[]).map((q) => ({
    id: q.id, total: Number(q.total) || 0, description: q.quote_items?.[0]?.description || 'Sem descrição'
  }));
  const selectedQuote = quotes.find((q) => q.id === order.selected_quote_id) || null;


  // Foto de prova: guardada só no bucket try-on-photos (RLS já libera o próprio
  // cliente), sem depender da tabela `documents` — evita presumir colunas que
  // esta sessão não pôde confirmar.
  const sourceRevision = tryonRevision(client);
  const active = await activePhoto(admin, client.organization_id, client.id);
  const signedPhoto = active ? await admin.storage.from(active.bucket).createSignedUrl(active.path,3600) : null;
  const photoUrl = signedPhoto?.data?.signedUrl ? `${signedPhoto.data.signedUrl}&revision=${sourceRevision}` : null;

  // Escolha e prova online compartilham as cores publicadas e validadas.
  const catalogColorRows = (catalogColorsData || []) as unknown as CatalogColorRow[];
  const frameChoices: PatientFrameChoice[] = await Promise.all(catalogColorRows
    .filter((row) => row.catalog_products)
    .sort((a, b) => (a.display_order ?? Number.MAX_SAFE_INTEGER) - (b.display_order ?? Number.MAX_SAFE_INTEGER))
    .map(async (row) => {
      const { data: signed } = row.processed_image_path
        ? await admin.storage.from(CATALOG_PHOTOS_BUCKET).createSignedUrl(row.processed_image_path, 3600)
        : { data: null };
      return { id: row.id, productId: row.catalog_products!.id, modelName: row.catalog_products!.model_name, colorName: row.color_name, imageUrl: signed?.signedUrl || null };
    }));
  // Carrinho (16/09/2026) — armações que o profissional marcou GOSTEI no
  // atendimento, com a mesma "foto de prova" (rosto do paciente + óculos,
  // catalog_patient_display_images, bucket 'try-on-photos') e "foto do
  // óculos" (melhor foto de exibição validada, bucket 'catalog-product-photos')
  // já usadas na tela equivalente do profissional (components/order/cart-step.tsx).
  const reactionRows = (likedReactionsData || []) as unknown as LikedReactionRow[];
  const likedReactionRows = reactionRows.filter((row) => row.status === 'gostei');
  const patientDisplayRows = ((patientDisplaysData || []) as unknown as PatientDisplayImageRow[])
    .filter((display) => isCurrentTryon(display.image_path, sourceRevision));
  const confirmedColorImageId = (orderFrame as { catalog_color_image_id?: string | null } | null)?.catalog_color_image_id || null;

  const oculosPathsToSign = new Set<string>();
  for (const color of catalogColorRows) {
    if (color.catalog_products?.position_image_path) oculosPathsToSign.add(color.catalog_products.position_image_path);
    for (const display of color.catalog_product_color_display_images || []) {
      if (display.validated_at && display.image_path) oculosPathsToSign.add(display.image_path);
    }
  }
  for (const row of likedReactionRows) {
    const bestDisplay = (row.catalog_product_color_images?.catalog_product_color_display_images || [])
      .filter((d) => d.validated_at && d.image_path)
      .sort((a, b) => a.position - b.position)[0];
    if (bestDisplay?.image_path) oculosPathsToSign.add(bestDisplay.image_path);
  }
  const signedOculosByPath = new Map<string, string>();
  if (oculosPathsToSign.size) {
    const { data: signedOculosList } = await admin.storage.from(CATALOG_PHOTOS_BUCKET).createSignedUrls(Array.from(oculosPathsToSign), 3600);
    for (const entry of signedOculosList || []) {
      if (entry.path && entry.signedUrl) signedOculosByPath.set(entry.path, entry.signedUrl);
    }
  }

  const provaPathsByProductColor = new Map<string, string>();
  for (const d of patientDisplayRows) {
    if (d.image_path) provaPathsByProductColor.set(`${d.product_id}::${d.color_name}`, d.image_path);
  }
  const provaPaths = Array.from(new Set(Array.from(provaPathsByProductColor.values())));
  const signedProvaByPath = new Map<string, string>();
  if (provaPaths.length) {
    const { data: signedProvaList } = await admin.storage.from(BUCKET).createSignedUrls(provaPaths, 3600);
    for (const entry of signedProvaList || []) {
      if (entry.path && entry.signedUrl) signedProvaByPath.set(entry.path, entry.signedUrl);
    }
  }

  const modelMap = new Map<string, ArmacaoModel>();
  for (const color of catalogColorRows) {
    const product = color.catalog_products;
    if (!product) continue;
    let model = modelMap.get(product.id);
    if (!model) {
      model = { id: product.id, modelName: product.model_name, skuOptotica: product.sku_optotica, measurementsUrl: product.position_image_path ? signedOculosByPath.get(product.position_image_path) || null : null, colors: [] };
      modelMap.set(product.id, model);
    }
    const display = (color.catalog_product_color_display_images || []).filter((d) => d.validated_at && d.image_path).sort((a, b) => a.position - b.position)[0];
    const provaPath = provaPathsByProductColor.get(`${product.id}::${color.color_name}`);
    const reaction = reactionRows.find((row) => row.catalog_color_image_id === color.id)?.status;
    model.colors.push({
      id: color.id, colorName: color.color_name, colorPrincipal: color.color_principal,
      colorSecondary: color.color_secondary, colorVariantNumber: color.color_variant_number,
      provaUrl: provaPath ? signedProvaByPath.get(provaPath) || null : null,
      fotoOculosUrl: (display?.image_path ? signedOculosByPath.get(display.image_path) : null) || frameChoices.find((choice) => choice.id === color.id)?.imageUrl || null,
      galleryUrls: (color.catalog_product_color_display_images || []).filter((d) => d.validated_at && d.image_path).sort((a, b) => a.position - b.position).map((d) => signedOculosByPath.get(d.image_path!) || null).filter((url): url is string => Boolean(url)),
      reaction: reaction === 'gostei' || reaction === 'talvez' || reaction === 'oculto' ? reaction : null,
      confirmed: confirmedColorImageId === color.id
    });
  }
  const armacaoModels = Array.from(modelMap.values());

  const likedColors = likedReactionRows
    .map((row) => row.catalog_product_color_images)
    .filter((color): color is NonNullable<LikedReactionRow['catalog_product_color_images']> => Boolean(color && color.catalog_products))
    .map((color) => {
      const product = color.catalog_products!;
      const bestDisplay = (color.catalog_product_color_display_images || [])
        .filter((d) => d.validated_at && d.image_path)
        .sort((a, b) => a.position - b.position)[0];
      const provaPath = provaPathsByProductColor.get(`${product.id}::${color.color_name}`);
      return {
        colorId: color.id,
        modelName: product.model_name,
        skuOptotica: product.sku_optotica,
        colorName: color.color_name,
        colorVariantNumber: color.color_variant_number,
        fotoOculosUrl: bestDisplay?.image_path ? signedOculosByPath.get(bestDisplay.image_path) || null : null,
        provaUrl: provaPath ? signedProvaByPath.get(provaPath) || null : null,
        confirmed: confirmedColorImageId === color.id
      };
    });

  const ful = fulfillment as Record<string, unknown> | null;
  // 16/09/2026 — 'completed' nunca é um valor real de orders.status, então
  // este bloqueio nunca funcionava de verdade. A constraint real do banco
  // (orders_status_check) aceita mais valores do que só
  // 'in_progress'/'delivered' — travar em "!== 'in_progress'" trataria por
  // engano um status intermediário (awaiting_quote/approved/in_production/
  // etc.) como pedido finalizado. isOrderFinalized só considera
  // 'delivered'/'cancelled' (ver lib/order-status.ts).
  const locked = isOrderFinalized(order.status) || Boolean(ful?.comanda_confirmed_at);
  const cancelled = order.status === 'cancelled';
  const payment = patientPayment(ful, selectedQuote?.total ?? null);
  const money = (value: number | null) => value === null ? 'A definir' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hasQuote = Boolean(order.selected_quote_id);
  const hasFrame = Boolean(orderFrame);
  const hasRx = Boolean(rx?.od && rx?.oe && [rx.od.esferico, rx.od.cilindrico, rx.oe.esferico, rx.oe.cilindrico]
    .some((value) => value !== null && value !== undefined && String(value).trim() !== ''));

  const stages = patientTracking(order.status, ful, hasRx, hasQuote && hasFrame);
  const trackingCurrent = stages.findIndex((s) => !s.done);
  const trackingDone = trackingCurrent === -1;

  const steps = [
    { id: 'dados', label: 'Meus dados', hint: 'cadastro + DNP' },
    { id: 'orcamentos', label: 'Escolher lente', hint: 'orçamentos' },
    { id: 'receita', label: 'Minha receita', hint: 'prescrição' },
    { id: 'armacao', label: 'Escolher armação', hint: 'catálogo' },
    { id: 'carrinho', label: 'Carrinho', hint: 'revisão' },
    { id: 'status', label: 'Acompanhar pedido', hint: 'produção + entrega' }
  ];
  // Carrinho (16/09/2026) — mesmo critério de "concluído" do carrinho do
  // profissional (ver page.tsx do atendimento): pronto quando já há lente e
  // armação escolhidas, sem introduzir nenhum estado novo próprio.
  const stepsDone = [true, hasQuote, hasRx, hasFrame, hasQuote && hasFrame, trackingDone];
  const currentStep = cancelled ? -1 : stepsDone.findIndex((done) => !done);

  const orderTabs = (allOrders || []).map((o) => ({ id: o.id, code: orderCode(clientName, o.order_number), status: o.status }));

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div><p className="eyebrow">Área do paciente</p><h1>Olá, {clientName.split(' ')[0]}</h1></div>
        <div className="idbox"><span>ID do paciente · WhatsApp</span><strong>{whatsapp}</strong></div>
      </div>

      <OrderTabs orders={orderTabs} activeOrderId={order.id} />

      <nav className="flow-wrap" aria-label="Fluxo do paciente">
        <div className="flow flow-client">
          {steps.map((step, i) => (
            <a key={step.id} className={stepsDone[i] ? 'done' : i === currentStep ? 'current' : ''} href={`#${step.id}`}>
              <span className="step-number">{stepsDone[i] ? '✓' : i + 1}</span>
              <span><strong>{step.label}</strong><small>{step.hint}</small></span>
            </a>
          ))}
        </div>
      </nav>

      <section className="card">
        <div className="card-head">
          <div><p className="eyebrow">Visão geral</p><h2>Pedido {orderCode(clientName, order.order_number)}</h2></div>
          <span className={locked ? 'complete-tag' : 'pending-tag'}>{orderStatusLabel(order.status)}</span>
        </div>
        <div className="card-body">
          <div className="summary-grid">
            <div className="stat"><span>Lente</span><strong>{selectedQuote?.description || 'Escolha pendente'}</strong></div>
            <div className="stat"><span>Armação</span><strong>{orderFrame?.frame_name || 'Ainda não escolhida'}</strong></div>
            <div className="stat"><span>Valor final</span><strong>{money(payment.total)}</strong></div>
            <div className="stat"><span>Status</span><strong>{orderStatusLabel(order.status)}</strong></div>
          </div>
          <div className="patient-payment-summary">
            <h3>Pagamento</h3>
            <p className="helper">{payment.confirmed ? 'Condições de pagamento confirmadas pelo profissional.' : 'Condições de pagamento aguardando confirmação do profissional.'}</p>
            <div className="summary-grid">
              <div className="stat"><span>Entrada combinada</span><strong>{money(payment.down)}</strong></div>
              <div className="stat"><span>Valor na retirada</span><strong>{money(payment.pickup)}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="card" id="dados">
        <div className="card-head"><div><p className="eyebrow">Cadastro</p><h2>Meus dados</h2></div><span className="complete-tag">Dados do atendimento</span></div>
        <div className="card-body">
          <div className="summary-grid">
            <div className="stat"><span>Nome completo</span><strong>{clientName}</strong></div>
            <div className="stat"><span>WhatsApp</span><strong>{whatsapp}</strong></div>
            {user.email && !user.email.endsWith('@whatsapp.optotica.invalid') && <div className="stat"><span>E-mail</span><strong>{user.email}</strong></div>}
            <div className="stat"><span>DNP OD</span><strong>{client.dnp_od != null ? `${client.dnp_od} mm` : '—'}</strong></div>
            <div className="stat"><span>DNP OE</span><strong>{client.dnp_oe != null ? `${client.dnp_oe} mm` : '—'}</strong></div>
          </div>
          <PhotoUpload initialPhotoUrl={photoUrl} />
        </div>
      </section>

      <section className="card" id="orcamentos">
        <div className="card-head"><div><p className="eyebrow">Preparados pelo profissional</p><h2>Orçamentos de lentes</h2></div><span className={hasQuote ? 'complete-tag' : 'pending-tag'}>{locked ? 'Somente consulta' : hasQuote ? 'Opção selecionada' : 'Selecione uma opção'}</span></div>
        <div className="card-body">
          <QuotesStep orderId={order.id} quotes={quotes} selectedQuoteId={order.selected_quote_id} locked={locked} />
        </div>
      </section>

      <section className="card" id="receita">
        <div className="card-head"><div><p className="eyebrow">Prescrição enviada pelo profissional</p><h2>Minha receita de óculos</h2></div><span className="complete-tag">Somente consulta</span></div>
        <div className="card-body">
          <PrescriptionCard
            issuedId={issued?.id || null}
            clientName={clientName}
            od={toEye(rx?.od)}
            oe={toEye(rx?.oe)}
            professionalName={professional?.display_name || 'Optometrista responsável'}
            professionalRegistration={professional?.council_registration || 'Cadastro profissional'}
          />
        </div>
      </section>

      <section className="card" id="armacao">
        <div className="card-head"><div><p className="eyebrow">Catálogo</p><h2>Escolha sua armação</h2></div><span className={hasFrame ? 'complete-tag' : 'pending-tag'}>{locked ? 'Somente consulta' : hasFrame ? 'Armação selecionada' : 'Selecione um modelo'}</span></div>
        <div className="card-body">
          <FrameStep
            key={sourceRevision}
            audience="client"
            sourceRevision={sourceRevision}
            orderId={order.id}
            models={armacaoModels}
            confirmedFrameName={orderFrame?.frame_name || null}
            confirmedColor={orderFrame?.color || null}
            clientPhotoUrl={photoUrl}
            dnpTotalMm={client.dnp_od != null && client.dnp_oe != null ? Number(client.dnp_od) + Number(client.dnp_oe) : null}
            locked={locked}
          />
        </div>
      </section>

      <section className="card" id="carrinho">
        <div className="card-head"><div><p className="eyebrow">Revisão</p><h2>Carrinho</h2></div><span className="complete-tag">{locked ? 'Somente consulta' : 'Revise suas escolhas'}</span></div>
        <div className="card-body">
          <ClientCartStep
            orderId={order.id}
            quotes={quotes}
            selectedQuoteId={order.selected_quote_id}
            likedColors={likedColors}
            locked={locked}
          />
        </div>
      </section>

      <section className="card" id="status">
        <div className="card-head">
          <div><p className="eyebrow">Seu pedido</p><h2>Acompanhamento</h2></div>
          <span className={trackingDone ? 'complete-tag' : 'pending-tag'}>{cancelled ? 'Cancelado' : trackingDone ? 'Entregue' : 'Em andamento'}</span>
        </div>
        <div className="card-body">
          {cancelled ? <p className="notice">Este pedido foi cancelado. Fale com seu profissional se precisar de ajuda.</p> : <div className="timeline">
            {stages.map((stage, i) => (
              <div className={`timeline-item${stage.done ? ' done' : i === trackingCurrent ? ' current' : ''}`} key={stage.label}>
                <div className="timeline-icon">{stage.done ? '✓' : i + 1}</div>
                <div><strong>{stage.label}</strong><small>{stage.hint}</small></div>
                <div className="timeline-date">{stage.done ? 'Concluído' : i === trackingCurrent ? 'Agora' : '—'}</div>
              </div>
            ))}
          </div>}
        </div>
      </section>
    </div>
  );
}
