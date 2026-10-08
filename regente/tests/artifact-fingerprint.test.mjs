import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const source = fs.readFileSync(new URL("../lib/artifact-fingerprint.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require });
const { artifactFingerprint } = module.exports;

test("artifact fingerprint ignores object key order", () => {
  const left = [{ step: 1, output: { title: "x", pages: [{ width: 1080, height: 1920 }] } }];
  const right = [{ output: { pages: [{ height: 1920, width: 1080 }], title: "x" }, step: 1 }];
  assert.equal(artifactFingerprint(left), artifactFingerprint(right));
});

test("artifact fingerprint preserves array order", () => {
  assert.notEqual(artifactFingerprint([1, 2]), artifactFingerprint([2, 1]));
});
