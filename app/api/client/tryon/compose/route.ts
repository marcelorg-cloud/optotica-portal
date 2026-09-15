import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { type Point } from '@/lib/tryon/geometry';
import { composeTryonImage } from '@/lib/tryon/compose-server';

type ColorRow = {
  processed_image_path: string | null;
  status: string;
  is_active: boolean;
  catalog_products: { id: string; lens_width_mm: number | null; frame_total_width_mm: number | null; status: string } | null;
};

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === 'object' && typeof (value as Point).x === 'number' && typeof (value as Point).y === 'number';
}

// "Usar esta foto como minha imagem principal" (seção 0.29 do estado
// consolidado): a detecção das pupilas só pode rodar no navegador
// (lib/dnp-vision.ts é explicitamente browser-only), então o navegador manda
// aqui o pixel das duas pupilas + o tamanho do canvas em que mediu — o
// servidor busca a foto original (potencialmente maior resolução) e escala
// tudo proporcionalmente antes de compor com `sharp`. DNP (mm) e largura da
// armação (mm) vêm só do banco, nunca do corpo da requisição — a única coisa
// que o cliente fornece é onde estão as pupilas NA PRÓPRIA foto dele.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) return NextResponse.json({ message: 'Cadastro de cliente não encontrado.' }, { status: 403 });

  const { data: client } = await admin
    .from('clients')
    .select('id, organization_id, dnp_od, dnp_oe, status')
    .eq('id', account.client_id)
    .maybeSingle();
  if (!client || client.status !== 'active') return NextResponse.json({ message: 'Cadastro de cliente inativo.' }, { status: 403 });
  if (client.dnp_od == null || client.dnp_oe == null) {
    return NextResponse.json({ message: 'Sua DNP ainda não foi medida pelo profissional — a prova online precisa dela.' }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const productId = typeof body?.productId === 'string' ? body.productId : '';
  const colorName = typeof body?.colorName === 'string' ? body.colorName : '';
  const photoWidth = Number(body?.photoWidth);
  const photoHeight = Number(body?.photoHeight);
  if (!productId || !colorName || !isPoint(body?.pupilA) || !isPoint(body?.pupilB) || !Number.isFinite(photoWidth) || !Number.isFinite(photoHeight) || photoWidth <= 0 || photoHeight <= 0) {
    return NextResponse.json({ message: 'Dados de prova inválidos.' }, { status: 400 });
  }
  const pupilA = body.pupilA as Point;
  const pupilB = body.pupilB as Point;
  // Ponto nasal opcional (15/09/2026, ajuste feito comparando com o JS
  // original da Ui!Gafas) — refina o centro da armação; se o cliente não
  // mandar (versão de cache antiga do bundle, por exemplo), cai pra média
  // simples entre as pupilas, igual ao comportamento de antes.
  const nasalCenter = isPoint(body?.nasalCenter) ? (body.nasalCenter as Point) : undefined;

  const { data: color } = await admin
    .from('catalog_product_color_images')
    .select('processed_image_path, status, is_active, catalog_products!inner(id, lens_width_mm, frame_total_width_mm, status)')
    .eq('product_id', productId)
    .eq('color_name', colorName)
    .maybeSingle();
  const row = color as unknown as ColorRow | null;
  const product = row?.catalog_products;
  // Largura real da armação pra escalar na foto (13/09/2026, 8ª rodada,
  // pedido do usuário): passa a preferir `frame_total_width_mm` ("Frente
  // Total" — medida de ponta a ponta da armação, mais precisa pra prova
  // online do que só a largura da lente) quando o master já preencheu esse
  // campo (opcional, migração 202609130010); cai pra `lens_width_mm` quando
  // ainda não foi preenchido, pra não quebrar a prova online de produtos já
  // publicados antes dessa medida existir.
  const frameWidthMm = product?.frame_total_width_mm || product?.lens_width_mm || null;
  // ATIVAR/OCULTAR por cor (15/09/2026, migração 202609151700) — mesmo
  // controle usado na lista de escolha (acima, na página do pedido); aqui
  // também bloqueia a COMPOSIÇÃO em si, não só a listagem, pra cobrir
  // qualquer chamada direta a esta rota com um productId/colorName ocultado
  // depois que a lista já tinha carregado.
  if (!row || row.status !== 'validada' || !row.is_active || !row.processed_image_path || !product || product.status !== 'publicado' || !frameWidthMm) {
    return NextResponse.json({ message: 'Esta armação não está disponível para prova.' }, { status: 404 });
  }

  // Composição em si (download das fotos, geometria, sharp, upload e upsert
  // em catalog_patient_display_images) foi extraída pra
  // lib/tryon/compose-server.ts (15/09/2026) — reaproveitada também pela
  // Etapa 3 do atendimento, quando o profissional gera a mesma prova pelo
  // catálogo (ver app/api/professional/orders/[orderId]/client/tryon-compose).
  const result = await composeTryonImage(admin, {
    organizationId: client.organization_id,
    clientId: client.id,
    dnpTotalMm: Number(client.dnp_od) + Number(client.dnp_oe),
    productId,
    colorName,
    processedImagePath: row.processed_image_path,
    frameWidthMm: Number(frameWidthMm),
    pupilA,
    pupilB,
    nasalCenter,
    photoWidth,
    photoHeight
  });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  return NextResponse.json({ message: 'Salva como sua imagem principal para este modelo.', imageUrl: result.imageUrl });
}
