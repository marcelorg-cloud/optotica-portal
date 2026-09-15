import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fotos de exibição desta cor — 4ª versão do significado (15/09/2026, ver
// estado-consolidado.md seção 0.67): a recolorização por IA saiu de vez, e
// junto com ela o teto de 4 fotos por cor (agora TODAS as fotos marcadas
// pra essa cor, mais a própria "Foto da cor", podem virar fotos de
// exibição — ver process/route.ts). `position` continua existindo só como
// ORDEM (a partir de agora reordenável manualmente pelo master, ver ação
// `moveTo` no PATCH abaixo), sem mais nenhum teto de 1 a 4.
//
// DELETE aceita `id` (preferível — sem ambiguidade) ou `position` (mantido
// por compatibilidade com quem já chamava assim).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' && body.id ? body.id : null;
  const position = Number(body?.position);
  const hasValidPosition = Number.isInteger(position) && position >= 1;
  if (!id && !hasValidPosition) {
    return NextResponse.json({ message: 'Informe qual foto remover (id ou posição inválidos).' }, { status: 400 });
  }

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  let query = auth.admin.from('catalog_product_color_display_images').delete().eq('color_image_id', colorImageId);
  query = id ? query.eq('id', id) : query.eq('position', position);
  const { error } = await query;
  if (error) return NextResponse.json({ message: 'Não foi possível remover esta foto.' }, { status: 500 });

  return NextResponse.json({ message: 'Foto removida.' });
}

// Validar uma foto de exibição (13/09/2026, migração 202609131400 — botão
// "Validar" do mockup, hoje aberto a partir do popup de ampliar a foto): o
// master confere visualmente cada foto processada pela IA e marca como
// conferida — ela então passa a aparecer na coluna esquerda ("Outras fotos
// validadas para o catálogo").
//
// `undo: true` (15/09/2026, botão "Desfazer última ação"): mesma rota, mas
// LIMPA validated_at/validated_by em vez de marcar — só usada pelo
// "desfazer" logo depois de clicar "Validar" por engano, nunca por um botão
// visível na tela.
//
// `moveTo` (15/09/2026, reordenação manual do catálogo): em vez de
// validar/desfazer, troca a posição da foto em `position` com a foto que
// estiver em `moveTo` (as duas precisam já existir para esta cor) — usa uma
// posição temporária fora de qualquer faixa real pra nunca colidir com o
// índice único (color_image_id, position) no meio da troca.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const position = Number(body?.position);
  if (!Number.isInteger(position) || position < 1) {
    return NextResponse.json({ message: 'Posição inválida.' }, { status: 400 });
  }

  if (body?.moveTo !== undefined) {
    const moveTo = Number(body.moveTo);
    if (!Number.isInteger(moveTo) || moveTo < 1 || moveTo === position) {
      return NextResponse.json({ message: 'Posição de destino inválida.' }, { status: 400 });
    }
    const { data: rows } = await auth.admin
      .from('catalog_product_color_display_images')
      .select('id, position')
      .eq('color_image_id', colorImageId)
      .in('position', [position, moveTo]);
    const rowA = rows?.find((r) => r.position === position);
    const rowB = rows?.find((r) => r.position === moveTo);
    if (!rowA || !rowB) return NextResponse.json({ message: 'Alguma das fotos não foi encontrada.' }, { status: 404 });

    const tempPosition = 1_000_000 + position;
    const { error: e1 } = await auth.admin.from('catalog_product_color_display_images').update({ position: tempPosition }).eq('id', rowA.id);
    if (e1) return NextResponse.json({ message: 'Não foi possível reordenar.' }, { status: 500 });
    const { error: e2 } = await auth.admin.from('catalog_product_color_display_images').update({ position }).eq('id', rowB.id);
    if (e2) return NextResponse.json({ message: 'Não foi possível reordenar.' }, { status: 500 });
    const { error: e3 } = await auth.admin.from('catalog_product_color_display_images').update({ position: moveTo }).eq('id', rowA.id);
    if (e3) return NextResponse.json({ message: 'Não foi possível reordenar.' }, { status: 500 });
    return NextResponse.json({ message: 'Ordem atualizada.' });
  }

  const undo = body?.undo === true;
  const { error } = await auth.admin
    .from('catalog_product_color_display_images')
    .update(undo ? { validated_at: null, validated_by: null } : { validated_at: new Date().toISOString(), validated_by: auth.userId })
    .eq('color_image_id', colorImageId)
    .eq('position', position);
  if (error) return NextResponse.json({ message: undo ? 'Não foi possível desfazer.' : 'Não foi possível validar esta foto.' }, { status: 500 });

  return NextResponse.json({ message: undo ? 'Validação desfeita.' : 'Foto validada.' });
}

// Restaurar o conjunto INTEIRO de fotos de exibição desta cor (15/09/2026,
// botão "Desfazer última ação"): substitui tudo que está salvo agora pelo
// conjunto exato enviado — usada pra desfazer "Remover" (manda de volta o
// conjunto de antes, com a foto removida de novo dentro dele). Sem teto de
// posição (antes 1 a 4) — só exige posição positiva. Só usada pelo
// "desfazer" — nunca por um botão normal na tela.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const rawImages: unknown = body?.images;
  const images: { position: number; imagePath: string; validatedAt: string | null; source: 'galeria_recortada' | 'foto_da_cor_recortada'; sourceGalleryImageId: string | null; fromOwnColorPhoto: boolean }[] = Array.isArray(rawImages)
    ? rawImages
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
        .map((r) => ({
          position: Number(r.position),
          imagePath: String(r.imagePath || ''),
          validatedAt: typeof r.validatedAt === 'string' ? r.validatedAt : null,
          source: r.source === 'foto_da_cor_recortada' ? 'foto_da_cor_recortada' as const : 'galeria_recortada' as const,
          sourceGalleryImageId: typeof r.sourceGalleryImageId === 'string' ? r.sourceGalleryImageId : null,
          fromOwnColorPhoto: r.fromOwnColorPhoto === true
        }))
        .filter((r) => Number.isInteger(r.position) && r.position >= 1 && r.imagePath)
    : [];

  const { error: deleteError } = await auth.admin
    .from('catalog_product_color_display_images')
    .delete()
    .eq('color_image_id', colorImageId);
  if (deleteError) return NextResponse.json({ message: 'Não foi possível desfazer.' }, { status: 500 });

  if (images.length) {
    const rows = images.map((img) => ({
      color_image_id: colorImageId,
      position: img.position,
      source: img.source,
      image_path: img.imagePath,
      validated_at: img.validatedAt,
      source_gallery_image_id: img.sourceGalleryImageId,
      from_own_color_photo: img.fromOwnColorPhoto
    }));
    const { error: insertError } = await auth.admin.from('catalog_product_color_display_images').insert(rows);
    if (insertError) return NextResponse.json({ message: 'Não foi possível desfazer.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Fotos de exibição restauradas.' });
}
