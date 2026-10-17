# Regente 1.0 — S00 piloto e Camada de Orientação independente

**Implantação:** `https://regente-1-0.vercel.app` (somente projeto Vercel separado).
**Fonte GitHub:** `feat/regente-1-0-standalone`.
**Estado:** primeira entrega operacional, não Orquestra integral.

## O que foi implantado
- `api/orientation.js`: C01, C03 e C08 como **três chamadas de IA independentes**, cada qual com `role_id`, entrada, saída JSON, número de etapa e registro persistido em `regente10_orientation_steps`.
- C02, C04, C05, C06 e C07: apenas apoio e registros determinísticos, **não são agentes de IA independentes** neste marco. Não há evidências de ensaios ou prontidão real dos conectores.
- C03 consome C01, e C08 audita o plano derivado de C03. C05 não gera dependência circular de C04/C03.
- Se o navegador fechar após uma etapa persistida, pode continuar da próxima sem nova chamada daquela etapa. Se a chamada ficou incerta, o sistema **não repete automaticamente**.
- O Prompt Afinado é consolidado somente após os pareceres e passa pelo gate de auditoria crítica.
- `api/mission.js`: reserva de chamadas através de `rpc/regente10_reserve_ai_call`, que serializa reservas por Master e impõe teto de 12 por Master para o piloto. Não elevar sem aprovação.
- `regente10_controls`: PARAR TUDO e reativação, restritos ao Regente 1.0; bloqueiam novas operações, não cancelam automaticamente chamadas externas já em curso nem afetam o Regente antigo.
- `regente10_missions.paused`: estado de pausa individual com verificação antes de reservar uma chamada.
- A read-only status view de verificações antigas usa `regent_orchestra_checks`; relatórios antigos não concedem acesso a ferramentas.
- Todos os dados novos são armazenados em tabelas próprias do mesmo projeto Supabase `optotica-dev`, com RLS Master/proprietário. O projeto Supabase em si não foi duplicado.

## Schema do banco (migração já aplicada; documentação de contrato)
- Tabelas existentes: `regente10_missions`, `regente10_outputs`, `regente10_ai_calls`, todas com RLS.
- Novas tabelas: `regente10_controls` (owner_id, emergency_stop, updated_at), `regente10_orientation_steps` (mission_id, owner_id, role_id C01/C03/C08, step_index 0..2, output JSON, confirmed_at, unique por missão e papel).
- Coluna nova: `regente10_missions.paused BOOLEAN NOT NULL DEFAULT FALSE`.
- `regente10_ai_calls.kind`: `afinamento`, `resultado`, `orientacao`. `slot` de 0 a 7.
- RPC `regente10_reserve_ai_call(uuid,text,integer)` security invoker com checagem Master, lock por dono, checagem de parada e pausa, uniqueness de etapas e bloqueio em 12 chamadas. Nenhum service-role no app.
- Códigos de fase: `afinamento` → `aguardando_autorizacao` → `em_execucao` → `em_resultados` → `concluida`; fase Results alimentada durante Execução.
- Status `incerto` significa que o provedor pode ter cobrado mesmo que a resposta não tenha sido persistida.

## Checagens concluídas
- GitHub Actions Regente 1.0: **PASS** de `node --check` nos dois endpoints, análise de sintaxe do script HTML e invariantes básicos de segurança.
- Supabase: RLS habilitado em cinco tabelas `regente10_*` e função criada (migração bem-sucedida).
- Vercel: preview com dois endpoints `mission` e `orientation` em `READY`, depois deployment de produção com alias `regente-1-0.vercel.app` em `READY`.

## Verificações ainda pendentes
- Ensaio ponta a ponta autenticado: Master cria nova missão, usa três etapas independentes, aprova envelope textual, gera e aceita resultados. Não houve autenticação com senha real do Maestro durante o desenvolvimento.
- Verificação de erros e latência via logs reais após a primeira execução.
- Política de dados sensíveis além de filtro provisório: **não utilizar dados identificáveis de pacientes ou de inscritos**.
- Orçamento financeiro por provedor/moeda e reserva monetária de chamadas, além do teto quantitativo de 12.
- S00 completo (leases, locks por recurso, decisão sobre escrita externa, versionamento canônico, reconciliação robusta, audit-log causais).
- Implementar os cinco agentes C02/C04/C05/C06/C07 como atores independentes quando tecnicamente justificado e vincular o catálogo oficial de partituras.
- Integrações reais da Rede (GitHub/Vercel/Canva/Claude/etc.) são **pendentes**, nenhum instrumento externo tem autorização de escrita.

**Não confundir:** este avanço é real (IA invocada por função e persistência por papel), mas a Orquestra multiagente e o S00 completos ainda não estão certificados.
