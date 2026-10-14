#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gpk-release-test-"));
const output = path.join(temporary, "release with spaces");
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json")));
const skillNames = fs.readdirSync(path.join(repo, "plugin/skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() &&
    fs.existsSync(path.join(repo, "plugin/skills", entry.name, "SKILL.md")))
  .map(entry => entry.name).sort();
const readAt = (root, relative) => fs.readFileSync(path.join(root, relative));
const read = relative => readAt(output, relative);
const json = relative => JSON.parse(read(relative));
function packageRelease(source = repo, destination = output, umask = "022", previews = false) {
  // Set umask in the child without changing the test runner's own permissions.
  execFileSync("bash", ["-c", `umask "$1"; exec "$2" scripts/package-release.mjs --output "$3"${previews ? " --previews" : ""}`,
    "release-test", umask, process.execPath, destination], {
    cwd: source, env: { ...process.env, GPK_SOURCE_SHA: "a".repeat(40) }, stdio: "pipe",
  });
}
function checkArchives(root) {
  const sums = readAt(root, "archives/SHA256SUMS");
  const archives = sums.toString().trim().split("\n").map(line => line.split("  "));
  for (const [digest, filename] of archives) {
    assert.equal(createHash("sha256").update(readAt(root, `archives/${filename}`)).digest("hex"), digest);
    const zip = path.join(root, "archives", filename);
    execFileSync("unzip", ["-tq", zip], { stdio: "pipe" });
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    assert.ok(entries.some(file => file.endsWith("SKILL.md")));
    for (const entry of entries) {
      assert.ok(!entry.startsWith("/") && !entry.split("/").includes(".."));
      assert.ok(!entry.includes(".generated-from-gpk"));
    }
  }
  return { sums, names: archives.map(([, filename]) => filename).sort() };
}
function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).sort()
    .filter(file => fs.statSync(path.join(root, file)).isFile())
    .map(file => [file, fs.readFileSync(path.join(root, file)).toString("base64"), fs.statSync(path.join(root, file)).mode & 0o777]);
}
try {
  packageRelease();
  const { sums, names } = checkArchives(output);
  assert.deepEqual(names, [`gpk-claude-${pkg.version}.zip`, `gpk-codex-${pkg.version}.zip`, `gpk-marketplace-${pkg.version}.zip`]);
  for (const preview of ["openclaw", "workbuddy", "skills"]) {
    assert.ok(!fs.existsSync(path.join(output, "marketplace", preview)), `${preview} packaged without --previews`);
  }
  assert.ok(!read("marketplace/README.md").toString().includes("OpenClaw"));
  packageRelease();
  assert.deepEqual(read("archives/SHA256SUMS"), sums, "release archives must be reproducible");
  console.log("PASS: three default release ZIPs, checksums and reproducible rebuilds");

  // Previews are opt-in: the same command with --previews adds the three preview packages.
  const previews = path.join(temporary, "previews");
  packageRelease(repo, previews, "022", true);
  assert.deepEqual(checkArchives(previews).names, [
    ...["claude", "codex", "marketplace", "openclaw", "hermes"]
      .map(target => `gpk-${target}-${pkg.version}.zip`),
    ...skillNames.map(name => `${name}-workbuddy-${pkg.version}.zip`),
  ].sort());
  const { hooks, mcpServers, ...claudePreviewBase } = json("marketplace/claude/gpk/.claude-plugin/plugin.json");
  assert.deepEqual(JSON.parse(readAt(previews, "marketplace/openclaw/gpk/.claude-plugin/plugin.json")), claudePreviewBase);
  assert.ok(!fs.existsSync(path.join(previews, "marketplace/openclaw/gpk/hooks")));
  assert.ok(!fs.existsSync(path.join(previews, "marketplace/openclaw/gpk/.mcp.json")));
  assert.ok(!fs.existsSync(path.join(previews, "marketplace/openclaw/gpk/mcp")));
  for (const name of skillNames) {
    const workbuddy = readAt(previews, `marketplace/workbuddy/${name}/SKILL.md`).toString();
    for (const field of ["name", "description", "description_zh", "description_en", "version", "author"]) {
      assert.match(workbuddy.match(/^---\n([\s\S]*?)\n---\n/)[1], new RegExp(`^${field}: .+`, "m"));
    }
    assert.ok(readAt(previews, `marketplace/skills/${name}/SKILL.md`).length);
    assert.ok(readAt(previews, `marketplace/skills/${name}/references/gpk/knowledge/domain-model.md`).length);
  }
  assert.ok(readAt(previews, "marketplace/README.md").toString().includes("OpenClaw"));
  console.log("PASS: --previews adds OpenClaw, WorkBuddy and Hermes packages with their metadata");

  const claude = json("marketplace/.claude-plugin/marketplace.json").plugins[0];
  const codex = json("marketplace/.agents/plugins/marketplace.json").plugins[0];
  for (const [entry, source, manifest] of [
    [claude, claude.source, ".claude-plugin/plugin.json"],
    [codex, codex.source.path, ".codex-plugin/plugin.json"],
  ]) {
    assert.ok(source.startsWith("./"));
    assert.equal(json(`marketplace/${source}/${manifest}`).name, entry.name);
    assert.equal(json(`marketplace/${source}/${manifest}`).version, pkg.version);
  }
  assert.equal(codex.policy.installation, "AVAILABLE");
  assert.equal(codex.policy.authentication, "ON_INSTALL");
  assert.equal(json("marketplace/release.json").sourceCommit, "a".repeat(40));
  console.log("PASS: marketplace paths and versions");

  // Check extracted bytes and executable modes as well as ZIP integrity/checksums.
  const extracted = path.join(temporary, "extracted");
  execFileSync("unzip", ["-q", path.join(output, "archives", `gpk-marketplace-${pkg.version}.zip`), "-d", extracted]);
  for (const relative of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "claude/gpk/skills/gpk/SKILL.md", "codex/gpk/.codex-plugin/plugin.json"]) {
    assert.deepEqual(fs.readFileSync(path.join(extracted, relative)), read(`marketplace/${relative}`));
  }
  for (const [relative, bytes, mode] of snapshot(extracted)) {
    assert.equal(read(`marketplace/${relative}`).toString("base64"), bytes);
    assert.equal(fs.statSync(path.join(output, "marketplace", relative)).mode & 0o777, mode);
  }
  assert.deepEqual(snapshot(path.join(output, "marketplace")).filter(([name]) => name !== ".generated-from-gpk"), snapshot(extracted));
  console.log("PASS: marketplace archive exactly matches the canonical build tree, including modes");

  for (const host of ["claude", "codex"]) {
    const context = execFileSync(process.execPath, [path.join(extracted, host, "gpk/hooks/entry.mjs"), "SessionStart"],
      { cwd: temporary, input: "{}", encoding: "utf8" });
    assert.equal(JSON.parse(context).hookSpecificOutput.additionalContext,
      fs.readFileSync(path.join(repo, "plugin/rules/routing.md"), "utf8").trim());
  }
  console.log("PASS: extracted release Hook runtimes load their bundled policy without the checkout");

  for (const host of ["claude", "codex"]) {
    const root = path.join(extracted, host, "gpk");
    const config = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    const args = config.mcpServers.gpk.args.map(arg => arg.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, root));
    const client = new Client({ name: "gpk-release-test", version: "1" });
    // Pin the control root to the temporary directory so the test never reads a real ~/.gpk.
    const transport = new StdioClientTransport({ command: process.execPath, args, cwd: temporary, stderr: "pipe",
      env: { PATH: process.env.PATH, HOME: temporary, GPK_CONTROL_ROOT: path.join(temporary, "control") } });
    let diagnostics = "";
    transport.stderr.on("data", chunk => { diagnostics += chunk; });
    try {
      await client.connect(transport, { timeout: 10000 });
      const result = await client.callTool({ name: "gpk_runtime_status", arguments: {} }, { timeout: 10000 });
      assert.equal(result.structuredContent.value.stage, "review-slice");
      assert.equal(result.structuredContent.value.settings, "uninitialized");
      assert.equal(result.isError, false);
      assert.equal(client.getServerVersion().version, pkg.version);
    } finally { await client.close(); }
    assert.equal(diagnostics, "");
  }
  console.log("PASS: extracted release MCP runtimes launch independently and answer status requests");

  fs.mkdirSync(path.join(output, "types"));
  fs.writeFileSync(path.join(output, "types/keep.d.ts"), "export type Keep = string;\n");
  const typeFiles = snapshot(path.join(output, "types"));
  const archiveFiles = snapshot(path.join(output, "archives"));
  execFileSync(process.execPath, ["scripts/build-plugins.mjs", "--output", path.join(output, "marketplace")], {
    cwd: repo, env: { ...process.env, GPK_SOURCE_SHA: "a".repeat(40) }, stdio: "pipe",
  });
  assert.deepEqual(snapshot(path.join(output, "archives")), archiveFiles);
  packageRelease();
  assert.deepEqual(snapshot(path.join(output, "types")), typeFiles);
  assert.deepEqual(snapshot(path.join(output, "archives")), archiveFiles);
  console.log("PASS: build and release share one marketplace and preserve sibling type/archive output");

  const fixture = path.join(temporary, "executable-repo");
  fs.mkdirSync(fixture);
  for (const entry of ["scripts", "platforms", "plugin", "src", "package.json", "LICENSE", "tsconfig.json", "tsconfig.hooks.json"]) {
    fs.cpSync(path.join(repo, entry), path.join(fixture, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(fixture, "node_modules"), "dir");
  for (const name of skillNames) {
    const probe = path.join(fixture, "plugin/skills", name, "scripts/probe.sh");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, '#!/bin/sh\nprintf "archive executable\\n"\n');
    fs.chmodSync(probe, 0o755);
  }
  const permissive = path.join(temporary, "umask-022");
  const restrictive = path.join(temporary, "umask-077");
  packageRelease(fixture, permissive, "022", true);
  packageRelease(fixture, restrictive, "077", true);
  assert.deepEqual(fs.readFileSync(path.join(permissive, "archives/SHA256SUMS")), fs.readFileSync(path.join(restrictive, "archives/SHA256SUMS")));
  for (const filename of fs.readdirSync(path.join(restrictive, "archives")).filter(file => file.endsWith(".zip"))) {
    const unpacked = path.join(temporary, filename);
    execFileSync("unzip", ["-q", path.join(restrictive, "archives", filename), "-d", unpacked]);
    const scripts = fs.readdirSync(unpacked, { recursive: true }).filter(file => file.endsWith("/probe.sh"));
    assert.ok(scripts.length > 0, `missing executable in ${filename}`);
    for (const script of scripts) {
      assert.equal(execFileSync(path.join(unpacked, script), [], { encoding: "utf8" }), "archive executable\n");
    }
  }
  const distributed = path.join(restrictive, "marketplace/codex/gpk/skills/gpk/scripts/probe.sh");
  assert.equal(execFileSync(distributed, [], { encoding: "utf8" }), "archive executable\n");
  console.log("PASS: executable resources survive every ZIP and umask does not change archive bytes");
  // Both generated owners must be validated before committing either one.
  fs.appendFileSync(path.join(fixture, "plugin/skills/gpk/SKILL.md"), "\nChanged source fixture.\n");
  const archive = fs.readdirSync(path.join(restrictive, "archives")).find(file => file.endsWith(".zip"));
  fs.appendFileSync(path.join(restrictive, "archives", archive), "manual archive change");
  const before = snapshot(restrictive);
  assert.throws(() => packageRelease(fixture, restrictive, "077", true), /modified output file/);
  assert.deepEqual(snapshot(restrictive), before);
  const skill = path.join(permissive, "marketplace/codex/gpk/skills/gpk/SKILL.md");
  fs.appendFileSync(skill, "manual marketplace change");
  const beforeMarketplaceFailure = snapshot(permissive);
  assert.throws(() => packageRelease(fixture, permissive, "022", true), /modified output file/);
  assert.deepEqual(snapshot(permissive), beforeMarketplaceFailure);
  console.log("PASS: modified archives or marketplace files reject release without partial output updates");

} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
