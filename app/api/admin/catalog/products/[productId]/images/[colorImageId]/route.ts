import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fila de Aprovação (Especificação — Painel de Catálogo, seção 5): o
// master valida ou rejeita manualmente cada imagem por cor depois que a
// foto tratada da prova online estiver pronta — seja pelo "Processar com
// IA" (recolorização automática, action separada em .../process/route.ts)
// ou por upload manual do óculos já pronto (ação 'enviar_oculos', abaixo —
// 14/09/2026, seção 0.62, adicionada como MAIS uma opção, sem remover o
// processamento por IA). Uma imagem "incompleto" (campo obrigatório não
// veio na importação, ex.: sem foto real por cor) não pode ser validada até
// alguém completar os campos que faltam — por isso o action 'validar' checa
// status atual antes de aceitar.

// 'restaurar' (15/09/2026, botão "Desfazer última ação"): ação interna, sem
// botão próprio na tela — usada só pelo "desfazer" pra escrever de volta,
// SEM as regras de negócio das outras ações, os valores exatos que a linha
// tinha antes da última ação (capturados no navegador antes de cada ação
// mudar algo). Nunca chamada com dado vindo de fora do próprio "desfazer".
// 'ativar'/'ocultar' (15/09/2026, pedido do usuário a partir de um print
// anotado): controla se esta cor pode aparecer nos fronts do profissional
// (Etapa 3 "Escolha da armação", seção 0.71) e do paciente (lista de prova
// online) — independente do `status` de processamento/validação da foto.
// Ver migração 202609151700 (coluna `is_active`, nasce `false` em TODAS as
// cores, novas e já existentes).
const ACTIONS = ['validar', 'rejeitar', 'completar', 'trocar_foto', 'enviar_oculos', 'ativar', 'ocultar', 'restaurar'] as const;
type Action = typeof ACTIONS[number];
const BUCKET = 'catalog-product-photos';

