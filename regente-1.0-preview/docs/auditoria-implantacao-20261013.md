# Auditoria da implantação Regente 1.0 — 13/10/2026

A verificação começou em 12/10/2026 e foi atualizada em 13/10/2026 após interrupção da solicitação segura de autenticação. Não houve login Master real nesta auditoria.

## Release e origem

- URL: https://regente-1-0.vercel.app
- Projeto independente: `prj_oxATAuxVl278GgpJjb7v5sjacK7l`.
- Release ativa consultada: `dpl_3UfdemRzQcH7WAGkDWS8DCGnf3r5`, READY, production do projeto Regente.
- Commit identificado pela Vercel: `36564294224f76b0705e9967acfacd104ef9b6e1`, branch `feat/regente10-operational-gateway-20261013`.
- CI desse commit: [38349297356](https://github.com/marcelorg-cloud/optotica-portal/actions/runs/38349297356), concluído com sucesso.
- Os identificadores SHA-1 dos 36 arquivos de fonte da release foram comparados com os conteúdos obtidos do GitHub nesse commit: 26 idênticos, dez iguais após acréscimo exclusivo de uma quebra de linha final. Nenhuma divergência funcional de fonte foi encontrada.
- A branch já avançou a `7fa469dd9afb4d69096427df944e306d01869e86`, incluindo o PR #42. A release não identifica esse HEAD. O delta é documentação, dependências de teste, testes de concorrência e migração SQL; não modifica as funções JS da aplicação.
- A release anterior consultada em 12/10, `dpl_5seHTfmeRgVEnviyU1bupXzdCWUn`, tinha módulos fora da branch standalone e não apresentava SHA Git. Essa observação histórica não descreve mais a release atual.

## Evidência real, nesta auditoria

| Verificação | Resultado |
| --- | --- |
| Acesso anônimo ao painel | Redireciona a `/login?next=%2F`; navegador mostra somente login Master |
| `GET /api/mission?action=health` | HTTP 200; indica configuração de IA, não comprova chamada bem-sucedida ao provedor |
| Lista de missões / orientação / gateway sem credenciais | HTTP 401 |
| `POST /api/agents` sem credenciais | HTTP 500 com mensagem de autenticação; falha de classificação corrigida no PR desta auditoria |
| `/lib/master-session.js` e `/network-catalog.json` | HTTP 404; fonte e catálogo privados não são servidos estaticamente |
| `/api/mission.js` | Redireciona à função protegida e retorna 401, sem expor código |
| Banco real | 18 tabelas públicas regente10 e sete tabelas privadas do gateway com RLS habilitado |
| Papel anon | Sem SELECT/INSERT nas 25 tabelas verificadas |
| Schema privado `regente10_portao` | Sem SELECT direto de authenticated nas sete tabelas |
| RPC pública do gateway | SECURITY INVOKER; kernel privilegiado mantido no schema privado |
| Correção SQL de concorrência | `assert_dispatch_context` existe; kernel a invoca e usa `g.expires_at<=clock_timestamp()` |
| Registros agregados | Cinco missões, uma chamada IA confirmada, zero etapas C01/C03/C08, zero outputs, zero eventos de instrumento vinculados a grant |

As políticas de missão exigem proprietário e Master ativo. As políticas dos outputs e etapas exigem proprietário e vínculo à missão, cuja leitura também tem política Master. Foram consultados metadados e contagens; não foram lidos textos das missões, credenciais, perfis clínicos ou dados de pacientes.

Os registros existentes comprovam persistência de algumas missões e de uma chamada. Não comprovam a cadeia de orientação, geração, aceite nem retomada de uma missão inteira. Nenhuma missão real ou aprovação financeira foi criada artificialmente por SQL.

## Testes com dependências simuladas e ambientes descartáveis

- Reexecução local da versão publicada: 112/112 testes Node passaram.
- Correção desta auditoria: 115/115 testes Node passaram.
- Sintaxe: todos os arquivos JS/CJS de api/lib/scripts e oito scripts HTML inline passaram.
- PGlite local, com migrações do HEAD e rollback: PASS para autenticação de kernel, escopo de recurso, custo conhecido, teto, idempotência, dispatch único, reserva incerta e emergência.
- [CI 38388583782](https://github.com/marcelorg-cloud/optotica-portal/actions/runs/38388583782), job 115266387854: logs consultados confirmam PostgreSQL 17.6 descartável, 187 backends independentes e até 24 esperando locks. Baseline 18/20, com falhas esperadas de emergência e expiração; kernel corrigido 20/20. O fornecedor foi sintético e o contador de chamadas externas pagas foi zero.
- A existência da correção no banco real foi verificada por consulta de metadados. Os 20 cenários de concorrência não foram executados contra o Supabase compartilhado nesta auditoria.

Nomes de testes que dizem “real agent” significam execução do handler com fetch simulado. Não representam chamadas ao OpenAI, OAuth real ou operações reais no GitHub/Canva/Composio.

## Isolamento em relação à Optótica

A Optótica continua em outro projeto Vercel: `prj_bVvi5PlnkB4dcnyLcknlSb8OFI4E`. A consulta encontrou release `dpl_4gdSgYhrbd1Juo5Wi3JWR3KTwxdt`, READY, branch main, commit `bf076400b19a0ac026b34d5a27e7b1f64cb17c6c`. Seus aliases app.optotica.com.br e optotica-portal.vercel.app são distintos dos aliases do Regente.

O banco Supabase optotica-dev é compartilhado. O isolamento é lógico por tabelas, schema, proprietário e políticas; não é separação física de infraestrutura nem custódia DM6 completa. A auditoria não alterou módulos clínicos, aliases da Optótica, main ou usuários.

## Correção adicional proposta

A API agents agora usa a mesma verificação remota de Master ativo do painel. Ausência/invalidez de sessão retorna 401, identidade sem Master retorna 403 e indisponibilidade de autenticação retorna 503, sem transformar recusa em 500 nem revelar erros internos.

Depois de uma chamada textual, a API relê pausa, estado e autorização da missão antes de gravar o documento. Se houver pausa ou retirada da autorização, não aplica o output e conserva o registro da tentativa, sem repetir o provedor. Uma pausa não cancela uma chamada já iniciada nem reverte custo. Essa checagem não cria uma transação única entre controle e gravação; revogações simultâneas após a última leitura ainda exigem um contrato transacional futuro.

Três regressões adicionais verificam ausência de sessão sem qualquer fetch, não-Master sem chamada paga e pausa durante o provedor sem inserção do output. Os testes usam identidades e respostas sintéticas.

A correção está em branch própria, com destino na branch do Regente, sem merge automático em main. O domínio produtivo existente não é promovido por esta auditoria.

## Impedimentos e ensaio que falta

1. Login Master real: a solicitação segura foi interrompida; sem sessão válida não foi possível criar e executar o ensaio.
2. Ensaio textual não sensível: criar uma missão institucional fictícia, aprovar orçamento dentro de teto explícito, rodar C01/C03/C08, autorizar geração, gerar resultado, aceitar e concluir. Registrar IDs das etapas/resultados, fechar/reabrir após checkpoint e conferir ausência de repetição.
3. Retomada: código e testes comprovam leitura de checkpoints simulados, reserva idempotente e tratamento de resultados incertos; falta comprovação operacional no navegador autenticado.
4. Instrumentos externos: zero eventos de ferramenta vinculados a grant. OAuth/contas, recurso, ferramenta, argumentos, versão e tarifa total conhecida precisam ser confirmados pelo Master para a primeira operação delimitada.
5. Health não é prova de operação: databaseConfigured/aiConfigured são indicadores de configuração; não substituem probe autenticado do banco nem resposta do provedor.
6. Observabilidade: a consulta de runtime retornou um grupo de aviso DEP0169 (`url.parse`) nas rotas mission/panel/composio; não foi identificada origem na aplicação, que não usa essa API diretamente. Não constitui evidência de falha operacional nem de ausência de outras falhas.
7. DM6 física permanece pendente. O piloto continua inadequado para certificar isolamento físico ou processamento autorizado de dados sensíveis.

Esta auditoria não certifica o ciclo completo. Ela comprova release, correspondência de fonte, proteções anônimas, schema e políticas, além dos testes com os limites acima.
