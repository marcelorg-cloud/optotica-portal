/**
 * Normaliza números de WhatsApp para um formato canônico E.164, tratando a particularidade
 * brasileira do "9" extra no celular: a Meta ora reporta o `from` de uma mensagem recebida
 * com o número completo (DDD + 9 dígitos), ora sem o "9" extra (formato que a própria Meta usa
 * internamente para números brasileiros no WhatsApp Manager). Sem essa normalização, comparar
 * o número esperado de um convite (digitado pelo profissional) com o número que efetivamente
 * mandou a mensagem pode falhar mesmo quando é a mesma pessoa/linha.
 *
 * Forma canônica adotada aqui: sempre sem o "9" extra (12 dígitos após o "+" para BR:
 * 55 + DDD(2) + 8 dígitos). Isso não afeta o envio de mensagens (a Meta aceita e resolve os
 * dois formatos), é só a chave usada internamente para comparação/armazenamento.
 */
export function toCanonicalWhatsAppE164(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  // Número local brasileiro sem código do país (10 dígitos = DDD + 8, ou 11 = DDD + 9 + 8).
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }

  // BR com código do país e o "9" extra do celular (55 + DDD + 9 + 8 dígitos = 13 dígitos).
  if (digits.startsWith('55') && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    if (subscriber.length === 9 && subscriber[0] === '9') {
      digits = `55${ddd}${subscriber.slice(1)}`;
    }
  }

  return `+${digits}`;
}
