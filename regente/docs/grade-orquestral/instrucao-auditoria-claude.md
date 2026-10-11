# Instrução para auditoria independente — Claude

**Papel:** revisor independente de arquitetura institucional, orquestração multiagente, governança, contratos e documentação técnica.  
**Data de referência:** 11/10/2026.  
**Escopo:** análise documental; não editar, mesclar PR, publicar ou alterar dados/credenciais sem nova autorização expressa.  
**Modo atual:** acesso direto ao Claude (site/app) e eventual acesso às fontes conectadas; **não assumir Claude API/Anthropic API integrada ao Regente**. Claude é o modelo da Anthropic, mas a integração programática ainda é uma etapa futura.

## 1. Contexto institucional e visão da Orquestra

O projeto do Goraieb Instituto da Visão investiga e utiliza pesquisa, educação, inovação, empreendedorismo e tecnologias para a área óptica e optométrica. As obras atuais incluem **Optótica** (plataforma tecnológica) e **ENSAVIM** (encontro multidisciplinar de saúde visual). Existe ainda um objetivo próprio de estudar/validar o modelo **Born Robot / Regente** como arquitetura de gerenciamento de agentes e ferramentas.

A Orquestra de IA é uma arquitetura cooperativa: um **Maestro humano** define propósito, valores, estratégia, critérios essenciais e decisões reservadas. A **Grade Orquestral** é a representação comum do conjunto, com Constituição, relações e resumo das contribuições. Cada agente, serviço ou ferramenta tem **partitura individual detalhada**, com missão, entradas, saídas, competências, autonomia, restrições, interação com pares, evidências, bloqueios e critérios de aceite.

**Camada de Orientação (coordenação):** oito papéis C01 Orientação de Coerência (ANTES das tarefas), C02 Regente (condução DURANTE), C03 Compositor (concepção), C04 Orquestrador (planejamento de dependências), C05 Spalla (afinação/prontidão), C06 Bibliotecário (contexto e fontes), C07 Ensaiador (testes), C08 Auditor de Harmonia (auditoria APÓS resultado verificável, inclusive parcial). Os momentos são relativos a cada tarefa e se sobrepõem entre tarefas distintas. A Camada de Orientação planeja, acompanha e avalia; ela não deve fingir ter executado efeitos externos.

**Camada da Rede (instrumentos executores):** A1 Engenharia Optótica, A2 Produto e Fluxos, A3 Conteúdo ENSAVIM, A4 Revisão Independente OpenAI, A5 Verificação Local de Prontidão, A6 Revisão Externa Claude; e F1 GitHub, F2 Vercel, F3 Supabase, F4 Replicate, F5 Canva Prova Online, F6 Canva Criativos, F7 HeyGen, F8 RapidAPI, F9 Meta/WhatsApp, F10 Resend, F11 Cloudflare, F12 Google Drive, F13 Google Docs, F14 Google Planilhas. **A5 é um serviço determinístico, não IA**. **A6 atualmente incorpora pareceres do Claude obtidos diretamente/manualmente; não existe adaptador Anthropic/Claude API confirmado no Regente.** Não inferir que a existência de uma ferramenta na Grade comprova conexão operacional.

**Núcleo de Sincronia S00:** infraestrutura determinística transversal (não modelo generativo), responsável por estados, versões, permissões, dependências, idempotência, concorrência, orçamento e trilha de auditoria. O Maestro não deve ser confundido com o agente Regente nem com o papel Master de autenticação do sistema.

Os objetivos incluem alta autonomia de engenharia dentro de gates de coerência, testes, segurança e permissões; **aprovação explícita do Maestro para publicações de campanhas e conteúdo público final**; conclusão de missões mediante evidências, com ações Concluir, Solicitar ajustes, Retomar e Desdobrar.

## 2. Acesso às fontes — ordem de leitura

**Repositório:** https://github.com/marcelorg-cloud/optotica-portal  
**Branch de trabalho:** `feat/regente-v08-cooperative-foundation`  
**PR em draft:** https://github.com/marcelorg-cloud/optotica-portal/pull/32

**Prioridade máxima — núcleo da auditoria:**
1. [Grade Orquestral original v0.6.0](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-partitura-geral.md) — arquivo legado, mas título interno atualizado.
2. [Caderno consolidado com as 29 partituras](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/grade-orquestral/caderno-partituras-snapshot-2026-10-11.md) — detalhes por instrumento, status e limites.
3. [Decisões constitucionais e estratégicas](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/grade-orquestral/decisoes-snapshot-2026-10-11.md) — preservar explicitamente o que está aprovado e distinguir propostas pendentes.
4. [Governança cooperativa](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-cooperative-governance.md).
5. [Constituição inicial](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-constitution-draft.md).

