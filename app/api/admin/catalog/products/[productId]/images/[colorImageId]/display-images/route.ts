import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Remover uma foto de exibição sugerida automaticamente (13/09/2026,
// migração 202609131200): a posição 1 (a foto tratada) nunca é removível
// por aqui — ela só muda reprocessando a cor. As posições 2-4 vieram de
// uma sugestão automática por semelhança de cor (lib/catalog/color-swatch.ts)
// e podem estar erradas — o master remove aqui se a foto não bater com a
// cor de verdade (mesmo cuidado já registrado na migração da galeria geral:
// mostrar uma foto errada é pior do que mostrar uma a menos).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const position = Number(body?.position);
  if (!Number.isInteger(position) || position < 2 || position > 4) {
    return NextResponse.json({ message: 'Só é possível remover as fotos extras (posições 2 a 4) — a foto tratada muda reprocessando a cor.' }, { status: 400 });
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
