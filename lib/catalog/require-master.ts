import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Mesma checagem já usada em app/admin/page.tsx (migração 202609110020): o
// painel de catálogo é de uso exclusivo do usuário master, então toda rota
// dele reaproveita esta função em vez de reimplementar a consulta a
// system_admins em cada arquivo.
//
// CONFERIR ANTES DE APLICAR: se o projeto já tiver um helper equivalente
// (ex.: requireMasterAdmin() em lib/auth ou parecido), usar aquele no lugar
// deste e apagar este arquivo — esta conversa não tem visibilidade completa
// de lib/ do repositório real.
export async function requireMaster() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401 as const, message: 'Faça login novamente.' };

  const admin = createAdminSupabaseClient();
  const { data: master } = await admin
    .from('system_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  if (!master) return { ok: false as const, status: 403 as const, message: 'Só o usuário master acessa o painel de catálogo.' };

  return { ok: true as const, admin, userId: user.id };
}
