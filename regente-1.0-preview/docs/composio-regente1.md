# Composio — projeto Regente1

Primeira ligação do Regente 1.0 com o projeto Composio associado à chave
`COMPOSIO_API_KEY`. O nome Regente1 é um rótulo definido pelo operador;
a API de inventário não comprova o nome remoto do projeto.

## Disponível

- API GET `/api/composio?action=status`, apenas Master ativo via Supabase Auth.
- Consulta de configurações e contas privadas do projeto Composio (v3.1).
- Primeira página de até 100 itens por consulta, com aviso se houver mais.
- Resposta só contém IDs, toolkit, estado, método de autenticação e flags.
  Credenciais, campos state/data, usuário remoto, URLs e payloads de erro não
  são enviados ao navegador nem escritos em logs.
- Botão “Verificar Composio” em `/network.html`.
- Parada de emergência bloqueia o início da consulta ao provedor.
- Preflight de build consulta apenas auth_configs para validar a chave.
  Esse ensaio técnico de publicação não usa dados de missões e não passa pelo
  controle de emergência individual; não liga contas ou executa ferramentas.

## Escopo e gates

O inventário é administrativo do projeto Composio, não consulta de dados
de clientes ou de uma missão. `ACTIVE` não significa autorização operacional.
Não existem rotas de criação de OAuth, gestão de contas, criação de sessões,
proxy ou execução de ferramentas. Compartilhamentos não são consultados.
O ledger de IA textual não cobre gastos de instrumentos externos.

Vincular gradualmente apenas os instrumentos necessários: primeiro escolher
a missão, recurso, conta e operação; depois verificar escopos, preço e estado,
aprovar o vínculo no S00 e executar os ensaios correspondentes. A ligação
proposta não transfere conexões ou credenciais dos plugins ChatGPT.
DM6 segue adiada condicionalmente; S00 Portão externo segue desabilitado.

## Configuração e publicação

`COMPOSIO_API_KEY` deve ser Secret/Sensitive, server-only, no projeto Vercel
regente-1-0. Não usar prefixo público. Não salvar valor no repo ou no chat.
O build registra `COMPOSIO_PREFLIGHT credential_accepted` ou um código
seguro de falha, status HTTP e request_id validado quando disponível. Checagens
de formato registram apenas flags booleanas, nunca o valor da chave. Payloads
e mensagens do provedor não são registrados. Ausência da chave mantém a integração desabilitada; uma
chave presente que seja recusada impede a publicação dessa versão.

## Validação

Testes mock: anon, sessão expirada, não-Master, emergência, controle
indisponível, POST proibido, parâmetros de usuário/projeto/URL proibidos,
sanitização, chave recusada/ausente e resposta malformada.
Build testa a chave real sem revelar seu valor. Login e botão do painel
devem ser confirmados com sessão Master; não afirmar E2E só pelos mocks.

Fontes oficiais consultadas em 12/10/2026:
- https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs
- https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccounts
- https://docs.composio.dev/reference/api-reference/connected-accounts
- https://docs.composio.dev/reference/errors
- https://docs.composio.dev/docs/using-composio-skill
