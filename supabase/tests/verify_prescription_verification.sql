-- Run against the project after migration. All fixture changes are rolled back.
begin;
do $$
declare
  candidate record;
  first_id uuid;
  second_id uuid;
  request_id uuid;
  blocked boolean;
  table_name text;
begin
  foreach table_name in array array['issued_prescriptions','professional_verification_requests','verification_audit_events'] loop
    if has_table_privilege('anon','public.'||table_name,'SELECT') or
       has_table_privilege('authenticated','public.'||table_name,'SELECT') or
       has_table_privilege('authenticated','public.'||table_name,'INSERT') or
       not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then
      raise exception 'Direct access is not restricted: %',table_name;
    end if;
  end loop;
  if has_function_privilege('anon','public.issue_optical_prescription(uuid,uuid,text)','EXECUTE') or
     has_function_privilege('authenticated','public.issue_optical_prescription(uuid,uuid,text)','EXECUTE') then raise exception 'Issuance RPC is exposed'; end if;
  if (select public from storage.buckets where id='professional-verification') is distinct from false then raise exception 'Document bucket is not private'; end if;
  select o.id,o.professional_id,p.id profile_id into candidate
  from public.orders o join public.professional_profiles p on p.user_id=o.professional_id
  join public.prescriptions rx on rx.order_id=o.id
  join public.clients c on c.id=o.client_id
  where p.status='approved' and p.account_type='professional' and o.status<>'cancelled' and c.status='active'
  and rx.professional_id=o.professional_id limit 1;
  if candidate.id is null then raise exception 'No eligible fixture order for issuance tests'; end if;
  -- Isolated valid fixture, restored by ROLLBACK.
  update public.prescriptions set prescription_data='{"od":{"esferico":0,"cilindrico":0,"eixo":0,"adicao":0},"oe":{"esferico":0,"cilindrico":0,"eixo":0,"adicao":0}}', clinical_notes='Verification transaction test' where order_id=candidate.id;
  first_id := public.issue_optical_prescription(candidate.id,candidate.professional_id,repeat('a',64));
  if first_id is distinct from public.issue_optical_prescription(candidate.id,candidate.professional_id,repeat('b',64)) then raise exception 'Issuance not idempotent'; end if;
  blocked := false;
  begin perform public.issue_optical_prescription(candidate.id,gen_random_uuid(),repeat('b',64)); exception when others then blocked := true; end;
  if not blocked then raise exception 'Wrong professional could issue'; end if;
  blocked := false;
  begin update public.issued_prescriptions set patient_name='Changed' where id=first_id; exception when others then blocked := true; end;
  if not blocked then raise exception 'Issued snapshot is mutable'; end if;
  update public.prescriptions set clinical_notes='Updated verification transaction test' where order_id=candidate.id;
  second_id := public.issue_optical_prescription(candidate.id,candidate.professional_id,repeat('b',64));
  if second_id=first_id or (select status from public.issued_prescriptions where id=first_id)<>'superseded' then raise exception 'Version replacement failed'; end if;
  if (select count(*) from public.issued_prescriptions where order_id=candidate.id and status='active')<>1 then raise exception 'Multiple active versions'; end if;
  update public.prescriptions set prescription_data='{"od":{},"oe":{}}' where order_id=candidate.id;
  blocked := false;
  begin perform public.issue_optical_prescription(candidate.id,candidate.professional_id,repeat('c',64)); exception when others then blocked := true; end;
  if not blocked then raise exception 'Incomplete prescription could be issued'; end if;
  insert into public.professional_verification_requests(professional_profile_id,professional_name,registration,course,institution,documents)
  values(candidate.profile_id,'Test','Test','Test','Test','{}') returning id into request_id;
  blocked := false;
  begin update public.professional_verification_requests set status='verified' where id=request_id; exception when others then blocked := true; end;
  if not blocked then raise exception 'Unreviewed verification was accepted'; end if;
  update public.professional_verification_requests set status='changes_requested',reviewed_by=candidate.professional_id,review_notes='Test' where id=request_id;
  if not exists(select 1 from public.verification_audit_events where entity_id=request_id and action='verification_changes_requested') then raise exception 'Decision audit missing'; end if;
  blocked := false;
  begin update public.professional_verification_requests set documents='{"changed":true}' where id=request_id; exception when others then blocked := true; end;
  if not blocked then raise exception 'Submitted evidence is mutable'; end if;
end $$;
rollback;
select 'PASS: private access, issuance ownership, idempotency, versions, immutability, required review and audit' as result;
