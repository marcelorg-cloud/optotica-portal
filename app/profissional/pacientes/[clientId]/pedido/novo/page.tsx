import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { NewOrderForm } from '@/components/new-order-form';

export const metadata: Metadata = { title: 'Novo pedido' };

export default async function NewOrderPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('status').eq('user_id', user.id).maybeSingle();
  if (!profile || profile.status !== 'approved') redirect('/profissional');

  const { data: assignment } = await admin
    .from('professional_client_assignments')
    .select('client_id, clients(full_name)')
    .eq('professional_user_id', user.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (!assignment) redirect('/profissional/pacientes');
  const clientName = (assignment as unknown as { clients: { full_name: string } | null }).clients?.full_name || 'Paciente';

  return (
    <div className="page-shell narrow">
      <div className="order-head">
        <Link className="back-link" href="/profissional/pacientes">← Meus pacientes</Link>
        <p className="eyebrow">Área profissional · {clientName}</p>
        <h1>Novo pedido</h1>
      </div>
      <section className="card">
        <div className="card-head">
          <div className="step-title">
            <span className="step-badge">1</span>
            <div>
              <p className="eyebrow">Etapa atual</p>
              <h2>OS laboratorial + orçamento</h2>
            </div>
          </div>
          <span className="pending-tag">Em andamento</span>
        </div>
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>Preencha a receita e o orçamento de lente. As etapas de armação, pagamento e produção ainda serão adicionadas.</p>
          <NewOrderForm clientId={clientId} />
        </div>
      </section>
    </div>
  );
}
