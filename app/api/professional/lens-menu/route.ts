import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

type TierInput = {
  lensType?: unknown;
  tierNumber?: unknown;
  isAddon?: unknown;
  tierName?: unknown;
  benefitPhrase?: unknown;
  targetAudience?: unknown;
  catalogItemId?: unknown;
  manufacturer?: unknown;
  productLine?: unknown;
  lensIndex?: unknown;
  arTreatment?: unknown;
  price?: unknown;
  active?: unknown;
};

const clean = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const VALID_LENS_TYPES = new Set(['single_vision', 'multifocal']);

async function getApprovedOrganization(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('professional_profiles')
    .select('organization_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile || profile.status !== 'approved' || !profile.organization_id) return null;
  return { admin, organizationId: profile.organization_id as string };
}

// Cardápio de lentes da ótica (até 4 níveis: 3 fixos + 1 opcional "grife"/
// topo de linha — ver claude/cardapio-de-lentes-definicao.md, seções 5 e 7).
// Cada nível pode referenciar um item de lens_catalog_items (biblioteca
// central), mas guarda sua própria cópia de composição/preço — a ótica edita
// livremente sem depender do catálogo central permanecer igual.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const ctx = await getApprovedOrganization(user.id);
  if (!ctx) return NextResponse.json({ message: 'Cadastro profissional não aprovado.' }, { status: 403 });

  const { data, error } = await ctx.admin
    .from('lens_menu_tiers')
    .select('id, lens_type, tier_number, is_addon, tier_name, benefit_phrase, target_audience, catalog_item_id, manufacturer, product_line, lens_index, ar_treatment, price, active')
    .eq('organization_id', ctx.organizationId)
    .order('lens_type', { ascending: true })
    .order('tier_number', { ascending: true });

  if (error) {
    console.error('lens_menu_fetch_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível carregar o cardápio de lentes.' }, { status: 500 });
  }

  return NextResponse.json({ tiers: data || [] });
}

export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const ctx = await getApprovedOrganization(user.id);
  if (!ctx) return NextResponse.json({ message: 'Cadastro profissional não aprovado.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const tiers = Array.isArray(body?.tiers) ? (body.tiers as TierInput[]) : null;
  // Até 4 níveis por categoria (visão simples, multifocal) — até 8 no total
  // por envio, já que a tela salva as duas categorias de uma vez.
  if (!tiers || tiers.length === 0 || tiers.length > 8) {
    return NextResponse.json({ message: 'Envie de 1 a 4 níveis por categoria do cardápio.' }, { status: 400 });
  }

  const rows: Record<string, unknown>[] = [];
  const seenByType = new Map<string, Set<number>>();
  for (const t of tiers) {
    const lensType = typeof t.lensType === 'string' ? t.lensType : '';
    if (!VALID_LENS_TYPES.has(lensType)) {
      return NextResponse.json({ message: 'Categoria de lente inválida (use visão simples ou multifocal).' }, { status: 400 });
    }
    const tierNumber = Number(t.tierNumber);
    if (!Number.isInteger(tierNumber) || tierNumber < 1 || tierNumber > 4) {
      return NextResponse.json({ message: 'Número de nível inválido (use 1 a 4).' }, { status: 400 });
    }
    const seenTierNumbers = seenByType.get(lensType) || new Set<number>();
    if (seenTierNumbers.has(tierNumber)) {
      return NextResponse.json({ message: `Nível ${tierNumber} duplicado no envio para esta categoria.` }, { status: 400 });
    }
    seenTierNumbers.add(tierNumber);
    seenByType.set(lensType, seenTierNumbers);

    const tierName = clean(t.tierName, 80);
    if (!tierName) {
      return NextResponse.json({ message: `Dê um nome ao nível ${tierNumber}.` }, { status: 400 });
    }
    const price = Number(t.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
      return NextResponse.json({ message: `Informe um preço válido para o nível ${tierNumber}.` }, { status: 400 });
    }
    const catalogItemId = typeof t.catalogItemId === 'string' && t.catalogItemId ? t.catalogItemId : null;

    rows.push({
      organization_id: ctx.organizationId,
      lens_type: lensType,
      tier_number: tierNumber,
      is_addon: Boolean(t.isAddon) || tierNumber === 4,
      tier_name: tierName,
      benefit_phrase: clean(t.benefitPhrase, 300) || null,
      target_audience: clean(t.targetAudience, 200) || null,
      catalog_item_id: catalogItemId,
      manufacturer: clean(t.manufacturer, 120) || null,
      product_line: clean(t.productLine, 160) || null,
      lens_index: clean(t.lensIndex, 20) || null,
      ar_treatment: clean(t.arTreatment, 120) || null,
      price,
      active: t.active !== false,
      updated_at: new Date().toISOString()
    });
  }

  // Substitui a configuração inteira do cardápio desta ótica de uma vez
  // (upsert por organization_id + lens_type + tier_number, que tem unique
  // constraint) — e remove, categoria por categoria, os níveis que não
  // vieram nesta chamada (ex.: ótica desativou a 4ª opção grife de uma
  // categoria).
  const { error: upsertError } = await ctx.admin
    .from('lens_menu_tiers')
    .upsert(rows, { onConflict: 'organization_id,lens_type,tier_number' });
  if (upsertError) {
    console.error('lens_menu_upsert_failed', { code: upsertError.code });
    return NextResponse.json({ message: 'Não foi possível salvar o cardápio de lentes.' }, { status: 500 });
  }

  for (const [lensType, tierNumbers] of seenByType) {
    const keptTierNumbers = Array.from(tierNumbers);
    const { error: cleanupError } = await ctx.admin
      .from('lens_menu_tiers')
      .delete()
      .eq('organization_id', ctx.organizationId)
      .eq('lens_type', lensType)
      .not('tier_number', 'in', `(${keptTierNumbers.join(',')})`);
    if (cleanupError) {
      console.error('lens_menu_cleanup_failed', { code: cleanupError.code, lensType });
      // Não bloqueia a resposta — a configuração enviada já foi salva; níveis
      // removidos ficarão órfãos até a próxima tentativa de salvar (não afeta
      // o funcionamento do cardápio ativo).
    }
  }

  return NextResponse.json({ message: 'Cardápio de lentes salvo.' });
}
