import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { verificationActor } from '@/lib/verification-auth';
import { documentKinds, formatPrescriptionDate } from '@/lib/prescription-verification';
import { VerificationTerms } from '@/components/verification-terms';
import { optoticaOperator } from '@/lib/optotica-operator';
import { VerificationForm } from '@/components/verification-form';
import { VerificationSummary } from '@/components/verification-summary';
export const metadata: Metadata = { title: 'Verificação profissional' };
export default async function ProfessionalVerification() {
  const actor = await verificationActor();
  if (!actor) redirect('/entrar');
  if (!actor.profile || actor.profile.account_type !== 'professional') return <div className="page-shell"><section className="card verification-section"><h1>Verificação profissional</h1><p>Esta verificação se aplica ao cadastro individual do profissional optométrico.</p><Link href="/profissional/cadastro">Voltar ao perfil</Link></section></div>;
  const { data: latest, error } = await actor.admin.from('professional_verification_requests').select('id,status,professional_name,registration,course,institution,created_at,review_notes,valid_until,documents,terms_acceptance').eq('professional_profile_id', actor.profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return <div className="page-shell verification-shell"><section className="card verification-hero"><p className="eyebrow">Meu perfil</p><h1>Verificação profissional</h1><p className="muted">Envie seus documentos para conferência da Optótica. O selo será exibido nas consultas das prescrições após a aprovação documental.</p>
    {error ? <p className="setup-note">O recebimento de documentos está temporariamente indisponível.</p> : <>
      <VerificationSummary profile={actor.profile} review={latest} />
      {latest?.valid_until && <p>Revisão até: {formatPrescriptionDate(latest.valid_until)}</p>}
      {latest?.review_notes && <p className="setup-note">Retorno da equipe: {latest.review_notes}</p>}
      {latest && <div className="verification-actions">{Object.entries(documentKinds).filter(([kind]) => latest.documents?.[kind]).map(([kind,label]) => <a key={kind} className="text-link" href={`/api/verification-documents/${latest.id}/${kind}`} target="_blank" rel="noopener noreferrer">{label}</a>)}</div>}
      <section className="verification-download">
        <h2>1. Baixe e assine sua declaração</h2>
        <p>O PDF será preenchido com os dados do seu perfil e da {optoticaOperator.legalName}, CNPJ {optoticaOperator.cnpj}.</p>
        <div className="verification-actions"><a className="button primary" href="/api/professional/verification/declaration">Baixar declaração preenchida (PDF)</a><a className="button secondary" href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer">Assinar no gov.br</a></div>
        <p className="helper">Confira seus dados, assine no gov.br e envie abaixo o PDF original assinado. Não imprima o arquivo assinado para gerar outro PDF.</p>
        <Link className="text-link" href="/profissional/cadastro">Conferir ou corrigir meu perfil</Link>
      </section>
      {latest?.terms_acceptance && <details className="verification-terms"><summary>Termos aceitos em {formatPrescriptionDate(latest.terms_acceptance.accepted_at)} · versão {latest.terms_acceptance.version}</summary><pre className="verification-terms-snapshot">{latest.terms_acceptance.text}</pre></details>}
      <h2 style={{ marginTop: 30 }}>{latest ? '2. Enviar nova documentação' : '2. Documentos para análise'}</h2>
      <p className="verification-upload-note">PDFs de até 1 MB cada. Os originais ficam privados; a equipe prepara e confere as versões públicas do diploma e do registro. Uma nova submissão inicia outra análise e suspende a exibição do selo anterior.</p>
      <VerificationForm key={latest?.id || 'new'} endpoint="/api/professional/verification" buttonLabel="Enviar para conferência">
        <label>Curso / qualificação<input name="course" required maxLength={160} defaultValue={latest?.course || ''} /></label>
        <label>Instituição de ensino<input name="institution" required maxLength={160} defaultValue={latest?.institution || ''} /></label>
        {Object.entries(documentKinds).map(([kind,label]) => <label key={kind}>{label}<input type="file" name={kind} accept="application/pdf" required /></label>)}
        <label className="verification-check"><input type="checkbox" name="confirmed" value="yes" required /><span>Confirmo que os documentos pertencem a mim e que as informações apresentadas são verdadeiras.</span></label>
        <VerificationTerms professionalName={actor.profile.display_name} registration={actor.profile.council_registration || ''} />
      </VerificationForm>
      <p className="fine-print">Assine os documentos aplicáveis no <a href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer">assinador gov.br</a> e envie os PDFs originais. Imagem de assinatura não substitui a assinatura eletrônica. O aceite acima substitui o envio de contrato assinado neste processo de verificação.</p>
    </>}
  </section></div>;
}