// Campos que 'restaurar' pode escrever de volta — sempre um subconjunto
// fechado (nunca todo o body repassado direto pro update), pra nunca virar
// uma porta pra escrever coluna arbitrária na tabela.
const RESTORABLE_FIELDS = [
  'status',
  'originalImagePath',
  'processedImagePath',
  'processedAt',
  'validatedBy',
  'validatedAt',
  'rejectionReason',
  'missingRequiredFields',
  'isActive'
] as const;
const RESTORABLE_COLUMN_BY_FIELD: Record<typeof RESTORABLE_FIELDS[number], string> = {
  status: 'status',
  originalImagePath: 'original_image_path',
  processedImagePath: 'processed_image_path',
  processedAt: 'processed_at',
  validatedBy: 'validated_by',
  validatedAt: 'validated_at',
  rejectionReason: 'rejection_reason',
  missingRequiredFields: 'missing_required_fields',
  isActive: 'is_active'
};

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
    // mudou e precisa passar pela validação de novo.
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

  if (action === 'enviar_oculos') {
    // "Enviar Óculos da Prova Online" (14/09/2026, pedido do usuário — seção
    // 0.62): alternativa MANUAL ao "Processar com IA" (que continua
    // existindo em .../process/route.ts) — as duas escrevem na mesma coluna
    // `processed_image_path`. Uso: quando a recolorização automática não
    // fica boa o suficiente, o master pode subir aqui um PNG já pronto
    // (recortado e colorido fora do sistema) na mesma medida. Não muda
    // `status` (pode enviar de novo numa cor já 'validada', mesmo padrão de
    // "reprocessar" que já existia) nem mexe em nenhum outro campo — a
    // "Frente Total (mm)" (lida do nome do arquivo, no navegador) é gravada
    // à parte, pelo componente, num PATCH comum em .../products/[productId]
    // (campo de produto, compartilhado por todas as cores — não tem uma
    // cópia por cor aqui).
    if (image.status === 'incompleto') {
      return NextResponse.json({ message: 'Esta cor ainda não tem foto — use "Adicionar foto" ou "Importar do AliExpress" antes.' }, { status: 409 });
    }
    const processedImagePath = typeof body?.processedImagePath === 'string' ? body.processedImagePath : '';
    if (!processedImagePath || !processedImagePath.startsWith(`${productId}/`)) {
      return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
    }
    const { error: signError } = await auth.admin.storage.from(BUCKET).createSignedUrl(processedImagePath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos o arquivo enviado. Tente enviar de novo.' }, { status: 400 });

    const { error } = await auth.admin
      .from('catalog_product_color_images')
      .update({ processed_image_path: processedImagePath, processed_at: now, updated_at: now })
      .eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível salvar o óculos da prova online.' }, { status: 500 });
    return NextResponse.json({ message: 'Óculos da prova online salvo.' });
  }

  if (action === 'ativar' || action === 'ocultar') {
    // Sem exigência de status — mesmo uma cor 'incompleto' ou 'pendente'
    // pode ser ativada/ocultada (o front que consome `is_active` também
    // confere se tem foto de verdade antes de mostrar algo útil; aqui é só
    // a "chave geral" de aparecer ou não).
    const { error } = await auth.admin
      .from('catalog_product_color_images')
      .update({ is_active: action === 'ativar', updated_at: now })
      .eq('id', colorImageId);
    if (error) return NextResponse.json({ message: `Não foi possível ${action === 'ativar' ? 'ativar' : 'ocultar'} esta cor.` }, { status: 500 });
    return NextResponse.json({ message: action === 'ativar' ? 'Cor ativada — já pode aparecer nos fronts.' : 'Cor ocultada — não aparece mais em nenhum front.' });
  }

  if (action === 'restaurar') {
    const snapshot = body?.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
    if (!snapshot) return NextResponse.json({ message: 'Nada para restaurar.' }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: now };
    for (const field of RESTORABLE_FIELDS) {
      if (!(field in snapshot)) continue;
      const value = (snapshot as Record<string, unknown>)[field];
      if (field === 'missingRequiredFields' && value !== null && !Array.isArray(value)) continue;
      patch[RESTORABLE_COLUMN_BY_FIELD[field]] = value;
    }
    if (Object.keys(patch).length === 1) return NextResponse.json({ message: 'Nada para restaurar.' }, { status: 400 });

    const { error } = await auth.admin.from('catalog_product_color_images').update(patch).eq('id', colorImageId);
    if (error) return NextResponse.json({ message: 'Não foi possível desfazer.' }, { status: 500 });
    return NextResponse.json({ message: 'Ação desfeita.' });
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

// Apagar uma cor. Existia desde 15/09/2026 só como uso interno do "Desfazer
// última ação" (logo depois de criar uma cor por engano) — a partir de
// 15/09/2026 (2ª rodada do dia, seção 0.74) passou a ser exposta também como
// o botão de lixeira normal da tela (pedido do usuário), pra apagar de vez o
// cadastro de uma cor específica, mesmo já em uso. Apaga só o REGISTRO no
// banco — os arquivos de imagem no Storage NÃO são apagados (decisão
// explícita do usuário: mais seguro, sem risco de perder foto por engano).
// ON DELETE CASCADE cuida de catalog_product_color_display_images e
// catalog_product_gallery_image_colors desta cor; order_frames/
// order_frame_reactions que já apontavam pra esta cor (migração
// 202609151600) ficam com a referência zerada (ON DELETE SET NULL /
// CASCADE), sem apagar o texto já congelado da escolha de armação de
// pedidos existentes (frame_name/color continuam gravados como texto).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { error } = await auth.admin
    .from('catalog_product_color_images')
    .delete()
    .eq('id', colorImageId)
    .eq('product_id', productId);
  if (error) return NextResponse.json({ message: 'Não foi possível apagar a cor.' }, { status: 500 });

  return NextResponse.json({ message: 'Cor removida.' });
}
