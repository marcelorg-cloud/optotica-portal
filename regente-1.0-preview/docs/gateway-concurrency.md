# Ensaio de concorrência real do Gateway

Base auditada: PR #41, commit `36564294224f76b0705e9967acfacd104ef9b6e1`.
Este ensaio não usa PGlite. Cada concorrente roda em um processo Node separado,
com uma conexão independente a PostgreSQL 17.6. Uma barreira mantém a missão
bloqueada até `pg_stat_activity` confirmar todos os concorrentes esperando
locks; o relatório registra PIDs distintos e o máximo simultaneamente bloqueado.

## Reprodução

Use um servidor/cluster **descartável**, sem outros projetos. Exemplo Docker:

```sh
docker run --rm --name regente-concurrency-pg \
  -e POSTGRES_PASSWORD=synthetic_test_only \
  -p 127.0.0.1:55432:5432 postgres:17.6
```

Em outro terminal, após o servidor estar pronto:

```sh
npm ci --prefix regente-1.0-preview --ignore-scripts --no-audit --no-fund
REGENTE_PG_ISOLATED=1 \
REGENTE_PG_ADMIN_URL=postgresql://postgres:synthetic_test_only@127.0.0.1:55432/postgres \
REGENTE_PG_REPORT=corrected-concurrency.json \
node regente-1.0-preview/tests/gateway-concurrency.cjs
```

O runner só aceita `/postgres` em loopback, sem parâmetros adicionais, cria
um banco aleatório `regente_gateway_concurrency_*` e o remove ao terminar.
Cria os roles de teste `anon`/`authenticated` se ausentes; não altera roles
existentes. A confirmação `REGENTE_PG_ISOLATED=1` é obrigatória: loopback por
si só não prova isolamento. Nunca encaminhe uma conexão real para essa porta.
Interromper o processo à força pode deixar o banco descartável; remover o
container elimina todo o cluster. Nenhuma URL Supabase ou chave real é usada.

Para reproduzir o kernel anterior, acrescente `REGENTE_TEST_BASELINE=1`.
Essa opção omite somente a migração de correção de concorrência. O workflow
exige que o baseline falhe precisamente nos dois casos descritos abaixo e
que todos os cenários passem com a correção. Falha de preparação, erro de
conexão ou falha adicional não é aceita como reprodução válida.

## Cobertura

- 24 reservas de R$ 0,75 sobre teto de R$ 5: seis admissões, 18 recusas;
  saldo reservado R$ 4,50 e nenhuma atualização acima do teto.
- 16 pedidos com a mesma chave: uma reserva, um evento e 15 recibos reutilizados.
- Grant de uma chamada com chaves diferentes: uma admissão; grant explícito
  de três chamadas admite exatamente três. `maxCalls>1` autoriza múltiplas
  execuções distintas, sem permitir repetir o mesmo evento.
- Colisão de chave entre projetos: o perdedor não consome orçamento ou grant.
- 16 tentativas de arm/completion/cancel: uma transição vencedora; conclusão
  compromete o teto uma vez; cancelamento só libera trabalho não despachado.
- Gateway JavaScript real sobre RPC real, concorrente: efeito em fornecedor
  sintético registrado uma vez. `fetch` é bloqueado; o fornecedor é local.
- Timeout e morte de worker após o efeito: reserva persiste, replay não
  reexecuta, novo pedido não recupera um slot consumido.
- Desconexão antes do commit e falha injetada na inserção do evento:
  orçamento, contador do grant e evento sofrem rollback integral.
- Texto e instrumentos concorrem no mesmo ledger; settlement textual
  concorrente não perde atualização nem contabiliza duas vezes.
- Arm contra cancelamento, revogação de grant, parada de emergência e expiração
  durante espera por lock; escopo entre projetos e escrita direta continuam negados.

Ao final de cada cenário, o runner compara o ledger com a soma de eventos
e reservas textuais e verifica não negatividade, teto e ausência de efeitos
sintéticos duplicados. Observações transacionais registram cada atualização
de orçamento; restrições PostgreSQL também permanecem ativas.

## Correção proposta

O kernel anterior consulta emergência antes dos locks e usa `now()` para
vigência; `now()` permanece no início da transação. Uma espera permite que
a parada seja ativada ou o grant expire antes de arm, sem impedir o dispatch.
A migração aditiva `20261013110852_regente10_gateway_concurrency.sql` revalida
chave, Master ativo, projeto e emergência **depois** dos locks financeiros,
com locks compartilhados até o commit; expiração e frescor usam
`clock_timestamp()`. A ordem missão/orçamento/grant/vínculo permanece.

Nenhuma reserva, teto, configuração, projeto ou dado existente é modificado
pela migração. A função auxiliar é privada, invoker, com EXECUTE revogado.
O invoker público e o kernel privado S00 conservam seu modelo de privilégios.
O ensaio aplica a correção apenas no banco descartável; implantação em
produção é uma etapa separada.

## Evidências e limites

Os 112 testes Node e o teste de migrações/rollback PGlite passaram localmente
após a correção. A execução PostgreSQL real é feita pelo workflow
`Regente Gateway real PostgreSQL concurrency`; seus logs e relatórios são
a evidência do baseline e da correção. Não presumir sucesso antes de consultar
o job do commit correspondente.

A fixture de autenticação simula `auth.uid()` por claims SQL; não é um teste
de assinatura JWT, login Master, PostgREST, pooler ou OAuth. O schema de
pré-requisitos usa fixtures e constraints do repositório; a tabela e a RPC
quantitativa textual foram capturadas em consulta **somente de metadados**
ao banco, em 13/10/2026. As RPCs monetárias e as migrações do Gateway são as
do código versionado. Não foram copiados registros reais ou credenciais.

O teste prova exclusão de dispatch no Gateway para os casos executados,
com fornecedor sintético; não prova exatamente uma execução interna no
Composio/serviço. Uma resposta perdida após arm ou uma morte de worker
pode deixar reserva em `dispatched`/`uncertain`, exigindo reconciliação
humana sem retry/refund automático. Uma revogação posterior ao commit de
arm não desfaz uma chamada já admitida. Não foram testados failover do
cluster, perda de WAL/disco, serializable, grande volume prolongado,
latência real de pooler nem recuperação de indisponibilidade de PostgREST.
O teto é de admissão conservadora, não uma garantia da fatura externa;
tarifa/câmbio incorretos continuam sendo riscos independentes.

Antes de ampliar: revisar/aplicar a migração pelo fluxo habitual, repetir
o ensaio para o commit liberado e validar sessão Master e a primeira execução
limitada com tarifa total conhecida. Nenhuma ferramenta externa paga foi
executada como parte do ensaio.
