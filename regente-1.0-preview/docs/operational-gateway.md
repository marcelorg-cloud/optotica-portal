# Gateway operacional Regente 1.0

O centro `/gateway` exige Master ativo. A bridge principal é Composio Platform
v3.1, utilizando a chave já aceita do projeto Regente1. O inventário anterior
em `/api/composio` mantém seu contrato somente de leitura.

## Custódia e isolamento

O modelo/agente recebe apenas `regente_execute_approved(project, grantId,
requestKey)`. O servidor mantém COMPOSIO_API_KEY e REGENTE_GATEWAY_KEY;
não há service_role. A identidade Composio é derivada do proprietário e do
projeto. Contas PRIVATE só são reutilizadas quando a identidade e toolkit
correspondem exatamente; contas de outro projeto não são importadas.
Connect Links têm cifra AES-256-GCM com projeto, vínculo e tentativa no AAD.
O callback consulta a tentativa persistida e verifica o provedor; parâmetros
de retorno não concedem autorização.

Sessões de autenticação permitem um toolkit e zero ferramentas, com Instant,
workbench, proxy, busca e gestão de conexões por agentes desabilitados.
Executar um instrumento usa a rota determinística REST, com versão explícita
(a rota session/execute não documenta esse parâmetro), conta e argumentos
persistidos no envelope. Nenhum prompt em linguagem natural vira execução. Argumentos precisam de um identificador explícito de destino; operações genéricas de conta inteira ou raízes me/root/default/primary são bloqueadas. O Master deve confirmar que o destino pertence ao projeto.

## S00 e finanças

O núcleo está no esquema privado `regente10_portao`, com RLS e privilégios
diretos revogados. A ausência de políticas de leitura nessas sete tabelas é
intencional: nenhuma tem acesso direto de anon/authenticated. O banco também bloqueia destinos genéricos, argumentos de credencial e rotas de privilégio elevado, inclusive para snapshots anteriores do deploy. O RPC público
é SECURITY INVOKER; o núcleo privado valida a chave interna, Master ativo,
projeto, emergência e propriedade. Cap, recurso e grant exigem também JWT
Master real. O worker técnico não pode aprová-los.

Cada recurso de execução nasce da confirmação explícita do Master de destino,
finalidade, classificação pública/interna e argumentos exatos. O vínculo
privado registra ferramenta, versão, projeto e hash dos argumentos; recursos
antigos de status não autorizam ferramentas arbitrárias. Dados pessoais,
sensíveis, secretos ou ancestrais restritos continuam fora desta liberação.

A reserva usa o mesmo regente10_mission_budgets da missão, com locks na ordem
missão, orçamento, grant, vínculo e evento. O teto é compartilhado com texto.
A chamada só sai após claim e arm, revalidando política do recurso, revisão,
vigência e emergência. Teto em BRL e tarifa verificada são obrigatórios; preço
desconhecido não é tratado como zero. Valores aceitam até quatro decimais.
Sucesso com log_id compromete o teto conservador da chamada, não uma fatura.
Timeout/falha depois de dispatch mantém reserva; não há retry ou reembolso
automático. Mesmo requestKey retorna recibo e não repete o fornecedor.

## Operação

Bootstrap real em produção: 35 vínculos para 17 serviços; 15 toolkits encontrados,
25 links de consentimento, oito vínculos aguardando credencial do serviço.
Bling e Facebook Ads não tiveram correspondência nativa no catálogo consultado.
São 2.911 registros por projeto, correspondentes a 1.145 ferramentas distintas.
Nenhuma execução de instrumento foi registrada; conta ativa não é alegada.

O build prepara os 35 vínculos planejados em quatro projetos e descobre o
catálogo real, sem adivinhar slugs ou conectar contas com outra identidade.
OAuth termina no Connect Link escolhido pelo Master. Serviços sem OAuth
gerenciado mostram guia, dashboard e user_id do projeto para configuração
manual; Sincronizar reutiliza apenas uma conta ACTIVE com identidade exata.
Múltiplas contas com a mesma identidade exigem resolução explícita no Composio.
Ferramentas são descobertas por toolkit e busca; truncamento é informado.
O diário do painel consulta dados internos a cada 20 segundos enquanto aberto.
Não há agendador de ferramentas pagas ou concessão global de privilégios.

