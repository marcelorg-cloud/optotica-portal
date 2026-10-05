create table if not exists public.regent_tool_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.regent_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  node_id text not null,
  adapter text not null,
  status text not null default 'pending'
    check (status in ('pending','running','succeeded','failed','blocked')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  token_hash text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists regent_tool_runs_task_idx
  on public.regent_tool_runs(task_id, step_number, created_at);
create index if not exists regent_tool_runs_user_idx
  on public.regent_tool_runs(user_id, created_at desc);

alter table public.regent_tool_runs enable row level security;
grant select, insert, update on public.regent_tool_runs to authenticated;

drop policy if exists regent_tool_runs_select_own on public.regent_tool_runs;
create policy regent_tool_runs_select_own on public.regent_tool_runs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists regent_tool_runs_insert_own on public.regent_tool_runs;
create policy regent_tool_runs_insert_own on public.regent_tool_runs
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.regent_tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists regent_tool_runs_update_own on public.regent_tool_runs;
create policy regent_tool_runs_update_own on public.regent_tool_runs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);