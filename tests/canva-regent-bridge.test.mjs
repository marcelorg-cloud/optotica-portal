import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Execute the real TypeScript against deterministic boundary mocks, without network or credentials.
function load(file, mocks = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const security = load("../lib/canva/security.ts");
const account = { canva_user_id: "canva-user", canva_team_id: "canva-team" };
function library(overrides = {}) {
  return load("../lib/canva/regent.ts", {
    "./api": { access: async () => ({ token: "never-a-real-token", connection: account }), api: async () => { throw new Error("Unexpected API call"); }, ...overrides },
    "./pages": { listPages: async () => [] }, "./security": security,
  });
}
const lib = library();
const future = () => new Date(Date.now() + 60_000).toISOString();
const fence = { executionId: "execution-current", executionInvocationId: "invocation-current", stepRevision: 1 };
const task = { status: "executing", current_step: 2, human_decision: { approval_scope: "single_phase", approved_steps: [2], phase_revision: 1 },
  execution_id: fence.executionId, execution_invocation_id: fence.executionInvocationId, execution_lease_until: future() };
const phase = { status: "running", step_number: 2, revision: 1 };
const run = { step_number: 2, input: fence };

test("fence exige fase única, revisão, lease e invocação atualmente autorizadas", () => {
  assert.equal(lib.regentCanvaRunIsAuthorized({ task, step: phase, run }), true);
  for (const changed of [
    { execution_id: "old" }, { execution_invocation_id: "old" }, { current_step: 1 },
    { status: "awaiting_validation" }, { execution_lease_until: new Date(0).toISOString() },
    { human_decision: { approval_scope: "all", approved_steps: [2], phase_revision: 1 } },
    { human_decision: { approval_scope: "single_phase", approved_steps: [1, 2], phase_revision: 1 } },
  ]) assert.equal(lib.regentCanvaRunIsAuthorized({ task: { ...task, ...changed }, step: phase, run }), false);
  assert.equal(lib.regentCanvaRunIsAuthorized({ task, step: { ...phase, revision: 2 }, run }), false);
  assert.equal(lib.regentCanvaRunIsAuthorized({ task, step: phase, run: { ...run, input: { stepRevision: 1 } } }), false);
});

test("fase fonte validada pode ser inspecionada antes de finalizar a missão", () => {
  const source = { run: { status: "succeeded", step_number: 1, input: { stepRevision: 1 } },
    task: { status: "executing", engine_version: "0.7.0", validated_steps: [1] },
    step: { status: "succeeded", revision: 1, step_number: 1, validated_at: new Date().toISOString() },
    reviews: [{ step_number: 1, revision: 1, decision: "accepted" }] };
  assert.equal(lib.regentCanvaSourceIsValidated(source), true);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, reviews: [] }), false);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, reviews: [...source.reviews, { step_number: 1, revision: 1, decision: "superseded" }] }), false);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, step: { ...source.step, revision: 2 } }), false);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, task: { ...source.task, validated_steps: [] } }), false);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, task: { ...source.task, engine_version: "0.8.0" }, step: { ...source.step, validated_at: null } }), false);
});

test("legacy succeeded é preservado, mas revisões superseded não são autorizadas", () => {
  const source = { run: { status: "succeeded", step_number: 1, input: {} }, task: { status: "succeeded", engine_version: "0.6.3" }, step: null, reviews: [] };
  assert.equal(lib.regentCanvaSourceIsValidated(source), true);
  assert.equal(lib.regentCanvaSourceIsValidated({ ...source, reviews: [{ step_number: 1, revision: 1, decision: "superseded" }] }), false);
});

test("criação preserva import jobs e designs de variantes anteriores se uma consulta falhar", async () => {
  const snapshots = [];
  let imports = 0;
  const worker = library({ api: async (_token, path) => {
    if (path === "/imports") { imports++; return { job: { id: `import-job-${imports}`, status: "success", result: { designs: [{ id: `design-${imports}` }] } } }; }
    if (path === "/designs/design-2") throw new security.CanvaError("Metadata temporarily unavailable", 503);
    return { design: { id: "design-1", urls: { edit_url: "https://www.canva.com/design/design-1/edit", view_url: "https://www.canva.com/design/design-1/view" } } };
  } });
  await assert.rejects(worker.createRegentCanvaDesigns({}, "owner", { title: "Evento", width: 1080, height: 1920, pages: [{ headline: "Convite" }] }, 3,
    { onProgress: async (progress) => snapshots.push(progress) }), /Metadata/);
  assert.equal(imports, 2); // It never silently restarts variant 1 or starts variant 3.
  assert.equal(snapshots.at(-1).jobs.length, 2);
  assert.equal(snapshots.at(-1).designs.length, 2);
  assert.equal(snapshots.at(-1).designs[0].metadataComplete, true);
  assert.equal(snapshots.at(-1).designs[1].metadataComplete, false);
  assert.ok(snapshots.some((progress) => progress.externalEffect === "unknown" && progress.jobs.length === 0));
  assert.equal(JSON.stringify(snapshots).includes("never-a-real-token"), false);
});

