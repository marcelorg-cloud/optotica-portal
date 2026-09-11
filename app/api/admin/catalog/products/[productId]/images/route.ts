import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Cria uma cor nova para um produto (ex.: "Adicionar foto" na tela de
// detalhe, ou uma cor que a Fila de Importação ainda não cobre — ver nota
// no documento do projeto sobre essa tela ficar para depois). O upload do
// arquivo em si acontece em duas etapas, igual à biblioteca de preços do
// laboratório (seção 0.21/correção de 11/09/2026): 1) esta rota confirma
// que o objeto já chegou no Storage antes de gravar a linha; o pedido da
// URL assinada é feito em .../images/upload-url.
//
// Sem foto (originalImagePath vazio): entra como 'incompleto', mesma regra
// da migração — não passa pelo pipeline de IA até alguém completar.

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin.from('catalog_products').select('id').eq('id', productId).maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const colorName = typeof body?.colorName === 'string' ? body.colorName.trim().slice(0, 80) : '';
  const supplierSku = typeof body?.supplierSku === 'string' ? body.supplierSku.trim().slice(0, 80) || null : null;
  const originalImagePath = typeof body?.originalImagePath === 'string' ? body.originalImagePath : '';

  if (!colorName) return NextResponse.json({ message: 'Informe o nome da cor.' }, { status: 400 });

  const expectedPrefix = `${productId}/`;
  if (originalImagePath && !originalImagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
  }
  if (originalImagePath) {
    const { error: signError } = await auth.admin.storage.from('catalog-product-photos').createSignedUrl(originalImagePath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from('catalog_product_color_images')
    .insert({
      product_id: productId,
      color_name: colorName,
      supplier_sku: supplierSku,
      original_image_path: originalImagePath || null,
      status: originalImagePath ? 'pendente' : 'incompleto',
      missing_required_fields: originalImagePath ? [] : ['foto_real_por_cor']
    })
    .select('id')
    .single();
  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json({ message: duplicate ? 'Este produto já tem uma cor com este nome.' : 'Não foi possível criar a cor.' }, { status: duplicate ? 409 : 500 });
  }

  return NextResponse.json({ message: 'Cor adicionada.', id: data.id });
}
