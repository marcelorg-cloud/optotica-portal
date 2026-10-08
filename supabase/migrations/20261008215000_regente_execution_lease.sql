alter table public.regent_tasks
  add column if not exists execution_id uuid,
  add column if not exists execution_invocation_id uuid,
  add column if not exists execution_lease_until timestamptz;

create index if not exists regent_tasks_execution_lease_idx
  on public.regent_tasks(execution_id, execution_lease_until)
  where status = 'executing';