test("HTTP 200 Canva sem job mantém efeito desconhecido e não repete o POST", async () => {
  let posts = 0; const snapshots = [];
  const worker = library({ api: async () => { posts++; return null; } });
  await assert.rejects(worker.createRegentCanvaDesigns({}, "owner", { title: "Evento", width: 1080, height: 1920, pages: [{ headline: "Convite" }] }, 1,
    { onProgress: async (progress) => snapshots.push(progress) }), /job inválido/);
  assert.equal(posts, 1);
  assert.equal(snapshots.at(-1).externalEffect, "unknown");
  assert.equal(snapshots.at(-1).complete, false);
});

test("falha de persistência antes do POST impede todo efeito externo", async () => {
  let posts = 0;
  const worker = library({ api: async () => { posts++; return {}; } });
  await assert.rejects(worker.createRegentCanvaDesigns({}, "owner", { title: "Evento", width: 1080, height: 1920, pages: [{ headline: "Convite" }] }, 1,
    { onProgress: async (progress) => { if (progress.externalEffect === "unknown") throw new Error("Persistence failed"); } }), /Persistence failed/);
  assert.equal(posts, 0);
});

test("inspeção detecta troca de conta/equipe antes de consultar designs", async () => {
  let calls = 0;
  const worker = library({ api: async () => { calls++; return {}; } });
  await assert.rejects(worker.inspectRegentCanvaDesigns({}, "owner", ["design-1"], { expectedAccount: { userId: "different", teamId: "canva-team" } }), /outra conta/);
  assert.equal(calls, 0);
});

function database(tables, failure = () => false) {
  const calls = [];
  return { tables, calls, from(table) {
    let type = "select", values, singleton = false;
    const filters = [];
    const builder = {
      select() { return builder; }, update(value) { type = "update"; values = value; return builder; },
      eq(key, value) { filters.push((row) => row[key] === value); return builder; },
      gt(key, value) { filters.push((row) => row[key] > value); return builder; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return builder; },
      maybeSingle() { singleton = true; return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      const operation = { table, type, values }; calls.push(operation);
      if (failure(operation)) return { data: null, error: { message: "Simulated database failure" } };
      const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
      if (type === "update") for (const row of rows) Object.assign(row, structuredClone(values));
      return { data: singleton ? rows[0] || null : rows, error: null };
    }
    return builder;
  } };
}
function routeFixture({ mode = "inspect", failure, execute, mutate } = {}) {
  const token = "test-one-use-token";
  const sourceId = "source-run";
  const source = { id: sourceId, task_id: "task", user_id: "owner", step_number: 1, node_id: "F6", status: "succeeded", input: { stepRevision: 1 },
    output: { account: { userId: account.canva_user_id, teamId: account.canva_team_id }, designs: [{ id: "design-1" }] } };
  const pending = { id: "pending-run", task_id: "task", user_id: "owner", step_number: 2, node_id: "F6", status: "pending", adapter: mode === "inspect" ? "canva_portal_inspect" : "canva_portal_bridge",
    token_hash: createHash("sha256").update(token).digest("hex"), token_expires_at: future(), input: { ...fence, mode, sourceRunIds: [sourceId], designIds: ["design-1"], variants: 1,
      spec: { title: "Evento", width: 1080, height: 1920, pages: [{ headline: "Convite" }] } } };
  const storedTask = { id: "task", user_id: "owner", ...task, execution_lease_until: future(), engine_version: "0.7.0", validated_steps: [1],
    pipeline: [{ step: 2, nodes: ["F6"], canvaMode: mode, canvaSourceRunIds: [sourceId], canvaDesignIds: ["design-1"] }] };
  const tables = { regent_tool_runs: [pending, source], system_admins: [{ user_id: "owner", active: true }], regent_tasks: [storedTask],
    regent_task_steps: [{ task_id: "task", user_id: "owner", ...phase }, { task_id: "task", user_id: "owner", step_number: 1, revision: 1, status: "succeeded", validated_at: new Date().toISOString() }],
    regent_phase_reviews: [{ task_id: "task", user_id: "owner", step_number: 1, revision: 1, decision: "accepted" }] };
  mutate?.(tables);
  const db = database(tables, failure);
  let executions = 0;
  async function runWork(_admin, _user, _spec, countOrOptions, possibleOptions) {
    executions++;
    const options = possibleOptions || countOrOptions;
    if (execute) return execute(options);
    const designs = [{ id: "design-1", editUrl: "https://www.canva.com/design/design-1/edit", viewUrl: "https://www.canva.com/design/design-1/view" }];
    await options.onProgress({ mode, complete: true, designs, jobs: [{ kind: mode === "create" ? "import" : "export", id: "known-job", status: "success" }], externalEffect: "known" });
    return designs;
  }
  const route = load("../app/api/internal/regente/canva/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { ...options, headers: { "Content-Type": "application/json", ...options.headers } }) } },
    "@/lib/supabase/server": { createAdminSupabaseClient: () => db },
    "@/lib/canva/regent": { ...lib, createRegentCanvaDesigns: runWork, inspectRegentCanvaDesigns: runWork },
    "@/lib/canva/regent-provenance": load("../lib/canva/regent-provenance.ts"), "@/lib/canva/security": security,
  });
  return { db, pending, executions: () => executions, call: () => route.POST(new Request("https://portal.test/api/internal/regente/canva", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: pending.id, token }) })) };
}

