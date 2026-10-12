# Regente 1.0 — Ratificação institucional DM1–DM10

**Data da decisão:** 12/10/2026.  
**Autoridade:** Maestro, decisão expressa no chat após apresentação das recomendações DM1–DM10.  
**Estado:** **APROVADO PELO MAESTRO** quanto às escolhas abaixo; **NÃO IMPLEMENTADO** como regras do runtime; incorporação à Grade/partituras ainda exige revisão do PR.  
**Base vigente:** [Decisões funcionais D1–D6 e quatro refinamentos](regente-1.0-decisoes-funcionais-2026-10-11.md), que **não são reabertos** por esta ratificação.  
**Parecer consultivo:** `regente-1.0-arquitetura-institucional-e-autorizacao.md` (Claude/A6 manual, apresentado pelo Maestro em 12/10/2026). Parecer não concede aprovação.  
**Perímetro:** documental. Nada neste arquivo autoriza merge, deploy, instalações, OAuth, novos gastos, migração, produção, leitura de e-mails ou emissão de mensagens.

## Decisões ratificadas

| ID | Decisão aprovada | Limites e dependências |
| --- | --- | --- |
| **DM1** | Quatro categorias de recursos: `institucional_comum`, `exclusivo`, `compartilhado`, `restrito`. `Delegado` é concessão específica; Pessoal/Sensível é **classe de dados independente** (RT-07), prevalecendo a regra mais restritiva. | Classe de dados e categoria não são sinônimos; privacidade/CE14 pendentes. |
| **DM2** | Projeto novo só adquire **elegibilidade** a recursos institucionais após ativação por decisão. | A operação continua **negada por padrão** fora do teto, envelope e condições. |
| **DM3** | Proprietário de recurso pode ser **Instituto, Projeto ou Pessoa**. A conta `G-PES` é do Maestro; somente o contêiner designado `Orquestra` pode ser cedido ao Instituto. | O restante da conta pessoal não integra o ecossistema; cessão técnica ainda precisa ser configurada/autorizada. |
| **DM4** | `G-OPT` é a conta institucional principal da Optótica e poderá atender recursos **designados** do ENSAVIM. **Permite-se em princípio** comunicação institucional ENSAVIM pelo domínio/conta G-OPT **somente após aprovação humana da versão final de cada envio**. | Gmail F15: até aprovação da CE14, **somente perfil e estado**; nada de ler conteúdo/enviar agora. Depois: envio classe 3, identidade de remetente correta, destinatários/finalidade/consentimento conferidos. Uma conta não substitui outra em escrita. |
| **DM5** | Custo de serviço compartilhado é debitado **por padrão ao projeto consumidor**, com visibilidade também ao fornecedor. | Subsídio pelo Instituto somente mediante decisão e orçamento registrados. Custo desconhecido impede operação paga. |
| **DM6** | Separar a infraestrutura do Regente onde o provedor não consegue isolar escrita por caminho: **repositório GitHub próprio** e **projeto Supabase próprio para S00**. | **Antes de habilitar escrita autônoma.** Preparar inventário, migração, plano de reversão e testes; nenhuma migração aprovada nesta etapa. Preservar Optótica e Regente antigo. |
| **DM7** | O S00 aplica autorizações com **Autorizador** determinístico + **Portão de Execução** como único detentor de credenciais; adapters validam código de uso único; provedores aplicam escopos mínimos. | Agentes não autorizam; política do Maestro; fail closed; hub ChatGPT conserva limites e risco residual. |
| **DM8** | A1 atende `Optótica` e `Born Robot`, com contextos, repositórios, memória e permissões separados por missão e projeto. | Sem leitura cruzada; não ampliar escrita enquanto DM6 pendente. |
| **DM9** | Promoção de resultados à biblioteca institucional depende de **aprovação do Maestro**, até haver delegação formal e registrada. | Original fica no projeto; versão promovida é derivada, com proveniência e auditoria. |
| **DM10** | Criar contexto reservado **`Instituto — Governança`** para Grade, Constituição e políticas, **separado** do projeto `Born Robot` (engenharia do Regente). | Criação/ativação e permissões devem ser executadas posteriormente, sob decisão, teste e gates. |

## Princípio ratificado anteriormente: compartilhamento institucional por padrão

A elegibilidade a recursos classificados como `institucional_comum` é concedida por padrão aos projetos **ativos e elegíveis**, desde que o recurso pertença ao Instituto, tenha classe de dados até `Interno` e não possua restrição específica. **Elegibilidade não é autorização de operação**. Todo despacho deve satisfazer identidade, missão, contexto, base de acesso, finalidade, classe de dados, envelope, rota, orçamento, decisão e controles de emergência.

Recursos de projeto e resultados são exclusivos por padrão; conteúdo pessoal, sensível, clínico e segredos permanecem isolados até política/decisão própria. Credenciais nunca são recursos compartilháveis.

## Distinções institucionais obrigatórias

1. **Instituto → Projeto → Missão**: três níveis de contexto (D1).
2. **Participante**: papel, serviço ou instrumento do catálogo; `F12` é instrumento Google Drive, não a conta.
3. **Recurso**: conta, contêiner, item ou serviço concreto; propriedade por Instituto/Projeto/Pessoa; o item herda a política restritiva do ancestral.
4. **Rota**: caminho técnico de operação para recurso e destino efetivo, com credencial referenciada em cofre protegido.
5. **Vínculo operacional**: missão × operador × instrumento/recurso × operação, com uma rota ativa e contingências aprovadas.
6. **Contrato de capacidade**: projeto fornecedor oferece serviço a projeto consumidor sem virar novo F; consumo é debitado ao consumidor (DM5).
7. **Decisão/concessão**: base humana registrada; `compartilhado` ou `institucional_comum` não gera autorização automática.
8. **Instância**: efeito único, com idempotência independente da rota, reconciliação e evidências.

## Google Workspace e F15

- Manter `F12` Drive, `F13` Docs, `F14` Planilhas; **incluir `F15` Gmail como instrumento documental proposto**, sem renumerar instrumentos existentes.
- `G-OPT`: conta de propriedade da Optótica; não franquear a conta inteira ao ENSAVIM. Compartilhar apenas contêineres/serviços designados, por compartilhamento explícito ou contrato versionado, e somente com operações autorizadas.
- `G-PES`: pertence à Pessoa (Maestro); somente o contêiner `Orquestra` cedido ao Instituto seria comum; nenhum outro conteúdo pessoal é elegível.
- `G-ENS`: conta separada não necessária no escopo inicial aprovado; pode permanecer como alternativa futura proposta, nunca presumida como habilitada.
- `Windsor` é possível rota de terceiro do `F9`, **não** novo participante da Grade.

## Pendências técnicas que a aprovação NÃO resolve

- CE14/RT-07 e dados pessoais/clínicos; identidade Maestro ≠ Master; limites financeiros; S00 persistente, Portão e identidades de serviço; E2E, teste de isolamento e reconciliação.
- Infraestrutura segregada DM6 ainda não criada/migrada.
- Permissões e credenciais de ferramentas, OAuth e bridges **não ativados**.
- Revisão e ratificação documental da Grade, das partituras e contratos após este PR.
- Versões de política de recursos: **ampliação apenas para novas missões/envelopes; restrição imediata** nas operações futuras e instâncias pendentes.

**Observação de segurança:** repositório público; somente aliases. Não inserir IDs efetivos de contas/equipes/pastas, endereços de e-mail, credenciais, tokens, documentos privados ou links temporários neste arquivo.
