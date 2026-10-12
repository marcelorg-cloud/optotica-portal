# Regente 1.0 — Operação textual e governança institucional

**Aplicação de produção:** https://regente-1-0.vercel.app  
**Governança:** https://regente-1-0.vercel.app/governance.html  
**Administração de ferramentas:** https://regente-1-0.vercel.app/network.html  
**Branch de release revisável:** `feat/regente10-s00-resource-gates-20261012`, PR #38, **draft**.
**Decisões DM1–DM10:** aprovadas pelo Maestro, formalização documental no PR #37 (**draft**).

## Estado real da versão publicada

| Capacidade | Situação |
| --- | --- |
| Login | Supabase Auth com exigência de Master ativo |
| Missões | Criação, leitura, Afinamento, aprovação para texto, execução textual, download, aceite e conclusão |
| Projetos | Catálogo em `regente10_projects`: Optótica, ENSAVIM, Born Robot e Instituto — Governança |
| Orientação | C01, C03 e C08 com chamadas de IA distintas, persistência por etapa; outros C com regras/apoio determinístico, **não oito modelos independentes** |
| Rede A1–A4 | Executor de documentos de texto, com escopo E14a e reserva transacional; A4 revisa saídas |
| A5 | Preflight local de banco/sessão |
| A6 | Parecer humano externo importado; origem Claude declarada, não certificada pela API |
| F1–F3 | Probes de leitura pública GitHub, health Vercel e consulta RLS Supabase (não concedem escrita) |
| F4–F15 | Catálogo de instrumentos; o fato de estar listado/hub disponível **não** comprova OAuth próprio nem adapter de escrita |
| S00 institucional | Cadastro de projetos, 30 participantes, recursos, rotas e controles; mapa por missão em **rascunho**; simulador determinístico com negação por padrão |
| S00 Portão de Execução | **NÃO IMPLEMENTADO**; não emite tokens, não fornece credenciais, não autoriza escrita externa |
| Parada de emergência | Master pode bloquear novas operações do Regente 1.0 (não cancela custos já efetuados) |
| Orçamento monetário | **PENDENTE**; piloto limita número de reservas de IA a 12 por Master, não equivale a teto monetário |
| Segregação DM6 | **PENDENTE**; tabelas próprias dentro do mesmo projeto Supabase da Optótica e branch no mesmo repositório GitHub |
| Segurança CE14 | **PENDENTE**; não usar dados de pacientes, e-mails, contatos ou outros dados pessoais/sensíveis |

As credenciais OpenAI devem permanecer na Vercel `OPENAI_API_KEY` Sensitive Production. Não adicionar segredos a código, documentos, prompts ou planilhas.

## Modelo institucional (DM1–DM10)

- Elegibilidade institucional comum por padrão **não** concede autorização de operação.
- Recursos específicos têm propriedade Instituto/Projeto/Pessoa; classificação e classe de dados distintas; filho mais aberto exige decisão comprovada. `G-OPT`, `G-PES`, contêiner ENSAVIM e Google Workspace aparecem **somente por alias**, com contas/compartilhamentos reais não configurados neste runtime.
- F15 Gmail está **proposto**, sem leitura de mensagens ou envio; CE14 e aprovação final (classe 3) permanecem obrigatórias.
- Instituto — Governança não é o projeto Born Robot, mesmo que ambos usem a Orquestra.
- O S00 definitivo terá Autorizador (PDP) e Portão de Execução (PEP), e o Portão guardará exclusivamente credenciais e código único de operação. Atualmente existe **simulador sem autoridade de execução**.
- Toda escrita autônoma requer DM6, identidade Maestro ≠ Master, CE14, tetos monetários, testes E2E e permissão do instrumento.
- Nenhuma conexão de plugin ChatGPT transfere credenciais para a Vercel. Pontes de hubs permanecem limitadas a consultas mediadas e filas; operador automático deve ter identidade restrita, ainda pendente DR6.
- Dados de missão e resultados permanecem do projeto e não entram automaticamente na biblioteca institucional.

## Testes

A workflow `regente-1-0-pilot.yml` verifica sintaxe de todos os endpoints, scripts de interface, segurança de importação de parecer, autenticação simulada, preflight, limite e rota de agentes, negação por escopo, emergência e módulo de governança em ambiente **mock**.

Testes unitários de política: `tests/s00-policy.test.cjs`; testes da rota `tests/governance.test.cjs`. Estes testes não substituem os ensaios previstos `I-01..I-21` e `T1..T13` com infraestrutura segregada.

**Limitação de validação:** o login Master e operações reais via browser autenticado não foram realizados pelo desenvolvedor nesta sessão; não afirmar E2E nem plena Orquestra operacional.

## Modelo de deploy

O projeto Vercel `regente-1-0` está separado dos projetos `optotica-portal` e `optotica-regente`. O deployment atual é feito por API com arquivos explicitamente selecionados desta branch, **não** por push GitHub automático. Nunca apontar o Regente antigo/Optótica para estes arquivos sem transição aprovada.

## Próximos gates para operação plena

1. **DM6:** repositório GitHub independente e projeto Supabase próprio para S00; dependências, backups, autenticação/migração e rollback.
2. Identidade de Maestro autenticado distinta do Master técnico e serviço de Portão com credencial de privilégio mínimo.
3. Política CE14 e classificação de dados por finalidade; comunicação por Gmail somente sob condições aprovadas.
4. Limites em moeda, cotas por projeto/instrumento e reserva financeira antes de cada operação externa.
5. Implementação do PDP/PEP S00 com tokens únicos, leases, auditoria imutável, idempotência e reconciliação.
6. OAuth/API dos instrumentos por projeto e recurso; testes de equivalência e troca antes de ativar bridges.
7. Execução e registro dos testes I-01..I-21 e T1..T13, E2E real, e aprovação de habilitação de escrita por instrumento.

**O painel operacional permanece disponível com efeitos restritos a conteúdo textual e suas próprias tabelas RLS.**
