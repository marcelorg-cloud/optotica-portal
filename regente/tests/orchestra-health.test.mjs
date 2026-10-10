import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { guardianProviders } from "../lib/provider-registry.ts";
import { buildOrchestraHealth, collectOrchestraHealth, OrchestraReadError, portalOrigin } from "../lib/orchestra-health.ts";

test("provider registry does not activate Claude API or DeepSeek based on keys", () => {
  const providers = guardianProviders({ OPENAI_API_KEY: "test-key-never-exposed", ANTHROPIC_API_KEY: "anthropic-secret-never-exposed",
    REGENT_CLAUDE_PROVIDER: "anthropic", REGENT_CLAUDE_MODEL: "chosen-model", DEEPSEEK_API_KEY: "deferred-secret" });
  assert.deepEqual(providers.map((provider) => provider.id), ["openai", "claude"]);
  assert.equal(providers[0].operational, null);
  assert.equal(providers[0].state, "configured");
  assert.equal(providers[1].automatic, false);
  assert.equal(providers[1].route, "manual_external_review");
  assert.equal(providers[1].operational, null);
  assert.equal(JSON.stringify(providers).includes("anthropic-secret-never-exposed"), false);
  assert.equal(JSON.stringify(providers).includes("deferred-secret"), false);
});

test("misplaced secrets in provider route/model settings are not echoed", () => {
  const providers = guardianProviders({ REGENT_CLAUDE_PROVIDER: "cnvcaABCDEFGHIJKLMNOPQRSTUV", REGENT_REVIEW_MODEL: "sk-proj-ABCDEFGHIJKLMN" });
  assert.equal(providers[1].requestedRoute, "unsupported_route");
  assert.equal(JSON.stringify(providers).includes("cnvcaABCDEFGHIJKLMNOPQRSTUV"), false);
  assert.equal(JSON.stringify(providers).includes("sk-proj-ABCDEFGHIJKLMN"), false);
});

test("basic check separates configured from operational and does not block on optional Claude", () => {
  const report = buildOrchestraHealth({ depth: "basic", databaseOperational: true,
    requiredNodes: ["A5", "A1"], env: { OPENAI_API_KEY: "never-show-this-key", REGENT_WORKFLOW_SECRET: "never-show-workflow" },
    generatedAt: "2026-10-09T17:00:00.000Z" });
  assert.equal(report.summary.blockingCount, 0);
  assert.equal(report.checks.find((check) => check.id === "provider:openai").operational, null);
  assert.equal(report.checks.find((check) => check.id === "provider:claude").required, false);
  assert.equal(report.nodes.find((node) => node.id === "F12").adapterConnected, false);
  assert.equal(report.nodes.find((node) => node.id === "A6").executionScope, "external_guardian");
  assert.ok(report.links.some((link) => link.id === "canva-shared-account"));
  assert.equal(report.safety.generativeCallsPerformed, false);
  assert.equal(JSON.stringify(report).includes("never-show"), false);
});

test("required unavailable or unknown nodes are explicit blockers", () => {
  const report = buildOrchestraHealth({ depth: "basic", databaseOperational: true,
    requiredNodes: ["F9", "F12", "A6", "F99"], env: { REGENT_WORKFLOW_SECRET: "configured" } });
  for (const node of ["F9", "F12", "F99"]) assert.equal(report.checks.find((check) => check.id === `node:${node}`).blocking, true);
  assert.equal(report.checks.find((check) => check.id === "node:A6").requiresManualReview, true);
  assert.equal(report.checks.find((check) => check.id === "node:A6").operational, null);
  assert.equal(report.summary.blockingCount, 3);
});

test("old succeeded runs are historical evidence, not current connectivity", () => {
  const report = buildOrchestraHealth({ depth: "deep", databaseOperational: true, env: { OPENAI_API_KEY: "present", REGENT_WORKFLOW_SECRET: "present" },
    recentRuns: [{ node_id: "A1", adapter: "openai_agents", status: "succeeded", updated_at: "2026-10-01T10:00:00.000Z" }],
    tasks: [{ id: "mission", status: "executing", updated_at: "2026-10-08T10:00:00.000Z", execution_lease_until: "2026-10-08T10:10:00.000Z" }],
    generatedAt: "2026-10-09T17:00:00.000Z" });
  const worker = report.checks.find((check) => check.id === "node:A1");
  assert.equal(worker.observedSuccessAt, "2026-10-01T10:00:00.000Z");
  assert.equal(worker.operational, null);
  assert.equal(report.summary.expiredExecutions, 1);
  assert.equal(worker.financial, "not_verified");
});

test("known Canva account mismatch blocks only missions requiring Canva", () => {
  const evidence = { configured: true, authenticated: true, authorized: false, operational: false,
    identity: { userId: "new-user", teamId: "new-team" }, identityMatchesStored: false, tokenState: "current",
    detail: "Identidade divergente", action: "Reconectar" };
  const report = buildOrchestraHealth({ depth: "deep", databaseOperational: true, requiredNodes: ["F6"],
    env: { REGENT_WORKFLOW_SECRET: "present" }, canvaEvidence: evidence });
  assert.equal(report.checks.find((check) => check.id === "node:F6").blocking, true);
  const noCanva = buildOrchestraHealth({ depth: "deep", databaseOperational: true, requiredNodes: ["A5"], env: {}, canvaEvidence: evidence });
  assert.equal(noCanva.summary.blockingCount, 0);
});

