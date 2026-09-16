import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { type Point } from '@/lib/tryon/geometry';
import { composeTryonImage } from '@/lib/tryon/compose-server';
import { tryonRevision } from '@/lib/tryon/revision';

// Etapa 3 do atendimento ("Escolha da armação", 15/09/2026) — gera a MESMA
// composição "rosto do paciente + óculos" que a área do próprio paciente já
// gera em /api/client/tryon/compose (mesma função compartilhada,
// lib/tryon/compose-server.ts, e a MESMA tabela `catalog_patient_display_images`
// como resultado) — só que disparada pelo profissional, ao trocar de cor no
// card da armação (components/order/frame-step.tsx), sem depender do
// paciente estar logado na área dele. Se qualquer um dos dois lados já tiver
// gerado essa combinação produto+cor antes, o outro lado reaproveita o
// mesmo arquivo — nunca gera duas vezes.
//
// A detecção das pupilas (lib/dnp-vision.ts) só roda no navegador — por isso
// o profissional manda aqui o pixel das duas pupilas + ponto nasal + o
// tamanho do canvas em que mediu (mesmo contrato da rota do paciente).

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === 'object' && typeof (value as Point).x === 'number' && typeof (value as Point).y === 'number';
}

type ColorRow = {
  product_id: string;
  color_name: string;
  processed_image_path: string | null;
  status: string;
  is_active: boolean;
  catalog_products: { lens_width_mm: number | null; frame_total_width_mm: number | null; status: string } | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, organization_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { data: client } = await admin.from('clients').select('dnp_od, dnp_oe, dnp_measured_at, tryon_face_validated_at').eq('id', order.client_id).maybeSingle();
  if (!client || client.dnp_od == null || client.dnp_oe == null) {
    return NextResponse.json({ message: 'A DNP do paciente ainda não foi medida na Etapa 1.' }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const sourceRevision = tryonRevision(client);
  if (body?.sourceRevision !== sourceRevision) {
    return NextResponse.json({ message: 'A DNP ou a foto mudou. Atualize a página para gerar a prova atual.' }, { status: 409 });
  }
  const catalogColorImageId = typeof body?.catalogColorImageId === 'string' ? body.catalogColorImageId : '';
  const photoWidth = Number(body?.photoWidth);
  const photoHeight = Number(body?.photoHeight);
  if (!catalogColorImageId || !isPoint(body?.pupilA) || !isPoint(body?.pupilB) || !Number.isFinite(photoWidth) || !Number.isFinite(photoHeight) || photoWidth <= 0 || photoHeight <= 0) {
    return NextResponse.json({ message: 'Dados de prova inválidos.' }, { status: 400 });
  }
  const pupilA = body.pupilA as Point;
  const pupilB = body.pupilB as Point;
  const nasalCenter = isPoint(body?.nasalCenter) ? (body.nasalCenter as Point) : undefined;

  const { data: color } = await admin
    .from('catalog_product_color_images')
    .select('product_id, color_name, processed_image_path, status, is_active, catalog_products!inner(lens_width_mm, frame_total_width_mm, status)')
    .eq('id', catalogColorImageId)
    .maybeSingle();
  const row = color as unknown as ColorRow | null;
  const product = row?.catalog_products;
  const frameWidthMm = product?.frame_total_width_mm || product?.lens_width_mm || null;
  // Mesmo conjunto de checagens da rota do paciente (status validada,
  // ativa, produto publicado, largura conhecida) — ver comentário lá.
  if (!row || row.status !== 'validada' || !row.is_active || !row.processed_image_path || !product || product.status !== 'publicado' || !frameWidthMm) {
    return NextResponse.json({ message: 'Esta cor não está disponível para prova.' }, { status: 404 });
  }

  const result = await composeTryonImage(admin, {
    organizationId: order.organization_id,
    clientId: order.client_id,
    dnpTotalMm: Number(client.dnp_od) + Number(client.dnp_oe),
    sourceRevision,
    productId: row.product_id,
    colorName: row.color_name,
    processedImagePath: row.processed_image_path,
    frameWidthMm: Number(frameWidthMm),
    pupilA,
    pupilB,
    nasalCenter,
    photoWidth,
    photoHeight
  });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  return NextResponse.json({ message: 'Prova gerada.', imageUrl: result.imageUrl });
}
