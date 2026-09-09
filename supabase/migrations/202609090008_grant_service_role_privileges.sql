-- Corrige "permission denied" (Postgres 42501) que o backend (chave
-- service_role, usada pelo servidor Next.js) estava recebendo ao ler/gravar
-- em várias tabelas — ex.: professional_profiles, organizations.
--
-- Causa raiz: várias tabelas (organizations, organization_members,
-- whatsapp_access_requests, professional_profiles, professional_laboratories,
-- system_admins, audit_logs, entre outras) foram criadas fora do fluxo normal
-- do Supabase (reconstrução manual via psql), sem os GRANTs que o próprio
-- Supabase concede automaticamente quando uma tabela é criada pelo painel.
-- O RLS (Row Level Security) só é avaliado depois que o Postgres já checou
-- os privilégios de GRANT — sem o GRANT, nem chega a olhar as políticas.
--
-- Esta migração só concede privilégios (não muda estrutura, dados, RLS nem
-- regra de negócio nenhuma) e é idempotente: pode ser reaplicada sem erro.
--
-- service_role deve ter acesso total: é a chave privada usada só no
-- servidor (nunca exposta ao navegador) e o próprio RLS do projeto já conta
-- com esse papel enxergando tudo.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Garante que tabelas/sequências/funções criadas no futuro também já
-- nasçam com essa permissão, sem depender de lembrar de conceder de novo.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
