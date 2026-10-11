import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const runId = new URL(request.url).searchParams.get('runId');
  if (!token || !/^[a-f0-9-]{36}$/i.test(runId || '')) return NextResponse.json({ message: 'Autenticação necessária.' }, { status: 401, headers: HEADERS });
  const admin = createAdminSupabaseClient();
  const user = await admin.auth.getUser(token);
  if (user.error || !user.data.user) return NextResponse.json({ message: 'Sessão inválida.' }, { status: 401, headers: HEADERS });
  const owner = user.data.user.id;
  const [master, run] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', owner).eq('active', true).maybeSingle(),
    admin.from('regent_tool_runs').select('id,task_id,user_id,output').eq('id', runId!).eq('user_id', owner).eq('node_id', 'F4').eq('adapter', 'catalog_portal_standardize').eq('status', 'succeeded').maybeSingle(),
  ]);
  if (master.error || run.error) return NextResponse.json({ message: 'Verificação indisponível.' }, { status: 503, headers: HEADERS });
  if (!master.data || !run.data) return NextResponse.json({ message: 'Arquivo não encontrado para este operador.' }, { status: 404, headers: HEADERS });
  const catalog = (run.data.output as { catalog?: { bucket?: string; path?: string; sha256?: string } })?.catalog;
  const expected = `regente/${owner}/${run.data.task_id}/${run.data.id}/catalog.jpg`;
  if (catalog?.bucket !== 'catalog-product-photos' || catalog.path !== expected) return NextResponse.json({ message: 'Referência não canônica.' }, { status: 409, headers: HEADERS });
  const file = await admin.storage.from('catalog-product-photos').download(expected);
  if (file.error || !file.data) return NextResponse.json({ message: 'Arquivo salvo indisponível.' }, { status: 503, headers: HEADERS });
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (bytes.length > 200 * 1024 || createHash('sha256').update(bytes).digest('hex') !== catalog.sha256) return NextResponse.json({ message: 'Integridade do arquivo não confirmada.' }, { status: 409, headers: HEADERS });
  return new Response(bytes, { headers: { ...HEADERS, 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length), 'Content-Disposition': 'attachment; filename="catalogo-padronizado.jpg"' } });
}
