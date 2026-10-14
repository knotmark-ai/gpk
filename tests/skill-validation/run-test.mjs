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
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function validateSkill(relativePath, expectedName) {
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
  const name = frontmatter[1].match(/^name: ([a-z0-9-]+)$/m)?.[1];
  if (name !== expectedName) {
    fail(`${relativePath} must declare name: ${expectedName}`);
  }
  if (!/^description: .+/m.test(frontmatter[1])) {
    fail(`${relativePath} must declare a description`);
  }
}

const skillNames = fs.readdirSync(path.join(repoRoot, "plugin/skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() &&
    fs.existsSync(path.join(repoRoot, "plugin/skills", entry.name, "SKILL.md")))
  .map(entry => entry.name).sort();
for (const name of skillNames) {
  validateSkill(`plugin/skills/${name}/SKILL.md`, name);
  for (const client of ["claude", "codex"]) {
    validateSkill(`dist/marketplace/${client}/gpk/skills/${name}/SKILL.md`, name);
  }
}

// Planned work belongs in docs/ and the roadmap, never in placeholder files.
for (const file of walkFiles(path.join(repoRoot, "plugin"))) {
  if (file.endsWith(".stub") || path.basename(file) === ".gitkeep") {
    fail(`unused implementation placeholder in source: ${path.relative(repoRoot, file)}`);
  }
}

const craftMapping = fs.readFileSync(
  path.join(repoRoot, "docs/adapters/craft.md"),
  "utf8",
);
if (!/Project process documents[^\n]*native child pages/i.test(craftMapping)) {
  fail("Current Craft mapping must retain native Project process-document guidance");
}

for (const relativePath of [
  "plugin/guides/bootstrap.md",
  "plugin/guides/templates.md",
  "docs/storage-contracts.md",
  "docs/workflow-design.md",
  "docs/conformance-scenarios.md",
  "docs/adapters/craft.md",
  "docs/plugin-runtime.md",
]) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`missing canonical reference: ${relativePath}`);
  }
}

for (const relativePath of [
  "src/domain/knowledge-backend-port.ts",
  "src/domain/user-control-port.ts",
]) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) fail(`missing TypeScript contract: ${relativePath}`);
}
for (const name of skillNames) {
  if (fs.existsSync(path.join(repoRoot, "plugin/skills", name, "agents/openai.yaml"))) {
    fail(`canonical skill ${name} must not contain Codex-only agents/openai.yaml`);
  }
  if (!fs.existsSync(path.join(repoRoot, "dist/marketplace/codex/gpk/skills", name, "agents/openai.yaml"))) {
    fail(`generated Codex skill ${name} is missing agents/openai.yaml`);
  }
}

// This checks local file existence; package isolation is exercised by plugin-package tests.
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
