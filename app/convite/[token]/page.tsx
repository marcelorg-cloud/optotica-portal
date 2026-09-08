import { createHash } from 'node:crypto';
import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Convite de paciente' };
export const dynamic = 'force-dynamic';

export default async function PatientInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 32) return <InvalidInvitation />;
  const admin = createAdminSupabaseClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: invitation } = await admin
    .from('patient_access_invitations')
    .select('patient_name, expected_whatsapp_e164, status, expires_at, professional_user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  // O horário atual é parte da validação de uma requisição dinâmica no servidor.
  // eslint-disable-next-line react-hooks/purity
  if (!invitation || invitation.status !== 'pending' || new Date(invitation.expires_at).getTime() <= Date.now()) return <InvalidInvitation />;
  const { data: profile } = await admin.from('professional_profiles').select('display_name').eq('user_id', invitation.professional_user_id).eq('status', 'approved').maybeSingle();
  if (!profile) return <InvalidInvitation />;

  const officialNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const message = encodeURIComponent(`OPTOTICA ${token}`);
  const whatsappUrl = officialNumber ? `https://wa.me/${officialNumber}?text=${message}` : '';
  const maskedPhone = invitation.expected_whatsapp_e164 ? `${invitation.expected_whatsapp_e164.slice(0, 5)}•••••${invitation.expected_whatsapp_e164.slice(-2)}` : '';

  return (
    <div className="page-shell narrow">
      <section className="card login-card">
        <p className="eyebrow">Convite seguro</p>
        <h1>Olá, {invitation.patient_name}</h1>
        <p className="muted"><strong>{profile.display_name}</strong> convidou você para acessar os dados desse atendimento.</p>
        <div className="setup-note">Para confirmar o número {maskedPhone}, abra o WhatsApp e envie a mensagem sem alterar o código. O vínculo só será criado depois do envio.</div>
        {whatsappUrl ? <a className="button whatsapp" href={whatsappUrl} rel="noopener noreferrer">Confirmar no WhatsApp</a> : <div className="form-message error">O WhatsApp oficial ainda não foi configurado.</div>}
        <p className="fine-print">Convite válido até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(invitation.expires_at))}. Se você não reconhece o profissional, não prossiga.</p>
      </section>
    </div>
  );
}

function InvalidInvitation() {
  return <div className="page-shell narrow"><div className="setup-note">Este convite é inválido, expirou ou já foi utilizado. Solicite um novo convite ao profissional.</div></div>;
}
