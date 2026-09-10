import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { isValidCPF, onlyDigits } from '@/lib/br-documents';

function numberOrNull(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

// Data de nascimento em formato ISO (yyyy-mm-dd, o que o <input type="date">
// já envia) — undefined = inválida, null = em branco (permitido, o campo é
// opcional).
function dateOrNull(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() > Date.now()) return undefined;
  return value;
}

// CPF opcional — se vier em branco, gravamos null; se vier preenchido,
// validamos o dígito verificador antes de aceitar (mesma regra do CPF/CNPJ
// do cadastro profissional, lib/br-documents.ts).
function cpfOrNull(value: unknown) {
  const digits = onlyDigits(String(value ?? ''));
  if (!digits) return null;
  if (!isValidCPF(digits)) return undefined;
  return digits;
}

// DNP, data de nascimento e CPF são editáveis por aqui (etapa 1 do
// atendimento). Nome e WhatsApp do paciente não entram nesta rota: são a
// identidade do paciente no sistema (conta de acesso à área do paciente e
// roteamento de mensagens do WhatsApp), então continuam só leitura nesta
// tela — mudá-los aqui poderia gerar conflito com outro paciente ou
// desalinhar o contato usado para login.
export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const dnpOd = numberOrNull(body?.dnpOd, 10, 45);
  const dnpOe = numberOrNull(body?.dnpOe, 10, 45);
  if (dnpOd === undefined || dnpOe === undefined) {
    return NextResponse.json({ message: 'DNP inválida.' }, { status: 400 });
  }
  const birthDate = dateOrNull(body?.birthDate);
  if (birthDate === undefined) {
    return NextResponse.json({ message: 'Data de nascimento inválida.' }, { status: 400 });
  }
  const cpf = cpfOrNull(body?.cpf);
  if (cpf === undefined) {
    return NextResponse.json({ message: 'CPF inválido. Verifique o número informado.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, client_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, a etapa 1 (DNP + dados
  // adicionais do paciente) fica bloqueada junto com receita/orçamento/armação.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — os dados não podem mais ser alterados.' }, { status: 409 });
  }

  const { error } = await admin.from('clients').update({ dnp_od: dnpOd, dnp_oe: dnpOe, birth_date: birthDate, cpf }).eq('id', order.client_id);
  if (error) {
    console.error('client_update_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível salvar os dados.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Dados atualizados.' });
}
