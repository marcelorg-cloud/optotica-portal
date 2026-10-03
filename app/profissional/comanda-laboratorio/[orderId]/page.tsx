import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { PrintLaboratoryOrderButton } from '@/components/order/print-laboratory-order-button';

export const metadata: Metadata = { title: 'Comanda do laboratório' };
export const dynamic = 'force-dynamic';

function value(v: unknown) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function formatPhone(e164?: string | null) {
  if (!e164) return '—';
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    return `+55 (${ddd}) 9${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
  }
  if (digits.startsWith('55') && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    return `+55 (${ddd}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;
  }
  return `+${digits}`;
}

function formatDiopter(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  const normalized = String(v).trim().replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return value(v);
  if (n > 0) return `+${n.toFixed(2).replace('.', ',')}`;
  if (n < 0) return `-${Math.abs(n).toFixed(2).replace('.', ',')}`;
  return '0,00';
}

function accountLabel(accountType?: string | null) {
  if (accountType === 'optical_store') return 'Ótica';
  if (accountType === 'laboratory') return 'Laboratório';
  return 'Profissional';
}

type FrameMeasurements = {
  lens_width_mm?: number | null;
  lens_height_mm?: number | null;
  bridge_mm?: number | null;
  lens_diagonal_mm?: number | null;
  temple_length_mm?: number | null;
  frame_total_width_mm?: number | null;
  standard_height_mm?: number | null;
};

