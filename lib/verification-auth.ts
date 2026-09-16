import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

export async function verificationActor() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminSupabaseClient();
  const [{ data: master }, { data: profile }] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle(),
    admin.from('professional_profiles').select('id,user_id,display_name,council_registration,account_type,status').eq('user_id', user.id).maybeSingle()
  ]);
  return { user, admin, master: Boolean(master), profile };
}
export const verificationBucket = 'professional-verification';
export async function readPdf(file: FormDataEntryValue | null): Promise<Buffer> {
  if (!(file instanceof File) || file.size === 0 || file.size > 1000000) throw new Error('Cada documento deve ser um PDF de até 1 MB.');
  const data = Buffer.from(await file.arrayBuffer());
  if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('Envie documentos em formato PDF.');
  return data;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
