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

// Capture empty directories, link targets, bytes and modes without following links;
// a rejected build must preserve all of them, not merely return a failing exit code.
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
      entries.push([relativePath, "file", fs.readFileSync(fullPath).toString("base64"), stat.mode & 0o777]);
    }
  }
  visit(root, ".");
  return entries;
}

function build(builderRepo, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(builderRepo, "scripts/build-plugins.mjs"), ...args],
    { cwd: builderRepo, encoding: "utf8", timeout: 30_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, `builder terminated by ${result.signal}`);
  return result;
}

function buildSuccessfully(builderRepo, output, target = "codex") {
  const result = build(builderRepo, ["--output", output, "--target", target]);
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

// Check each link against the isolated install root so it cannot reach the checkout.
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
  for (const name of ["package.json", "LICENSE", "tsconfig.json", "tsconfig.hooks.json"]) {
    fs.copyFileSync(path.join(repoRoot, name), path.join(clone, name));
  }
  for (const directory of ["scripts", "platforms", "src"]) {
    fs.cpSync(path.join(repoRoot, directory), path.join(clone, directory), { recursive: true });
  }
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(clone, "node_modules"), "dir");
  fs.mkdirSync(path.join(clone, "plugin/assets"), { recursive: true });
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
  const codexOutput = path.join(temporaryRoot, "fresh path with spaces");
  const codexPackage = path.join(codexOutput, "codex/gpk");
  test("fresh Codex package is deterministic across rebuilds", () => {
    buildSuccessfully(repoRoot, codexOutput);
    assert.ok(fs.existsSync(path.join(codexOutput, ".generated-from-gpk")));
    const first = snapshot(codexPackage);
    buildSuccessfully(repoRoot, codexOutput);
    assert.deepEqual(snapshot(codexPackage), first);
  });

  test("an existing empty output directory is accepted", () => {
    const output = path.join(temporaryRoot, "empty output");
    fs.mkdirSync(output);
    buildSuccessfully(repoRoot, output);
    assert.deepEqual(snapshot(path.join(output, "codex/gpk")), snapshot(codexPackage));
  });

  const claudeOutput = path.join(temporaryRoot, "isolated claude");
  const claudePackage = path.join(claudeOutput, "claude/gpk");
  test("Claude package references remain inside its isolated install root", () => {
    buildSuccessfully(repoRoot, claudeOutput, "claude");
    validateMarkdownClosure(claudePackage);
  });

  test("both packages and individual Skills have closed local references", () => {
    for (const root of [claudePackage, codexPackage]) {
      validateMarkdownClosure(root);
      for (const name of discoverSkills(root)) {
        validateMarkdownClosure(path.join(root, "skills", name));
      }
    }
  });

  test("all six foundation Skills are installed", () => {
    for (const root of [claudePackage, codexPackage]) {
      assert.deepEqual(discoverSkills(root), [
        "gpk", "gpk-ingest", "gpk-plan", "gpk-review", "gpk-setup", "gpk-work",
      ]);
    }
  });

  test("each Codex Skill carries its own presentation and invocation prompt", () => {
    for (const name of discoverSkills(codexPackage)) {
      const presentation = name === "gpk" ? "openai.yaml" : `${name}.yaml`;
      const expected = fs.readFileSync(path.join(repoRoot, "platforms/codex", presentation), "utf8");
      const actual = fs.readFileSync(path.join(codexPackage, "skills", name, "agents/openai.yaml"), "utf8");
      assert.equal(actual, expected);
      const prompt = actual.match(/default_prompt: "(.*)"/)?.[1];
      assert.ok(prompt?.includes(`$${name} `), `prompt does not invoke ${name}`);
      const description = actual.match(/short_description: "(.*)"/)?.[1];
      assert.ok(description?.length >= 25 && description.length <= 64,
        `invalid presentation description for ${name}`);
    }
  });

  test("both packages carry only Agent-facing content", () => {
    const roots = [
      path.join(claudePackage, "skills/gpk/references/gpk"),
      path.join(codexPackage, "skills/gpk/references/gpk"),
    ];
    for (const root of roots) {
      for (const relative of [
        "guides/bootstrap.md",
        "guides/templates.md",
        "knowledge/domain-model.md",
        "assets/templates/project.md",
      ]) assert.ok(fs.existsSync(path.join(root, relative)), `missing ${relative}`);
      // Design contracts and acceptance inventories live in docs/ and stay out of packages.
      for (const relative of [
        "guides/storage-contracts.md",
        "guides/workflow-design.md",
        "knowledge/conformance-scenarios.md",
      ]) assert.ok(!fs.existsSync(path.join(root, relative)), `developer material packaged: ${relative}`);
      for (const developmentTree of ["runtime", "src", "docs"]) {
        assert.ok(!fs.existsSync(path.join(root, developmentTree)), `developer material packaged: ${developmentTree}`);
      }
    }
  });

  test("six role defaults and both languages survive every isolated Skill install", () => {
    for (const root of [claudePackage, codexPackage]) {
      for (const name of discoverSkills(root)) {
        for (const role of ["area", "project", "task", "source", "wiki", "output"]) {
          for (const suffix of [".md", ".zh-CN.md"]) {
            const relative = `assets/templates/${role}${suffix}`;
            const installed = path.join(root, "skills", name, "references/gpk", relative);
            const canonical = path.join(repoRoot, "plugin", relative);
            assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(canonical),
              `${name} loses or changes ${relative}`);
          }
        }
      }
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
    write("skills/gpk/lib/package-fixture.mjs", "export const result = 'portable runtime';\n");
    write("skills/gpk/scripts/package-fixture.mjs",
      "import { result } from '../lib/package-fixture.mjs';\nconsole.log(result);\n");
    write("assets/package fixture.txt", "portable asset\n");
    write("skills/gpk/references/package-fixture.md", [
      "# Packaging fixture",
      "[Run](../scripts/package-fixture.mjs)",
      "[Asset](../../../assets/package%20fixture.txt#example)",
      "[Model](../../../knowledge/domain-model.md)",
      "",
    ].join("\n"));
    fs.appendFileSync(path.join(source, "skills/gpk/SKILL.md"),
      "\n[Fixture](references/package-fixture.md)\n");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    validateMarkdownClosure(output);
    const skillRoot = path.join(output, "codex/gpk/skills/gpk");
    validateMarkdownClosure(skillRoot);
    const script = path.join(skillRoot, "scripts/package-fixture.mjs");
    assert.equal(fs.readFileSync(script, "utf8"),
      fs.readFileSync(path.join(source, "skills/gpk/scripts/package-fixture.mjs"), "utf8"));
    const result = spawnSync(process.execPath, [script], {
      cwd: fixtureRoot, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "portable runtime\n");
    assert.equal(fs.readFileSync(path.join(skillRoot, "references/gpk/assets/package fixture.txt"), "utf8"),
      "portable asset\n");
  });

  test("unavailable and out-of-package references fail before writing", () => {
    for (const mode of ["missing", "outside"]) {
      const { clone, fixtureRoot } = fixtureRepo(`reference-${mode}`);
      const output = path.join(fixtureRoot, "generated");
      buildSuccessfully(clone, output);
      const target = mode === "missing"
        ? "../../guides/not-present.md"
        : "../../../outside-note.md";
      if (mode === "outside") {
        fs.writeFileSync(path.join(clone, "outside-note.md"), "not part of plugin install root\n");
      }
      fs.appendFileSync(path.join(clone, "plugin/skills/gpk/SKILL.md"), `\n[Invalid](${target})\n`);
      rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
    }
  });

  test("Hook compiler errors preserve the previous package", () => {
    const { clone, fixtureRoot } = fixtureRepo("hook-compiler-failure");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    fs.appendFileSync(path.join(clone, "src/hooks/entry.mts"), "\nconst invalid: MissingType = 1;\n");
    rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
  });

  test("MCP entrypoint type errors preserve the previous package", () => {
    const { clone, fixtureRoot } = fixtureRepo("mcp-compiler-failure");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    fs.appendFileSync(path.join(clone, "src/mcp/stdio.mts"), "\nconst invalid: MissingType = 1;\n");
    rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
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

  test("removed source files are removed from generated output on rebuild", () => {
    const { clone, fixtureRoot } = fixtureRepo("removed-resource");
    const resource = path.join(clone, "plugin/assets/retired.txt");
    fs.writeFileSync(resource, "old generated content");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    const generated = path.join(output, "codex/gpk/skills/gpk/references/gpk/assets/retired.txt");
    assert.ok(fs.existsSync(generated));
    fs.unlinkSync(resource);
    buildSuccessfully(clone, output);
    assert.ok(!fs.existsSync(generated));
  });

  test("manual edits to generated files are preserved and rejected", () => {
    const { clone, fixtureRoot } = fixtureRepo("edited-output");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    fs.appendFileSync(path.join(output, "codex/gpk/skills/gpk/SKILL.md"), "manual edit");
    rejectWithoutChanges(clone, ["--output", output], fixtureRoot);
  });

  test("resources can change between directories and files on repeated builds", () => {
    const { clone, fixtureRoot } = fixtureRepo("resource-shape");
    const resource = path.join(clone, "plugin/assets/change");
    const output = path.join(fixtureRoot, "generated");
    const generated = path.join(output, "codex/gpk/skills/gpk/references/gpk/assets/change");
    fs.mkdirSync(resource);
    fs.writeFileSync(path.join(resource, "old.txt"), "old");
    buildSuccessfully(clone, output);
    fs.rmSync(resource, { recursive: true });
    fs.writeFileSync(resource, "new file");
    buildSuccessfully(clone, output);
    assert.equal(fs.readFileSync(generated, "utf8"), "new file");
    fs.unlinkSync(resource);
    fs.mkdirSync(resource);
    fs.writeFileSync(path.join(resource, "new.txt"), "new child");
    buildSuccessfully(clone, output);
    assert.equal(fs.readFileSync(path.join(generated, "new.txt"), "utf8"), "new child");
    buildSuccessfully(clone, output);
  });

  test("directory replacement preserves unknown empty directories without partial writes", () => {
    const { clone, fixtureRoot } = fixtureRepo("unknown-directory");
    const resource = path.join(clone, "plugin/assets/change");
    const output = path.join(fixtureRoot, "generated");
    fs.mkdirSync(resource);
    fs.writeFileSync(path.join(resource, "old.txt"), "old");
    buildSuccessfully(clone, output);
    fs.mkdirSync(path.join(output, "codex/gpk/skills/gpk/references/gpk/assets/change/user-directory"));
    fs.rmSync(resource, { recursive: true });
    fs.writeFileSync(resource, "replacement");
    rejectWithoutChanges(clone, ["--output", output], output);
  });

  test("executable resources run directly and manual permission changes are protected", () => {
    const { clone, fixtureRoot } = fixtureRepo("executable-resource");
    const source = path.join(clone, "plugin/skills/gpk/scripts/probe.sh");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, '#!/bin/sh\nprintf "executable resource\\n"\n');
    fs.chmodSync(source, 0o755);
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    const generated = path.join(output, "codex/gpk/skills/gpk/scripts/probe.sh");
    const result = spawnSync(generated, [], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "executable resource\n");
    fs.chmodSync(source, 0o644);
    buildSuccessfully(clone, output);
    assert.equal(fs.statSync(generated).mode & 0o777, 0o644);
    fs.chmodSync(generated, 0o755);
    rejectWithoutChanges(clone, ["--output", output], output);
  });

  test("shared resources cannot silently overwrite Skill-local resources", () => {
    const { clone, fixtureRoot } = fixtureRepo("duplicate-resource");
    const output = path.join(fixtureRoot, "generated");
    buildSuccessfully(clone, output);
    const collision = path.join(clone, "plugin/skills/gpk/references/gpk/knowledge/domain-model.md");
    fs.mkdirSync(path.dirname(collision), { recursive: true });
    fs.writeFileSync(collision, "Skill-local resource");
    rejectWithoutChanges(clone, ["--output", output], output);
  });

  test("default builds exclude previews and targeted builds preserve other platforms", () => {
    const defaults = path.join(temporaryRoot, "default-platforms");
    const defaultResult = build(repoRoot, ["--output", defaults]);
    assert.equal(defaultResult.status, 0, defaultResult.stderr);
    for (const preview of ["openclaw", "workbuddy", "skills"]) {
      assert.ok(!fs.existsSync(path.join(defaults, preview)), `${preview} built without --previews`);
    }
    const output = path.join(temporaryRoot, "all-platforms");
    const result = build(repoRoot, ["--output", output, "--previews"]);
    assert.equal(result.status, 0, result.stderr);
    const before = snapshot(output);
    for (const target of ["claude", "codex", "openclaw", "workbuddy", "hermes"]) {
      buildSuccessfully(repoRoot, output, target);
      assert.deepEqual(snapshot(output), before, `${target} rebuild changes another target`);
    }
    for (const target of ["claude/gpk/skills/gpk", "codex/gpk/skills/gpk", "openclaw/gpk/skills/gpk", "workbuddy/gpk", "skills/gpk"]) {
      validateMarkdownClosure(path.join(output, target));
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
    for (const relative of ["repo", "repo/plugin", "repo/plugin/knowledge", ".", "repo/docs", "repo/dist", "repo/dist/types", "repo/dist/archives"]) {
      const { clone, fixtureRoot } = fixtureRepo(`protected-${relative.replaceAll("/", "-").replaceAll(".", "parent")}`);
      fs.mkdirSync(path.join(clone, "docs"));
      fs.writeFileSync(path.join(clone, "docs/user-note.txt"), "preserve repo documents\n");
      rejectWithoutChanges(clone, ["--output", path.resolve(fixtureRoot, relative)], fixtureRoot);
    }
  });

  test("unknown and malformed arguments cannot modify default output", () => {
    for (const args of [["--unknown"], ["--output"], ["unexpected-positional"], ["--previews", "--previews"]]) {
      const { clone, fixtureRoot } = fixtureRepo(`arguments-${args[0].replaceAll("-", "")}`);
      rejectWithoutChanges(clone, args, fixtureRoot);
    }
  });

  test("linked source roots and ancestors cannot package external files", () => {
    for (const relative of ["plugin/assets", "plugin/knowledge", "plugin/guides", "plugin/rules", "plugin", "src/hooks", "platforms"]) {
      const { clone, fixtureRoot } = fixtureRepo(`source-link-${relative.replaceAll("/", "-")}`);
      const output = path.join(fixtureRoot, "generated");
      buildSuccessfully(clone, output);
      const source = path.join(clone, relative);
      const external = path.join(fixtureRoot, "external-content");
      fs.renameSync(source, external);
      fs.writeFileSync(path.join(external, "private-fixture.txt"), "synthetic external content, never package\n");
      fs.symlinkSync(external, source, "dir");
      for (const target of ["claude", "codex"]) {
        rejectWithoutChanges(clone, ["--output", output, "--target", target], fixtureRoot);
      }
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
