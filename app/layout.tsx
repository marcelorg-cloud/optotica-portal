import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
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
        <SiteHeader />
        <main>{children}</main>
        <footer className="site-footer">Optótica · infraestrutura independente e dados protegidos</footer>
      </body>
    </html>
  );
}
