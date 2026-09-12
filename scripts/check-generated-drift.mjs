#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const committedRoot = path.join(repoRoot, "adapters", "codex");
const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gpk-adapter-"));
const generatedRoot = path.join(temporaryRoot, "codex");

function snapshot(root) {
  const result = new Map();
  if (!fs.existsSync(root)) return result;

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile()) {
        result.set(path.relative(root, fullPath), fs.readFileSync(fullPath));
      }
    }
  }

  visit(root);
  return result;
}

try {
  execFileSync(
    process.execPath,
    ["scripts/build-platform-adapters.mjs", "--output", generatedRoot],
    { cwd: repoRoot, stdio: "ignore" },
  );

  const committed = snapshot(committedRoot);
  const generated = snapshot(generatedRoot);
  const allPaths = [...new Set([...committed.keys(), ...generated.keys()])].sort();
  const differences = allPaths.filter((relativePath) => {
    const left = committed.get(relativePath);
    const right = generated.get(relativePath);
    return !left || !right || !left.equals(right);
  });

  if (differences.length > 0) {
    console.error("FAIL: adapters/codex differs from canonical plugin source:");
    for (const relativePath of differences) console.error(`- ${relativePath}`);
    console.error("Run npm run build:adapters and commit the generated result.");
    process.exitCode = 1;
  } else {
    console.log("PASS: generated Codex adapter matches canonical source");
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
