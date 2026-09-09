'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteHeader() {
  const pathname = usePathname();
  // A área do cliente é para o paciente — não faz sentido oferecer ali um link para
  // "Entrar" (de novo) ou para a área profissional, que é uma conta/contexto diferente.
  const isClientArea = pathname?.startsWith('/cliente');

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Optótica — início">
        <span className="brand-mark" aria-hidden="true">O</span>
        <span>optótica</span>
      </Link>
      {!isClientArea && (
        <nav aria-label="Navegação principal">
          <Link href="/entrar">Entrar</Link>
          <Link href="/profissional">Área profissional</Link>
        </nav>
      )}
    </header>
  );
}
