import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { PrintLaboratoryOrderButton } from '@/components/order/print-laboratory-order-button';

export const metadata: Metadata = { title: 'Comanda do laboratório' };
export const dynamic = 'force-dynamic';

function value(v: unknown) { return v === null || v === undefined || v === '' ? '—' : String(v); }
function rxValue(v: unknown, suffix = '') { return `${value(v)}${v === null || v === undefined || v === '' ? '' : suffix}`; }

export default async function LaboratoryOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, order_number, client_id, selected_quote_id, professional_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) redirect('/profissional/pacientes');

  const [{ data: client }, { data: prescription }, { data: frame }, { data: fulfillment }, { data: quote }, { data: profile }] = await Promise.all([
    admin.from('clients').select('full_name, dnp_od, dnp_oe').eq('id', order.client_id).maybeSingle(),
    admin.from('prescriptions').select('prescription_data, clinical_notes').eq('order_id', orderId).maybeSingle(),
    admin.from('order_frames').select('frame_name, sku, color').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    order.selected_quote_id ? admin.from('quotes').select('quote_items(description, metadata)').eq('id', order.selected_quote_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('professional_profiles').select('display_name, council_registration').eq('user_id', user.id).maybeSingle()
  ]);
  if (!fulfillment?.comanda_confirmed_at) redirect(`/profissional/pacientes/${order.client_id}/pedido/${orderId}#comanda`);

  const item = (quote as { quote_items?: Array<{ description?: string; metadata?: { laboratory?: string; notes?: string } }> } | null)?.quote_items?.[0];
  const rx = (prescription?.prescription_data || {}) as { od?: Record<string, unknown>; oe?: Record<string, unknown> };
  const code = orderCode(client?.full_name || 'Paciente', order.order_number);

  return <main className="lab-order-preview">
    <style>{`
      .lab-order-preview { min-height:100vh; padding:24px; font-family:Arial,sans-serif; color:#111; background:#ececec; }
      .lab-order-toolbar { width:210mm; max-width:100%; margin:0 auto 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
      .lab-order-actions { display:flex; gap:10px; flex-wrap:wrap; }
      .lab-order-sheet { width:210mm; height:297mm; box-sizing:border-box; margin:0 auto; padding:11mm 12mm; background:#fff; border:1px solid #cfcfcf; box-shadow:0 4px 18px rgba(0,0,0,.08); overflow:hidden; font-size:12px; line-height:1.3; }
      .lab-order-sheet h2 { font-size:14px!important; margin-top:14px!important; margin-bottom:6px!important; }
      .lab-order-sheet p { margin:4px 0; }
      .lab-order-sheet table { font-size:11px; }
      .lab-order-sheet td, .lab-order-sheet th { padding:6px!important; }
      @media (max-width: 900px) {
        .lab-order-preview { padding:12px; overflow-x:auto; }
        .lab-order-toolbar, .lab-order-sheet { width:210mm; max-width:none; }
      }
      @media print {
        @page { size:A4 portrait; margin:0; }
        html, body { width:210mm; height:297mm; margin:0!important; padding:0!important; background:#fff!important; }
        .no-print { display:none!important; }
        .lab-order-preview { min-height:0!important; padding:0!important; margin:0!important; background:#fff!important; }
        .lab-order-sheet { width:210mm!important; height:297mm!important; margin:0!important; padding:11mm 12mm!important; border:0!important; box-shadow:none!important; overflow:hidden!important; page-break-after:avoid!important; break-after:avoid-page!important; }
      }
    `}</style>
    <div className="no-print lab-order-toolbar">
      <strong>Comanda do laboratório · visualização A4</strong>
      <div className="lab-order-actions">
        <a className="button secondary" href={`/api/professional/orders/${orderId}/laboratory-order-pdf`} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
        <PrintLaboratoryOrderButton />
      </div>
    </div>
    <section className="lab-order-sheet">
      <header style={{ display:'flex', justifyContent:'space-between', gap:20, borderBottom:'2px solid #111', paddingBottom:10, marginBottom:12 }}>
        <div><div style={{ fontSize:12, textTransform:'uppercase', letterSpacing:1 }}>Optótica · Comanda de laboratório</div><h1 style={{ margin:'4px 0 0', fontSize:20 }}>{code}</h1></div>
        <div style={{ textAlign:'right', fontSize:13 }}><strong>{value(profile?.display_name)}</strong><br/>{value(profile?.council_registration)}</div>
      </header>
      <h2 style={{ fontSize:16 }}>Paciente</h2>
      <p><strong>{value(client?.full_name)}</strong><br/>DNP: OD {value(client?.dnp_od)} mm · OE {value(client?.dnp_oe)} mm</p>
      <h2 style={{ fontSize:16, marginTop:14 }}>Prescrição</h2>
      <table style={{ width:'100%', borderCollapse:'collapse', textAlign:'center' }}><thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
      <tbody>{(['od','oe'] as const).map(eye => <tr key={eye}>{[eye.toUpperCase(), value(rx[eye]?.esferico), value(rx[eye]?.cilindrico), rxValue(rx[eye]?.eixo,'°'), value(rx[eye]?.adicao)].map((x,i)=><td key={i} style={{ border:'1px solid #ccc', padding:9 }}>{x}</td>)}</tr>)}</tbody></table>
      <h2 style={{ fontSize:16, marginTop:14 }}>Lentes / laboratório</h2>
      <p><strong>Lente:</strong> {value(item?.description)}<br/><strong>Laboratório:</strong> {value(item?.metadata?.laboratory)}<br/><strong>Observações da lente:</strong> {value(item?.metadata?.notes)}</p>
      <h2 style={{ fontSize:16, marginTop:14 }}>Armação</h2>
      <p><strong>Modelo:</strong> {value(frame?.frame_name)} &nbsp; <strong>Cor:</strong> {value(frame?.color)} &nbsp; <strong>SKU:</strong> {value(frame?.sku)}</p>
      <h2 style={{ fontSize:16, marginTop:14 }}>Medidas de montagem</h2>
      <p><strong>Altura OD:</strong> {value(fulfillment.measure_height_od)} mm &nbsp; <strong>Altura OE:</strong> {value(fulfillment.measure_height_oe)} mm<br/><strong>Ponte:</strong> {value(fulfillment.measure_bridge)} mm &nbsp; <strong>Diagonal maior:</strong> {value(fulfillment.measure_diagonal)} mm</p>
      <h2 style={{ fontSize:16, marginTop:14 }}>Observações laboratoriais finais</h2>
      <div style={{ minHeight:48, border:'1px solid #ccc', borderRadius:8, padding:8, whiteSpace:'pre-wrap', maxHeight:72, overflow:'hidden' }}>{value(fulfillment.final_lab_notes)}</div>
      {prescription?.clinical_notes && <><h2 style={{ fontSize:16, marginTop:14 }}>Observações da prescrição</h2><p>{prescription.clinical_notes}</p></>}
      <footer style={{ marginTop:16, paddingTop:8, borderTop:'1px solid #ccc', fontSize:11 }}>Comanda confirmada em {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(fulfillment.comanda_confirmed_at))}.</footer>
    </section>
  </main>;
}
