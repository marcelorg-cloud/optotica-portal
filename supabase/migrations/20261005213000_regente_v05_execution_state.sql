alter table public.regent_tasks
  add column if not exists current_step integer,
  add column if not exists progress_percent integer not null default 0
    check (progress_percent between 0 and 100),
  add column if not exists next_action text,
  add column if not exists autonomy_level integer not null default 1
    check (autonomy_level between 0 and 4),
  add column if not exists blocked_reason text,
  add column if not exists last_error jsonb;

create table if not exists public.regent_task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.regent_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  role text not null,
  node_ids text[] not null default '{}'::text[],
  action text not null,
  expected_output text,
  status text not null default 'planned'
    check (status in ('planned','prepared','awaiting_approval','running','review','succeeded','blocked','failed','skipped')),
  depends_on integer[] not null default '{}'::integer[],
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error jsonb,
  artifact jsonb,
  next_action text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, step_number)
);

create index if not exists regent_task_steps_task_idx
  on public.regent_task_steps(task_id, step_number);
create index if not exists regent_task_steps_user_status_idx
  on public.regent_task_steps(user_id, status, updated_at desc);

alter table public.regent_task_steps enable row level security;
grant select, insert, update on public.regent_task_steps to authenticated;

drop policy if exists regent_task_steps_select_own on public.regent_task_steps;
create policy regent_task_steps_select_own on public.regent_task_steps
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists regent_task_steps_insert_own on public.regent_task_steps;
create policy regent_task_steps_insert_own on public.regent_task_steps
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.regent_tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists regent_task_steps_update_own on public.regent_task_steps;
create policy regent_task_steps_update_own on public.regent_task_steps
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.regent_task_dependencies (
  task_id uuid not null references public.regent_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.regent_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create index if not exists regent_task_dependencies_user_idx
  on public.regent_task_dependencies(user_id, task_id);

alter table public.regent_task_dependencies enable row level security;
grant select, insert, delete on public.regent_task_dependencies to authenticated;

drop policy if exists regent_task_dependencies_select_own on public.regent_task_dependencies;
create policy regent_task_dependencies_select_own on public.regent_task_dependencies
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists regent_task_dependencies_insert_own on public.regent_task_dependencies;
create policy regent_task_dependencies_insert_own on public.regent_task_dependencies
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.regent_tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.regent_tasks d
      where d.id = depends_on_task_id and d.user_id = (select auth.uid())
    )
  );

drop policy if exists regent_task_dependencies_delete_own on public.regent_task_dependencies;
create policy regent_task_dependencies_delete_own on public.regent_task_dependencies
  for delete to authenticated
  using ((select auth.uid()) = user_id);
