import assert from 'node:assert/strict';
import test from 'node:test';
import { submittedPublicDocument } from '../lib/verification-submitted-documents.ts';

const documents = {
  diploma: { path: 'profile/request/diploma.pdf', sha256: 'a'.repeat(64) },
  registration: { path: 'profile/request/registration.pdf', sha256: 'b'.repeat(64) },
  declaration: { path: 'profile/request/declaration.pdf', sha256: 'c'.repeat(64) },
};
test('reuses only credentials from the same immutable submission', () => {
  for (const kind of ['diploma', 'registration']) assert.deepEqual(submittedPublicDocument('profile', 'request', documents, kind), documents[kind]);
  for (const kind of ['declaration', 'agreement', 'attestation', '../diploma']) assert.equal(submittedPublicDocument('profile', 'request', documents, kind), null);
});
test('refuses another professional or submission and malformed stored evidence', () => {
  assert.equal(submittedPublicDocument('other', 'request', documents, 'diploma'), null);
  assert.equal(submittedPublicDocument('profile', 'other', documents, 'diploma'), null);
  for (const data of [null, {}, {diploma:'not a document'}, {diploma:{...documents.diploma,sha256:'invalid'}}, {diploma:{...documents.diploma,path:'profile/request/../../diploma.pdf'}}]) {
    assert.equal(submittedPublicDocument('profile', 'request', data, 'diploma'), null);
  }
});
