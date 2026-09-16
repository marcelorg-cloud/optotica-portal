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
  const { data: requests, error } = await actor.admin.from('professional_verification_requests').select('id,status,course,institution,professional_name,registration,created_at,review_notes,public_scope,attestation_path,valid_until').eq('professional_profile_id', profileId).order('created_at', { ascending: false });
  return <div className="page-shell verification-shell"><h1>Conferência documental</h1><p>{profile.display_name}</p>
    {error && <p className="setup-note">Não foi possível consultar os documentos.</p>}
    {!error && !requests?.length && <p className="setup-note">Este profissional ainda não enviou a documentação.</p>}
    {requests?.map((record, index) => <section key={record.id} className="card verification-section"><span className="verification-status">{verificationStatusLabels[record.status]}{index > 0 ? ' · histórico' : ''}</span><h2>{record.course}</h2><p>{record.institution} · {record.registration}</p><p>Enviado em {formatPrescriptionDate(record.created_at)}</p>
      <div className="verification-actions">{Object.entries(documentKinds).map(([kind,label]) => <a key={kind} className="text-link" href={`/api/verification-documents/${record.id}/${kind}`} target="_blank" rel="noopener noreferrer">{label}</a>)}{record.attestation_path && <a className="text-link" href={`/api/verification-documents/${record.id}/attestation`}>Declaração assinada da Optótica</a>}</div>
      {record.review_notes && <p>{record.review_notes}</p>}
      {index === 0 && record.status === 'under_review' && <>
        <p className="setup-note">Confira a formação com a instituição, o registro com a entidade emissora e as assinaturas pelo <a href="https://validar.iti.gov.br/" target="_blank" rel="noopener noreferrer">VALIDAR do ITI</a>. Registre as fontes e o resultado. O sistema não valida criptograficamente as assinaturas enviadas.</p>
        <VerificationForm endpoint={`/api/admin/verification/${record.id}`} buttonLabel="Registrar decisão">
          <label>Decisão<select name="decision" required><option value="changes_requested">Solicitar ajustes</option><option value="verified">Aprovar verificação documental</option></select></label>
          <label>Fontes consultadas e resultado da conferência (privado)<textarea name="notes" required minLength={10} maxLength={2000} /></label>
          <label>Escopo da verificação para exibição pública (sem dados pessoais)<textarea name="scope" maxLength={1000} placeholder="Descreva somente a formação, o registro e os documentos efetivamente conferidos." /></label>
          <label>Revisão até (obrigatória para aprovação)<input type="date" name="validUntil" /></label>
          <label>Declaração de conferência da Optótica assinada (PDF até 1 MB)<input type="file" name="attestation" accept="application/pdf" /></label>
          <label><span><input type="checkbox" name="signaturesChecked" value="yes" /> Conferi as assinaturas, a identidade e a documentação. A declaração assinada corresponde a esta análise.</span></label>
        </VerificationForm>
      </>}
      {index === 0 && record.status === 'verified' && <VerificationForm endpoint={`/api/admin/verification/${record.id}`} buttonLabel="Revogar verificação"><input type="hidden" name="decision" value="revoked" /><label>Motivo da revogação<textarea name="notes" minLength={10} maxLength={2000} required /></label></VerificationForm>}
    </section>)}
  </div>;
}
