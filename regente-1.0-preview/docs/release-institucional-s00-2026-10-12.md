# Regente 1.0 — Release institucional e controle de escopo

**Data:** 12/10/2026  
**Estado:** liberação operacional **limitada**. **Não atesta Orquestra integral**, Autorizador/Portão produtivo ou integrações externas de escrita.  
**Produção:** projeto Vercel isolado `regente-1-0`, https://regente-1-0.vercel.app  
**PR da implementação:** #38, branch `feat/regente10-s00-resource-gates-20261012`, aberto em draft.  
**PR das decisões:** #37, documentação DM1–DM10, também draft.

## Funcionalidades adicionadas

- Catálogo `regente10_projects`: `optotica`, `ensavim`, `born-robot`, `instituto-governanca`; criação de missões exige projeto `active` consultado do banco.
- Matriz `regente10_participants`: 30 participantes C01–C08, A1–A6, F1–F15, S00. O backend A1–A6 aplica a interseção E14a dos escopos antes de rodar.
- Catálogo de recursos por **alias**: propriedade Instituto/Projeto/Pessoa, categoria de compartilhamento, classe de dados, contêiner pai, projeto compartilhado, estado e versão.
- Catálogo de rotas por operação: endpoint de leitura/proposta, recurso efetivo, domínios de falha, custo conhecido, estado, escopo. Todas têm `write_enabled=false` imposto por CHECK no banco.
- Relações da Grade: 169 arestas direcionadas importadas como `status='proposed'` e `relation_kind='unclassified'`. **Relação proposta não é permissão, conexão ativa nem dependência obrigatória.** A contagem de pares sem relação inversa pode variar da auditoria de assimetrias anterior porque os critérios diferem.
- `/governance.html`: projetos, recursos, relações, mapa de conexões e simulação de autorização.
- `/api/governance`: autenticação Master, leitura do catálogo, armazenamento **somente draft** de mapa por missão e log de simulações **não vinculantes**.
- `lib/s00-policy.js`: regras determinísticas E14a, E14b, classe de dados, categoria, projeto ativo, rota, orçamento conhecido e envelope. Não emite tokens e não tem credenciais de terceiros.
- F15 Gmail consta como **proposto** em `network-catalog.json` e na Grade da nova base. Nenhum conteúdo é lido, nenhum e-mail enviado.

## Evidência técnica concluída

1. Migrações aditivas foram aplicadas às tabelas `regente10_*` do Supabase existente; **nenhuma tabela Optótica foi alterada**.
2. RLS de catálogos, mapas, simulações e relações foi verificado: Master ativo enxerga os registros; identidade autenticada sem autorização enxerga zero linhas nos catálogos.
3. Teste de INSERT do mapa como Master ativo executado em transação **ROLLBACK**, sem persistir mapa de teste.
4. GitHub Actions executou `node --check`, testes de contrato da rede, guardas de emergência, testes de política e simulação com mocks. O teste não substitui E2E real.
5. Vercel confirmou os deployments de preview e produção como `READY` e a presença da função `governance` no artefato.
6. Nenhuma credencial OAuth/API de GitHub, Vercel, Canva, Meta ou Google foi transportada a partir do ChatGPT.

## Restrições ativas e blockers

- **DM6** exige repositório próprio Regente e Supabase separado, antes de escrita autônoma. As tabelas atuais continuam no mesmo projeto Supabase da Optótica; o branch é do mesmo repo GitHub. A Vercel já é projeto separado.
- Supabase `create_project` exige organização escolhida pelo Maestro e confirmação de custo; GitHub criar repositório não está disponível na integração conectada. Não foram iniciadas operações que possam afetar faturamento ou produção antiga.
- **CE14** pendente: sem dados pessoais/clinícos. Compartilhamentos `G-OPT/ENSAVIM-APOIO`, `G-PES/ORQUESTRA`, contrato `CC-OPT-01` permanecem `proposed`, sem ACL real/decisão de operação.
- Identidade Maestro distinta do papel técnico Master ainda não está comprovada; criar decisão classe 3 exige etapa posterior.
- Orçamento **monetário** e livro de uso por projeto ainda não estão implementados. O teto antigo de 12 reservas de IA por Master é quantitativo, não financeiro.
- Portão de Execução com segredo exclusivo, lease, token de uso único e autenticação de adapters ainda não está concluído.
- Pontes via ChatGPT permanecem assistidas e sujeitas a operador restrito (DR6); automação de escrita administrativa da fila foi desativada.
- F1–F3 limitados a leitura/health; F4–F15 sem escrita. Claude A6 permanece manual.
- 21 casos I-01..I-21 e 13 ensaios T1..T13 definidos na documentação, porém **não executados integralmente** em infraestrutura separada.

## Passos necessários para autonomia produtiva

1. Maestro seleciona organização Supabase, confirma custo, e estabelece repositório/região isolados DM6.
2. Migrar autenticação e estado S00 com backup/rollback; manter legado e Optótica operacionais.
3. Implementar autorização assinada por instância e gateway com credenciais sob identidade de serviço restrita.
4. Ratificar CE14, limites monetários e operadores autorizados; conferir conta e escopo reais por provedor sem expor segredos.
5. Ensaiar canário somente leitura, depois escrita reversível, depois classe 2/3 com versão/hash e reconfirmação.
6. Executar todos os ensaios I e T, rever cenários negativos, confirmar E2E com usuário Master/Maestro.

**Nenhum gatilho de produção, merge, conta ou credencial é habilitado apenas por este documento.**
