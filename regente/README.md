# Regente Optótica — v0.7.0

Orquestrador supervisionado Optótica + ENSAVIM em produção via GitHub → Vercel.

## Capacidades

- missões e conversas persistentes, estado canônico atualizado sem cache;
- uma fase por autorização, com relatório e validação humana antes da próxima;
- refazer com orientação e revisão versionada, sem apagar outputs anteriores;
- locks de execução, sessão cifrada, Workflow durável e retomada auditável;
- monitor minimizado/normal/expandido, bloqueios visíveis e ações concretas;
- download completo e histórico dos checkpoints, runs e versões substituídas;
- afinamento básico local gratuito e profundo solicitado, apenas com leituras;
- guardiões especialistas externos com constituição e snapshot de código do deployment.

## Arquitetura existente, sem credenciais inventadas

A1/A2/A3 e A4 usam OpenAI API; A4 é revisão separada, não outro provedor.
A5 é preflight local determinístico Supabase, não um worker generativo.
A6 usa parecer Claude manual por pacote/importação, sem presumir Anthropic API.
DeepSeek está deliberadamente reservado para a 0.8.

F6 chama o bridge autenticado do Portal em `https://app.optotica.com.br`.
Client ID, Client Secret e OAuth Canva ficam exclusivamente no Portal. Reconectar
no Portal atualiza a conexão usada pelo Regente. Um link Canva depende das
permissões da conta e não equivale a um arquivo exportado permanente.

## Configuração do projeto Regente

```bash
OPENAI_API_KEY=...
REGENT_WORKFLOW_SECRET=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
REGENT_MODEL=gpt-5.6-sol
REGENT_WORKER_MODEL=gpt-5.6-sol
REGENT_RECOVERY_MODEL=gpt-5.6-sol
REGENT_REVIEW_MODEL=gpt-5.6-sol
REGENT_PORTAL_ORIGIN=https://app.optotica.com.br
```

Use os nomes realmente consumidos por cada adapter. Não publique valores de
chaves nem os envie no chat. `REGENT_WORKFLOW_SECRET` cifra a sessão temporária e
autentica chamadas internas; nunca substitui Auth, Master ou RLS.
Consulte `.env.example` e o registry para os nomes completos existentes.

## Recuperação segura

Configuração/adapter/escopo/faturamento ausentes bloqueiam imediatamente com ação
humana, sem três diagnósticos pagos idênticos. Erros transitórios em operações
seguras têm tentativas delimitadas. Criação Canva com efeito desconhecido não
é repetida. Um diagnóstico especialista não aplica patches nem autoriza uma fase.

Missões antigas mantêm IDs, outputs e versão original. A 0.7 não presume que
resultados antigos foram validados nem que um nó indisponível foi executado.

## Verificação e operação

`npm test`, `npm run typecheck`, `npm run build`.
`/api/version` informa versão e commit do servidor, sem credenciais.
O operador deve comparar com a versão do cliente e revisar o checkpoint antes
de continuar. APIs de missões, outputs, afinamento e guardiões exigem Master ativo.

Veja [arquitetura e limites](docs/v0.7-architecture.md) e
[guardiões especialistas](docs/guardian-v0.7.md).
