import type { Metadata } from 'next';
import Link from 'next/link';
import { ProfessionalLoginForm } from '@/components/professional-login-form';
import { WhatsAppLoginForm } from '@/components/whatsapp-login-form';
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
          <p className="eyebrow">Paciente ou profissional</p>
          <h1>Entre com seu WhatsApp</h1>
          <p className="muted">Informe o número já cadastrado. Você receberá um código e continuará nesta mesma tela.</p>
          <WhatsAppLoginForm />
          <p className="fine-print">O código é pessoal, funciona uma única vez e expira em poucos minutos.</p>
        </section>

        <section className="card login-card">
          <p className="eyebrow">Primeiro acesso e alternativas</p>
          <h2>Ainda não vinculou seu WhatsApp?</h2>
          <p className="muted">O primeiro acesso do paciente continua sendo liberado pelo convite do profissional.</p>
          {whatsappUrl && qr ? <details className="patient-first-access"><summary>Abrir o WhatsApp da Optótica</summary><div className="patient-entry-options">
            <a className="button whatsapp" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Falar pelo WhatsApp</a>
            <figure><Image unoptimized src={qr} width={180} height={180} alt="QR Code para abrir o WhatsApp oficial da Optótica" /><figcaption>No computador, aponte a câmera do celular.</figcaption></figure>
          </div></details> : null}
          <details><summary>Entrar por e-mail</summary>
            <p className="muted">Alternativa para profissionais, inclusive cadastros ainda em análise.</p>
            <ProfessionalLoginForm />
          </details>
          <p className="fine-print">Primeiro acesso? <Link className="text-link" href="/cadastrar">Cadastre seu e-mail</Link>.</p>
          <p className="fine-print">É master? <Link className="text-link" href="/entrar/master">Entrar com senha</Link>.</p>
        </section>
      </div>
    </div>
  );
}
