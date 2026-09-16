-- Fluxo de mensagens de WhatsApp por estágio do atendimento (16/09/2026).
--
-- Pedido do usuário: aplicar, nesta fase, SÓ notificações manuais (o
-- profissional decide e confirma cada envio — sem temporizador, sem IA, sem
-- retomada automática). Uma camada de atendimento por IA fica para uma fase
-- futura, fora do escopo desta migração.
--
-- Duas peças novas de dados, as duas mínimas possíveis para o fluxo
-- descrito pelo usuário:
--
--  1) `clients.is_test_patient` — campo editável pelo profissional (ver
--     app/api/professional/orders/[orderId]/whatsapp-stage/route.ts,
--     ação `set_test_patient`) para marcar quais pacientes são "de teste".
--     Regra do usuário: nesta fase, desconto/cupom só pode aparecer para
--     pacientes de teste — nunca para pacientes reais. `false` por padrão
--     preserva esse comportamento seguro para todo cliente já cadastrado.
--
--  2) `order_whatsapp_messages` — log de toda mensagem deste fluxo, tanto
--     enviada pela Optótica (direction='outbound', sempre depois da
--     confirmação do profissional) quanto recebida do paciente
--     (direction='inbound', um toque em botão). Serve a dois propósitos:
--       a) Idempotência: o webhook do WhatsApp pode receber o mesmo evento
--          mais de uma vez (reentrega da Meta) — `whatsapp_message_id`
--          único evita processar duas vezes o mesmo toque em botão.
--       b) Contexto da resposta: quando o paciente toca um botão, o
--          payload da Meta traz `context.id` = o id da mensagem original
--          (a que tinha os botões). Buscando esse id nesta tabela
--          (direction='outbound') o webhook descobre a qual pedido/estágio
--          aquele toque se refere, sem precisar de nenhum estado novo em
--          memória — só o que já está salvo no atendimento, como pede a
--          regra "considerar o que está efetivamente salvo no atendimento".
--
-- Esta migração NÃO mexe em `patient_access_invitations`,
-- `whatsapp_access_requests` nem em nenhuma tabela do fluxo de convite por
-- WhatsApp já existente — é aditiva, uma tabela nova e uma coluna nova.

alter table public.clients
  add column if not exists is_test_patient boolean not null default false;

-- Coluna nova (nullable) em `whatsapp_access_requests` — tabela do fluxo de
-- convite por WhatsApp já existente, NÃO alterada em nenhuma outra coisa.
-- O motivo: o profissional pediu que "Ver prescrição"/"Fazer pagamento"
-- abram a área do paciente já no trecho certo (seção "Minha receita",
-- pedido em si etc.), reaproveitando o MESMO mecanismo de link mágico de
-- uso único que o fluxo de convite já usa (app/auth/confirm/route.ts).
-- Hoje esse mecanismo só sabe redirecionar para "/cliente" (fixo, ver
-- app/auth/confirm/route.ts). Em vez de duplicar todo o mecanismo de
-- geração/validação de link só para o fluxo novo, este campo guarda o
-- destino específico (ex.: "/cliente/pedido/<id>#receita") de um pedido de
-- acesso — quando vazio (todo registro já existente, e todo registro novo
-- criado pelo fluxo de convite original, que nunca preenche esta coluna),
-- o comportamento de sempre ("/cliente") é preservado sem nenhuma mudança.
alter table public.whatsapp_access_requests
  add column if not exists redirect_path text;

create table if not exists public.order_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Estágio da mensagem no momento do envio (ver lib/order-whatsapp-stage.ts):
  -- 'prescricao_disponivel' | 'orcamento_selecionado' | 'pedido_completo' | 'pagamento_confirmado'.
  -- Para uma linha inbound (resposta de botão), repete o estágio da mensagem
  -- outbound de origem (copiado no momento do registro, não recalculado).
  stage text not null,
  direction text not null,
  -- Id da mensagem na Meta (wamid). Único: garante que uma reentrega do
  -- mesmo webhook (outbound: mesmo envio; inbound: mesmo toque) nunca seja
  -- processada/registrada duas vezes.
  whatsapp_message_id text not null,
  -- Id do botão (ex.: 'ver_prescricao'). Null numa mensagem outbound sem
  -- botões (não existe nesta fase, mas a coluna fica aberta para o futuro).
  button_id text,
  body text not null,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_whatsapp_messages_direction_check check (direction in ('outbound', 'inbound')),
  constraint order_whatsapp_messages_stage_check check (stage in ('prescricao_disponivel', 'orcamento_selecionado', 'pedido_completo', 'pagamento_confirmado')),
  constraint order_whatsapp_messages_wamid_unique unique (whatsapp_message_id)
);

create index if not exists order_whatsapp_messages_order_idx on public.order_whatsapp_messages (order_id, created_at desc);

alter table public.order_whatsapp_messages enable row level security;

-- Mesmo padrão de RLS de order_frame_reactions/order_frames (defesa em
-- profundidade — as rotas novas usam o cliente admin/service-role, que
-- ignora RLS; a política fica correta caso algum dia um cliente comum
-- precise ler direto). Só a própria ótica lê/escreve o log das suas
-- mensagens — o paciente não tem (e não precisa de) acesso a esta tabela.
drop policy if exists order_whatsapp_messages_read on public.order_whatsapp_messages;
create policy order_whatsapp_messages_read on public.order_whatsapp_messages for select using (
  public.is_org_member(organization_id)
);
drop policy if exists order_whatsapp_messages_write on public.order_whatsapp_messages;
create policy order_whatsapp_messages_write on public.order_whatsapp_messages for all using (
  public.is_org_member(organization_id)
) with check (
  public.is_org_member(organization_id) and public.order_belongs_to_org(order_id, organization_id)
);
