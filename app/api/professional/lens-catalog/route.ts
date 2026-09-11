import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Biblioteca central de itens de laboratório (catálogo compartilhado da
// plataforma — não tem organization_id, ver migração 202609100017). Usado
// pela tela de configuração do cardápio (/profissional/cardapio) para o
// profissional escolher um item pronto em vez de digitar tudo manualmente.
// Só leitura: quem grava aqui é o processo administrativo (seed/migração).
const VALID_LENS_TYPES = new Set(['single_vision', 'multifocal']);

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('professional_profiles')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.status !== 'approved') {
    return NextResponse.json({ message: 'Cadastro profissional não aprovado.' }, { status: 403 });
  }

  // Categoria (visão simples / multifocal) — ver claude/cardapio-de-lentes-definicao.md,
  // preços das duas categorias não são comparáveis, então o cardápio de cada
  // ótica (lens_menu_tiers) é configurado uma categoria por vez, e esta rota
  // filtra o catálogo pela mesma categoria para a busca do profissional.
  const { searchParams } = new URL(request.url);
  const lensType = searchParams.get('lensType');

  let query = admin
    .from('lens_catalog_items')
    .select('id, manufacturer, product_line, lens_type, lens_category, lens_index, base_variant, ar_treatment, price, price_unit, suggested_tier, source, validity_note, notes')
    .eq('active', true);
  if (lensType && VALID_LENS_TYPES.has(lensType)) {
    query = query.eq('lens_type', lensType);
  }
  const { data, error } = await query
    .order('manufacturer', { ascending: true })
    .order('product_line', { ascending: true })
    .order('lens_index', { ascending: true })
    .order('price', { ascending: true });

  if (error) {
    console.error('lens_catalog_fetch_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível carregar o catálogo de lentes.' }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}
