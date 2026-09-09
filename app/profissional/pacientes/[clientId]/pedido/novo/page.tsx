import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';

export default async function NewOrderPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!isSupabaseConfigured()) redirect('/entrar');

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('professional_profiles').select('status').eq('user_id', user.id).maybeSingle();
  if (!profile || profile.status !== 'approved') redirect('/profissional');

  const { data: assignment } = await admin
    .from('professional_client_assignments')
    .select('client_id, organization_id')
    .eq('professional_user_id', user.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (!assignment) redirect('/profissional/pacientes');

  // Reaproveita um atendimento em andamento deste paciente com este profissional,
  // em vez de criar um pedido novo a cada clique/atualização de página.
  const { data: existingOrder } = await admin
    .from('orders')
    .select('id')
    .eq('client_id', clientId)
    .eq('professional_id', user.id)
    .eq('status', 'in_progress')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingOrder) redirect(`/profissional/pacientes/${clientId}/pedido/${existingOrder.id}`);

  const { data: orderNumber, error: sequenceError } = await supabase.rpc('next_order_number', { org_id: assignment.organization_id });
  if (sequenceError || orderNumber == null) {
    console.error('order_number_generation_failed', { code: sequenceError?.code });
    redirect('/profissional/pacientes');
  }

  const { data: order, error: orderError } = await admin.from('orders').insert({
    organization_id: assignment.organization_id,
    client_id: clientId,
    order_number: orderNumber,
    professional_id: user.id,
    status: 'in_progress',
    total: 0
  }).select('id').single();
  if (orderError || !order) {
    console.error('order_create_failed', { code: orderError?.code });
    redirect('/profissional/pacientes');
  }

  redirect(`/profissional/pacientes/${clientId}/pedido/${order!.id}`);
}
