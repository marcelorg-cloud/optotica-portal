import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentVerification, publicVerificationDocument } from '../lib/public-verification.ts';

const profile = { status: 'approved', display_name: 'Profissional de exemplo', council_registration: 'REG 123' };
const review = {
  id: 'request-id', status: 'verified', professional_name: profile.display_name, registration: 'REG 123', valid_until: '2026-12-31',
  public_documents_consent_at: '2026-09-17T12:00:00Z', public_documents_checked: true,
  public_documents: { diploma: { path: 'profile-id/request-id/public-diploma-01234567-abcd.pdf', sha256: 'a'.repeat(64) }, registration: { path: 'profile-id/request-id/public-registration-01234567-abcd.pdf', sha256: 'b'.repeat(64) } },
};
test('shows verification only for approved profiles with matching and current evidence', () => {
  assert.equal(isCurrentVerification(profile, review, '2026-09-17'), true);
  for (const status of ['under_review', 'changes_requested', 'revoked']) assert.equal(isCurrentVerification(profile, {...review,status}, '2026-09-17'), false);
  assert.equal(isCurrentVerification({...profile,status:'under_review'}, review, '2026-09-17'), false);
  assert.equal(isCurrentVerification(profile, {...review,valid_until:'2026-09-16'}, '2026-09-17'), false);
  assert.equal(isCurrentVerification(profile, {...review,registration:'OTHER'}, '2026-09-17'), false);
  assert.equal(isCurrentVerification(profile, {...review,professional_name:'Another professional'}, '2026-09-17'), false);
  assert.equal(isCurrentVerification(profile, null, '2026-09-17'), false);
});
test('only the two approved public copies are eligible for download', () => {
  assert.equal(publicVerificationDocument('profile-id',review,'diploma')?.path, review.public_documents.diploma.path);
  assert.equal(publicVerificationDocument('profile-id',review,'registration')?.path, review.public_documents.registration.path);
  for (const kind of ['declaration','agreement','attestation','../diploma','public_diploma']) assert.equal(publicVerificationDocument('profile-id',review,kind),null);
});
test('public access requires consent and explicit review of public copies', () => {
  assert.equal(publicVerificationDocument('profile-id',{...review,public_documents_consent_at:null},'diploma'),null);
  assert.equal(publicVerificationDocument('profile-id',{...review,public_documents_checked:false},'diploma'),null);
  assert.equal(publicVerificationDocument('profile-id',{...review,public_documents:{}},'diploma'),null);
});
test('rejects original files, paths from another profile and malformed hashes', () => {
  for (const path of ['profile-id/request-id/diploma.pdf','other/request-id/public-diploma-0123.pdf','profile-id/request-id/public-diploma-../../declaration.pdf']) {
    assert.equal(publicVerificationDocument('profile-id',{...review,public_documents:{diploma:{...review.public_documents.diploma,path}}},'diploma'),null);
  }
  assert.equal(publicVerificationDocument('profile-id',{...review,public_documents:{diploma:{...review.public_documents.diploma,sha256:'invalid'}}},'diploma'),null);
});
