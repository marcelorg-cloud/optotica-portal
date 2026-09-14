-- Pedido do usuário (14/09/2026): ao clicar em "Importar/atualizar do
-- AliExpress", seria bom que já aparecesse o JSON usado da última vez (em
-- vez de precisar ir buscar/copiar de novo no AliExpress toda vez), e
-- poder "resetar" as fotos do produto a partir dele (ver seção 0.61 do
-- estado-consolidado.md e as novas rotas
-- .../aliexpress-json e .../images/reset-photos).
--
-- Guarda o texto CRU do último JSON que foi analisado com sucesso pra este
-- produto (não só o que foi de fato importado) — TEXT simples, não jsonb,
-- porque o objetivo é só devolver exatamente o mesmo texto pra pré-encher a
-- caixa de colar de novo, nunca consultar campos de dentro dele pelo banco.
-- Nullable e sem default: produtos que nunca tiveram um JSON colado (ex.:
-- os 5 modelos "peekaboo" seedados via SQL manual) ficam com null, sem
-- problema nenhum — a tela já trata "sem JSON salvo ainda" mostrando a
-- caixa vazia, do jeito que já era antes desta migração.
alter table catalog_products
  add column if not exists last_aliexpress_import_json text,
  add column if not exists last_aliexpress_import_at timestamptz;
