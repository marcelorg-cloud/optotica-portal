import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { isOrderFinalized } from '@/lib/order-status';

export const metadata: Metadata = { title: 'Área do paciente' };

type ClientOrder = { id: string; order_number: number; status: string };

export default async function ClientPage() {
  if (!isSupabaseConfigured()) redirect('/entrar');
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const { data: account } = await supabase.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  const { data: client } = account
    ? await supabase.from('clients').select('id, full_name').eq('id', account.client_id).eq('status', 'active').maybeSingle()
    : { data: null };
  if (!client) return <div className="page-shell narrow"><div className="setup-note">Seu acesso ainda não está vinculado a um cadastro de paciente.</div></div>;

  // 16/09/2026 — bug real (mesma causa da inconsistência corrigida em
  // app/profissional/page.tsx): esta consulta usava `supabase` (sessão do
  // próprio usuário, sujeita a RLS) em vez de `admin` (service role). Não
  // existe nenhuma política de SELECT para a tabela `orders` — só de INSERT
  // e UPDATE (ver supabase/migrations/202609020001_initial_schema.sql) — ou
  // seja, com RLS ativo e sem política de leitura, a consulta sempre
  // devolvia ZERO linhas, mesmo com pedidos reais cadastrados. Na prática
  // isso significava que NENHUM paciente conseguia ser redirecionado pra
  // seu pedido a partir de /cliente (sempre caía em "Nenhum pedido
  // disponível ainda", mesmo tendo pedidos) — só funcionava pra quem já
  // tinha o link direto de /cliente/pedido/[orderId] salvo. Corrigido para
  // `admin`, igual a todas as outras consultas de `orders` deste projeto.
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from('orders').select('id, order_number, status').eq('client_id', client.id).order('order_number', { ascending: false });
  if (error) {
    console.error('client_orders_load_failed', { code: error.code });
    return (
      <div className="page-shell narrow">
        <section className="dashboard-head">
          <div><p className="eyebrow">Área do paciente</p><h1>Olá, {client.full_name.split(' ')[0]}</h1></div>
        </section>
        <div className="setup-note">Não foi possível carregar seus pedidos agora. Tente novamente em instantes.</div>
      </div>
    );
  }
  const orders = (data || []) as ClientOrder[];

  if (!orders.length) {
    return (
      <div className="page-shell narrow">
        <section className="dashboard-head">
          <div><p className="eyebrow">Área do paciente</p><h1>Olá, {client.full_name.split(' ')[0]}</h1><p className="muted">Acompanhe seus pedidos e escolhas.</p></div>
        </section>
        <div className="setup-note">Nenhum pedido disponível ainda. Assim que seu atendimento começar, ele aparecerá aqui.</div>
      </div>
    );
  }

  // 'completed' nunca é um valor real de orders.status — corrigido pra
  // refletir a real intenção: preferir mostrar um pedido ainda não
  // finalizado (qualquer status que não seja 'delivered'/'cancelled', ver
  // lib/order-status.ts — a constraint do banco permite vários status
  // intermediários além de 'in_progress') a um já encerrado, quando o
  // paciente tiver mais de um pedido.
  const current = orders.find((order) => !isOrderFinalized(order.status)) || orders[0];
  redirect(`/cliente/pedido/${current.id}`);
}
