import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeWorkflowOrigin, safeWorkflowRunId, workflowFailureKind, workflowFailureMessage, workflowHttpFailure, workflowObservation, withWorkflowObservation } from "../lib/workflow-state.ts";

const now = Date.parse("2026-10-09T20:00:00.000Z");
const runId = "wrun_01J00000000000000000000000";
function run(status = "failed", extra = {}) {
  return { runId, status, workflowName: "workflow//./workflows/task-execution.ts//taskExecutionWorkflow", deploymentId: "dpl_original", startedAt: new Date(now - 1000), updatedAt: new Date(now), ...extra };
}

test("durable auth/config failures are finite labels, never raw exception text", () => {
  assert.equal(workflowHttpFailure(401), "authentication");
  assert.equal(workflowHttpFailure(403), "authentication");
  assert.equal(workflowHttpFailure(422), "configuration");
  assert.equal(workflowHttpFailure(409), "conflict");
  assert.equal(workflowHttpFailure(503), "dispatch_unknown");
  assert.equal(workflowFailureKind(new Error(workflowFailureMessage("session"))), "session");
  assert.equal(workflowFailureKind(new Error("Bearer eyJprivate-secret.unknown.provider")), "dispatch_unknown");
  assert.equal(workflowFailureMessage(workflowFailureKind("sk-live-DO-NOT-EXPOSE" )).includes("sk-live"), false);
});

test("workflow target strips no hidden credentials and refuses redirects/origin payloads", () => {
  assert.equal(safeWorkflowOrigin("https://regente.optotica.com.br", true, { REGENT_APP_ORIGIN: "https://regente.optotica.com.br" }), "https://regente.optotica.com.br");
  assert.equal(safeWorkflowOrigin("https://optotica-regente.vercel.app", true, {}), "https://optotica-regente.vercel.app");
  assert.equal(safeWorkflowOrigin("https://spoofed-host.example", true, {}), null);
  assert.equal(safeWorkflowOrigin("https://optotica-regente-123.vercel.app", true, { VERCEL_URL: "optotica-regente-123.vercel.app" }), "https://optotica-regente-123.vercel.app");
  assert.equal(safeWorkflowOrigin("https://regente.optotica.com.br", true, { VERCEL_PROJECT_PRODUCTION_URL: "regente.optotica.com.br" }), "https://regente.optotica.com.br");
  assert.equal(safeWorkflowOrigin("http://localhost:3000", false), "http://localhost:3000");
  for (const value of ["https://name:secret@regente.optotica.com.br", "https://regente.optotica.com.br/private", "https://regente.optotica.com.br?access_token=secret", "https://regente.optotica.com.br#fragment", "http://other.example", "file:///tmp"]) {
    assert.equal(safeWorkflowOrigin(value, false), null);
  }
  assert.equal(safeWorkflowOrigin("http://localhost:3000", true), null);
  assert.equal(safeWorkflowOrigin("https://other.example", true, { REGENT_APP_ORIGIN: "https://other.example?token=secret" }), null);
});

test("metadata run IDs must be actual SDK identifiers, never secret values or arbitrary paths", () => {
  assert.equal(safeWorkflowRunId(runId), runId);
  assert.equal(safeWorkflowRunId("sk-proj-this-must-not-be-reflected"), null);
  assert.equal(safeWorkflowRunId("../../../another-workflow"), null);
});

test("metadata whitelist never exposes sessions, provider exceptions, IO, or unexpected error codes", () => {
  const observed = workflowObservation({ runId, run: run("failed", {
    errorCode: "sk-private-provider-error", error: { message: "Bearer private" }, input: [{ sealedSession: "v1.secret" }], output: { token: "private" },
    attributes: { API_KEY: "sk-private" }, executionContext: { refreshToken: "private" },
  }), currentDeploymentId: "dpl_new", now });
  assert.equal(observed.verified, true);
  assert.equal(observed.status, "failed");
  assert.equal(observed.deploymentChanged, true);
  assert.equal(observed.errorCode, null);
  assert.equal(observed.inputOutputLoaded, false);
  assert.equal(observed.startedAt, "2026-10-09T19:59:59.000Z");
  assert.equal(JSON.stringify(observed).includes("private"), false);
  assert.equal(JSON.stringify(observed).includes("v1.secret"), false);
  assert.equal(workflowObservation({ runId, run: run("failed", { errorCode: "DEPLOYMENT_MISMATCH" }), now }).errorCode, "DEPLOYMENT_MISMATCH");
});

