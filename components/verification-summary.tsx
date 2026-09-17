import { verificationPresentation, type VerificationProfile, type VerificationReview } from '@/lib/public-verification';

export function VerificationSummary({ profile, review }: { profile: VerificationProfile; review: VerificationReview | null }) {
  const state = verificationPresentation(profile, review);
  return <div className={`verification-summary is-${state.tone}`}>
    <strong>{state.label}</strong>
    <p>{state.description}</p>
  </div>;
}
