# Pontes ChatGPT ↔ Regente 1.0 — status verificável

## Regra central
As conexões dos plugins ficam no ambiente autorizado do ChatGPT e **não são exportadas ao backend Vercel**. O Regente não recebe tokens, cookies ou scopes desses hubs.

## Implementação
- Novo endpoint `/api/bridges`: GET lista até 40 pedidos do Master autenticado; POST permite apenas `status_read` e `capabilities_read` em dez hubs predefinidos.
- Tabela `public.regente10_hub_bridge_requests`, RLS habilitado. Somente o Master ativo pode inserir pedidos pendentes e ler os próprios; resultado não pode ser atualizado pela chave de publicação no navegador.
- **Execução separada:** um operador com ferramentas conectadas ao ChatGPT processa os pedidos permitidos e escreve evidências resumidas e verificadas via acesso administrativo ao Supabase. O endpoint não executa ferramentas ChatGPT diretamente.
- Controle de parada: pedidos novos ficam bloqueados por `regente10_controls.emergency_stop`.
- Automação: verificação horária da fila, limitada a dados não pessoais e operações de leitura. Criada, mas sua primeira execução futura e sua autorização em cada hub **ainda não foram validadas**.

## Hubs registrados como acessíveis neste chat
1. GitHub — `get_profile` e leitura do repositório passaram.
2. Vercel — projeto e deployments acessíveis; project connectors listou zero conexões internas.
3. Supabase — migrations e consultas executadas; contexto administrativo ChatGPT ≠ autorização de aplicação.
4. Canva — consulta de brand kits acessível; não comprova a ponte Canva do Portal.
5. HeyGen — avatar groups privados listados; criação de vídeo não testada nem autorizada.
6. Google Drive — perfil acessível.
7. Google Docs — ações anunciadas no hub Drive, sem leitura de documento específico neste teste; **permissão efetiva não comprovada**.
8. Google Planilhas — consulta a metadados de uma planilha institucional pré-referenciada passou.
9. Gmail — perfil acessível; nenhuma mensagem lida ou enviada.
10. Windsor/Meta — `list_actions` apresentou definições de ações de campanha; nenhuma conta de anúncios nem permissão de escrita foi comprovada.

Esses dez relatórios foram persistidos sem IDs de usuário externos, conteúdo de documentos, endereços de e-mail, tokens, chaves ou links temporários.

## Limites de segurança
- Não contém adaptador de escrita para GitHub, Vercel, Supabase, Canva, Meta, WhatsApp, HeyGen ou Google.
- Não acessa autonomamente contas Google/Meta/Canva dentro da função Vercel.
- Atores A1-A4 ainda produzem apenas documentos.
- Nenhuma missão pode ultrapassar os limites de IA do piloto sem autorização; requisições de pontes não são chamadas à IA.
- Consulta pública de health não é uma integração administrativa.
- Sem provas de E2E autenticado com o Master e sem execução verificada da tarefa agendada, **não declarar ponte autônoma totalmente validada**.

## Próximos passos reais
1. Validar um ciclo horário: fila → plugin read-only → relatório assinado por proveniência → conclusão, incluindo tratamento de falhas.
2. Verificar contrato de autenticação de cada parceiro (OAuth de aplicação, chaves de serviço ou bridges já existentes no Portal).
3. Adicionar escrita por instrumento/escopo com aprovação explícita por missão; primeiro GitHub em branch descartável e Vercel preview, depois demais ferramentas.
4. Sincronizar política S00 de versão e direitos do Maestro com o executor.