test("unavailable or unrelated Workflow never becomes verified or completed", () => {
  assert.equal(workflowObservation({ runId, reason: "timeout", now }).verified, false);
  assert.equal(workflowObservation({ runId, reason: "timeout", now }).status, null);
  assert.equal(workflowObservation({ runId, run: run("completed", { workflowName: "workflow//another//secretWorkflow" }), now }).status, null);
  assert.equal(workflowObservation({ runId, run: run("completed", { runId: "wrun_other" }), now }).verified, false);
});

test("workflow failure is visible while an active lease forbids human recovery", () => {
  const task = { status: "executing", current_step: 3, is_stale: false, execution_lease_until: "2026-10-09T20:01:00.000Z", progress_percent: 25 };
  const observed = withWorkflowObservation(task, workflowObservation({ runId, run: run(), now }), now);
  assert.equal(observed.status, "executing");
  assert.equal(observed.is_stale, false);
  assert.equal(observed.progress_percent, 25);
  assert.equal(observed.attention.kind, "failed");
  assert.equal(observed.attention.action, "refresh");
  assert.equal(observed.recovery_eligibility.allowedNow, false);
  assert.equal(observed.recovery_eligibility.humanOnly, true);
});

test("expired lease permits only explicit human recovery without restarting or changing state", () => {
  const task = { status: "executing", current_step: 3, is_stale: true, execution_lease_until: "2026-10-09T19:59:00.000Z" };
  const observed = withWorkflowObservation(task, workflowObservation({ runId, run: run(), now }), now);
  assert.equal(observed.status, "executing");
  assert.equal(observed.recovery_eligibility.allowedNow, true);
  assert.equal(observed.recovery_eligibility.checkpointPreserved, true);
  const initial = withWorkflowObservation({ ...task, is_stale: false, execution_lease_until: null }, workflowObservation({ runId, run: run(), now }), now);
  assert.equal(initial.recovery_eligibility.allowedNow, false);
});

test("Workflow completion is not mission success and a persisted validation gate wins", () => {
  const metadata = workflowObservation({ runId, run: run("completed"), now });
  const incomplete = withWorkflowObservation({ status: "executing", is_stale: false, current_step: 4 }, metadata, now);
  assert.equal(incomplete.status, "executing");
  assert.equal(incomplete.attention.title, "Confirmação de checkpoint pendente");
  assert.equal(incomplete.recovery_eligibility.allowedNow, false);
  const pending = withWorkflowObservation({ status: "awaiting_validation", is_stale: false, attention: { kind: "approval" } }, workflowObservation({ runId, run: run(), now }), now);
  assert.equal(pending.status, "awaiting_validation");
  assert.equal(pending.attention.kind, "approval");
  assert.equal(pending.recovery_eligibility.allowedNow, false);
});

test("durable worker has no blind POST retry or privileged credential fallback", async () => {
  const source = await readFile(new URL("../workflows/task-execution.ts", import.meta.url), "utf8");
  assert.match(source, /prepareWorkflowSession\.maxRetries = 0/);
  assert.match(source, /executeTaskRequest\.maxRetries = 0/);
  assert.match(source, /recordWorkflowFailure\.maxRetries = 0/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /AbortSignal\.timeout\(770_000\)/);
  assert.match(source, /new FatalError/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|new RetryableError/);
  const status = await readFile(new URL("../app/api/tasks/[taskId]/status/route.ts", import.meta.url), "utf8");
  assert.match(status, /world\.runs\.get\(runId, \{ resolveData: "none" \}\)/);
  assert.doesNotMatch(status, /hydrateResourceIO|\.update\(|\.insert\(|events\.create|resumeHook|\.cancel\(/);
});
