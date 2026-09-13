import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { buildVariantName, isValidColor } from '@/lib/catalog/sku-standard';

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
//
// `sourceImageUrl` (13/09/2026, "colar JSON do AliExpress" na criação do
// produto): grava `source_image_url` — a mesma coluna que antes só era
// preenchida à mão via SQL (ver supabase/data/202609120005_...). Com ela
// já preenchida na criação, o botão "Importar do AliExpress" (que já existia
// pra completar cores 'incompleto') já funciona de primeira, sem precisar
// de nenhuma migração nova.
//
// Padrão de SKU/cor (13/09/2026, migração 202609131100): o master não digita
// mais o "nome da cor" — escolhe `colorPrincipal` (vocabulário fechado,
// obrigatório) e opcionalmente `colorSecondary`; `colorName` (a coluna de
// sempre, usada como identificador único por produto em outras tabelas —
// fila de compras, imagens de exibição da prova online) passa a ser GERADO
// automaticamente ("<nome do modelo> - Cor N"), nunca mais digitado. O
// número da variante (C1, C2...) é sempre o maior já usado neste produto +1
// — nunca reaproveitado, mesmo se uma cor for apagada depois.
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin.from('catalog_products').select('id, model_name').eq('id', productId).maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const colorPrincipal = typeof body?.colorPrincipal === 'string' ? body.colorPrincipal.trim() : '';
  const colorSecondary = typeof body?.colorSecondary === 'string' ? body.colorSecondary.trim() : '';
  const supplierColorName = typeof body?.supplierColorName === 'string' ? body.supplierColorName.trim().slice(0, 120) || null : null;
  const supplierSku = typeof body?.supplierSku === 'string' ? body.supplierSku.trim().slice(0, 80) || null : null;
  const originalImagePath = typeof body?.originalImagePath === 'string' ? body.originalImagePath : '';
  const sourceImageUrl = typeof body?.sourceImageUrl === 'string' && /^https:\/\//.test(body.sourceImageUrl) ? body.sourceImageUrl.slice(0, 2000) : null;

  if (!colorPrincipal || !isValidColor(colorPrincipal)) {
    return NextResponse.json({ message: 'Escolha uma cor principal válida da lista.' }, { status: 400 });
  }
  if (colorSecondary && !isValidColor(colorSecondary)) {
    return NextResponse.json({ message: 'Cor secundária inválida.' }, { status: 400 });
  }

  const expectedPrefix = `${productId}/`;
  if (originalImagePath && !originalImagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
  }
  if (originalImagePath) {
    const { error: signError } = await auth.admin.storage.from('catalog-product-photos').createSignedUrl(originalImagePath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });
  }

  const { data: existingVariants } = await auth.admin
    .from('catalog_product_color_images')
    .select('color_variant_number')
    .eq('product_id', productId);
  const nextVariantNumber = Math.max(0, ...(existingVariants || []).map((v) => v.color_variant_number || 0)) + 1;
  const colorName = buildVariantName(product.model_name, nextVariantNumber);

  const { data, error } = await auth.admin
    .from('catalog_product_color_images')
    .insert({
      product_id: productId,
      color_name: colorName,
      color_variant_number: nextVariantNumber,
      color_principal: colorPrincipal,
      color_secondary: colorSecondary || null,
      supplier_color_name: supplierColorName,
      supplier_sku: supplierSku,
      original_image_path: originalImagePath || null,
      source_image_url: sourceImageUrl,
      status: originalImagePath ? 'pendente' : 'incompleto',
      missing_required_fields: originalImagePath ? [] : ['foto_real_por_cor']
    })
    .select('id')
    .single();
  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json({ message: duplicate ? 'Conflito ao gerar a variante — tente novamente.' : 'Não foi possível criar a cor.' }, { status: duplicate ? 409 : 500 });
  }

  return NextResponse.json({ message: `Cor adicionada (Cor ${nextVariantNumber} — ${colorPrincipal}).`, id: data.id });
}
