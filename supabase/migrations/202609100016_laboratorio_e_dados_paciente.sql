begin;

-- =========================================================================
-- 1) Novo tipo de cadastro: "Laboratório", ao lado de Ótica. account_type
-- não é usado por nenhuma política de RLS/isolamento — o isolamento real é
-- por organization_id (ver seção 4 do estado consolidado do projeto) — então
-- adicionar um valor novo aqui é só ampliar o que o formulário/painel podem
-- gravar e mostrar, sem risco para o isolamento entre organizações.
-- 'bacharel' (professional_kind) deixou de ser oferecido no formulário, mas
-- a constraint abaixo não precisa mudar: cadastros antigos com esse valor
-- continuam válidos e não são afetados.
-- =========================================================================

alter table public.professional_profiles
  drop constraint if exists professional_profiles_account_type_check;

alter table public.professional_profiles
  add constraint professional_profiles_account_type_check
  check (account_type in ('professional', 'optical_store', 'laboratory'));

-- =========================================================================
-- 2) Dados adicionais do paciente, preenchidos pelo profissional durante o
-- atendimento (Etapa 1 — "Paciente"): data de nascimento e CPF. Os dois são
-- opcionais — nem todo paciente informa/tem CPF em mãos na hora do
-- atendimento, e não queremos bloquear o fluxo por isso. `clients` é uma das
-- tabelas que já existiam em produção fora do controle de versão (mesmo caso
-- de dnp_photo_path/dnp_measured_at na migração 015), então aqui só
-- adicionamos as colunas novas.
-- =========================================================================

alter table public.clients add column if not exists birth_date date;
alter table public.clients add column if not exists cpf text;

commit;
