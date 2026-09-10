import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { ClientStep } from '@/components/order/client-step';
import { OsStep } from '@/components/order/os-step';
import { FrameStep } from '@/components/order/frame-step';
import { ComandaStep } from '@/components/order/comanda-step';
import { PaymentStep } from '@/components/order/payment-step';
import { ProductionStep } from '@/components/order/production-step';
import { LogisticsStep } from '@/components/order/logistics-step';
import { AssemblyStep } from '@/components/order/assembly-step';
import { DeliveryStep } from '@/components/order/delivery-step';

export const metadata: Metadata = { title: 'Atendimento' };

type QuoteItemMeta = { lensType?: string; lensIndex?: string; lensMaterial?: string; lensTreatment?: string; laboratory?: string; notes?: string };
type QuoteRow = { id: string; total: number; quote_items: { description: string; metadata: QuoteItemMeta }[] | null };
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

export default async function OrderPage({ params }: { params: Promise<{ clientId: string; orderId: string }> }) {
  const { clientId, orderId } = await params;
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('status').eq('user_id', user.id).maybeSingle();
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

  const [{ data: client }, { data: prescription }, { data: quotesData }, { data: orderFrame }, { data: fulfillment }, { data: framesData }] = await Promise.all([
    admin.from('clients').select('full_name, whatsapp_e164, dnp_od, dnp_oe, dnp_photo_path, birth_date, cpf').eq('id', clientId).maybeSingle(),
    admin.from('prescriptions').select('prescription_data').eq('order_id', orderId).maybeSingle(),
    admin.from('quotes').select('id, total, quote_items(description, metadata)').eq('order_id', orderId),
    admin.from('order_frames').select('frame_name, sku, color').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    admin.from('frames').select('id, name, metadata').is('organization_id', null).eq('active', true).order('name')
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

  const frames = ((framesData || []) as unknown as FrameRow[]).map((f) => ({
    id: f.id, name: f.name, kind: f.metadata?.kind || '', variants: f.metadata?.variants || []
  }));

  const ful = fulfillment as Record<string, unknown> | null;
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

  // Estado das etapas (para o menu e as etiquetas de cada card)
  const hasPrescriptionAndQuote = Boolean(prescription && order.selected_quote_id);
  const hasFrame = Boolean(orderFrame);
  const comandaDone = Boolean(ful?.comanda_confirmed_at);
  const paymentDone = Boolean(ful?.payment_confirmed_at);
  const productionDone = ful?.lens_production_status === 'pronta' && ful?.frame_production_status === 'confirmado_fornecedor';
  const logisticsDone = Boolean(ful?.frame_received_at) && Boolean(ful?.lens_ready_at);
  const assemblyDone = ful?.assembly_status === 'concluida';
  const deliveryDone = Boolean(ful?.delivered_at);

  const stepsDone = [true, hasPrescriptionAndQuote, hasFrame, comandaDone, paymentDone, productionDone, logisticsDone, assemblyDone, deliveryDone];
  const currentStepIndex = stepsDone.findIndex((done) => !done);
  const current = currentStepIndex === -1 ? 8 : currentStepIndex;

  const steps = [
    { id: 'cliente', label: 'Paciente', hint: 'dados + DNP' },
    { id: 'os', label: 'OS / Orçamento', hint: 'lente + laboratório' },
    { id: 'armacao', label: 'Armação', hint: 'catálogo' },
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

      <div className="overview">
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
                locked={comandaDone}
              />
            </div>
          </section>

          <section className="card step-section" id="os">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">2</span>
                <div><p className="eyebrow">Etapa atual</p><h2>OS laboratorial + orçamento</h2></div>
              </div>
              {tag(hasPrescriptionAndQuote, current === 1)}
            </div>
            <div className="card-body">
              <OsStep
                orderId={order.id}
                initialOd={toEye(rx?.od)}
                initialOe={toEye(rx?.oe)}
                quotes={quotes}
                selectedQuoteId={order.selected_quote_id}
                locked={comandaDone}
              />
            </div>
          </section>

          <section className="card step-section" id="armacao">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">3</span>
                <div><p className="eyebrow">Etapa</p><h2>Escolha da armação</h2></div>
              </div>
              {tag(hasFrame, current === 2)}
            </div>
            <div className="card-body">
              <FrameStep orderId={order.id} frames={frames} selectedFrameName={orderFrame?.frame_name || null} selectedColor={orderFrame?.color || null} locked={comandaDone} />
            </div>
          </section>

          <section className="card step-section" id="comanda">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">4</span>
                <div><p className="eyebrow">Etapa</p><h2>Comanda final</h2></div>
              </div>
              {tag(comandaDone, current === 3)}
            </div>
            <div className="card-body">
              <ComandaStep
                orderId={order.id}
                clientName={clientName}
                dnp={dnp}
                lensDescription={selectedQuote?.description || ''}
                laboratory={selectedQuote?.laboratory || ''}
                frameName={orderFrame?.frame_name || ''}
                initial={{
                  heightOd: str(ful?.measure_height_od), heightOe: str(ful?.measure_height_oe),
                  bridge: str(ful?.measure_bridge), diagonal: str(ful?.measure_diagonal), notes: str(ful?.final_lab_notes)
                }}
                confirmed={comandaDone}
              />
            </div>
          </section>

          <section className="card step-section" id="pagamento">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">5</span>
                <div><p className="eyebrow">Etapa</p><h2>Pagamento</h2></div>
              </div>
              {tag(paymentDone, current === 4)}
            </div>
            <div className="card-body">
              <PaymentStep
                orderId={order.id}
                initialValue={str(ful?.payment_value)}
                initialMethod={str(ful?.payment_method)}
                initialDownValue={str(ful?.payment_down_value)}
                initialPickupValue={str(ful?.payment_pickup_value)}
                confirmed={paymentDone}
              />
            </div>
          </section>

          <section className="card step-section" id="producao">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">6</span>
                <div><p className="eyebrow">Etapa</p><h2>Produção</h2></div>
              </div>
              {tag(productionDone, current === 5)}
            </div>
            <div className="card-body">
              <ProductionStep
                orderId={order.id}
                initialFrameStatus={str(ful?.frame_production_status) || 'aguardando_pedido'}
                initialFrameRef={str(ful?.frame_supplier_reference)}
                initialLensStatus={str(ful?.lens_production_status) || 'aguardando_envio'}
                initialLensRef={str(ful?.lens_lab_reference)}
              />
            </div>
          </section>

          <section className="card step-section" id="logistica">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">7</span>
                <div><p className="eyebrow">Etapa</p><h2>Produção e logística</h2></div>
              </div>
              {tag(logisticsDone, current === 6)}
            </div>
            <div className="card-body">
              <LogisticsStep
                orderId={order.id}
                frameShippedAt={(ful?.frame_shipped_at as string) || null}
                frameReceivedAt={(ful?.frame_received_at as string) || null}
                lensConfirmedAt={(ful?.lens_confirmed_at as string) || null}
                lensReadyAt={(ful?.lens_ready_at as string) || null}
              />
            </div>
          </section>

          <section className="card step-section" id="montagem">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">8</span>
                <div><p className="eyebrow">Etapa</p><h2>Montagem</h2></div>
              </div>
              {tag(assemblyDone, current === 7)}
            </div>
            <div className="card-body">
              <AssemblyStep
                orderId={order.id}
                initialFrameReceived={Boolean(ful?.frame_received_check)}
                initialLensReceived={Boolean(ful?.lens_received_check)}
                initialStatus={str(ful?.assembly_status) || 'aguardando'}
                initialNotes={str(ful?.assembly_notes)}
              />
            </div>
          </section>

          <section className="card step-section" id="entrega">
            <div className="card-head">
              <div className="step-title">
                <span className="step-badge">9</span>
                <div><p className="eyebrow">Etapa</p><h2>Entrega</h2></div>
              </div>
              {tag(deliveryDone, current === 8)}
            </div>
            <div className="card-body">
              <DeliveryStep
                orderId={order.id}
                initialDestination={str(ful?.delivery_destination)}
                initialDate={str(ful?.delivery_date)}
                initialReceivedBy={str(ful?.delivery_received_by)}
                initialNotes={str(ful?.delivery_notes)}
                confirmed={deliveryDone}
              />
            </div>
          </section>

        </div>

        <aside className="card sidebar">
          <div className="card-head"><div><p className="eyebrow">Resumo vivo</p><h2>Atendimento</h2></div></div>
          <div className="card-body">
            <div className="summary-row"><span>Paciente</span><strong>{clientName}</strong></div>
            <div className="summary-row"><span>DNP</span><strong>{dnp}</strong></div>
            <div className="summary-row"><span>Lente</span><strong>{selectedQuote?.description || 'Não definida'}</strong></div>
            <div className="summary-row"><span>Laboratório</span><strong>{selectedQuote?.laboratory || 'Não definido'}</strong></div>
            <div className="summary-row"><span>Armação</span><strong>{orderFrame?.frame_name || 'Não definida'}</strong></div>
            <div className="summary-row"><span>Valor proposto</span><strong>R$ {(selectedQuote?.total ?? 0).toFixed(2).replace('.', ',')}</strong></div>
            <div className="notice">Cada etapa reaproveita as informações das etapas anteriores. O atendimento vai sendo complementado sem duplicar cadastros.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
