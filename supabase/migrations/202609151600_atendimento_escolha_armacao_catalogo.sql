-- Redesenho da Etapa 3 "Escolha da armação" do painel de atendimento
-- (15/09/2026, pedido do usuário: layout novo em 1 linha por modelo, com
-- círculos de cor clicáveis e botões GOSTEI/TALVEZ/OCULTAR no lugar do
-- dropdown de cor + botão único "Selecionar").
--
-- Decisão tomada com o usuário (3 perguntas, todas respondidas antes desta
-- migração):
--  1) Fonte de dados: esta tela passa a usar o CATÁLOGO NOVO
--     (catalog_products / catalog_product_color_images /
--     catalog_product_color_display_images) em vez da tabela antiga
--     `frames` (fotos hotlinkadas do AliExpress). As duas tabelas antigas
--     (`frames`, `order_frames`) NÃO são apagadas — `order_frames` continua
--     sendo onde a escolha FINAL de armação do pedido é gravada (nenhum
--     consumidor downstream — comanda, resumo do pedido — precisa de mais
--     que frame_name/color, então não há necessidade de trocar essas
--     colunas; só adicionamos 2 colunas novas para saber que a escolha veio
--     do catálogo novo).
--  2) GOSTEI/TALVEZ/OCULTAR = uma reação por COR, guardada numa tabela nova
--     (`order_frame_reactions`), separada da confirmação final (que
--     continua sendo escrita em `order_frames`, agora apontando pro
--     catálogo novo).
--  3) OCULTAR = só um marcador visual (a cor continua na lista, sem sumir
--     de fato) — não precisa de nenhuma coluna especial além do próprio
--     status "oculto" na tabela de reações.
--
-- Import da tabela `frames`/`order_frames` antiga é usada hoje só nesta
-- tela do painel de atendimento (profissional) — a tela equivalente do
-- próprio paciente (/cliente/pedido/[orderId], componente
-- ClientFrameStep) NÃO foi migrada nesta rodada (o pedido do usuário foi
-- específico pro "painel de atendimento"); fica registrado aqui pra não
-- esquecer que ainda há duas telas de escolha de armação com fontes de
-- dados diferentes.

-- 1) order_frames ganha 2 colunas novas (nullable) pra registrar quando a
--    escolha final veio do catálogo novo, em vez da tabela `frames` antiga.
--    frame_id continua existindo e nullable (já era) — para uma escolha via
--    catálogo novo, frame_id fica null e as 2 colunas novas ficam
--    preenchidas; frame_name/sku/color continuam preenchidos do mesmo jeito
--    de sempre (frame_name = model_name do produto, color = color_name da
--    cor), então nenhuma tela que já lê order_frames precisa mudar.
alter table public.order_frames
  add column if not exists catalog_product_id uuid references public.catalog_products(id) on delete set null,
  add column if not exists catalog_color_image_id uuid references public.catalog_product_color_images(id) on delete set null;

create index if not exists order_frames_catalog_color_image_idx
  on public.order_frames (catalog_color_image_id);

-- 2) Tabela nova: reação (GOSTEI/TALVEZ/OCULTAR) do profissional (ou do
--    paciente, se um dia essa tela for espelhada lá) para uma cor
--    específica de um produto do catálogo, dentro de um pedido. Uma linha
--    por (order_id, catalog_color_image_id) — marcar de novo troca a
--    reação; o front decide se marcar a MESMA reação de novo remove
--    (alterna) ou mantém.
create table if not exists public.order_frame_reactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  catalog_color_image_id uuid not null references public.catalog_product_color_images(id) on delete cascade,
  status text not null,
  reacted_by uuid references auth.users(id) on delete set null,
  reacted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_frame_reactions_status_check check (status in ('gostei', 'talvez', 'oculto')),
  constraint order_frame_reactions_unique unique (order_id, catalog_color_image_id)
);

create index if not exists order_frame_reactions_order_idx on public.order_frame_reactions (order_id);
create index if not exists order_frame_reactions_color_image_idx on public.order_frame_reactions (catalog_color_image_id);

alter table public.order_frame_reactions enable row level security;

-- Mesmo padrão de RLS de order_frames (defesa em profundidade — as rotas
-- que leem/escrevem esta tabela usam o cliente admin/service-role, que
-- ignora RLS, mas a política fica correta caso algum dia um cliente comum
-- precise ler direto).
drop policy if exists order_frame_reactions_read on public.order_frame_reactions;
create policy order_frame_reactions_read on public.order_frame_reactions for select using (
  public.is_org_member(organization_id) or exists(select 1 from public.orders o where o.id = order_id and public.is_client_user(o.client_id))
);
drop policy if exists order_frame_reactions_write on public.order_frame_reactions;
create policy order_frame_reactions_write on public.order_frame_reactions for all using (public.is_org_member(organization_id)) with check (
  public.is_org_member(organization_id) and public.order_belongs_to_org(order_id, organization_id)
);
