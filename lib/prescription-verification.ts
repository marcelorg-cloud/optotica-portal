// Shared presentation helpers: never pass clinical or identity records to a public client.
export const verificationCodePattern = /^[a-f0-9]{64}$/;
export function maskPatientName(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).map(part => `${Array.from(part)[0]}***`).join(' ');
}
export function formatPrescriptionDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
}
export const documentKinds = {
  diploma: 'Diploma ou certificado de conclusão',
  registration: 'Comprovante de registro / regularidade',
  declaration: 'Declaração de veracidade assinada pelo gov.br',
  agreement: 'Contrato com a Optótica assinado'
} as const;
export const verificationStatusLabels: Record<string, string> = {
  under_review: 'Em análise documental', verified: 'Documentação verificada pela Optótica',
  changes_requested: 'Ajustes solicitados', revoked: 'Verificação revogada'
};
