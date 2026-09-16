import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/verification-auth';
import { serverEnv } from '@/lib/env';
import { processFacePhoto } from './face-photo-process';
import { readPhotoTicket, signPhotoTicket } from './photo-ticket';

const BUCKET = 'tryon-face-source-photos';
const formats: Record<string,string> = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif' };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status });
export async function photoWorkflow(request: Request, orderId?: string) {
  if (!isSameOrigin(request)) return reply('Origem inválida.',403);
  const auth = await createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return reply('Faça login para continuar.',401);
  const admin = createAdminSupabaseClient();
  let clientId: string | undefined;
  if (orderId) {
    const { data: order } = await admin.from('orders').select('client_id').eq('id',orderId).eq('professional_id',user.id).maybeSingle();
    clientId = order?.client_id;
  } else {
    const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id',user.id).maybeSingle();
    clientId = account?.client_id;
  }
  if (!clientId) return reply('Paciente não encontrado para este acesso.',403);
  const { data: client, error } = await admin.from('clients').select('id,organization_id,tryon_face_processed_path,tryon_face_validated_at').eq('id',clientId).eq('status','active').maybeSingle();
  if (error || !client) return reply('Cadastro de paciente indisponível.',403);
  try {
    if (request.method === 'POST') {
      const form = await request.formData(); const file = form.get('photo');
      if (!(file instanceof File) || !file.size || file.size > 8*1024*1024 || !formats[file.type]) return reply('Envie uma foto JPG, PNG, WEBP ou HEIC de até 8 MB.',400);
      // Immutable audit paths identify the uploader. Preparing never changes the active photo.
      const folder = `${client.organization_id}/${client.id}/face-v3/${user.id}/${randomUUID()}`;
      const sourcePath = `${folder}/source.${formats[file.type]}`; const path = `${folder}/processed.jpg`;
      const upload = await admin.storage.from(BUCKET).upload(sourcePath,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
      if (upload.error) throw upload.error;
      const signed = await admin.storage.from(BUCKET).createSignedUrl(sourcePath,900);
      if (!signed.data?.signedUrl) throw new Error('Source unavailable');
      const processed = await processFacePhoto(signed.data.signedUrl);
      const saved = await admin.storage.from(BUCKET).upload(path,processed,{contentType:'image/jpeg',upsert:false});
      if (saved.error) throw saved.error;
      const preview = await admin.storage.from(BUCKET).createSignedUrl(path,3600);
      if (!preview.data?.signedUrl) throw new Error('Preview unavailable');
      const token = signPhotoTicket({userId:user.id,clientId:client.id,organizationId:client.organization_id,path,sourcePath,previousPath:client.tryon_face_processed_path,previousDate:client.tryon_face_validated_at,expires:Date.now()+3600000},serverEnv.supabaseSecretKey());
      return NextResponse.json({processedUrl:preview.data.signedUrl,token,message:'Confira o resultado. Sua foto atual continua ativa até você confirmar.'});
    }
    const body = await request.json().catch(()=>null);
    const ticket = readPhotoTicket(body?.token,serverEnv.supabaseSecretKey());
    if (!ticket || ticket.userId !== user.id || ticket.clientId !== client.id || ticket.organizationId !== client.organization_id) return reply('Prévia expirada ou inválida. Envie a foto novamente.',409);
    const validatedAt = new Date().toISOString();
    const photo = await admin.storage.from(BUCKET).createSignedUrl(ticket.path,3600);
    if (!photo.data?.signedUrl) throw new Error('Photo unavailable');
    // Atomic compare-and-set: a simultaneous confirmation can never overwrite a newer photo.
    let update = admin.from('clients').update({tryon_face_source_path:ticket.sourcePath,tryon_face_processed_path:ticket.path,tryon_face_status:'validada',tryon_face_validated_at:validatedAt,tryon_face_order_id:orderId || null}).eq('id',client.id).eq('status','active');
    update = ticket.previousPath === null ? update.is('tryon_face_processed_path',null) : update.eq('tryon_face_processed_path',ticket.previousPath);
    update = ticket.previousDate === null ? update.is('tryon_face_validated_at',null) : update.eq('tryon_face_validated_at',ticket.previousDate);
    const changed = await update.select('id').maybeSingle();
    if (changed.error) throw changed.error;
    if (!changed.data) return reply('A foto foi atualizada em outro acesso. Atualize a página e confira a foto atual antes de tentar novamente.',409);
    return NextResponse.json({photoUrl:photo.data.signedUrl,message:'Foto confirmada. As provas usarão a nova foto e a DNP cadastrada.'});
  } catch (error) {
    console.error('face_photo_workflow_failed',error instanceof Error ? error.message : 'Storage or database error');
    return reply('Não foi possível concluir. Sua foto ativa foi preservada; tente novamente.',502);
  }
}
