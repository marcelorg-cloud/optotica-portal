import test from "node:test";
import assert from "node:assert/strict";
import {
  RESOLUTION_LIBRARY_VERSION, RESOLUTION_CATALOGUE, suggestResolutionCases,
} from "../lib/resolution-library.ts";

test("catalogue is a versioned advisory library with unique case identifiers",()=>{
  assert.equal(RESOLUTION_LIBRARY_VERSION,"0.1.0");
  assert.equal(RESOLUTION_CATALOGUE.length,10);
  assert.equal(new Set(RESOLUTION_CATALOGUE.map(x=>x.id)).size,10);
  for (const entry of RESOLUTION_CATALOGUE) {
    assert.equal(entry.status,"proposal");
    assert.ok(entry.requiredEvidence.length);
    assert.ok(entry.forbids.length);
  }
});

test("deterministic retrieval preserves proposal status; it is not an execution",()=>{
  const r=suggestResolutionCases({kind:"adapter_unavailable",evidenceRefs:["run:sample"],dataClass:"public"});
  assert.equal(r.status,"guidance_only");
  assert.equal(r.matches[0].id,"BR-001");
  assert.equal(r.matches[0].status,"proposal");
  assert.equal(r.matches[0].requiresHumanDecision,true);
});

test("unknown or unsupported kind is not fabricated as a verified solution",()=>{
  const r=suggestResolutionCases({kind:"not_in_library",evidenceRefs:[],dataClass:"public"});
  assert.equal(r.status,"unknown_blocker");
  assert.equal(r.matches.length,0);
});

test("restricted contexts return no cases to downstream agents",()=>{
  const r=suggestResolutionCases({kind:"sensitive_context",evidenceRefs:["private:example"],dataClass:"restricted"});
  assert.equal(r.status,"restricted_context");
  assert.equal(r.matches.length,0);
});

test("inconsistent source references are rejected rather than interpolated",()=>{
  assert.throws(()=>suggestResolutionCases({kind:"source_conflict",evidenceRefs:["x".repeat(170)],dataClass:"public"}),/invalid_evidence_references/);
});

test("cases explicitly forbid bypassing safety and fake outcomes",()=>{
  assert.ok(RESOLUTION_CATALOGUE.find(x=>x.id==="BR-003").forbids.some(x=>x.includes("Repetir")));
  assert.ok(RESOLUTION_CATALOGUE.find(x=>x.id==="BR-009").forbids.some(x=>x.includes("deferred")));
});
