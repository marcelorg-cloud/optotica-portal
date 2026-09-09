begin;

-- =========================================================================
-- 1. Numeração de atendimento por paciente (não mais por organização).
--    Antes, o número do atendimento vinha de next_order_number(org_id), uma
--    sequência única por organização — então o segundo atendimento de um
--    paciente podia sair com um número bem maior que 2 (ex.: #15), porque o
--    contador era compartilhado com todos os outros pacientes da ótica.
--    Agora cada paciente tem sua própria contagem: o primeiro atendimento é
--    sempre #1, o segundo #2, e assim por diante, independente de quantos
--    atendimentos outros pacientes já tiveram. A função antiga
--    next_order_number/order_sequences não é tocada (outros usos, se algum
--    dia existirem, continuam funcionando como antes).
-- =========================================================================

create or replace function public.next_client_order_number(target_client uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  -- Trava consultiva por paciente: evita que duas requisições concorrentes
  -- (ex.: duplo clique, duas abas) calculem o mesmo próximo número para o
  -- mesmo paciente. A trava é liberada automaticamente ao fim da transação.
  perform pg_advisory_xact_lock(hashtextextended(target_client::text, 42));
  select coalesce(max(order_number), 0) + 1 into next_number
  from public.orders
  where client_id = target_client;
  return next_number;
end;
$$;

grant execute on function public.next_client_order_number(uuid) to authenticated;

-- Garantia adicional a nível de banco: nunca dois atendimentos do mesmo
-- paciente com o mesmo número, mesmo em uma corrida que escape da trava
-- acima (ex.: duas conexões distintas). Como order_number já era único
-- globalmente até aqui, este índice não pode conflitar com nenhum dado
-- existente — é estritamente mais permissivo que a garantia anterior.
create unique index if not exists orders_client_order_number_unique on public.orders(client_id, order_number);

-- =========================================================================
-- 2. Pagamento: valor de entrada e valor na retirada, além do valor final
--    da venda já existente. Não mexe nas colunas/opções de forma de
--    pagamento já existentes (dinheiro/pix/link/maquina).
-- =========================================================================

alter table public.order_fulfillment add column if not exists payment_down_value numeric(10,2);
alter table public.order_fulfillment add column if not exists payment_pickup_value numeric(10,2);

commit;
