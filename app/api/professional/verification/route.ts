import { randomUUID, createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOrigin, verificationActor, verificationBucket, readPdf } from '@/lib/verification-auth';
import { documentKinds } from '@/lib/prescription-verification';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const actor = await verificationActor();
  if (!actor) return NextResponse.json({ message: 'Faça login.' }, { status: 401 });
  if (!actor.profile || actor.profile.account_type !== 'professional' || actor.profile.status !== 'approved') return NextResponse.json({ message: 'É necessário um cadastro individual aprovado para solicitar a verificação.' }, { status: 403 });
  if (Number(request.headers.get('content-length')) > 4200000) return NextResponse.json({ message: 'Envie PDFs de até 1 MB cada.' }, { status: 413 });
  const uploaded: string[] = [];
  try {
    const form = await request.formData();
    const course = String(form.get('course') || '').trim();
    const institution = String(form.get('institution') || '').trim();
    if (!course || !institution || course.length > 160 || institution.length > 160 || form.get('confirmed') !== 'yes') return NextResponse.json({ message: 'Preencha a formação e confirme as informações.' }, { status: 400 });
    const files = await Promise.all(Object.keys(documentKinds).map(async kind => ({ kind, buffer: await readPdf(form.get(kind)) })));
    const id = randomUUID();
    const documents: Record<string, { path: string; sha256: string }> = {};
    for (const { kind, buffer } of files) {
      const path = `${actor.profile.id}/${id}/${kind}.pdf`;
      const { error } = await actor.admin.storage.from(verificationBucket).upload(path, buffer, { contentType: 'application/pdf', upsert: false });
      if (error) throw new Error('Não foi possível guardar os documentos. Tente novamente.');
      uploaded.push(path);
      documents[kind] = { path, sha256: createHash('sha256').update(buffer).digest('hex') };
    }
    const { error } = await actor.admin.from('professional_verification_requests').insert({ id, professional_profile_id: actor.profile.id, professional_name: actor.profile.display_name, registration: actor.profile.council_registration || '', course, institution, documents });
    if (error) throw new Error('Não foi possível registrar o envio. Tente novamente.');
    return NextResponse.json({ message: 'Documentação enviada. Aguarde a conferência da Optótica.' });
  } catch (error) {
    if (uploaded.length) await actor.admin.storage.from(verificationBucket).remove(uploaded);
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível enviar os documentos.' }, { status: 400 });
  }
}
