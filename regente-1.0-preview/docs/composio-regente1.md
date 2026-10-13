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
- Em rejeição de credencial, um GET diagnóstico em toolkits?limit=1 registra
  apenas metadados filtrados de erro; não cria sessão ou conexão.
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
brutos do provedor não são registrados. Ausência da chave mantém a integração desabilitada; uma
chave presente que seja recusada impede a publicação dessa versão.

### Diagnóstico de credencial recusada (revisão de 12/10/2026)

O 401 em `auth_configs` com `x-api-key` ocorre na autenticação do projeto
Composio, antes de qualquer ferramenta. Pelo status, sozinho, não se distingue
chave inválida/revogada, chave de outro tipo (usuário `uak_`, consumidor `ck_`,
organização) ou caractere invisível no valor. Por isso o build registra agora:

- `input_checks` (só booleanos): além dos anteriores, `projectKeyPrefix`
  (chave de projeto `ak_`) e `internalNonTokenCharacters` (quebra de linha,
  espaço ou caractere invisível no meio do valor, que `trim()` não detecta).
- `providerError` em caso de falha: status, code/slug filtrados, request_id
  em snake_case, camelCase, raiz ou x-request-id, sem exigir prefixo req_.
  Valores contendo a chave ou fragmentos de oito caracteres são descartados.
  A classe da mensagem é um rótulo fixo; mensagem, sugestão e nomes arbitrários
  de propriedades não são registrados. O resumo só vai ao log de build.
- A sonda auxiliar usa GET /api/v3.1/toolkits?limit=1, documentado com
  Project ApiKeyAuth. A referência de getAuthSessionInfo v3 documenta
  UserApiKeyAuth, portanto não serve de controle equivalente para esta chave.
- projectKeyPrefix false é apenas um indicador de formato, não prova isolada
  de tipo de credencial. A classe invalid_or_revoked_key descreve a mensagem
  do provedor e não comprova como o valor chegou à Vercel.

A tela Tool Logs mostra execuções de ferramentas; o preflight não executa
ferramentas, então sua ausência ali não é evidência sobre a chave.

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

Referências adicionais do diagnóstico:
- https://docs.composio.dev/reference/v3/api-reference/authentication/getAuthSessionInfo
- https://docs.composio.dev/reference/api-reference/toolkits/getToolkits
