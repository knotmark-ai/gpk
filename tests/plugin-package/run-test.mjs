#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "gpk-package-test-"),
);
const errors = [];
let passed = 0;

function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    errors.push(name);
    console.error(`FAIL: ${name}: ${error.message}`);
  }
}

function snapshot(root) {
  const entries = [];
  if (!fs.existsSync(root) && !fs.lstatSync(root, { throwIfNoEntry: false })) {
    return entries;
  }
  function visit(fullPath, relativePath) {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      entries.push([relativePath, "symlink", fs.readlinkSync(fullPath)]);
    } else if (stat.isDirectory()) {
      entries.push([relativePath, "directory"]);
      for (const name of fs.readdirSync(fullPath).sort()) {
        visit(path.join(fullPath, name), path.join(relativePath, name));
      }
    } else {
      entries.push([relativePath, "file", fs.readFileSync(fullPath).toString("base64")]);
    }
  }
  visit(root, ".");
  return entries;
}

function build(builderRepo, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(builderRepo, "scripts/build-platform-adapters.mjs"), ...args],
    { cwd: builderRepo, encoding: "utf8", timeout: 30_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, `builder terminated by ${result.signal}`);
  return result;
}

function buildSuccessfully(builderRepo, output) {
  const result = build(builderRepo, ["--output", output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function markdownFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), `package contains symlink: ${fullPath}`);
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

function validateMarkdownClosure(root) {
  let linkCount = 0;
  for (const file of markdownFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = match[1].trim();
      const target = raw.startsWith("<")
        ? raw.slice(1, raw.indexOf(">"))
        : raw.replace(/\s+["'][\s\S]*$/, "");
      if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue;
      }
      assert.ok(!path.isAbsolute(target), `absolute local link in ${file}: ${target}`);
      const localTarget = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      if (!localTarget) continue;
      const resolved = path.resolve(path.dirname(file), localTarget);
      const relative = path.relative(root, resolved);
      assert.ok(
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `link escapes isolated package in ${file}: ${target}`,
      );
      assert.ok(fs.existsSync(resolved), `missing packaged reference in ${file}: ${target}`);
      linkCount += 1;
    }
  }
  assert.ok(linkCount > 0, `no local documentation links exercised in ${root}`);
}

function discoverSkills(root) {
  return fs.readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      fs.existsSync(path.join(root, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name).sort();
}

// Unsafe-path regression cases run against a disposable copy, not the user's repo.
function fixtureRepo(name) {
  const fixtureRoot = path.join(temporaryRoot, name);
  const clone = path.join(fixtureRoot, "repo");
  fs.mkdirSync(path.join(clone, "scripts"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "plugin"), path.join(clone, "plugin"), { recursive: true });
  for (const name of ["package.json", "LICENSE"]) {
    fs.copyFileSync(path.join(repoRoot, name), path.join(clone, name));
  }
  fs.copyFileSync(
    path.join(repoRoot, "scripts/build-platform-adapters.mjs"),
    path.join(clone, "scripts/build-platform-adapters.mjs"),
  );
  return { fixtureRoot, clone };
}

function rejectWithoutChanges(clone, args, observedRoot) {
  const before = snapshot(observedRoot);
  const result = build(clone, args);
  const after = snapshot(observedRoot);
  assert.deepEqual(after, before, "rejected build changed fixture content");
  assert.notEqual(result.status, 0, "unsafe build unexpectedly succeeded");
}

try {
  const codexPackage = path.join(temporaryRoot, "fresh path with spaces", "gpk");
  test("fresh Codex package is deterministic across rebuilds", () => {
    buildSuccessfully(repoRoot, codexPackage);
    assert.ok(fs.existsSync(path.join(codexPackage, ".generated-from-gpk")));
    const first = snapshot(codexPackage);
    buildSuccessfully(repoRoot, codexPackage);
    assert.deepEqual(snapshot(codexPackage), first);
  });

  test("an existing empty output directory is accepted", () => {
    const output = path.join(temporaryRoot, "empty output");
    fs.mkdirSync(output);
    buildSuccessfully(repoRoot, output);
    assert.deepEqual(snapshot(output), snapshot(codexPackage));
  });

  const claudePackage = path.join(temporaryRoot, "isolated claude", "gpk");
  test("Claude package references remain inside its isolated install root", () => {
    fs.cpSync(path.join(repoRoot, "plugin"), claudePackage, { recursive: true });
    validateMarkdownClosure(claudePackage);
  });

  test("Codex package and individual Skills have closed local references", () => {
    validateMarkdownClosure(codexPackage);
    const skillsRoot = path.join(codexPackage, "skills");
    const skillNames = fs.readdirSync(skillsRoot);
    assert.ok(skillNames.length > 0);
    for (const name of skillNames) validateMarkdownClosure(path.join(skillsRoot, name));
  });

  test("workflow placeholders do not become installed Skills", () => {
    for (const root of [claudePackage, codexPackage]) {
      assert.deepEqual(discoverSkills(root), ["gpk"]);
    }
    const stubs = fs.readdirSync(path.join(claudePackage, "skills"))
      .filter((name) => fs.existsSync(path.join(claudePackage, "skills", name, "SKILL.md.stub")))
      .sort();
    assert.deepEqual(stubs, ["gpk-ingest", "gpk-plan", "gpk-review", "gpk-setup", "gpk-work"]);
    const placeholderEntries = snapshot(codexPackage)
      .filter(([name]) => name.endsWith(".stub") || path.basename(name) === ".gitkeep");
    assert.deepEqual(placeholderEntries, [], "Codex package includes inactive scaffold resources");
  });

  test("both packages carry current runtime references without obsolete drafts", () => {
    const roots = [
      claudePackage,
      path.join(codexPackage, "skills/gpk/references/gpk"),
    ];
    for (const root of roots) {
      for (const relative of [
        "runtime/contracts/adapters.md",
        "runtime/references/bootstrap.md",
        "runtime/adapters/knowledge/craft/mapping.md",
        "runtime/adapters/harness/codex/mapping.md",
        "runtime/adapters/harness/claude-code/mapping.md",
      ]) assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
      const obsolete = [
        "migration.md",
        "stores/craft.md",
        ...["daily-note", "entity", "goal", "output", "project", "source", "wiki-note"]
          .map((name) => `templates/${name}.md`),
      ];
      for (const resource of obsolete) {
        for (const relative of [`knowledge/${resource}`, `knowledge/legacy/${resource}`]) {
          assert.ok(!fs.existsSync(path.join(root, relative)), `obsolete resource packaged: ${relative}`);
        }
      }
    }
    for (const skillRoot of [
      path.join(claudePackage, "skills/gpk"),
      path.join(codexPackage, "skills/gpk"),
    ]) {
      assert.ok(!fs.existsSync(path.join(skillRoot, "references/bootstrap.md")),
        "obsolete Skill-local bootstrap redirect packaged");
    }
  });

  test("runtime code imports and Markdown references survive standalone packaging", () => {
    const { clone, fixtureRoot } = fixtureRepo("runtime-resources");
    const source = path.join(clone, "plugin");
    const write = (relative, content) => {
      const file = path.join(source, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write("runtime/lib/package-fixture.mjs", "export const result = 'portable runtime';\n");
    write("runtime/scripts/package-fixture.mjs",
      "import { result } from '../lib/package-fixture.mjs';\nconsole.log(result);\n");
    write("assets/package fixture.txt", "portable asset\n");
    write("runtime/references/package-fixture.md", [
      "# Packaging fixture",
      "[Run](../scripts/package-fixture.mjs)",
      "[Asset](../../assets/package%20fixture.txt#example)",
      "[Model](../../knowledge/domain-model.md)",
      "",
    ].join("\n"));
    fs.appendFileSync(path.join(source, "skills/gpk/SKILL.md"),
      "\n[Fixture](../../runtime/references/package-fixture.md)\n");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    validateMarkdownClosure(output);
    const skillRoot = path.join(output, "skills/gpk");
    validateMarkdownClosure(skillRoot);
    const script = path.join(skillRoot, "references/gpk/runtime/scripts/package-fixture.mjs");
    assert.equal(fs.readFileSync(script, "utf8"),
      fs.readFileSync(path.join(source, "runtime/scripts/package-fixture.mjs"), "utf8"));
    const result = spawnSync(process.execPath, [script], {
      cwd: fixtureRoot, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "portable runtime\n");
    assert.equal(fs.readFileSync(path.join(skillRoot, "references/gpk/assets/package fixture.txt"), "utf8"),
      "portable asset\n");
  });

  test("unavailable, excluded and out-of-package references fail before writing", () => {
    for (const mode of ["missing", "stub", "outside"]) {
      const { clone, fixtureRoot } = fixtureRepo(`reference-${mode}`);
      const output = path.join(fixtureRoot, "generated");
      buildSuccessfully(clone, output);
      const target = mode === "missing"
        ? "../../runtime/references/not-present.md"
        : mode === "stub"
          ? "../../runtime/references/context.md.stub"
          : "../../../outside-note.md";
      if (mode === "outside") {
        fs.writeFileSync(path.join(clone, "outside-note.md"), "not part of plugin install root\n");
      }
      fs.appendFileSync(path.join(clone, "plugin/skills/gpk/SKILL.md"), `\n[Invalid](${target})\n`);
      rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
    }
  });

  test("both install roots include the canonical license", () => {
    const license = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
    for (const root of [claudePackage, codexPackage]) {
      assert.equal(fs.readFileSync(path.join(root, "LICENSE"), "utf8"), license);
    }
  });

  test("Codex starter prompts satisfy the manifest contract", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(codexPackage, ".codex-plugin/plugin.json"), "utf8"),
    );
    const prompts = manifest.interface.defaultPrompt;
    assert.ok(Array.isArray(prompts), "interface.defaultPrompt must be an array");
    assert.ok(prompts.length > 0 && prompts.length <= 3);
    for (const prompt of prompts) {
      assert.equal(typeof prompt, "string");
      assert.ok(prompt.trim().length > 0 && prompt.length <= 128);
    }
  });

  test("unmarked nonempty output is rejected without deleting user files", () => {
    const { clone, fixtureRoot } = fixtureRepo("unmarked");
    const output = path.join(fixtureRoot, "unrelated output");
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "user-note.txt"), "preserve this unrelated note\n");
    rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
  });

  test("unexpected files in marked output are preserved and rejected", () => {
    const { clone, fixtureRoot } = fixtureRepo("unexpected-file");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    fs.writeFileSync(path.join(output, "user-note.txt"), "not owned by the generator\n");
    rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
  });

  test("repo, source, ancestor and other repo paths are rejected safely", () => {
    for (const relative of ["repo", "repo/plugin", "repo/plugin/knowledge", ".", "repo/docs"]) {
      const { clone, fixtureRoot } = fixtureRepo(`protected-${relative.replaceAll("/", "-").replaceAll(".", "parent")}`);
      fs.mkdirSync(path.join(clone, "docs"));
      fs.writeFileSync(path.join(clone, "docs/user-note.txt"), "preserve repo documents\n");
      rejectWithoutChanges(clone, ["--output", path.resolve(fixtureRoot, relative)], fixtureRoot);
    }
  });

  test("unknown and malformed arguments cannot modify default output", () => {
    for (const args of [["--unknown"], ["--output"], ["unexpected-positional"]]) {
      const { clone, fixtureRoot } = fixtureRepo(`arguments-${args[0].replaceAll("-", "")}`);
      rejectWithoutChanges(clone, args, fixtureRoot);
    }
  });

  test("symlink outputs, ancestors and entries are rejected without writes", () => {
    for (const mode of ["output", "ancestor", "entry"]) {
      const { clone, fixtureRoot } = fixtureRepo(`symlink-${mode}`);
      const destination = path.join(fixtureRoot, "unrelated");
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, "user-note.txt"), "preserve symlink destination\n");
      const output = path.join(fixtureRoot, "output");
      let target = output;
      if (mode === "entry") {
        buildSuccessfully(clone, output);
        fs.symlinkSync(destination, path.join(output, "linked-content"), "dir");
      } else {
        fs.symlinkSync(destination, output, "dir");
        if (mode === "ancestor") target = path.join(output, "nested-package");
      }
      rejectWithoutChanges(clone, ["--output", target], fixtureRoot);
    }
  });
} finally {
  // Only the unique temporary fixture tree owned by this process is removed.
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} isolated packaging check(s); ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${passed} isolated packaging checks (not live client or Craft conformance)`);
}
