import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const BUCKET = 'try-on-photos';
const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

// Foto de prova online do cliente. Guardada só no Storage (bucket try-on-photos,
// já protegido por RLS para is_client_user), sem depender da tabela `documents`
// (cujo esquema real não é conhecido por esta sessão) — sempre um único arquivo
// fixo por cliente, os antigos são removidos a cada troca.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) return NextResponse.json({ message: 'Cadastro de cliente não encontrado.' }, { status: 403 });

  const { data: client } = await admin.from('clients').select('id, organization_id').eq('id', account.client_id).eq('status', 'active').maybeSingle();
  if (!client) return NextResponse.json({ message: 'Cadastro de cliente inativo.' }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) return NextResponse.json({ message: 'Selecione uma foto.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ message: 'A foto deve ter até 8MB.' }, { status: 400 });

  const ext = EXT_BY_MIME[file.type];
  if (!ext) return NextResponse.json({ message: 'Formato de imagem não suportado. Envie JPG, PNG, WEBP ou HEIC.' }, { status: 400 });

  const folder = `${client.organization_id}/${client.id}`;
  const { data: existing } = await admin.storage.from(BUCKET).list(folder);
  if (existing?.length) {
    await admin.storage.from(BUCKET).remove(existing.map((f) => `${folder}/${f.name}`));
  }

  const path = `${folder}/prova.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) {
    console.error('client_photo_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'Não foi possível salvar a foto.' }, { status: 500 });
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ message: 'Foto atualizada.', photoUrl: signed?.signedUrl || null });
}
