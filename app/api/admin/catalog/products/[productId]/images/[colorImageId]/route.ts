import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fila de Aprovação IA (Especificação — Painel de Catálogo, seção 5): o
// master valida ou rejeita manualmente cada imagem por cor depois do
// processamento de IA (remoção de fundo/hastes). Uma imagem "incompleto"
// (campo obrigatório não veio na importação, ex.: sem foto real por cor) não
// pode ser validada até alguém completar os campos que faltam — por isso o
// action 'validar' checa status atual antes de aceitar.

const ACTIONS = ['validar', 'rejeitar', 'completar', 'trocar_foto', 'definir_referencia_cor'] as const;
type Action = typeof ACTIONS[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const action = ACTIONS.includes(body?.action) ? (body.action as Action) : null;
  if (!action) return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 });

  const { data: image } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, status, missing_required_fields')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!image) return NextResponse.json({ message: 'Imagem não encontrada.' }, { status: 404 });

  const now = new Date().toISOString();

  if (action === 'completar') {
    // Uso: quando o master sobe manualmente o campo que faltou (ex.: uma foto
    // real da cor, substituindo o ícone de amostra que veio da importação) —
    // o upload do arquivo em si fica fora desta rota (Storage), aqui só se
    // registra que o campo deixou de faltar e o item sai de "incompleto"
    // para "pendente" (ainda precisa passar pela validação normal).
    if (image.status !== 'incompleto') {
      return NextResponse.json({ message: 'Este item não está marcado como incompleto.' }, { status: 409 });
    }
    const remainingFields = Array.isArray(body?.stillMissing) ? body.stillMissing.filter((f: unknown) => typeof f === 'string') : [];
    // originalImagePath: uso real de hoje (11/09/2026) — "Adicionar foto" na
    // tela de detalhe do produto sobe a foto real que faltou (o caso comum
    // registrado na migração: anúncio só trazia amostra de cor, sem foto de
    // produto). Confirma que o objeto chegou no Storage antes de gravar,
    // mesmo padrão da rota de criação de cor (.../images, POST).
    const originalImagePath = typeof body?.originalImagePath === 'string' ? body.originalImagePath : undefined;
    if (originalImagePath) {
      if (!originalImagePath.startsWith(`${productId}/`)) {
        return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
      }
      const { error: signError } = await auth.admin.storage.from('catalog-product-photos').createSignedUrl(originalImagePath, 60);
      if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });
    }
    const { error } = await auth.admin
      .from('catalog_product_color_images')
      .update({
        status: remainingFields.length ? 'incompleto' : 'pendente',
        missing_required_fields: remainingFields,
        original_image_path: originalImagePath,
        processed_image_path: typeof body?.processedImagePath === 'string' ? body.processedImagePath : undefined,
        updated_at: now
      })
      .eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível atualizar a imagem.' }, { status: 500 });
    return NextResponse.json({ message: remainingFields.length ? 'Ainda faltam campos.' : 'Completo — pronto para validação.' });
  }

  if (action === 'trocar_foto') {
    // Pedido do usuário (12/09/2026): a foto importada automaticamente do
    // AliExpress (rota .../import-photo) às vezes é a amostra errada — de
    // lado, por exemplo, em vez da de frente que a prova online precisa.
    // Diferente de 'completar' (só usada pra sair de "incompleto"), esta
    // ação troca a foto original de uma cor que JÁ tem foto (pendente,
    // validada ou rejeitada) — sempre volta pra 'pendente' porque a foto
    // mudou e precisa passar pela validação/reprocessamento de novo.
    if (image.status === 'incompleto') {
      return NextResponse.json({ message: 'Esta cor ainda não tem foto — use "Adicionar foto" ou "Importar do AliExpress".' }, { status: 409 });
    }
    const originalImagePath = typeof body?.originalImagePath === 'string' ? body.originalImagePath : '';
    if (!originalImagePath || !originalImagePath.startsWith(`${productId}/`)) {
      return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
    }
    const { error: signError } = await auth.admin.storage.from('catalog-product-photos').createSignedUrl(originalImagePath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });

    const { error } = await auth.admin
      .from('catalog_product_color_images')
      .update({
        status: 'pendente',
        original_image_path: originalImagePath,
        processed_image_path: null,
        processed_at: null,
        validated_by: null,
        validated_at: null,
        rejection_reason: null,
        updated_at: now
      })
      .eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível trocar a foto.' }, { status: 500 });
    return NextResponse.json({ message: 'Foto trocada — pronta para "Processar com IA" de novo.' });
  }

  if (action === 'definir_referencia_cor') {
    // Envio manual da foto de referência de cor (pedido do usuário,
    // 13/09/2026 — ver migração 202609130008). Independente do status atual
    // da posição (funciona mesmo em 'incompleto', já que as duas fotos são
    // escolhidas em paralelo) — mas invalida qualquer processamento/
    // validação anterior, porque a cor final depende desta foto.
    const colorReferenceImagePath = typeof body?.colorReferenceImagePath === 'string' ? body.colorReferenceImagePath : '';
    if (!colorReferenceImagePath || !colorReferenceImagePath.startsWith(`${productId}/`)) {
      return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
    }
    const { error: signError } = await auth.admin.storage.from('catalog-product-photos').createSignedUrl(colorReferenceImagePath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });

    const patch: Record<string, unknown> = {
      color_reference_image_path: colorReferenceImagePath,
      processed_image_path: null,
      processed_at: null,
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
      updated_at: now
    };
    if (image.status === 'validada' || image.status === 'rejeitada') {
      patch.status = 'pendente';
    }
    const { error } = await auth.admin.from('catalog_product_color_images').update(patch).eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível salvar a referência de cor.' }, { status: 500 });
    return NextResponse.json({ message: 'Referência de cor salva — pronta para "Processar com IA".' });
  }

  if (image.status === 'incompleto') {
    return NextResponse.json({ message: 'Complete os campos obrigatórios antes de validar ou rejeitar.' }, { status: 409 });
  }

  if (action === 'validar') {
    const { error } = await auth.admin
      .from('catalog_product_color_images')
      .update({ status: 'validada', validated_by: auth.userId, validated_at: now, rejection_reason: null, updated_at: now })
      .eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível validar a imagem.' }, { status: 500 });
    return NextResponse.json({ message: 'Imagem validada.' });
  }

  // action === 'rejeitar'
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) return NextResponse.json({ message: 'Informe o motivo da rejeição.' }, { status: 400 });
  const { error } = await auth.admin
    .from('catalog_product_color_images')
    .update({ status: 'rejeitada', validated_by: auth.userId, validated_at: now, rejection_reason: reason, updated_at: now })
    .eq('id', colorImageId);
  if (error) return NextResponse.json({ message: 'Não foi possível rejeitar a imagem.' }, { status: 500 });
  return NextResponse.json({ message: 'Imagem rejeitada.' });
}
