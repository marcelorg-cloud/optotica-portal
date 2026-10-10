import test from "node:test";
import assert from "node:assert/strict";
import { validatePhasePatch } from "../lib/phase-patch.ts";
test("human patch limits execution to one real adapter and never accepts arbitrary payload fields", () => {
  assert.deepEqual(validatePhasePatch({ nodes: ["A4"] }), { nodes: ["A4"] });
  assert.throws(() => validatePhasePatch({ nodes: ["A2", "A3"] }), /somente um/);
  assert.throws(() => validatePhasePatch({ nodes: ["A1"], user_id: "other" }), /não autorizados/);
  assert.throws(() => validatePhasePatch({ nodes: ["F6"], canvaMode: "inspect", canvaDesignIds: ["FAKE"] }), /IDs/);
  assert.deepEqual(validatePhasePatch({ nodes: ["F6"], canvaMode: "inspect", canvaSourceRunIds: ["11111111-1111-1111-1111-111111111111"], canvaDesignIds: ["DAvalid123"] }).canvaDesignIds, ["DAvalid123"]);
});
