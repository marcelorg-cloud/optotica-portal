-- Auditoria somente leitura para executar depois da migração 003.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'system_admins', 'professional_profiles', 'professional_laboratories',
    'laboratory_catalogs', 'professional_profile_change_requests', 'patient_whatsapp_identities',
    'professional_client_assignments', 'patient_access_invitations',
    'clients', 'orders', 'prescriptions', 'documents', 'quotes'
  )
order by tablename;

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'system_admins', 'professional_profiles', 'professional_laboratories',
    'laboratory_catalogs', 'professional_profile_change_requests',
    'professional_client_assignments', 'patient_access_invitations',
    'client_user_accounts', 'clients', 'client_consents', 'orders',
    'prescriptions', 'documents', 'quotes', 'quote_items', 'order_frames'
  )
order by tablename, policyname;

select count(*) as masters_ativos
from public.system_admins
where role = 'master_admin' and active = true;

select status, count(*)
from public.professional_profiles
group by status
order by status;
