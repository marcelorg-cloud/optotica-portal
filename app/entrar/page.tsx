import type { Metadata } from 'next';
import Link from 'next/link';
import { ProfessionalLoginForm } from '@/components/professional-login-form';
import Image from 'next/image';
import QRCode from 'qrcode';

export const metadata: Metadata = { title: 'Entrar' };

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const number = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const whatsappUrl = /^\d{10,15}$/.test(number)
    ? `https://wa.me/${number}?text=${encodeURIComponent('Olá! Já sou paciente Optótica e quero acessar meu portal.')}`
    : null;
  const qr = whatsappUrl ? await QRCode.toDataURL(whatsappUrl, { width: 240, margin: 4, errorCorrectionLevel: 'M' }) : null;
  return (
    <div className="page-shell narrow">
      <div className="login-grid">
        <section className="card login-card">
          <p className="eyebrow">Área do paciente</p>
          <h1>Já é paciente Optótica?</h1>
          <p className="muted">Fale com a gente pelo seu WhatsApp cadastrado e receba seu link de acesso ao portal.</p>
          {whatsappUrl && qr ? <div className="patient-entry-options">
            <a className="button whatsapp" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Acessar pelo WhatsApp</a>
            <figure><Image unoptimized src={qr} width={200} height={200} alt="QR Code para abrir o WhatsApp oficial da Optótica" /><figcaption>Está no computador? Aponte a câmera do celular.</figcaption></figure>
          </div> : <p className="setup-note">O acesso pelo WhatsApp está temporariamente indisponível. Utilize seu convite ou fale com o profissional responsável.</p>}
          <p className="fine-print">Envie a mensagem pelo mesmo número usado no cadastro. Seu link de acesso é pessoal e temporário.</p>
          <details className="patient-first-access"><summary>É seu primeiro acesso?</summary><p className="muted">Abra o convite enviado pelo seu profissional e confirme seu número no WhatsApp. O convite é válido por 24 horas. Se ainda não recebeu ou ele expirou, solicite um novo ao profissional.</p></details>
        </section>

        <section className="card login-card">
          <p className="eyebrow">Área profissional</p>
          <h2>Receba seu acesso por e-mail</h2>
          <p className="muted">Informe seu e-mail. Cadastros em análise também podem entrar para acompanhar o status.</p>
          <ProfessionalLoginForm />
          <p className="fine-print">Primeiro acesso? <Link className="text-link" href="/cadastrar">Cadastre seu e-mail</Link>.</p>
          <p className="fine-print">É master? <Link className="text-link" href="/entrar/master">Entrar com senha</Link>.</p>
        </section>
      </div>
    </div>
  );
}
