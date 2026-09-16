import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOrigin, verificationActor } from '@/lib/verification-auth';
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const actor = await verificationActor();
  if (!actor) return NextResponse.json({ message: 'Faça login.' }, { status: 401 });
  if (actor.profile?.status !== 'approved' || actor.profile.account_type !== 'professional') return NextResponse.json({ message: 'A emissão exige cadastro de profissional individual aprovado.' }, { status: 403 });
  const { orderId } = await params;
  const { data: order } = await actor.admin.from('orders').select('id').eq('id', orderId).eq('professional_id', actor.user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Atendimento não encontrado.' }, { status: 404 });
  const { data, error } = await actor.admin.rpc('issue_optical_prescription', { target_order: orderId, actor_id: actor.user.id, new_code: randomBytes(32).toString('hex') });
  if (error) return NextResponse.json({ message: 'Não foi possível emitir. Salve a receita completa e confirme que o atendimento não está cancelado.' }, { status: 409 });
  return NextResponse.json({ url: `/prescricao/${data}`, message: 'Prescrição emitida.' });
}
