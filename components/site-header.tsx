'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function SiteHeader({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  // A área do cliente é para o paciente — não faz sentido oferecer ali um link para
  // "Entrar"/"Sair" (de novo) ou para a área profissional, que é uma conta/contexto diferente.
  const isClientArea = pathname?.startsWith('/cliente');
  // Só mostra o link "Perfil" quando já se está na área profissional — evita
  // oferecer o link (e o redirect de login que ele dispararia) para quem
  // ainda nem entrou como profissional.
  const isProfessionalArea = pathname?.startsWith('/profissional');

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Optótica — início">
        <span className="brand-mark" aria-hidden="true">O</span>
        <span>optótica</span>
      </Link>
      {!isClientArea && (
        <nav aria-label="Navegação principal">
          {loggedIn ? (
            <button
              type="button"
              onClick={handleSignOut}
              style={{ all: 'unset', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              Sair
            </button>
          ) : (
            <Link href="/entrar">Entrar</Link>
          )}
          {isProfessionalArea && <Link href="/profissional/cadastro">Perfil</Link>}
          <Link href="/profissional">Área profissional</Link>
        </nav>
      )}
    </header>
  );
}
