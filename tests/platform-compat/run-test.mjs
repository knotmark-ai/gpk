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

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`);
    return {};
  }
}

function skillNames(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

const packageJson = readJson("package.json");
const claudeManifest = readJson("dist/marketplace/claude/gpk/.claude-plugin/plugin.json");
const codexManifest = readJson("dist/marketplace/codex/gpk/.codex-plugin/plugin.json");
const claudeMarketplace = readJson("dist/marketplace/.claude-plugin/marketplace.json");
const codexMarketplace = readJson("dist/marketplace/.agents/plugins/marketplace.json");

// Codex catalogs intentionally omit version; the installed manifest carries it.
const versions = [
  packageJson.version,
  claudeManifest.version,
  codexManifest.version,
  claudeMarketplace.plugins?.[0]?.version,
];
if (new Set(versions).size !== 1 || versions.some((value) => !value)) {
  fail(`version mismatch: ${JSON.stringify(versions)}`);
}

if (claudeManifest.name !== "gpk" || codexManifest.name !== "gpk") {
  fail("both plugin manifests must use the name gpk");
}
if (claudeMarketplace.plugins?.[0]?.source !== "./claude/gpk") {
  fail("Claude marketplace must point to ./claude/gpk");
}
if (codexMarketplace.plugins?.[0]?.source?.path !== "./codex/gpk") {
  fail("Codex marketplace must point to ./codex/gpk");
}

const canonicalSkills = skillNames(path.join(repoRoot, "plugin", "skills"));
const codexSkills = skillNames(path.join(repoRoot, "dist/marketplace", "codex", "gpk", "skills"));
const expectedSkills = ["gpk", "gpk-ingest", "gpk-plan", "gpk-review", "gpk-setup", "gpk-work"];
if (JSON.stringify(canonicalSkills) !== JSON.stringify(expectedSkills)) {
  fail(`foundation Skill inventory mismatch: ${canonicalSkills}`);
}
if (JSON.stringify(canonicalSkills) !== JSON.stringify(codexSkills)) {
  fail(
    `skill inventory mismatch: canonical=${canonicalSkills} codex=${codexSkills}`,
  );
}

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

// Compare local link identities, rather than depending on a particular string
// replacement. Runtime references can link across any of the packaged trees.
function normalizeMarkdown(text, file, identities) {
  return text.replace(/\[[^\]]*\]\(([^)]+)\)/g, (link, rawTarget) => {
    const raw = rawTarget.trim();
    const target = raw.startsWith("<")
      ? raw.slice(1, raw.indexOf(">"))
      : raw.replace(/\s+["'][\s\S]*$/, "");
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return link;
    const targetPath = target.split(/[?#]/, 1)[0];
    const identity = identities.get(path.resolve(path.dirname(file), decodeURIComponent(targetPath)));
    if (!identity) {
      fail(`unmapped local reference in ${path.relative(repoRoot, file)}: ${target}`);
      return link;
    }
    return link.replace(target, `${identity}${target.slice(targetPath.length)}`);
  });
}

for (const name of canonicalSkills) {
  const sourceRoot = path.join(repoRoot, "plugin");
  const generatedRoot = path.join(repoRoot, "dist/marketplace/codex/gpk/skills", name);
  const fileMap = new Map();
  const addTree = (source, target) => {
    for (const file of sourceFiles(source)) {
      fileMap.set(file, path.join(target, path.relative(source, file)));
    }
  };
  addTree(path.join(sourceRoot, "skills", name), generatedRoot);
  for (const resource of ["knowledge", "guides", "rules", "assets"]) {
    if (fs.existsSync(path.join(sourceRoot, resource))) addTree(path.join(sourceRoot, resource), path.join(generatedRoot, "references/gpk", resource));
  }
  const sourceIdentities = new Map();
  const generatedIdentities = new Map();
  for (const [source, generated] of fileMap) {
    const identity = path.relative(sourceRoot, source).split(path.sep).join("/");
    sourceIdentities.set(source, identity);
    generatedIdentities.set(generated, identity);
  }
  for (const [source, generated] of fileMap) {
    if (!fs.existsSync(generated)) {
      fail(`missing generated resource: ${path.relative(repoRoot, generated)}`);
      continue;
    }
    const canonical = fs.readFileSync(source);
    const packaged = fs.readFileSync(generated);
    const same = source.endsWith(".md")
      ? normalizeMarkdown(canonical.toString("utf8"), source, sourceIdentities) ===
        normalizeMarkdown(packaged.toString("utf8"), generated, generatedIdentities)
      : canonical.equals(packaged);
    if (!same) fail(`generated resource changes canonical content: ${path.relative(sourceRoot, source)}`);
  }
}

const evidenceRoot = path.join(repoRoot, "docs/adapters");
const evidence = fs.readdirSync(evidenceRoot).filter(name => name.endsWith(".md") && name !== "README.md").sort();
if (JSON.stringify(evidence) !== JSON.stringify(["craft.md", "local-control.md"])) {
  fail(`expected Craft evidence and the local-control design mapping: ${evidence}`);
}
// Skeleton implementations have executable, fail-closed evidence in test:runtime.
const adaptersRoot = path.join(repoRoot, "src/adapters");
for (const implementation of ["craft.ts", "local-control.ts"]) {
  if (!fs.existsSync(path.join(adaptersRoot, implementation))) fail(`missing skeleton adapter: ${implementation}`);
}
for (const target of ["claude", "codex"]) {
  const root = path.join(repoRoot, "dist/marketplace", target, "gpk");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, `.${target}-plugin/plugin.json`), "utf8"));
  if (manifest.mcpServers !== "./.mcp.json") fail(`missing MCP registration: ${target}`);
  for (const file of [".mcp.json", "mcp/stdio.mjs", "mcp/THIRD-PARTY-NOTICES.txt"]) {
    if (!fs.existsSync(path.join(root, file))) fail(`missing MCP package file: ${target}/${file}`);
  }
}

if (fs.existsSync(path.join(repoRoot, ".codex-plugin", "plugin.json"))) {
  fail("Codex manifest belongs in the generated package, not the repository root");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  console.log("PASS: Claude, Codex, and Craft support declarations are aligned");
}
