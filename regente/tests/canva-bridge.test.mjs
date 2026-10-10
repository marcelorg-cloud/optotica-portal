import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const module = { exports: {} };
const source = readFileSync(new URL("../lib/adapters.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const mocks = {
  "@openai/agents": { Agent: class {}, run: () => { throw new Error("AI must not be called by bridge tests"); } },
  "./guardian-context": { guardianSpecialistInstructions: () => "" },
};
new Function("require", "module", "exports", compiled)((name) => name in mocks ? mocks[name] : require(name), module, module.exports);
const { validCanvaBridgeOutput, executeCanvaBridge } = module.exports;
const expected = { mode: "create", runId: "run-new", step: 2, revision: 1, executionId: "execution-current", count: 1 };
const result = { ...expected, complete: true, designs: [{ id: "design-1", editUrl: "https://www.canva.com/design/design-1/edit", viewUrl: "https://www.canva.com/design/design-1/view" }] };

test("contrato Canva rejeita null, IDs sem prova, duplicações, versões stale e URLs arbitrárias", () => {
  assert.equal(validCanvaBridgeOutput(result, expected), true);
  for (const value of [null, {}, { ...result, designs: [] }, { ...result, complete: false }, { ...result, revision: 2 },
    { ...result, executionId: "old" }, { ...result, designs: [{ ...result.designs[0], editUrl: "javascript:alert(1)" }] },
    { ...result, designs: [{ ...result.designs[0], viewUrl: "https://evil.test/design/design-1" }] },
    { ...result, designs: [{ ...result.designs[0], editUrl: "https://user:password@canva.com/design/design-1" }] },
  ]) assert.equal(validCanvaBridgeOutput(value, expected), false);
  assert.equal(validCanvaBridgeOutput({ ...result, designs: [result.designs[0], result.designs[0]] }, { ...expected, count: 2 }), false);
});

test("inspeção exige IDs autorizados, páginas e prévias, não só links de edição", () => {
  const inspectExpected = { ...expected, mode: "inspect", designIds: ["design-1"] };
  const inspectResult = { ...result, mode: "inspect", designs: [{ ...result.designs[0], inspectionComplete: true, pageCount: 1, pages: [{ pageNumber: 1 }], previewUrls: ["https://export-download.canva.com/page.png"] }] };
  assert.equal(validCanvaBridgeOutput(inspectResult, inspectExpected), true);
  assert.equal(validCanvaBridgeOutput({ ...result, mode: "inspect" }, inspectExpected), false);
  assert.equal(validCanvaBridgeOutput(inspectResult, { ...inspectExpected, designIds: ["different-design"] }), false);
});

function database(rows = [], fail) {
  const calls = [];
  return { rows, calls, from(table) {
    assert.equal(table, "regent_tool_runs");
    let action = "select", values, one = false; const filters = [];
    const builder = { select() { return builder; }, eq(key, value) { filters.push((row) => row[key] === value); return builder; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return builder; },
      insert(value) { action = "insert"; values = value; return builder; }, update(value) { action = "update"; values = value; return builder; },
      single() { one = true; return execute(); }, maybeSingle() { one = true; return execute(); }, then(resolve, reject) { return execute().then(resolve, reject); } };
    async function execute() {
      const operation = { action, values }; calls.push(operation);
      if (fail?.(operation)) return { data: null, error: { message: "Database failure" } };
      if (action === "insert") { const row = { id: "run-new", ...structuredClone(values) }; rows.push(row); return { data: row, error: null }; }
      const matches = rows.filter((row) => filters.every((filter) => filter(row)));
      if (action === "update") for (const row of matches) Object.assign(row, structuredClone(values));
      return { data: one ? matches[0] || null : matches, error: null };
    }
    return builder;
  } };
}
function input(supabase) { return { supabase, taskId: "task", userId: "owner", step: { step: 2, nodes: ["F6"], canvaMode: "create" },
  spec: { title: "Evento", width: 1080, height: 1920, pages: [{ headline: "Convite" }] }, variants: 1, revision: 1,
  executionId: "execution-current", executionInvocationId: "invocation-current" }; }
async function withFetch(mock, action) { const original = globalThis.fetch; globalThis.fetch = mock; try { return await action(); } finally { globalThis.fetch = original; } }

test("HTTP 200 inválido não é promovido a succeeded e invalida somente token não consumido", async () => {
  const db = database();
  await withFetch(async () => new Response("null", { status: 200 }), async () => {
    await assert.rejects(executeCanvaBridge(input(db)), /output Canva inválido/);
  });
  assert.equal(db.rows[0].status, "failed"); assert.equal(db.rows[0].output.externalEffect, "none");
  assert.equal(db.rows[0].token_hash, null);
  assert.equal(db.calls.some(({ values }) => values?.status === "succeeded"), false);
});

test("HTTP 200 válido precisa de confirmação do mesmo run no banco", async () => {
  const db = database();
  await withFetch(async () => new Response(JSON.stringify(result), { status: 200 }), async () => {
    await assert.rejects(executeCanvaBridge(input(db)), /não foi confirmado no banco/);
  });
  assert.equal(db.calls.some(({ values }) => values?.status === "succeeded"), false);
});

test("output confirmado pelo Portal é reutilizado sem sobrescrever seu run", async () => {
  const db = database();
  const received = await withFetch(async () => { Object.assign(db.rows[0], { status: "succeeded", output: structuredClone(result), token_hash: null }); return new Response(JSON.stringify(result), { status: 200 }); },
    () => executeCanvaBridge(input(db)));
  assert.deepEqual(received, result); assert.equal(db.calls.filter(({ action }) => action === "update").length, 0);
  assert.equal(db.rows[0].input.executionInvocationId, "invocation-current");
});

test("resposta perdida depois da persistência reutiliza efeito confirmado sem repetir POST", async () => {
  const db = database(); let calls = 0;
  const received = await withFetch(async () => { calls++; Object.assign(db.rows[0], { status: "succeeded", output: structuredClone(result), token_hash: null }); throw new Error("Connection reset"); },
    () => executeCanvaBridge(input(db)));
  assert.deepEqual(received, result); assert.equal(calls, 1);
});

test("erro de transporte com run claimed preserva dados parciais e efeito desconhecido", async () => {
  const db = database(); const partial = { mode: "create", complete: false, externalEffect: "unknown", designs: [{ id: "design-partial" }], jobs: [{ id: "import-known", kind: "import" }] };
  await withFetch(async () => { Object.assign(db.rows[0], { status: "running", output: structuredClone(partial), token_hash: null }); throw new Error("Connection reset"); }, async () => {
    await assert.rejects(executeCanvaBridge(input(db)), /não foi confirmado/);
  });
  assert.equal(db.rows[0].status, "running"); assert.deepEqual(db.rows[0].output, partial);
});

test("falha com jobs/designs conhecidos impede nova criação, mesmo com retomada humana", async () => {
  const db = database([{ id: "run-old", task_id: "task", user_id: "owner", step_number: 2, adapter: "canva_portal_bridge", status: "failed",
    output: { externalEffect: "known", jobs: [{ id: "import-known" }], designs: [{ id: "design-partial" }] } }]);
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error("Must not call Portal"); }, async () => { await assert.rejects(executeCanvaBridge(input(db)), /não reconciliada/); });
  assert.equal(calls, 0); assert.equal(db.rows.length, 1);
});

test("falha de leitura do run não é tratada como prova de sucesso", async () => {
  const db = database([], ({ action }) => action === "select" && db.rows.length > 0);
  await withFetch(async () => new Response(JSON.stringify(result), { status: 200 }), async () => {
    await assert.rejects(executeCanvaBridge(input(db)), /verificar o run Canva persistido/);
  });
  assert.equal(db.calls.some(({ values }) => values?.status === "succeeded"), false);
});
