import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { isOrderFinalized } from '@/lib/order-status';
import { ClientStep } from '@/components/order/client-step';
import { PrescriptionStep } from '@/components/order/prescription-step';
import { SuggestedLensesStep } from '@/components/order/os-step';
import { FrameStep } from '@/components/order/frame-step';
import { isCurrentTryon, tryonRevision } from '@/lib/tryon/revision';
import { CartStep } from '@/components/order/cart-step';
import { ComandaStep } from '@/components/order/comanda-step';
import { PaymentStep } from '@/components/order/payment-step';
import { ProductionStep } from '@/components/order/production-step';
import { LogisticsStep } from '@/components/order/logistics-step';
import { AssemblyStep } from '@/components/order/assembly-step';
import { DeliveryStep } from '@/components/order/delivery-step';

export const metadata: Metadata = { title: 'Atendimento' };

type QuoteItemMeta = { lensType?: string; lensIndex?: string; lensMaterial?: string; lensTreatment?: string; laboratory?: string; notes?: string };
type QuoteRow = { id: string; total: number; quote_items: { description: string; metadata: QuoteItemMeta }[] | null };
type OrderFrameRow = {
  frame_name: string | null;
  sku: string | null;
  color: string | null;
  catalog_product_id: string | null;
  catalog_color_image_id: string | null;
  catalog_products: {
    standard_height_mm: number | null;
    bridge_mm: number | null;
    lens_diagonal_mm: number | null;
  } | null;
};
// Escolha da armação (Etapa 3) — 15/09/2026, redesenho pro catálogo novo
// (ver migração 202609151600 e components/order/frame-step.tsx): cada
// "Modelo" agora é um catalog_products publicado, com uma cor por
// catalog_product_color_images (o círculo de cor clicável do wireframe) e,
// dentro de cada cor, a "Foto de Prova" (processed_image_path, usada na
// prova online) e a "foto do óculos" (melhor foto de exibição validada).
type DisplayImageRow = { image_path: string | null; position: number; validated_at: string | null };
type ColorImageRow = {
  id: string; color_name: string; color_principal: string | null; color_secondary: string | null;
  color_variant_number: number | null; processed_image_path: string | null; status: string; is_active: boolean; display_order: number | null;
  catalog_product_color_display_images: DisplayImageRow[] | null;
};
type CatalogProductRow = { id: string; model_name: string; sku_optotica: string; catalog_product_color_images: ColorImageRow[] | null };
type PatientDisplayImageRow = { product_id: string; color_name: string; image_path: string | null };
type LaboratoryRow = { id: string; name: string; is_primary: boolean };
type MenuTierRow = {
  lens_type: 'single_vision' | 'multifocal';
  tier_number: number; is_addon: boolean; tier_name: string; benefit_phrase: string | null;
  target_audience: string | null; manufacturer: string | null; product_line: string | null;
  lens_index: string | null; ar_treatment: string | null; price: number;
};

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