test("Portal permite inspeção de fonte validada na própria missão executing e consome token uma vez", async () => {
  const fixture = routeFixture();
  const first = await fixture.call();
  assert.equal(first.status, 200); assert.equal(fixture.pending.status, "succeeded");
  const body = await first.json(); assert.equal(body.complete, true); assert.equal(body.runId, fixture.pending.id);
  assert.equal(fixture.pending.token_hash, null);
  assert.equal((await fixture.call()).status, 403); assert.equal(fixture.executions(), 1);
});

test("Portal rejeita source superseded, usuário alheio e token de invocação anterior sem APIs externas", async () => {
  for (const mutate of [
    (tables) => tables.regent_phase_reviews.push({ ...tables.regent_phase_reviews[0], decision: "superseded" }),
    (tables) => { tables.regent_tool_runs[1].user_id = "another-owner"; },
    (tables) => { tables.regent_tool_runs[0].input.executionId = "old-invocation"; },
    (tables) => { tables.regent_task_steps[0].revision = 2; },
  ]) { const fixture = routeFixture({ mutate }); assert.equal((await fixture.call()).status, 403); assert.equal(fixture.executions(), 0); }
});

test("Portal só declara sucesso quando a conclusão foi realmente persistida", async () => {
  const fixture = routeFixture({ mode: "create", failure: ({ type, values }) => type === "update" && values.status === "succeeded" });
  const response = await fixture.call(); assert.equal(response.status, 503);
  const body = await response.json(); assert.equal(body.complete, false); assert.equal(body.designs[0].id, "design-1");
  assert.equal(fixture.pending.status, "failed"); assert.equal(fixture.pending.output.designs[0].id, "design-1");
});

test("Portal preserva outputs parciais e jobs no diagnóstico de falha", async () => {
  const fixture = routeFixture({ mode: "create", execute: async (options) => {
    await options.onProgress({ mode: "create", complete: false, designs: [{ id: "design-partial" }], jobs: [{ kind: "import", id: "import-known", status: "in_progress" }], externalEffect: "known" });
    throw new security.CanvaError("Job ainda em progresso; conferir sem recriar", 409);
  } });
  const response = await fixture.call(); assert.equal(response.status, 409);
  const body = await response.json(); assert.equal(body.designs[0].id, "design-partial"); assert.equal(body.jobs[0].id, "import-known");
  assert.deepEqual(fixture.pending.output.designs, body.designs); assert.equal(fixture.pending.status, "failed");
});

test("falha ao salvar diagnóstico é visível e retorna IDs conhecidos sem simular persistência", async () => {
  const fixture = routeFixture({ mode: "create", failure: ({ type, values }) => type === "update" && values.status === "failed", execute: async (options) => {
    await options.onProgress({ mode: "create", complete: false, designs: [{ id: "design-partial" }], jobs: [], externalEffect: "unknown" });
    throw new security.CanvaError("Falha de transporte", 503);
  } });
  const response = await fixture.call(); assert.equal(response.status, 503);
  const body = await response.json(); assert.match(body.message, /persistir o diagnóstico/);
  assert.equal(body.designs[0].id, "design-partial"); assert.equal(fixture.pending.status, "running");
});
