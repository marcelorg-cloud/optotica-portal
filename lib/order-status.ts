// Central de status de `orders` (16/09/2026, correção da listagem de
// pedidos). Antes deste ajuste, o código deste projeto só conhecia
// 'in_progress' e 'delivered' (era o único valor "final" observado em
// comentários anteriores). Uma consulta direta à constraint do banco
// (orders_status_check, tabela pré-existente, fora do histórico de
// migrations rastreado) revelou uma lista bem maior:
//
//   in_progress | awaiting_quote | awaiting_choice | approved |
//   in_production | ready | delivered | cancelled
//
// Nenhum outro valor além de 'in_progress' (padrão na criação) e 'delivered'
// (setado só na Etapa 10 "Entrega", ver fulfillment/route.ts) é gravado por
// este app hoje — os demais (awaiting_quote/awaiting_choice/approved/
// in_production/ready) parecem reservados para um fluxo mais granular que
// esta aplicação Next.js não implementa. Mas como a constraint do banco
// permite qualquer um desses valores, e um pedido pode em tese existir com
// um deles (dado legado, script externo, etc.), o critério de "pedido
// finalizado" (etapas 6-10 travadas, tela só para consulta) NÃO pode ser
// simplesmente "status !== 'in_progress'" — isso trataria erroneamente
// 'awaiting_quote'/'approved'/'in_production'/etc. (que são estados
// intermediários de um atendimento ainda em andamento) como finalizados.
// Os únicos dois valores realmente terminais da lista são 'delivered'
// (entregue com sucesso) e 'cancelled' (encerrado sem entrega) — por isso
// `isOrderFinalized` trava só nesses dois.
export const ORDER_STATUS_LABEL: Record<string, string> = {
  in_progress: 'Em progresso',
  awaiting_quote: 'Aguardando orçamento',
  awaiting_choice: 'Aguardando escolha',
  approved: 'Aprovado',
  in_production: 'Em produção',
  ready: 'Pronto',
  delivered: 'Finalizado',
  cancelled: 'Cancelado'
};

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);

export function isOrderFinalized(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] || status;
}
