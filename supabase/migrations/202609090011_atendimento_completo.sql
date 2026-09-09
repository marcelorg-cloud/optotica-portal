begin;

-- Suporte ao fluxo completo de atendimento (9 passos), replicando a arquitetura
-- já resolvida nos protótipos de referência (area-profissional-optotico,
-- catalogo-optotico, modelo-01..05): catálogo de armação com dados internos
-- de fornecedor (AliExpress) escondidos do paciente, múltiplos orçamentos por
-- pedido com seleção de um deles, e acompanhamento de pagamento/produção/
-- logística/montagem/entrega.

-- =========================================================================
-- 1. Pedido: permitir múltiplos orçamentos (quotes) e marcar o escolhido
-- =========================================================================

alter table public.orders add column if not exists selected_quote_id uuid references public.quotes(id) on delete set null;

-- =========================================================================
-- 2. Catálogo de armação: catálogo global compartilhado (organization_id nulo)
--    além do catálogo por organização que já existia.
-- =========================================================================

alter table public.frames alter column organization_id drop not null;

drop policy if exists frames_read on public.frames;
create policy frames_read on public.frames for select using (
  organization_id is null
  or public.is_org_member(organization_id)
  or exists(select 1 from public.clients c where c.organization_id=frames.organization_id and public.is_client_user(c.id))
);

-- Seed do catálogo inicial (5 modelos), com os dados reais de fornecedor
-- (AliExpress) guardados em metadata para uso exclusivo da área profissional.
-- O preço/custo nunca deve ser exibido ao paciente — a interface do pedido só
-- lê esses campos no lado do profissional.
--
-- Nota: organization_id é nulo nessas linhas (catálogo global). Como o Postgres
-- trata dois NULLs como não-conflitantes num índice unique, "on conflict" não
-- detectaria uma linha global já existente — por isso usamos "where not exists"
-- por sku em vez de "on conflict", para a seed continuar segura de rodar de novo.

