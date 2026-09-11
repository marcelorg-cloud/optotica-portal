import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { CatalogTabs } from '@/components/catalog/catalog-tabs';
import { CatalogProductDetail } from '@/components/catalog/catalog-product-detail';

export const metadata: Metadata = { title: 'Produto — Painel de Catálogo' };

export default async function CatalogProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: master } = await admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!master) redirect('/profissional');

  return (
    <div className="page-shell">
      <CatalogTabs />
      <CatalogProductDetail productId={productId} />
    </div>
  );
}
