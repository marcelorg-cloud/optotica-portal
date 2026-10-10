import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerInput } from "../lib/text-worker-context.ts";
import { failureDisposition } from "../lib/phase-control.ts";

test("A2 approval gate uses textual evidence without protected media or signed URLs", () => {
  const signed = "https://export-download.canva.com/image.png?X-Amz-Signature=private-signature";
  const opaque = "https://www.canva.com/api/design/opaque-credential/edit";
  const official = "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm";
  const prompt = `Evento gratuito. CTA: inscreva-se. Fonte: ${official} Preview: ${signed} Edit: ${opaque}`;
  const payload = buildWorkerInput("A2", prompt, [signed]);
  assert.equal(typeof payload, "string");
  assert.match(payload, /Evento gratuito/);
  assert.ok(payload.includes(official));
  assert.ok(!payload.includes(signed) && !payload.includes("private-signature") && !payload.includes("opaque-credential"));
  assert.match(payload, /acesso visual não verificado/);
  assert.ok(prompt.includes(signed), "original persisted evidence is not mutated");
});
test("visual A3 keeps image input; inaccessible media is not retried or sent to paid recovery", () => {
  const image = "https://media.example.org/preview.png";
  const payload = buildWorkerInput("A3", "Auditar criativo", [image]);
  assert.equal(payload[0].content[1].type, "input_image");
  assert.equal(payload[0].content[1].image, image);
  const failure = failureDisposition(Object.assign(new Error("400 Error while downloading file. Upstream status code: 403."), { status: 400 }), "A2");
  assert.equal(failure.kind, "media_access");
  assert.equal(failure.retry, false);
  assert.ok(!["unknown", "transient"].includes(failure.kind));
  assert.equal(failureDisposition(new Error("Error while downloading file"), "F6", "create").kind, "external_effect_unknown");
});
