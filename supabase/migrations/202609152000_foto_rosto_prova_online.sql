begin;

-- =========================================================================
-- "Foto de rosto para Prova Online" na Etapa 1 do atendimento (15/09/2026).
-- Feature deferida em rodadas anteriores ("Terminar armação primeiro,
-- depois a foto de rosto" — ver estado-consolidado.md), retomada agora.
--
-- Decisão confirmada com o usuário: Etapa 1 vira a fonte PRINCIPAL da foto
-- de prova online — o profissional escolhe um arquivo ou tira uma foto nova
-- do paciente durante o atendimento, a IA padroniza (recorte quadrado,
-- fundo cinza neutro, iluminação equalizada pra parecer frontal, sem
-- sombras laterais), o resultado nasce PENDENTE (mesmo padrão já usado nas
-- fotos do catálogo — nasce pendente, precisa validar num popup antes de
-- valer) e, ao validar, sobrescreve a foto oficial de prova online do
-- paciente (o mesmo arquivo que `/api/client/photo` já grava e que
-- `/api/client/tryon/compose` já lê) — sem remover a possibilidade de o
-- próprio paciente trocar essa foto depois pela área dele (decisão
-- explícita: manter como está por enquanto, não é escopo desta rodada).
--
-- Foto SEPARADA da foto de DNP (decisão explícita do usuário — não
-- reaproveita a foto da medição, que tem outro enquadramento/finalidade).
-- =========================================================================

alter table public.clients
  add column if not exists tryon_face_source_path text,
  add column if not exists tryon_face_processed_path text,
  add column if not exists tryon_face_status text,
  add column if not exists tryon_face_order_id uuid references public.orders(id) on delete set null,
  add column if not exists tryon_face_validated_at timestamptz;

alter table public.clients drop constraint if exists clients_tryon_face_status_check;
alter table public.clients add constraint clients_tryon_face_status_check
  check (tryon_face_status is null or tryon_face_status in ('pendente', 'validada'));

-- Bucket 'tryon-face-source-photos' precisa ser criado manualmente pelo
-- painel do Supabase (mesmo procedimento já usado para 'try-on-photos' e
-- 'dnp-photos' — não há `insert into storage.buckets` em nenhuma migração
-- deste projeto). Privado.
--
-- Guarda a foto ORIGINAL enviada/capturada (auditoria — o profissional pode
-- reabrir e conferir depois, mesmo padrão da foto de DNP) e a foto já
-- PROCESSADA pela IA, ainda pendente de validação — as duas em caminhos
-- próprios (`rosto-{orderId}.<ext>` / `rosto-processado-{orderId}.jpg`),
-- SEPARADAS de propósito do bucket 'try-on-photos': aquele bucket só pode
-- conter, na pasta de cada cliente, um único arquivo de foto-base (é assim
-- que `/api/client/tryon/compose` decide qual arquivo usar — ver comentário
-- no código) — misturar os arquivos de rascunho/auditoria lá quebraria essa
-- suposição. Só a foto final, já validada, é copiada pro 'try-on-photos'
-- (rota .../client/face-photo, ação "validar").
--
-- Mesmo padrão de políticas de storage.objects do dnp-photos/try-on-photos:
-- caminho sempre "{organization_id}/{client_id}/...", leitura e
-- escrita/remoção só para quem pode GERENCIAR o cliente (equipe da
-- organização) — diferente do try-on-photos (que o próprio paciente também
-- lê), aqui é só uso interno do atendimento, o paciente nunca acessa este
-- bucket diretamente.
drop policy if exists tryon_face_source_photos_read on storage.objects;
drop policy if exists tryon_face_source_photos_add on storage.objects;
drop policy if exists tryon_face_source_photos_remove on storage.objects;

create policy tryon_face_source_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'tryon-face-source-photos' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy tryon_face_source_photos_add on storage.objects for insert to authenticated with check (
  bucket_id = 'tryon-face-source-photos' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy tryon_face_source_photos_remove on storage.objects for delete to authenticated using (
  bucket_id = 'tryon-face-source-photos' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);

commit;
