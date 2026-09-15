-- Pedido do usuário (14/09/2026), depois de reportar um bug real (o mesmo
-- modelo Kachawoo ganhou duas cores "Tartaruga" — C6 e C11 — ao reimportar
-- o JSON do AliExpress): "a gente tem que fazer uma tabela que o C1, C2, C3
-- vai ser a mesma cor pra todos os óculos... o C1 tem que ser preto e não
-- pode ter outro preto além de C1, a não ser que seja um preto diferente,
-- preto fosco... com alguma particularidade... e os outros modelos mesma
-- coisa, eles vão ter que usar a mesma tabela, todos a mesma tabela."
--
-- Antes desta migração (202609131100, seção 0.51), o número da cor (C1,
-- C2...) era só a ORDEM de cadastro DENTRO DE CADA PRODUTO — "C1 de um
-- modelo ≠ C1 de outro" (documentado explicitamente no
-- Padrao_SKU_Armacoes_Optotica.docx original). Essa migração muda essa
-- regra: o número da cor passa a vir de uma tabela GLOBAL
-- (`catalog_color_registry`), única para o catálogo inteiro — a mesma cor
-- real (mesma combinação de cor principal + secundária + eventual
-- particularidade) sempre usa o MESMO número, em qualquer modelo.
--
-- Essa mudança também é a correção de raiz do bug relatado: hoje nada
-- impede duas linhas com a mesma cor real no mesmo produto (o número era só
-- "o maior já usado + 1", sem checar se a cor já existia) — a partir de
-- agora, criar uma cor faz uma busca (ou criação) nesta tabela global e a
-- rota de criação (`.../images/route.ts`) passa a REJEITAR uma cor
-- repetida no mesmo produto (ver entrega de código desta rodada).

begin;

-- Tabela global de cores — populada agora com as 27 cores já existentes no
-- vocabulário controlado (`COLOR_VOCABULARY`, lib/catalog/sku-standard.ts),
-- numeradas na mesma ordem em que já aparecem lá (C1 = Preto, C2 = Cinza...
-- C27 = Multicolorido). Cores novas (ex.: "Preto fosco", uma "particularidade"
-- do preto) entram como linhas novas, numeradas a partir de C28 em diante —
-- nunca reaproveitando um número já usado, mesmo mais tarde.
--
-- `note`: só preenchido quando a cor é uma VARIAÇÃO de uma combinação
-- principal+secundária que já existe (ex.: "fosco" pra distinguir de um
-- preto liso já cadastrado como outra linha) — normalmente fica em branco.
create table if not exists public.catalog_color_registry (
  id uuid primary key default gen_random_uuid(),
  color_number integer not null,
  color_principal text not null,
  color_secondary text,
  note text,
  created_at timestamptz not null default now(),
  constraint catalog_color_registry_number_unique unique (color_number)
);

-- Índice de unicidade por EXPRESSÃO (não uma constraint simples): uma
-- constraint UNIQUE comum trata NULL como "diferente de qualquer coisa,
-- inclusive de outro NULL" — duas linhas com color_secondary/note ambos NULL
-- passariam por uma UNIQUE(color_principal, color_secondary, note) sem
-- reclamar, exatamente o problema que esta tabela existe pra evitar. Usar
-- coalesce(..., '') no índice fecha essa brecha.
create unique index if not exists catalog_color_registry_combo_unique_idx
  on public.catalog_color_registry (color_principal, coalesce(color_secondary, ''), coalesce(note, ''));

create sequence if not exists public.catalog_color_registry_number_seq;

-- Mesmo padrão já usado pra número de modelo (`next_catalog_model_number()`,
-- migração 202609131100): PostgREST/supabase-js não expõe nextval()
-- diretamente, esta função dá à rota de criação de cor um jeito de pegar o
-- próximo número global (via `auth.admin.rpc('next_catalog_color_number')`).
create or replace function public.next_catalog_color_number()
returns integer
language sql
security definer
set search_path = public
as $$
  select nextval('public.catalog_color_registry_number_seq')::integer;
$$;

alter table public.catalog_color_registry enable row level security;

drop policy if exists catalog_color_registry_master_read on public.catalog_color_registry;
create policy catalog_color_registry_master_read on public.catalog_color_registry
  for select to authenticated using (public.is_master_admin());

