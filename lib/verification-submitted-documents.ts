/** Only the two credentials explicitly reviewed by the master may be copied for publication. */
export function submittedPublicDocument(profileId: string, requestId: string, documents: unknown, kind: string) {
  if (!['diploma', 'registration'].includes(kind) || !documents || typeof documents !== 'object') return null;
  const document = (documents as Record<string, unknown>)[kind];
  if (!document || typeof document !== 'object') return null;
  const { path, sha256 } = document as Record<string, unknown>;
  if (path !== `${profileId}/${requestId}/${kind}.pdf` || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return { path, sha256 };
}
