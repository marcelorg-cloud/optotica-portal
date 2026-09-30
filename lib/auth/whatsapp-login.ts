import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import { toCanonicalWhatsAppE164 } from '@/lib/phone';

export type LoginCandidate = {
  key: string;
  userId: string;
  label: string;
  kind: 'professional' | 'patient';
  redirectTo: '/profissional' | '/cliente';
};

export function normalizeLoginPhone(value: unknown) {
  if (typeof value !== 'string') return '';
  const phone = toCanonicalWhatsAppE164(value);
  return /^\+55\d{10}$/.test(phone) ? phone : '';
}

export function challengeHash(challengeId: string, phone: string, code: string) {
  return crypto.createHmac('sha256', serverEnv.supabaseSecretKey())
    .update(`${challengeId}:${phone}:${code}`)
    .digest('hex');
}

export function safeHashEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requesterFingerprint(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const agent = request.headers.get('user-agent') || '';
  return crypto.createHmac('sha256', serverEnv.supabaseSecretKey())
    .update(`${forwarded}:${agent.slice(0, 300)}`)
    .digest('hex');
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export async function resolveLoginCandidates(admin: SupabaseClient, phone: string): Promise<LoginCandidate[]> {
  const [{ data: professionals, error: professionalError }, { data: patientIdentity, error: identityError }] = await Promise.all([
    admin.from('professional_profiles')
      .select('user_id, display_name, account_type, phone_e164')
      .eq('status', 'approved')
      .not('phone_e164', 'is', null),
    admin.from('patient_whatsapp_identities')
      .select('user_id')
      .eq('whatsapp_e164', phone)
      .maybeSingle()
  ]);
  if (professionalError || identityError) throw professionalError || identityError;

  const candidates: LoginCandidate[] = (professionals || [])
    .filter(profile => toCanonicalWhatsAppE164(profile.phone_e164 || '') === phone)
    .map(profile => ({
      key: crypto.randomUUID(),
      userId: profile.user_id,
      label: `${profile.display_name} — ${profile.account_type === 'optical_store' ? 'Ótica' : 'Profissional'}`,
      kind: 'professional' as const,
      redirectTo: '/profissional' as const
    }));

  if (patientIdentity?.user_id) {
    const { data: links, error: linksError } = await admin.from('client_user_accounts')
      .select('client_id')
      .eq('user_id', patientIdentity.user_id);
    if (linksError) throw linksError;
    const clientIds = (links || []).map(link => link.client_id);
    if (clientIds.length) {
      const { data: clients, error: clientsError } = await admin.from('clients')
        .select('full_name')
        .in('id', clientIds)
        .eq('status', 'active');
      if (clientsError) throw clientsError;
      const names = [...new Set((clients || []).map(client => client.full_name).filter(Boolean))];
      if (names.length) candidates.push({
        key: crypto.randomUUID(), userId: patientIdentity.user_id,
        label: names.length === 1 ? `${names[0]} — Paciente` : 'Área do paciente',
        kind: 'patient', redirectTo: '/cliente'
      });
    }
  }
  return candidates;
}

export function parseStoredCandidates(value: unknown): LoginCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LoginCandidate => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<LoginCandidate>;
    return typeof row.key === 'string' && typeof row.userId === 'string' && typeof row.label === 'string' &&
      ((row.kind === 'professional' && row.redirectTo === '/profissional') ||
        (row.kind === 'patient' && row.redirectTo === '/cliente'));
  });
}
