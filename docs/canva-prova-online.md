# Canva — foto de prova online por cor

## Fluxo implementado
1. No cadastro master, abra **Preparar no Canva** junto à Foto de Prova da cor.
2. Conecte a conta Canva uma vez. Cada usuário master autoriza sua própria conta.
3. A Optótica envia a foto original e cria um design 1080 × 1080 para essa cor.
4. Edite a primeira página no Canva: frente da armação, sem hastes, fundo e lentes transparentes.
5. Use **Retornar à Optótica**. O portal importa a primeira página em PNG transparente.
6. Confira a prévia e clique **Salvar como foto de prova desta cor**.
7. Próximas edições reabrem o mesmo design. **Importar do Canva** permite retomar sem o botão de retorno.

A edição visual é feita dentro do Canva. Este fluxo não aciona automaticamente "Pede pro Canva".
A largura física vem de **Frente Total (mm)** do produto; deve estar salva antes de abrir o editor.
A importação normaliza margens transparentes para a largura do PNG corresponder à armação na prova,
preserva as proporções e centraliza a frente em um PNG quadrado. Cor e geometria são conferidas na prévia.
Uma nova foto original não substitui o conteúdo do design existente: o portal avisa para revisar no Canva.

## Ativação
Crie uma integração no [Canva Developers](https://www.canva.com/developers/), habilitando REST/Connect APIs.
Para uso público fora do grupo de desenvolvimento, cumpra os requisitos de revisão/distribuição do Canva.
Configure estas permissões:
- asset:read
- asset:write
- design:content:read
- design:content:write
- design:meta:read
- profile:read

Para o domínio atual:
- Redirect URL (OAuth): https://optotica-portal.vercel.app/api/admin/catalog/canva/oauth/callback
- Return navigation / Return URL: https://optotica-portal.vercel.app/api/admin/catalog/canva/return

No ambiente servidor da aplicação, configure:
- CANVA_CLIENT_ID
- CANVA_CLIENT_SECRET
- CANVA_TOKEN_ENCRYPTION_KEY — 32 bytes aleatórios em hexadecimal (64 caracteres). Exemplo de geração local:
  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
- CANVA_APP_ORIGIN=https://optotica-portal.vercel.app

Não publique o client secret ou a chave de criptografia no código, em variáveis NEXT_PUBLIC_* ou em mensagens.
Preview e produção precisam de URLs OAuth/return registradas e CANVA_APP_ORIGIN correspondente.
A conexão Canva deste chat não substitui as credenciais da integração da Optótica.

Aplique o SQL do Canva no banco ligado a este ambiente antes de definir as variáveis acima.
Mantenha a chave de criptografia estável: mudá-la exige reconectar todas as contas.
Exportar PNG transparente exige a capacidade export_png_transparency na conta Canva.

## Proteções e recuperação
- Rotas exclusivas do master; mutações exigem a origem do portal.
- OAuth PKCE, state consumido uma vez e associado ao master.
- Tokens criptografados com AES-256-GCM, sem acesso do navegador ou dos papéis anon/authenticated.
- Refresh serializado para evitar reutilizar o refresh token rotativo.
- Retorno Canva exige assinatura RS256, audiência, expiração, usuário/equipe e design/cor corretos.
- Link persistente por cor, com bloqueio de criação concorrente.
- Criação interrompida depois de enviar a solicitação ao Canva: use **Vincular design existente** para
  recuperar o design da conta; não há repetição automática que possa criar cópias.
- Exportação assíncrona retomável, prévia armazenada antes da confirmação.
- PNG inválido, totalmente opaco ou vazio é rejeitado. A verificação automática de transparência não
  garante lentes vazadas ou remoção das hastes: a prévia serve para essa conferência.
- Ao salvar, banco compara original, foto anterior, data de processamento e largura física na mesma
  transação. Uma prévia antiga não pode sobrescrever uma alteração concorrente.
- Originais e arquivos anteriores são preservados. A importação não ativa/publica uma cor.
- Nesta primeira versão, conexões e designs pertencem ao master que os criou.
- Sessões de edição expiram em 24h; estados OAuth em 10min. Arquivos de prévia não confirmados
  permanecem no bucket do catálogo, assim como uploads manuais existentes.

## Verificação
A verificação automatizada cobre assinatura/expiração do retorno, isolamento dos tokens,
origem das mutações, vínculo da prévia à cor, normalização com transparência e conflitos ao salvar.
Execute:
  npx next typegen
  npm run typecheck
  node --test tests/canva-tryon.test.mjs

Teste real após ativar:
- Produto com duas cores e Frente Total salva.
- Criar e reabrir o design de uma cor (mesmo ID, sem duplicar).
- Retornar, conferir e salvar um PNG com lentes transparentes.
- A outra cor permanece com sua própria foto.
- Conferir a foto de prova no fluxo profissional/paciente.
- Cancelar OAuth, renovar conexão e tentar uma exportação sem transparência.
