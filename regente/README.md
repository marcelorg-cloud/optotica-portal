# Regente Optótica — v0.1

Assessor de orquestração da rede de agentes e ferramentas Optótica + ENSAVIM.

## Escopo desta versão

- OpenAI Agents SDK
- Constituição de Sanidade v0.1
- Registro dos nós atuais
- Planejamento estruturado de orquestração
- Interface web
- Modo **advisory only**: não executa ferramentas externas

## Princípio

O Regente pensa sobre a rede. Ele não deve fazer o trabalho que um agente especializado ou uma ferramenta mais barata consegue fazer.

## Variáveis

```bash
OPENAI_API_KEY=...
REGENT_MODEL=gpt-5.6-sol
REGENT_MODE=advisory
```

## Próximas fases

1. Persistência de decisões e métricas.
2. Custos e orçamento por execução.
3. Ferramentas de leitura (matriz, GitHub, Drive).
4. Aprovação humana.
5. Execução controlada.
6. Novos nós: financeiro, jurídico, comercial, atendimento e suporte.
