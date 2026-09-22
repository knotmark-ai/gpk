#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const errors = [];

function fail(message) {
  errors.push(message);
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function validateSkill(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing skill: ${relativePath}`);
    return;
  }

  const text = fs.readFileSync(fullPath, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(`${relativePath} has no YAML frontmatter`);
    return;
  }
  if (!/^name: gpk$/m.test(frontmatter[1])) {
    fail(`${relativePath} must declare name: gpk`);
  }
  if (!/^description: .+/m.test(frontmatter[1])) {
    fail(`${relativePath} must declare a description`);
  }
}

validateSkill("plugin/skills/gpk/SKILL.md");
validateSkill("adapters/codex/skills/gpk/SKILL.md");

const workflowNames = ["setup", "ingest", "plan", "work", "review"];
for (const workflow of workflowNames) {
  const name = `gpk-${workflow}`;
  const relativePath = `plugin/skills/${name}/SKILL.md.stub`;
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing inactive workflow definition: ${relativePath}`);
    continue;
  }
  const text = fs.readFileSync(fullPath, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) {
    fail(`${relativePath} must have YAML frontmatter`);
    continue;
  }
  const lines = frontmatter[1].split("\n");
  if (
    lines.length !== 2 ||
    !lines.includes(`name: ${name}`) ||
    !lines.some((line) => /^description: .+/.test(line))
  ) {
    fail(`${relativePath} must define only its name and description`);
  }
  if (text.slice(frontmatter[0].length).trim()) {
    fail(`${relativePath} must leave its workflow body empty`);
  }
  for (const root of ["plugin/skills", "adapters/codex/skills"]) {
    if (fs.existsSync(path.join(repoRoot, root, name, "SKILL.md"))) {
      fail(`${name} must not be an active/discoverable Skill yet`);
    }
  }
}

for (const file of walkFiles(path.join(repoRoot, "adapters/codex"))) {
  if (file.endsWith(".stub") || path.basename(file) === ".gitkeep") {
    fail(`inactive scaffold file leaked into Codex package: ${path.relative(repoRoot, file)}`);
  }
}

const craftMapping = fs.readFileSync(
  path.join(repoRoot, "plugin/runtime/adapters/knowledge/craft/mapping.md"),
  "utf8",
);
if (!/Project process documents[^\n]*native child pages/i.test(craftMapping)) {
  fail("Current Craft mapping must retain native Project process-document guidance");
}

for (const relativePath of [
  "plugin/runtime/contracts/adapters.md",
  "plugin/runtime/references/bootstrap.md",
  "plugin/runtime/adapters/knowledge/craft/mapping.md",
  "plugin/runtime/adapters/harness/codex/mapping.md",
  "plugin/runtime/adapters/harness/claude-code/mapping.md",
]) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`missing canonical runtime reference: ${relativePath}`);
  }
}

for (const relativePath of [
  "plugin/runtime/adapters/control/knowledge-backend/mapping.md.stub",
  "plugin/runtime/lib/.gitkeep",
  "plugin/runtime/scripts/.gitkeep",
]) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`missing implementation placeholder: ${relativePath}`);
  }
}

for (const relativePath of [
  "plugin/runtime/references/context.md.stub",
  "plugin/runtime/references/operations.md.stub",
  "plugin/runtime/references/templates.md.stub",
  "plugin/runtime/references/result-return.md.stub",
  "plugin/assets/templates/default_project_template.md.stub",
]) {
  const file = path.join(repoRoot, relativePath);
  if (!fs.existsSync(file)) fail(`missing reserved scaffold: ${relativePath}`);
  else if (fs.readFileSync(file, "utf8").trim()) {
    fail(`${relativePath} must remain empty until implementation`);
  }
}

const obsoleteKnowledgeResources = [
  "migration.md",
  "stores/craft.md",
  ...["daily-note", "entity", "goal", "output", "project", "source", "wiki-note"]
    .map((name) => `templates/${name}.md`),
];
for (const root of [
  "plugin/knowledge",
  "adapters/codex/skills/gpk/references/gpk/knowledge",
]) {
  for (const resource of obsoleteKnowledgeResources) {
    for (const relativePath of [`${root}/${resource}`, `${root}/legacy/${resource}`]) {
      if (fs.existsSync(path.join(repoRoot, relativePath))) {
        fail(`obsolete draft or compatibility redirect remains: ${relativePath}`);
      }
    }
  }
}
for (const relativePath of [
  "plugin/skills/gpk/references/bootstrap.md",
  "adapters/codex/skills/gpk/references/bootstrap.md",
  "adapters/stores/craft/README.md",
  "docs/adapter-contracts.md",
]) {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`obsolete compatibility redirect remains: ${relativePath}`);
  }
}

if (fs.existsSync(path.join(repoRoot, "plugin/skills/gpk/agents/openai.yaml"))) {
  fail("canonical skill must not contain Codex-only agents/openai.yaml");
}
if (!fs.existsSync(path.join(repoRoot, "adapters/codex/skills/gpk/agents/openai.yaml"))) {
  fail("generated Codex skill is missing agents/openai.yaml");
}

const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of walkFiles(repoRoot)) {
  if (!file.endsWith(".md")) continue;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("[TODO:")) {
    fail(`unfinished scaffold placeholder in ${path.relative(repoRoot, file)}`);
  }

  for (const match of text.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split("#", 1)[0];
    if (!target || target.includes("://") || target.startsWith("mailto:")) {
      continue;
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      fail(
        `broken local link in ${path.relative(repoRoot, file)}: ${rawTarget}`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  console.log("PASS: GPK skills and local documentation links are valid");
}
