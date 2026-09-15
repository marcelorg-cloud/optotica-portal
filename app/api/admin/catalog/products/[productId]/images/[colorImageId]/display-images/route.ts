import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { cropGalleryPhoto } from '@/lib/catalog/gallery-photo-crop';

const BUCKET = 'catalog-product-photos';

// Aumenta o tempo limite da função (padrão da Vercel costuma ser curto
// demais — herdado do antigo process/route.ts): o recorte por IA
// (Replicate) de até 4 fotos, uma de cada vez, pode passar do limite padrão.
export const maxDuration = 60;

// Fotos de exibição desta cor (13/09/2026, migração 202609131200 — 3ª
// versão do significado depois da migração 202609131400, "Substitui — só
// marcação manual daqui pra frente"): não existe mais posição especial —
// hoje as posições 1 a 4 são só a ordem das fotos que o master marcou (na
// seção "Todas as fotos do anúncio") e que o POST abaixo recorta pra esta
// cor. Por isso o DELETE aqui aceita qualquer posição de 1 a 4 (antes só
// aceitava 2 a 4, porque a posição 1 era reservada pra foto tratada da
// prova online — isso não existe mais nesta tabela: a prova online agora
// vive só em catalog_product_color_images.processed_image_path, intocada
// por esta rota).
//
// "Gerar fotos de exibição" (14/09/2026, pedido do usuário — seção 0.62 do
// estado consolidado): este POST é o antigo passo 2 do extinto "Processar
// com IA" (app/api/.../images/[colorImageId]/process/route.ts, removido) —
// só o recorte por IA (lib/catalog/gallery-photo-crop.ts) das fotos gerais
// do anúncio já marcadas manualmente para esta cor. A recolorização por IA
// (passo 1 do antigo "Processar com IA") não existe mais: a foto
// tratada/prova online agora é sempre um upload manual (ver PATCH
// 'enviar_oculos' em .../images/[colorImageId]/route.ts) — as duas coisas
// não têm nenhuma relação entre si.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, status')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  if (color.status === 'incompleto') {
    return NextResponse.json({ message: 'Complete os campos obrigatórios antes de gerar fotos de exibição.' }, { status: 409 });
  }

  // Fotos gerais do anúncio marcadas manualmente pelo master como sendo
  // desta cor — no máximo 4, na ordem em que aparecem na galeria geral.
  const { data: taggedGalleryImages } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('id, image_url, position, catalog_product_gallery_image_colors!inner(color_image_id)')
    .eq('product_id', productId)
    .eq('catalog_product_gallery_image_colors.color_image_id', colorImageId)
    .order('position', { ascending: true });

  const candidates = (taggedGalleryImages || []).slice(0, 4) as { id: string; image_url: string; position: number }[];
  if (!candidates.length) {
    return NextResponse.json({ message: 'Nenhuma foto marcada para esta cor em "Todas as fotos do anúncio" ainda.' }, { status: 409 });
  }

  // Orçamento de tempo (35s) interrompe as tentativas mais cedo se estiver
  // demorando, pra não estourar o limite da função (maxDuration acima) — o
  // que já tiver sido salvo até lá fica valendo, o resto só fica sem foto
  // extra (mesmo comportamento herdado do antigo process/route.ts).
  const GALLERY_STEP_BUDGET_MS = 35000;
  const startedAt = Date.now();

  // Recorte por IA, uma foto de cada vez, com orçamento de tempo — esta
  // conta do Replicate só aceita uma chamada por vez, nunca em paralelo.
  const accepted: { galleryImageId: string; buffer: Buffer }[] = [];
  for (const candidate of candidates) {
    if (Date.now() - startedAt > GALLERY_STEP_BUDGET_MS) break;
    try {
      const croppedBuffer = await cropGalleryPhoto(candidate.image_url);
      accepted.push({ galleryImageId: candidate.id, buffer: croppedBuffer });
    } catch (cropErr) {
      console.error('catalog_gallery_crop_failed', { message: cropErr instanceof Error ? cropErr.message : String(cropErr) });
    }
  }

  if (!accepted.length) {
    return NextResponse.json({ message: 'Não foi possível recortar nenhuma das fotos marcadas. Tente novamente.' }, { status: 502 });
  }

  await auth.admin.from('catalog_product_color_display_images').delete().eq('color_image_id', colorImageId);
  const uploads = await Promise.all(accepted.map(async (a, i) => {
    const path = `${productId}/display/${colorImageId}-${i + 1}.png`;
    const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, a.buffer, { contentType: 'image/png', upsert: true });
    return uploadError ? null : { path, galleryImageId: a.galleryImageId };
  }));
  const rows = uploads
    .map((u, i) => u && { color_image_id: colorImageId, position: i + 1, source: 'galeria_recortada' as const, image_path: u.path, source_gallery_image_id: u.galleryImageId })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  if (!rows.length) {
    return NextResponse.json({ message: 'As fotos foram recortadas, mas não foi possível salvá-las. Tente novamente.' }, { status: 500 });
  }
  const { error: insertError } = await auth.admin.from('catalog_product_color_display_images').insert(rows);
  if (insertError) {
    return NextResponse.json({ message: 'As fotos foram recortadas, mas não foi possível salvá-las. Tente novamente.' }, { status: 500 });
  }

  const warning = rows.length < accepted.length ? ' Algumas fotos extras não puderam ser recortadas — tente gerar de novo.' : '';
  return NextResponse.json({ message: `${rows.length} foto(s) de exibição gerada(s).${warning}` });
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const position = Number(body?.position);
  if (!Number.isInteger(position) || position < 1 || position > 4) {
    return NextResponse.json({ message: 'Posição inválida — só é possível remover as fotos de exibição desta cor (posições 1 a 4).' }, { status: 400 });
  }

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  const { error } = await auth.admin
    .from('catalog_product_color_display_images')
    .delete()
    .eq('color_image_id', colorImageId)
    .eq('position', position);
  if (error) return NextResponse.json({ message: 'Não foi possível remover esta foto.' }, { status: 500 });

  return NextResponse.json({ message: 'Foto removida.' });
}

// Validar uma foto de exibição (13/09/2026, migração 202609131400 — botão
// "Validar" do mockup): o master confere visualmente cada foto recortada
// pela IA (ver "Todas as fotos do anúncio"/cards de cor na tela) e marca
// como conferida. Não bloqueia nada no app do paciente por enquanto — é só
// um registro de "já olhei essa" pro master acompanhar o que falta revisar;
// se um dia isso precisar esconder fotos não validadas do app do paciente,
// é mudança de outra rodada.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const position = Number(body?.position);
  if (!Number.isInteger(position) || position < 1 || position > 4) {
    return NextResponse.json({ message: 'Posição inválida.' }, { status: 400 });
  }

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  const { error } = await auth.admin
    .from('catalog_product_color_display_images')
    .update({ validated_at: new Date().toISOString(), validated_by: auth.userId })
    .eq('color_image_id', colorImageId)
    .eq('position', position);
  if (error) return NextResponse.json({ message: 'Não foi possível validar esta foto.' }, { status: 500 });

  return NextResponse.json({ message: 'Foto validada.' });
}
