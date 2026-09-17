import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { notFound, redirect } from 'next/navigation';
import { verificationActor } from '@/lib/verification-auth';
import { publicEnv } from '@/lib/env';
import { formatPrescriptionDate } from '@/lib/prescription-verification';
import { PrescriptionPrintButton } from '@/components/prescription-print-button';
import { formatSignedSphere } from '@/lib/prescription-format';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Prescrição óptica', robots: { index: false, follow: false } };
export default async function PrescriptionDocument({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { id } = await params;
  const preview = (await searchParams).preview === '1';
  const actor = await verificationActor();
  if (!actor) redirect('/entrar');
  const { data: rx } = await actor.admin.from('issued_prescriptions').select('*').eq('id', id).maybeSingle();
  if (!rx) notFound();
  const { data: account } = await actor.admin.from('client_user_accounts').select('client_id').eq('user_id', actor.user.id).eq('client_id', rx.client_id).maybeSingle();
  if (rx.professional_user_id !== actor.user.id && !account && !actor.master) notFound();
  const [{ data: order }, { data: professionalProfile }] = await Promise.all([
    actor.admin.from('orders').select('status').eq('id', rx.order_id).maybeSingle(),
    actor.admin.from('professional_profiles').select('professional_kind,council_registration,technical_responsible_registration').eq('id', rx.professional_profile_id).maybeSingle()
  ]);
  const active = rx.status === 'active' && order?.status !== 'cancelled';
  const professionalCategory = professionalProfile?.professional_kind === 'bacharel'
    ? 'Bacharel em Optometria'
    : professionalProfile?.professional_kind === 'optometrista'
      ? 'Optometrista'
      : 'Optometrista';
  const professionalRegistration = professionalProfile?.council_registration?.trim()
    || professionalProfile?.technical_responsible_registration?.trim()
    || rx.professional_registration?.trim()
    || 'Não informado no perfil';
  const verificationUrl = `${publicEnv.appUrl()}/verificar/${rx.verification_code}`;
  const qr = await QRCode.toDataURL(verificationUrl, { width: 300, margin: 4, errorCorrectionLevel: 'M' });
  const value = (input: unknown, axis = false) => {
    if (input === null || input === undefined || input === '') return '—';
    const n = Number(input);
    return Number.isFinite(n) ? axis ? `${n}°` : formatSignedSphere(n, ',') : '—';
  };
  return <><div className="rx-issued-actions"><PrescriptionPrintButton /><Link className="button secondary" href={`/verificar/${rx.verification_code}`} target={preview ? '_blank' : undefined} rel={preview ? 'noopener noreferrer' : undefined}>Verificar emissão</Link></div>
    <article className={`rx-issued-paper${preview ? ' rx-preview-document' : ''}`}>
      <Image className="rx-issued-logo" src="/optotica-logo-transparent.png" width={1200} height={628} alt="Optótica" priority />
      <h1>AVALIAÇÃO OPTOMÉTRICA</h1><h2>PRESCRIÇÃO ÓPTICA</h2>
      {!active && <p role="alert"><strong>{rx.status === 'superseded' ? 'PRESCRIÇÃO SUBSTITUÍDA' : 'PRESCRIÇÃO CANCELADA'} — solicite a versão atual.</strong></p>}
      <p className="rx-issued-patient">Paciente: <strong>{rx.patient_name}</strong></p>
      <table><thead><tr><th scope="col">Olho</th><th scope="col">Esférico</th><th scope="col">Cilíndrico</th><th scope="col">Eixo</th><th scope="col">Adição</th></tr></thead><tbody>{['od','oe'].map(eye => <tr key={eye}><th scope="row">{eye.toUpperCase()}</th><td>{value(rx.prescription_data[eye]?.esferico)}</td><td>{value(rx.prescription_data[eye]?.cilindrico)}</td><td>{value(rx.prescription_data[eye]?.eixo, true)}</td><td>{value(rx.prescription_data[eye]?.adicao)}</td></tr>)}</tbody></table>
      <p>Data de emissão: {formatPrescriptionDate(rx.issued_at)}</p><div className="rx-issued-notes"><strong>Observações:</strong><p>{rx.observations || '—'}</p></div>
      <div className="rx-issued-footer"><div><strong>{rx.professional_name}</strong><p><strong>Categoria profissional:</strong> {professionalCategory}</p><p><strong>Registro no conselho:</strong> {professionalRegistration}</p><p>Emissão verificável pelo Portal Optótica.</p><p>Assinatura digital do profissional não incorporada.</p></div><Image unoptimized src={qr} width={132} height={132} alt="QR Code de verificação da prescrição" /></div>
      <p className="verification-code">Código: {rx.verification_code}<br />Versão {rx.version} · {publicEnv.appUrl()}/verificar</p>
      <div className="rx-issued-disclaimer"><strong>FAÇA SEUS ÓCULOS EM SUA ÓTICA DE PREFERÊNCIA</strong><p>Avaliação optométrica para fins de correção óptica.</p><p>Não substitui avaliação médica oftalmológica quando necessária.</p></div>
    </article></>;
}
