import test from "node:test";
import assert from "node:assert/strict";
import {
  GOVERNANCE_VERSION, COORDINATION_EVENT_KINDS, reviewPeerMessage, evaluateDissonance,
} from "../lib/cooperative-governance.ts";

const context = {
  missionId:"mission-01",
  generalScoreVersion:"0.4.0",
  missionScoreVersion:"mission-score-v1",
  authorizedActors:["regente","spalla","orquestrador","auditor_harmonia"],
  readableDataClasses:["public","internal_redacted"],
};
const proposal = (extra={})=>({
  eventId:"event-01",missionId:"mission-01",actor:"spalla",
  generalScoreVersion:"0.4.0",missionScoreVersion:"mission-score-v1",
  kind:"readiness",topic:"Conferir ligação",evidenceRefs:["health:sample"],
  proposedAction:"Testar capacidade com leitura",affectedTaskIds:["task-1"],
  dataClass:"public",operation:"coordinate",...extra,
});
const dissent=(extra={})=>({
  actor:"orquestrador",missionId:"mission-01",
  generalScoreVersion:"0.4.0",missionScoreVersion:"mission-score-v1",
  kind:"creative",reason:"Uma rota equivalente precisa de ensaio.",
  evidenceRefs:["score:sample"],...extra,
});

test("governance contract enumerates typed event kinds and version",()=>{
  assert.equal(GOVERNANCE_VERSION,"0.1.0");
  assert.equal(COORDINATION_EVENT_KINDS.length,8);
});

test("coordination remains advice and grants no execution authority",()=>{
  const outcome=reviewPeerMessage(proposal(),context);
  assert.equal(outcome.status,"coordination_advisory");
  assert.equal(outcome.executable,false);
  assert.equal(outcome.evidenceOnly,true);
});

test("external effect and institutional change require human and runtime gate",()=>{
  for (const operation of ["external_effect","institutional_change"]) {
    const r=reviewPeerMessage(proposal({operation}),context);
    assert.equal(r.status,"requires_human_and_runtime_gate");
    assert.equal(r.requiresHumanApproval,true);
    assert.equal(r.executable,false);
  }
});

test("mismatched institution or mission score blocks peer collaboration",()=>{
  assert.equal(reviewPeerMessage(proposal({generalScoreVersion:"0.3.0"}),context).status,"blocked_context");
  assert.equal(reviewPeerMessage(proposal({missionScoreVersion:"old"}),context).status,"blocked_context");
  assert.equal(reviewPeerMessage(proposal({missionId:"other"}),context).status,"blocked_context");
});

test("peer lacking authorization cannot participate based on role alone",()=>{
  assert.equal(reviewPeerMessage(proposal({actor:"compositor"}),context).status,"blocked_context");
  assert.equal(reviewPeerMessage(proposal({actor:"imaginary"}),context).status,"blocked_context");
});

test("restricted contexts never enter peer coordination",()=>{
  assert.equal(reviewPeerMessage(proposal({dataClass:"restricted"}),context).status,"blocked_data_access");
  const publicOnly={...context,readableDataClasses:["public"]};
  assert.equal(reviewPeerMessage(proposal({dataClass:"internal_redacted"}),publicOnly).status,"blocked_data_access");
});

test("a model report without evidence cannot claim a verified basis",()=>{
  assert.equal(reviewPeerMessage(proposal({evidenceRefs:[]}),context).status,"needs_evidence");
});

test("unbounded or ill-formed message is rejected",()=>{
  assert.equal(reviewPeerMessage(proposal({kind:"invalid"}),context).status,"invalid_message");
  assert.equal(reviewPeerMessage(proposal({evidenceRefs:["x".repeat(260)]}),context).status,"invalid_message");
});

test("no dissent is not equivalent to proof of agreement",()=>{
  const r=evaluateDissonance([],context);
  assert.equal(r.state,"not_assessed");
  assert.equal(r.grantsExecution,false);
});

test("creative disagreement is preserved instead of voted away",()=>{
  const r=evaluateDissonance([dissent(),dissent({actor:"regente",reason:"Manter o arranjo atual."})],context);
  assert.equal(r.state,"productive_dissonance");
  assert.equal(r.unresolved.length,2);
  assert.equal(r.grantsExecution,false);
});

test("safety dissent blocks the affected decision",()=>{
  const r=evaluateDissonance([dissent({kind:"safety",reason:"Permissão não confirmada."})],context);
  assert.equal(r.state,"safety_conflict");
  assert.equal(r.grantsExecution,false);
});

test("evidence, interface and uncertainty require investigation",()=>{
  for(const kind of ["evidence","integration","uncertain"]) {
    assert.equal(evaluateDissonance([dissent({kind})],context).state,"needs_investigation");
  }
});

test("dissent without evidence is not treated as verified discussion",()=>{
  assert.equal(evaluateDissonance([dissent({evidenceRefs:[]})],context).state,"needs_evidence");
});

test("different score version or unauthorized reviewer is rejected",()=>{
  assert.equal(evaluateDissonance([dissent({generalScoreVersion:"0.3.0"})],context).state,"blocked_context");
  assert.equal(evaluateDissonance([dissent({actor:"compositor"})],context).state,"blocked_context");
});
