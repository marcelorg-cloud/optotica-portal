import type { Metadata } from "next";
import { masterSignInAction } from "./actions";

export const metadata: Metadata = {
  title: "Entrar como Master | Regente",
};

const errorMessages: Record<string, string> = {
  "dados-invalidos": "Informe e-mail e senha.",
  "credenciais-invalidas": "E-mail ou senha incorretos.",
  "nao-e-master": "Este usuário não possui acesso Master.",
};

export default async function MasterLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const message = erro
    ? errorMessages[erro] || "Não foi possível entrar."
    : null;

  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <span className="eyebrow">ACESSO RESTRITO</span>
        <h1>Regente</h1>
        <h2>Entrar como Master</h2>
        <p>
          Use o mesmo e-mail e senha do usuário Master do portal Optótica.
        </p>

        <form action={masterSignInAction} className="login-form">
          <label htmlFor="master-email">
            E-mail
            <input
              id="master-email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label htmlFor="master-password">
            Senha
            <input
              id="master-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit">Entrar</button>
          {message && (
            <p className="login-error" role="status">
              {message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
