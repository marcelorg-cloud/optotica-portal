# Regente 1.0 — Backlog documental, segregação e telas propostas

**Estado:** plano de trabalho proposto após aprovação das decisões DM1–DM10. **Não implementado** no runtime, Grade canônica ou banco.  
**Fontes:** parecer de conexões/escopo Google, parecer institucional e autorização por operação, decisões funcionais D1–D6 e Grade v0.6 em revisão.  
**Princípios:** sem merge, deploy, credenciais, OAuth, gastos, acesso a mensagens/documentos ou produção nesta etapa.

## 1. Trilha T-1 a T-9 (encaminhamento Claude)

| Tarefa | Status nesta branch documental | Critério de aceite / próximo passo |
| --- | --- | --- |
| **T-1** Orientações do Maestro | **Preparado:** decisões DM1–DM10 aprovadas em arquivo próprio | Revisão de consistência com D1–D6 e quatro refinamentos; ratificação na Grade por PR posterior |
| **T-2** Grade 1.0 com RT-15–RT-20, F15 e escopo | **Minuta preparada** no modelo institucional, sem editar Grade vigente | Incorporar regras, categorias e inventário somente após revisão; F15 proposto |
| **T-3** Partituras, Rotas, C04/C05 e 29 + F15 | **Matriz-modelo preparada**; alterações individuais pendentes | Propor patches nas partituras, conferir 169 relações e resolver assimetrias; sem renumerar |
| **T-4** Contas por alias e escopo | **Preparado:** G-OPT, G-PES e contêineres de exemplo sem IDs reais | Provar conta/contêiner/escopo no runtime protegido, sem expor identificadores no GitHub |
| **T-5** Verificação conectores Google | **Parcial, somente leitura:** Gmail e Drive retornaram perfis com **a mesma identidade de conta** nesta sessão; Docs/Planilhas usam operações do hub Drive. Alias institucional versus pessoal **não atribuído** sem comprovação adicional | Relatar somente em conversa; não ler mensagens/documentos, não publicar endereço nem ID; não escrever resultados por acesso administrativo no S00 |
| **T-6** Backlog piloto (sem executar) | **Preparado** na seção 2 | Cada item com dono, risco, gate e teste; apenas proposto |
| **T-7** Protótipo do Mapa de Conexões e Recursos | **Especificação textual preparada** na seção 3, sem HTML em execução | Exibir listado ≠ conectado ≠ habilitado; recursos por projeto/conta e inelegibilidade por motivo |
| **T-8** Ensaios S00 | **Preparado:** I-01–I-21 e T1–T13 em arquivo próprio | Rodar com fixtures em infraestrutura isolada, gerar evidências |
| **T-9** Relatório ao Maestro | **Após abertura deste PR em rascunho** | Informar arquivos, status, itens não feitos, riscos, decisões e próximo gate |

## 2. Backlog técnico priorizado (somente propostas)

