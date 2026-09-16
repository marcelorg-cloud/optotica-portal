import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { verificationActor } from '@/lib/verification-auth';
import { documentKinds, verificationStatusLabels, formatPrescriptionDate } from '@/lib/prescription-verification';
import { VerificationForm } from '@/components/verification-form';
export const metadata: Metadata = { title: 'Verificação profissional' };
export default async function ProfessionalVerification() {
  const actor = await verificationActor();
  if (!actor) redirect('/entrar');
  if (!actor.profile || actor.profile.account_type !== 'professional') return <div className="page-shell"><section className="card verification-section"><h1>Verificação profissional</h1><p>Esta verificação se aplica ao cadastro individual do profissional optométrico.</p><Link href="/profissional/cadastro">Voltar ao perfil</Link></section></div>;
  const { data: latest, error } = await actor.admin.from('professional_verification_requests').select('id,status,course,institution,created_at,review_notes,valid_until').eq('professional_profile_id', actor.profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return <div className="page-shell verification-shell"><section className="card verification-hero"><p className="eyebrow">Meu perfil</p><h1>Verificação profissional</h1><p className="muted">Envie seus documentos para conferência da Optótica. O selo será exibido nas consultas das prescrições após a aprovação documental.</p>
    {error ? <p className="setup-note">O recebimento de documentos está temporariamente indisponível.</p> : <>
      <span className="verification-status">{latest ? verificationStatusLabels[latest.status] : 'Documentação ainda não enviada'}</span>
      {latest?.valid_until && <p>Revisão até: {formatPrescriptionDate(latest.valid_until)}</p>}
      {latest?.review_notes && <p className="setup-note">Retorno da equipe: {latest.review_notes}</p>}
      {latest && <div className="verification-actions">{Object.entries(documentKinds).map(([kind,label]) => <a key={kind} className="text-link" href={`/api/verification-documents/${latest.id}/${kind}`} target="_blank" rel="noopener noreferrer">{label}</a>)}</div>}
      <h2 style={{ marginTop: 30 }}>{latest ? 'Enviar nova documentação' : 'Documentos para análise'}</h2>
      <p className="verification-upload-note">PDFs de até 1 MB cada. Os originais ficam privados. Uma nova submissão inicia outra análise e suspende a exibição do selo anterior.</p>
      <VerificationForm endpoint="/api/professional/verification" buttonLabel="Enviar para conferência">
        <label>Curso / qualificação<input name="course" required maxLength={160} defaultValue={latest?.course || ''} /></label>
        <label>Instituição de ensino<input name="institution" required maxLength={160} defaultValue={latest?.institution || ''} /></label>
        {Object.entries(documentKinds).map(([kind,label]) => <label key={kind}>{label}<input type="file" name={kind} accept="application/pdf" required /></label>)}
        <label><span><input type="checkbox" name="confirmed" value="yes" required /> Confirmo que os documentos pertencem a mim e que as informações apresentadas são verdadeiras.</span></label>
      </VerificationForm>
      <p className="fine-print">Assine os documentos aplicáveis no <a href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer">assinador gov.br</a> e envie os PDFs originais. Imagem de assinatura não substitui a assinatura eletrônica. Solicite à equipe Optótica o contrato e a declaração para assinatura.</p>
    </>}
  </section></div>;
}
