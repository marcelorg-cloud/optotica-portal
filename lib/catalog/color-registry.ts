// Tabela global de cores (14/09/2026, migração 202609140100) — pedido do
// usuário depois de um bug real (mesmo modelo ganhou duas cores "Tartaruga"
// ao reimportar o JSON do AliExpress, C6 e C11): "C1, C2, C3 vai ser a
// mesma cor pra todos os óculos... não pode ter outro preto além de C1, a
// não ser que seja um preto diferente, com alguma particularidade".
//
// Antes desta mudança, o número da cor (C1, C2...) era só "o maior já
// usado neste PRODUTO + 1" — sem nenhuma checagem de que a cor já existia,
// daí o bug. Agora o número vem desta tabela global
// (`catalog_color_registry`): a mesma combinação de cor principal +
// secundária + eventual observação (ex.: "fosco") sempre usa o MESMO
// número, em qualquer modelo — e a rota que cria a cor (images/route.ts)
// passa a REJEITAR uma cor repetida no mesmo produto (ver checagem lá).
import type { SupabaseClient } from '@supabase/supabase-js';

export type ColorRegistryEntry = {
  id: string;
  colorNumber: number;
  colorPrincipal: string;
  colorSecondary: string | null;
  note: string | null;
};

type Admin = SupabaseClient;

/**
 * Busca a linha da tabela global que corresponde exatamente a esta
 * combinação (cor principal + secundária + observação) — ou cria uma nova,
 * se ainda não existir nenhuma. Nunca cria duas linhas pra mesma
 * combinação: se a busca não encontrar nada e a criação esbarrar num
 * conflito (duas chamadas ao mesmo tempo criando a mesma combinação), busca
 * de novo em vez de falhar — a linha que "ganhou a corrida" é a usada.
 */
export async function findOrCreateColorRegistryEntry(
  admin: Admin,
  colorPrincipal: string,
  colorSecondary: string | null,
  note: string | null
): Promise<{ ok: true; entry: ColorRegistryEntry } | { ok: false; message: string }> {
  const normalizedSecondary = colorSecondary?.trim() || null;
  const normalizedNote = note?.trim() || null;

  const existing = await queryRegistryEntry(admin, colorPrincipal, normalizedSecondary, normalizedNote);
  if (existing) return { ok: true, entry: existing };

  const { data: colorNumber, error: seqError } = await admin.rpc('next_catalog_color_number');
  if (seqError || typeof colorNumber !== 'number') {
    console.error('catalog_next_color_number_failed', { message: seqError?.message });
    return { ok: false, message: 'Não foi possível gerar o número da cor.' };
  }

  const { data: inserted, error: insertError } = await admin
    .from('catalog_color_registry')
    .insert({
      color_number: colorNumber,
      color_principal: colorPrincipal,
      color_secondary: normalizedSecondary,
      note: normalizedNote
    })
    .select('id, color_number, color_principal, color_secondary, note')
    .single();

  if (insertError) {
    // 23505 = conflito de unicidade — outra chamada criou a mesma
    // combinação entre a busca acima e este insert; busca de novo em vez de
    // falhar (a linha da outra chamada é a que vale).
    if (insertError.code === '23505') {
      const retried = await queryRegistryEntry(admin, colorPrincipal, normalizedSecondary, normalizedNote);
      if (retried) return { ok: true, entry: retried };
    }
    console.error('catalog_color_registry_insert_failed', { message: insertError.message });
    return { ok: false, message: 'Não foi possível registrar esta cor na tabela global.' };
  }

  return {
    ok: true,
    entry: {
      id: inserted.id,
      colorNumber: inserted.color_number,
      colorPrincipal: inserted.color_principal,
      colorSecondary: inserted.color_secondary,
      note: inserted.note
    }
  };
}

async function queryRegistryEntry(
  admin: Admin,
  colorPrincipal: string,
  colorSecondary: string | null,
  note: string | null
): Promise<ColorRegistryEntry | null> {
  // `.eq('col', null)` não funciona como se espera no PostgREST (precisa de
  // `.is()` pra NULL) — por isso a montagem condicional abaixo, em vez de
  // só encadear `.eq()` pros três campos.
  let query = admin.from('catalog_color_registry').select('id, color_number, color_principal, color_secondary, note').eq('color_principal', colorPrincipal);
  query = colorSecondary ? query.eq('color_secondary', colorSecondary) : query.is('color_secondary', null);
  query = note ? query.eq('note', note) : query.is('note', null);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    colorNumber: data.color_number,
    colorPrincipal: data.color_principal,
    colorSecondary: data.color_secondary,
    note: data.note
  };
}

/** true se este produto já tem uma cor usando exatamente esta linha da tabela global. */
export async function productAlreadyHasColorRegistryEntry(admin: Admin, productId: string, colorRegistryId: string): Promise<boolean> {
  const { data } = await admin
    .from('catalog_product_color_images')
    .select('id')
    .eq('product_id', productId)
    .eq('color_registry_id', colorRegistryId)
    .limit(1);
  return Boolean(data && data.length);
}
