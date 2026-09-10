begin;

-- =========================================================================
-- Ferramenta "Medir com foto" (etapa 1 do atendimento): calcula a DNP a
-- partir de uma foto com um cartão de crédito/documento como referência de
-- escala, com marcação prévia por IA e ajuste manual do profissional antes
-- de salvar. Guarda os números (em clients.dnp_od/dnp_oe, já existentes) e
-- também a foto usada (para auditoria — o profissional pode reabrir e
-- conferir depois), formando parte da ficha do paciente.
-- =========================================================================

alter table public.clients add column if not exists dnp_photo_path text;
alter table public.clients add column if not exists dnp_measured_at timestamptz;

-- Bucket 'dnp-photos' precisa ser criado manualmente pelo painel do Supabase
-- (mesmo procedimento já usado para 'try-on-photos' — não há
-- `insert into storage.buckets` em nenhuma migração deste projeto).
--
-- Mesmo padrão de políticas de storage.objects do try-on-photos: caminho
-- sempre "{organization_id}/{client_id}/...", leitura para quem pode
-- acessar o cliente (equipe da organização ou o próprio paciente logado),
-- escrita/remoção só para quem pode gerenciar o cliente (equipe da
-- organização) — a ferramenta é usada pelo profissional, nunca pelo
-- paciente diretamente.
drop policy if exists dnp_photos_read on storage.objects;
drop policy if exists dnp_photos_add on storage.objects;
drop policy if exists dnp_photos_remove on storage.objects;

create policy dnp_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'dnp-photos' and public.can_access_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy dnp_photos_add on storage.objects for insert to authenticated with check (
  bucket_id = 'dnp-photos' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy dnp_photos_remove on storage.objects for delete to authenticated using (
  bucket_id = 'dnp-photos' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);

commit;
