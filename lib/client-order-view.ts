export function patientMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function patientPayment(ful: Record<string, unknown> | null, quoteTotal: number | null) {
  return {
    total: patientMoney(ful?.payment_value) ?? quoteTotal,
    down: patientMoney(ful?.payment_down_value),
    pickup: patientMoney(ful?.payment_pickup_value),
    confirmed: Boolean(ful?.payment_confirmed_at)
  };
}

export function patientTracking(status: string, ful: Record<string, unknown> | null, hasRx: boolean, hasChoices: boolean) {
  const delivered = status === 'delivered' || Boolean(ful?.delivered_at);
  const ready = delivered || status === 'ready' || ful?.assembly_status === 'concluida';
  const production = ready || status === 'in_production';
  const confirmed = production || status === 'approved' || (Boolean(ful?.comanda_confirmed_at) && Boolean(ful?.payment_confirmed_at));
  return [
    { label: 'Atendimento iniciado', hint: 'Cadastro e prescrição vinculados ao pedido.', done: hasRx || confirmed || hasChoices },
    { label: 'Escolhas do pedido', hint: 'Lente e armação selecionadas.', done: hasChoices || confirmed },
    { label: 'Pedido confirmado', hint: 'Escolhas e condições de pagamento confirmadas.', done: confirmed },
    { label: 'Preparação das lentes e armação', hint: 'Preparação e envio para montagem.', done: ready || (ful?.lens_production_status === 'pronta' && ful?.frame_production_status === 'confirmado_fornecedor') },
    { label: 'Montagem e conferência', hint: 'Conferência final dos seus óculos.', done: ready },
    { label: 'Pronto para entrega', hint: 'Combine a retirada ou o envio com seu profissional.', done: ready },
    { label: 'Entregue', hint: 'Entrega dos óculos registrada.', done: delivered }
  ];
}
