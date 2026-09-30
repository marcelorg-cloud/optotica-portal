begin;

-- Desafios descartáveis do login por WhatsApp. A tabela só é acessada pelas
-- rotas de servidor com a chave administrativa. RLS sem políticas e os
-- REVOKEs impedem leitura e escrita pelo navegador.
create table public.whatsapp_login_challenges (
  id uuid primary key default gen_random_uuid(),
  whatsapp_e164 text not null,
  code_hash text not null,
  candidate_accounts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidate_accounts) = 'array'),
  requester_fingerprint text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'consumed', 'revoked')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index whatsapp_login_challenges_phone_created_idx
  on public.whatsapp_login_challenges (whatsapp_e164, created_at desc);
create index whatsapp_login_challenges_fingerprint_created_idx
  on public.whatsapp_login_challenges (requester_fingerprint, created_at desc);
create index whatsapp_login_challenges_expiry_idx
  on public.whatsapp_login_challenges (expires_at)
  where status in ('pending', 'verified');

alter table public.whatsapp_login_challenges enable row level security;
revoke all on table public.whatsapp_login_challenges from anon, authenticated;

-- Reinicia atomicamente o vínculo Canva de um produto. O design antigo não é
-- apagado do Canva; apenas deixa de ser o lote canônico do portal.
create or replace function public.reset_canva_product_design(p_product_id uuid, p_user_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  pending_color uuid;
begin
  if not exists (select 1 from public.system_admins where user_id = p_user_id and active) then
    raise exception 'CANVA_FORBIDDEN';
  end if;
  select pending_color_id into pending_color
  from public.canva_product_designs where product_id = p_product_id for update;
  if pending_color is not null then raise exception 'CANVA_PENDING'; end if;
  update public.canva_edit_sessions
  set expires_at = now()
  where product_id = p_product_id and saved_at is null and expires_at > now();
  delete from public.catalog_canva_designs where product_id = p_product_id;
  delete from public.canva_product_designs where product_id = p_product_id;
  return true;
end;
$$;
revoke all on function public.reset_canva_product_design(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_canva_product_design(uuid, uuid) to service_role;

commit;
