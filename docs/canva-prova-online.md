# Canva — prova online por produto e cor

## Fluxo
1. Na Foto de Prova da cor, abra **Preparar no Canva**.
2. Em **Imagem modelo da prova online**, cadastre um PNG de 540 × 540 px com fundo e lentes transparentes. O modelo é compartilhado pelas novas páginas de todos os produtos.
3. No produto, cadastre a **Foto de medidas do modelo** e preencha as medidas conhecidas, principalmente a Frente Total.
4. Conecte sua conta Canva e clique **Criar página desta cor no Canva**.
5. O primeiro envio cria o design do produto; as próximas cores acrescentam páginas ao mesmo design. Reabrir uma cor reutiliza sua página enquanto as referências não mudarem; depois de uma mudança, o portal exige **Refazer com as referências**.
6. Cada página nova ou refação leva três imagens separadas: o modelo ocupa a página toda, a foto real da cor fica no canto superior direito e a foto de medidas no canto superior esquerdo.
7. Selecione as três imagens e use o prompt específico exibido pelo portal em **Pede pro Canva**. A foto da cor define identidade/acabamento; a foto cotada e as medidas definem geometria; o modelo grande define enquadramento e largura.
8. Remova as duas imagens pequenas e a armação modelo antes de exportar, deixando somente a frente real, sem hastes, com fundo e interior dos aros transparentes.
9. Retorne ao portal ou clique **Importar do Canva**. Confira o PNG e confirme o salvamento.

O arquivo e o título preparado da página seguem `[SKU da variante]-[frente em mm]mm.png`.
Exemplo: produto `GE-AC-003`, cor `C2`, Frente Total `113 mm` → `GE-AC-003-C2-113mm.png`.
A medida vem do cadastro; `000mm` é apenas o marcador do arquivo modelo. Medidas menores que 100 têm três posições (095mm); decimais são preservados.
O resultado tem 540 × 540 px e transparência. Margens vazias são normalizadas para a largura do PNG corresponder à largura física da armação na prova.

A edição visual acontece dentro do Canva. O portal não aciona automaticamente “Pede pro Canva”.
O prompt é montado para cada modelo/cor e lista somente medidas estruturadas preenchidas. Ele também manda ler as cotas visíveis na foto de medidas, para cobrir valores presentes apenas no diagrama.
Uma revisão monotônica muda quando a foto cotada ou qualquer medida geométrica é alterada. Página, sessão e PNG salvo registram essa revisão e também o `updated_at` exato da imagem modelo grande; trocar qualquer uma das três referências invalida os resultados anteriores e interrompe o salvamento de uma edição antiga.

## Imagem modelo recebida
Em 23/09/2026, o modelo foi substituído pelo PNG aprovado de 540 × 540 px e registrado na tabela privada `canva_tryon_template`.
O arquivo tem canal alpha, fundo e interior das lentes transparentes (73.443 bytes; SHA-256 `a51dc37e3243e7422a3d1ae27a299c822350eadb2dde5b5f3913b9fa346fe3a2`) e está liberado para criar páginas.
O upload aceita apenas PNG de 540 × 540 px, até 1 MB. O conteúdo não está publicado no repositório; somente o master pode consultar/substituir pelo servidor.

## APIs e limites atuais
A preparação usa um ODP com uma página nomeada e três imagens independentes. O arquivo é enviado em bytes à API `/imports`; não é hospedado publicamente.
A primeira importação vira o design principal. Para cores adicionais, `/merges` insere a página do design auxiliar no design do produto. Esses designs auxiliares de importação permanecem na conta Canva.

