import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Área profissional' };

type OrderSummary = { id: string; order_number: number; status: string; updated_at: string; clients: { full_name: string } | null };

export default async function ProfessionalPage() {
  if (!isSupabaseConfigured()) {
    return <div className="page-shell narrow"><div className="setup-note">Configure as variáveis do Supabase para ativar a área profissional.</div></div>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const { data: membership } = await supabase
    .from('company_members')
    .select('role, companies(name)')
    .eq('user_id', user.id)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (!membership || !['owner', 'admin', 'optometrist', 'staff'].includes(membership.role)) {
    return <div className="page-shell narrow"><div className="setup-note">Seu usuário ainda não possui acesso profissional autorizado.</div></div>;
  }

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, updated_at, clients(full_name)')
    .order('updated_at', { ascending: false })
    .limit(20);
  const orders = (data || []) as unknown as OrderSummary[];

  return (
    <div className="page-shell">
      <section className="dashboard-head">
        <div><p className="eyebrow">Área profissional</p><h1>Atendimentos</h1><p className="muted">Pedidos recentes autorizados para sua empresa.</p></div>
        <button className="button primary" type="button" disabled>+ Novo atendimento</button>
      </section>
      <section className="card table-card">
        <div className="table-head"><span>Pedido</span><span>Cliente</span><span>Status</span><span>Atualização</span></div>
        {orders.length ? orders.map(order => (
          <div className="table-row" key={order.id}>
            <strong>#{order.order_number}</strong>
            <span>{order.clients?.full_name || 'Cliente'}</span>
            <span className="pill">{order.status}</span>
            <time>{new Intl.DateTimeFormat('pt-BR').format(new Date(order.updated_at))}</time>
          </div>
        )) : <div className="empty-state">Nenhum pedido cadastrado.</div>}
      </section>
    </div>
  );
}
