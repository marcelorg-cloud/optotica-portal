import assert from "node:assert/strict";
import test from "node:test";
import { evaluateA5ResumeAuthorization, evaluateResumeAuthorization } from "../lib/resume-authorization.ts";

const pipeline = [
  { step: 1, nodes: ["A5"] },
  { step: 2, nodes: ["A1"], dependsOn: [1] },
];

const failedA5 = [{ step_number: 1, status: "failed", node_ids: ["A5"] }];

test("retomada failed exige decisão humana persistida", () => {
  const result = evaluateA5ResumeAuthorization({
    taskStatus: "failed",
    pipeline,
    humanDecision: null,
    runtimeSteps: failedA5,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /decisão humana persistida/i);
});

test("retomada rejeita aprovação que não inclui explicitamente A5", () => {
  const result = evaluateA5ResumeAuthorization({
    taskStatus: "blocked",
    pipeline,
    humanDecision: {
      decision: "partial",
      decided_at: "2026-10-08T12:00:00.000Z",
      approved_steps: [2],
    },
    runtimeSteps: [{ step_number: 1, status: "blocked", node_ids: ["A5"] }],
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /não autoriza explicitamente A5/i);
});

test("retomada autoriza A5 com decisão persistida válida", () => {
  const result = evaluateA5ResumeAuthorization({
    taskStatus: "failed",
    pipeline,
    humanDecision: {
      decision: "execute",
      decided_at: "2026-10-08T12:00:00.000Z",
      approval_scope: "all_current_pipeline_steps",
      approved_pipeline_steps: [1, 2],
    },
    runtimeSteps: failedA5,
  });
  assert.equal(result.allowed, true);
});

test("falha em outro nó não pode usar A5 para contornar o gate", () => {
  const result = evaluateA5ResumeAuthorization({
    taskStatus: "failed",
    pipeline,
    humanDecision: {
      decision: "execute",
      decided_at: "2026-10-08T12:00:00.000Z",
      approved_pipeline_steps: [1, 2],
    },
    runtimeSteps: [{ step_number: 2, status: "failed", node_ids: ["A1"] }],
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Nenhuma etapa A5 pausada/i);
});

test("retomada geral permite F6 somente após autorização de recovery persistida", () => {
  const result = evaluateResumeAuthorization({
    taskStatus: "failed",
    pipeline: [{ step: 1, nodes: ["F6"], canvaMode: "inspect" }],
    humanDecision: {
      decision: "execute",
      decided_at: "2026-10-08T12:00:00.000Z",
      approved_pipeline_steps: [1],
      recovery_authorized: true,
    },
    runtimeSteps: [{ step_number: 1, status: "failed", node_ids: ["F6"] }],
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.pausedSteps, [1]);
});

test("aprovação inicial antiga não vale como autorização de retomada", () => {
  const result = evaluateResumeAuthorization({
    taskStatus: "failed",
    pipeline: [{ step: 1, nodes: ["F6"] }],
    humanDecision: {
      decision: "execute",
      decided_at: "2026-10-08T12:00:00.000Z",
      approved_pipeline_steps: [1],
    },
    runtimeSteps: [{ step_number: 1, status: "failed", node_ids: ["F6"] }],
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /específica para esta retomada/i);
});

test("retomada parcial exige todas as etapas pausadas", () => {
  const result = evaluateResumeAuthorization({
    taskStatus: "blocked",
    pipeline: [{ step: 1, nodes: ["F6"] }, { step: 2, nodes: ["A3"] }],
    humanDecision: {
      decision: "partial",
      decided_at: "2026-10-08T12:00:00.000Z",
      approved_steps: [1],
      recovery_authorized: true,
    },
    runtimeSteps: [
      { step_number: 1, status: "failed", node_ids: ["F6"] },
      { step_number: 2, status: "review", node_ids: ["A3"] },
    ],
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /etapas pausadas 2/i);
});
