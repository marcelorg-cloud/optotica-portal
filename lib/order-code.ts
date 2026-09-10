// Código de identificação do pedido mostrado nas telas, no formato
// "<iniciais do paciente>-<número>" (ex.: primeiro atendimento do Walter
// Goraieb vira "WG-101", o segundo "WG-102"). Só formatação de exibição —
// o `order_number` continua sendo gravado normalmente a partir de 1 (a lógica
// de numeração por paciente e as constraints de unicidade no banco, seções
// 013/014, não mudam nada aqui). Pedido explícito do usuário: como a
// numeração por paciente faz o mesmo número se repetir entre pacientes
// diferentes (ex.: dois "#1" de pacientes distintos), as iniciais deixam claro
// de qual paciente é o pedido, sem precisar mudar a contagem em si.
export function orderCode(clientFullName: string, orderNumber: number): string {
  return `${clientInitials(clientFullName)}-${100 + orderNumber}`;
}

function clientInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PC';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
}
