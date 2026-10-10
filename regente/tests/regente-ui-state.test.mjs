import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTLED_TASK_STATUSES, controlRevisionOf, engineVersionOf, missionPlans, needsRecovery,
  phaseReportOf, runtimeCounts, runtimeFromTask, safeOutputLinks, stepStatusLabel,
  taskStatusLabel,
} from "../app/regente-ui-state.ts";

const plan = (id, status, runtime = {}) => ({
  taskId: id, taskStatus: status, summary: id, pipeline: [], runtime,
});

test("human validation pauses polling; it is neither an error nor final success", () => {
  assert.equal(SETTLED_TASK_STATUSES.has("awaiting_validation"), true);
  assert.equal(SETTLED_TASK_STATUSES.has("awaiting_approval"), true);
  assert.equal(SETTLED_TASK_STATUSES.has("executing"), false);
  assert.equal(taskStatusLabel("awaiting_validation"), "Valide esta fase");
  assert.equal(taskStatusLabel("succeeded"), "Finalizada");
});

test("produced phases, human approvals and skipped stages are separate counts", () => {
  const runtime = {
    validated_steps: [1],
    steps: [
      { step_number: 1, status: "succeeded" },
      { step_number: 2, status: "succeeded" },
      { step_number: 3, status: "skipped" },
      { step_number: 4, status: "blocked" },
      { step_number: 5, status: "planned" },
    ],
  };
  assert.deepEqual(runtimeCounts(runtime), { produced: 2, validated: 1, skipped: 1, failed: 1, pending: 1, total: 5 });
  assert.equal(stepStatusLabel("skipped"), "Pulada com autorização");
});

test("recovery is offered for explicit errors or expired lease, never healthy executing tasks", () => {
  const now = new Date("2026-10-09T16:00:00Z").getTime();
  assert.equal(needsRecovery(plan("a", "executing", { execution_lease_until: "2026-10-09T15:59:59Z" }), now), true);
  assert.equal(needsRecovery(plan("a", "executing", { execution_lease_until: "2026-10-09T16:15:00Z" }), now), false);
  assert.equal(needsRecovery(plan("a", "failed"), now), true);
  assert.equal(needsRecovery(plan("a", "awaiting_validation", { isStale: true }), now), false);
});

test("every mission remains selectable with its most recent persisted payload", () => {
  const messages = [
    { id: "1", role: "assistant", payload: plan("a", "executing") },
    { id: "2", role: "assistant", payload: plan("b", "failed") },
    { id: "3", role: "assistant", payload: plan("a", "awaiting_validation") },
  ];
  const result = missionPlans(messages);
  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.taskId === "a").taskStatus, "awaiting_validation");
});

test("phase notification updates runtime without erasing the full mission plan", () => {
  const pipeline = [{ step: 1, nodes: ["A5"], action: "Verify" }];
  const messages = [
    { id: "1", role: "assistant", payload: { ...plan("a", "executing"), pipeline } },
    { id: "2", role: "assistant", payload: {
      taskId: "a", notification: true, phase: 1, engineVersion: "0.7.0",
      taskStatus: "awaiting_validation", runtime: { phase_report: { step: 1 }, control_revision: 2 },
    } },
  ];
  const result = missionPlans(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].summary, "a");
  assert.deepEqual(result[0].pipeline, pipeline);
  assert.equal(result[0].taskStatus, "awaiting_validation");
  assert.equal(controlRevisionOf(result[0].runtime), 2);
  assert.equal(missionPlans([messages[1]]).length, 0);
});

test("runtime hydration preserves revision, phase report, engine and workflow identity", () => {
  const report = { step: 2, revision: 3, summary: "output", final: false };
  const runtime = runtimeFromTask({
    phase_report: report, control_revision: 8, validated_steps: [1], engine_version: "0.7.0",
    workflow_run_id: "workflow-123", execution_lease_until: "2026-10-09T16:15:00Z", status: "awaiting_validation",
  }, []);
  assert.equal(controlRevisionOf(runtime), 8);
  assert.equal(engineVersionOf(runtime), "0.7.0");
  assert.deepEqual(phaseReportOf(runtime), report);
  assert.equal(runtime.workflowRunId, "workflow-123");
});

test("output links reject executable protocols, broken URLs and embedded credentials", () => {
  assert.deepEqual(safeOutputLinks([
    "https://www.canva.com/design/designId/edit", "https://app.optotica.com.br/file.png",
    "javascript:alert(1)", "data:text/html,hello", "https://user:secret@example.org/file", "wrong", 12,
  ]), ["https://www.canva.com/design/designId/edit", "https://app.optotica.com.br/file.png"]);
});