-- Seed das 27 cores já existentes, numeradas 1 a 27 na mesma ordem do
-- vocabulário (`on conflict (color_number) do nothing` — idempotente, não
-- duplica se esta migração rodar de novo).
insert into public.catalog_color_registry (color_number, color_principal) values
  (1, 'Preto'), (2, 'Cinza'), (3, 'Grafite'), (4, 'Prata'), (5, 'Dourado'),
  (6, 'Rosé'), (7, 'Branco'), (8, 'Cristal'), (9, 'Fumê'), (10, 'Champanhe'),
  (11, 'Bege'), (12, 'Marrom'), (13, 'Tartaruga'), (14, 'Caramelo'), (15, 'Amarelo'),
  (16, 'Laranja'), (17, 'Vermelho'), (18, 'Vinho'), (19, 'Rosa'), (20, 'Lilás'),
  (21, 'Roxo'), (22, 'Azul'), (23, 'Azul-marinho'), (24, 'Verde'), (25, 'Verde-oliva'),
  (26, 'Turquesa'), (27, 'Multicolorido')
on conflict (color_number) do nothing;

-- Reancora a sequence pro próximo número livre acima do maior já usado —
-- sempre seguro rodar de novo (idempotente), mesmo depois de cores novas
-- já terem sido criadas por fora deste seed.
select setval('public.catalog_color_registry_number_seq', (select coalesce(max(color_number), 0) from public.catalog_color_registry), true);

-- Liga cada cor já cadastrada (de qualquer produto) à linha correspondente
-- da tabela global, e passa a numerá-la pelo número GLOBAL — é aqui que o
-- "C1 de um modelo ≠ C1 de outro" de antes vira "C1 é sempre Preto em
-- qualquer modelo".
alter table public.catalog_product_color_images
  add column if not exists color_registry_id uuid references public.catalog_color_registry(id),
  add column if not exists color_note text;

-- 1) Para toda combinação (color_principal, color_secondary) já em uso que
--    AINDA NÃO existe na tabela global (ex.: uma combinação bicolor que não
--    está nas 27 cores simples do seed), cria uma linha nova pra ela.
insert into public.catalog_color_registry (color_number, color_principal, color_secondary)
select public.next_catalog_color_number(), d.color_principal, d.color_secondary
from (
  select distinct color_principal, color_secondary
  from public.catalog_product_color_images
  where color_principal is not null
) d
where not exists (
  select 1 from public.catalog_color_registry r
  where r.color_principal = d.color_principal
    and coalesce(r.color_secondary, '') = coalesce(d.color_secondary, '')
    and r.note is null
);

-- 2) Preenche color_registry_id e renumera color_variant_number de toda
--    cor já cadastrada, casando por (color_principal, color_secondary) —
--    o `note` de cores já existentes é sempre NULL (o campo não existia
--    antes desta migração), por isso a busca não considera `note` aqui.
update public.catalog_product_color_images p
set color_registry_id = r.id,
    color_variant_number = r.color_number
from public.catalog_color_registry r
where p.color_principal is not null
  and p.color_principal = r.color_principal
  and coalesce(p.color_secondary, '') = coalesce(r.color_secondary, '')
  and r.note is null;

commit;

-- IMPORTANTE — leia antes de rodar (avisado ao usuário na entrega): esta
-- migração RENUMERA o C-número de toda cor já cadastrada (ex.: uma cor que
-- era "C3" num modelo pode virar "C13" se a cor real dela for a 13ª da
-- tabela global) — é exatamente o que foi pedido ("todos os modelos vão ter
-- que usar a mesma tabela"), mas os SKUs de variante impressos/anotados
-- antes de hoje com o número antigo ficam desatualizados.
--
-- Se o mesmo produto tiver hoje DUAS cores com a mesma cor real (o bug
-- relatado — ex.: o Kachawoo com duas "Tartaruga"), as DUAS vão virar o
-- MESMO C-número depois desta migração (a migração não decide sozinha qual
-- apagar) — isso é esperado e serve de sinal visual pra achar duplicatas
-- ainda não limpas. Rode a limpeza (SQL enviado à parte, específico do caso
-- do Kachawoo) ANTES desta migração pra já não sobrar nenhuma.
--
-- Ainda NÃO foi adicionada uma constraint impedindo duas cores com o mesmo
-- C-número no mesmo produto (isso exigiria que nenhuma duplicata exista no
-- momento de criar a constraint) — assim que a limpeza acima for
-- confirmada, uma migração de acompanhamento adiciona essa trava.
