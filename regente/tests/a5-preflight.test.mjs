import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildA5PreflightReport,
  executeA5LocalPreflight,
} from "../lib/a5-preflight.ts";

const pipeline = [
  { step: 1, role: "validation", nodes: ["A5"], action: "Preflight", input: "", expectedOutput: "Relatório", executionState: "ready", requiresApproval: false, dependsOn: [] },
  { step: 2, role: "reference", nodes: ["A1"], action: "Referências", input: "", expectedOutput: "Base", executionState: "ready", requiresApproval: false, dependsOn: [1] },
  { step: 3, role: "planning", nodes: ["A2"], action: "Planejar", input: "", expectedOutput: "Plano", executionState: "planned", requiresApproval: false, dependsOn: [2] },
];

test("A5 calcula a primeira continuação liberada sem executar provedor", () => {
  const report = buildA5PreflightReport({
    task: {
      id: "task-1",
      status: "executing",
      current_step: 1,
      progress_percent: 0,
      next_action: "Executar A5",
      blocked_reason: null,
      pipeline,
    },
    steps: pipeline.map((step) => ({
      step_number: step.step,
      status: step.step === 1 ? "failed" : "planned",
      depends_on: step.dependsOn,
      node_ids: step.nodes,
      action: step.action,
      next_action: null,
    })),
    succeededRuns: [],
    a5StepNumber: 1,
    openAICredentialConfigured: true,
    generatedAt: "2026-10-08T12:00:00.000Z",
  });

  assert.equal(report.prospectiveContinuation.nextStep, 2);
  assert.equal(report.prospectiveContinuation.node, "A1");
  assert.equal(report.executionSafety.providerCallsPerformed, false);
  assert.equal(report.executionSafety.additionalAiConsumption, false);
  assert.equal(report.capabilityInventory.supabaseRls.operationalVerification, "verified_by_scoped_reads");
  assert.equal(report.capabilityInventory.F6.operationalVerification, "not_verified");
});

test("A5 reaproveita metadados de runs succeeded sem incluir segredos", () => {
  const secretMarker = "never-include-this-secret";
  const report = buildA5PreflightReport({
    task: {
      id: "task-1",
      status: "executing",
      current_step: 1,
      progress_percent: 17,
      next_action: null,
      blocked_reason: null,
      pipeline,
    },
    steps: [{
      step_number: 2,
      status: "succeeded",
      depends_on: [1],
      node_ids: ["A1"],
      action: "Referências",
      next_action: null,
    }],
    succeededRuns: [{
      id: "run-2",
      step_number: 2,
      node_id: "A1",
      adapter: "openai_agents",
      status: "succeeded",
      created_at: "2026-10-08T12:01:00.000Z",
    }],
    a5StepNumber: 1,
    openAICredentialConfigured: Boolean(secretMarker),
  });

  assert.deepEqual(report.completedSteps, [2]);
  assert.equal(report.reusableSucceededRuns[0].runId, "run-2");
  assert.equal(report.capabilityInventory.A1.credentialConfigured, true);
  assert.equal(report.executionSafety.secretValuesIncluded, false);
  assert.equal(JSON.stringify(report).includes(secretMarker), false);
});

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = payload;
    this.database.operations.push(this);
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    this.database.operations.push(this);
    return this;
  }

  select() { return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }

  single() {
    return Promise.resolve({ data: { id: "a5-run" }, error: null });
  }

  maybeSingle() {
    this.database.operations.push(this);
    return Promise.resolve(this.database.resultFor(this.table));
  }

  order() {
    this.database.operations.push(this);
    return Promise.resolve(this.database.resultFor(this.table));
  }

  then(resolve, reject) {
    this.database.operations.push(this);
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  }
}

class FakeSupabase {
  constructor() { this.operations = []; }
  from(table) { return new FakeQuery(this, table); }
  resultFor(table) {
    if (table === "regent_tasks") {
      return { data: { id: "task-1", status: "executing", pipeline }, error: null };
    }
    if (table === "regent_task_steps") {
      return { data: null, error: { message: "forced read failure" } };
    }
    return { data: [], error: null };
  }
}

test("A5 marca o run como failed e propaga qualquer falha de leitura", async () => {
  const supabase = new FakeSupabase();
  await assert.rejects(
    executeA5LocalPreflight({ supabase, taskId: "task-1", userId: "user-1", step: pipeline[0] }),
    /forced read failure/,
  );

  const failedUpdate = supabase.operations.find(
    (operation) => operation.table === "regent_tool_runs" && operation.operation === "update" && operation.payload?.status === "failed",
  );
  assert.ok(failedUpdate);
  assert.ok(failedUpdate.filters.some(([key, value]) => key === "task_id" && value === "task-1"));
  assert.ok(failedUpdate.filters.some(([key, value]) => key === "user_id" && value === "user-1"));
});

test("consultas A5 são isoladas por task_id/user_id e não chamam APIs externas", async () => {
  const source = await readFile(new URL("../lib/a5-preflight.ts", import.meta.url), "utf8");
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.match(source, /from\("regent_tasks"\)[\s\S]*?eq\("id", input\.taskId\)[\s\S]*?eq\("user_id", input\.userId\)/);
  assert.match(source, /from\("regent_task_steps"\)[\s\S]*?eq\("task_id", input\.taskId\)[\s\S]*?eq\("user_id", input\.userId\)/);
  assert.match(source, /from\("regent_tool_runs"\)[\s\S]*?eq\("task_id", input\.taskId\)[\s\S]*?eq\("user_id", input\.userId\)/);
});
