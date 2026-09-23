-- Canva: server-only OAuth credentials, one design per color and review before saving.
create table public.canva_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  canva_user_id text not null, canva_team_id text not null,
  access_token text not null, refresh_token text not null,
  expires_at timestamptz not null,
  lock_token uuid, lock_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
create table public.canva_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  color_id uuid not null references public.catalog_product_color_images(id) on delete cascade,
  verifier text not null, expires_at timestamptz not null
);
create index canva_oauth_states_expiry on public.canva_oauth_states(expires_at);
create index canva_oauth_states_user on public.canva_oauth_states(user_id);
create index canva_oauth_states_product on public.canva_oauth_states(product_id);
create index canva_oauth_states_color on public.canva_oauth_states(color_id);
create table public.catalog_canva_designs (
  color_id uuid primary key references public.catalog_product_color_images(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  canva_user_id text not null, canva_team_id text not null,
  source_path text not null, asset_id text, upload_job_id text, design_id text,
  creating boolean not null default false,
  lock_token uuid, lock_until timestamptz not null default '-infinity',
  created_at timestamptz not null default now()
);
create index catalog_canva_designs_product on public.catalog_canva_designs(product_id);
create index catalog_canva_designs_user on public.catalog_canva_designs(user_id);
create table public.canva_edit_sessions (
  id uuid primary key default gen_random_uuid(),
  color_id uuid not null references public.catalog_product_color_images(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  design_id text not null, canva_user_id text not null, canva_team_id text not null,
  original_path text not null, previous_path text, previous_processed_at timestamptz,
  frame_width_mm numeric not null check (frame_width_mm > 0),
  export_job_id text, staged_path text, return_verified_at timestamptz,
  saved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  lock_token uuid, lock_until timestamptz not null default '-infinity',
  created_at timestamptz not null default now()
);
create index canva_edit_sessions_color on public.canva_edit_sessions(color_id);
create index canva_edit_sessions_product on public.canva_edit_sessions(product_id);
create index canva_edit_sessions_user on public.canva_edit_sessions(user_id);
create index canva_edit_sessions_expiry on public.canva_edit_sessions(expires_at);

alter table public.canva_connections enable row level security;
alter table public.canva_oauth_states enable row level security;
alter table public.catalog_canva_designs enable row level security;
alter table public.canva_edit_sessions enable row level security;
revoke all on public.canva_connections, public.canva_oauth_states,
  public.catalog_canva_designs, public.canva_edit_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.canva_connections, public.canva_oauth_states,
  public.catalog_canva_designs, public.canva_edit_sessions to service_role;

-- Compare snapshots and consume the review in the same transaction.
-- Invoker rights; only service_role may invoke this server-side operation.
create function public.save_canva_tryon(p_session_id uuid, p_user_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.canva_edit_sessions%rowtype;
  c public.catalog_product_color_images%rowtype;
  current_width numeric;
begin
  if not exists (select 1 from public.system_admins where user_id = p_user_id and active) then
    raise exception 'CANVA_FORBIDDEN';
  end if;
  select * into s from public.canva_edit_sessions where id = p_session_id and user_id = p_user_id for update;
  if not found or s.expires_at <= now() or s.staged_path is null then raise exception 'CANVA_SESSION_INVALID'; end if;
  if s.saved_at is not null then return s.staged_path; end if;
  select frame_total_width_mm into current_width from public.catalog_products where id = s.product_id for update;
  select * into c from public.catalog_product_color_images where id = s.color_id and product_id = s.product_id for update;
  if not found or c.original_image_path is distinct from s.original_path
    or c.processed_image_path is distinct from s.previous_path
    or c.processed_at is distinct from s.previous_processed_at
    or current_width is distinct from s.frame_width_mm then
    raise exception 'CANVA_CONFLICT';
  end if;
  update public.catalog_product_color_images set processed_image_path = s.staged_path,
    processed_at = now(), updated_at = now() where id = s.color_id;
  update public.canva_edit_sessions set saved_at = now() where id = s.id;
  return s.staged_path;
end;
$$;
revoke all on function public.save_canva_tryon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_canva_tryon(uuid, uuid) to service_role;
