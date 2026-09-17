import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { optoticaOperator } from '@/lib/optotica-operator';
import { isCurrentVerification, publicVerificationDocument } from '@/lib/public-verification';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { formatPrescriptionDate, maskPatientName, verificationCodePattern } from '@/lib/prescription-verification';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verificação da prescrição', robots: { index: false, follow: false } };
function Unavailable({ temporary = false }: { temporary?: boolean }) {
  return <div className="page-shell verification-shell"><section className="card verification-hero"><h1>{temporary ? 'Consulta temporariamente indisponível' : 'Prescrição não localizada'}</h1><p>{temporary ? 'Tente novamente em alguns instantes.' : 'Confira o código no documento ou fale com o profissional responsável.'}</p><Link className="button secondary" href="/verificar">Voltar à consulta</Link></section></div>;
}
async function lookup(code: string) {
  try {
    const admin = createAdminSupabaseClient();
    // Deliberately exclude clinical values, document numbers, contact data and file paths.
    const { data: rx, error } = await admin.from('issued_prescriptions').select('patient_name,professional_name,professional_registration,professional_profile_id,issued_at,status,version,order_id').eq('verification_code', code).maybeSingle();
    if (error) return { state: 'error' as const };
    if (!rx) return { state: 'missing' as const };
    const [{ data: profile }, { data: review }, { data: order }] = await Promise.all([
      admin.from('professional_profiles').select('status,display_name,council_registration').eq('id', rx.professional_profile_id).maybeSingle(),
      admin.from('professional_verification_requests').select('id,status,professional_name,registration,course,institution,reviewed_at,valid_until,public_scope,public_documents_consent_at,public_documents_checked,public_documents').eq('professional_profile_id', rx.professional_profile_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('orders').select('status').eq('id', rx.order_id).maybeSingle()
    ]);
    return { state: 'found' as const, rx, profile, review, order };
  } catch { return { state: 'error' as const }; }
}
export default async function VerifyPrescription({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!verificationCodePattern.test(code)) return <Unavailable />;
  const result = await lookup(code);
  if (result.state === 'error') return <Unavailable temporary />;
  if (result.state === 'missing') return <Unavailable />;
  const { rx, profile, review, order } = result;
    const verified = isCurrentVerification(profile, review);
    const status = order?.status === 'cancelled' ? 'cancelled' : rx.status;
    const labels: Record<string, string> = { active: 'Emissão registrada · versão vigente', superseded: 'Prescrição substituída', cancelled: 'Prescrição cancelada' };
    return <div className="page-shell verification-shell">
      <section className="card verification-hero"><p className="eyebrow">Portal Optótica · Verificação</p>
        {verified ? <div className="verified-professional-seal">
          <Image src="/optotica-profissional-verificado-v1.png" alt="" width={1254} height={1254} sizes="(max-width: 600px) calc(100vw - 88px), 480px" priority />
          <div className="verified-professional-accessible"><h1>Profissional verificado</h1><p>Documentação conferida pela Optótica · verificação vigente</p></div>
        </div> : <h1>Verificação da prescrição</h1>}
        <span className="verification-status">{labels[status]}</span>
        {status !== 'active' && <p className="setup-note">Esta versão não deve ser utilizada. Solicite a prescrição atual ao profissional.</p>}
        <dl className="verification-details"><div><dt>Paciente</dt><dd>{maskPatientName(rx.patient_name)}</dd></div><div><dt>Emitida em</dt><dd>{formatPrescriptionDate(rx.issued_at)}</dd></div><div><dt>Profissional emissor</dt><dd>{rx.professional_name}</dd></div><div><dt>Registro informado na emissão</dt><dd>{rx.professional_registration || 'Não informado'}</dd></div><div><dt>Versão</dt><dd>{rx.version}</dd></div></dl>
        <p className="verification-code">Código: {code}</p><p className="fine-print">Esta consulta confirma o registro da emissão no portal. Ela não substitui a assinatura digital do PDF nem comprova, sozinha, que uma cópia impressa não foi alterada.</p>
      </section>
      <section className="card verification-section"><p className="eyebrow">Documentação profissional</p><h2>{verified ? 'Documentação verificada pela Optótica' : 'Sem verificação documental vigente'}</h2>
        {verified && review ? <><dl className="verification-details"><div><dt>Formação conferida</dt><dd>{review.course}</dd></div><div><dt>Instituição</dt><dd>{review.institution}</dd></div><div><dt>Conferência realizada em</dt><dd>{formatPrescriptionDate(review.reviewed_at)}</dd></div><div><dt>Revisão até</dt><dd>{formatPrescriptionDate(review.valid_until)}</dd></div></dl><p>{review.public_scope}</p>
          {status === 'active' && <div className="verification-public-documents">{(['diploma', 'registration'] as const).map(kind => publicVerificationDocument(rx.professional_profile_id, review, kind) ? <a key={kind} className="button secondary" href={`/api/public/verification/${code}/${kind}`}>{kind === 'diploma' ? 'Baixar diploma / certificado' : 'Baixar registro no conselho'}</a> : <p key={kind} className="helper">{kind === 'diploma' ? 'Diploma/certificado' : 'Registro no conselho'}: versão pública ainda não disponibilizada.</p>)}</div>}
          <p className="helper">Cópias para consulta pública, com ocultação de dados pessoais não necessários. Os originais foram conferidos pela equipe.</p></> : <p className="muted">O selo é exibido somente após a conferência documental pela equipe. A aprovação do cadastro no portal é uma etapa separada.</p>}
        <p className="fine-print">A verificação documental descreve os documentos conferidos e não constitui garantia do resultado do atendimento. Documentos pessoais e contratos permanecem privados.</p>
      </section>
      <section className="card verification-section verification-operator">
        <h2 className="eyebrow">Empresa responsável pela verificação</h2>
        <div className="verification-operator-brand"><Image src="/optotica-logo-transparent.png" alt="Optótica" fill sizes="(max-width: 600px) 80vw, 540px" /></div>
        <div className="verification-operator-identification"><p>{optoticaOperator.legalName}</p><p>CNPJ {optoticaOperator.cnpj}</p></div>
        <p className="verification-operator-contact">Contato: <a href="tel:+5544991536436">(44) 99153-6436</a></p>
      </section>
      <section className="card verification-section"><h2>Consulte sua receita completa</h2><p className="muted">Os graus, observações e o nome completo ficam disponíveis no acesso protegido do paciente.</p><Link className="button primary" href="/entrar">Acessar meu portal</Link></section>
    </div>;
}
