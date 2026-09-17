begin;

-- The master reviews the professional's existing submission. No separate
-- signed attestation upload is required; reviewer, time, scope, validity and
-- explicit checks remain mandatory and are recorded by the audit trigger.
alter table public.professional_verification_requests
  drop constraint professional_verification_requests_check,
  add constraint professional_verification_requests_check check (
    status <> 'verified' or (
      reviewed_by is not null and reviewed_at is not null
      and signatures_checked and public_scope is not null
      and valid_until is not null
    )
  );

-- Historical attestation files/columns, the immutable submission, consent,
-- public-copy checks and private storage permissions are preserved.
commit;
