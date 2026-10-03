import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { buildLaboratoryEyeImage } from '@/lib/laboratory-eye-image';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado.', { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, client_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return new Response('Atendimento não encontrado.', { status: 404 });

  const [{ data: client }, { data: fulfillment }] = await Promise.all([
    admin.from('clients').select('dnp_photo_path, dnp_od, dnp_oe').eq('id', order.client_id).maybeSingle(),
    admin.from('order_fulfillment').select('comanda_confirmed_at, measure_height_od, measure_height_oe').eq('order_id', orderId).maybeSingle()
  ]);

  if (!fulfillment?.comanda_confirmed_at) return new Response('Comanda não confirmada.', { status: 409 });
  if (!client?.dnp_photo_path) return new Response('Foto DNP não disponível.', { status: 404 });

  const image = await buildLaboratoryEyeImage(admin, {
    dnpPhotoPath: client.dnp_photo_path,
    dnpOd: client.dnp_od,
    dnpOe: client.dnp_oe,
    heightOd: fulfillment.measure_height_od,
    heightOe: fulfillment.measure_height_oe
  });
  if (!image) return new Response('Não foi possível gerar a imagem.', { status: 500 });

  return new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store'
    }
  });
}
