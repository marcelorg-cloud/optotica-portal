import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

function normalizeBrazilianPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return normalized.length >= 10 && normalized.length <= 15 ? `+${normalized}` : '';
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const patientName = typeof body?.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  const expectedWhatsApp = normalizeBrazilianPhone(typeof body?.whatsapp === 'string' ? body.whatsapp : '');
  if (patientName.length < 2 || !expectedWhatsApp) {
    return NextResponse.json({ message: 'Preencha nome e WhatsApp válidos.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('professional_profiles')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (!profile?.organization_id) return NextResponse.json({ message: 'Seu cadastro profissional ainda não está aprovado.' }, { status: 403 });

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from('patient_access_invitations').insert({
    organization_id: profile.organization_id,
    client_id: null,
    professional_user_id: user.id,
    email: null,
    patient_name: patientName,
    expected_whatsapp_e164: expectedWhatsApp,
    token_hash: tokenHash,
    status: 'pending',
    expires_at: expiresAt
  });
  if (error) {
    console.error('patient_invitation_create_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível gerar o convite.' }, { status: 500 });
  }

  const invitationUrl = `${publicEnv.appUrl()}/convite/${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(invitationUrl, { width: 420, margin: 1, color: { dark: '#171717', light: '#ffffff' } });
  return NextResponse.json({ message: 'Convite criado. Envie o link ou mostre o QR Code ao paciente.', invitationUrl, qrDataUrl, expiresAt });
}
