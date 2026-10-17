# Regente 1.0 — decisões funcionais para o protótipo

**Estado:** arquitetura funcional aprovada pelo Maestro para a criação de um protótipo HTML independente; **não é autorização de deploy ou de execução real.**  
**Referência:** conversa de revisão do Regente em outubro de 2026 e parecer consultivo A6 `regente-1.0-avaliacao-e-arquitetura-consolidada.md` fornecido pelo responsável.  
**Nota:** a documentação anterior, os gates técnicos, segurança/LGPD, tetos monetários e implementação operacional permanecem em revisão.

## Aprovação das decisões D1–D6

- **D1 — Instituição → Projetos → Missões.** `Projeto` passa a ser a terminologia visível, mantendo compatibilidade técnica com o ID legado de `Obra` quando necessário. `Frente` pode representar subprojetos. O projeto institucional Regente/Born Robot é separado de Optótica e ENSAVIM; a Orquestra pertence ao Instituto e é compartilhada entre projetos com isolamento de contextos.
- **D2 — Três classes de permissão.** Classe 1 permite autorizações antecipadas dentro do envelope; classe 2 representa regras condicionadas a evidências verificadas por S00; classe 3 requer decisão sobre objeto final, incluindo publicações vinculadas à versão exata conforme CE15. Alterações materiais invalidam a aprovação específica.
- **D3 — Autorizações condicionais antecipadas.** O Maestro pode aprovar no início a regra de operações de classe 2, como merge condicionado. Produção exige verificação de segurança, testes, reversibilidade, ambiente e escopo; não pressupor autorização incondicional.
- **D4 — Exceções durante execução.** Base de exceções: conflito legal/privacidade; condição crítica não cumprida; teto atingido; efeito externo incerto; ambiguidade material; necessidade de permissão fora do envelope. Riscos críticos imprevistos também podem provocar retenção automática por S00. Fora disso, agrupar pedidos e manter independentes ativos.
- **D5 — Terminologia.** `Fases` pertencem à missão: Afinamento, Execução, Resultados. `Etapas` pertencem ao desenvolvimento do Regente. `Afinação` é a verificação da prontidão dos instrumentos dentro do Afinamento, e `Verificação de prontidão` é recurso contínuo da Administração.
- **D6 — Voz.** Ditado por voz é uma entrada opcional de texto. A transcrição será apresentada para revisão antes do envio e não concede autorização nem executa ação. O protótipo pode usar o reconhecimento do navegador com aviso claro, sem guardar áudio por padrão.

## Quatro refinamentos ratificados na mesma decisão

1. **Oito responsabilidades em todo Afinamento (C01–C08).** A auditoria C08 examina o primeiro artefato verificável, o Prompt Afinado; não exige necessariamente oito chamadas generativas distintas. Priorizar reutilização segura e avaliações determinísticas proporcionais ao risco.
2. **Resultados disponíveis durante Execução.** A Fase 3 é um espaço de trabalho e revisão alimentado desde o primeiro entregável, mesmo quando outras tarefas continuam; estados por entregável independem do encerramento da missão.
3. **Decisões excepcionais em lugar adequado.** Publicação é aprovada sobre a versão final em Resultados; ampliações de orçamento/permissões e outras exceções podem precisar de decisão antecipada fora de Resultados, centralizadas na Caixa de Decisões, sem travar tarefas independentes.
4. **Administração da Orquestra com proposta autônoma e aprovação reservada.** Agentes podem analisar e propor instalação, substituição, configuração e ajustes, mas não podem autoampliar suas permissões. Inclusão ≠ habilitação; laço funcional ≠ autorização. Restrições urgentes têm efeito imediato; ampliações somente segundo decisão autenticada e registrada.

## Modelo funcional para prototipação

- Estrutura: **Instituto → Projetos → Missões**; uma conversa persistente por missão.
- **Fase 1 Afinamento:** receber orientação por texto/voz; trabalhar com os papéis C01–C08; gerar **Prompt Afinado**, representação legível de uma **Partitura da Missão estruturada, versionada e identificável**; mapa de entregáveis, dependências e autorizações previstas; edição e refinamento por chat ou formulário.
- **Fase 2 Execução:** aprovar previamente envelope das classes 1 e 2, com condições verificáveis; executar paralelismo sem inventar efeitos; permitir pausa, retomada e parada de emergência; conservar estados, evidências, prazos e custos; isolar falhas.
- **Fase 3 Resultados:** central por entregável, com arquivo/preview, evidência, versão, tipo, aceite, ajuste, refazer, desdobrar e publicação classe 3 por pacote final; Concluir e Encerrar sem concluir aplicam-se à missão inteira.
- **Administração:** inventário, instalação, vínculos de implementação, editor visual de nós e laços, limites, prontidão, versões GitHub, créditos, consumo e delegações. Papel e implementação são entidades distintas.
- **Fonte canônica da documentação:** GitHub para Constituição, Grade, contratos e partituras, mediante PRs/revisão. Dados operacionais, segredos, tetos e autorizações pertencem ao runtime protegido de S00; a Google Planilhas é superfície de consulta/revisão e não produz autorização por si só.
- **Prototipação sem backend:** utilizar somente dados fictícios; nenhuma permissão, publicação, gasto, alteração de banco ou repositório deve ocorrer a partir do HTML demonstrativo.

## Gates que continuam pendentes

Política de dados pessoais e clínicos (CE14/RT-07); identidade do Maestro diferente do papel técnico Master; tetos e medição de consumo; estados, locks, idempotência e reconciliação persistentes em S00; provas de readiness por operação/ambiente; testes E2E de segurança e implantação; decisão de ativação independente de cada instrumento. A aprovação funcional presente não reclassifica esses itens como implementados ou testados.
