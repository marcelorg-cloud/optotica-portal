# Regente 1.0 — Relatório de integração da Camada da Rede

**Data:** 12/10/2026. **Ambiente de implantação:** projeto Vercel independente `regente-1-0`.
**Release:** `dpl_GfjicPPQ5Xz6bP8CHki8HcgEM1Gc` confirmado READY. 
**Estado:** IMPLEMENTAÇÃO PARCIAL, NÃO significa que todos os nós estão conectados.

## Implementado e testado com rede simulada

- A1 Engenharia Optótica, A2 Produto Optótica e A3 Conteúdo ENSAVIM: rotas independentes do Regente 1.0 para gerar documentos por IA, vinculadas a uma missão autorizada, com reserva de orçamento e registro persistente.
- A4 Revisão Independente OpenAI: revisão de um ou mais documentos já registrados, sem aceitar nem publicar.
- A5 Verificação Local: preflight determinístico autenticado com evidência limitada ao runtime e banco próprios do 1.0.
- A6 Claude: importação manual de parecer com origem declarada, `providerIdentityVerified=false`. **Sem conexão à Anthropic API.**
- F1 GitHub: diagnóstico de leitura pública de repositório fixo por REST, sem credenciais de escrita.
- F2 Vercel: verificação de health público do projeto Regente 1.0, **não** acesso à Vercel Management API.
- F3 Supabase: leitura autenticada com RLS de dados de controle do Regente 1.0; não implica permissão de migração nem acesso clínico.
- F4–F14: catálogo documentado e consulta de estado. Para ferramentas sem adapter próprio, o estado é DESCONHECIDO e nenhuma operação externa é tentada.
- Operações externas com mutação (GitHub commit/merge, Vercel deploy automático via agente, dados produtivos, Canva, anúncios, WhatsApp, e-mail) estão DESATIVADAS.

## Dependências de ligação restantes

| Instrumento | Dependência real |
|---|---|
| F1 GitHub — escrita | GitHub App/OAuth específico da aplicação, escopos, instalação por repositório, PR/checks, envelopes |
| F2 Vercel — deploy | token/integração Vercel por projeto, mapeamento de ambiente, reversão e autorização condicional |
| F3 Supabase — alterações | separação entre banco da aplicação e S00, migrações sob gates, RLS testado |
| F4 Replicate / Portal | contrato de job, autenticação de bridge, verificação de quota e fidelidade |
| F5 Canva Prova Online | adapter de exportação/prova virtual próprio; não é a ponte F6 |
| F6 Canva Criativos | adaptar ponte OAuth existente na Optótica para a conta e o contexto 1.0 |
| F7 HeyGen | credencial/API e orçamento para renders |
| F8 RapidAPI | endpoint, chave, licença de catálogo e quota |
| F9 Meta/WhatsApp | separação Ads/WA, permissões de escrita, consentimento, aprovação sobre versão final |
| F10 Resend | domínio verificado, chave de serviço, anti-duplicação e finalidades |
| F11 Cloudflare | escopos mínimos para diagnóstico; DNS/WAF apenas por decisão reservada |
| F12–F14 Google | OAuth próprio do Regente, scopes por produto, biblioteca/partitura versionada |
| A6 Claude API | integração separada por credencial, orçamento, segurança de dados e validação |

**Credenciais conectadas ao ChatGPT não são automaticamente transportadas ao Regente.** É necessário OAuth, chave de serviço ou outro vínculo legítimo para cada runtime. Nenhuma chave deve ser colocada no repositório ou em mensagens.

## Segurança e limite

- O usuário precisa estar autenticado como Master; RLS nas tabelas `regente10_network_runs` e `regente10_adapter_checks`.
- Toda chamada generativa A1–A4 exige autorização textual registrada na missão e passa pelo RPC transacional `regente10_reserve_ai_call` (até 12 chamadas reservadas por Master neste piloto).
- Resultados de agentes são documentos textuais, **não** código aplicado, páginas publicadas ou conexão externa comprovada.
- Verificação F1/F2/F3 é de leitura e não concede escrita.
- Parada de emergência do Regente 1.0 impede novas chamadas reservadas.
- Não tratar informações pessoais/clínicas neste piloto até implementação da política CE14.
- Falta ensaio E2E autenticado com o Master real, sem o qual o estado do backend é **implementado + testado com mocks**, não "validado operacionalmente" para todos os fluxos.

## Evidências

- Branch `feat/regente-1-0-standalone`: `index.html`, `network.html`, `network-catalog.json`, `api/mission.js`, `api/orientation.js`, `api/network.js`, `api/agents.js`.
- GitHub Actions `regente-1-0-pilot.yml`: testes de sintaxe, segurança básica, roteamento simulado e funções de rede.
- Vercel deployment de produção READY, funções `mission`, `orientation`, `network`, `agents` verificadas na lista de arquivos.
- Regente antigo e Optótica permaneceram fora do alvo das alterações.

## Próxima ordem recomendada

S00 mínimo de autorização por operação/ambiente e orçamento monetário → vínculo de escrita GitHub F1 em branch exclusiva → Vercel F2 em preview isolado → ponte Canva e dados do Portal → demais provedores com OAuth e consentimento explícitos. Cada instrumento deve ser ativado isoladamente após teste E2E.
