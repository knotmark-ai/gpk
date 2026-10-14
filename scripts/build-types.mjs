#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot as repo, typesRoot as output } from "./lib/paths.mjs";
import { assertOutput, prepareWrite, walkFiles } from "./lib/generated-files.mjs";

assertOutput(output, repo, output);
// Compile outside dist first; a compiler failure must preserve the last valid declarations.
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gpk-types-"));
try {
  execFileSync(path.join(repo, "node_modules/.bin/tsc"), ["-p", "tsconfig.build.json", "--outDir", temporary], { cwd: repo, stdio: "inherit" });
  const files = new Map(walkFiles(temporary).map(file => [path.relative(temporary, file), fs.readFileSync(file)]));
  prepareWrite(output, files)();
  console.log(`Built domain and port declarations at ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
