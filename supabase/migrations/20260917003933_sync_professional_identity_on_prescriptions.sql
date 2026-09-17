-- O formulário histórico gravava o registro do profissional individual em
-- technical_responsible_registration, enquanto a emissão da prescrição lê
-- council_registration. Normaliza os perfis existentes sem sobrescrever um
-- conselho já preenchido.
update public.professional_profiles
set council_registration = technical_responsible_registration,
    updated_at = now()
where account_type = 'professional'
  and nullif(btrim(council_registration), '') is null
  and nullif(btrim(technical_responsible_registration), '') is not null;
