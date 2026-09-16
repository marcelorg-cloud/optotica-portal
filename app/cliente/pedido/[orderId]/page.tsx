import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { isOrderFinalized, orderStatusLabel } from '@/lib/order-status';
import { OrderTabs } from '@/components/client-area/order-tabs';
import { QuotesStep } from '@/components/client-area/quotes-step';
import { ClientFrameStep } from '@/components/client-area/frame-step';
import { ClientCartStep } from '@/components/client-area/cart-step';
import { PhotoUpload } from '@/components/client-area/photo-upload';
import { PrescriptionCard } from '@/components/client-area/prescription-card';
import { TryonPanel, type TryonProduct } from '@/components/client-area/tryon-panel';
import { isCurrentTryon, tryonRevision } from '@/lib/tryon/revision';

export const metadata: Metadata = { title: 'Meu pedido' };

const BUCKET = 'try-on-photos';
const CATALOG_PHOTOS_BUCKET = 'catalog-product-photos';

type CatalogColorRow = {
  id: string;
  color_name: string;
  processed_image_path: string | null;
  display_order: number | null;
  catalog_products: { id: string; model_name: string; lens_width_mm: number | null; frame_total_width_mm: number | null } | null;
};

type QuoteRow = { id: string; total: number; quote_items: { description: string }[] | null };
type FrameVariant = { color: string; image?: string; qty?: number };
type FrameRow = { id: string; name: string; metadata: { kind?: string; variants?: FrameVariant[] } | null };
// Carrinho (16/09/2026) — mesma ideia da tela nova do profissional (ver
// components/order/cart-step.tsx): reúne, aqui na área do próprio paciente,
// os orçamentos (já existia) e as armações que o profissional marcou GOSTEI
// no atendimento (novo, só leitura — a confirmação final e a remoção de uma
// cor curtida continuam sendo feitas pelo profissional; a escolha de
// armação do PRÓPRIO paciente, mais abaixo nesta página, continua no
// catálogo antigo `frames`, sem nenhuma mudança).
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
    { data: framesData },
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
    admin.from('frames').select('id, name, metadata').is('organization_id', null).eq('active', true).order('name'),
    admin
      .from('catalog_product_color_images')
      .select('id, color_name, processed_image_path, display_order, catalog_products!inner(id, model_name, lens_width_mm, frame_total_width_mm, status)')
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
      .eq('order_id', orderId)
      .eq('status', 'gostei'),
    admin.from('catalog_patient_display_images').select('product_id, color_name, image_path').eq('client_id', client.id)
  ]);

  const clientName = client.full_name || 'Paciente';
  const whatsapp = formatWhatsApp(client.whatsapp_e164);
  const dnp = `OD ${client.dnp_od ?? '—'} · OE ${client.dnp_oe ?? '—'}`;

  const rx = (prescription?.prescription_data || null) as { od?: Record<string, unknown>; oe?: Record<string, unknown> } | null;
  const toEye = (e?: Record<string, unknown>) => e ? {
    esferico: String(e.esferico ?? '0'), cilindrico: String(e.cilindrico ?? '0'),
    eixo: String(e.eixo ?? '0'), adicao: String(e.adicao ?? '0')
  } : null;

  const quotes = ((quotesData || []) as unknown as QuoteRow[]).map((q) => ({
    id: q.id, total: Number(q.total) || 0, description: q.quote_items?.[0]?.description || 'Sem descrição'
  }));
  const selectedQuote = quotes.find((q) => q.id === order.selected_quote_id) || null;

  // Apenas cor/imagem/estoque chegam ao cliente — sku do fornecedor, custo e
  // demais dados internos do metadata da armação nunca saem deste componente.
  const frames = ((framesData || []) as unknown as FrameRow[]).map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.metadata?.kind || '',
    variants: (f.metadata?.variants || []).map((v) => ({ color: v.color, image: v.image, qty: v.qty }))
  }));

  // Foto de prova: guardada só no bucket try-on-photos (RLS já libera o próprio
  // cliente), sem depender da tabela `documents` — evita presumir colunas que
  // esta sessão não pôde confirmar.
  const photoFolder = `${client.organization_id}/${client.id}`;
  const { data: photoFiles } = await admin.storage.from(BUCKET).list(photoFolder);
  let photoUrl: string | null = null;
  const sourceRevision = tryonRevision(client);
  const basePhoto = photoFiles?.find((file) => !file.name.startsWith('display'));
  if (basePhoto) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(`${photoFolder}/${basePhoto.name}`, 3600);
    photoUrl = signed?.signedUrl ? `${signed.signedUrl}&revision=${sourceRevision}` : null;
  }

  // Prova online (seção 0.29): catálogo novo (AliExpress/dropshipping,
  // migração 202609110020), separado do catálogo de armações em estoque
  // (`frames`, usado em "Escolher armação" acima) — só entram aqui cores já
  // validadas manualmente pelo master, com a foto de fundo já removido.
  const catalogColorRows = (catalogColorsData || []) as unknown as CatalogColorRow[];
  // Largura pra escalar na prova online (13/09/2026, 8ª rodada, pedido do
  // usuário): prefere `frame_total_width_mm` ("Frente Total" — medida de
  // ponta a ponta da armação, mais precisa — campo novo e opcional, migração
  // 202609130010) quando o master já preencheu; cai pra `lens_width_mm`
  // quando ainda não foi preenchido, pra não tirar da prova online nenhum
  // produto já publicado antes dessa medida existir.
  const effectiveFrameWidthMm = (product: { lens_width_mm: number | null; frame_total_width_mm: number | null }) =>
    product.frame_total_width_mm || product.lens_width_mm || null;
  // Ordem de exibição (15/09/2026, migração 202609151800) — mesmo critério
  // usado no painel de catálogo e na Etapa 3 "Escolha da armação": sem
  // `display_order` (nunca reordenada) fica no fim.
  const tryonProducts: TryonProduct[] = (
    await Promise.all(
      catalogColorRows
        .filter((row) => row.processed_image_path && row.catalog_products && effectiveFrameWidthMm(row.catalog_products))
        .sort((a, b) => (a.display_order ?? Number.MAX_SAFE_INTEGER) - (b.display_order ?? Number.MAX_SAFE_INTEGER))
        .map(async (row) => {
          const { data: signed } = await admin.storage.from(CATALOG_PHOTOS_BUCKET).createSignedUrl(row.processed_image_path!, 3600);
          if (!signed?.signedUrl) return null;
          return {
            id: row.id,
            productId: row.catalog_products!.id,
            modelName: row.catalog_products!.model_name,
            colorName: row.color_name,
            lensWidthMm: Number(effectiveFrameWidthMm(row.catalog_products!)),
            processedImageUrl: signed.signedUrl
          };
        })
    )
  ).filter((p): p is TryonProduct => p !== null);

  // Carrinho (16/09/2026) — armações que o profissional marcou GOSTEI no
  // atendimento, com a mesma "foto de prova" (rosto do paciente + óculos,
  // catalog_patient_display_images, bucket 'try-on-photos') e "foto do
  // óculos" (melhor foto de exibição validada, bucket 'catalog-product-photos')
  // já usadas na tela equivalente do profissional (components/order/cart-step.tsx).
  const likedReactionRows = (likedReactionsData || []) as unknown as LikedReactionRow[];
  const patientDisplayRows = ((patientDisplaysData || []) as unknown as PatientDisplayImageRow[])
    .filter((display) => isCurrentTryon(display.image_path, sourceRevision));
  const confirmedColorImageId = (orderFrame as { catalog_color_image_id?: string | null } | null)?.catalog_color_image_id || null;

  const oculosPathsToSign = new Set<string>();
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
  const locked = isOrderFinalized(order.status);
  const hasQuote = Boolean(order.selected_quote_id);
  const hasFrame = Boolean(orderFrame);
  const hasRx = Boolean(prescription);

  const stages = [
    { label: 'Atendimento iniciado', hint: 'Cadastro e prescrição vinculados ao pedido.', done: hasRx },
    { label: 'Escolhas do pedido', hint: 'Selecione a lente e a armação.', done: hasQuote && hasFrame },
    { label: 'Pedido confirmado', hint: 'Confirmação da solução e do pagamento.', done: Boolean(ful?.comanda_confirmed_at) && Boolean(ful?.payment_confirmed_at) },
    { label: 'Em produção', hint: 'Lentes e armação em preparação.', done: ful?.lens_production_status === 'pronta' && ful?.frame_production_status === 'confirmado_fornecedor' },
    { label: 'Montagem', hint: 'Óculos em montagem e conferência.', done: ful?.assembly_status === 'concluida' },
    { label: 'Pronto para entrega', hint: 'Acompanharemos a entrega até você.', done: Boolean(ful?.delivered_at) }
  ];
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
  const currentStep = stepsDone.findIndex((d) => !d);

  const orderTabs = (allOrders || []).map((o) => ({ id: o.id, code: orderCode(clientName, o.order_number), status: o.status }));

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div><p className="eyebrow">Área do cliente</p><h1>Olá, {clientName.split(' ')[0]}</h1></div>
        <div className="idbox"><span>ID do cliente · WhatsApp</span><strong>{whatsapp}</strong></div>
      </div>

      <OrderTabs orders={orderTabs} activeOrderId={order.id} />

      <nav className="flow-wrap" aria-label="Fluxo do cliente">
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
            <div className="stat"><span>Valor</span><strong>{selectedQuote ? `R$ ${selectedQuote.total.toFixed(2).replace('.', ',')}` : 'A definir'}</strong></div>
            <div className="stat"><span>Status</span><strong>{orderStatusLabel(order.status)}</strong></div>
          </div>
        </div>
      </section>

      <section className="card" id="dados">
        <div className="card-head"><div><p className="eyebrow">Cadastro</p><h2>Meus dados</h2></div><span className="complete-tag">Somente consulta</span></div>
        <div className="card-body">
          <div className="summary-grid">
            <div className="stat"><span>Nome completo</span><strong>{clientName}</strong></div>
            <div className="stat"><span>WhatsApp</span><strong>{whatsapp}</strong></div>
            <div className="stat"><span>E-mail</span><strong>{user.email || '—'}</strong></div>
            <div className="stat"><span>DNP OD</span><strong>{client.dnp_od != null ? `${client.dnp_od} mm` : '—'}</strong></div>
            <div className="stat"><span>DNP OE</span><strong>{client.dnp_oe != null ? `${client.dnp_oe} mm` : '—'}</strong></div>
          </div>
          <PhotoUpload initialPhotoUrl={photoUrl} />
        </div>
      </section>

      <section className="card" id="orcamentos">
        <div className="card-head"><div><p className="eyebrow">Preparados pelo profissional</p><h2>Orçamentos de lentes</h2></div><span className="pending-tag">Selecione uma opção</span></div>
        <div className="card-body">
          <QuotesStep orderId={order.id} quotes={quotes} selectedQuoteId={order.selected_quote_id} locked={locked} />
        </div>
      </section>

      <section className="card" id="receita">
        <div className="card-head"><div><p className="eyebrow">Prescrição enviada pelo profissional</p><h2>Minha receita de óculos</h2></div><span className="complete-tag">Somente consulta</span></div>
        <div className="card-body">
          <PrescriptionCard
            orderNumber={order.order_number}
            clientName={clientName}
            whatsapp={whatsapp}
            dnp={dnp}
            od={toEye(rx?.od)}
            oe={toEye(rx?.oe)}
            professionalName={professional?.display_name || 'Optometrista responsável'}
            professionalRegistration={professional?.council_registration || 'Cadastro profissional'}
          />
        </div>
      </section>

      <section className="card" id="armacao">
        <div className="card-head"><div><p className="eyebrow">Catálogo</p><h2>Escolha sua armação</h2></div><span className="pending-tag">Selecione um modelo</span></div>
        <div className="card-body">
          <ClientFrameStep
            orderId={order.id}
            frames={frames}
            selectedFrameName={orderFrame?.frame_name || null}
            selectedColor={orderFrame?.color || null}
            locked={locked}
          />
        </div>
      </section>

      <section className="card" id="carrinho">
        <div className="card-head"><div><p className="eyebrow">Revisão</p><h2>Carrinho</h2></div><span className="complete-tag">Somente consulta</span></div>
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

      <section className="card" id="prova-online">
        <div className="card-head">
          <div><p className="eyebrow">Catálogo online</p><h2>Prova online — experimente armações com a sua foto</h2></div>
          <span className="pending-tag">Opcional</span>
        </div>
        <div className="card-body">
          <TryonPanel key={sourceRevision} sourceRevision={sourceRevision} clientPhotoUrl={photoUrl} dnpOd={client.dnp_od} dnpOe={client.dnp_oe} products={tryonProducts} />
        </div>
      </section>

      <section className="card" id="status">
        <div className="card-head">
          <div><p className="eyebrow">Seu pedido</p><h2>Acompanhamento</h2></div>
          <span className={trackingDone ? 'complete-tag' : 'pending-tag'}>{trackingDone ? 'Concluído' : 'Em andamento'}</span>
        </div>
        <div className="card-body">
          <div className="timeline">
            {stages.map((stage, i) => (
              <div className={`timeline-item${stage.done ? ' done' : i === trackingCurrent ? ' current' : ''}`} key={stage.label}>
                <div className="timeline-icon">{stage.done ? '✓' : i + 1}</div>
                <div><strong>{stage.label}</strong><small>{stage.hint}</small></div>
                <div className="timeline-date">{stage.done ? 'Concluído' : i === trackingCurrent ? 'Agora' : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