**Arquitetura e contexto adicionais:**
- [Arquitetura cooperativa](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-cooperative-architecture.md)
- [Protocolo de cooperação](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-cooperation-protocol.md)
- [Biblioteca e resolução](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-knowledge-and-resolution-library.md)
- [Sequência de implementação](https://github.com/marcelorg-cloud/optotica-portal/blob/feat/regente-v08-cooperative-foundation/regente/docs/v0.8-implementation-sequence.md)
- Código de apoio: `regente/lib/general-score.ts`, `regente/lib/cooperative-orchestra.ts`, `regente/lib/cooperative-coordinators.ts`, `regente/lib/cooperative-governance.ts`, `regente/lib/resolution-library.ts`, `regente/app/api/orchestra/cooperative/route.ts`; testes correspondentes em `regente/tests/`.

**Google Planilhas — visão de trabalho detalhada:** https://docs.google.com/spreadsheets/d/1tVwUUFUFkNTMov0XyLxaI8Pv94GEvSQKiJj4XAnps_E/edit

Consultar especialmente abas `Início`, `Constituição`, `Maestro — Marcelo Goraieb`, `Grade Orquestral`, `Relações`, `Compassos`, `Biblioteca`, `Revisão`, `Sincronização` e as 29 abas individuais (C01–C08, A1–A6 com A5, F1–F14, S00). Se a Planilha exigir conta/autorização e não estiver acessível, **usar os dois snapshots do GitHub e declarar a ausência de acesso direto**, sem afirmar que conferiu o arquivo em tempo real.

**Precedência para identificar conflitos:** distinguir Constituição efetivamente aprovada, decisões mais recentes, versão vigente de partitura aprovada, propostas de revisão e fatos técnicos observados. Não supor que todo texto mais novo foi ratificado. GitHub foi escolhido como futura fonte canônica, porém a sincronização GitHub ↔ Planilhas ↔ runtime ainda não está operante.

## 3. Objetivo central — afinar a Grade e as partituras

Audite prioritariamente os contratos individuais e a coerência sistêmica da Grade. Não se limite a correção ortográfica: verifique **se cada instrumento possui uma missão singular e suficiente**, interfaces funcionais, autonomia coerente, responsabilidade pelo resultado e evidência verificável.

Verifique:
1. Contradições, lacunas, duplicações, excesso de agentes e gargalos de execução; proponha simplificações sem perder funções.
2. Correspondência biunívoca entre o **resumo de cada instrumento na Grade** e a **partitura detalhada**; IDs e referências cruzadas sem inconsistência.
3. Herança de Constituição, regras transversais, decisões estratégicas e critérios de autoridade; Maestro humano e Regente IA separados.
4. Relações de ANTES/DURANTE/APÓS sem ciclos insolúveis, redundância de consultas ou decisões conflitantes; sincronia entre tarefas paralelas.
5. Distinção entre elaboração de proposta, aprovação, planejamento, execução efetiva, confirmação externa, ensaio, auditoria, aceite e conclusão.
6. Poderes de cada agente e ferramenta; escrita em GitHub, deploy em Vercel, banco Supabase, DNS Cloudflare, custos, anúncios/WhatsApp e publicação não podem ocorrer só porque um agente aconselhou.
7. Segurança por padrão para dados pessoais/clínicos, LGPD, segredos, RLS, consentimento, minimização, logs e retenção, identificando itens de política ainda pendentes.
8. Efeitos externos incertos, retries e idempotência; evidências de teste e monitoramento não devem ser fabricadas.
9. Modelo de custo: registro por instrumento/provedor, orçamento, saldo verificável, limites, alertas; cobrança automática ainda não autorizada.
10. Robustez e consistência de nomenclatura (C01 nome visível/ID legado; A5 não IA; A6 revisão Claude manual).
11. Qualidade documental: evitar conteúdo prolixo que obscureça contrato, sem eliminar detalhes valiosos; formato legível, tabelado e versionado.
12. Identificar requisitos obrigatórios para a **Fase 2 de redesenho da interface e processo de interação**: chat por missão, controles de execução, outputs e evidências, progresso real, solicitações ao Maestro, orçamento, concluir/retomar/desdobrar e histórico persistente.

## 4. Relatório solicitado

Entregue, em português do Brasil:

**A. Resumo executivo:** estado da documentação e recomendação para ratificação/etapa 2.  
**B. Matriz de achados:** prioridade P0/P1/P2/P3, seção, evidência, natureza da contradição/risco, correção sugerida, impacto nas outras partes.  
**C. Avaliação instrumento a instrumento:** para as 29 partituras, um registro com missão, competências, autonomia, sobreposição, lacuna e correção proposta.  
**D. Grade refinada:** proposta de resumo revisado para os instrumentos cuja partitura deva mudar, preservando vínculos e versão.  
**E. Patches textuais propostos:** trechos substitutos em Markdown; não editar repositório automaticamente.  
**F. Perguntas ao Maestro:** apenas questões realmente sensíveis, sem repetir definições expressamente aprovadas.  
**G. Critérios de passagem à Fase 2:** distinguir aprovação documental, implementação tecnológica e ativação em produção.

Importante: classificar cada constatação como **aprovado, proposto, implementado, testado ou não verificado**. Preservar rastreabilidade de arquivos e linhas. Não modificar a produção atual v0.7. Não acessar nem transmitir segredos ou informações identificáveis de pacientes. Se o GitHub for privado, solicitar permissão legítima ou arquivos, sem presumir acesso.