test("portal JWT can only be forwarded to a configured safe origin without redirects", () => {
  assert.equal(portalOrigin({}), "https://app.optotica.com.br");
  for (const origin of ["https://user:password@app.optotica.com.br", "https://app.optotica.com.br/path", "http://other.example", "file:///tmp/data", "https://app.optotica.com.br?token=bad"]) {
    assert.equal(portalOrigin({ REGENT_PORTAL_ORIGIN: origin }), null);
  }
  assert.equal(portalOrigin({ REGENT_PORTAL_ORIGIN: "http://localhost:3000", NODE_ENV: "production" }), null);
});

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.columns = ""; this.singleRow = false; db.queries.push(this); }
  select(columns, options) { this.columns = columns; this.options = options; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.singleRow = true; return this; }
  then(resolve, reject) { return Promise.resolve(this.db.result(this)).then(resolve, reject); }
}
class Database {
  queries = [];
  fail = null;
  from(table) { return new Query(this, table); }
  result(query) {
    if (this.fail === query.table) return { data: null, error: { message: "unsafe error text should not be reflected" } };
    if (query.table === "regent_tasks" && query.singleRow) return { data: { id: "task-1", pipeline: [{ nodes: ["A1", "F6"] }] }, error: null };
    return { data: [], count: 3, error: null };
  }
}

test("collect basic uses owner-scoped reads and makes no external request", async () => {
  const db = new Database();
  let requests = 0;
  const report = await collectOrchestraHealth({ supabase: db, userId: "owner", depth: "basic", taskId: "task-1",
    env: { OPENAI_API_KEY: "present", REGENT_WORKFLOW_SECRET: "present" }, fetchImpl: async () => { requests++; throw new Error("should not call"); } });
  assert.equal(requests, 0);
  assert.ok(db.queries.every((query) => query.filters.some(([key, value]) => key === "user_id" && value === "owner")));
  assert.deepEqual(report.requiredNodes, ["A1", "F6"]);
});

test("collect fails closed on any query failure without exposing raw database errors", async () => {
  const db = new Database(); db.fail = "regent_tool_runs";
  await assert.rejects(collectOrchestraHealth({ supabase: db, userId: "owner", depth: "deep", env: {},
    fetchImpl: async () => { throw new Error("must not probe after read failure"); } }),
    (error) => error instanceof OrchestraReadError && !error.message.includes("unsafe error text"));
});

test("deep probes are strictly read-only and cannot mark billing or generation verified", async () => {
  const db = new Database();
  const requests = [];
  const report = await collectOrchestraHealth({ supabase: db, userId: "owner", depth: "deep", taskId: "task-1",
    env: { OPENAI_API_KEY: "test-secret-123456", REGENT_WORKFLOW_SECRET: "present" }, accessToken: "current-jwt-never-shown",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === "https://api.openai.com/v1/models") return Response.json({ data: [{ id: "some-model" }], echoedSecret: "test-secret-123456" });
      return Response.json({ canva: { configured: true, authenticated: true, authorized: true, operational: true,
        identity: { userId: "canva-user", teamId: "canva-team" }, identityMatchesStored: true, tokenState: "current", detail: "Identidade lida", action: null },
      echoedJwt: "current-jwt-never-shown" });
    } });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ options }) => options.method === "GET" && options.redirect === "error"));
  assert.equal(report.checks.find((check) => check.id === "provider:openai").authenticated, true);
  assert.equal(report.checks.find((check) => check.id === "provider:openai").operational, null);
  assert.ok(report.checks.every((check) => check.financial === "not_verified"));
  assert.equal(JSON.stringify(report).includes("test-secret-123456"), false);
  assert.equal(JSON.stringify(report).includes("current-jwt-never-shown"), false);
  assert.ok(db.queries.every((query) => query.filters.some(([key, value]) => key === "user_id" && value === "owner")));
  assert.ok(db.queries.filter((query) => query.table === "regent_tool_runs").every((query) => query.filters.some(([key, value]) => key === "task_id" && value === "task-1")));
});

test("health GET does not mutate and Portal identity diagnosis never refreshes or writes OAuth", async () => {
  const route = await readFile(new URL("../app/api/orchestra/health/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.equal(/\.insert\(|\.update\(|\.delete\(|collectOrchestraHealth\(/.test(get), false);
  const portal = await readFile(new URL("../../app/api/internal/regente/canva/health/route.ts", import.meta.url), "utf8");
  assert.equal(/\.insert\(|\.update\(|\.delete\(|\bexchange\(|\baccess\(/.test(portal), false);
  assert.match(portal, /auth\.getUser\(accessToken\)/);
  assert.match(portal, /from\("canva_connections"\)[\s\S]*?eq\("user_id", user\.id\)/);
  assert.match(portal, /"\/users\/me"/);
  assert.equal(portal.includes("refresh_token"), false);
});
