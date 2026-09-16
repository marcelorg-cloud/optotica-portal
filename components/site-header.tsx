'use client';

import Link from 'next/link';
import Image from 'next/image';
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
    <>
      <header className={`site-header${isProfessionalArea ? ' professional-header' : ''}`}>
        <Link className="brand" href={isProfessionalArea ? '/profissional' : '/'} aria-label="Optótica — início">
          <Image className="brand-logo" src="/optotica-logo.png" alt="Optótica" width={153} height={80} priority />
          {isProfessionalArea && <span className="brand-context">Profissional</span>}
        </Link>
        {!isClientArea && (
          <nav aria-label="Navegação principal">
            {!isProfessionalArea && !loggedIn && <Link href="/entrar">Entrar</Link>}
            {!isProfessionalArea && <Link href="/profissional">Área profissional</Link>}
            {isProfessionalArea && <Link href="/profissional/cadastro">Meu perfil</Link>}
            {loggedIn && <button type="button" className="nav-signout" onClick={handleSignOut}>Sair</button>}
          </nav>
        )}
      </header>
      {isProfessionalArea && (
        <nav className="workspace-nav" aria-label="Área profissional">
          <div className="workspace-nav-inner">
            <Link className={pathname === '/profissional' ? 'active' : ''} href="/profissional">Visão geral</Link>
            <Link className={pathname?.startsWith('/profissional/pacientes') && pathname !== '/profissional/pacientes/novo' ? 'active' : ''} href="/profissional/pacientes">Pacientes</Link>
            <Link className={pathname === '/profissional/pacientes/novo' ? 'active' : ''} href="/profissional/pacientes/novo">Convidar paciente</Link>
            <Link className={pathname?.startsWith('/profissional/cardapio') ? 'active' : ''} href="/profissional/cardapio">Cardápio de lentes</Link>
          </div>
        </nav>
      )}
    </>
  );
}
