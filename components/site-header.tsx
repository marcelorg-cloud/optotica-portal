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
  const showWorkspace = loggedIn && isProfessionalArea;
  const workspaceLinks = [
    { href: '/profissional', label: 'Visão geral', active: pathname === '/profissional' },
    { href: '/profissional/pacientes', label: 'Pacientes', active: Boolean(pathname?.startsWith('/profissional/pacientes') && pathname !== '/profissional/pacientes/novo') },
    { href: '/profissional/pacientes/novo', label: 'Convidar paciente', active: pathname === '/profissional/pacientes/novo' },
    { href: '/profissional/cardapio', label: 'Cardápio de lentes', active: pathname === '/profissional/cardapio' },
    { href: '/profissional/cadastro', label: 'Meu perfil', active: pathname === '/profissional/cadastro' }
  ];

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <>
    <header className="site-header portal-brand-header">
      <Link className="brand" href="/" aria-label="Optótica — início">
        <Image className="portal-brand-logo" src="/optotica-logo-transparent.png" alt="Optótica" width={1200} height={628} priority sizes="200px" />
      </Link>
      {!isClientArea && (
        <nav aria-label="Navegação principal">
          {loggedIn ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="portal-signout"
            >
              Sair
            </button>
          ) : (
            <Link href="/entrar">Entrar</Link>
          )}
          {!showWorkspace && isProfessionalArea && <Link href="/profissional/cadastro">Perfil</Link>}
          {!showWorkspace && <Link href="/profissional">Área profissional</Link>}
        </nav>
      )}
    </header>
    {showWorkspace && (
      <nav className="portal-workspace-nav" aria-label="Navegação profissional">
        <div className="portal-workspace-links">
          {workspaceLinks.map(({ href, label, active }) => (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined}>{label}</Link>
          ))}
        </div>
      </nav>
    )}
    </>
  );
}
