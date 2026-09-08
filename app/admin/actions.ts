'use server';

import { revalidatePath } from 'next/cache';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// approve_professional/reject_professional/request_professional_changes/
// suspend_professional/reactivate_professional (migração 202609070006) já
// checam is_master_admin() dentro do banco (security definer) e gravam em
// audit_logs — a decisão de autorização nunca é tomada aqui, só repassamos o
// pedido. Usamos o client autenticado (respeita auth.uid()) para essas RPCs.
async function callRpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
}

// As RPCs acima cobrem professional_profiles/organizations/organization_members,
// mas não os laboratórios do profissional — professional_laboratories tem seu
// próprio status (draft/under_review/...) e fica de fora das funções que
// existem hoje em produção. Para a aprovação liberar de fato os laboratórios
// enviados (em vez de deixá-los presos em "under_review" para sempre), esta
// ação cascateia a aprovação aqui, via service role, logo depois da RPC.
async function cascadeApproveLaboratories(profileId: string, reviewerId: string) {
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  await admin
    .from('professional_laboratories')
    .update({ status: 'approved', reviewed_by: reviewerId, reviewed_at: now, review_notes: null, updated_at: now })
    .eq('professional_profile_id', profileId)
    .eq('status', 'under_review');
}

export async function approveProfessionalAction(formData: FormData) {
  const targetProfile = String(formData.get('target_profile') || '');
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  await callRpc('approve_professional', { target_profile: targetProfile, notes: String(formData.get('notes') || '') || null });
  if (user) await cascadeApproveLaboratories(targetProfile, user.id);
  revalidatePath('/admin');
}

export async function rejectProfessionalAction(formData: FormData) {
  await callRpc('reject_professional', {
    target_profile: String(formData.get('target_profile') || ''),
    notes: String(formData.get('notes') || '')
  });
  revalidatePath('/admin');
}

export async function requestChangesAction(formData: FormData) {
  await callRpc('request_professional_changes', {
    target_profile: String(formData.get('target_profile') || ''),
    notes: String(formData.get('notes') || '')
  });
  revalidatePath('/admin');
}

export async function suspendProfessionalAction(formData: FormData) {
  await callRpc('suspend_professional', {
    target_profile: String(formData.get('target_profile') || ''),
    notes: String(formData.get('notes') || '')
  });
  revalidatePath('/admin');
}

export async function reactivateProfessionalAction(formData: FormData) {
  await callRpc('reactivate_professional', {
    target_profile: String(formData.get('target_profile') || ''),
    notes: String(formData.get('notes') || '') || null
  });
  revalidatePath('/admin');
}
