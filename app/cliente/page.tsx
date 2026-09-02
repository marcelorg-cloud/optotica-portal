import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Meus pedidos' };

type ClientOrder = { id: string; order_number: number; status: string; total: number | null; updated_at: string };

export default async function ClientPage() {
  if (!isSupabaseConfigured()) redirect('/entrar');
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const { data: account } = await supabase.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  const { data: client } = account
    ? await supabase.from('clients').select('id, full_name').eq('id', account.client_id).eq('status', 'active').maybeSingle()
    : { data: null };
  if (!client) return <div className="page-shell narrow"><div className="setup-note">Seu acesso ainda não está vinculado a um cadastro de cliente.</div></div>;

  const { data } = await supabase.from('orders').select('id, order_number, status, total, updated_at').eq('client_id', client.id).order('order_number', { ascending: false });
  const orders = (data || []) as ClientOrder[];

  return (
    <div className="page-shell">
      <section className="dashboard-head"><div><p className="eyebrow">Área do cliente</p><h1>Olá, {client.full_name.split(' ')[0]}</h1><p className="muted">Acompanhe seus pedidos e escolhas.</p></div></section>
      <section className="feature-grid">
        {orders.length ? orders.map(order => (
          <article key={order.id}>
            <span>Pedido #{order.order_number}</span>
            <h2>{order.status}</h2>
            <p>{order.total == null ? 'Valor a definir' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.total)}</p>
          </article>
        )) : <div className="setup-note">Nenhum pedido disponível.</div>}
      </section>
    </div>
  );
}
