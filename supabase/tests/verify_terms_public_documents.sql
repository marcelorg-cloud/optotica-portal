begin;
do $$
declare
  professional record;
  request_id uuid;
  blocked boolean;
begin
  if (select public from storage.buckets where id='professional-verification') is distinct from false then raise exception 'Bucket must remain private'; end if;
  if has_table_privilege('anon','public.professional_verification_requests','select') then raise exception 'Anonymous table access'; end if;
  if not (select relrowsecurity from pg_class where oid='public.professional_verification_requests'::regclass) then raise exception 'RLS missing'; end if;
  select id,user_id,display_name,council_registration into professional from public.professional_profiles where account_type='professional' limit 1;
  if professional.id is null then raise exception 'No professional profile for rollback test'; end if;
  insert into public.professional_verification_requests(professional_profile_id,professional_name,registration,course,institution,documents,terms_acceptance,public_documents_consent_at)
  values(professional.id,professional.display_name,coalesce(professional.council_registration,''),'Rollback test','Rollback test','{}',
    jsonb_build_object('version','test','text','Terms under test','sha256',repeat('a',64),'accepted_by',professional.user_id,'accepted_at',now()),now()) returning id into request_id;
  blocked := false;
  begin
    update public.professional_verification_requests set terms_acceptance=jsonb_set(terms_acceptance,'{text}','"Changed"') where id=request_id;
  exception when raise_exception then blocked := true; end;
  if not blocked then raise exception 'Terms snapshot was editable'; end if;
  blocked := false;
  begin
    update public.professional_verification_requests set status='verified',reviewed_by=professional.user_id,reviewed_at=now(),valid_until=current_date+30,public_scope='Test scope',signatures_checked=true where id=request_id;
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'Approval without public copies was allowed'; end if;
  update public.professional_verification_requests set status='verified',reviewed_by=professional.user_id,reviewed_at=now(),valid_until=current_date+30,public_scope='Test scope',signatures_checked=true,public_documents_checked=true,public_documents='{"diploma":{},"registration":{}}' where id=request_id;
  if not exists(select 1 from public.professional_verification_requests where id=request_id and status='verified' and attestation_path is null) then raise exception 'Approval without another attestation failed'; end if;
  blocked := false;
  begin
    update public.professional_verification_requests set signatures_checked=false where id=request_id;
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'Documentary review confirmation was bypassed'; end if;
  if not exists(select 1 from public.verification_audit_events where entity_id=request_id and action='verification_verified') then raise exception 'Decision audit missing'; end if;
end $$;
select 'Verification schema and immutable acceptance checks passed; test rolled back' as result;
rollback;
