# Canva — prova online por produto e cor

## Fluxo
1. Na Foto de Prova da cor, abra **Preparar no Canva**.
2. Em **Imagem modelo da prova online**, cadastre um PNG de 540 × 540 px com fundo e lentes transparentes. O modelo é compartilhado pelas novas páginas de todos os produtos.
3. Conecte sua conta Canva e clique **Criar página desta cor no Canva**.
4. O primeiro envio cria o design do produto; as próximas cores acrescentam páginas ao mesmo design. Reabrir uma cor reutiliza sua página.
5. Cada página leva duas imagens separadas: o modelo ocupa a página toda e a foto original da cor fica no canto superior direito (até 184 × 80 px).
6. No Canva, use o modelo apenas como guia. Substitua a armação modelo pela frente real do produto, preserve sua cor/forma e remova a foto pequena antes de exportar.
7. Retorne ao portal ou clique **Importar do Canva**. Confira o PNG e confirme o salvamento.

O arquivo e o título preparado da página seguem `[SKU da variante]-[frente em mm]mm.png`.
Exemplo: produto `GE-AC-003`, cor `C2`, Frente Total `113 mm` → `GE-AC-003-C2-113mm.png`.
A medida vem do cadastro; `000mm` é apenas o marcador do arquivo modelo. Medidas menores que 100 têm três posições (095mm); decimais são preservados.
O resultado tem 540 × 540 px e transparência. Margens vazias são normalizadas para a largura do PNG corresponder à largura física da armação na prova.

A edição visual acontece dentro do Canva. O portal não aciona automaticamente “Pede pro Canva”.
Uma mudança de foto original é sinalizada para revisão no editor. Alterar SKU ou medida também pode exigir atualizar o título da página no Canva; o nome exportado pelo portal vem do cadastro atualizado.

## Imagem modelo recebida
Em 23/09/2026, o modelo foi substituído pelo PNG aprovado de 540 × 540 px e registrado na tabela privada `canva_tryon_template`.
O arquivo tem canal alpha, fundo e interior das lentes transparentes (73.443 bytes; SHA-256 `a51dc37e3243e7422a3d1ae27a299c822350eadb2dde5b5f3913b9fa346fe3a2`) e está liberado para criar páginas.
O upload aceita apenas PNG de 540 × 540 px, até 1 MB. O conteúdo não está publicado no repositório; somente o master pode consultar/substituir pelo servidor.

## APIs e limites atuais
A preparação usa um ODP com uma página nomeada e duas imagens independentes. O arquivo é enviado em bytes à API `/imports`; não é hospedado publicamente.
A primeira importação vira o design principal. Para cores adicionais, `/merges` insere a página do design auxiliar no design do produto. Esses designs auxiliares de importação permanecem na conta Canva.

As APIs [Merge](https://www.canva.dev/docs/apps/rest-apis/reference/merges/create-design-merge-job/) e [Get design pages](https://www.canva.dev/docs/apps/rest-apis/reference/designs/get-design-pages/) estão em **preview**. A documentação informa que apps públicos que usam APIs preview não passam pela revisão para distribuição geral. Confirmar disponibilidade na integração/conta usada no piloto antes de ativar. Cada merge usa uma única operação.
A preservação do título da página e a dimensão importada precisam ser conferidas no teste real do Canva. O portal exige uma página 540 × 540 com ID estável para vinculá-la; em recuperação, **Vincular página existente** exige design e número da página.

O ID da página, e não sua posição, identifica a cor. Antes de exportar, o portal resolve sua posição atual. Alterações na ordem durante uma exportação interrompem a importação para evitar salvar outra cor.
O canto reservado à referência precisa estar vazio antes de importar. A conferência humana verifica se o modelo foi substituído pelo produto real e se as lentes estão transparentes; isso não é garantido apenas pela análise do PNG.

## Ativação
Crie a integração no [Canva Developers](https://www.canva.com/developers/), habilitando REST/Connect APIs e verificando acesso às APIs preview.
Permissões configuradas: `asset:read`, `asset:write`, `design:content:read`, `design:content:write`, `design:meta:read`, `profile:read`.

- OAuth redirect: `https://optotica-portal.vercel.app/api/admin/catalog/canva/oauth/callback`
- Return navigation: `https://optotica-portal.vercel.app/api/admin/catalog/canva/return`

Variáveis servidor:
- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`
- `CANVA_TOKEN_ENCRYPTION_KEY` — 32 bytes aleatórios em hexadecimal (64 caracteres).
- `CANVA_APP_ORIGIN=https://optotica-portal.vercel.app`

A conexão Canva deste chat não fornece as credenciais da integração do portal. Não coloque segredos em variáveis `NEXT_PUBLIC_*`, código ou mensagens.
Preview e produção precisam de URLs registradas e origem correspondentes. PNG transparente exige `export_png_transparency` na conta Canva.

Migrações aplicadas ao Supabase `optotica-dev` em 23/09/2026:
- `20260923193213_canva_tryon.sql`
- `20260923210832_canva_product_pages.sql`

Se outro ambiente usar outro banco, aplique ambas antes de ativar as variáveis.

## Proteções e verificação
- Somente master; origem verificada nas mutações. OAuth PKCE e state de uso único.
- Tokens AES-256-GCM no servidor; refresh serializado; retorno RS256 validado por conta/equipe/design.
- RLS ativo, grants revogados de anon/authenticated. O [aviso informativo RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) é esperado para essas tabelas exclusivas do serviço.
- Bloqueio por produto, operações assíncronas persistidas, recuperação sem repetir criação de resultado desconhecido.
- Índice único impede vincular a mesma página a duas cores.
- Salvamento compara original, foto anterior, data, medida, SKU e variante em transação.
- Originais/arquivos anteriores preservados; nenhuma ativação/publicação automática da cor.
- Sessões expiram em 24h; estados OAuth em 10min. Prévias não confirmadas permanecem no bucket.

Em 23/09/2026: TypeScript, build de produção e **17 testes automatizados** passaram. O ODP foi aberto/renderizado pelo LibreOffice, confirmando página quadrada e posicionamento de duas imagens independentes.
Permissões do banco e fidelidade do arquivo modelo foram conferidas. Testes SQL de conflito por SKU/variante e salvamento passaram em transação revertida.

```sh
npx next typegen
npm run typecheck
node --test tests/canva-tryon.test.mjs
npm run build
```

Ainda falta o teste real após cadastrar credenciais e enviar o modelo transparente: duas cores no mesmo design; nomes e tamanho das páginas; reabertura sem duplicar; remoção da referência; exportação da cor correta; conferência na prova profissional/paciente.
