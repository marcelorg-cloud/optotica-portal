import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Optótica', template: '%s · Optótica' },
  description: 'Portal independente de gestão óptica e acompanhamento de pedidos.',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Optótica — início">
            <span className="brand-mark" aria-hidden="true">O</span>
            <span>optótica</span>
          </Link>
          <nav aria-label="Navegação principal">
            <Link href="/entrar">Entrar</Link>
            <Link href="/profissional">Área profissional</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">Optótica · infraestrutura independente e dados protegidos</footer>
      </body>
    </html>
  );
}
