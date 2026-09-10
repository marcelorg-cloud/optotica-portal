import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { OrderTabs } from '@/components/client-area/order-tabs';
import { QuotesStep } from '@/components/client-area/quotes-step';
import { ClientFrameStep } from '@/components/client-area/frame-step';
import { PhotoUpload } from '@/components/client-area/photo-upload';
import { PrescriptionCard } from '@/components/client-area/prescription-card';

export const metadata: Metadata = { title: 'Meu pedido' };

const BUCKET = 'try-on-photos';
const STATUS_LABEL: Record<string, string> = { in_progress: 'Em andamento', completed: 'Concluído' };

type QuoteRow = { id: string; total: number; quote_items: { description: string }[] | null };
type FrameVariant = { color: string; image?: string; qty?: number };
type FrameRow = { id: string; name: string; metadata: { kind?: string; variants?: FrameVariant[] } | null };

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
    .select('id, full_name, whatsapp_e164, dnp_od, dnp_oe, organization_id, status')
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
    { data: professional }
  ] = await Promise.all([
    admin.from('orders').select('id, order_number, status').eq('client_id', client.id).order('order_number', { ascending: false }),
    admin.from('prescriptions').select('prescription_data').eq('order_id', orderId).maybeSingle(),
    admin.from('quotes').select('id, total, quote_items(description)').eq('order_id', orderId),
    admin.from('order_frames').select('frame_name, sku, color').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    admin.from('frames').select('id, name, metadata').is('organization_id', null).eq('active', true).order('name'),
    order.professional_id
      ? admin.from('professional_profiles').select('display_name, council_registration').eq('user_id', order.professional_id).maybeSingle()
      : Promise.resolve({ data: null as { display_name: string; council_registration: string | null } | null })
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
  if (photoFiles?.length) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(`${photoFolder}/${photoFiles[0].name}`, 3600);
    photoUrl = signed?.signedUrl || null;
  }

  const ful = fulfillment as Record<string, unknown> | null;
  const locked = order.status === 'completed';
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
    { id: 'status', label: 'Acompanhar pedido', hint: 'produção + entrega' }
  ];
  const stepsDone = [true, hasQuote, hasRx, hasFrame, trackingDone];
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
          <span className={locked ? 'complete-tag' : 'pending-tag'}>{STATUS_LABEL[order.status] || order.status}</span>
        </div>
        <div className="card-body">
          <div className="summary-grid">
            <div className="stat"><span>Lente</span><strong>{selectedQuote?.description || 'Escolha pendente'}</strong></div>
            <div className="stat"><span>Armação</span><strong>{orderFrame?.frame_name || 'Ainda não escolhida'}</strong></div>
            <div className="stat"><span>Valor</span><strong>{selectedQuote ? `R$ ${selectedQuote.total.toFixed(2).replace('.', ',')}` : 'A definir'}</strong></div>
            <div className="stat"><span>Status</span><strong>{STATUS_LABEL[order.status] || order.status}</strong></div>
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
