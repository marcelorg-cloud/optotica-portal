import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isSameOrigin, verificationActor, verificationBucket } from '@/lib/verification-auth';
import { submittedPublicDocument } from '@/lib/verification-submitted-documents';
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const actor = await verificationActor();
  if (!actor) return NextResponse.json({ message: 'Faça login.' }, { status: 401 });
  if (!actor.master) return NextResponse.json({ message: 'Acesso restrito à administração.' }, { status: 403 });
  const { requestId } = await params;
  const uploadedPaths: string[] = [];
  let stage = 'read_form';
  const reject = (message: string, reason: string, status = 400) => {
    console.warn('verification_review_rejected', { requestId, stage, reason });
    return NextResponse.json({ message }, { status });
  };
  try {
    const form = await request.formData();
    const decision = String(form.get('decision') || '');
    const notes = String(form.get('notes') || '').trim();
    if (!['verified','changes_requested','revoked'].includes(decision) || notes.length < 10 || notes.length > 2000) return reject('Selecione a decisão e informe os detalhes da conferência, entre 10 e 2.000 caracteres.', 'decision_or_notes');
    stage = 'load_request';
    const { data: record, error: recordError } = await actor.admin.from('professional_verification_requests').select('id,professional_profile_id,status,documents,terms_acceptance,public_documents_consent_at').eq('id', requestId).maybeSingle();
    if (recordError) throw new Error('Não foi possível consultar a solicitação. Tente novamente.');
    if (!record) return reject('Solicitação não encontrada.', 'request_not_found', 404);
    const { data: latest, error: latestError } = await actor.admin.from('professional_verification_requests').select('id').eq('professional_profile_id', record.professional_profile_id).order('created_at', { ascending: false }).limit(1).single();
    if (latestError) throw new Error('Não foi possível consultar a análise mais recente. Tente novamente.');
    const expected = decision === 'revoked' ? 'verified' : 'under_review';
    if (latest?.id !== record.id || record.status !== expected) return reject('Esta solicitação mudou. Atualize a página.', 'stale_request', 409);
    const updates: Record<string, unknown> = { status: decision, review_notes: notes, reviewed_by: actor.user.id, reviewed_at: new Date().toISOString() };
    if (decision === 'verified') {
      stage = 'validate_approval';
      const scope = String(form.get('scope') || '').trim();
      const until = String(form.get('validUntil') || '');
      if (scope.length < 10 || scope.length > 1000) return reject('Preencha o escopo público com 10 a 1.000 caracteres.', 'public_scope');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < new Date().toISOString().slice(0, 10)) return reject('Informe a validade da verificação, com data de hoje ou posterior.', 'valid_until');
      if (form.get('signaturesChecked') !== 'yes') return reject('Marque a confirmação de conferência das assinaturas, identidade e documentação.', 'signatures_unconfirmed');
      if (!record.terms_acceptance || !record.public_documents_consent_at) return reject('O profissional precisa aceitar os termos atuais e autorizar a divulgação antes da aprovação.', 'terms_or_consent_missing');
      if (form.get('submittedDocumentsChecked') !== 'yes') return reject('Atualize a página e confirme que o diploma e o registro já enviados estão conferidos e adequados à consulta pública.', 'submitted_copies_unconfirmed');
      stage = 'read_submitted_credentials';
      const publicFiles = await Promise.all(['diploma', 'registration'].map(async kind => {
        const label = kind === 'diploma' ? 'Diploma/certificado' : 'Registro no conselho';
        const document = submittedPublicDocument(record.professional_profile_id, record.id, record.documents, kind);
        if (!document) throw new Error(`${label}: documento enviado não encontrado. Solicite a correção ao profissional.`);
        const { data: file, error } = await actor.admin.storage.from(verificationBucket).download(document.path);
        if (error || !file) throw new Error(`${label}: não foi possível ler o arquivo enviado. Tente novamente.`);
        if (file.size > 1000000) throw new Error(`${label}: o arquivo excede o limite de 1 MB.`);
        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(buffer).digest('hex') !== document.sha256) throw new Error(`${label}: o arquivo não corresponde ao envio registrado. Solicite uma nova submissão.`);
        return { kind, buffer };
      }));
      stage = 'prepare_public_copies';
      const publicDocuments: Record<string, { path: string; sha256: string }> = {};
      for (const { kind, buffer: publicBuffer } of publicFiles) {
        const path = `${record.professional_profile_id}/${record.id}/public-${kind}-${randomUUID()}.pdf`;
        const { error } = await actor.admin.storage.from(verificationBucket).upload(path, publicBuffer, { contentType: 'application/pdf', upsert: false });
        if (error) throw new Error('Não foi possível guardar as versões públicas.');
        uploadedPaths.push(path);
        publicDocuments[kind] = { path, sha256: createHash('sha256').update(publicBuffer).digest('hex') };
      }
      Object.assign(updates, { public_documents: publicDocuments, public_documents_checked: true });
      Object.assign(updates, { public_scope: scope, valid_until: until, signatures_checked: true });
    }
    stage = 'save_decision';
    const { data, error } = await actor.admin.from('professional_verification_requests').update(updates).eq('id', record.id).eq('status', expected).select('id,status').maybeSingle();
    if (error) {
      console.error('verification_decision_save_failed', { requestId, code: error.code });
      throw new Error('A decisão não foi salva. Atualize a página e tente novamente.');
    }
    if (!data) throw new Error('A solicitação mudou durante a análise. Atualize a página para consultar a decisão atual.');
    uploadedPaths.length = 0; // The database trigger records the decision and its previous evidence atomically.
    stage = 'refresh_status';
    try {
      revalidatePath('/admin');
      revalidatePath(`/admin/verificacao/${record.professional_profile_id}`);
      revalidatePath('/profissional');
      revalidatePath('/profissional/verificacao');
    } catch { console.warn('verification_status_refresh_failed', { requestId }); }
    console.info('verification_decision_saved', { requestId, status: data.status });
    return NextResponse.json({ status: data.status, message: data.status === 'verified' ? 'Aprovação documental salva. O profissional está verificado durante a validade informada, enquanto seu cadastro e registro permanecerem válidos.' : data.status === 'changes_requested' ? 'Solicitação de ajustes salva. O profissional deve consultar o retorno e reenviar os documentos.' : 'Revogação registrada. O selo foi desativado.' });
  } catch (error) {
    console.error('verification_review_failed', { requestId, stage });
    if (uploadedPaths.length) await actor.admin.storage.from(verificationBucket).remove(uploadedPaths);
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível registrar a conferência.' }, { status: 400 });
  }
}
