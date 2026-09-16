import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { verificationCodePattern } from '@/lib/prescription-verification';
export const metadata: Metadata = { title: 'Verificar prescrição', robots: { index: false, follow: false } };
export default async function VerificationHome({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  if (code && verificationCodePattern.test(code.trim())) redirect(`/verificar/${code.trim()}`);
  return <div className="page-shell verification-shell"><section className="card verification-hero">
    <p className="eyebrow">Consulta de emissão</p><h1>Verificar prescrição</h1>
    <p className="muted">Leia o QR Code da sua prescrição ou informe o código completo impresso no documento.</p>
    <form className="stack" action="/verificar"><label htmlFor="verification-code">Código da prescrição</label><input id="verification-code" name="code" required minLength={64} maxLength={64} pattern="[a-f0-9]{64}" autoCapitalize="none" autoComplete="off" spellCheck={false} /><button className="button primary">Consultar prescrição</button></form>
    {code && <p role="alert">Confira o código: ele deve conter os 64 caracteres que aparecem no documento.</p>}
    <p className="fine-print">A consulta pública apresenta apenas a identificação parcial do paciente e os dados de verificação.</p>
  </section></div>;
}
