-- Aplica o novo padrão de SKU/nome (seção "Padrão de Identificação de
-- Armações", documento anexado pelo usuário em 13/09/2026) aos 5 modelos
-- "peekaboo" já cadastrados (seed 202609120001). Números de modelo 001-005,
-- na mesma ordem em que já estavam (Modelo 01..05) — a sequence global
-- continua de 006 em diante pros próximos produtos criados pela tela.
--
-- IMPORTANTE — decisão de segurança tomada nesta rodada: o `color_name` de
-- cada cor já cadastrada NÃO é alterado aqui (fica exatamente como está —
-- "Preto", "Tartaruga" etc.). Esse campo é usado como chave de busca em
-- outras tabelas por VALOR (fila de compras, imagens de exibição da prova
-- online) — trocar seu valor com pedidos/provas já vinculados deixaria
-- esses registros órfãos, e não há como eu confirmar daqui se isso já
-- existe em produção. Só os campos NOVOS são preenchidos
-- (`color_variant_number`, `color_principal`, `color_secondary`) — o nome
-- interno (`color_name`) só passa a ser gerado no padrão novo
-- ("Modelo X - Cor N") para cores criadas DAQUI PRA FRENTE.
--
-- Material: NÃO estava registrado em lugar nenhum do cadastro anterior —
-- inferido pelos nomes das cores (translúcido/tartaruga sugerem acetato;
-- Rosé/Prata/Dourado sugerem metal). Confirme e corrija manualmente na tela
-- se algum desses 5 modelos não for do material que assumi aqui.
--
-- Seguro de rodar mais de uma vez? NÃO — mesmo padrão dos outros scripts de
-- dados (supabase/data/): UPDATE simples, sem proteção contra reaplicação.

begin;

-- Modelo 01 — Armação quadrada → QT-AC-001 (assumido: acetato)
update public.catalog_products
  set format_code = 'QT', material_code = 'AC', model_number = 1,
      sku_optotica = 'QT-AC-001', model_name = 'Quadrado em acetato 001'
  where sku_optotica = 'M01-14060-0001';

update public.catalog_product_color_images set color_variant_number = 1, color_principal = 'Preto'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Preto';
update public.catalog_product_color_images set color_variant_number = 2, color_principal = 'Marrom'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Marrom';
update public.catalog_product_color_images set color_variant_number = 3, color_principal = 'Cinza'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Cinza';
update public.catalog_product_color_images set color_variant_number = 4, color_principal = 'Marrom'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Marrom escuro';
update public.catalog_product_color_images set color_variant_number = 5, color_principal = 'Verde'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Verde';
update public.catalog_product_color_images set color_variant_number = 6, color_principal = 'Tartaruga'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-001') and color_name = 'Tartaruga';

-- Modelo 02 — Armação retangular → RT-AC-002 (assumido: acetato)
update public.catalog_products
  set format_code = 'RT', material_code = 'AC', model_number = 2,
      sku_optotica = 'RT-AC-002', model_name = 'Retangular em acetato 002'
  where sku_optotica = 'M02-14060-0002';

update public.catalog_product_color_images set color_variant_number = 1, color_principal = 'Fumê'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Cinza translúcido';
update public.catalog_product_color_images set color_variant_number = 2, color_principal = 'Azul'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Azul translúcido';
update public.catalog_product_color_images set color_variant_number = 3, color_principal = 'Preto'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Preto';
update public.catalog_product_color_images set color_variant_number = 4, color_principal = 'Tartaruga'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Tartaruga preta';
update public.catalog_product_color_images set color_variant_number = 5, color_principal = 'Verde-oliva'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Verde oliva';
update public.catalog_product_color_images set color_variant_number = 6, color_principal = 'Fumê'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RT-AC-002') and color_name = 'Preto translúcido';

-- Modelo 03 — Armação hexagonal → GE-AC-003 (sem código exato p/ hexagonal — usado "Geométrico"; assumido: acetato)
update public.catalog_products
  set format_code = 'GE', material_code = 'AC', model_number = 3,
      sku_optotica = 'GE-AC-003', model_name = 'Geométrico em acetato 003'
  where sku_optotica = 'M03-14060-0003';

update public.catalog_product_color_images set color_variant_number = 1, color_principal = 'Tartaruga'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Tartaruga';
update public.catalog_product_color_images set color_variant_number = 2, color_principal = 'Fumê'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Cinza translúcido';
update public.catalog_product_color_images set color_variant_number = 3, color_principal = 'Turquesa'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Verde azulado';
update public.catalog_product_color_images set color_variant_number = 4, color_principal = 'Preto'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Preto';
update public.catalog_product_color_images set color_variant_number = 5, color_principal = 'Roxo'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Roxo translúcido';
update public.catalog_product_color_images set color_variant_number = 6, color_principal = 'Roxo', color_secondary = 'Rosa'
  where product_id = (select id from public.catalog_products where sku_optotica = 'GE-AC-003') and color_name = 'Roxo e rosa';

-- Modelo 04 — Armação quadrada → QT-AC-004 (assumido: acetato)
update public.catalog_products
  set format_code = 'QT', material_code = 'AC', model_number = 4,
      sku_optotica = 'QT-AC-004', model_name = 'Quadrado em acetato 004'
  where sku_optotica = 'M04-14060-0004';

update public.catalog_product_color_images set color_variant_number = 1, color_principal = 'Preto'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-004') and color_name = 'Preto';
update public.catalog_product_color_images set color_variant_number = 2, color_principal = 'Caramelo'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-004') and color_name = 'Âmbar';
update public.catalog_product_color_images set color_variant_number = 3, color_principal = 'Cristal'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-004') and color_name = 'Transparente';
update public.catalog_product_color_images set color_variant_number = 4, color_principal = 'Tartaruga'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-004') and color_name = 'Tartaruga';
update public.catalog_product_color_images set color_variant_number = 5, color_principal = 'Fumê'
  where product_id = (select id from public.catalog_products where sku_optotica = 'QT-AC-004') and color_name = 'Cinza translúcido';

-- Modelo 05 — Armação redonda → RD-MT-005 (assumido: metal, pelas cores Rosé/Prata/Dourado)
update public.catalog_products
  set format_code = 'RD', material_code = 'MT', model_number = 5,
      sku_optotica = 'RD-MT-005', model_name = 'Redondo em metal 005'
  where sku_optotica = 'M05-14060-0005';

update public.catalog_product_color_images set color_variant_number = 1, color_principal = 'Rosé'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RD-MT-005') and color_name = 'Rosé';
update public.catalog_product_color_images set color_variant_number = 2, color_principal = 'Prata'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RD-MT-005') and color_name = 'Prata';
update public.catalog_product_color_images set color_variant_number = 3, color_principal = 'Dourado'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RD-MT-005') and color_name = 'Dourado';
update public.catalog_product_color_images set color_variant_number = 4, color_principal = 'Preto'
  where product_id = (select id from public.catalog_products where sku_optotica = 'RD-MT-005') and color_name = 'Preto';

-- Continua a sequence global de números de modelo a partir de 006 — os
-- próximos produtos criados pela tela (formato+material, sem digitar SKU)
-- recebem 006, 007... automaticamente.
select setval('public.catalog_products_model_number_seq', 5, true);

commit;
