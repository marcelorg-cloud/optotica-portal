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

// Aprova UM laboratório específico, isolado do profissional (migração
// 202609110019 + seção 0.24 do estado consolidado): desde que um profissional
// já aprovado pode reabrir o cadastro só para adicionar/editar laboratórios
// (sem voltar o próprio status para 'under_review'), o cascadeApproveLaboratories
// acima — que só roda dentro de approveProfessionalAction — nunca mais é
// chamado para esse profissional, e um laboratório novo ficaria preso em
// 'under_review' para sempre. Esta ação cobre esse caso: aprova só o
// laboratório indicado, sem depender do status do profissional.
export async function approveLaboratoryAction(formData: FormData) {
  const laboratoryId = String(formData.get('target_laboratory') || '');
  if (!laboratoryId) throw new Error('Laboratório inválido.');
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Faça login novamente.');
  const admin = createAdminSupabaseClient();
  const { data: master } = await admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!master) throw new Error('Apenas o usuário master pode aprovar laboratórios.');
  const now = new Date().toISOString();
  const { error } = await admin
    .from('professional_laboratories')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: now, review_notes: null, updated_at: now })
    .eq('id', laboratoryId)
    .eq('status', 'under_review');
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
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
