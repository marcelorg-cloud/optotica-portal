import type { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function resolveProfessionalLaboratory(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  laboratoryId: unknown
) {
  if (typeof laboratoryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(laboratoryId)) {
    return { data: null, error: null };
  }
  const { data: profile, error } = await admin.from('professional_profiles')
    .select('id').eq('user_id', userId).maybeSingle();
  if (error || !profile) return { data: null, error };
  return admin.from('professional_laboratories').select('id, name')
    .eq('id', laboratoryId).eq('professional_profile_id', profile.id)
    .eq('status', 'approved').maybeSingle();
}
