import type { Metadata } from 'next';
import Link from 'next/link';
import { masterSignInAction } from './actions';

export const metadata: Metadata = { title: 'Entrar como master' };

const errorMessages: Record<string, string> = {
  'dados-invalidos': 'Informe e-mail e senha.',
  'credenciais-invalidas': 'E-mail ou senha incorretos.',
  'nao-e-master': 'Este e-mail não tem acesso de master.'
};

export default async function MasterLoginPage({
  searchParams
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const message = erro ? errorMessages[erro] || 'Não foi possível entrar.' : null;

  return (
    <div className="page-shell narrow">
      <div className="login-grid">
        <section className="card login-card">
          <p className="eyebrow">Usuário master</p>
          <h1>Entrar com senha</h1>
          <p className="muted">Acesso alternativo ao painel de aprovações, sem depender de Magic Link por e-mail.</p>
          <form action={masterSignInAction} className="stack">
            <label htmlFor="master-email">E-mail</label>
            <input id="master-email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="master-password">Senha</label>
            <input id="master-password" name="password" type="password" autoComplete="current-password" required />
            <button className="button primary" type="submit">Entrar</button>
            {message && <p className="form-message error" role="status">{message}</p>}
          </form>
          <p className="fine-print">Não é master? <Link className="text-link" href="/entrar">Voltar para entrar</Link>.</p>
        </section>
      </div>
    </div>
  );
}
