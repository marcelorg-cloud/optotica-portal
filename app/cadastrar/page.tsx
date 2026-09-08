import type { Metadata } from 'next';
import Link from 'next/link';
import { RegistrationForm } from '@/components/registration-form';

export const metadata: Metadata = { title: 'Cadastro profissional' };

export default function RegistrationPage() {
  return (
    <div className="page-shell narrow">
      <div className="login-grid">
        <section className="card login-card">
          <p className="eyebrow">Novo profissional</p>
          <h1>Inicie seu cadastro</h1>
          <p className="muted">Receba um Magic Link no e-mail e preencha os dados profissionais. O acesso a pacientes só é liberado depois da análise da Optótica.</p>
          <RegistrationForm />
          <p className="fine-print">Já possui cadastro? <Link className="text-link" href="/entrar">Voltar para entrar</Link>.</p>
        </section>

        <aside className="card login-card">
          <p className="eyebrow">Acesso protegido</p>
          <h2>O cadastro passa por validação.</h2>
          <div className="registration-notes">
            <div><strong>Dados profissionais</strong><p>Identificação, registro, endereço, contatos e laboratórios são analisados pela equipe Optótica.</p></div>
            <div><strong>Pacientes</strong><p>Não criam conta por e-mail. O primeiro acesso ocorre somente por convite de um profissional aprovado e confirmação no WhatsApp.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
