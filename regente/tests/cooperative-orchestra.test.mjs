import test from "node:test";
import assert from "node:assert/strict";
import {
  COOPERATIVE_VERSION, COORDINATOR_ROLES, KNOWLEDGE_LAYERS,
  nextCoordinationWave, assessDetour, classifyHarmony,
} from "../lib/cooperative-orchestra.ts";

const work=(id, extra={})=>({
  id, description:id, dependsOn:[],state:"pending",priority:50,
  effect:"read",approved:false,optional:false,...extra,
});

test("foundation has independent organizational roles and six knowledge layers",()=>{
  assert.match(COOPERATIVE_VERSION,/^0\.8/);
  assert.equal(COORDINATOR_ROLES.length,8);
  assert.equal(new Set(COORDINATOR_ROLES.map(x=>x.id)).size,8);
  assert.deepEqual(KNOWLEDGE_LAYERS,["universal","instituto","obra","subprojeto","missao","execucao"]);
});

test("independent jobs can be scheduled concurrently",()=>{
  const wave=nextCoordinationWave([work("alpha"),work("beta"),work("gamma")],2);
  assert.deepEqual(wave.runnable,["alpha","beta"]);
  assert.equal(wave.requiresRuntimeAuthorization,true);
});

test("running tasks consume concurrency capacity",()=>{
  const wave=nextCoordinationWave([work("alpha",{state:"running"}),work("beta"),work("gamma")],2);
  assert.deepEqual(wave.runnable,["beta"]);
  assert.deepEqual(wave.running,["alpha"]);
});

test("dependencies must actually succeed and not merely defer",()=>{
  const wave=nextCoordinationWave([
    work("ref",{state:"deferred"}),work("child",{dependsOn:["ref"]}),
    work("unrelated"),
  ]);
  assert.deepEqual(wave.runnable,["unrelated"]);
  assert.deepEqual(wave.blockedBy.child,["ref"]);
});

test("write and irreversible work are not eligible without approval",()=>{
  const wave=nextCoordinationWave([
    work("read"),work("write",{effect:"write"}),
    work("publish",{effect:"irreversible"}),
  ]);
  assert.deepEqual(wave.runnable,["read"]);
  assert.deepEqual(wave.waitingApproval,["write","publish"]);
});

test("approval in score does not bypass existing runtime authorization",()=>{
  const wave=nextCoordinationWave([work("write",{effect:"write",approved:true})]);
  assert.deepEqual(wave.runnable,["write"]);
  assert.equal(wave.requiresRuntimeAuthorization,true);
});

test("priority determines wave membership without starving independent work",()=>{
  const wave=nextCoordinationWave([
    work("low",{priority:1}),work("high",{priority:95}),work("medium",{priority:50}),
  ],2);
  assert.deepEqual(wave.runnable,["high","medium"]);
});

test("duplicate names, invalid references and cycles are rejected",()=>{
  assert.throws(()=>nextCoordinationWave([work("x"),work("x")]),/invalid_or_duplicate/);
  assert.throws(()=>nextCoordinationWave([work("a",{dependsOn:["missing"]})]),/invalid_dependency/);
  assert.throws(()=>nextCoordinationWave([
    work("a",{dependsOn:["b"]}),work("b",{dependsOn:["a"]}),
  ]),/cyclic_dependency/);
});

test("a blocked task does not prevent unrelated work, and cannot auto-skip",()=>{
  const items=[work("canva",{state:"blocked"}),work("design",{dependsOn:["canva"]}),work("brief")];
  const result=assessDetour(items,"canva");
  assert.deepEqual(result.dependent,["design"]);
  assert.deepEqual(result.independent,["brief"]);
  assert.equal(result.safeToAutoSkip,false);
});

test("a proposed substitute requires a new approved plan revision",()=>{
  const items=[work("provider",{state:"failed"})];
  assert.equal(assessDetour(items,"provider",{id:"provider_alt",sameOutcome:true,approved:true}).disposition,"requires_plan_revision");
  assert.equal(assessDetour(items,"provider",{id:"provider_alt",sameOutcome:false,approved:true}).disposition,"needs_human_or_alternative");
});

test("optional isolation remains supervised",()=>{
  const result=assessDetour([work("optional",{state:"blocked",optional:true})],"optional");
  assert.equal(result.disposition,"defer_with_human_record");
  assert.equal(result.safeToAutoSkip,false);
});

const note=(organizer,extra={})=>({
  organizer,missionId:"mission_1",scoreVersion:"v1",focus:"schedule",
  evidence:["source: checkpoint"],conclusion:"coherent",...extra,
});

test("dissonance is preserved and cross-version votes are rejected",()=>{
  assert.equal(classifyHarmony([note("spalla"),note("orquestrador",{disagreement:"Uma alternativa precisa de ensaio."})]).state,"productive_dissonance");
  assert.equal(classifyHarmony([note("spalla"),note("regente",{scoreVersion:"v2"})]).state,"critical_conflict");
  assert.equal(classifyHarmony([note("spalla"),note("spalla")]).state,"critical_conflict");
  assert.equal(classifyHarmony([note("spalla",{evidence:[]})]).state,"unverified");
  assert.equal(classifyHarmony([note("spalla"),note("orquestrador")]).state,"consonant");
});
