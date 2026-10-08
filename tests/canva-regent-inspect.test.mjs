import assert from "node:assert/strict";
import test from "node:test";
import { designIdsFromRegentRuns } from "../lib/canva/regent-provenance.ts";

test("extrai somente IDs Canva persistidos em runs aprovados", () => {
  assert.deepEqual(
    designIdsFromRegentRuns([
      { output: { design_id: "DAHXL2SPnV4" } },
      { output: { designs: [{ id: "DAHXLzZyEqk" }, { id: "DAHXL2SPnV4" }] } },
      { output: { designs: [{ title: "sem id" }, null] } },
    ]).sort(),
    ["DAHXL2SPnV4", "DAHXLzZyEqk"].sort(),
  );
});

test("ignora estruturas arbitrárias que não representam design", () => {
  assert.deepEqual(designIdsFromRegentRuns([
    { output: { id: "nao-autorizado", nested: { design_id: "tambem-nao" } } },
    { output: null },
  ]), []);
});
