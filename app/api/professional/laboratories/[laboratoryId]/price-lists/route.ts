import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const BUCKET = 'laboratory-price-lists';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

// Biblioteca de preços do laboratório (migração 202609110019): arquivos
// anexados com a tabela de SERVIÇOS do próprio laboratório parceiro
// (montagem/surfaçagem/biselamento) — decisão confirmada com o usuário
// master antes de criar esta tabela/rota (não é preço de lente: isso já é
// o cardápio de lentes, lens_catalog_items/lens_menu_tiers, sem relação com
// esta rota). Mesmo padrão de segurança do resto do projeto: todo write
// pela rota via service role, checagem de posse feita aqui em código, não
// por política de RLS de escrita no banco.

// Mesmo padrão de checagem de posse usado no resto do projeto: duas
// consultas simples (perfil do usuário -> laboratórios daquele perfil), em
// vez de um join filtrado — mais fácil de ler e de testar.
async function loadOwnedLaboratory(admin: ReturnType<typeof createAdminSupabaseClient>, laboratoryId: string, userId: string) {
  const { data: profile } = await admin.from('professional_profiles').select('id').eq('user_id', userId).maybeSingle();
  if (!profile) return null;
  const { data: lab } = await admin
    .from('professional_laboratories')
    .select('id, organization_id')
    .eq('id', laboratoryId)
    .eq('professional_profile_id', profile.id)
    .maybeSingle();
  return lab as { id: string; organization_id: string | null } | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ laboratoryId: string }> }) {
  const { laboratoryId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const lab = await loadOwnedLaboratory(admin, laboratoryId, user.id);
  if (!lab) return NextResponse.json({ message: 'Laboratório não encontrado.' }, { status: 404 });

  const { data: rows } = await admin
    .from('laboratory_price_lists')
    .select('id, file_path, file_name, version_label, active, created_at')
    .eq('laboratory_id', laboratoryId)
    .order('created_at', { ascending: false });

  const priceLists = await Promise.all((rows || []).map(async (row) => {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.file_path, 3600);
    return {
      id: row.id,
      fileName: row.file_name,
      versionLabel: row.version_label,
      active: row.active,
      createdAt: row.created_at,
      downloadUrl: signed?.signedUrl || null
    };
  }));

  return NextResponse.json({ priceLists });
}

export async function POST(request: Request, { params }: { params: Promise<{ laboratoryId: string }> }) {
  const { laboratoryId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const lab = await loadOwnedLaboratory(admin, laboratoryId, user.id);
  if (!lab) return NextResponse.json({ message: 'Laboratório não encontrado.' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const versionLabel = typeof form?.get('versionLabel') === 'string' ? String(form.get('versionLabel')).trim().slice(0, 80) : null;
  if (!(file instanceof File)) return NextResponse.json({ message: 'Envie um arquivo.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ message: 'O arquivo deve ter até 15MB.' }, { status: 400 });
  const ext = EXT_BY_MIME[file.type];
  if (!ext) return NextResponse.json({ message: 'Formato não suportado. Envie PDF, planilha (XLS/XLSX/CSV) ou imagem (JPG/PNG).' }, { status: 400 });

  const orgSegment = lab.organization_id || 'sem-organizacao';
  const path = `${orgSegment}/${laboratoryId}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type });
  if (uploadError) {
    console.error('laboratory_price_list_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'Não foi possível salvar o arquivo.' }, { status: 500 });
  }

  // Nunca apaga a versão anterior (histórico) — só marca como não vigente.
  const { error: supersedeError } = await admin
    .from('laboratory_price_lists')
    .update({ active: false })
    .eq('laboratory_id', laboratoryId)
    .eq('active', true);
  if (supersedeError) {
    console.error('laboratory_price_list_supersede_failed', { message: supersedeError.message });
  }

  const { error: insertError } = await admin.from('laboratory_price_lists').insert({
    laboratory_id: laboratoryId,
    organization_id: lab.organization_id,
    file_path: path,
    file_name: file.name.slice(0, 180),
    content_type: file.type,
    size_bytes: file.size,
    version_label: versionLabel,
    active: true,
    uploaded_by: user.id
  });
  if (insertError) {
    console.error('laboratory_price_list_insert_failed', { message: insertError.message });
    return NextResponse.json({ message: 'O arquivo foi salvo, mas não foi possível registrar a versão.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Arquivo enviado.' });
}
