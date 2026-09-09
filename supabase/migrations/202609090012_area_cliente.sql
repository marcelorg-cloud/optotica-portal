begin;

-- =========================================================================
-- Área do cliente: leitura de apoio via RLS para prescrição e acompanhamento
-- do pedido. As rotas de escrita (seleção de orçamento e de armação pelo
-- próprio cliente) usam o client admin com checagem manual de posse do
-- pedido, no mesmo padrão já usado nas rotas profissionais — por isso não
-- é necessária nenhuma política de escrita nova aqui. Estas duas políticas
-- de SELECT só fecham uma lacuna: hoje o cliente já lê orders/quotes/
-- quote_items/frames/order_frames (políticas *_read existentes incluem
-- is_client_user), mas prescriptions e order_fulfillment ainda não tinham
-- leitura liberada para o próprio cliente.
-- =========================================================================

drop policy if exists prescriptions_read_client on public.prescriptions;
create policy prescriptions_read_client on public.prescriptions for select using (
  public.is_org_member(organization_id) or public.is_client_user(client_id)
);

drop policy if exists order_fulfillment_read_client on public.order_fulfillment;
create policy order_fulfillment_read_client on public.order_fulfillment for select using (
  public.is_org_member(organization_id)
  or exists(select 1 from public.orders o where o.id = order_fulfillment.order_id and public.is_client_user(o.client_id))
);

commit;
