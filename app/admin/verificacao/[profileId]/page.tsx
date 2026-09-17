import { redirect, notFound } from 'next/navigation';
import { verificationActor } from '@/lib/verification-auth';
import { documentKinds, verificationStatusLabels, formatPrescriptionDate } from '@/lib/prescription-verification';
import { VerificationForm } from '@/components/verification-form';
export default async function VerificationReview({ params }: { params: Promise<{ profileId: string }> }) {
  const actor = await verificationActor();
  if (!actor) redirect('/entrar');
  if (!actor.master) notFound();
  const { profileId } = await params;
  const { data: profile } = await actor.admin.from('professional_profiles').select('display_name,account_type').eq('id', profileId).maybeSingle();
  if (!profile || profile.account_type !== 'professional') notFound();
  const { data: requests, error } = await actor.admin.from('professional_verification_requests').select('id,status,course,institution,professional_name,registration,created_at,review_notes,public_scope,attestation_path,valid_until,documents,terms_acceptance,public_documents_consent_at,public_documents').eq('professional_profile_id', profileId).order('created_at', { ascending: false });
  return <div className="page-shell verification-shell"><h1>Conferência documental</h1><p>{profile.display_name}</p>
    {error && <p className="setup-note">Não foi possível consultar os documentos.</p>}
    {!error && !requests?.length && <p className="setup-note">Este profissional ainda não enviou a documentação.</p>}
    {requests?.map((record, index) => <section key={record.id} className="card verification-section"><span className="verification-status">{verificationStatusLabels[record.status]}{index > 0 ? ' · histórico' : ''}</span><h2>{record.course}</h2><p>{record.institution} · {record.registration}</p><p>Enviado em {formatPrescriptionDate(record.created_at)}</p>
      <div className="verification-actions">{Object.entries(documentKinds).filter(([kind]) => record.documents?.[kind]).map(([kind,label]) => <a key={kind} className="text-link" href={`/api/verification-documents/${record.id}/${kind}`} target="_blank" rel="noopener noreferrer">{label}</a>)}{record.attestation_path && <a className="text-link" href={`/api/verification-documents/${record.id}/attestation`}>Declaração assinada da Optótica</a>}</div>
      {record.terms_acceptance && <details className="verification-terms"><summary>Termos aceitos · versão {record.terms_acceptance.version} · {formatPrescriptionDate(record.terms_acceptance.accepted_at)}</summary><p className="helper">Aceite registrado pelo usuário autenticado. Autorização de divulgação: {record.public_documents_consent_at ? 'sim' : 'não'}.</p><pre className="verification-terms-snapshot">{record.terms_acceptance.text}</pre></details>}
      {record.documents?.agreement && <a className="text-link" href={`/api/verification-documents/${record.id}/agreement`}>Contrato anterior (histórico)</a>}
      {['diploma', 'registration'].filter(kind => record.public_documents?.[kind]).map(kind => <p key={kind}><a className="text-link" href={`/api/verification-documents/${record.id}/public_${kind}`}>Versão pública: {kind === 'diploma' ? 'formação' : 'registro no conselho'}</a></p>)}
      {record.review_notes && <p>{record.review_notes}</p>}
      {index === 0 && record.status === 'under_review' && <>
        <p className="setup-note">Confira a formação com a instituição, o registro com a entidade emissora e as assinaturas pelo <a href="https://validar.iti.gov.br/" target="_blank" rel="noopener noreferrer">VALIDAR do ITI</a>. Registre as fontes e o resultado. O sistema não valida criptograficamente as assinaturas enviadas.</p>
        <VerificationForm endpoint={`/api/admin/verification/${record.id}`} buttonLabel="Registrar decisão">
          <label>Decisão<select name="decision" required><option value="changes_requested">Solicitar ajustes</option><option value="verified">Aprovar verificação documental</option></select></label>
          <label>Fontes consultadas e resultado da conferência (privado)<textarea name="notes" required minLength={10} maxLength={2000} /></label>
          <label>Escopo da verificação para exibição pública (sem dados pessoais)<textarea name="scope" maxLength={1000} placeholder="Descreva somente a formação, o registro e os documentos efetivamente conferidos." /></label>
          <label>Revisão até (obrigatória para aprovação)<input type="date" name="validUntil" /></label>
          <label>Declaração de conferência da Optótica assinada (PDF até 1 MB)<input type="file" name="attestation" accept="application/pdf" /></label>
          <label>Diploma/certificado para consulta pública (PDF até 1 MB)<input type="file" name="public_diploma" accept="application/pdf" /></label>
          <label>Registro no conselho para consulta pública (PDF até 1 MB)<input type="file" name="public_registration" accept="application/pdf" /></label>
          <p className="helper">Envie cópias para divulgação sem CPF, RG, endereço residencial, assinatura manuscrita ou outros dados desnecessários. Confira a correspondência com os originais. Os originais e a declaração assinada permanecem privados.</p>
          <label className="verification-check"><input type="checkbox" name="publicDocumentsChecked" value="yes" /><span>Conferi as versões públicas e a autorização do profissional. As cópias preservam nome, formação e registro necessários à consulta.</span></label>
          <label><span><input type="checkbox" name="signaturesChecked" value="yes" /> Conferi as assinaturas, a identidade e a documentação. A declaração assinada corresponde a esta análise.</span></label>
        </VerificationForm>
      </>}
      {index === 0 && record.status === 'verified' && <VerificationForm endpoint={`/api/admin/verification/${record.id}`} buttonLabel="Revogar verificação"><input type="hidden" name="decision" value="revoked" /><label>Motivo da revogação<textarea name="notes" minLength={10} maxLength={2000} required /></label></VerificationForm>}
    </section>)}
  </div>;
}
