begin;

-- =========================================================================
-- Cardápio de lentes (v1, sem sugestão por IA — configuração manual pela
-- ótica). Duas camadas de dados, conforme decidido com o usuário no
-- documento de definição (claude/cardapio-de-lentes-definicao.md, seção 5):
--
--   1) lens_catalog_items — biblioteca central/compartilhada de itens de
--      laboratório (linha, índice, tratamento, preço de referência),
--      alimentada a partir de tabelas reais de laboratórios parceiros.
--      Não tem organization_id: é comum a todas as óticas da plataforma.
--      Só é escrita por processo administrativo (service_role) — as óticas
--      apenas leem, para montar o próprio cardápio.
--
--   2) lens_menu_tiers — o cardápio de cada ótica (até 4 níveis: 3 fixos +
--      1 opcional "grife"/topo de linha), por organization_id. Cada nível
--      pode referenciar um item do catálogo (catalog_item_id) só para
--      rastreabilidade — os campos de composição/preço ficam duplicados na
--      própria linha do nível, para a ótica poder editar livremente sem
--      depender do catálogo central permanecer inalterado.
--
-- Isto é intencionalmente independente das tabelas laboratory_catalogs /
-- lenses / professional_laboratories que já existem no schema: aquelas são
-- para o cadastro de laboratórios parceiros e um catálogo por-ótica (ainda
-- não usadas por nenhuma tela hoje); esta é a biblioteca compartilhada da
-- plataforma, mais simples e já populada com dados reais. Podem ser
-- unificadas depois, se fizer sentido.
-- =========================================================================

create table if not exists public.lens_catalog_items (
  id uuid primary key default gen_random_uuid(),
  manufacturer text not null,
  product_line text not null,
  -- lens_type é a classificação estrita usada para separar o cardápio em
  -- categorias (v1: visão simples e multifocal — bifocal/ocupacional ficam
  -- fora das duas por enquanto, classificados como 'other', até uma v2
  -- decidir se ganham cardápio próprio). Diferente de lens_category, que é
  -- só um rótulo de posicionamento/marketing em texto livre (ex. "Progressiva
  -- Freeform — topo de linha"), usado apenas para exibição.
  lens_type text not null default 'other' check (lens_type in ('single_vision', 'multifocal', 'other')),
  lens_category text,
  lens_index text not null default '',
  base_variant text not null default '',
  ar_treatment text not null default '',
  price numeric(12,2) not null check (price >= 0),
  price_unit text not null default 'par' check (price_unit in ('par', 'unidade')),
  suggested_tier text,
  -- lens_index/base_variant/ar_treatment são NOT NULL DEFAULT '' (nunca null)
  -- de propósito: colunas com null em uma unique constraint nunca "colidem"
  -- em ON CONFLICT (duas linhas com null são consideradas diferentes), o que
  -- quebraria a idempotência do seed abaixo para fontes sem índice (Surfamon,
  -- Índio, Varilux) — testado localmente antes desta versão.
  source text not null,
  validity_note text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lens_catalog_items_natural_key unique
    (manufacturer, product_line, lens_index, base_variant, ar_treatment, source)
);

alter table public.lens_catalog_items enable row level security;

drop policy if exists lens_catalog_items_read on public.lens_catalog_items;
create policy lens_catalog_items_read on public.lens_catalog_items
  for select to authenticated using (true);
-- Sem política de escrita: só service_role (usado pelas rotas server-side
-- com createAdminSupabaseClient) grava aqui.

create table if not exists public.lens_menu_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Cada categoria tem seu próprio cardápio de até 4 níveis (3 fixos + 1
  -- "grife" opcional) — visão simples e multifocal têm faixas de preço tão
  -- diferentes que misturar as duas num único cardápio de 3 opções não fazia
  -- sentido (pedido explícito do usuário, 10/09/2026). Bifocal/ocupacional
  -- ficam fora do cardápio configurável por enquanto (v2).
  lens_type text not null default 'single_vision' check (lens_type in ('single_vision', 'multifocal')),
  tier_number smallint not null check (tier_number between 1 and 4),
  is_addon boolean not null default false,
  tier_name text not null default '',
  benefit_phrase text,
  target_audience text,
  catalog_item_id uuid references public.lens_catalog_items(id) on delete set null,
  manufacturer text,
  product_line text,
  lens_index text,
  ar_treatment text,
  price numeric(12,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lens_menu_tiers_org_type_tier_unique unique (organization_id, lens_type, tier_number)
);

alter table public.lens_menu_tiers enable row level security;

drop policy if exists lens_menu_tiers_read on public.lens_menu_tiers;
create policy lens_menu_tiers_read on public.lens_menu_tiers
  for select using (public.is_org_member(organization_id));

drop policy if exists lens_menu_tiers_write on public.lens_menu_tiers;
create policy lens_menu_tiers_write on public.lens_menu_tiers
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

commit;