export default async function OrderPage({ params }: { params: Promise<{ clientId: string; orderId: string }> }) {
  const { clientId, orderId } = await params;
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('status, organization_id').eq('user_id', user.id).maybeSingle();
  if (!profile || profile.status !== 'approved') redirect('/profissional');

  const { data: assignment } = await admin
    .from('professional_client_assignments')
    .select('client_id')
    .eq('professional_user_id', user.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (!assignment) redirect('/profissional/pacientes');

  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, status, client_id, selected_quote_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order || order.client_id !== clientId) redirect('/profissional/pacientes');

  const [{ data: client }, { data: prescription }, { data: quotesData }, { data: orderFrame }, { data: fulfillment }, { data: catalogProductsData }, { data: reactionsData }, { data: menuTiersData }, { data: laboratoriesData }, { data: existingDisplaysData }] = await Promise.all([
    admin.from('clients').select('full_name, whatsapp_e164, dnp_od, dnp_oe, dnp_measured_at, tryon_face_validated_at, dnp_photo_path, birth_date, cpf, tryon_face_status, tryon_face_processed_path, organization_id').eq('id', clientId).maybeSingle(),
    admin.from('prescriptions').select('prescription_data').eq('order_id', orderId).maybeSingle(),
    admin.from('quotes').select('id, total, quote_items(description, metadata)').eq('order_id', orderId),
    admin.from('order_frames').select('frame_name, sku, color, catalog_product_id, catalog_color_image_id, catalog_products(standard_height_mm, bridge_mm, lens_diagonal_mm)').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    // Escolha da armação (15/09/2026) — catálogo novo em vez de `frames`.
    admin
      .from('catalog_products')
      .select('id, model_name, sku_optotica, catalog_product_color_images(id, color_name, color_principal, color_secondary, color_variant_number, processed_image_path, status, is_active, display_order, catalog_product_color_display_images(image_path, position, validated_at))')
      .eq('status', 'publicado')
      .order('model_name'),
    admin.from('order_frame_reactions').select('catalog_color_image_id, status').eq('order_id', orderId),
    profile.organization_id
      ? admin.from('lens_menu_tiers')
          .select('lens_type, tier_number, is_addon, tier_name, benefit_phrase, target_audience, manufacturer, product_line, lens_index, ar_treatment, price')
          .eq('organization_id', profile.organization_id)
          .eq('active', true)
          .order('lens_type', { ascending: true })
          .order('tier_number', { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    // Laboratórios parceiros já aprovados desta ótica (professional_laboratories) —
    // usados na Etapa 6 (Produção) para vincular qual laboratório está
    // produzindo a lente deste atendimento (migração 202609110019).
    profile.organization_id
      ? admin.from('professional_laboratories')
          .select('id, name, is_primary')
          .eq('organization_id', profile.organization_id)
          .eq('status', 'approved')
          .order('is_primary', { ascending: false })
          .order('name')
      : Promise.resolve({ data: [] as unknown[] }),
    // Prova online já gerada pra este paciente, por produto+cor (15/09/2026)
    // — reaproveitada tanto se o próprio paciente já gerou pela área dele
    // quanto se o profissional já gerou antes aqui na Etapa 3 (mesma tabela,
    // ver lib/tryon/compose-server.ts).
    admin.from('catalog_patient_display_images').select('product_id, color_name, image_path').eq('client_id', clientId)
  ]);

  const clientName = client?.full_name || 'Paciente';
  const dnp = `OD ${client?.dnp_od ?? '—'} · OE ${client?.dnp_oe ?? '—'}`;

  // Bucket 'dnp-photos' é privado (seção 0.17) — a URL pública não funciona,
  // então cada carregamento da página gera uma URL assinada nova (1h de
  // validade, mais que suficiente para o tempo de uma sessão de atendimento).
  let dnpPhotoUrl: string | null = null;
  if (client?.dnp_photo_path) {
    const { data: signed } = await admin.storage.from('dnp-photos').createSignedUrl(client.dnp_photo_path, 3600);
    dnpPhotoUrl = signed?.signedUrl || null;
  }

  // "Foto de rosto para Prova Online" (15/09/2026) — mesma foto processada
  // (bucket 'tryon-face-source-photos') serve de preview aqui esteja ela
  // 'pendente' (ainda não validada) ou 'validada' (já é a oficial, só que a
  // cópia que virou "prova.<ext>" em 'try-on-photos' não guarda a extensão
  // aqui — mais simples reusar sempre este preview, que nunca é apagado).
  let facePhotoUrl: string | null = null;
  if (client?.tryon_face_processed_path) {
    const { data: signed } = await admin.storage.from('tryon-face-source-photos').createSignedUrl(client.tryon_face_processed_path, 3600);
    facePhotoUrl = signed?.signedUrl || null;
  }

  // Prova online na Etapa 3 (15/09/2026) — precisa da MESMA foto oficial de
  // prova que a área do próprio paciente usa (bucket 'try-on-photos',
  // "{org}/{client}/prova.<ext>" — só existe depois de validada na Etapa 1)
  // e da DNP total, pra rodar a mesma detecção de pupilas + composição que
  // /api/client/tryon/compose já faz (ver components/order/frame-step.tsx).
  const dnpTotalMm = client?.dnp_od != null && client?.dnp_oe != null ? Number(client.dnp_od) + Number(client.dnp_oe) : null;
  const sourceRevision = tryonRevision(client);
  let tryonClientPhotoUrl: string | null = null;
  if (client?.organization_id) {
    const tryonFolder = `${client.organization_id}/${clientId}`;
    const { data: tryonFiles } = await admin.storage.from('try-on-photos').list(tryonFolder);
    // Sem barra (ver comentário em lib/tryon/compose-server.ts) — evita
    // pegar o item-pasta "display" por engano depois que a primeira prova
    // gerada já tiver criado essa subpasta.
    const baseFile = tryonFiles?.find((f) => !f.name.startsWith('display'));
    if (baseFile) {
      const { data: signedBase } = await admin.storage.from('try-on-photos').createSignedUrl(`${tryonFolder}/${baseFile.name}`, 3600);
      tryonClientPhotoUrl = signedBase?.signedUrl ? `${signedBase.signedUrl}&revision=${sourceRevision}` : null;
    }
  }

  const rx = (prescription?.prescription_data || null) as { od?: Record<string, unknown>; oe?: Record<string, unknown> } | null;
  const toEye = (e?: Record<string, unknown>) => e ? {
    esferico: String(e.esferico ?? '0'), cilindrico: String(e.cilindrico ?? '0'),
    eixo: String(e.eixo ?? '0'), adicao: String(e.adicao ?? '0')
  } : null;

  const quotes = ((quotesData || []) as unknown as QuoteRow[]).map((q) => {
    const item = q.quote_items?.[0];
    return {
      id: q.id, total: Number(q.total) || 0,
      description: item?.description || 'Sem descrição',
      laboratory: item?.metadata?.laboratory || '',
      notes: item?.metadata?.notes || ''
    };
  });
  const selectedQuote = quotes.find((q) => q.id === order.selected_quote_id) || null;
  const menuTiers = ((menuTiersData || []) as unknown as MenuTierRow[]).map((t) => ({
    lensType: t.lens_type, tierNumber: t.tier_number, isAddon: t.is_addon, tierName: t.tier_name, benefitPhrase: t.benefit_phrase,
    targetAudience: t.target_audience, manufacturer: t.manufacturer, productLine: t.product_line,
    lensIndex: t.lens_index, arTreatment: t.ar_treatment, price: Number(t.price) || 0
  }));

  // Monta a lista de produtos/cores pra Etapa 3 (uma linha por modelo, um
  // círculo por cor) — junta a melhor "foto do óculos" (foto de exibição
  // validada do catálogo, menor `position`, bucket 'catalog-product-photos')
  // de cada cor. A "Foto de Prova" (rosto do paciente + óculos) vem de outro
  // lugar — ver provaUrlByProductColor acima (bucket 'try-on-photos') — e é
  // gerada na hora pelo frame-step.tsx quando ainda não existir.
  // ATIVAR/OCULTAR por cor (15/09/2026, migração 202609151700): só cores
  // com is_active=true entram aqui — nasce `false` em toda cor (nova ou já
  // existente), então nenhuma aparece até o master clicar ATIVAR no painel
  // de catálogo.
  const catalogProducts = (catalogProductsData || []) as unknown as CatalogProductRow[];
  const pathsToSign = new Set<string>();
  for (const product of catalogProducts) {
    for (const color of (product.catalog_product_color_images || []).filter((c) => c.is_active)) {
      const bestDisplay = (color.catalog_product_color_display_images || [])
        .filter((d) => d.validated_at && d.image_path)
        .sort((a, b) => a.position - b.position)[0];
      if (bestDisplay?.image_path) pathsToSign.add(bestDisplay.image_path);
    }
  }
  const signedByPath = new Map<string, string>();
  if (pathsToSign.size) {
    const { data: signedList } = await admin.storage.from('catalog-product-photos').createSignedUrls(Array.from(pathsToSign), 3600);
    for (const entry of signedList || []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  // "Foto de Prova" real (rosto do paciente + óculos desta cor) — vem de
  // catalog_patient_display_images, bucket 'try-on-photos' (diferente do
  // bucket 'catalog-product-photos' acima), assinada à parte. Já vem pronta
  // aqui se alguém (paciente ou profissional) já gerou essa combinação
  // produto+cor antes — senão nasce null e o card gera na hora (ver
  // components/order/frame-step.tsx).
  const patientDisplays = ((existingDisplaysData || []) as unknown as PatientDisplayImageRow[])
    .filter((display) => isCurrentTryon(display.image_path, sourceRevision));
  const provaUrlByProductColor = new Map<string, string>();
  const displayPaths = patientDisplays.map((d) => d.image_path).filter((p): p is string => !!p);
  if (displayPaths.length) {
    const { data: signedDisplayList } = await admin.storage.from('try-on-photos').createSignedUrls(displayPaths, 3600);
    const signedDisplayByPath = new Map<string, string>();
    for (const entry of signedDisplayList || []) {
      if (entry.path && entry.signedUrl) signedDisplayByPath.set(entry.path, entry.signedUrl);
    }
    for (const d of patientDisplays) {
      const url = d.image_path ? signedDisplayByPath.get(d.image_path) : null;
      if (url) provaUrlByProductColor.set(`${d.product_id}::${d.color_name}`, url);
    }
  }
  const reactionByColorImageId = new Map((reactionsData || []).map((r) => [r.catalog_color_image_id as string, r.status as string]));
  const confirmedColorImageId = (orderFrame as { catalog_color_image_id?: string | null } | null)?.catalog_color_image_id || null;

  // Ordem de exibição (15/09/2026, migração 202609151800): cores sem
  // `display_order` (nunca reordenadas no card "Ordem de exibição das
  // cores") ficam no fim, por `color_variant_number` — mesmo critério do
  // backfill da migração, pra bater com o que o master vê no painel de
  // catálogo.
  const sortColorsByDisplayOrder = (a: ColorImageRow, b: ColorImageRow) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.color_variant_number ?? 0) - (b.color_variant_number ?? 0);
  };
  const armacaoModels = catalogProducts
    .map((product) => ({ ...product, catalog_product_color_images: (product.catalog_product_color_images || []).filter((c) => c.is_active).sort(sortColorsByDisplayOrder) }))
    .filter((product) => product.catalog_product_color_images.length > 0)
    .map((product) => ({
      id: product.id,
      modelName: product.model_name,
      skuOptotica: product.sku_optotica,
      colors: product.catalog_product_color_images.map((color) => {
        const bestDisplay = (color.catalog_product_color_display_images || [])
          .filter((d) => d.validated_at && d.image_path)
          .sort((a, b) => a.position - b.position)[0];
        return {
          id: color.id,
          colorName: color.color_name,
          colorPrincipal: color.color_principal,
          colorSecondary: color.color_secondary,
          colorVariantNumber: color.color_variant_number,
          provaUrl: provaUrlByProductColor.get(`${product.id}::${color.color_name}`) || null,
          fotoOculosUrl: bestDisplay?.image_path ? signedByPath.get(bestDisplay.image_path) || null : null,
          reaction: (reactionByColorImageId.get(color.id) || null) as 'gostei' | 'talvez' | 'oculto' | null,
          confirmed: confirmedColorImageId === color.id
        };
      })
    }));

  // Carrinho (16/09/2026) — lista plana das cores marcadas GOSTEI em
  // qualquer modelo, derivada dos mesmos dados de `armacaoModels` já
  // montados acima (nenhuma consulta nova) — é essa lista que a nova tela
  // "Carrinho" mostra pra revisão/confirmação final (ver components/order/cart-step.tsx).
  const likedColors = armacaoModels.flatMap((product) =>
    product.colors
      .filter((color) => color.reaction === 'gostei')
      .map((color) => ({
        colorId: color.id,
        modelName: product.modelName,
        skuOptotica: product.skuOptotica,
        colorName: color.colorName,
        colorVariantNumber: color.colorVariantNumber,
        fotoOculosUrl: color.fotoOculosUrl,
        provaUrl: color.provaUrl,
        confirmed: color.confirmed
      }))
  );

  const ful = fulfillment as Record<string, unknown> | null;
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const selectedFrame = orderFrame as unknown as OrderFrameRow | null;
  const productMeasurements = selectedFrame?.catalog_products || null;
  // A Comanda começa com as medidas cadastradas no produto confirmado. Um
  // rascunho já salvo sempre tem prioridade, para não apagar ajustes feitos
  // especificamente para este paciente.
  const savedOrProduct = (saved: unknown, productValue: unknown) =>
    saved === null || saved === undefined ? str(productValue) : str(saved);
  const comandaInitial = {
    heightOd: savedOrProduct(ful?.measure_height_od, productMeasurements?.standard_height_mm),
    heightOe: savedOrProduct(ful?.measure_height_oe, productMeasurements?.standard_height_mm),
    bridge: savedOrProduct(ful?.measure_bridge, productMeasurements?.bridge_mm),
    diagonal: savedOrProduct(ful?.measure_diagonal, productMeasurements?.lens_diagonal_mm),
    notes: savedOrProduct(ful?.final_lab_notes, selectedQuote?.notes)
  };
  // O total selecionado é a sugestão inicial do pagamento. Se o profissional
  // já salvou um valor de venda próprio, esse valor permanece intacto.
  const paymentInitialValue = savedOrProduct(ful?.payment_value, selectedQuote?.total);

  // Estado das etapas (para o menu e as etiquetas de cada card)
  // 16/09/2026 — "OS / Orçamento" separada em duas etapas próprias, a
  // pedido do usuário: Etapa 2 "Prescrição optométrica" (só a receita) e
  // Etapa 3 "Lentes sugeridas" (cardápio + orçamentos) — antes eram uma
  // etapa só. Nenhuma rota de API mudou, só a divisão visual/de progresso
  // (ver components/order/prescription-step.tsx e
  // components/order/os-step.tsx, renomeado por dentro pra
  // SuggestedLensesStep).
  const prescriptionDone = Boolean(prescription);
  const suggestedLensesDone = Boolean(order.selected_quote_id);
  const hasFrame = Boolean(orderFrame);
  // Atendimento finalizado (16/09/2026, correção da listagem de pedidos):
  // até agora só Paciente/OS/Armação/Carrinho/Comanda final travavam depois
  // de confirmados (via comanda_confirmed_at, ver comandaDone abaixo) —
  // Pagamento/Produção/Logística/Montagem/Entrega ficavam editáveis pra
  // sempre, mesmo com o pedido já entregue. `orders_status_check` (constraint
  // do banco) aceita mais valores do que só 'in_progress'/'delivered'
  // (awaiting_quote/awaiting_choice/approved/in_production/ready/cancelled) —
  // nenhum deles além de 'delivered' é gravado por este app hoje, mas
  // isOrderFinalized só trata 'delivered'/'cancelled' como realmente
  // finalizados, para não travar por engano um pedido num status
  // intermediário (ver lib/order-status.ts e o mesmo ajuste em
  // app/api/professional/orders/[orderId]/fulfillment/route.ts e
  // app/cliente/pedido/[orderId]/page.tsx).
  const orderFinalized = isOrderFinalized(order.status);
  const comandaDone = Boolean(ful?.comanda_confirmed_at);
  const paymentDone = Boolean(ful?.payment_confirmed_at);
  const productionDone = ful?.lens_production_status === 'pronta' && ful?.frame_production_status === 'confirmado_fornecedor';
  const logisticsDone = Boolean(ful?.frame_received_at) && Boolean(ful?.lens_ready_at);
  const assemblyDone = ful?.assembly_status === 'concluida';
  const deliveryDone = Boolean(ful?.delivered_at);

  // Carrinho (16/09/2026) — "concluído" segue o mesmo critério de finalidade
  // já usado por Prescrição + Lentes sugeridas + Armação (receita salva,
  // orçamento selecionado e cor confirmada): o carrinho não introduz nenhum
  // estado novo próprio, só reúne e permite curar o que essas etapas já
  // produzem.
  const cartDone = prescriptionDone && suggestedLensesDone && hasFrame;
  const stepsDone = [true, prescriptionDone, suggestedLensesDone, hasFrame, cartDone, comandaDone, paymentDone, productionDone, logisticsDone, assemblyDone, deliveryDone];
  const currentStepIndex = stepsDone.findIndex((done) => !done);
  const current = currentStepIndex === -1 ? stepsDone.length - 1 : currentStepIndex;

  const steps = [
    { id: 'cliente', label: 'Paciente', hint: 'dados + DNP' },
    { id: 'prescricao', label: 'Prescrição optométrica', hint: 'receita' },
    { id: 'lentes', label: 'Lentes sugeridas', hint: 'cardápio + orçamento' },
    { id: 'armacao', label: 'Armação', hint: 'catálogo' },
    { id: 'carrinho', label: 'Carrinho', hint: 'revisão final' },
    { id: 'comanda', label: 'Comanda final', hint: 'consolidação' },
    { id: 'pagamento', label: 'Pagamento', hint: 'online / balcão' },
    { id: 'producao', label: 'Produção', hint: 'lente + armação' },
    { id: 'logistica', label: 'Logística', hint: 'prazos + rastreio' },
    { id: 'montagem', label: 'Montagem', hint: 'conferência' },
    { id: 'entrega', label: 'Entrega', hint: 'paciente final' }
  ];

  const tag = (done: boolean, isCurrent: boolean) => done
    ? <span className="complete-tag">Completo</span>
    : <span className="pending-tag">{isCurrent ? 'Em andamento' : 'Pendente'}</span>;

  return (
    <div className="page-shell">
      <div className="order-head">
        <Link className="back-link" href="/profissional/pacientes">← Meus pacientes</Link>
        <p className="eyebrow">Área profissional</p>
        <h1>Atendimento {orderCode(clientName, order.order_number)}</h1>
      </div>

      <nav className="flow-wrap" aria-label="Fluxo do atendimento">
        <div className="flow">
          {steps.map((step, i) => (
            <a key={step.id} className={stepsDone[i] ? 'done' : i === current ? 'current' : ''} href={`#${step.id}`}>
              <span className="step-number">{stepsDone[i] ? '✓' : i + 1}</span>
              <span><strong>{step.label}</strong><small>{step.hint}</small></span>
            </a>
          ))}
        </div>
      </nav>

      {/* "Resumo vivo" removido (15/09/2026, pedido do usuário) — os cards
          das etapas passam a usar toda a largura da tela, sem a coluna
          lateral fixa (ver app/globals.css: antes era `.overview` com
          grid-template-columns:minmax(0,1fr) 320px). */}
      {orderFinalized && (
        <div className="notice" style={{ marginBottom: 16 }}>
          🔒 Atendimento finalizado (entregue) — este pedido está aberto somente para consulta. Nenhuma etapa
          pode mais ser editada.
        </div>
      )}
      <div className="stack">

          <section className="card step-section" id="cliente">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">1</span>
                <div><p className="eyebrow">Etapa concluída</p><h2>Paciente</h2></div>
              </div>
              <span className="complete-tag">Completo</span>
            </div>
            <div className="card-body">
              <ClientStep
                orderId={order.id}
                clientName={clientName}
                whatsapp={formatWhatsApp(client?.whatsapp_e164)}
                initialDnpOd={str(client?.dnp_od)}
                initialDnpOe={str(client?.dnp_oe)}
                initialDnpPhotoUrl={dnpPhotoUrl}
                initialBirthDate={str(client?.birth_date)}
                initialCpf={str(client?.cpf)}
                frameName={orderFrame?.frame_name || ''}
                locked={comandaDone || orderFinalized}
                initialFacePhotoStatus={(client?.tryon_face_status as 'pendente' | 'validada' | null) || null}
                initialFacePhotoUrl={facePhotoUrl}
              />
            </div>
          </section>

          <section className="card step-section" id="prescricao">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">2</span>
                <div><p className="eyebrow">Etapa</p><h2>Prescrição optométrica</h2></div>
              </div>
              {tag(prescriptionDone, current === 1)}
            </div>
            <div className="card-body">
              <PrescriptionStep
                orderId={order.id}
                initialOd={toEye(rx?.od)}
                initialOe={toEye(rx?.oe)}
                locked={comandaDone || orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="lentes">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">3</span>
                <div><p className="eyebrow">Etapa</p><h2>Lentes sugeridas</h2></div>
              </div>
              {tag(suggestedLensesDone, current === 2)}
            </div>
            <div className="card-body">
              <SuggestedLensesStep
                orderId={order.id}
                quotes={quotes}
                selectedQuoteId={order.selected_quote_id}
                locked={comandaDone || orderFinalized}
                menuTiers={menuTiers}
              />
            </div>
          </section>

          <section className="card step-section" id="armacao">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">4</span>
                <div><p className="eyebrow">Etapa</p><h2>Escolha da armação</h2></div>
              </div>
              {tag(hasFrame, current === 3)}
            </div>
            <div className="card-body">
              <FrameStep key={sourceRevision} sourceRevision={sourceRevision} orderId={order.id} models={armacaoModels} confirmedFrameName={orderFrame?.frame_name || null} confirmedColor={orderFrame?.color || null} locked={comandaDone || orderFinalized} clientPhotoUrl={tryonClientPhotoUrl} dnpTotalMm={dnpTotalMm} />
            </div>
          </section>

          <section className="card step-section" id="carrinho">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">5</span>
                <div><p className="eyebrow">Etapa</p><h2>Carrinho</h2></div>
              </div>
              {tag(cartDone, current === 4)}
            </div>
            <div className="card-body">
              <CartStep
                orderId={order.id}
                quotes={quotes}
                selectedQuoteId={order.selected_quote_id}
                likedColors={likedColors}
                locked={comandaDone || orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="comanda">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">6</span>
                <div><p className="eyebrow">Etapa</p><h2>Comanda final</h2></div>
              </div>
              {tag(comandaDone, current === 5)}
            </div>
            <div className="card-body">
              <ComandaStep
                key={`${order.selected_quote_id || 'sem-orcamento'}:${selectedFrame?.catalog_product_id || 'sem-armacao'}:${selectedFrame?.catalog_color_image_id || 'sem-cor'}`}
                orderId={order.id}
                clientName={clientName}
                dnp={dnp}
                lensDescription={selectedQuote?.description || ''}
                laboratory={selectedQuote?.laboratory || ''}
                lensNotes={selectedQuote?.notes || ''}
                frameName={selectedFrame?.frame_name || ''}
                frameColor={selectedFrame?.color || ''}
                frameSku={selectedFrame?.sku || ''}
                initial={comandaInitial}
                confirmed={comandaDone || orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="pagamento">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">7</span>
                <div><p className="eyebrow">Etapa</p><h2>Pagamento</h2></div>
              </div>
              {tag(paymentDone, current === 6)}
            </div>
            <div className="card-body">
              <PaymentStep
                key={`${order.selected_quote_id || 'sem-orcamento'}:${str(ful?.payment_value)}`}
                orderId={order.id}
                initialValue={paymentInitialValue}
                initialMethod={str(ful?.payment_method)}
                initialDownValue={str(ful?.payment_down_value)}
                initialPickupValue={str(ful?.payment_pickup_value)}
                confirmed={paymentDone}
                locked={orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="producao">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">8</span>
                <div><p className="eyebrow">Etapa</p><h2>Produção</h2></div>
              </div>
              {tag(productionDone, current === 7)}
            </div>
            <div className="card-body">
              <ProductionStep
                orderId={order.id}
                initialFrameStatus={str(ful?.frame_production_status) || 'aguardando_pedido'}
                initialFrameRef={str(ful?.frame_supplier_reference)}
                initialLensStatus={str(ful?.lens_production_status) || 'aguardando_envio'}
                initialLensRef={str(ful?.lens_lab_reference)}
                initialLaboratoryId={str(ful?.laboratory_id)}
                laboratoryOptions={((laboratoriesData || []) as unknown as LaboratoryRow[]).map((lab) => ({ id: lab.id, name: lab.name, isPrimary: Boolean(lab.is_primary) }))}
                locked={orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="logistica">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">9</span>
                <div><p className="eyebrow">Etapa</p><h2>Produção e logística</h2></div>
              </div>
              {tag(logisticsDone, current === 8)}
            </div>
            <div className="card-body">
              <LogisticsStep
                orderId={order.id}
                frameShippedAt={(ful?.frame_shipped_at as string) || null}
                frameReceivedAt={(ful?.frame_received_at as string) || null}
                lensConfirmedAt={(ful?.lens_confirmed_at as string) || null}
                lensReadyAt={(ful?.lens_ready_at as string) || null}
                locked={orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="montagem">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">10</span>
                <div><p className="eyebrow">Etapa</p><h2>Montagem</h2></div>
              </div>
              {tag(assemblyDone, current === 9)}
            </div>
            <div className="card-body">
              <AssemblyStep
                orderId={order.id}
                initialFrameReceived={Boolean(ful?.frame_received_check)}
                initialLensReceived={Boolean(ful?.lens_received_check)}
                initialStatus={str(ful?.assembly_status) || 'aguardando'}
                initialNotes={str(ful?.assembly_notes)}
                locked={orderFinalized}
              />
            </div>
          </section>

          <section className="card step-section" id="entrega">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">11</span>
                <div><p className="eyebrow">Etapa</p><h2>Entrega</h2></div>
              </div>
              {tag(deliveryDone, current === 10)}
            </div>
            <div className="card-body">
              <DeliveryStep
                orderId={order.id}
                initialDestination={str(ful?.delivery_destination)}
                initialDate={str(ful?.delivery_date)}
                initialReceivedBy={str(ful?.delivery_received_by)}
                initialNotes={str(ful?.delivery_notes)}
                confirmed={deliveryDone}
                locked={orderFinalized}
              />
            </div>
          </section>

        </div>
    </div>
  );
}
