# Guardiões especializados do Regente 0.7

Os guardiões têm instruções versionadas próprias para sanidade, programação,
afinação de conexões e recovery. Eles recebem objetivo, pipeline, checkpoints,
outputs preservados, histórico, último afinamento e manifesto de fontes. São
revisores separados da execução produtiva, não publicam alterações por conta
própria e não concedem aprovação humana.

| Papel | Transporte implementado | Limite |
| --- | --- | --- |
| Guardião OpenAI | OpenAI Agents SDK, contexto independente A4/recovery | Configuração não comprova saldo nem operação; revisão requer chamada real registrada. |
| Guardião Claude | Pacote versionado + revisão na conta interativa + importação humana | Origem Claude é declarada pelo operador; nenhuma API Anthropic é presumida ou obrigatória. |
| DeepSeek | Fora da rede ativa 0.7 | Integração reservada para 0.8. |

## Pacote de conhecimento e evidências

`GET /api/orchestra/guardians?provider=claude&taskId=UUID&download=1`
baixa JSON autenticado da missão. `provider=openai` gera o mesmo contexto
especializado para um revisor OpenAI externo. `source=0` omite a recuperação de
código. GET não altera tarefas, não registra aprovação e não chama um modelo.

As fontes de código são de uma lista fechada de arquivos existentes. O bundle
versionado embarcado no deployment é preferido e seus hashes são verificados,
inclusive para repositórios privados. O commit do deployment
(`VERCEL_GIT_COMMIT_SHA`, ou `REGENT_SOURCE_COMMIT` explicitamente fornecido)
identifica a origem. Arquivos que não estão no bundle só são buscados no commit
exato; nunca em `main/latest`. Sem commit, o bundle disponível fica marcado
como não versionado, sem declaração de snapshot completo. Arquivos ausentes
ou truncados são identificados individualmente. Ter um manifesto não é ter
revisado todo o repositório. Nenhum `.env`, cookie ou credencial integra o pacote.

## Importação de parecer externo

Na conta Claude interativa, envie o pacote e peça um parecer pelo contrato nele
incluído. Depois use o controle de importação no Regente. O endpoint aceita:

```json
{
  "provider": "claude",
  "taskId": "UUID da missão",
  "review": "Parecer com evidências, correção mínima, testes, riscos e limitações.",
  "acknowledgeManualSource": true
}
```

Opcionalmente informe `packetId`, `sourceCommit`, `step` e `revision` do pacote.
São referências declaradas, não uma autenticação da conta/modelo externo. Uma
revisão de commit ou revisão de etapa antiga permanece identificada como tal.
Quando uma fase usa A6, somente o parecer Claude da mesma etapa e revisão é
consumido como output humano externo; parecer de outra revisão não destrava a
fase. Isso não comprova identidade/API Claude nem substitui a validação humana.
O registro tem `source=human_supplied`, `providerIdentityVerified=false` e
`grantsApproval=false`. O operador ainda precisa validar, continuar ou refazer
a fase no endpoint de decisão. Sugestões nunca são executadas como código.

## Afinamento

`GET /api/orchestra/health` apenas consulta o último relatório persistido.
`POST` com `{"depth":"basic"}` inventaria configuração e faz leituras com a
sessão autenticada. `{"depth":"deep"}` adiciona metadados de runtime,
leases expiradas, lista de modelos OpenAI e identidade Canva no Portal. Um
`taskId` restringe as evidências à missão e define os nós requeridos por ela.

O profundo é manual e tem limite de frequência. Não gera texto, não cria nem
exporta designs, não renova OAuth e não publica anúncios. O probe Canva é
somente uma leitura `GET /users/me` usando token ainda válido. Token expirado
é reportado sem fingir que o refresh token foi testado. Usuário e equipe são
comparados com a conexão preservada; plano Pro e permissões de criação não
podem ser inferidos da identidade. Faturamento, saldo e bloqueios de pagamento
permanecem não verificáveis.

Nós sem adapter automático são explicitamente arquiteturais/indisponíveis.
Eles só bloqueiam se a missão os exigir. A rota Claude externa e os demais
atores opcionais não impedem a pipeline OpenAI. Configuração no Portal ou
plugin do chat não comprova disponibilidade no runtime Regente.
