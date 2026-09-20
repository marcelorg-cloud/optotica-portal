import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { findOrCreateColorRegistryEntry } from '@/lib/catalog/color-registry';
import { isValidColor } from '@/lib/catalog/sku-standard';

type Context = { params: Promise<{ productId: string; colorImageId: string }> };

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const { data, error } = await auth.admin.from('catalog_color_registry')
    .select('id, color_number, color_principal, color_secondary, note').order('color_number');
  if (error) return NextResponse.json({ message: 'Não foi possível carregar as cores.' }, { status: 500 });
  return NextResponse.json({ colors: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request, { params }: Context) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  }
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const { productId, colorImageId } = await params;
  const { data: current, error: readError } = await auth.admin.from('catalog_product_color_images')
    .select('id, color_registry_id').eq('id', colorImageId).eq('product_id', productId).maybeSingle();
  if (readError) return NextResponse.json({ message: 'Não foi possível consultar a cor.' }, { status: 500 });
  if (!current) return NextResponse.json({ message: 'Cor não encontrada neste produto.' }, { status: 404 });
  const body = await request.json().catch(() => null);
  let entry;
  if (typeof body?.registryId === 'string') {
    const { data, error } = await auth.admin.from('catalog_color_registry')
      .select('id, color_number, color_principal, color_secondary, note').eq('id', body.registryId).maybeSingle();
    if (error || !data) return NextResponse.json({ message: 'Escolha uma cor válida.' }, { status: 400 });
    entry = { id: data.id, colorNumber: data.color_number, colorPrincipal: data.color_principal, colorSecondary: data.color_secondary, note: data.note };
  } else {
    const principal = typeof body?.colorPrincipal === 'string' ? body.colorPrincipal.trim() : '';
    const secondary = typeof body?.colorSecondary === 'string' ? body.colorSecondary.trim() : '';
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (!isValidColor(principal) || (secondary && !isValidColor(secondary)) || note.length > 60) {
      return NextResponse.json({ message: 'Confira a cor principal, secundária e a observação (até 60 caracteres).' }, { status: 400 });
    }
    const result = await findOrCreateColorRegistryEntry(auth.admin, principal, secondary || null, note || null);
    if (!result.ok) return NextResponse.json({ message: result.message }, { status: 500 });
    entry = result.entry;
  }
  // Keep the internal color_name stable: existing orders and photo references use it.
  // Display labels and variant SKU are derived from the registry number and colors.
  let update = auth.admin.from('catalog_product_color_images').update({
    color_registry_id: entry.id, color_variant_number: entry.colorNumber,
    color_principal: entry.colorPrincipal, color_secondary: entry.colorSecondary,
    color_note: entry.note, updated_at: new Date().toISOString()
  }).eq('id', colorImageId).eq('product_id', productId);
  update = current.color_registry_id ? update.eq('color_registry_id', current.color_registry_id) : update.is('color_registry_id', null);
  const { data, error } = await update.select('id').maybeSingle();
  if (error) return NextResponse.json({ message: error.code === '23505' ? 'Este produto já possui essa cor. Escolha outra opção.' : 'Não foi possível trocar a cor.' }, { status: error.code === '23505' ? 409 : 500 });
  if (!data) return NextResponse.json({ message: 'A cor foi alterada em outra sessão. Atualize a página.' }, { status: 409 });
  return NextResponse.json({ message: 'Cor atualizada. As fotos foram preservadas.' });
}
