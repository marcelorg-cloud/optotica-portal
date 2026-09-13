import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fotos de exibição desta cor (13/09/2026, migração 202609131200 — 3ª
// versão do significado depois da migração 202609131400, "Substitui — só
// marcação manual daqui pra frente"): não existe mais posição especial —
// hoje as posições 1 a 4 são só a ordem das fotos que o master marcou (na
// seção "Todas as fotos do anúncio") e que a IA recortou pra esta cor (ver
// process/route.ts). Por isso o DELETE aqui aceita qualquer posição de 1 a
// 4 (antes só aceitava 2 a 4, porque a posição 1 era reservada pra foto
// tratada da prova online — isso não existe mais nesta tabela: a prova
// online agora vive só em catalog_product_color_images.processed_image_path,
// intocada por esta rota).
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