export default async function LaboratoryOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, client_id, selected_quote_id, professional_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) redirect('/profissional/pacientes');

  const [{ data: client }, { data: prescription }, { data: frame }, { data: fulfillment }, { data: quote }, { data: profile }] = await Promise.all([
    admin.from('clients').select('full_name, whatsapp_e164, dnp_od, dnp_oe').eq('id', order.client_id).maybeSingle(),
    admin.from('prescriptions').select('prescription_data, clinical_notes').eq('order_id', orderId).maybeSingle(),
    admin.from('order_frames').select('frame_name, sku, color, catalog_product_id, catalog_products(lens_width_mm, lens_height_mm, bridge_mm, lens_diagonal_mm, temple_length_mm, frame_total_width_mm, standard_height_mm)').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    order.selected_quote_id
      ? admin.from('quotes').select('quote_items(description, metadata)').eq('id', order.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('professional_profiles').select('id, organization_id, display_name, council_registration, account_type').eq('user_id', user.id).maybeSingle()
  ]);

  if (!fulfillment?.comanda_confirmed_at) {
    redirect(`/profissional/pacientes/${order.client_id}/pedido/${orderId}#comanda`);
  }

  const item = (quote as { quote_items?: Array<{ description?: string; metadata?: { laboratory?: string; notes?: string } }> } | null)?.quote_items?.[0];

  let laboratory: { name: string; city: string | null; state: string | null } | null = null;
  if (fulfillment.laboratory_id) {
    const { data } = await admin
      .from('professional_laboratories')
      .select('name, city, state')
      .eq('id', fulfillment.laboratory_id)
      .maybeSingle();
    laboratory = data;
  }
  if (!laboratory && item?.metadata?.laboratory && profile?.organization_id) {
    const { data } = await admin
      .from('professional_laboratories')
      .select('name, city, state')
      .eq('organization_id', profile.organization_id)
      .eq('name', item.metadata.laboratory)
      .limit(1)
      .maybeSingle();
    laboratory = data;
  }

  const rx = (prescription?.prescription_data || {}) as { od?: Record<string, unknown>; oe?: Record<string, unknown> };
  const code = orderCode(client?.full_name || 'Paciente', order.order_number);
  const measurements = ((frame as { catalog_products?: FrameMeasurements | null } | null)?.catalog_products || {}) as FrameMeasurements;
  const issuedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fulfillment.comanda_confirmed_at));
  const labLocation = laboratory?.city
    ? `${laboratory.city}${laboratory.state ? `/${laboratory.state}` : ''}`
    : '—';

  const measurementItems = [
    ['DNP OD', client?.dnp_od, 'mm'],
    ['DNP OE', client?.dnp_oe, 'mm'],
    ['Altura OD', fulfillment.measure_height_od, 'mm'],
    ['Altura OE', fulfillment.measure_height_oe, 'mm'],
    ['Largura da lente', measurements.lens_width_mm, 'mm'],
    ['Altura da lente', measurements.lens_height_mm, 'mm'],
    ['Ponte', fulfillment.measure_bridge ?? measurements.bridge_mm, 'mm'],
    ['Diagonal maior', fulfillment.measure_diagonal ?? measurements.lens_diagonal_mm, 'mm'],
    ['Largura total', measurements.frame_total_width_mm, 'mm'],
    ['Haste', measurements.temple_length_mm, 'mm']
  ];

  return <main className="lab-order-preview">
    <style>{`
      .lab-order-preview { min-height:100vh; padding:24px; font-family:Arial,sans-serif; color:#111; background:#ececec; }
      .lab-order-toolbar { width:210mm; max-width:100%; margin:0 auto 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
      .lab-order-actions { display:flex; gap:10px; flex-wrap:wrap; }
      .lab-order-sheet { width:210mm; height:297mm; box-sizing:border-box; margin:0 auto; padding:10mm 11mm; background:#fff; border:1px solid #cfcfcf; box-shadow:0 4px 18px rgba(0,0,0,.08); overflow:hidden; font-size:11.5px; line-height:1.28; }
      .lab-order-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding-bottom:9px; border-bottom:2px solid #111; }
      .lab-order-logo { width:116px; height:auto; object-fit:contain; }
      .lab-order-title { text-align:right; }
      .lab-order-title h1 { margin:3px 0 0; font-size:19px; }
      .lab-order-section { margin-top:11px; }
      .lab-order-section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; margin:0 0 6px; }
      .identity-grid { display:grid; grid-template-columns:1.15fr 1fr; gap:6px 18px; padding:9px 10px; border:1px solid #cfcfcf; border-radius:8px; }
      .identity-item span, .measure-item span { display:block; font-size:9px; text-transform:uppercase; letter-spacing:.04em; color:#666; margin-bottom:2px; }
      .identity-item strong, .measure-item strong { font-size:11px; }
      .rx-table { width:100%; border-collapse:collapse; text-align:center; font-size:10.5px; }
      .rx-table th { background:#f3f3f3; }
      .rx-table th, .rx-table td { border:1px solid #cfcfcf; padding:5px; }
      .two-col { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .info-card { border:1px solid #cfcfcf; border-radius:8px; padding:8px 10px; }
      .info-card p { margin:2px 0; }
      .measure-card { display:grid; grid-template-columns:repeat(5, 1fr); gap:7px; border:1px solid #bdbdbd; border-radius:8px; padding:8px 9px; background:#fafafa; }
      .measure-item { min-width:0; }
      .notes-box { min-height:42px; max-height:58px; overflow:hidden; border:1px solid #cfcfcf; border-radius:8px; padding:7px 9px; white-space:pre-wrap; }
      .lab-order-footer { margin-top:12px; padding-top:7px; border-top:1px solid #ccc; font-size:9px; color:#555; display:flex; justify-content:space-between; gap:12px; }
      @media (max-width:900px) {
        .lab-order-preview { padding:12px; overflow-x:auto; }
        .lab-order-toolbar, .lab-order-sheet { width:210mm; max-width:none; }
      }
      @media print {
        @page { size:A4 portrait; margin:0; }
        html, body { width:210mm; height:297mm; margin:0!important; padding:0!important; background:#fff!important; }
        .no-print { display:none!important; }
        .lab-order-preview { min-height:0!important; padding:0!important; margin:0!important; background:#fff!important; }
        .lab-order-sheet { width:210mm!important; height:297mm!important; margin:0!important; padding:10mm 11mm!important; border:0!important; box-shadow:none!important; overflow:hidden!important; page-break-after:avoid!important; break-after:avoid-page!important; }
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
      <header className="lab-order-header">
        <Image className="lab-order-logo" src="/optotica-logo-transparent.png" width={420} height={140} alt="Optótica" priority />
        <div className="lab-order-title">
          <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:1, color:'#666' }}>Comanda de laboratório</div>
          <h1>{code}</h1>
        </div>
      </header>

      <section className="lab-order-section">
        <h2>Dados principais</h2>
        <div className="identity-grid">
          <div className="identity-item"><span>Laboratório</span><strong>{value(laboratory?.name || item?.metadata?.laboratory)}</strong></div>
          <div className="identity-item"><span>Cidade do laboratório</span><strong>{labLocation}</strong></div>
          <div className="identity-item"><span>{accountLabel(profile?.account_type)}</span><strong>{value(profile?.display_name)}</strong>{profile?.council_registration ? <> · {profile.council_registration}</> : null}</div>
          <div className="identity-item"><span>Data de emissão</span><strong>{issuedAt}</strong></div>
          <div className="identity-item"><span>Paciente</span><strong>{value(client?.full_name)}</strong></div>
          <div className="identity-item"><span>Telefone</span><strong>{formatPhone(client?.whatsapp_e164)}</strong></div>
        </div>
      </section>

      <section className="lab-order-section">
        <h2>Prescrição óptica</h2>
        <table className="rx-table">
          <thead><tr><th>Olho</th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
          <tbody>
            {(['od','oe'] as const).map((eye) => <tr key={eye}>
              <td><strong>{eye.toUpperCase()}</strong></td>
              <td>{formatDiopter(rx[eye]?.esferico)}</td>
              <td>{formatDiopter(rx[eye]?.cilindrico)}</td>
              <td>{rx[eye]?.eixo === null || rx[eye]?.eixo === undefined || rx[eye]?.eixo === '' ? '—' : `${rx[eye]?.eixo}°`}</td>
              <td>{formatDiopter(rx[eye]?.adicao)}</td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <section className="lab-order-section two-col">
        <div>
          <h2>Lentes / laboratório</h2>
          <div className="info-card">
            <p><strong>Lente:</strong> {value(item?.description)}</p>
            <p><strong>Laboratório:</strong> {value(laboratory?.name || item?.metadata?.laboratory)}</p>
            <p><strong>Observações:</strong> {value(item?.metadata?.notes)}</p>
          </div>
        </div>
        <div>
          <h2>Armação</h2>
          <div className="info-card">
            <p><strong>Modelo:</strong> {value(frame?.frame_name)}</p>
            <p><strong>Cor:</strong> {value(frame?.color)}</p>
            <p><strong>SKU:</strong> {value(frame?.sku)}</p>
          </div>
        </div>
      </section>

      <section className="lab-order-section">
        <h2>Medidas</h2>
        <div className="measure-card">
          {measurementItems.map(([label, measurement, unit]) => (
            <div className="measure-item" key={String(label)}>
              <span>{String(label)}</span>
              <strong>{value(measurement)}{measurement === null || measurement === undefined || measurement === '' ? '' : ` ${unit}`}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="lab-order-section">
        <h2>Observações laboratoriais finais</h2>
        <div className="notes-box">{value(fulfillment.final_lab_notes)}</div>
      </section>

      {prescription?.clinical_notes && <section className="lab-order-section">
        <h2>Observações da prescrição</h2>
        <div className="notes-box">{prescription.clinical_notes}</div>
      </section>}

      <footer className="lab-order-footer">
        <span>Comanda emitida em {issuedAt}.</span>
        <span>Portal Optótica</span>
      </footer>
    </section>
  </main>;
}
