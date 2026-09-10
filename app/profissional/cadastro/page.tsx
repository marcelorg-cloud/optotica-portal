import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProfessionalProfileForm } from '@/components/professional-profile-form';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Cadastro profissional' };

export default async function ProfessionalRegistrationPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('id, account_type, professional_kind, display_name, council_registration, technical_responsible_name, technical_responsible_registration, cnpj, address_line, address_number, address_complement, district, city, state, postal_code, phone_e164, contact_name, contact_email, contact_phone_e164, status, review_notes').eq('user_id', user.id).maybeSingle();
  if (profile && !['draft', 'changes_requested'].includes(profile.status)) redirect('/profissional');
  const { data: laboratories } = profile
    ? await admin.from('professional_laboratories').select('id, name, legal_name, cnpj, address_line, address_number, address_complement, district, city, state, postal_code, phone_e164, contact_name').eq('professional_profile_id', profile.id).neq('status', 'suspended').order('created_at')
    : { data: [] };

  const registrationKind = profile?.account_type === 'optical_store' || profile?.account_type === 'laboratory'
    ? profile.account_type
    : (profile?.professional_kind || 'optometrista');
  const initialValues = {
    registrationKind,
    displayName: profile?.display_name || user.user_metadata.full_name || '',
    technicalResponsibleName: profile?.technical_responsible_name || '',
    technicalResponsibleRegistration: profile?.technical_responsible_registration || profile?.council_registration || '',
    documentNumber: profile?.cnpj || '',
    addressLine: profile?.address_line || '', addressNumber: profile?.address_number || '', addressComplement: profile?.address_complement || '',
    district: profile?.district || '', city: profile?.city || '', state: profile?.state || '', postalCode: profile?.postal_code || '',
    phone: profile?.phone_e164 || '', contactName: profile?.contact_name || '', contactEmail: profile?.contact_email || '', contactPhone: profile?.contact_phone_e164 || '',
    laboratories: (laboratories || []).map((lab) => ({
      id: lab.id, name: lab.name, legalName: lab.legal_name || '', cnpj: lab.cnpj, addressLine: lab.address_line,
      addressNumber: lab.address_number || '', addressComplement: lab.address_complement || '', district: lab.district || '',
      city: lab.city, state: lab.state, postalCode: lab.postal_code || '', phone: lab.phone_e164, contactName: lab.contact_name || ''
    }))
  };

  return (
    <div className="page-shell form-shell">
      <section className="dashboard-head"><div><p className="eyebrow">Validação Optótica</p><h1>Cadastre seus dados</h1><p className="muted">Preencha os dados de suas atividades e dos laboratórios para que seu cadastro seja analisado e seja permitida a inclusão de pacientes.</p></div></section>
      {profile?.review_notes && <div className="setup-note">Solicitação da equipe: {profile.review_notes}</div>}
      <ProfessionalProfileForm initialValues={initialValues} />
    </div>
  );
}
