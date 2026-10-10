import test from "node:test";
import assert from "node:assert/strict";
import { buildArtifactOutputs, artifactDocument, artifactLinks } from "../lib/artifact-outputs.ts";

test("download is complete, preview bounded, historic revisions and runs remain visible", () => {
  const full = "X".repeat(80000) + "COMPLETE_END";
  const items = buildArtifactOutputs({ taskId: "owned", steps: [{ step_number: 2, revision: 2, status: "succeeded", artifact: { result: full }, node_ids: ["A1"] }],
    runs: [{ id: "r1", step_number: 2, status: "succeeded", input: { stepRevision: 1 }, output: { result: "original" } }],
    reviews: [{ id: "v1", step_number: 2, revision: 1, decision: "superseded", output: { result: "original" } }] });
  assert.equal(items.length, 3);
  assert.equal(items[0].revision, 2);
  assert.equal(items[0].truncated, true);
  assert.equal(items[0].content.includes("COMPLETE_END"), false);
  assert.equal(items[0].fullContent.endsWith("COMPLETE_END"), true);
  assert.equal(items[0].downloadUrl, "/api/tasks/owned/outputs?download=step-2-v2");
});
test("partial effects stay visible, deferred phase is not represented as a finished file", () => {
  const items = buildArtifactOutputs({ taskId: "owned", steps: [{ step_number: 1, artifact: { deferred: true }, status: "skipped" }], reviews: [],
    runs: [{ id: "partial", step_number: 3, status: "failed", output: { designs: [{ id: "DAreal", editUrl: "https://www.canva.com/design/DAreal/edit" }] } }] });
  assert.equal(items.length, 1); assert.equal(items[0].status, "failed");
  assert.deepEqual(items[0].links, ["https://www.canva.com/design/DAreal/edit"]);
});
test("secret fields and credentials in outputs are masked without fetching external URLs", () => {
  const text = artifactDocument({ result: "cnvcaABCDEFGHIJKLMNOPQRSTUV", clientSecret: "hidden-value", authorization: "Bearer secret", source: "valid evidence" });
  assert.equal(text.includes("hidden-value"), false);
  assert.equal(text.includes("cnvcaABCDEFGHIJKLMNOPQRSTUV"), false);
  assert.equal(text.includes("valid evidence"), true);
  assert.deepEqual(artifactLinks("https://example.org/doc https://example.org/?access_token=abc https://user:pass@example.org/"), ["https://example.org/doc"]);
});
