import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { processFacePhoto } from '@/lib/tryon/face-photo-process';

// "Foto de rosto para Prova Online" (15/09/2026) — card novo na Etapa 1 do
// atendimento. Duas ações nesta rota:
//
// POST (multipart, campo "photo"): o profissional escolhe um arquivo OU
// tira uma foto nova (câmera do dispositivo) — foto SEPARADA da foto de
// DNP, por pedido explícito do usuário. Guarda a foto crua (auditoria,
// bucket 'tryon-face-source-photos', separado do 'try-on-photos' — ver
// migração 202609152000), processa por IA (recorte quadrado, fundo cinza
// neutro, iluminação equalizada — lib/tryon/face-photo-process.ts) e grava
// o resultado como PENDENTE em `clients` — nasce pendente, não vira a foto
// oficial de prova online até o profissional validar (mesmo padrão já
// usado nas fotos do catálogo: nasce pendente, popup de validação).
//
// PATCH (JSON, {action: 'validar'}): confirma a foto pendente atual —
// copia o resultado processado pro MESMO arquivo que
// `/api/client/photo` já grava e que `/api/client/tryon/compose` já lê
// (bucket 'try-on-photos', caminho "{org}/{client}/prova.<ext>") — a
// partir daí, "Etapa 1 vira a fonte principal" da prova online deste
// paciente. Não remove a possibilidade de o próprio paciente trocar essa
// foto depois pela área dele (decisão explícita: fora do escopo desta
// rodada).
//
// Mesmo padrão de bloqueio das outras rotas da etapa 1-4: depois da
// Comanda final confirmada, nada aqui pode mudar.

const SOURCE_BUCKET = 'tryon-face-source-photos';
const TRYON_BUCKET = 'try-on-photos';
const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

