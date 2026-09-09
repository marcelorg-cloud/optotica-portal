import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Meus pacientes' };

type PatientRow = { client_id: string; created_at: string; clients: { full_name: string; whatsapp_e164: string } | null };

function formatWhatsApp(e164?: string | null) {
  if (!e164) return '—';
  const digits = e164.replace(/\D/g, '');
  // Formato canônico salvo (sem o "9" extra, ver lib/phone.ts): 55 + DDD(2) + 8 dígitos.
  // Reconstituímos o "9" só para exibição, já que é assim que o número real do celular é escrito.
  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    return `+55 (${ddd}) 9${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
  }
  return `+${digits}`;
}

export default async function ProfessionalPatientsPage() {
  if (!isSupabaseConfigured()) {
    return <div className="page-shell narrow"><div className="setup-note">Configure as variáveis do Supabase para ativar a área profissional.</div></div>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const [{ data: master }, { data: profile }] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle(),
    admin.from('professional_profiles').select('status').eq('user_id', user.id).maybeSingle()
  ]);
  if (master) redirect('/admin');
  if (!profile || profile.status !== 'approved') redirect('/profissional');

  const [{ data }, { data: openOrdersData }] = await Promise.all([
    admin
      .from('professional_client_assignments')
      .select('client_id, created_at, clients(full_name, whatsapp_e164)')
      .eq('professional_user_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending: false }),
    admin
      .from('orders')
      .select('id, client_id')
      .eq('professional_id', user.id)
      .eq('status', 'in_progress')
  ]);
  const patients = (data || []) as unknown as PatientRow[];
  // Atendimento em andamento por paciente — usado para reabrir direto em vez de
  // passar pela tela "novo pedido" (que já reaproveitaria o mesmo pedido, mas o
  // rótulo do botão deixava a ação pouco clara).
  const openOrderByClient = new Map((openOrdersData || []).map((o) => [o.client_id, o.id]));

  return (
    <div className="page-shell">
      <section className="dashboard-head">
        <div>
          <p className="eyebrow">Área profissional</p>
          <h1>Meus pacientes</h1>
          <p className="muted">Pacientes que confirmaram o vínculo pelo WhatsApp.</p>
        </div>
        <Link className="button primary" href="/profissional/pacientes/novo">Convidar paciente</Link>
      </section>
      <section className="card table-card">
        <div className="table-head"><span>Paciente</span><span>WhatsApp</span><span>Vinculado em</span><span></span></div>
        {patients.length ? patients.map((patient) => {
          const openOrderId = openOrderByClient.get(patient.client_id);
          return (
            <div className="table-row" key={patient.client_id}>
              <strong>{patient.clients?.full_name || 'Paciente'}</strong>
              <span>{formatWhatsApp(patient.clients?.whatsapp_e164)}</span>
              <time>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(patient.created_at))}</time>
              {openOrderId ? (
                <Link className="button secondary" href={`/profissional/pacientes/${patient.client_id}/pedido/${openOrderId}`}>Continuar atendimento</Link>
              ) : (
                <Link className="button secondary" href={`/profissional/pacientes/${patient.client_id}/pedido/novo`}>Novo pedido</Link>
              )}
            </div>
          );
        }) : <div className="empty-state">Nenhum paciente vinculado ainda. Convide um paciente para começar.</div>}
      </section>
    </div>
  );
}
