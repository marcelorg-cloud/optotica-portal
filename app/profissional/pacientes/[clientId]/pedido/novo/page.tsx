import type { Metadata } from 'next';
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
      <section className="card">
        <p className="eyebrow">Área profissional</p>
        <h1>Novo pedido — {clientName}</h1>
        <p className="muted">Preencha a receita e o orçamento de lente. As etapas de armação, pagamento e produção ainda serão adicionadas.</p>
        <NewOrderForm clientId={clientId} />
      </section>
    </div>
  );
}
