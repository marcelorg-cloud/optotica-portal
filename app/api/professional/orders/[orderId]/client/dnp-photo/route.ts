import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const BUCKET = 'dnp-photos';
const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function numberInRange(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

// Salva o resultado da ferramenta "Medir com foto" (etapa 1 do atendimento):
// a foto usada como referência (cartão + pupilas marcadas, para auditoria —
// o profissional pode reabrir e conferir depois) e os valores de DNP
// calculados a partir dela, já revisados/ajustados manualmente antes de
// salvar (o ajuste em si acontece no navegador, aqui só recebemos o
// resultado final). Mesmo padrão de bloqueio das outras rotas da etapa 1-4:
// depois da Comanda final confirmada, nada aqui pode mudar.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('photo');
  const odMm = numberInRange(form?.get('odMm'), 10, 45);
  const oeMm = numberInRange(form?.get('oeMm'), 10, 45);
  if (!(file instanceof File)) return NextResponse.json({ message: 'Envie a foto usada na medição.' }, { status: 400 });
  if (odMm === undefined || oeMm === undefined) return NextResponse.json({ message: 'DNP calculada inválida.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ message: 'A foto deve ter até 8MB.' }, { status: 400 });
  const ext = EXT_BY_MIME[file.type];
  if (!ext) return NextResponse.json({ message: 'Formato de imagem não suportado.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, client_id, organization_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — a DNP não pode mais ser alterada.' }, { status: 409 });
  }

  // Um arquivo por atendimento (upsert): remedir dentro do mesmo pedido troca
  // a foto de referência; pedidos diferentes do mesmo paciente mantêm cada um
  // a sua, formando um histórico na ficha do paciente.
  const path = `${order.organization_id}/${order.client_id}/dnp-${orderId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) {
    console.error('dnp_photo_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'Não foi possível salvar a foto da medição.' }, { status: 500 });
  }

  const { error: updateError } = await admin.from('clients').update({
    dnp_od: odMm,
    dnp_oe: oeMm,
    dnp_photo_path: path,
    dnp_measured_at: new Date().toISOString()
  }).eq('id', order.client_id);
  if (updateError) {
    console.error('dnp_photo_client_update_failed', { code: updateError.code });
    return NextResponse.json({ message: 'Foto salva, mas não foi possível atualizar a DNP do paciente.' }, { status: 500 });
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ message: 'Medição salva.', odMm, oeMm, photoUrl: signed?.signedUrl || null });
}
