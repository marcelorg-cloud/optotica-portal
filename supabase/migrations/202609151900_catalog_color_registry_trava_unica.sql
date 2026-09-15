-- Trava definitiva contra cor duplicada, direto no banco (15/09/2026).
--
-- Pendência deixada em aberto de propósito na migração 202609140100 (ver
-- comentário final daquele arquivo): uma constraint UNIQUE não pode ser
-- criada enquanto existir duplicata em produção. Agora que a limpeza
-- (`limpeza-duplicatas-cores-v2-15092026.sql`) já rodou e a migração
-- 202609140100 já rodou de verdade em produção (confirmado hoje que ela
-- nunca tinha rodado antes — só o código da aplicação já referenciava a
-- tabela global, o banco não tinha ela), esta trava pode ser adicionada.
--
-- A partir de agora, mesmo que algum caminho novo do código esqueça de
-- checar duplicata antes de inserir (o mesmo tipo de falha que causou o
-- bug de hoje: o botão de importar seguiu criando linha nova a cada
-- reimportação em vez de reconhecer a cor já existente), o PRÓPRIO BANCO
-- rejeita a segunda linha — o bug vira um erro visível na hora de tentar
-- criar, não mais uma duplicata silenciosa só descoberta dias depois.
--
-- `color_registry_id` pode ser NULL (cor ainda sem cor principal definida,
-- status 'incompleto') — UNIQUE do Postgres trata cada NULL como diferente
-- de qualquer outro, então várias cores incompletas do mesmo produto não
-- colidem entre si por causa disso (o que é o comportamento certo: elas
-- ainda não têm uma "cor real" pra duplicar).
alter table public.catalog_product_color_images
  add constraint catalog_product_color_images_product_registry_unique
    unique (product_id, color_registry_id);