async function loadOrderAndCheckLock(admin: ReturnType<typeof createAdminSupabaseClient>, orderId: string, professionalId: string) {
  const { data: order } = await admin
    .from('orders')
    .select('id, client_id, organization_id')
    .eq('id', orderId)
    .eq('professional_id', professionalId)
    .maybeSingle();
  if (!order) return { ok: false as const, status: 404, message: 'Pedido não encontrado.' };

  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return { ok: false as const, status: 409, message: 'A Comanda final já foi confirmada — a foto de rosto não pode mais ser alterada.' };
  }
  return { ok: true as const, order };
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const lock = await loadOrderAndCheckLock(admin, orderId, user.id);
  if (!lock.ok) return NextResponse.json({ message: lock.message }, { status: lock.status });
  const { order } = lock;

  const form = await request.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) return NextResponse.json({ message: 'Selecione ou tire uma foto.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ message: 'A foto deve ter até 8MB.' }, { status: 400 });
  const ext = EXT_BY_MIME[file.type];
  if (!ext) return NextResponse.json({ message: 'Formato de imagem não suportado. Envie JPG, PNG, WEBP ou HEIC.' }, { status: 400 });

  // Um arquivo original por atendimento (upsert, mesmo padrão da foto de
  // DNP): capturar de novo dentro do mesmo pedido troca a foto de
  // referência; pedidos diferentes do mesmo paciente mantêm cada um a sua.
  const sourcePath = `${order.organization_id}/${order.client_id}/rosto-${orderId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(SOURCE_BUCKET).upload(sourcePath, bytes, { contentType: file.type, upsert: true });
  if (uploadError) {
    console.error('face_photo_source_upload_failed', { message: uploadError.message });
    // Detalhe do erro exposto na resposta (15/09/2026): esta rota só usa o
    // client admin (service role), que já ignora RLS — então se isto falhar
    // quase sempre é porque o bucket 'tryon-face-source-photos' ainda não
    // foi criado no painel do Supabase (erro típico: "Bucket not found").
    // Mostrar o texto real evita depender dos logs da Vercel para descobrir.
    return NextResponse.json({ message: 'Não foi possível salvar a foto enviada.', detail: uploadError.message }, { status: 500 });
  }

  const { data: signedSource } = await admin.storage.from(SOURCE_BUCKET).createSignedUrl(sourcePath, 300);
  if (!signedSource?.signedUrl) {
    return NextResponse.json({ message: 'Não foi possível preparar a foto para processar.' }, { status: 500 });
  }

  let processedBuffer: Buffer;
  try {
    processedBuffer = await processFacePhoto(signedSource.signedUrl);
  } catch (err) {
    console.error('face_photo_process_failed', { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ message: 'Não foi possível processar a foto com IA. Tente novamente.' }, { status: 502 });
  }

  const processedPath = `${order.organization_id}/${order.client_id}/rosto-processado-${orderId}.jpg`;
  const { error: processedUploadError } = await admin.storage.from(SOURCE_BUCKET).upload(processedPath, processedBuffer, { contentType: 'image/jpeg', upsert: true });
  if (processedUploadError) {
    console.error('face_photo_processed_upload_failed', { message: processedUploadError.message });
    return NextResponse.json({ message: 'Foto processada, mas não foi possível salvar o resultado.', detail: processedUploadError.message }, { status: 500 });
  }

  const { error: updateError } = await admin.from('clients').update({
    tryon_face_source_path: sourcePath,
    tryon_face_processed_path: processedPath,
    tryon_face_status: 'pendente',
    tryon_face_order_id: orderId,
    tryon_face_validated_at: null
  }).eq('id', order.client_id);
  if (updateError) {
    console.error('face_photo_client_update_failed', { code: updateError.code });
    return NextResponse.json({ message: 'Foto processada, mas não foi possível atualizar o cadastro do paciente.' }, { status: 500 });
  }

  const { data: signedProcessed } = await admin.storage.from(SOURCE_BUCKET).createSignedUrl(processedPath, 3600);
  return NextResponse.json({
    message: 'Foto processada — confira e valide para ela virar a foto oficial de prova online.',
    processedUrl: signedProcessed?.signedUrl || null,
    status: 'pendente'
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const lock = await loadOrderAndCheckLock(admin, orderId, user.id);
  if (!lock.ok) return NextResponse.json({ message: lock.message }, { status: lock.status });
  const { order } = lock;

  const body = await request.json().catch(() => null);
  if (body?.action !== 'validar') return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 });

  const { data: client } = await admin.from('clients')
    .select('organization_id, tryon_face_processed_path, tryon_face_status')
    .eq('id', order.client_id)
    .maybeSingle();
  if (!client?.tryon_face_processed_path || client.tryon_face_status !== 'pendente') {
    return NextResponse.json({ message: 'Não há foto processada pendente para validar.' }, { status: 409 });
  }

  const { data: processedBlob, error: downloadError } = await admin.storage.from(SOURCE_BUCKET).download(client.tryon_face_processed_path);
  if (downloadError || !processedBlob) {
    console.error('face_photo_validate_download_failed', { message: downloadError?.message });
    return NextResponse.json({ message: 'Não foi possível carregar a foto processada.', detail: downloadError?.message }, { status: 500 });
  }

  // Mesmo padrão de "sempre um único arquivo fixo por cliente" já usado em
  // /api/client/photo: limpa a pasta antes de gravar a foto oficial nova
  // (troca a que o próprio paciente tinha subido, se houver).
  const folder = `${order.organization_id}/${order.client_id}`;
  const { data: existing } = await admin.storage.from(TRYON_BUCKET).list(folder);
  const toRemove = (existing || []).filter((f) => !f.name.startsWith('display')).map((f) => `${folder}/${f.name}`);
  if (toRemove.length) await admin.storage.from(TRYON_BUCKET).remove(toRemove);

  const bytes = new Uint8Array(await processedBlob.arrayBuffer());
  const { error: uploadError } = await admin.storage.from(TRYON_BUCKET).upload(`${folder}/prova.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) {
    console.error('face_photo_validate_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'Não foi possível publicar a foto como prova online oficial.', detail: uploadError.message }, { status: 500 });
  }

  // 16/09/2026 — bug reportado: "troquei a foto da prova online mas não
  // mudou na visualização do óculos". Causa: a composição "rosto + óculos"
  // (lib/tryon/compose-server.ts) é gerada uma vez por combinação
  // paciente+produto+cor e fica em cache (bucket 'try-on-photos', pasta
  // "display/", + tabela `catalog_patient_display_images`) — a limpeza
  // acima sempre preservou de propósito os arquivos "display*" (são o
  // resultado, não a foto crua). O card de armação só gera uma composição
  // nova quando NÃO existe uma em cache (`!active.provaUrl`, ver
  // components/order/frame-step.tsx) — então trocar a foto de rosto nunca
  // invalidava as composições já feitas com a foto antiga, e o paciente
  // continuava vendo o rosto velho com o óculos por cima. Ao validar uma
  // foto de rosto nova (é só aqui que a foto oficial realmente muda — a
  // pendente do POST acima ainda não vale), apagamos todo o cache de
  // composições deste cliente (arquivos "display/" + linhas de
  // `catalog_patient_display_images`), pra próxima visualização de cada
  // cor gerar de novo com o rosto atualizado. Mesmo cache é usado pela
  // Etapa 3 do atendimento e pela área do próprio paciente (função
  // compartilhada) — uma única limpeza cobre os dois lados.
  const { data: displayFiles } = await admin.storage.from(TRYON_BUCKET).list(`${folder}/display`);
  const displayToRemove = (displayFiles || []).map((f) => `${folder}/display/${f.name}`);
  if (displayToRemove.length) {
    const { error: displayRemoveError } = await admin.storage.from(TRYON_BUCKET).remove(displayToRemove);
    if (displayRemoveError) console.error('face_photo_validate_display_cleanup_failed', { message: displayRemoveError.message });
  }
  const { error: displayRowsError } = await admin.from('catalog_patient_display_images').delete().eq('client_id', order.client_id);
  if (displayRowsError) console.error('face_photo_validate_display_rows_cleanup_failed', { message: displayRowsError.message });

  const { error: updateError } = await admin.from('clients').update({
    tryon_face_status: 'validada',
    tryon_face_validated_at: new Date().toISOString()
  }).eq('id', order.client_id);
  if (updateError) {
    console.error('face_photo_validate_client_update_failed', { code: updateError.code });
    return NextResponse.json({ message: 'Foto publicada, mas não foi possível atualizar o status.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Foto validada — agora é a foto oficial de prova online do paciente.' });
}
