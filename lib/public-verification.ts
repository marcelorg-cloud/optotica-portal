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
export function verificationPresentation(profile: VerificationProfile | null, review: VerificationReview | null, today = new Date().toISOString().slice(0, 10)) {
  if (isCurrentVerification(profile, review, today)) return { tone: 'verified', label: 'Profissional verificado', description: 'Aprovação documental registrada. O selo está disponível na consulta pelo QR Code das prescrições.' };
  if (!review) return { tone: 'pending', label: 'Documentação não enviada', description: 'Envie os documentos na aba Verificação para solicitar a conferência.' };
  if (review.status === 'under_review') return { tone: 'pending', label: 'Aguardando aprovação documental', description: 'Os documentos foram recebidos. A decisão da conferência ainda precisa ser registrada no master.' };
  if (review.status === 'changes_requested') return { tone: 'pending', label: 'Ajustes documentais solicitados', description: 'Consulte o retorno da equipe e envie a documentação corrigida.' };
  if (review.status === 'revoked') return { tone: 'pending', label: 'Verificação revogada', description: 'O selo está indisponível. Consulte o motivo informado pela equipe.' };
  if (profile?.status !== 'approved') return { tone: 'pending', label: 'Verificação indisponível', description: 'O cadastro profissional precisa estar aprovado e ativo para exibir o selo.' };
  if (!review.valid_until || review.valid_until < today) return { tone: 'pending', label: 'Verificação vencida', description: 'Envie a documentação para uma nova conferência e renovação do selo.' };
  return { tone: 'pending', label: 'Verificação precisa de atualização', description: 'O nome ou registro atual difere dos dados conferidos. Envie a documentação atualizada para análise.' };
}
export function publicVerificationDocument(profileId: string, review: VerificationReview, kind: string) {
  if (!['diploma', 'registration'].includes(kind) || !review.public_documents_consent_at || !review.public_documents_checked) return null;
  const document = review.public_documents?.[kind];
  const prefix = `${profileId}/${review.id}/public-${kind}-`;
  if (!document || !document.path.startsWith(prefix) || !/^[a-f0-9-]+\.pdf$/.test(document.path.slice(prefix.length)) || !/^[a-f0-9]{64}$/.test(document.sha256)) return null;
  return document;
}
