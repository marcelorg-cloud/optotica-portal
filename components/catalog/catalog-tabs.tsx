'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/catalogo', label: 'Catálogo de Produtos', match: (p: string) => p === '/admin/catalogo' || /^\/admin\/catalogo\/[^/]+$/.test(p) },
  { href: '/admin/catalogo/aprovacao', label: 'Fila de Aprovação IA', match: (p: string) => p === '/admin/catalogo/aprovacao' },
  { href: '/admin/catalogo/compras', label: 'Fila de Compras', match: (p: string) => p === '/admin/catalogo/compras' }
];

export function CatalogTabs() {
  const pathname = usePathname() || '';
  return (
    <div className="category-tabs" role="tablist" aria-label="Painel de Catálogo">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`category-tab${tab.match(pathname) ? ' active' : ''}`}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
