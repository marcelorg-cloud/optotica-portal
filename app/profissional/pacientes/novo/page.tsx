import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PatientInvitationForm } from '@/components/patient-invitation-form';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Vincular paciente' };

export default async function NewPatientPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('id').eq('user_id', user.id).eq('status', 'approved').maybeSingle();
  if (!profile) redirect('/profissional');

  return (
    <div className="page-shell narrow">
      <section className="card login-card">
        <p className="eyebrow">Primeiro acesso do paciente</p>
        <h1>Convidar paciente</h1>
        <p className="muted">Informe o paciente e o WhatsApp esperado. O vínculo exclusivo só será criado depois que esse número enviar a mensagem pré-preenchida ao WhatsApp oficial da Optótica.</p>
        <PatientInvitationForm />
      </section>
    </div>
  );
}
