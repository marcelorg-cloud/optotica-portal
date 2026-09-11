begin;

-- =========================================================================
-- Laboratório: laboratório "principal" explícito, vínculo do atendimento
-- (Etapa 6 — Produção) com um laboratório parceiro já cadastrado, e
-- biblioteca de preços do laboratório (arquivos anexáveis).
--
-- Contexto da decisão: documento "Plano de integração — Cadastro de
-- Laboratórios, Biblioteca de Preços e Cardápio de Lentes" (recebido do
-- usuário em 11/09/2026), cruzando este projeto com um painel de catálogo
-- (fornecedores/dropshipping) em desenvolvimento paralelo, que precisa
-- resolver automaticamente o endereço de entrega de um pedido de compra a
-- partir do laboratório vinculado a um atendimento.
--
-- Confirmado com o usuário master (antes de escrever esta migração, como
-- pedido): "biblioteca de preços" = preço de SERVIÇO do próprio laboratório
-- (montagem/surfaçagem/biselamento da armação), não preço de lente — isso
-- já é exatamente o que lens_catalog_items/lens_menu_tiers fazem (feature
-- "cardápio de lentes", migrações 202609100017/018), então não é duplicado
-- aqui. Por isso a tabela nova abaixo guarda ARQUIVOS anexados (a tabela de
-- serviços que o laboratório já usa, do jeito que ele mesmo mantém — PDF,
-- planilha etc.), não linhas de preço estruturadas — a tabela
-- laboratory_catalogs (jsonb estruturado, já existente desde 202609070006 e
-- sem nenhum uso até hoje) não serve para isto e continua sem uso.
-- =========================================================================

-- =========================================================================
-- 1) Laboratório principal, explícito
-- Antes, "principal" era só a posição no array devolvido pelo formulário de
-- cadastro (o primeiro da lista) — sem nenhuma coluna ou UI que marcasse
-- isso de forma explícita. Índice único parcial garante no máximo 1
-- principal por profissional (o dono real do registro é sempre
-- professional_profile_id, não organization_id).
-- =========================================================================

alter table public.professional_laboratories
  add column if not exists is_primary boolean not null default false;

drop index if exists professional_laboratories_primary_unique;
create unique index professional_laboratories_primary_unique
  on public.professional_laboratories (professional_profile_id)
  where is_primary;

-- =========================================================================
-- 2) Vínculo atendimento (Etapa 6 — Produção) <-> laboratório parceiro
-- order_fulfillment.lens_lab_reference (migração 202609090011) só guarda um
-- texto livre (nº da OS dentro do sistema do próprio laboratório) — nenhuma
-- tabela sabia QUAL laboratório parceiro (professional_laboratories) está
-- produzindo a lente de um atendimento. Sem isso, o pedido de compra
-- dropshipping do painel de catálogo (projeto paralelo) não tem como
-- resolver sozinho o endereço de entrega.
-- laboratory_id nulo = laboratório ainda não definido para este atendimento
-- (o painel de catálogo trata null como "usar o endereço do master").
-- lens_lab_reference é mantido como está — os dois campos convivem: um diz
-- QUAL laboratório (estruturado, novo), o outro diz QUAL CÓDIGO lá dentro
-- (texto livre, já existia).
-- =========================================================================

alter table public.order_fulfillment
  add column if not exists laboratory_id uuid references public.professional_laboratories(id) on delete set null;

create index if not exists order_fulfillment_laboratory_idx
  on public.order_fulfillment (laboratory_id);

-- =========================================================================
-- 3) Biblioteca de preços do laboratório (arquivos anexáveis)
-- Cada envio novo é uma linha nova — nunca sobrescreve/apaga a anterior
-- (histórico preservado, mesmo espírito de "suspensão suave" já usado em
-- professional_laboratories); `active` marca só a versão vigente. A troca
-- de versão (marcar a anterior active=false) é feita pela rota de API, não
-- por um trigger — mesmo padrão de "todo write pela rota, com checagem de
-- posse em código" já usado no restante do projeto.
-- =========================================================================

create table if not exists public.laboratory_price_lists (
  id uuid primary key default gen_random_uuid(),
  laboratory_id uuid not null references public.professional_laboratories(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  file_path text not null,
  file_name text not null,
  content_type text,
  size_bytes integer,
  version_label text,
  active boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists laboratory_price_lists_lab_idx
  on public.laboratory_price_lists (laboratory_id, active);

alter table public.laboratory_price_lists enable row level security;

-- Só leitura (mesmo padrão de professional_laboratories/laboratory_catalogs
-- — todo write passa pela rota de API, via service role, com checagem de
-- posse em código, não por política de escrita no banco): dono do
-- laboratório (via professional_profile_id -> user_id) ou o master.
drop policy if exists laboratory_price_lists_owner_read on public.laboratory_price_lists;
create policy laboratory_price_lists_owner_read on public.laboratory_price_lists
  for select to authenticated using (
    public.is_master_admin() or exists (
      select 1
      from public.professional_laboratories l
      join public.professional_profiles p on p.id = l.professional_profile_id
      where l.id = laboratory_price_lists.laboratory_id and p.user_id = auth.uid()
    )
  );

-- Bucket 'laboratory-price-lists' precisa ser criado manualmente pelo painel
-- do Supabase (mesmo procedimento já usado para 'dnp-photos'/'try-on-photos'
-- — não há `insert into storage.buckets` em nenhuma migração deste
-- projeto). Privado, sem restrição de tipo de arquivo (o laboratório manda
-- a tabela de preços do jeito que já tem: PDF, planilha, imagem...).
--
-- Caminho sempre "{organization_id}/{laboratory_id}/{arquivo}" — leitura e
-- envio para quem é membro da organização dona do laboratório, ou o master.
-- O upload em si sempre acontece via service role na rota de API (mesmo
-- padrão de dnp-photos/try-on-photos), então esta política é defesa em
-- profundidade, não o caminho real de escrita hoje. Sem política de
-- remoção — segue a regra de "nunca apagar": uma versão nova só marca as
-- anteriores como active=false na tabela, sem tocar no arquivo já enviado.
drop policy if exists laboratory_price_lists_read on storage.objects;
drop policy if exists laboratory_price_lists_add on storage.objects;

create policy laboratory_price_lists_read on storage.objects for select to authenticated using (
  bucket_id = 'laboratory-price-lists' and (
    public.is_org_member(public.safe_storage_uuid(name, 1)) or public.is_master_admin()
  )
);
create policy laboratory_price_lists_add on storage.objects for insert to authenticated with check (
  bucket_id = 'laboratory-price-lists' and (
    public.is_org_member(public.safe_storage_uuid(name, 1)) or public.is_master_admin()
  )
);

commit;
