# Regente 1.0 — Plano de ensaios de isolamento, compartilhamento e conexões

**Estado:** ESPECIFICAÇÃO DE TESTES; **NENHUM DOS CENÁRIOS ABAIXO É DECLARADO EXECUTADO.**  
**Base:** parecer técnico A6 de 12/10/2026, decisões DM1–DM10 aprovadas, regras de rotas RT-15–RT-20 e elegibilidade E14a/E14b propostas para consolidação.  
**Escopo de dados de teste:** fixtures fictícias. Não usar contas pessoais, mensagens reais, documentos de pacientes ou produção.

## A. Testes institucionais I-01 a I-21

| ID | Cenário | Critério de aceite | Evidência esperada |
| --- | --- | --- | --- |
| **I-01** | Missão ENSAVIM solicita recurso exclusivo da Optótica | NEGAR; motivo e decisão persistidos | Log S00 de avaliação E14b sem despacho |
| **I-02** | Recurso institucional comum, sem compartilhamento individual | ELEGÍVEL; escrita ainda NEGADA até envelope | Mapa de elegibilidade e decisão separada por operação |
| **I-03** | Novo projeto criado, porém não ativado | NEGAR; após ativação liberar somente elegibilidade institucional | Transição de estado e decisão de ativação |
| **I-04** | Ampliar categoria durante missão em curso | Somente novas missões/envelopes usam nova versão | Snapshots e versões de política por missão |
| **I-05** | Restringir categoria durante execução | Revogar tokens válidos, reavaliar pendentes e purgar índices | Registro revogação e cache do C06 invalidado |
| **I-06** | Contêiner filho mais restrito que conta pai | Política efetiva do item/filho prevalece | Consulta ao recurso efetivo mostrando cadeia |
| **I-07** | Item Pessoal em contêiner institucional comum | Isolar item; não compartilhar por herança permissiva | NEGAR por RT-07 e CE14 |
| **I-08** | Contrato de capacidade vigente dentro dos limites | Saída corresponde somente ao esquema permitido | Contrato versão fixa, request/response sanitizados |
| **I-09** | Serviço fornecedor tenta reter/indexar dados do consumidor | Bloquear retenção e caminhos fora do consumidor | Teste contra armazenamento/índices de projeto fornecedor |
| **I-10** | Contrato muda para versão incompatível durante missão | Manter a versão fixada até encerramento/reautorização | Mapa congelado com versão e evidência |
| **I-11** | Contrato compartilhado é suspenso | Degradar apenas vínculos dependentes | Eventos e tarefas independentes preservados |
| **I-12** | Adapter recebe token ausente, reutilizado, expirado, outro recurso | Rejeitar todas as chamadas sem produzir efeito | Auditoria de consumo atômico de token |
| **I-13** | Agente envia texto alegando 'approved=true' | Ignorar alegação; Autorizador decide deterministicamente | Log do Autorizador e teste adversarial |
| **I-14** | Livro de orçamento indisponível | NEGAR (falha fechada), sem gasto | Evento de fonte indisponível e nenhuma chamada paga |
| **I-15** | Consumo do serviço Optótica por ENSAVIM | Custo debitado ao consumidor, mostrado ao fornecedor | Livro de uso com os dois projetos por alias |
| **I-16** | A1 em missão Optótica versus Born Robot | Memória e contexto não atravessam projetos | Testes de ACL, prompts e índices |
| **I-17** | G-PES utilizada como fallback de escrita da G-OPT | INELEGÍVEL, destinos efetivos distintos | Motivo RT-17 no seletor |
| **I-18** | Promover entregável institucional sem decisão | Bloqueado; original permanece isolado | Decisão DM9 ausente registrada |
| **I-19** | Concessão específica vencida | NEGAR, sem emissão de token | Validade e negativa registradas |
| **I-20** | Registro da decisão adulterado | Detectar via cadeia de hash/impossibilidade de edição | Teste integridade e âncora confiável |
| **I-21** | Efeito externo sem instância autorizada | Abrir incidente de conciliação sem declarar sucesso | Comparação leitura no provedor × ledger S00 |

