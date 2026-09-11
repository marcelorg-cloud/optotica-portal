import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const BUCKET = 'catalog-product-photos';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// Passo 1 do envio de foto de cor (mesmo padrão em duas etapas da biblioteca
// de preços do laboratório, correção de 11/09/2026): o navegador pede aqui
// uma URL de upload assinada e envia o arquivo DIRETO pro Storage — sem
// passar pelo servidor Next.js — depois confirma com POST em
// .../images (cor nova) ou PATCH .../images/[colorImageId] com action
// 'completar' (cor que já existia como incompleta).
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin.from('catalog_products').select('id').eq('id', productId).maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const contentType = typeof body?.contentType === 'string' ? body.contentType : '';
  const size = typeof body?.size === 'number' ? body.size : NaN;
  const ext = EXT_BY_MIME[contentType];
  if (!ext) return NextResponse.json({ message: 'Formato não suportado. Envie JPG, PNG ou WEBP.' }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ message: 'A foto deve ter até 15MB.' }, { status: 400 });
  }

  const path = `${productId}/${Date.now()}.${ext}`;
  const { data: signed, error } = await auth.admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !signed) {
    console.error('catalog_product_photo_sign_failed', { message: error?.message });
    return NextResponse.json({ message: 'Não foi possível preparar o envio da foto.' }, { status: 500 });
  }

  return NextResponse.json({ path: signed.path, token: signed.token });
}
