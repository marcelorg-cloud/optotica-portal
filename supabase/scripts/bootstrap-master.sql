-- Execute somente depois que o usuário master já tiver confirmado o Magic Link.
-- Troque o valor abaixo pelo e-mail exato do administrador da Optótica.
do $$
declare
  target_email text := 'SUBSTITUA_PELO_EMAIL_MASTER';
  target_user_id uuid;
begin
  if target_email = 'SUBSTITUA_PELO_EMAIL_MASTER' then
    raise exception 'Edite target_email antes de executar este script';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(target_email)
  limit 1;

  if target_user_id is null then
    raise exception 'Usuário não encontrado. Confirme primeiro o Magic Link de %', target_email;
  end if;

  insert into public.system_admins (user_id, role, active, created_by)
  values (target_user_id, 'master_admin', true, target_user_id)
  on conflict (user_id) do update set active = true, role = 'master_admin';
end $$;