insert into public.frames (organization_id, sku, name, color, source, metadata, active)
select null, v.sku, v.name, v.color, 'aliexpress', v.metadata, true
from (values
  ('M01-14060-0001', 'Modelo 01', 'Preto', jsonb_build_object(
    'kind', 'Armação quadrada', 'supplier_product_id', '1005012995462441',
    'lens_width_mm', 50, 'lens_height_mm', 36,
    'variants', jsonb_build_array(
      jsonb_build_object('color','Preto','supplier_sku','12000059988264098','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/S24493ae994b64affa0aeab8dc510e432L.jpg'),
      jsonb_build_object('color','Marrom','supplier_sku','12000059988264099','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/Sc14111ea1cc546419d84a328352a4e8cn.jpg'),
      jsonb_build_object('color','Cinza','supplier_sku','12000059988264101','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/S31ef450c413c4dd8bfcdf84abf3f463fv.jpg'),
      jsonb_build_object('color','Marrom escuro','supplier_sku','12000059988264100','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/S0fef54c8c319465383c13ffb7ab97a25y.jpg'),
      jsonb_build_object('color','Verde','supplier_sku','12000059988264102','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/S084ca5e6994f47a18a072141562a3289m.jpg'),
      jsonb_build_object('color','Tartaruga','supplier_sku','12000059988264103','qty',4,'source_price_usd',9.04,'image','https://ae01.alicdn.com/kf/S6ed23163211949cba992171950e76a4ec.jpg')
    )
  )),
  ('M02-14060-0002', 'Modelo 02', 'Cinza translúcido', jsonb_build_object(
    'kind', 'Armação retangular', 'supplier_product_id', '1005006235178892',
    'lens_width_mm', 50, 'lens_height_mm', 43,
    'variants', jsonb_build_array(
      jsonb_build_object('color','Cinza translúcido','supplier_sku','12000036418827723','qty',2,'source_price_usd',9.26,'image','https://ae01.alicdn.com/kf/S5f33a8d4b8144b6ab891ce6e5fbae253O.jpg'),
      jsonb_build_object('color','Azul translúcido','supplier_sku','12000036418827722','qty',2,'source_price_usd',9.26,'image','https://ae01.alicdn.com/kf/S7cc8227388c645bab762c276c601eff4t.jpg'),
      jsonb_build_object('color','Preto','supplier_sku','12000036418827721','qty',1,'source_price_usd',9.26,'image','https://ae01.alicdn.com/kf/Sd57ab24d124241d4b5bdd69ab357f8aeM.jpg'),
      jsonb_build_object('color','Tartaruga preta','supplier_sku','12000036418827720','qty',1,'source_price_usd',8.77,'image','https://ae01.alicdn.com/kf/S6acd6072ae3942b99a348ae43bfdca8cC.jpg'),
      jsonb_build_object('color','Verde oliva','supplier_sku','12000036418827724','qty',1,'source_price_usd',9.33,'image','https://ae01.alicdn.com/kf/Sa9d95929bc2d4779b87e36b11a907778X.jpg'),
      jsonb_build_object('color','Preto translúcido','supplier_sku','12000036418827719','qty',2,'source_price_usd',8.95,'image','https://ae01.alicdn.com/kf/S8475ae90b1fe46ec915c1bea7bfcaa56w.jpg')
    )
  )),
  ('M03-14060-0003', 'Modelo 03', 'Preto', jsonb_build_object(
    'kind', 'Armação hexagonal', 'supplier_product_id', '1005005643942879',
    'lens_width_mm', 51, 'lens_height_mm', 49,
    'variants', jsonb_build_array(
      jsonb_build_object('color','Tartaruga','supplier_sku','12000033870107267','qty',3983,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/S99b763a52c814ce3a7be2e3326ec28aaE.jpg'),
      jsonb_build_object('color','Cinza translúcido','supplier_sku','12000033870107266','qty',2093,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/Sb21bdb58ce2c495eaa6764f9749a3288p.jpg'),
      jsonb_build_object('color','Verde azulado','supplier_sku','12000033870107265','qty',2096,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/S8b9f8b6c70f74bbdb15713b018f3f5b6i.jpg'),
      jsonb_build_object('color','Preto','supplier_sku','12000033870107264','qty',2097,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/Sb20cc9d865944c5281778afff10dad88q.jpg'),
      jsonb_build_object('color','Roxo translúcido','supplier_sku','12000033870107269','qty',2097,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/S55776d43be0a4e2780dc00b7348bb88eq.jpg'),
      jsonb_build_object('color','Roxo e rosa','supplier_sku','12000033870107268','qty',2097,'source_price_usd',10.05,'image','https://ae-pic-a1.aliexpress-media.com/kf/S44bee26af0724866bdb725424c29748cO.jpg')
    )
  )),
  ('M04-14060-0004', 'Modelo 04', 'Preto', jsonb_build_object(
    'kind', 'Armação quadrada', 'supplier_product_id', '4001287673416',
    'lens_width_mm', null, 'lens_height_mm', null,
    'variants', jsonb_build_array(
      jsonb_build_object('color','Preto','supplier_sku','10000015626241875','qty',3,'source_price_usd',8.76,'image','https://ae01.alicdn.com/kf/Ha964e6e3b37049f599d709b682cb650fU.jpg'),
      jsonb_build_object('color','Âmbar','supplier_sku','10000015626241879','qty',2,'source_price_usd',8.69,'image','https://ae01.alicdn.com/kf/Hc1e83ff43ab04eda8a4de94d1156bd2ff.jpg'),
      jsonb_build_object('color','Transparente','supplier_sku','10000015626241878','qty',9,'source_price_usd',11.00,'image','https://ae01.alicdn.com/kf/H155cdfc6cbef4d679ff6f9ab59ad73c0d.jpg'),
      jsonb_build_object('color','Tartaruga','supplier_sku','10000015626241877','qty',3,'source_price_usd',8.75,'image','https://ae01.alicdn.com/kf/H77b17e76bcfe40c6b26598baea82b14e6.jpg'),
      jsonb_build_object('color','Cinza translúcido','supplier_sku','10000015626241876','qty',3,'source_price_usd',11.33,'image','https://ae01.alicdn.com/kf/H0235a71222644de2ab54c6c0297464b6Y.jpg')
    )
  )),
  ('M05-14060-0005', 'Modelo 05', 'Preto', jsonb_build_object(
    'kind', 'Armação redonda', 'supplier_product_id', '4000115179527',
    'lens_width_mm', null, 'lens_height_mm', null,
    'variants', jsonb_build_array(
      jsonb_build_object('color','Rosé','supplier_sku','12000041478496910','qty',356,'source_price_usd',6.97,'image','https://ae-pic-a1.aliexpress-media.com/kf/Sc62af7f0abbc4490ba3a350fe968739aY.jpg'),
      jsonb_build_object('color','Prata','supplier_sku','10000000299787786','qty',189,'source_price_usd',6.97,'image','https://ae-pic-a1.aliexpress-media.com/kf/Sf947e14a82ca4ede8ba0ac0c00fbab3bo.jpg'),
      jsonb_build_object('color','Dourado','supplier_sku','10000000299787784','qty',217,'source_price_usd',6.97,'image','https://ae-pic-a1.aliexpress-media.com/kf/Scc895228b913488caf0de0922fd8b1f8n.jpg'),
      jsonb_build_object('color','Preto','supplier_sku','10000000299787783','qty',156,'source_price_usd',6.97,'image','https://ae-pic-a1.aliexpress-media.com/kf/Saaf42d4c90a748169feec44ee43b5a27P.jpg')
    )
  ))
) as v(sku, name, color, metadata)
where not exists (
  select 1 from public.frames f where f.sku = v.sku and f.organization_id is null
);

-- =========================================================================
-- 3. Acompanhamento do pedido: comanda final, pagamento, produção, logística,
--    montagem e entrega — um registro por pedido.
-- =========================================================================

create table if not exists public.order_fulfillment (
  order_id uuid primary key references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Passo 4: Comanda final
  measure_height_od numeric(5,2),
  measure_height_oe numeric(5,2),
  measure_bridge numeric(5,2),
  measure_diagonal numeric(5,2),
  final_lab_notes text,
  comanda_confirmed_at timestamptz,

  -- Passo 5: Pagamento
  payment_method text check (payment_method in ('dinheiro','pix','link','maquina')),
  payment_value numeric(10,2),
  payment_confirmed_at timestamptz,

  -- Passo 6: Produção
  frame_production_status text not null default 'aguardando_pedido'
    check (frame_production_status in ('aguardando_pedido','pedido_realizado','confirmado_fornecedor','indisponivel')),
  frame_supplier_reference text,
  lens_production_status text not null default 'aguardando_envio'
    check (lens_production_status in ('aguardando_envio','enviado_laboratorio','confirmado_laboratorio','em_producao','pronta')),
  lens_lab_reference text,

  -- Passo 7: Logística (marcos de linha do tempo)
  frame_shipped_at timestamptz,
  frame_received_at timestamptz,
  lens_confirmed_at timestamptz,
  lens_ready_at timestamptz,

  -- Passo 8: Montagem
  frame_received_check boolean not null default false,
  lens_received_check boolean not null default false,
  assembly_status text not null default 'aguardando'
    check (assembly_status in ('aguardando','em_montagem','em_conferencia','concluida')),
  assembly_notes text,

  -- Passo 9: Entrega
  delivery_destination text check (delivery_destination in ('loja','optometrista','cliente_final')),
  delivery_date date,
  delivery_received_by text,
  delivery_notes text,
  delivered_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_fulfillment enable row level security;

drop policy if exists order_fulfillment_all on public.order_fulfillment;
create policy order_fulfillment_all on public.order_fulfillment for all using (
  public.is_org_member(organization_id)
) with check (
  public.is_org_member(organization_id) and public.order_belongs_to_org(order_id, organization_id)
);

create index if not exists order_fulfillment_org_idx on public.order_fulfillment (organization_id);

commit;
