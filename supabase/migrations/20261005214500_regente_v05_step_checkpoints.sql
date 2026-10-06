alter table public.regent_task_steps
  add column if not exists checkpoint boolean not null default false;
