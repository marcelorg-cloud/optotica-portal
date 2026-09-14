import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Pedido do usuário (14/09/2026): "quando clicar nesse botao seria bom que
// aparecesse o Json usado pela ultima vez" — em vez do master ter que ir de
// novo no AliExpress copiar a resposta da API toda vez que precisar
// reimportar/atualizar alguma coisa deste produto, guarda o texto cru do
// último JSON que foi analisado com sucesso ("Analisar JSON") e devolve
// aqui pra pré-encher a caixa de novo quando o painel "Importar/atualizar
// do AliExpress" é aberto (ver GET .../aliexpress-json). Migração
// 202609141500.
//
// Guarda só o TEXTO — nunca decide nada a partir dele aqui (quem decide é
// sempre o parse client-side, `lib/catalog/parse-aliexpress-json.ts`, ou a
// rota .../images/reset-photos quando o master pede pra resetar fotos).

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin
    .from('catalog_products')
    .select('last_aliexpress_import_json, last_aliexpress_import_at')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  return NextResponse.json({
    json: product.last_aliexpress_import_json || null,
    savedAt: product.last_aliexpress_import_at || null
  });
}

// Salva o texto cru do JSON depois de um "Analisar JSON" bem-sucedido na
// tela (não precisa ter clicado em "Importar" — só analisado já conta como
// "usado", pra sempre ter a versão mais recente que o master efetivamente
// olhou pronta pra da próxima vez). Chamada em segundo plano pela tela,
// sem bloquear a UI e sem mostrar erro se falhar (é só uma conveniência,
// nunca faz parte do fluxo obrigatório de importar/resetar fotos).
export async function PUT(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const json = typeof body?.json === 'string' ? body.json.slice(0, 2_000_000) : '';
  if (!json.trim()) return NextResponse.json({ message: 'JSON vazio.' }, { status: 400 });

  const { error } = await auth.admin
    .from('catalog_products')
    .update({ last_aliexpress_import_json: json, last_aliexpress_import_at: new Date().toISOString() })
    .eq('id', productId);
  if (error) {
    console.error('catalog_last_aliexpress_json_save_failed', { message: error.message });
    return NextResponse.json({ message: 'Não foi possível salvar o JSON.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'JSON salvo.' });
}
