# Regente Optótica — v0.6

Orquestrador supervisionado da rede de agentes e ferramentas Optótica + ENSAVIM.

## Capacidades atuais

- conversa persistente por sessão;
- Constituição de Sanidade;
- planejamento multicamadas;
- pipelines auditáveis com estado persistente por etapa;
- execução durável em segundo plano via Vercel Workflow, independente da janela do navegador;
- dependências explícitas entre etapas e tarefas;
- progresso, etapa atual e próxima ação operacional;
- checkpoints retomáveis sem repetir etapas concluídas;
- níveis de autonomia 0–4, mantendo o padrão supervisionado;
- histórico de tentativas, erros e resultados por etapa;
- gate humano antes de ações externas;
- execução real de A1/A2/A3 via OpenAI Agents SDK;
- bridge real com Canva (F6);
- adapter Claude/A4 quando `ANTHROPIC_API_KEY` estiver configurada;
- A5 Recovery Engineer para falhas de programação, acesso, payload, timeout e adapters.

## Estado operacional

Cada tarefa mantém `current_step`, `progress_percent`, `next_action`, bloqueio e último erro. Cada etapa é persistida separadamente com status, dependências, tentativas, artefato e timestamps. A execução reaproveita tool-runs já confirmados e bloqueia etapas cujas dependências ainda não foram satisfeitas. Ao ser aprovada, a tarefa é entregue a um Workflow durável: fechar a aba, bloquear o celular ou perder a conexão do cliente não cancela o processamento.

## Recovery automático

Quando uma etapa falha:

1. a pipeline pausa a etapa;
2. A5 analisa o erro com raciocínio alto e trechos reais do código;
3. A5 tenta uma correção operacional segura;
4. se o mesmo erro reaparecer, A4/Claude faz revisão independente quando disponível;
5. A5 consolida uma segunda correção e tenta novamente;
6. se a falha persistir, a pipeline é pausada e escalada ao humano com diagnóstico e eventual patch sugerido.

O recovery nunca remove autenticação, RLS, aprovação humana ou controles de custo para contornar um erro.

## Variáveis principais

```bash
OPENAI_API_KEY=...
REGENT_MODEL=gpt-5.6-sol
REGENT_WORKER_MODEL=gpt-5.6-sol
REGENT_RECOVERY_MODEL=gpt-5.6-sol
ANTHROPIC_API_KEY=...
REGENT_CLAUDE_MODEL=claude-sonnet-4-5
REGENT_MODE=supervised_pipeline
```

## Princípio

O Regente decide quanto pensar, quais nós combinar, quando pedir validação e quando parar. Ele só afirma que uma ação externa foi concluída depois de receber confirmação real do adapter responsável.


## Execução durável v0.6

A rota de execução usada pelo navegador não executa mais o pipeline inteiro. Ela:

1. valida o usuário Master e a aprovação humana;
2. cifra a sessão necessária para a execução;
3. inicia um Vercel Workflow e retorna `202 Accepted` com um `runId`;
4. o Workflow renova a sessão em um step persistente;
5. o worker executa o pipeline usando os checkpoints existentes no Supabase;
6. em retry ou retomada, tool-runs já confirmados não são repetidos;
7. a interface apenas consulta o estado e pode ser fechada sem cancelar a tarefa.

`REGENT_WORKFLOW_SECRET` é usado somente no servidor para cifrar a sessão temporária e autenticar a chamada interna do Workflow. Ele não substitui a autenticação Master, não desativa RLS e não concede service-role.
