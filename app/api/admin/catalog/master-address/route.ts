import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Endereço de entrega padrão (fallback quando o atendimento não tem
// laboratório vinculado) — catalog_master_address é singleton (id boolean,
// migração 202609110020). GET nunca dá 404: devolve null quando ainda não
// foi cadastrado, para a tela mostrar o formulário vazio em vez de erro.

const clean = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data } = await auth.admin.from('catalog_master_address').select('*').eq('id', true).maybeSingle();
  return NextResponse.json({ address: data || null });
}

export async function PATCH(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const contactName = clean(body?.contactName, 140);
  const addressLine = clean(body?.addressLine, 200);
  const addressNumber = clean(body?.addressNumber, 20) || null;
  const addressComplement = clean(body?.addressComplement, 100) || null;
  const district = clean(body?.district, 100) || null;
  const city = clean(body?.city, 100);
  const state = clean(body?.state, 2).toUpperCase();
  const postalCode = clean(body?.postalCode, 9);
  const phoneE164 = clean(body?.phoneE164, 20);

  if (!contactName || !addressLine || !city || !state || !postalCode || !phoneE164) {
    return NextResponse.json({ message: 'Preencha nome de contato, endereço, cidade, estado, CEP e telefone.' }, { status: 400 });
  }

  const { error } = await auth.admin
    .from('catalog_master_address')
    .upsert({
      id: true,
      contact_name: contactName,
      address_line: addressLine,
      address_number: addressNumber,
      address_complement: addressComplement,
      district,
      city,
      state,
      postal_code: postalCode,
      phone_e164: phoneE164,
      updated_at: new Date().toISOString()
    });
  if (error) return NextResponse.json({ message: 'Não foi possível salvar o endereço.' }, { status: 500 });

  return NextResponse.json({ message: 'Endereço salvo.' });
}
