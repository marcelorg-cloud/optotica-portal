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
  if (!profile || profile.status !== 'approved') {
    console.error('new_order_blocked_profile', { userId: user.id, profileStatus: profile?.status ?? null });
    redirect('/profissional');
  }

  const { data: assignment } = await admin
    .from('professional_client_assignments')
    .select('client_id, organization_id')
    .eq('professional_user_id', user.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (!assignment) {
    console.error('new_order_blocked_assignment', { userId: user.id, clientId });
    redirect('/profissional/pacientes');
  }

  // "Novo pedido" sempre cria um atendimento novo, independente de já existir algum
  // pendente ou encerrado para este paciente — reabrir um atendimento em andamento
  // é uma ação separada ("Continuar atendimento", na lista de pacientes), não deve
  // bloquear a criação de um novo.

  // Numeração por paciente (não por organização): o primeiro atendimento deste
  // paciente é #1, o segundo #2, e assim por diante — independente de quantos
  // atendimentos outros pacientes já tiveram. Poucas tentativas com o próximo
  // número cobrem a rara corrida de duas requisições simultâneas (a trava
  // consultiva dentro da função já evita a maioria dos casos; o índice único
  // em (client_id, order_number) garante que nunca duas fiquem com o mesmo
  // número mesmo assim).
  let createdOrder: { id: string } | null = null;
  for (let attempt = 0; attempt < 3 && !createdOrder; attempt++) {
    const { data: orderNumber, error: sequenceError } = await supabase.rpc('next_client_order_number', { target_client: clientId });
    if (sequenceError || orderNumber == null) {
      console.error('order_number_generation_failed', { code: sequenceError?.code, message: sequenceError?.message, clientId });
      redirect('/profissional/pacientes');
    }

    const { data: inserted, error: orderError } = await admin.from('orders').insert({
      organization_id: assignment.organization_id,
      client_id: clientId,
      order_number: orderNumber,
      professional_id: user.id,
      status: 'in_progress',
      total: 0
    }).select('id').single();

    if (!orderError && inserted) { createdOrder = inserted; break; }
    if (orderError?.code !== '23505') {
      console.error('order_create_failed', { code: orderError?.code, message: orderError?.message, clientId, orderNumber });
      redirect('/profissional/pacientes');
    }
    // 23505 = número duplicado por corrida rara — tenta de novo com o próximo número.
  }
  if (!createdOrder) {
    console.error('order_create_failed', { code: 'retries_exhausted', clientId });
    redirect('/profissional/pacientes');
  }

  redirect(`/profissional/pacientes/${clientId}/pedido/${createdOrder.id}`);
}
