export function prescriptionNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const normalized = String(input).trim().replace(',', '.');
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function formatDiopter(input: unknown) {
  const number = prescriptionNumber(input);
  return number === null ? '' : number.toFixed(2);
}

export function formatAxis(input: unknown) {
  const number = prescriptionNumber(input);
  return number === null ? '' : `${number}°`;
}

export function stepPrescriptionNumber(input: unknown, direction: 1 | -1, step: number, min: number, max: number) {
  const current = prescriptionNumber(input) ?? 0;
  const nextStep = direction > 0 ? Math.floor(current / step) + 1 : Math.ceil(current / step) - 1;
  return Math.min(max, Math.max(min, nextStep * step));
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
