export function prescriptionNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const normalized = String(input).trim().replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function formatSignedSphere(input: unknown, decimalSeparator: '.' | ',' = '.') {
  const number = prescriptionNumber(input);
  if (number === null) return '';
  const formatted = number.toFixed(2).replace('.', decimalSeparator);
  return `${number >= 0 ? '+' : ''}${formatted}`;
}

export function normalizePrescriptionNumber(input: FormDataEntryValue | null) {
  const number = prescriptionNumber(input);
  return number === null ? input : String(number);
}
