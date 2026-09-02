import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { ProfessionalLoginForm } from '@/components/professional-login-form';

export const metadata: Metadata = { title: 'Entrar' };

function whatsappLink() {
  const number = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const message = encodeURIComponent('Olá, quero acessar meu Portal Optótica.');
  return number ? `https://wa.me/${number}?text=${message}` : '';
}

export default async function LoginPage() {
  const link = whatsappLink();
  const qr = link ? await QRCode.toDataURL(link, { width: 420, margin: 1, color: { dark: '#171717', light: '#ffffff' } }) : '';

  return (
    <div className="page-shell narrow">
      <div className="login-grid">
        <section className="card login-card">
          <p className="eyebrow">Área do cliente</p>
          <h1>Abra o portal pelo WhatsApp</h1>
          <p className="muted">Escaneie o QR Code ou toque no botão. Envie a mensagem para receber seu link pessoal e temporário.</p>
          {qr ? (
            // Gerado no servidor a partir do número configurado; não contém dados do cliente.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qr" src={qr} alt="QR Code para iniciar conversa com a Optótica no WhatsApp" />
          ) : (
            <div className="setup-note">Configure `NEXT_PUBLIC_WHATSAPP_NUMBER` para ativar o QR Code.</div>
          )}
          {link && <a className="button whatsapp" href={link} rel="noreferrer">Abrir WhatsApp</a>}
          <p className="fine-print">O acesso só é liberado para um número previamente cadastrado e após seu consentimento.</p>
        </section>

        <section className="card login-card">
          <p className="eyebrow">Área profissional</p>
          <h2>Receba seu acesso por e-mail</h2>
          <p className="muted">Informe o e-mail profissional autorizado. O link é individual e possui validade limitada.</p>
          <ProfessionalLoginForm />
        </section>
      </div>
    </div>
  );
}
