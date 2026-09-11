import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { LensMenuEditor } from '@/components/lens-menu/lens-menu-editor';

export const metadata: Metadata = { title: 'Cardápio de lentes' };

export type LensType = 'single_vision' | 'multifocal';

export type CatalogItem = {
  id: string;
  manufacturer: string;
  product_line: string;
  lens_type: LensType | 'other';
  lens_category: string | null;
  lens_index: string;
  base_variant: string;
  ar_treatment: string;
  price: number;
  price_unit: string;
  suggested_tier: string | null;
  source: string;
  validity_note: string | null;
  notes: string | null;
};

export type MenuTier = {
  id?: string;
  lens_type: LensType;
  tier_number: number;
  is_addon: boolean;
  tier_name: string;
  benefit_phrase: string | null;
  target_audience: string | null;
  catalog_item_id: string | null;
  manufacturer: string | null;
  product_line: string | null;
  lens_index: string | null;
  ar_treatment: string | null;
  price: number;
  active: boolean;
};

export default async function LensMenuPage() {
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('professional_profiles')
    .select('status, organization_id, display_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.status !== 'approved') redirect('/profissional');
  if (!profile.organization_id) {
    return (
      <div className="page-shell narrow">
        <div className="setup-note">Sua conta ainda não está vinculada a uma organização — fale com o suporte antes de configurar o cardápio.</div>
      </div>
    );
  }

  const [{ data: tiersData }, { data: catalogData }] = await Promise.all([
    admin
      .from('lens_menu_tiers')
      .select('id, lens_type, tier_number, is_addon, tier_name, benefit_phrase, target_audience, catalog_item_id, manufacturer, product_line, lens_index, ar_treatment, price, active')
      .eq('organization_id', profile.organization_id)
      .order('lens_type', { ascending: true })
      .order('tier_number', { ascending: true }),
    admin
      .from('lens_catalog_items')
      .select('id, manufacturer, product_line, lens_type, lens_category, lens_index, base_variant, ar_treatment, price, price_unit, suggested_tier, source, validity_note, notes')
      .eq('active', true)
      .order('manufacturer', { ascending: true })
      .order('product_line', { ascending: true })
      .order('lens_index', { ascending: true })
      .order('price', { ascending: true })
  ]);

  return (
    <div className="page-shell">
      <div className="order-head">
        <Link className="back-link" href="/profissional">← Área profissional</Link>
        <p className="eyebrow">{profile.display_name}</p>
        <h1>Cardápio de lentes</h1>
        <p className="muted">
          Monte os 3 níveis que seus pacientes veem na hora de escolher a lente (e, se quiser, uma 4ª opção
          &quot;grife&quot;/topo de linha), separadamente para <strong>visão simples</strong> e <strong>multifocal</strong> —
          as faixas de preço das duas são bem diferentes, então cada categoria tem seu próprio cardápio. Use itens
          do catálogo de laboratórios como ponto de partida ou digite manualmente — o preço final e a composição
          são sempre seus, editáveis a qualquer momento.
        </p>
      </div>

      <LensMenuEditor
        initialTiers={(tiersData || []) as MenuTier[]}
        catalogItems={(catalogData || []) as CatalogItem[]}
      />
    </div>
  );
}
