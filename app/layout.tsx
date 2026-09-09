import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Optótica', template: '%s · Optótica' },
  description: 'Portal independente de gestão óptica e acompanhamento de pedidos.',
  robots: { index: false, follow: false }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Só pra decidir "Entrar" vs "Sair" no cabeçalho — getSession() lê a sessão
  // do cookie sem round-trip ao servidor de auth (ao contrário de getUser()),
  // então não pesa no tempo de carregamento das páginas. Nenhuma decisão de
  // autorização depende disso: cada página continua validando com getUser()
  // como já fazia.
  let loggedIn = false;
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    loggedIn = Boolean(session);
  }

  return (
    <html lang="pt-BR">
      <body>
        <SiteHeader loggedIn={loggedIn} />
        <main>{children}</main>
        <footer className="site-footer">Optótica · infraestrutura independente e dados protegidos</footer>
      </body>
    </html>
  );
}
