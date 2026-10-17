import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_SCORE_DRAFT, validateGeneralScore, extractInstrumentalPart,
  ORGANIZER_INSTRUMENTAL_PARTS, NETWORK_INSTRUMENTAL_PARTS,
} from "../lib/general-score.ts";

function approvedFixture() {
  const score=structuredClone(GENERAL_SCORE_DRAFT);
  score.status="approved";
  score.rules=score.rules.map(rule=>({...rule,status:"approved"}));
  score.works=score.works.map(work=>({...work,status:"approved"}));
  return score;
}

test("one general score describes eight coordinators and network agents",()=>{
  assert.equal(validateGeneralScore(GENERAL_SCORE_DRAFT),true);
  assert.equal(ORGANIZER_INSTRUMENTAL_PARTS.length,8);
  assert.equal(NETWORK_INSTRUMENTAL_PARTS.length,5);
  assert.equal(GENERAL_SCORE_DRAFT.status,"draft");
  const ids=GENERAL_SCORE_DRAFT.instruments.map(x=>x.id);
  assert.deepEqual(ids.filter(x=>/^F\d+$/.test(x)).sort(),Array.from({length:14},(_,i)=>"F"+(i+1)).sort());
});

test("unapproved general score never becomes binding instructions",()=>{
  const extracted=extractInstrumentalPart(GENERAL_SCORE_DRAFT,"spalla","public");
  assert.equal(extracted.validity,"draft_review_only");
  assert.deepEqual(extracted.inheritedRules,[]);
  assert.deepEqual(extracted.works,[]);
  assert.equal(extracted.executionAuthority,false);
});

test("a single approved score deterministically inherits the same mandatory rules for different actors",()=>{
  const score=approvedFixture();
  const spalla=extractInstrumentalPart(score,"spalla","public");
  const regente=extractInstrumentalPart(score,"regente","public");
  const executor=extractInstrumentalPart(score,"A1","public");
  assert.equal(spalla.validity,"canonical");
  assert.deepEqual(spalla.inheritedRules,regente.inheritedRules);
  assert.deepEqual(executor.inheritedRules,regente.inheritedRules);
  assert.equal(spalla.actor.plane,"coordination");
  assert.equal(executor.actor.plane,"network");
  assert.notDeepEqual(spalla.responsibilities,executor.responsibilities);
  assert.equal(spalla.source.version,score.version);
});

test("unapproved mandatory rule prevents canonization",()=>{
  const score=approvedFixture();
  score.rules[0].status="draft";
  assert.throws(()=>extractInstrumentalPart(score,"regente"),/unapproved_mandatory_rule/);
});

test("instrument registry is advisory and never proves live adapters",()=>{
  const result=extractInstrumentalPart(approvedFixture(),"orquestrador","public");
  assert.ok(result.instrumentRegistry.every(item=>item.operational===false));
  assert.equal(result.instrumentRegistry.find(x=>x.id==="F9").declaredAdapter,"not_verified");
});

test("restricted records never pass to an actor with insufficient access",()=>{
  const score=approvedFixture();
  score.works.push({id:"restricted",name:"Private",purpose:"N/A",audience:["spalla"],dataClass:"restricted",status:"approved",sourceId:"test"});
  assert.throws(()=>extractInstrumentalPart(score,"spalla","restricted"),/knowledge_access_denied/);
  const visible=extractInstrumentalPart(score,"spalla","internal_redacted");
  assert.ok(!visible.works.some(x=>x.id==="restricted"));
});

test("different actor-specific documents never acquire more knowledge than their classification",()=>{
  const score=approvedFixture();
  score.works.push({id:"internal_doc",name:"Internal",purpose:"Plan",audience:["spalla"],dataClass:"internal_redacted",status:"approved",sourceId:"test:2"});
  assert.ok(!extractInstrumentalPart(score,"spalla","public").works.some(x=>x.id==="internal_doc"));
  assert.ok(extractInstrumentalPart(score,"spalla","internal_redacted").works.some(x=>x.id==="internal_doc"));
  assert.ok(!extractInstrumentalPart(score,"A1","internal_redacted").works.some(x=>x.id==="internal_doc"));
});

test("duplicate actor identifiers and unknown actors fail closed",()=>{
  const score=approvedFixture();
  score.actors.push({...score.actors[0]});
  assert.throws(()=>validateGeneralScore(score),/duplicate_score_id/);
  assert.throws(()=>extractInstrumentalPart(approvedFixture(),"unknown"),/actor_not_in_general_score/);
});
