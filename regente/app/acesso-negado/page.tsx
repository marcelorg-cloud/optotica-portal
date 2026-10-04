import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <span className="eyebrow">ACESSO NEGADO</span>
        <h1>Regente</h1>
        <h2>Área exclusiva do Master</h2>
        <p>
          A sessão atual não pertence a um usuário Master ativo do portal Optótica.
        </p>
        <Link className="button-link" href="/entrar/master">
          Entrar com outro usuário
        </Link>
      </section>
    </main>
  );
}
