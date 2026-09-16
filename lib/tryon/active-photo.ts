import type { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function activePhoto(admin: ReturnType<typeof createAdminSupabaseClient>, organizationId: string, clientId: string) {
  const { data: client, error } = await admin.from('clients').select('tryon_face_processed_path,tryon_face_status').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
  if (error) throw new Error('Não foi possível consultar a foto ativa.');
  const path = client?.tryon_face_processed_path;
  // Legacy records can contain an older professional preview after a patient upload.
  if (client?.tryon_face_status === 'validada' && path?.startsWith(`${organizationId}/${clientId}/face-v3/`)) return { bucket: 'tryon-face-source-photos', path };
  const folder = `${organizationId}/${clientId}`;
  const { data: files, error: listError } = await admin.storage.from('try-on-photos').list(folder);
  if (listError) throw new Error('Não foi possível consultar a foto ativa.');
  const file = files?.find(f => /^prova\.(jpg|jpeg|png|webp|heic|heif)$/i.test(f.name));
  return file ? { bucket: 'try-on-photos', path: `${folder}/${file.name}` } : null;
}
