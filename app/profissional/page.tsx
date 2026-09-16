import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';

export const metadata: Metadata = { title: 'Área profissional' };

type OrderSummary = { id: string; order_number: number; status: string; total: number | null; updated_at: string; clients: { full_name: string } | null };

export default async function ProfessionalPage() {
  if (!isSupabaseConfigured()) {
    return <div className="page-shell narrow"><div className="setup-note">Configure as variáveis do Supabase para ativar a área profissional.</div></div>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const [{ data: master }, { data: profile }] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle(),
    admin.from('professional_profiles').select('id, display_name, status, review_notes').eq('user_id', user.id).maybeSingle()
  ]);
  if (master) redirect('/admin');
  if (!profile || ['draft', 'changes_requested'].includes(profile.status)) redirect('/profissional/cadastro');
  if (profile.status !== 'approved') {
    const labels: Record<string, string> = {
      under_review: 'Seu cadastro está em análise pela equipe Optótica.',
      rejected: 'Seu cadastro não foi aprovado.',
      suspended: 'Seu acesso profissional está suspenso.'
    };
    return <div className="page-shell narrow"><div className="setup-note"><strong>{labels[profile.status] || 'Acesso indisponível.'}</strong>{profile.review_notes && <p>{profile.review_notes}</p>}</div></div>;
  }

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, total, updated_at, clients(full_name)')
    .order('updated_at', { ascending: false })
    .limit(20);
  const orders = (data || []) as unknown as OrderSummary[];
  const inProgress = orders.filter((order) => order.status === 'in_progress').length;
  const completed = orders.filter((order) => ['completed', 'delivered'].includes(order.status)).length;

  return (
    <div className="page-shell">
      <section className="dashboard-head professional-dashboard-head">
        <div><p className="eyebrow">Visão geral</p><h1>Olá, {profile.display_name.split(' ')[0]}.</h1><p className="muted">Acompanhe seus atendimentos e acesse rapidamente as tarefas do dia.</p></div>
        <Link className="button primary" href="/profissional/pacientes">Iniciar atendimento</Link>
      </section>
      <section className="professional-stats" aria-label="Resumo dos pedidos">
        <article><span>Pedidos recentes</span><strong>{orders.length}</strong><small>últimos registros</small></article>
        <article><span>Em atendimento</span><strong>{inProgress}</strong><small>pedidos em andamento</small></article>
        <article><span>Concluídos</span><strong>{completed}</strong><small>prontos ou entregues</small></article>
      </section>
      <section className="quick-actions" aria-label="Acessos rápidos">
        <Link href="/profissional/pacientes"><span>01</span><strong>Meus pacientes</strong><small>Consultar vínculos e iniciar pedidos</small></Link>
        <Link href="/profissional/pacientes/novo"><span>02</span><strong>Convidar paciente</strong><small>Gerar acesso pelo WhatsApp</small></Link>
        <Link href="/profissional/cardapio"><span>03</span><strong>Cardápio de lentes</strong><small>Organizar opções e preços</small></Link>
      </section>
      <section className="section-heading"><div><p className="eyebrow">Atividade</p><h2>Pedidos recentes</h2></div><Link className="text-link" href="/profissional/pacientes">Ver pacientes</Link></section>
      <section className="card table-card professional-table">
        <div className="table-head"><span>Pedido</span><span>Paciente</span><span>Status</span><span>Atualização</span></div>
        {orders.length ? orders.map(order => (
          <div className="table-row" key={order.id}>
            <strong>{orderCode(order.clients?.full_name || 'Paciente', order.order_number)}</strong>
            <span>{order.clients?.full_name || 'Paciente'}</span>
            <span className="pill">{order.status}</span>
            <time>{new Intl.DateTimeFormat('pt-BR').format(new Date(order.updated_at))}</time>
          </div>
        )) : <div className="empty-state"><strong>Nenhum pedido recente</strong><span>Escolha um paciente para iniciar o primeiro atendimento.</span><Link className="button secondary" href="/profissional/pacientes">Ver pacientes</Link></div>}
      </section>
    </div>
  );
}
