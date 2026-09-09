import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';

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

  return (
    <div className="page-shell">
      <section className="dashboard-head">
        <div><p className="eyebrow">Área profissional</p><h1>{profile.display_name}</h1><p className="muted">Você vê somente os pacientes que aceitaram os convites criados por esta conta.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="button secondary" href="/profissional/pacientes">Meus pacientes</Link>
          <Link className="button primary" href="/profissional/pacientes/novo">Convidar paciente</Link>
        </div>
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
