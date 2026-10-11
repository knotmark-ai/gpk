#!/usr/bin/env node

// Optional local CLI checks: no installs, model requests, or backend calls.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" },
  });
}
function installed(command) {
  const result = run(command, ["--version"]);
  if (result.error?.code === "ENOENT") {
    console.log(`SKIP: ${command} is not installed`);
    return false;
  }
  if (result.error || result.status !== 0) {
    console.error(`FAIL: ${command} version check: ${result.error?.message ?? result.stderr}`);
    process.exitCode = 1;
    return false;
  }
  console.log(result.stdout.trim());
  return true;
}

if (installed("claude")) {
  for (const target of ["dist/marketplace/claude/gpk", "dist/marketplace/.claude-plugin/marketplace.json", "dist/marketplace/claude/gpk/skills"]) {
    const result = run("claude", ["plugin", "validate", target]);
    if (result.error || result.status !== 0) {
      console.error(`FAIL: Claude validation for ${target}: ${result.error?.message ?? result.stderr}`);
      if (result.stdout) console.error(result.stdout.trim());
      process.exitCode = 1;
    } else {
      console.log(`PASS: Claude package validation for ${target}`);
      if (result.stdout) console.log(result.stdout.trim());
    }
  }
}
// Discovering the CLI command only establishes its presence, not package/session validity.
if (installed("codex")) {
  const result = run("codex", ["plugin", "--help"]);
  if (result.error || result.status !== 0) {
    console.error(`FAIL: Codex plugin command unavailable: ${result.error?.message ?? result.stderr}`);
    process.exitCode = 1;
  } else {
    console.log("PASS: Codex CLI exposes plugin management");
    console.log("SKIP: Codex CLI has no package-validation subcommand; use package checks and the official plugin validator.");
  }
}
console.log("These checks do not install plugins or validate live Skill invocation or Craft behavior.");
