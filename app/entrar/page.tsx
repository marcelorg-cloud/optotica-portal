import type { Metadata } from 'next';
import Link from 'next/link';
import { ProfessionalLoginForm } from '@/components/professional-login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <div className="page-shell narrow">
      <div className="login-grid">
        <section className="card login-card">
          <p className="eyebrow">Área do cliente</p>
          <h1>Use o convite do seu profissional</h1>
          <p className="muted">O QR Code ou link de acesso é criado pelo profissional que realizou seu atendimento e permanece válido por 24 horas.</p>
          <div className="setup-note">Abra o convite recebido, envie a mensagem pré-preenchida para o WhatsApp oficial da Optótica e receba seu link pessoal de acesso.</div>
          <p className="fine-print">Não existe cadastro livre de paciente. Essa regra impede que outra pessoa crie um acesso para seus dados.</p>
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