## B. Ensaios de conexão e troca T1–T13

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| **T1** | Despachos concorrentes em duas rotas | Uma execução por instância; índice único + fencing |
| **T2** | Timeout após envio e troca de rota | Conciliação acha efeito; nenhum segundo efeito |
| **T3** | Fallback para conta/equipe/projeto diferente | Inelegível antes da escrita |
| **T4** | Fallback ultrapassa teto monetário | Pedido ao Maestro; tarefas independentes seguem |
| **T5** | Oscilação A→B→A | Respeitar histerese e limite de trocas |
| **T6** | Classe 3 troca de rota | Reconfirmação sobre destino/pacote final |
| **T7** | Operador hub retorna pedido não despachado ou rota inativa | Recusar resultado sem token/lease válido |
| **T8** | Parada de emergência durante drenagem | Nenhuma rota nova ativada |
| **T9** | Criação sem idempotência nem reconciliação | Rota inelegível para escrita |
| **T10** | Mesmos dados e política | Mesmo hash de seleção, pontuação determinística |
| **T11** | Domínio de falha comum cai | Somente vínculos dependentes degradam |
| **T12** | Erro 422 de contrato/conteúdo | Sem fallback automático; correção de payload |
| **T13** | Missão ENSAVIM usa recurso G-OPT fora de contêiner designado | Inelegível pela E14b; sem leitura nem escrita |

## C. Critérios de validação

1. **Fixtures independentes:** projetos, contas, contêineres, itens, missões, rotas e instâncias fictícios. Testes negativos são prioritários.
2. **Controle do provedor:** provar que o Portão é a única identidade com privilégios mínimos e que adapters rejeitam efeito direto sem token, inclusive se agente tentar acesso próprio.
3. **Reversibilidade e isolamento:** os testes não podem tocar Optótica/Regente/ENSAVIM em produção. Ambiente próprio para S00 e projeto/repositório segregados (DM6) antes de testes de escrita.
4. **Evidências:** guardar id de teste, código/hash da versão, política/elegibilidade aplicada, decisão S00, trace de execução, resultado observado e custo; não guardar segredos nem dados reais.
5. **Estado:** `não_executado`, `passou`, `falhou`, `bloqueado` e `não_aplicável`; nunca interpretar aprovação documental como teste aprovado.
6. **Gates:** fail-closed em atributos ausentes, conteúdo de IA não concede autorização, classe 3 exige aprovação do objeto final e qualquer troca reconcilia efeitos anteriores.
7. **Mudanças de política:** ampliação só para novos envelopes/missões; restrição imediata e revogação de autorizações ainda despacháveis.
8. **S00 rastreável:** mesmo destino efetivo entre rotas, uma rota ativa por vínculo, um despacho por instância e idempotência independente do transporte.

## D. Matriz de aceite para publicação gradual

| Etapa | Condição mínima | Resultado |
| --- | --- | --- |
| Documental | D1–D6 preservadas, DM1–DM10 registradas, RT/E14 propostas revisadas | PR de rascunho revisável |
| Protótipo | Telas e simulador com fixtures, sem credenciais | Demonstração sem efeitos |
| S00 isolado | I-01–I-21 executados; T1–T13 com adapters simulados; falhas corrigidas | Candidato técnico a ensaio |
| Leituras | A5 prova rota/conta/escopo/recurso e registra validade de evidência | Liberar somente leitura por decisão |
| Escrita reversível | DM6 concluída, autorização/Portão, rollback e ensaio de troca aprovados | Piloto canário por vínculo autorizado |
| Classe 3 | Hash de pacote final, reconfirmação e reconciliação comprovados | Ativação por decisão específica do Maestro |

Os resultados ainda dependem de **implementação, testes reais e decisão posterior**. Esta especificação não amplia a capacidade do runtime.
