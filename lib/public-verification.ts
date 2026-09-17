export type VerificationProfile = { status: string; display_name: string; council_registration: string | null };
export type VerificationReview = {
  id: string; status: string; professional_name: string; registration: string;
  valid_until: string | null; public_documents_consent_at?: string | null;
  public_documents_checked?: boolean;
  public_documents?: Record<string, { path: string; sha256: string }> | null;
};
export function isCurrentVerification(profile: VerificationProfile | null, review: VerificationReview | null, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(profile?.status === 'approved' && review?.status === 'verified' && review.valid_until && review.valid_until >= today && review.professional_name === profile.display_name && review.registration === (profile.council_registration || ''));
}
export function publicVerificationDocument(profileId: string, review: VerificationReview, kind: string) {
  if (!['diploma', 'registration'].includes(kind) || !review.public_documents_consent_at || !review.public_documents_checked) return null;
  const document = review.public_documents?.[kind];
  const prefix = `${profileId}/${review.id}/public-${kind}-`;
  if (!document || !document.path.startsWith(prefix) || !/^[a-f0-9-]+\.pdf$/.test(document.path.slice(prefix.length)) || !/^[a-f0-9]{64}$/.test(document.sha256)) return null;
  return document;
}
