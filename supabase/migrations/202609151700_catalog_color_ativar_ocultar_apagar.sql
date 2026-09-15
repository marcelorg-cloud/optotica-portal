-- ATIVAR / OCULTAR / apagar por cor, no painel de catálogo (15/09/2026,
-- pedido do usuário a partir de um print anotado: "vamos acrescentar essas
-- ações: ativar: que deixa o produto (por cor) apto para aparecer no front
-- do profissional e do paciente. ocultar mantém o cadastro, porém não
-- aparece no front para ninguém, e a lixeira que é para excluir aquele
-- cadastro de uma cor específica").
--
-- Decisões tomadas com o usuário antes desta migração:
-- 1) Estado inicial: TODAS as cores (as que já existem hoje E as novas)
--    NASCEM OCULTAS (is_active = false) — inclusive as que já estavam sendo
--    usadas na Etapa 3 "Escolha da armação" (seção 0.71) e na prova online
--    do paciente. Ou seja: depois de rodar esta migração e subir os
--    arquivos, NENHUMA cor aparece em nenhum front até o master clicar
--    ATIVAR em cada uma manualmente — isso é esperado, não é bug.
-- 2) A lixeira apaga só o REGISTRO no banco (a linha de
--    catalog_product_color_images e o que depende só dela em cascata — ver
--    FKs já existentes). Os arquivos de imagem no Storage NÃO são apagados
--    junto (ficam órfãos, mas intactos — mais seguro; podem ser limpos numa
--    revisão futura, mesmo espírito de `arquivos-mortos.md`).
--
-- A ação de apagar em si já existia como rota (DELETE em
-- .../images/[colorImageId]/route.ts), mas só era usada internamente pelo
-- "Desfazer última ação" logo depois de criar uma cor por engano — agora
-- também fica exposta como o botão de lixeira normal na tela, sem mudança
-- nenhuma de schema necessária pra isso (só o botão + confirmação no
-- front). Esta migração cobre só a parte de ATIVAR/OCULTAR.
alter table public.catalog_product_color_images
  add column if not exists is_active boolean not null default false;

create index if not exists catalog_product_color_images_is_active_idx
  on public.catalog_product_color_images (is_active);
