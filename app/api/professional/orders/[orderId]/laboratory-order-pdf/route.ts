import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';

export const runtime = 'nodejs';

function value(v: unknown) {
  return v === null || v === undefined || v === '' ? '-' : String(v);
}

function safePdfText(v: unknown) {
  return value(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, client_id, selected_quote_id, professional_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Atendimento não encontrado.' }, { status: 404 });

  const [{ data: client }, { data: prescription }, { data: frame }, { data: fulfillment }, { data: quote }, { data: profile }] = await Promise.all([
    admin.from('clients').select('full_name, dnp_od, dnp_oe').eq('id', order.client_id).maybeSingle(),
    admin.from('prescriptions').select('prescription_data, clinical_notes').eq('order_id', orderId).maybeSingle(),
    admin.from('order_frames').select('frame_name, sku, color').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('*').eq('order_id', orderId).maybeSingle(),
    order.selected_quote_id
      ? admin.from('quotes').select('quote_items(description, metadata)').eq('id', order.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('professional_profiles').select('display_name, council_registration').eq('user_id', user.id).maybeSingle()
  ]);

  if (!fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'Confirme a comanda antes de gerar o PDF.' }, { status: 409 });
  }

  const item = (quote as { quote_items?: Array<{ description?: string; metadata?: { laboratory?: string; notes?: string } }> } | null)?.quote_items?.[0];
  const rx = (prescription?.prescription_data || {}) as { od?: Record<string, unknown>; oe?: Record<string, unknown> };
  const code = orderCode(client?.full_name || 'Paciente', order.order_number);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 em pontos
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.38, 0.38, 0.38);
  const line = rgb(0.78, 0.78, 0.78);

  const left = 40;
  const right = 555;
  const width = right - left;
  let y = 802;

  const wrap = (text: string, font: typeof regular, size: number, maxWidth: number, maxLines = 3) => {
    const words = safePdfText(text).split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
      let last = lines[maxLines - 1];
      while (font.widthOfTextAtSize(`${last}...`, size) > maxWidth && last.length > 1) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}...`;
    }
    return lines;
  };

  const divider = () => {
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.7, color: line });
    y -= 12;
  };
  const section = (title: string) => {
    page.drawText(title, { x: left, y, size: 11, font: bold, color: ink });
    y -= 16;
  };
  const row = (label: string, text: unknown, maxLines = 2) => {
    page.drawText(label, { x: left, y, size: 9, font: bold, color: muted });
    const x = left + 92;
    const lines = wrap(safePdfText(text), regular, 9.5, right - x, maxLines);
    lines.forEach((ln, i) => page.drawText(ln, { x, y: y - i * 12, size: 9.5, font: regular, color: ink }));
    y -= Math.max(14, lines.length * 12 + 2);
  };

  page.drawText('OPTOTICA - COMANDA DE LABORATORIO', { x: left, y, size: 9, font: bold, color: muted });
  page.drawText(code, { x: left, y: y - 22, size: 20, font: bold, color: ink });
  page.drawText(safePdfText(profile?.display_name), { x: 365, y: y - 4, size: 9.5, font: bold, color: ink });
  page.drawText(safePdfText(profile?.council_registration), { x: 365, y: y - 18, size: 9, font: regular, color: muted });
  y -= 48;
  divider();

  section('PACIENTE');
  row('Nome', client?.full_name);
  row('DNP', `OD ${value(client?.dnp_od)} mm   |   OE ${value(client?.dnp_oe)} mm`);
  divider();

  section('PRESCRICAO');
  const col = [left, 112, 218, 326, 418];
  ['Olho', 'Esferico', 'Cilindrico', 'Eixo', 'Adicao'].forEach((h, i) => page.drawText(h, { x: col[i], y, size: 8.5, font: bold, color: muted }));
  y -= 15;
  (['od', 'oe'] as const).forEach((eye) => {
    const vals = [eye.toUpperCase(), value(rx[eye]?.esferico), value(rx[eye]?.cilindrico), `${value(rx[eye]?.eixo)}°`, value(rx[eye]?.adicao)];
    vals.forEach((v, i) => page.drawText(safePdfText(v), { x: col[i], y, size: 10, font: i === 0 ? bold : regular, color: ink }));
    y -= 16;
  });
  divider();

  section('LENTES / LABORATORIO');
  row('Lente', item?.description, 2);
  row('Laboratorio', item?.metadata?.laboratory, 1);
  row('Obs. lente', item?.metadata?.notes, 2);
  divider();

  section('ARMACAO');
  row('Modelo', `${value(frame?.frame_name)}   |   Cor: ${value(frame?.color)}   |   SKU: ${value(frame?.sku)}`, 2);
  divider();

  section('MEDIDAS DE MONTAGEM');
  row('Alturas', `OD ${value(fulfillment.measure_height_od)} mm   |   OE ${value(fulfillment.measure_height_oe)} mm`, 1);
  row('Geometria', `Ponte ${value(fulfillment.measure_bridge)} mm   |   Diagonal maior ${value(fulfillment.measure_diagonal)} mm`, 1);
  divider();

  section('OBSERVACOES LABORATORIAIS FINAIS');
  const finalNotes = wrap(safePdfText(fulfillment.final_lab_notes), regular, 9.5, width, 4);
  (finalNotes.length ? finalNotes : ['-']).forEach((ln) => {
    page.drawText(ln, { x: left, y, size: 9.5, font: regular, color: ink });
    y -= 12;
  });

  if (prescription?.clinical_notes) {
    y -= 8;
    section('OBSERVACOES DA PRESCRICAO');
    wrap(safePdfText(prescription.clinical_notes), regular, 9.5, width, 3).forEach((ln) => {
      page.drawText(ln, { x: left, y, size: 9.5, font: regular, color: ink });
      y -= 12;
    });
  }

  const confirmed = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fulfillment.comanda_confirmed_at));
  page.drawLine({ start: { x: left, y: 56 }, end: { x: right, y: 56 }, thickness: 0.7, color: line });
  page.drawText(`Comanda confirmada em ${confirmed}.`, { x: left, y: 40, size: 8, font: regular, color: muted });
  page.drawText('Documento gerado pelo Portal Optotica.', { x: 382, y: 40, size: 8, font: regular, color: muted });

  const bytes = await pdf.save();
  const filename = `comanda-${code.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').toLowerCase()}.pdf`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
