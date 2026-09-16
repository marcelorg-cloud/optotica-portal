type TryonSource = {
  dnp_od?: number | string | null;
  dnp_oe?: number | string | null;
  dnp_measured_at?: string | null;
  tryon_face_validated_at?: string | null;
};

// Stable across URL signing/refreshes, changes on every stage-1 save or
// official photo replacement. Version the actual file, not only its URL.
export function tryonRevision(source: TryonSource | null): string {
  return [
    'v2', source?.dnp_od ?? 'none', source?.dnp_oe ?? 'none',
    source?.dnp_measured_at ? Date.parse(source.dnp_measured_at) : 0,
    source?.tryon_face_validated_at ? Date.parse(source.tryon_face_validated_at) : 0
  ].join('-');
}

export function isCurrentTryon(path: string | null, revision: string): boolean {
  return Boolean(path?.endsWith(`-${revision}.png`));
}