As APIs [Merge](https://www.canva.dev/docs/apps/rest-apis/reference/merges/create-design-merge-job/) e [Get design pages](https://www.canva.dev/docs/apps/rest-apis/reference/designs/get-design-pages/) estão em **preview**. A documentação informa que apps públicos que usam APIs preview não passam pela revisão para distribuição geral. Confirmar disponibilidade na integração/conta usada no piloto antes de ativar. Cada merge usa uma única operação.
A preservação do título da página e a dimensão importada precisam ser conferidas no teste real do Canva. O Canva pode representar a página importada como 1080 × 1080 px; o portal aceita páginas quadradas com pelo menos 540 px por lado e exporta o PNG final em 540 × 540 px. Em recuperação, **Vincular página existente** exige design e número da página.
O vínculo manual consulta qualquer merge identificado e bloqueia enquanto ele estiver em andamento. Em merge concluído com sucesso, ou numa preparação interrompida depois do envio mas antes de receber um ID de job, o portal compara o design com o snapshot anterior e só aceita a página escolhida quando ela é a única página nova, completa e quadrada. Enquanto a página não aparece, ainda está propagando ou há mais de uma candidata, o master precisa aguardar e conferir o design. Um merge que terminou com falha ainda permite uma seleção manual explícita. A confirmação grava atomicamente a página e o snapshot das referências atuais; uma alteração concorrente faz a operação falhar sem substituir o andamento mais novo.
Se a importação ou o merge já tiver sido concluído, o portal retoma o mesmo design ou job e confere novamente os IDs das páginas, sem enviar outra operação de criação ao Canva.

O ID da página, e não sua posição, identifica a cor. Antes de exportar, o portal resolve sua posição atual. Alterações na ordem durante uma exportação interrompem a importação para evitar salvar outra cor.
Os dois cantos reservados às referências precisam estar vazios antes de importar. A conferência humana verifica se o modelo foi substituído pelo produto real e se as lentes estão transparentes; isso não é garantido apenas pela análise do PNG.

## Ativação
Crie a integração no [Canva Developers](https://www.canva.com/developers/), habilitando REST/Connect APIs e verificando acesso às APIs preview.
Permissões configuradas: `design:content:read`, `design:content:write`, `design:meta:read`, `profile:read`.

- OAuth redirect: `https://optotica-portal.vercel.app/api/admin/catalog/canva/oauth/callback`
- Return navigation: `https://optotica-portal.vercel.app/api/admin/catalog/canva/return`

Variáveis servidor:
- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`
- `CANVA_TOKEN_ENCRYPTION_KEY` — 32 bytes aleatórios em hexadecimal (64 caracteres).
- `CANVA_APP_ORIGIN=https://optotica-portal.vercel.app`

A conexão Canva deste chat não fornece as credenciais da integração do portal. Não coloque segredos em variáveis `NEXT_PUBLIC_*`, código ou mensagens.
Preview e produção precisam de URLs registradas e origem correspondentes. PNG transparente exige `export_png_transparency` na conta Canva.

Migrações versionadas para o fluxo Canva em 23 e 25/09/2026:
- `20260923193213_canva_tryon.sql`
- `20260923210832_canva_product_pages.sql`
- `20260925023119_canva_measurement_references.sql`
- `20260925023750_canva_template_reference_snapshots.sql`
- `20260925023846_canva_atomic_page_binding.sql`
- `20260925030000_invalidate_stale_patient_tryons.sql`

Confirme que todas as seis foram aplicadas no banco de cada ambiente antes de ativar a integração.

## Proteções e verificação
- Somente master; origem verificada nas mutações. OAuth PKCE e state de uso único.
- Tokens AES-256-GCM no servidor; refresh serializado; retorno EdDSA/Ed25519 validado pelas chaves públicas atuais do Canva e conferido por conta/equipe/design.
- RLS ativo, grants revogados de anon/authenticated. O [aviso informativo RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) é esperado para essas tabelas exclusivas do serviço.
- Bloqueio por produto, operações assíncronas persistidas, recuperação sem repetir criação de resultado desconhecido.
- Índice único impede vincular a mesma página a duas cores.
- Salvamento compara original, foto anterior, data, SKU, variante, revisão das medidas e versão da imagem modelo em transação.
- Ao trocar o PNG final ou a largura usada na escala, as composições já geradas para pacientes são invalidadas e refeitas na próxima abertura.
- Originais/arquivos anteriores preservados; nenhuma ativação/publicação automática da cor.
- Sessões expiram em 24h; estados OAuth em 10min. Prévias não confirmadas permanecem no bucket.

Em 25/09/2026: a suíte do fluxo Canva cobre o ODP quadrado com três imagens independentes, prompt específico, proxy privado da foto de medidas, remoção das duas referências, vínculo por ID de página e conflitos de revisão.

```sh
npx next typegen
npm run typecheck
node --test tests/canva-tryon.test.mjs
npm run build
```

Ainda falta o teste real após cadastrar credenciais e enviar o modelo transparente: duas cores no mesmo design; nomes e tamanho das páginas; reabertura sem duplicar; remoção da referência; exportação da cor correta; conferência na prova profissional/paciente.
