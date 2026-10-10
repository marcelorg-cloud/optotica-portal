import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildGuardianPacket, guardianSpecialistInstructions, guardianSourceCommit, loadGuardianSourceSnapshot, sanitizeGuardianEvidence } from "../lib/guardian-context.ts";

test("dedicated guardians know Regente constitution, limits and attribution", () => {
  const instructions = guardianSpecialistInstructions("openai");
  assert.match(instructions, /especialista.*Regente/);
  assert.match(instructions, /S01.*Mínimo suficiente/);
  assert.match(instructions, /não worker generativo/);
  assert.match(instructions, /DeepSeek.*0.8/);
  assert.match(instructions, /Não afirme.*participou/);
});

test("packet scrubs secret fields, camelCase keys and secrets pasted in outputs", () => {
  const env = { OPENAI_API_KEY: "sensitive-exact-value-1234", REGENT_WORKFLOW_SECRET: "sensitive-workflow-1234" };
  const safe = sanitizeGuardianEvidence({ clientSecret: "unknown-secret", access_token: "other-secret", nested: {
    authorization: "Bearer arbitrary-jwt", output: "sensitive-exact-value-1234 and cnvcaABCDEFGHIJKLMNOPQRSTUV plus ?access_token=hiddenparameter" } }, env);
  const text = JSON.stringify(safe);
  for (const marker of ["unknown-secret", "other-secret", "arbitrary-jwt", "sensitive-exact-value-1234", "cnvcaABCDEFGHIJKLMNOPQRSTUV", "hiddenparameter"]) {
    assert.equal(text.includes(marker), false, marker);
  }
});

test("packet retains evidence, labels manual Claude, and does not fabricate source loaded", () => {
  const packet = buildGuardianPacket({ provider: "claude", env: {}, generatedAt: "2026-10-09T17:00:00.000Z",
    task: { id: "own-task", title: "Segurança jurídica", status: "blocked" },
    steps: [{ step_number: 2, artifact: { result: "Output preservado" } }] });
  assert.match(packet.packetId, /^gp7-[a-f0-9]{24}$/);
  assert.equal(packet.evidence.task.title, "Segurança jurídica");
  assert.equal(packet.provider.automatic, false);
  assert.equal(packet.provider.transport, "human_import");
  assert.equal(packet.reviewContract.automaticApproval, false);
  assert.equal(packet.reviewContract.providerIdentityVerified, false);
  assert.equal(packet.sourceEvidence.completeRelevantSnapshot, false);
  assert.equal(packet.sourceEvidence.includedFiles, 0);
  assert.equal(packet.sourceCommit, null);
});

test("source manifest does not fetch mutable main or sources when deployment commit is unknown", async () => {
  let calls = 0;
  const sources = await loadGuardianSourceSnapshot({ env: { REGENT_REPO_RAW_BASE: "https://raw.githubusercontent.com/marcelorg-cloud/optotica-portal/main" },
    bundledSources: [],
    fetchImpl: async () => { calls++; throw new Error("should not fetch"); } });
  assert.equal(calls, 0);
  assert.ok(sources.every((source) => source.state === "unversioned"));
  assert.equal(guardianSourceCommit({ VERCEL_GIT_COMMIT_SHA: "main" }), null);
  assert.equal(guardianSourceCommit({ VERCEL_GIT_COMMIT_SHA: "a".repeat(40), REGENT_SOURCE_COMMIT: "b".repeat(40) }), "a".repeat(40));
});

test("source snapshot is pinned, finite, secret-redacted and records missing files honestly", async () => {
  const commit = "a".repeat(40);
  const requested = [];
  const sources = await loadGuardianSourceSnapshot({ env: { VERCEL_GIT_COMMIT_SHA: commit }, bundledSources: [],
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      if (url.endsWith("phase-executor.ts")) return new Response("private or unavailable", { status: 404 });
      return new Response("export const v = '0.7'; // cnvcaABCDEFGHIJKLMNOPQRSTUV", { status: 200 });
    } });
  assert.ok(requested.every(({ url, options }) => url.includes(`/${commit}/`) && options.method === "GET" && options.redirect === "error"));
  assert.ok(requested.every(({ url }) => !url.includes(".env")));
  assert.equal(sources.find((source) => source.path.endsWith("phase-executor.ts")).state, "unavailable");
  assert.equal(JSON.stringify(sources).includes("cnvcaABCDEFGHIJKLMNOPQRSTUV"), false);
  const packet = buildGuardianPacket({ provider: "openai", sources, env: { VERCEL_GIT_COMMIT_SHA: commit } });
  assert.equal(packet.sourceEvidence.completeRelevantSnapshot, false);
  assert.ok(packet.sourceEvidence.includedFiles > 0);
});

test("bundled private-repo sources are hash checked and preferred without network fetch", async () => {
  const content = "export const version = '0.7.0';";
  const path = "regente/lib/constitution.ts";
  const env = { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) };
  const calls = [];
  const sources = await loadGuardianSourceSnapshot({ env,
    bundledSources: [{ path, content, sha256: createHash("sha256").update(content).digest("hex") }],
    fetchImpl: async (url) => { calls.push(url); return new Response("Unavailable", { status: 404 }); } });
  assert.equal(sources.find((source) => source.path === path).state, "included");
  assert.equal(sources.find((source) => source.path === path).content, content);
  assert.ok(calls.every((url) => !url.endsWith(path)));
  const invalid = await loadGuardianSourceSnapshot({ env: {}, bundledSources: [{ path, content, sha256: "wrong-hash" }],
    fetchImpl: async () => { throw new Error("must not call"); } });
  assert.equal(invalid.find((source) => source.path === path).state, "unavailable");
});

test("guardian imports are authenticated, user scoped and never authorize execution", async () => {
  const source = await readFile(new URL("../app/api/orchestra/guardians/route.ts", import.meta.url), "utf8");
  assert.match(source, /acknowledgeManualSource !== true/);
  assert.match(source, /source: "human_supplied"/);
  assert.match(source, /providerIdentityVerified: false/);
  assert.match(source, /from\("regent_task_events"\)\.insert/);
  assert.equal(/from\("regent_tasks"\)\.update/.test(source), false);
  assert.equal(/from\("regent_task_steps"\)\.update/.test(source), false);
  assert.match(source, /eq\("task_id", taskId\)\.eq\("user_id", auth\.userId\)/);
  assert.match(source, /event_type: "guardian_review_imported"/);
});
