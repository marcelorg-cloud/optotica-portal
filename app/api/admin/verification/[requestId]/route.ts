import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOrigin, verificationActor, verificationBucket, readPdf } from '@/lib/verification-auth';
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const actor = await verificationActor();
  if (!actor) return NextResponse.json({ message: 'Faça login.' }, { status: 401 });
  if (!actor.master) return NextResponse.json({ message: 'Acesso restrito à administração.' }, { status: 403 });
  const { requestId } = await params;
  const uploadedPaths: string[] = [];
  try {
    const form = await request.formData();
    const decision = String(form.get('decision') || '');
    const notes = String(form.get('notes') || '').trim();
    if (!['verified','changes_requested','revoked'].includes(decision) || notes.length < 10 || notes.length > 2000) return NextResponse.json({ message: 'Informe a decisão e os detalhes da conferência.' }, { status: 400 });
    const { data: record } = await actor.admin.from('professional_verification_requests').select('id,professional_profile_id,status,terms_acceptance,public_documents_consent_at').eq('id', requestId).maybeSingle();
    if (!record) return NextResponse.json({ message: 'Solicitação não encontrada.' }, { status: 404 });
    const { data: latest } = await actor.admin.from('professional_verification_requests').select('id').eq('professional_profile_id', record.professional_profile_id).order('created_at', { ascending: false }).limit(1).single();
    const expected = decision === 'revoked' ? 'verified' : 'under_review';
    if (latest?.id !== record.id || record.status !== expected) return NextResponse.json({ message: 'Esta solicitação mudou. Atualize a página.' }, { status: 409 });
    const updates: Record<string, unknown> = { status: decision, review_notes: notes, reviewed_by: actor.user.id, reviewed_at: new Date().toISOString() };
    if (decision === 'verified') {
      const scope = String(form.get('scope') || '').trim();
      const until = String(form.get('validUntil') || '');
      if (scope.length < 10 || scope.length > 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(until) || until < new Date().toISOString().slice(0, 10) || form.get('signaturesChecked') !== 'yes') return NextResponse.json({ message: 'Para aprovar, informe o escopo público, a data de revisão e confirme a conferência das assinaturas.' }, { status: 400 });
      if (!record.terms_acceptance || !record.public_documents_consent_at || form.get('publicDocumentsChecked') !== 'yes') return NextResponse.json({ message: 'A aprovação exige aceite dos termos, autorização do profissional e conferência das duas versões públicas.' }, { status: 400 });
      const publicFiles = await Promise.all(['diploma', 'registration'].map(async kind => ({ kind, buffer: await readPdf(form.get(`public_${kind}`)) })));
      const buffer = await readPdf(form.get('attestation'));
      const uploadedPath = `${record.professional_profile_id}/${record.id}/attestation-${randomUUID()}.pdf`;
      const { error: uploadError } = await actor.admin.storage.from(verificationBucket).upload(uploadedPath, buffer, { contentType: 'application/pdf' });
      if (uploadError) throw new Error('Não foi possível guardar a declaração.');
      uploadedPaths.push(uploadedPath);
      const publicDocuments: Record<string, { path: string; sha256: string }> = {};
      for (const { kind, buffer: publicBuffer } of publicFiles) {
        const path = `${record.professional_profile_id}/${record.id}/public-${kind}-${randomUUID()}.pdf`;
        const { error } = await actor.admin.storage.from(verificationBucket).upload(path, publicBuffer, { contentType: 'application/pdf', upsert: false });
        if (error) throw new Error('Não foi possível guardar as versões públicas.');
        uploadedPaths.push(path);
        publicDocuments[kind] = { path, sha256: createHash('sha256').update(publicBuffer).digest('hex') };
      }
      Object.assign(updates, { public_documents: publicDocuments, public_documents_checked: true });
      Object.assign(updates, { public_scope: scope, valid_until: until, signatures_checked: true, attestation_path: uploadedPath, attestation_sha256: createHash('sha256').update(buffer).digest('hex') });
    }
    const { data, error } = await actor.admin.from('professional_verification_requests').update(updates).eq('id', record.id).eq('status', expected).select('id').maybeSingle();
    if (error || !data) throw new Error('Não foi possível registrar. Atualize a página e tente novamente.');
    uploadedPaths.length = 0; // The database trigger records the decision and its previous evidence atomically.
    return NextResponse.json({ message: 'Decisão registrada.' });
  } catch (error) {
    if (uploadedPaths.length) await actor.admin.storage.from(verificationBucket).remove(uploadedPaths);
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível registrar a conferência.' }, { status: 400 });
  }
}
