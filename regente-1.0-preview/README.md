# Regente 1.0 — piloto operacional independente

**Deploy de produção:** https://regente-1-0.vercel.app  
**Vercel projeto:** `regente-1-0` (isolado de `optotica-regente` e `optotica-portal`).

## Implementação real neste piloto

- Página `index.html`: login Supabase Auth (mesma conta Master do Regente antigo), navegação por projetos e missões.
- API Node `api/mission.js`: autentica usuário Supabase e confirma `system_admins.active` com JWT, sem `service_role`.
- Dados persistentes em `public.regente10_missions`, `regente10_outputs`, `regente10_ai_calls`, com RLS e restrição ao proprietário Master.
- Criação de missão persistente; Afinamento por IA opcional; autorizar **somente produção textual**; resultados textuais independentes (máximo 3), download, aceite e conclusão.
- Controle de chamadas por missão e por entregável para evitar duplicação de cobrança; incerteza não reexecutada automaticamente.
- `GET /api/mission?action=health` informa somente condições não sensíveis.

## Configuração necessária para ativar IA

O projeto Vercel **novo não herda** as variáveis de ambiente secretas do `optotica-regente`. Configure diretamente em **Vercel → regente-1-0 → Settings → Environment Variables**:

`OPENAI_API_KEY` = chave válida de API OpenAI, tipo Sensitive, alvo Production.

Depois faça **redeploy Production** para carregar a variável. O modelo configurado é `gpt-4.1-mini`, em `REGENTE10_MODEL`.

Nunca comitar, colar em chats ou compartilhar a chave.

## Limitações assumidas

- **Ainda não é a orquestra multiagente completa C01–C08.** O Afinamento usa uma única chamada real de IA orientada por checklist dos oito papéis; a Rede externa permanece indisponível.
- **Não executa** operações externas de GitHub, Vercel, Canva, bancos de produto, campanhas ou publicações.
- Só utilizar instruções sem dados pessoais, clínicos ou credenciais. A política CE14 e os filtros completos estão pendentes.
- O armazenamento usa tabelas segregadas dentro do projeto Supabase existente `optotica-dev`, não um projeto Supabase separado de produção.
- Não há scheduler/background workers, gestão integral da Orquestra ou administração de adapters nesta etapa.
- As missões do Regente v0.7 não são migradas.
- Não foram realizadas provas E2E de login e geração sob identidade Master real nesta sessão (nenhuma senha de usuário foi acessada); Vercel confirma deployment READY e artefato API presente.

## Segurança

Nenhuma chave privilegiada Supabase é usada. RLS por usuário + Master. Ações externas desativadas. Gastos de IA dependem de chave fornecida pelo usuário e de cliques explícitos; limitar quotas monetárias em S00 antes da ampliação a outros instrumentos.

## Desenvolvimento

Branch `feat/regente-1-0-standalone`, exclusivamente para este novo endereço. Arquivos `index.html`, `api/mission.js`, `vercel.json`.

O deploy Vercel atual é feito por API a partir de arquivos dessa branch. Não existe sincronização automática GitHub → Vercel para o novo projeto.