`POST /api/agents` aceita `action=execute_instrument`, missionId, node,
grantId e requestKey. Valida participante ativo, projeto e missão do grant,
depois usa o mesmo Gateway. O agente recebe apenas recibo/estado/log_id; o payload do fornecedor permanece disponível ao Master, após filtragem. As gerações textuais existentes preservam seu
fluxo e orçamento; não recebem credenciais nem seletores de conta. Chaves, variáveis de ambiente, deploys, administração e código arbitrário estão fora desta liberação operativa e exigem revisão S00/DM6 própria.

## Validação e limites

### Prova de custos, sem contratação

A [tabela oficial](https://composio.dev/pricing), consultada em 13/10/2026,
declara sessões gratuitas. Após as franquias, OAuth gerenciado publica
USD 0,0005/chamada e execução fora de Session pode acrescentar USD 0,0001/chamada.
O plano efetivo, saldo de franquia, add-ons e custos do serviço não foram
verificados nem alterados. Portanto, esses valores não são uma tarifa total
garantida. O envelope exige uma fonte verificada e teto total em BRL; não
presume gratuidade. Instant, proxy e sandbox foram desabilitados na sessão.

112 testes Node passaram. Os testes de banco executam as mesmas migrações
em PGlite/PostgreSQL com restrições extraídas do schema real e fixtures
sintéticas, tudo com rollback. Testam custo, escopo, reconexão, mudanças de
política, teto, idempotência, dispatch e reserva incerta. PGlite tem conexão
única: não comprova concorrência multi-processo. A atomicidade usa row locks
PostgreSQL e a restrição reserved+metered<=cap.

O [ensaio multiprocesso real](gateway-concurrency.md), implementado no
[PR #42](https://github.com/marcelorg-cloud/optotica-portal/pull/42), executou
20 cenários em PostgreSQL 17.6 descartável, com 187 backends independentes
e até 24 esperando locks simultaneamente. O código anterior reproduziu
duas falhas de autorização durante espera: parada de emergência e expiração.
A migração proposta revalida S00 após os locks e usa relógio corrente;
com ela, 20/20 cenários e 112/112 regressões Node passaram no
[CI 38388583782](https://github.com/marcelorg-cloud/optotica-portal/actions/runs/38388583782).
Teto, idempotência, dispatch único, rollback e reservas incertas foram
verificados com fornecedor sintético, sem ferramentas externas pagas.
A correção ainda precisa passar pelo fluxo de implantação; esse ensaio
não alterou produção e não comprova login/OAuth/PostgREST ou failover reais.

Tentativas de rodar fixtures com rollback no conector Supabase retornaram
Invalid or expired requestState. Nenhum fixture ou chave de teste foi aplicado
ao banco real. Migrações e metadados/RLS foram verificados por consultas reais;
o build valida o caminho real do worker com a chave sob custódia.

Advisors mantêm avisos anteriores fora desta implementação: 23 funções
SECURITY DEFINER executáveis por anon, duas funções com search_path mutável,
proteção de senhas comprometidas desabilitada e RLS sem policies em módulos
antigos. Não foram alterados módulos clínicos ou contas de outros projetos.
As quatro RPC financeiras do Regente têm autenticação/propriedade explícita;
nenhuma nova função definer foi exposta no schema público.

DM6 física continua planejada. Ampliação para dados sensíveis, contas pessoais
ou ferramentas de privilégio elevado requer aprovação de recurso e revisão
da separação física, sem herdar esta autorização técnica.

Fontes: [Sessões](https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession),
[Connect Link](https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSessionBySessionIdLink),
[Contas](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid),
[Execução com versão](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug),
[PGlite](https://pglite.dev/docs/).
