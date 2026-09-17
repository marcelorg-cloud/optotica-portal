export type EyePrescription = { esferico: number; cilindrico: number; eixo: number; adicao: number };

/** Accepted ranges for both prescription creation and subsequent edits. */
export function parsePrescriptionEye(value: unknown): EyePrescription | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const fields = ['esferico', 'cilindrico', 'eixo', 'adicao'] as const;
  if (fields.some(key => !['number', 'string'].includes(typeof input[key]) || String(input[key]).trim() === '')) return null;
  const esferico = Number(input.esferico);
  const cilindrico = Number(input.cilindrico);
  const eixo = Number(input.eixo);
  const adicao = Number(input.adicao);
  if ([esferico, cilindrico, eixo, adicao].some(n => !Number.isFinite(n))) return null;
  if (esferico < -30 || esferico > 30) return null;
  if (cilindrico < -30 || cilindrico > 0) return null;
  if (eixo < 0 || eixo > 180) return null;
  if (adicao < 0 || adicao > 6) return null;
  return { esferico, cilindrico, eixo, adicao };
}
