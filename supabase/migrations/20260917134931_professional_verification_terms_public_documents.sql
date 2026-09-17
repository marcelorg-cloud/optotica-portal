begin;
alter table public.professional_verification_requests
  add column terms_acceptance jsonb,
  add column public_documents_consent_at timestamptz,
  add column public_documents jsonb not null default '{}'::jsonb,
  add column public_documents_checked boolean not null default false;

alter table public.professional_verification_requests
  add constraint verification_terms_snapshot_valid check (
    terms_acceptance is null or coalesce(
      jsonb_typeof(terms_acceptance) = 'object'
      and length(terms_acceptance->>'version') > 0
      and length(terms_acceptance->>'text') > 0
      and (terms_acceptance->>'sha256') ~ '^[a-f0-9]{64}$'
      and (terms_acceptance->>'accepted_by') ~ '^[a-f0-9-]{36}$'
      and length(terms_acceptance->>'accepted_at') > 0, false)
  ),
  add constraint verification_public_documents_object check (jsonb_typeof(public_documents) = 'object'),
  add constraint verification_public_documents_reviewed check (
    status <> 'verified' or terms_acceptance is null or (
      public_documents_checked and public_documents_consent_at is not null
      and public_documents ?& array['diploma','registration']
    )
  );

-- Submission, consent and terms evidence remain immutable. Only review evidence
-- may change, and every such change is recorded by the existing audit trigger.
create or replace function public.audit_professional_verification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(new) - array['status','reviewed_by','reviewed_at','valid_until','review_notes','public_scope','attestation_path','attestation_sha256','signatures_checked','public_documents','public_documents_checked'])
     is distinct from
     (to_jsonb(old) - array['status','reviewed_by','reviewed_at','valid_until','review_notes','public_scope','attestation_path','attestation_sha256','signatures_checked','public_documents','public_documents_checked']) then
    raise exception 'Submitted documents and terms acceptance are immutable; submit a new request';
  end if;
  insert into public.verification_audit_events(actor_id,entity_id,action,details)
  values(new.reviewed_by,new.id,'verification_' || new.status,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
  return new;
end $$;
revoke all on function public.audit_professional_verification() from public, anon, authenticated;
-- The bucket and tables stay private. Public copies are streamed only by the
-- code-scoped route after fresh approval, identity, consent and expiry checks.
commit;
