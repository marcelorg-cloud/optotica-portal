import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// "Ordem de exibição das cores" (15/09/2026, card novo no final da página
// de cadastro do produto — pedido do usuário): arrastar as cores ATIVAS
// nesse card e clicar "Salvar" manda aqui a lista completa de ids na ordem
// escolhida; grava um inteiro sequencial (1, 2, 3...) em `display_order`
// pra cada uma. Só recebe ids de cores ATIVAS deste produto — cores ocultas
// não aparecem no card, então não fazem parte do corpo desta chamada, e o
// `display_order` delas fica como estava (não afeta nada visível enquanto
// permanecerem ocultas).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const rawIds: unknown[] = Array.isArray(body?.orderedColorImageIds) ? body.orderedColorImageIds : [];
  const orderedColorImageIds: string[] | null = rawIds.length ? rawIds.filter((id): id is string => typeof id === 'string') : null;
  if (!orderedColorImageIds || !orderedColorImageIds.length) {
    return NextResponse.json({ message: 'Nenhuma ordem informada.' }, { status: 400 });
  }

  // Confere que TODOS os ids realmente pertencem a este produto antes de
  // gravar qualquer coisa — evita que um id de outro produto (por engano,
  // ou uma tela desatualizada) mude a ordem de uma cor que não devia.
  const { data: existing } = await auth.admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('product_id', productId)
    .in('id', orderedColorImageIds);
  const existingIds = new Set((existing || []).map((r) => r.id));
  if (existingIds.size !== orderedColorImageIds.length || orderedColorImageIds.some((id) => !existingIds.has(id))) {
    return NextResponse.json({ message: 'Alguma cor informada não pertence a este produto — atualize a página e tente de novo.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const results = await Promise.all(
    orderedColorImageIds.map((id, index) =>
      auth.admin.from('catalog_product_color_images').update({ display_order: index + 1, updated_at: now }).eq('id', id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error('catalog_color_reorder_failed', { message: failed.error?.message });
    return NextResponse.json({ message: 'Não foi possível salvar a nova ordem.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Ordem de exibição salva.' });
}
