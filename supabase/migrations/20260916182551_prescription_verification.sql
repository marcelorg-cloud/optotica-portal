begin;

-- Public pages resolve one unguessable code on the server and return only a
-- deliberately small projection. No direct Data API access to these tables.
create table public.professional_verification_requests (
  id uuid primary key default gen_random_uuid(),
  professional_profile_id uuid not null references public.professional_profiles(id),
  professional_name text not null,
  registration text not null,
  course text not null,
  institution text not null,
  documents jsonb not null check (jsonb_typeof(documents) = 'object'),
  status text not null default 'under_review' check (status in ('under_review','verified','changes_requested','revoked')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  valid_until date,
  review_notes text,
  public_scope text,
  attestation_path text,
  attestation_sha256 text,
  signatures_checked boolean not null default false,
  check (status <> 'verified' or (reviewed_by is not null and reviewed_at is not null and signatures_checked and attestation_path is not null and public_scope is not null and valid_until is not null))
);
create index on public.professional_verification_requests(professional_profile_id, created_at desc);

create table public.issued_prescriptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  client_id uuid not null references public.clients(id),
  professional_user_id uuid not null references auth.users(id),
  professional_profile_id uuid not null references public.professional_profiles(id),
  verification_code text not null unique check (verification_code ~ '^[a-f0-9]{64}$'),
  version integer not null check (version > 0),
  patient_name text not null,
  professional_name text not null,
  professional_registration text not null,
  prescription_data jsonb not null,
  observations text not null default '',
  issued_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','superseded','cancelled')),
  unique(order_id,version)
);
create unique index issued_prescriptions_one_active on public.issued_prescriptions(order_id) where status='active';
create index on public.issued_prescriptions(client_id);
create index on public.issued_prescriptions(professional_profile_id);
create index on public.issued_prescriptions(professional_user_id);
create index on public.professional_verification_requests(reviewed_by);

create table public.verification_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  entity_id uuid not null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.verification_audit_events(actor_id);

alter table public.professional_verification_requests enable row level security;
alter table public.issued_prescriptions enable row level security;
alter table public.verification_audit_events enable row level security;
revoke all on public.professional_verification_requests, public.issued_prescriptions, public.verification_audit_events from public, anon, authenticated;
grant select, insert, update on public.professional_verification_requests, public.issued_prescriptions to service_role;
grant select, insert on public.verification_audit_events to service_role;
grant usage, select on sequence public.verification_audit_events_id_seq to service_role;

create function public.preserve_issued_prescription() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Issued prescription content is immutable';
  end if;
  if old.status <> 'active' and new.status <> old.status then
    raise exception 'A historical prescription cannot be reactivated';
  end if;
  return new;
end $$;
revoke all on function public.preserve_issued_prescription() from public, anon, authenticated;
create trigger preserve_issued_prescription before update on public.issued_prescriptions for each row execute function public.preserve_issued_prescription();

-- SECURITY INVOKER. Callable only by the authenticated server's service role.
-- Locking the order makes issuance, versioning and replacement atomic.
create function public.issue_optical_prescription(target_order uuid, actor_id uuid, new_code text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  ord public.orders;
  prof public.professional_profiles;
  rx public.prescriptions;
  previous public.issued_prescriptions;
  patient_name_value text;
  result_id uuid;
  next_version integer;
  eye text;
  field text;
  eye_value numeric;
begin
  select * into ord from public.orders where id=target_order for update;
  if ord.id is null or ord.professional_id is distinct from actor_id then raise exception 'Order unavailable'; end if;
  if ord.status='cancelled' then raise exception 'Order cancelled'; end if;
  select * into prof from public.professional_profiles where user_id=actor_id and status='approved' and account_type='professional';
  if prof.id is null then raise exception 'Approved individual professional required'; end if;
  select * into rx from public.prescriptions where order_id=ord.id;
  if rx.id is null or rx.professional_id is distinct from actor_id or
     jsonb_typeof(rx.prescription_data->'od') is distinct from 'object' or
     jsonb_typeof(rx.prescription_data->'oe') is distinct from 'object' then raise exception 'Save a complete prescription first'; end if;
  foreach eye in array array['od','oe'] loop
    foreach field in array array['esferico','cilindrico','eixo','adicao'] loop
      if jsonb_typeof(rx.prescription_data->eye->field) is distinct from 'number' then raise exception 'Incomplete prescription'; end if;
      eye_value := (rx.prescription_data->eye->>field)::numeric;
      if (field in ('esferico','cilindrico') and (eye_value < -30 or eye_value > 30)) or
         (field = 'eixo' and (eye_value < 0 or eye_value > 180 or eye_value <> trunc(eye_value))) or
         (field = 'adicao' and (eye_value < 0 or eye_value > 6)) then raise exception 'Invalid prescription'; end if;
    end loop;
  end loop;
  select full_name into patient_name_value from public.clients where id=ord.client_id and status='active';
  if patient_name_value is null then raise exception 'Patient unavailable'; end if;
  select * into previous from public.issued_prescriptions where order_id=ord.id and status='active';
  if previous.id is not null and previous.patient_name=patient_name_value and
     previous.professional_name=prof.display_name and previous.professional_registration=coalesce(prof.council_registration,'') and
     previous.prescription_data=rx.prescription_data and previous.observations=coalesce(rx.clinical_notes,'') then
    return previous.id;
  end if;
  select coalesce(max(version),0)+1 into next_version from public.issued_prescriptions where order_id=ord.id;
  update public.issued_prescriptions set status='superseded' where order_id=ord.id and status='active';
  insert into public.issued_prescriptions(order_id,client_id,professional_user_id,professional_profile_id,verification_code,version,patient_name,professional_name,professional_registration,prescription_data,observations)
  values(ord.id,ord.client_id,actor_id,prof.id,new_code,next_version,patient_name_value,prof.display_name,coalesce(prof.council_registration,''),rx.prescription_data,coalesce(rx.clinical_notes,'')) returning id into result_id;
  insert into public.verification_audit_events(actor_id,entity_id,action) values(actor_id,result_id,'prescription_issued');
  return result_id;
end $$;
revoke all on function public.issue_optical_prescription(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.issue_optical_prescription(uuid,uuid,text) to service_role;

-- Preserve all submission evidence and retain an atomic audit trail for decisions.
create function public.audit_professional_verification() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(new) - array['status','reviewed_by','reviewed_at','valid_until','review_notes','public_scope','attestation_path','attestation_sha256','signatures_checked'])
     is distinct from
     (to_jsonb(old) - array['status','reviewed_by','reviewed_at','valid_until','review_notes','public_scope','attestation_path','attestation_sha256','signatures_checked']) then
    raise exception 'Submitted documents are immutable; submit a new request';
  end if;
  insert into public.verification_audit_events(actor_id,entity_id,action,details)
  values(new.reviewed_by,new.id,'verification_' || new.status,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
  return new;
end $$;
revoke all on function public.audit_professional_verification() from public, anon, authenticated;
create trigger audit_professional_verification before update on public.professional_verification_requests for each row execute function public.audit_professional_verification();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('professional-verification','professional-verification',false,1000000,array['application/pdf'])
on conflict(id) do nothing;
-- No storage policies: downloads and uploads require server-side ownership/master checks.
commit;