| ID | Prioridade | Item | Dependências | Aceite / risco |
| --- | --- | --- | --- | --- |
| **B01** | P0 | DM6: criar **repositório Regente separado** e projeto Supabase S00 próprio | Inventário de referências e consumidores, backups, plano reversão | Nenhuma permissão de escrita Regente abrange código/dados Optótica; repositório antigo preservado |
| **B02** | P0 | Identidade autenticada **Maestro ≠ Master** e identidade de serviço Autorizador/Portão | Modelo de usuários, decisão sobre delegação | Agente nunca forja operador; serviço sem conta humana |
| **B03** | P0 | CE14 e política RT-07; bloqueio conteúdo Gmail F15 até aprovação | Revisão jurídica/privacidade, classificação e finalidade | Negar conteúdos pessoais/sensíveis fora da política; proibir envio até gate classe 3 |
| **B04** | P0 | Autorizador determinístico com E14a/E14b, RT-02/RT-13/RT-20 | Dados de projeto, participante, recurso, política, envelope | Avalia fonte indisponível como NEGAR; log versionado sem conteúdo sensível |
| **B05** | P0 | Portão de Execução único; cofre, lease, token único, idempotência e reconciliação | B01–B04; escopos mínimos do provedor | Adapter não opera sem token; efeitos incertos nunca duplicados |
| **B06** | P1 | Persistência de recursos, política herdada, proprietário (incl. Pessoa), histórico de mudanças | B01, B04; modelos `s00_recurso` etc em minuta | Restrição imediata; ampliação sem retroatividade; exclusão e classificação auditáveis |
| **B07** | P1 | Projetos dinâmicos e escopos A1–A6/F1–F15/S00 por dados, não ifs fixos | B06 e ratificação de escopos | Instituto–Governança separado de Born Robot; F15 proposto não habilitado |
| **B08** | P1 | Rotas redundantes e seletor determinístico; Mapas de Recursos/Conexões | B04–B07; Grade de laços `opera` consolidada | Uma rota por vínculo, idempotência por instância, destino efetivo e falha segura |
| **B09** | P1 | `route_id` nas verificações de prontidão; A5 por rota × recurso × operação × ambiente | B08, TTL das evidências | F1/F2/F3 não confundidos com leitura OAuth/escrita |
| **B10** | P1 | Fila hub endurecida: identidade distinta, lease, retorno restrito e conciliação | B05/B08; decisão DR6 | Proibir acesso administrativo direto para retorno e rejeitar pedido não despachado |
| **B11** | P1 | Contratos de capacidade compartilhada e débito por consumidor | B06/B08, DM5, orçamento monetário | ENSAVIM usa ponte Optótica só sob contrato versionado; saída sob titularidade do consumidor |
| **B12** | P1 | Família Google Workspace F12–F15 por alias, contêiner e operações | DR7–DR12, DM3/DM4, CE14 | G-OPT principal Optótica, contêiner ENSAVIM designado; G-PES não fallback de escrita |
| **B13** | P2 | Reclassificação e promoção à biblioteca com proveniência; índices segmentados | B06; decisão DM9 | C06 propõe, C08 audita, Maestro aprova; original não vaza |
| **B14** | P2 | Administração: projetos, recursos, compartilhamentos, contratos, concessões, rotas, seletor e simulação | B04–B13 | Cada mudança de privilégio passa por decisão, sem auto-habilitação do agente |
| **B15** | P2 | Migração cuidadosa/rollout gradual: leitura → escrita reversível → classes 2/3 | I-01–I-21, T1–T13, rollback | Gates comprovados em ambientes novos; logs, orçamento e monitoramento |
| **B16** | P2 | API de evidências e livro de uso com projetos consumidor/fornecedor, custo e rota | B05/B08/B11 | Auditoria rastreia efetivo planejado × utilizado |

**Bloqueios transversais:** dados clínicos, credenciais, política CE14, tetos monetários, verificação E2E, autenticação própria de provedores, e visibilidade pública do repositório.

### Sequência de segregação DM6 — planejamento, não execução

1. Levantar dependências GitHub, deploys Vercel, migrações Supabase e consumidores do Regente antigo e do 1.0.
2. Definir repositório novo Regente e projeto Supabase novo S00, identidade mínima e escopos por projeto.
3. Preparar migração com backups, contratos de compatibilidade, plano de corte e retorno.
4. Ensaiar leitura + autenticação Master/Maestro em ambientes de teste, nunca apontar preview a produção por padrão.
5. Rodar I-01–I-21, T1–T13, RLS adversarial e concorrência.
6. Avaliar mudança de rotas/usuários, aprovar execução e fasear implantação canária.
7. Nunca deletar banco/repositório antigo como parte do primeiro corte.

## 3. Proposta de telas — sem implementar nem fazer deploy

### 3.1. Administração da Orquestra: projetos

- Árvore Instituto → projetos → missões, com estados `proposto/ativo/suspenso/encerrado`.
- Born Robot (engenharia) separado de Instituto — Governança (Grade/Constituição).
- Recursos próprios, comuns e recebidos, orçamento e escopo por projeto.
- Criação e ativação por decisão; nenhum novo projeto herda operações só por ser listado.

