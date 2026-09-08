import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { isValidCNPJ, isValidCPF } from '@/lib/br-documents';

type LaboratoryInput = {
  id?: unknown;
  name?: unknown;
  legalName?: unknown;
  cnpj?: unknown;
  addressLine?: unknown;
  addressNumber?: unknown;
  addressComplement?: unknown;
  district?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  phone?: unknown;
  contactName?: unknown;
};

const clean = (value: unknown, max = 180) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const digits = (value: unknown) => clean(value).replace(/\D/g, '');
const phone = (value: unknown) => {
  const valueDigits = digits(value);
  const normalized = valueDigits.length === 10 || valueDigits.length === 11 ? `55${valueDigits}` : valueDigits;
  return normalized.length >= 10 && normalized.length <= 15 ? `+${normalized}` : '';
};

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ message: 'Faça login novamente.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const registrationKind = ['optometrista', 'bacharel', 'optical_store'].includes(body?.registrationKind) ? body.registrationKind : 'optometrista';
  const accountType = registrationKind === 'optical_store' ? 'optical_store' : 'professional';
  const professionalKind = registrationKind === 'optical_store' ? null : registrationKind;
  const displayName = clean(body?.displayName, 140);
  const technicalResponsibleName = clean(body?.technicalResponsibleName, 140);
  const technicalResponsibleRegistration = clean(body?.technicalResponsibleRegistration, 80);
  const city = clean(body?.city, 100);
  const state = clean(body?.state, 2).toUpperCase();
  const postalCodeDigits = digits(body?.postalCode);
  const mainPhone = phone(body?.phone);
  const laboratories = Array.isArray(body?.laboratories) ? body.laboratories as LaboratoryInput[] : [];
  const documentNumber = digits(body?.documentNumber);
  const contactEmail = clean(body?.contactEmail, 254).toLowerCase();

  if (displayName.length < 2 || !clean(body?.addressLine) || !city || state.length !== 2 || !mainPhone) {
    return NextResponse.json({ message: 'Preencha nome, endereço, cidade, UF e telefone válidos.' }, { status: 400 });
  }
  if (postalCodeDigits.length !== 8) {
    return NextResponse.json({ message: 'CEP deve ter 8 dígitos.' }, { status: 400 });
  }
  if (!technicalResponsibleName || !technicalResponsibleRegistration) {
    return NextResponse.json({ message: 'Informe o nome e o registro do responsável técnico optometrista.' }, { status: 400 });
  }
  if (accountType === 'optical_store') {
    if (!isValidCNPJ(documentNumber)) {
      return NextResponse.json({ message: 'CNPJ inválido. Verifique o número informado.' }, { status: 400 });
    }
  } else if (!isValidCPF(documentNumber)) {
    return NextResponse.json({ message: 'CPF inválido. Verifique o número informado.' }, { status: 400 });
  }
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
    return NextResponse.json({ message: 'Informe um e-mail de contato válido.' }, { status: 400 });
  }
  if (!laboratories.length || laboratories.length > 10) {
    return NextResponse.json({ message: 'Cadastre ao menos um laboratório (máximo de 10).' }, { status: 400 });
  }

  const normalizedLabs = laboratories.map((lab) => ({
    id: typeof lab.id === 'string' && /^[0-9a-f-]{36}$/i.test(lab.id) ? lab.id : randomUUID(),
    name: clean(lab.name, 140),
    legal_name: clean(lab.legalName, 180) || null,
    cnpj: digits(lab.cnpj),
    address_line: clean(lab.addressLine),
    address_number: clean(lab.addressNumber, 30) || null,
    address_complement: clean(lab.addressComplement, 100) || null,
    district: clean(lab.district, 100) || null,
    city: clean(lab.city, 100),
    state: clean(lab.state, 2).toUpperCase(),
    postal_code: digits(lab.postalCode) || null,
    phone_e164: phone(lab.phone),
    contact_name: clean(lab.contactName, 140) || null
  }));
  if (normalizedLabs.some((lab) => lab.name.length < 2 || !isValidCNPJ(lab.cnpj) || !lab.address_line || !lab.city || lab.state.length !== 2 || !lab.phone_e164)) {
    return NextResponse.json({ message: 'Revise nome, CNPJ, endereço, cidade, UF e telefone de cada laboratório.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  let { data: profile } = await admin
    .from('professional_profiles')
    .select('id, organization_id, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile) {
    // Só acontece se este usuário nunca passou pelo gatilho de autocadastro
    // (handle_self_registration, migração 202609070006) — hoje ele já cria o
    // professional_profiles com organização própria e inativa no momento do
    // signup. Como fallback, criamos aqui uma organização nova e exclusiva
    // (nunca reaproveitamos uma organização já ativa de outro profissional —
    // isso quebraria o isolamento entre óticas).
    const { data: slug } = await admin.rpc('unique_org_slug', { base: displayName });
    const { data: organization, error: orgError } = await admin
      .from('organizations')
      .insert({ name: displayName, slug: slug || displayName, active: false })
      .select('id')
      .single();
    if (orgError || !organization) return NextResponse.json({ message: 'Não foi possível iniciar o cadastro.' }, { status: 500 });
    const { data: created, error } = await admin.from('professional_profiles').insert({
      user_id: user.id,
      organization_id: organization.id,
      email: user.email,
      display_name: displayName
    }).select('id, organization_id, status').single();
    if (error || !created) return NextResponse.json({ message: 'Não foi possível iniciar o cadastro.' }, { status: 500 });
    await admin.from('organization_members').insert({ organization_id: organization.id, user_id: user.id, role: 'owner', active: false }).select('organization_id').maybeSingle();
    profile = created;
  }
  if (!['draft', 'changes_requested'].includes(profile.status)) {
    return NextResponse.json({ message: 'Este cadastro está bloqueado para edição enquanto é analisado.' }, { status: 409 });
  }

  const { data: existingLabs } = await admin.from('professional_laboratories').select('id').eq('professional_profile_id', profile.id);
  const existingLabIds = new Set((existingLabs || []).map((lab) => lab.id));
  const submittedExistingIds = normalizedLabs.filter((lab) => existingLabIds.has(lab.id)).map((lab) => lab.id);
  const unknownSubmittedId = normalizedLabs.some((lab) => laboratories.some((input) => input.id === lab.id) && !existingLabIds.has(lab.id));
  if (unknownSubmittedId) return NextResponse.json({ message: 'Um dos laboratórios não pertence a este cadastro.' }, { status: 403 });

  const now = new Date().toISOString();
  const { error: profileError } = await admin.from('professional_profiles').update({
    account_type: accountType,
    professional_kind: professionalKind,
    display_name: displayName,
    technical_responsible_name: technicalResponsibleName,
    technical_responsible_registration: technicalResponsibleRegistration,
    cnpj: documentNumber,
    address_line: clean(body?.addressLine),
    address_number: clean(body?.addressNumber, 30) || null,
    address_complement: clean(body?.addressComplement, 100) || null,
    district: clean(body?.district, 100) || null,
    city,
    state,
    postal_code: postalCodeDigits,
    phone_e164: mainPhone,
    contact_name: clean(body?.contactName, 140) || null,
    contact_email: contactEmail || null,
    contact_phone_e164: phone(body?.contactPhone) || null,
    status: 'under_review',
    submitted_at: now,
    review_notes: null,
    updated_at: now
  }).eq('id', profile.id);
  if (profileError) return NextResponse.json({ message: 'Não foi possível salvar os dados profissionais.' }, { status: 500 });

  const { error: labsError } = await admin.from('professional_laboratories').upsert(normalizedLabs.map((lab) => ({
    ...lab,
    professional_profile_id: profile.id,
    organization_id: profile.organization_id,
    status: 'under_review',
    updated_at: now
  })), { onConflict: 'id' });
  if (labsError) return NextResponse.json({ message: 'Os dados foram salvos, mas os laboratórios precisam ser reenviados.' }, { status: 500 });
  const labsToSuspend = [...existingLabIds].filter((id) => !submittedExistingIds.includes(id));
  if (labsToSuspend.length) {
    const { error: suspendError } = await admin.from('professional_laboratories').update({ status: 'suspended', updated_at: now }).eq('professional_profile_id', profile.id).in('id', labsToSuspend);
    if (suspendError) return NextResponse.json({ message: 'Cadastro enviado, mas laboratórios removidos precisam de revisão administrativa.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Cadastro enviado para análise da equipe Optótica.' });
}
