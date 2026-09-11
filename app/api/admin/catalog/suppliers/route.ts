import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fornecedor (Especificação — Painel de Catálogo, seção 2): curadoria
// fechada, só o usuário master libera/remove uma loja do AliExpress. Sem
// limite fixo de quantos fornecedores podem existir.

const clean = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data, error } = await auth.admin
    .from('catalog_suppliers')
    .select('id, name, store_id, seller_id, status, notes, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ message: 'Não foi possível carregar os fornecedores.' }, { status: 500 });

  return NextResponse.json({ suppliers: data || [] });
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const name = clean(body?.name, 140);
  const storeId = clean(body?.storeId, 40);
  const sellerId = clean(body?.sellerId, 40) || null;
  const notes = clean(body?.notes, 500) || null;

  if (name.length < 2 || !storeId) {
    return NextResponse.json({ message: 'Informe o nome da loja e o Store ID (número da loja no AliExpress, visível em "Informações da loja").' }, { status: 400 });
  }

  // upsert por store_id (constraint única na migração 202609110020) — reenviar
  // o mesmo Store ID atualiza o cadastro em vez de duplicar.
  const { data, error } = await auth.admin
    .from('catalog_suppliers')
    .upsert(
      { name, store_id: storeId, seller_id: sellerId, notes, status: 'liberado', added_by: auth.userId, updated_at: new Date().toISOString() },
      { onConflict: 'store_id' }
    )
    .select('id')
    .single();
  if (error) return NextResponse.json({ message: 'Não foi possível salvar o fornecedor.' }, { status: 500 });

  return NextResponse.json({ message: 'Fornecedor liberado.', id: data.id });
}

export async function PATCH(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status === 'removido' ? 'removido' : body?.status === 'liberado' ? 'liberado' : '';
  if (!id || !status) return NextResponse.json({ message: 'Informe o fornecedor e o novo status.' }, { status: 400 });

  // Remover um fornecedor não apaga nada (produtos/pedidos já existentes
  // continuam íntegros, por causa do "on delete restrict" da migração) — só
  // impede que novos produtos sejam importados dele, verificado na rota de
  // importação de produto (não incluída neste pacote).
  const { error } = await auth.admin.from('catalog_suppliers').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ message: 'Não foi possível atualizar o fornecedor.' }, { status: 500 });

  return NextResponse.json({ message: 'Fornecedor atualizado.' });
}
