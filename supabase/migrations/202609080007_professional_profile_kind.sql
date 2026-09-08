-- Adiciona a distinção de subtipo profissional (Optometrista/Bacharel) usada
-- pelo novo formulário de cadastro/validação profissional. account_type
-- continua valendo para toda a lógica de acesso (permanece 'professional' ou
-- 'optical_store'); professional_kind é só um detalhamento informativo
-- quando account_type = 'professional'.
--
-- Idempotente: pode ser reaplicada sem erro.

alter table public.professional_profiles
  add column if not exists professional_kind text;

alter table public.professional_profiles
  drop constraint if exists professional_profiles_professional_kind_check;

alter table public.professional_profiles
  add constraint professional_profiles_professional_kind_check
  check (professional_kind is null or professional_kind in ('optometrista', 'bacharel'));
