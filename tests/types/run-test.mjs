#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Compile the fixtures without executing them. @ts-expect-error also fails when
// an invalid call becomes accepted, so accidental contract widening is detected.
execFileSync(path.join(repo, "node_modules/.bin/tsc"), ["-p", "tests/types/tsconfig.json"], { cwd: repo, stdio: "inherit" });
console.log("PASS: source and emitted contracts accept valid consumers and reject invalid calls");
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gpk-type-test-"));
const fixture = path.join(temporary, "repo");
function build() {
  return spawnSync(process.execPath, ["scripts/build-types.mjs"], { cwd: fixture, encoding: "utf8", timeout: 30_000 });
}
function snapshot() {
  const output = path.join(fixture, "dist/types");
  return fs.readdirSync(output, { recursive: true }).sort()
    .filter(file => fs.statSync(path.join(output, file)).isFile())
    .map(file => [file, fs.readFileSync(path.join(output, file)).toString("base64")]);
}
function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
try {
  fs.mkdirSync(fixture);
  for (const file of ["src", "scripts/build-types.mjs", "scripts/lib/generated-files.mjs", "scripts/lib/paths.mjs", "package.json", "tsconfig.json", "tsconfig.build.json"]) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.cpSync(path.join(repo, file), path.join(fixture, file), { recursive: true });
  }
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(fixture, "node_modules"), "dir");
  fs.writeFileSync(path.join(fixture, "src/retired.ts"), "export type Retired = string;\n");
  success(build());
  assert.ok(snapshot().filter(([file]) => file !== ".generated-from-gpk").every(([file]) => file.endsWith(".d.ts")));
  const first = snapshot();
  success(build());
  assert.deepEqual(snapshot(), first);
  fs.unlinkSync(path.join(fixture, "src/retired.ts"));
  success(build());
  assert.ok(!fs.existsSync(path.join(fixture, "dist/types/retired.d.ts")));
  // Induce failure only in the disposable source tree and compare the last valid output.
  const valid = snapshot();
  fs.writeFileSync(path.join(fixture, "src/invalid.ts"), "export type Invalid = MissingType;\n");
  const failed = build();
  assert.ifError(failed.error);
  assert.notEqual(failed.status, 0);
  assert.deepEqual(snapshot(), valid);
  console.log("PASS: declaration builds are reproducible, prune stale types and preserve output on compiler errors");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
