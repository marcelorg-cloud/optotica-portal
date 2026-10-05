# Regente Optótica — v0.4

Orquestrador supervisionado da rede de agentes e ferramentas Optótica + ENSAVIM.

## Capacidades atuais

- conversa persistente por sessão;
- Constituição de Sanidade;
- planejamento multicamadas;
- pipelines auditáveis;
- gate humano antes de ações externas;
- execução real de A1/A2/A3 via OpenAI Agents SDK;
- bridge real com Canva (F6);
- adapter Claude/A4 quando `ANTHROPIC_API_KEY` estiver configurada;
- A5 Recovery Engineer para falhas de programação, acesso, payload, timeout e adapters.

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