### 3.2. Recursos, contas e compartilhamentos

- Árvore **conta → contêiner → item** por alias; proprietário Instituto/Projeto/Pessoa, custodiante, categoria, classe de dados, finalidade, herança restritiva, versão e histórico.
- Matrix `projeto × recurso × operação`, visualizando base: própria, institucional, compartilhamento, contrato ou concessão.
- Contêiner `G-OPT/ENSAVIM-APOIO` compartilhado; conta G-OPT raiz exclusiva; conta G-PES raiz fora de escopo, contêiner `G-PES/ORQUESTRA` institucional sob cessão específica.
- Alterações de escopo mostram consequência e exigem decisão; nenhuma chave ou ID real fica no GitHub.

### 3.3. Vínculos e rotas redundantes

- Para cada vínculo: agente, instrumento, recurso efetivo, operação, classe, teto, principal, contingências, domínios de falha e status `listado / instalado / verificado / habilitado`.
- Motivos de inelegibilidade E1–E14a/E14b; `sem_rota` bloqueia somente tarefa dependente.
- Simulador determinístico: mesmos atributos, mesma seleção/hash; troca por fallback simulada, sem chamada paga.

### 3.4. Fase 1 Afinamento — Mapa de Recursos + Mapa de Conexões

- Cabeçalho mostra origem do recurso, proprietário, categoria, classe, escopo do operador/instrumento, base E14b, versão/decisão, custo e finalidade.
- Por operação: principal, contingências ordenadas, evidência de A5 e validade, restrições, ensaios de troca e alertas `redundância ausente/aparente`.
- C04 define vínculos; C05 propõe caminhos; C01 verifica coerência, C07 ensaia, C08 audita; Maestro aprova o conjunto (classes 1/2) com envelope.
- Classe 3 continua reservada ao objeto final, com reconfirmação quando trocar rota ou versão.

### 3.5. Execução / Resultados / Decisões

- Execução: rota única por vínculo, decisão S00 por instância, custo consumidor/fornecedor, logs de reconciliação, pausa, emergência e contingência.
- Resultados: entregáveis pertencem ao projeto e à missão; compartilhar/promover exige autorização DM9; registrar proveniência.
- Caixa de Decisões: ampliação de privilégio, contrato, orçamento, mudança de destino efetivo e publicação final; nunca dar ao agente botão autoaprovar.

## 4. Riscos de implantação e critérios de bloqueio

- **Secreto/provedor**: GitHub conectado ao chat ≠ autorização no Regente; nunca transportar credenciais de plugin.
- **Repositório público**: só aliases/contratos; configurações efetivas/IDs reais apenas em S00 protegido.
- **Pasta Google**: Google OAuth frequentemente concede escopo maior do que uma pasta. Portão deve restringir operações ao recurso real **e** provedor deve aplicar escopo mínimo disponível; DM6 não substitui proteção de conta.
- **Gmail/WhatsApp/Resend**: serviço transacional não é fallback automático de caixa humana; consentimento, destinatário e versão final exigem controles próprios.
- **Banco compartilhado**: políticas RLS no `optotica-dev` não substituem isolamento administrativo do projeto Supabase quando um serviço possui permissão global.
- **Dependências da Grade**: laços recíprocos/assimétricos precisam de decisão antes de criar `opera`; relação textual não cria permissão.
- **Pós-PR**: somente após revisão do Maestro atualizar documentos canônicos ou começar alterações técnicas em PRs separados, de menor risco.

## 5. Relato T-9 (modelo a preencher após abrir o PR)

- Arquivos deste PR: decisões, arquitetura/S00, matriz e aliases F15, ensaios, backlog/telas.
- Feito: documentação **revisável**, sem efeito operacional.
- Não feito: merge, deploy, migrações, conexões, OAuth, leitura de e-mails/documentos, alterações em Grade oficial.
- Pendências: verificação de contas T-5, revisão da matriz/laços, CE14 e demais gates; implementação futura em PRs técnicos independentes.
