import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNewPipeline, nextPhase, dependencyArtifacts, buildPhaseReport, failureDisposition, redactSecrets } from "../lib/phase-control.ts";

const stage = (step, dependsOn = []) => ({ step, role: "reference", nodes: ["A1"], action: "Analisar", input: "Fonte", expectedOutput: "Relatório", executionState: "ready", requiresApproval: true, dependsOn });
test("new plans have free local preflight and bounded per-phase human gates", () => {
  const plan = normalizeNewPipeline([stage(5), stage(7, [5])]);
  assert.deepEqual(plan.map((step) => [step.step, step.nodes[0], step.dependsOn]), [[1, "A5", []], [2, "A1", [1]], [3, "A1", [2]]]);
  assert.ok(plan.every((step) => step.checkpoint && step.requiresApproval));
  assert.deepEqual(normalizeNewPipeline([]), []);
  assert.equal(normalizeNewPipeline([{ ...stage(1), nodes: ["A5"] }, stage(2, [1])]).length, 2);
  assert.throws(() => normalizeNewPipeline([stage(1, [3]), stage(3)]), /Dependência/);
  assert.throws(() => normalizeNewPipeline([stage(1), stage(1)]), /duplicadas/);
});
test("context only includes declared transitive dependencies, not unrelated earlier outputs", () => {
  const states = [
    { step_number: 1, status: "succeeded", artifact: "preflight", depends_on: [] },
    { step_number: 2, status: "succeeded", artifact: "unrelated", depends_on: [1] },
    { step_number: 3, status: "succeeded", artifact: "required", depends_on: [1] },
    { step_number: 4, status: "planned", depends_on: [3] },
  ];
  assert.deepEqual(dependencyArtifacts(states, 4).map((artifact) => artifact.step), [1, 3]);
  assert.equal(nextPhase(states).step.step_number, 4);
  assert.deepEqual(nextPhase([{ step_number: 1, status: "succeeded" }, { step_number: 2, status: "planned", depends_on: [3] }]).unresolved, [3]);
});
test("last phase report is not a mission approval", () => {
  const report = buildPhaseReport({ step: stage(1), revision: 2, output: { result: "Documento" }, states: [{ step_number: 1, status: "running" }] });
  assert.equal(report.final, true);
  assert.equal(report.revision, 2);
  assert.match(report.limitations[0], /não significa aprovação/);
});
test("configuration and deterministic errors do not burn retries; Canva creation is never repeated on timeout", () => {
  assert.equal(failureDisposition(new Error("OPENAI_API_KEY não configurada"), "A1").retry, false);
  assert.equal(failureDisposition(new Error("Adapter F12 não conectado"), "F12").kind, "deterministic");
  assert.equal(failureDisposition(new Error("timeout"), "F6", "create").kind, "external_effect_unknown");
  assert.equal(failureDisposition(new Error("timeout"), "F6", "inspect").retry, true);
  assert.equal(failureDisposition(Object.assign(new Error("rate limit"), { status: 429 }), "A2").retry, true);
  assert.equal(failureDisposition(Object.assign(new Error("billing exhausted"), { status: 429 }), "A2").retry, false);
  assert.equal(redactSecrets("secret-value-1234", { OPENAI_API_KEY: "secret-value-1234" }), "[segredo ocultado]");
});
