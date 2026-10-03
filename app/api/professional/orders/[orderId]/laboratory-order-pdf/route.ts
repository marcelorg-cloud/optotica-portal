import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';

export const runtime = 'nodejs';

function value(v: unknown) {
  return v === null || v === undefined || v === '' ? '-' : String(v);
}

function safePdfText(v: unknown) {
  return value(v)
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPhone(e164?: string | null) {
  if (!e164) return '-';
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
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return safePdfText(v);
  if (n > 0) return `+${n.toFixed(2).replace('.', ',')}`;
  if (n < 0) return `-${Math.abs(n).toFixed(2).replace('.', ',')}`;
  return '0,00';
}

function accountLabel(accountType?: string | null) {
  if (accountType === 'optical_store') return 'OTICA';
  if (accountType === 'laboratory') return 'LABORATORIO';
  return 'PROFISSIONAL';
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

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2) {
  const words = safePdfText(text).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1] || '';
    while (font.widthOfTextAtSize(`${last}...`, size) > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}...`;
  }
  return lines.length ? lines : ['-'];
}

function drawLabelValue(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  label: string,
  text: unknown,
  regular: PDFFont,
  bold: PDFFont
) {
  const muted = rgb(0.38, 0.38, 0.38);
  const ink = rgb(0.08, 0.08, 0.08);
  page.drawText(safePdfText(label).toUpperCase(), { x, y, size: 7.2, font: bold, color: muted });
  const lines = wrap(safePdfText(text), bold, 9.2, width, 2);
  lines.forEach((line, i) => page.drawText(line, { x, y: y - 11 - i * 10, size: 9.2, font: bold, color: ink }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Faça login como profissional.', { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, client_id, selected_quote_id, professional_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return new Response('Atendimento não encontrado.', { status: 404 });

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
    return new Response('Confirme a comanda antes de gerar o PDF.', { status: 409 });
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
  const measurements = ((frame as { catalog_products?: FrameMeasurements | null } | null)?.catalog_products || {}) as FrameMeasurements;
  const code = orderCode(client?.full_name || 'Paciente', order.order_number);
  const issuedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(fulfillment.comanda_confirmed_at));
  const labLocation = laboratory?.city
    ? `${laboratory.city}${laboratory.state ? `/${laboratory.state}` : ''}`
    : '-';

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.38, 0.38, 0.38);
  const border = rgb(0.78, 0.78, 0.78);
  const fill = rgb(0.97, 0.97, 0.97);

  const left = 36;
  const right = 559;
  const width = right - left;
  let y = 802;

  try {
    const logoBytes = await readFile(join(process.cwd(), 'public', 'optotica-logo-transparent.png'));
    const logo = await pdf.embedPng(logoBytes);
    const scaled = logo.scale(0.22);
    page.drawImage(logo, { x: left, y: y - 26, width: scaled.width, height: scaled.height });
  } catch {
    page.drawText('OPTOTICA', { x: left, y: y - 4, size: 17, font: bold, color: ink });
  }

  page.drawText('COMANDA DE LABORATORIO', { x: 390, y: y - 2, size: 8.5, font: bold, color: muted });
  const codeWidth = bold.widthOfTextAtSize(safePdfText(code), 17);
  page.drawText(safePdfText(code), { x: right - codeWidth, y: y - 23, size: 17, font: bold, color: ink });
  y -= 46;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: ink });
  y -= 17;

  page.drawText('DADOS PRINCIPAIS', { x: left, y, size: 9, font: bold, color: ink });
  y -= 9;
  const identityHeight = 91;
  page.drawRectangle({ x: left, y: y - identityHeight, width, height: identityHeight, borderWidth: 0.8, borderColor: border });
  const colGap = 18;
  const colWidth = (width - 20 - colGap) / 2;
  const x1 = left + 10;
  const x2 = x1 + colWidth + colGap;
  const rowYs = [y - 14, y - 42, y - 70];

  drawLabelValue(page, x1, rowYs[0], colWidth, 'Laboratório', laboratory?.name || item?.metadata?.laboratory, regular, bold);
  drawLabelValue(page, x2, rowYs[0], colWidth, 'Cidade do laboratório', labLocation, regular, bold);
  drawLabelValue(page, x1, rowYs[1], colWidth, accountLabel(profile?.account_type), profile?.display_name, regular, bold);
  drawLabelValue(page, x2, rowYs[1], colWidth, 'Data de emissão', issuedAt, regular, bold);
  drawLabelValue(page, x1, rowYs[2], colWidth, 'Paciente', client?.full_name, regular, bold);
  drawLabelValue(page, x2, rowYs[2], colWidth, 'Telefone', formatPhone(client?.whatsapp_e164), regular, bold);
  y -= identityHeight + 20;

  page.drawText('PRESCRICAO OPTICA', { x: left, y, size: 9, font: bold, color: ink });
  y -= 12;
  const rxTop = y;
  const rxHeight = 58;
  page.drawRectangle({ x: left, y: rxTop - rxHeight, width, height: rxHeight, borderWidth: 0.8, borderColor: border });
  const rxCols = [left, left + 68, left + 176, left + 286, left + 388, right];
  for (let i = 1; i < rxCols.length - 1; i += 1) {
    page.drawLine({ start: { x: rxCols[i], y: rxTop }, end: { x: rxCols[i], y: rxTop - rxHeight }, thickness: 0.5, color: border });
  }
  page.drawRectangle({ x: left, y: rxTop - 19, width, height: 19, color: fill });
  page.drawLine({ start: { x: left, y: rxTop - 19 }, end: { x: right, y: rxTop - 19 }, thickness: 0.5, color: border });
  page.drawLine({ start: { x: left, y: rxTop - 38.5 }, end: { x: right, y: rxTop - 38.5 }, thickness: 0.5, color: border });

  const headers = ['Olho', 'Esferico', 'Cilindrico', 'Eixo', 'Adicao'];
  headers.forEach((h, i) => page.drawText(h, { x: rxCols[i] + 7, y: rxTop - 13, size: 7.8, font: bold, color: muted }));
  (['od', 'oe'] as const).forEach((eye, rowIndex) => {
    const yy = rxTop - 32 - rowIndex * 19.5;
    const vals = [
      eye.toUpperCase(),
      formatDiopter(rx[eye]?.esferico),
      formatDiopter(rx[eye]?.cilindrico),
      rx[eye]?.eixo === null || rx[eye]?.eixo === undefined || rx[eye]?.eixo === '' ? '-' : `${rx[eye]?.eixo}°`,
      formatDiopter(rx[eye]?.adicao)
    ];
    vals.forEach((v, i) => page.drawText(safePdfText(v), { x: rxCols[i] + 7, y: yy, size: 9, font: i === 0 ? bold : regular, color: ink }));
  });
  y = rxTop - rxHeight - 18;

  const cardGap = 10;
  const cardWidth = (width - cardGap) / 2;
  page.drawText('LENTES / LABORATORIO', { x: left, y, size: 9, font: bold, color: ink });
  page.drawText('ARMACAO', { x: left + cardWidth + cardGap, y, size: 9, font: bold, color: ink });
  y -= 10;
  const cardHeight = 66;
  page.drawRectangle({ x: left, y: y - cardHeight, width: cardWidth, height: cardHeight, borderWidth: 0.8, borderColor: border });
  page.drawRectangle({ x: left + cardWidth + cardGap, y: y - cardHeight, width: cardWidth, height: cardHeight, borderWidth: 0.8, borderColor: border });
  const lensX = left + 9;
  const frameX = left + cardWidth + cardGap + 9;
  page.drawText('Lente:', { x: lensX, y: y - 15, size: 8, font: bold, color: muted });
  wrap(safePdfText(item?.description), regular, 8.5, cardWidth - 48, 2).forEach((ln, i) => page.drawText(ln, { x: lensX + 34, y: y - 15 - i * 10, size: 8.5, font: regular, color: ink }));
  page.drawText('Lab.:', { x: lensX, y: y - 39, size: 8, font: bold, color: muted });
  page.drawText(safePdfText(laboratory?.name || item?.metadata?.laboratory), { x: lensX + 29, y: y - 39, size: 8.5, font: regular, color: ink });
  page.drawText('Obs.:', { x: lensX, y: y - 54, size: 8, font: bold, color: muted });
  page.drawText(wrap(safePdfText(item?.metadata?.notes), regular, 8, cardWidth - 38, 1)[0], { x: lensX + 28, y: y - 54, size: 8, font: regular, color: ink });

  page.drawText('Modelo:', { x: frameX, y: y - 15, size: 8, font: bold, color: muted });
  page.drawText(wrap(safePdfText(frame?.frame_name), regular, 8.5, cardWidth - 55, 1)[0], { x: frameX + 40, y: y - 15, size: 8.5, font: regular, color: ink });
  page.drawText('Cor:', { x: frameX, y: y - 34, size: 8, font: bold, color: muted });
  page.drawText(wrap(safePdfText(frame?.color), regular, 8.5, cardWidth - 40, 1)[0], { x: frameX + 25, y: y - 34, size: 8.5, font: regular, color: ink });
  page.drawText('SKU:', { x: frameX, y: y - 53, size: 8, font: bold, color: muted });
  page.drawText(safePdfText(frame?.sku), { x: frameX + 26, y: y - 53, size: 8.5, font: regular, color: ink });
  y -= cardHeight + 20;

  page.drawText('MEDIDAS', { x: left, y, size: 9, font: bold, color: ink });
  y -= 10;
  const measures = [
    ['DNP OD', client?.dnp_od],
    ['DNP OE', client?.dnp_oe],
    ['Altura OD', fulfillment.measure_height_od],
    ['Altura OE', fulfillment.measure_height_oe],
    ['Largura lente', measurements.lens_width_mm],
    ['Altura lente', measurements.lens_height_mm],
    ['Ponte', fulfillment.measure_bridge ?? measurements.bridge_mm],
    ['Diagonal maior', fulfillment.measure_diagonal ?? measurements.lens_diagonal_mm],
    ['Largura total', measurements.frame_total_width_mm],
    ['Haste', measurements.temple_length_mm]
  ];
  const measureHeight = 70;
  page.drawRectangle({ x: left, y: y - measureHeight, width, height: measureHeight, borderWidth: 0.8, borderColor: border, color: rgb(0.985, 0.985, 0.985) });
  const mCols = 5;
  const mCellW = width / mCols;
  measures.forEach(([label, measurement], i) => {
    const row = Math.floor(i / mCols);
    const col = i % mCols;
    const xx = left + col * mCellW + 7;
    const yy = y - 16 - row * 32;
    page.drawText(safePdfText(label).toUpperCase(), { x: xx, y: yy, size: 6.7, font: bold, color: muted });
    const measured = measurement === null || measurement === undefined || measurement === '' ? '-' : `${value(measurement)} mm`;
    page.drawText(safePdfText(measured), { x: xx, y: yy - 12, size: 9.3, font: bold, color: ink });
  });
  y -= measureHeight + 20;

  page.drawText('OBSERVACOES LABORATORIAIS FINAIS', { x: left, y, size: 9, font: bold, color: ink });
  y -= 9;
  const notesHeight = 54;
  page.drawRectangle({ x: left, y: y - notesHeight, width, height: notesHeight, borderWidth: 0.8, borderColor: border });
  wrap(safePdfText(fulfillment.final_lab_notes), regular, 8.5, width - 18, 4).forEach((ln, i) => {
    page.drawText(ln, { x: left + 9, y: y - 15 - i * 10, size: 8.5, font: regular, color: ink });
  });
  y -= notesHeight + 16;

  if (prescription?.clinical_notes && y > 105) {
    page.drawText('OBSERVACOES DA PRESCRICAO', { x: left, y, size: 9, font: bold, color: ink });
    y -= 9;
    const clinicalHeight = 42;
    page.drawRectangle({ x: left, y: y - clinicalHeight, width, height: clinicalHeight, borderWidth: 0.8, borderColor: border });
    wrap(safePdfText(prescription.clinical_notes), regular, 8.3, width - 18, 3).forEach((ln, i) => {
      page.drawText(ln, { x: left + 9, y: y - 14 - i * 10, size: 8.3, font: regular, color: ink });
    });
  }

  page.drawLine({ start: { x: left, y: 49 }, end: { x: right, y: 49 }, thickness: 0.6, color: border });
  page.drawText(`Comanda emitida em ${issuedAt}.`, { x: left, y: 34, size: 7.5, font: regular, color: muted });
  const footer = 'Portal Optotica';
  page.drawText(footer, { x: right - regular.widthOfTextAtSize(footer, 7.5), y: 34, size: 7.5, font: regular, color: muted });

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
