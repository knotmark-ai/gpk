#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { assertOutput, contentOf, json, marker, prepareWrite, sourceFile, walkFiles } from "./lib/generated-files.mjs";
import { marketplaceRoot, repoRoot } from "./lib/paths.mjs";
const targets = ["claude", "codex"];
// Packaging previews: built on request (--previews or --target), never validated
// against an installed client, and not published by the default release.
const previewTargets = ["openclaw", "workbuddy", "hermes"];
const allTargets = [...targets, ...previewTargets];
const readJson = relative => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8"));
export const metadata = readJson("package.json");

function mapTree(source, target, resources) {
  for (const file of walkFiles(source)) {
    resources.set(file, path.join(target, path.relative(source, file)));
  }
}

// Resolve canonical file identities before rebasing links. A packaged Skill may
// reference only files vendored with that Skill, never the checkout.
// This handles inline Markdown links only. Reference-style links and autolinks
// need explicit support and fixtures before they can be used for bundled resources.
function rebaseMarkdown(text, sourceFile, targetFile, resources) {
  return text.replace(/\[[^\]]*\]\(([^)]+)\)/g, (link, rawTarget) => {
    const raw = rawTarget.trim();
    const destination = raw.startsWith("<")
      ? raw.slice(1, raw.indexOf(">"))
      : raw.replace(/\s+["'][\s\S]*$/, "");
    if (!destination || destination.startsWith("#") ||
        /^[a-z][a-z0-9+.-]*:/i.test(destination)) return link;

    const targetPath = destination.split(/[?#]/, 1)[0];
    const decodedPath = decodeURIComponent(targetPath);
    if (path.isAbsolute(decodedPath)) {
      throw new Error(`Absolute local reference in ${sourceFile}: ${destination}`);
    }
    const canonicalTarget = path.resolve(path.dirname(sourceFile), decodedPath);
    const packagedTarget = resources.get(canonicalTarget);
    if (!packagedTarget) {
      throw new Error(`Unpackaged local reference in ${sourceFile}: ${destination}`);
    }
    const relative = path.relative(path.dirname(targetFile), packagedTarget)
      .split(path.sep).map(segment => encodeURIComponent(segment)).join("/");
    const rebased = relative + destination.slice(targetPath.length);
    // Retain the label, optional title and angle-bracket form verbatim.
    const replacement = rawTarget.replace(destination, rebased);
    return link.slice(0, link.length - rawTarget.length - 1) + replacement + ")";
  });
}

// Each Skill gets its own resource closure so it remains usable when copied alone.
// Build the complete source-to-package map before rewriting cross-resource links.
function skillFiles(sourcePluginRoot, skillName) {
  const resources = new Map();
  mapTree(path.join(sourcePluginRoot, "skills", skillName), "", resources);
  for (const tree of ["knowledge", "guides", "rules", "assets"]) {
    const source = path.join(sourcePluginRoot, tree);
    if (tree !== "assets" || fs.existsSync(source)) {
      mapTree(source, path.join("references", "gpk", tree), resources);
    }
  }
  const files = new Map();
  for (const [source, target] of resources) {
    // Shared references must not silently overwrite a Skill-local resource.
    if (files.has(target)) throw new Error(`Duplicate packaged resource: ${target}`);
    const content = fs.readFileSync(source);
    files.set(target, sourceFile(source, source.endsWith(".md")
      ? rebaseMarkdown(content.toString("utf8"), source, target, resources)
      : content));
  }
  return files;
}

/** Assemble platform-relative files in memory; validation and disk writes happen later. */
function buildFiles(target, hookRuntime, mcpRuntime) {
  if (!allTargets.includes(target)) throw new Error(`Unknown target: ${target}`);
  if (targets.includes(target)) walkFiles(path.join(repoRoot, "platforms", target));
  const sourceRoot = path.join(repoRoot, "plugin");
  const skillNames = fs.readdirSync(path.join(sourceRoot, "skills"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(sourceRoot, "skills", entry.name, "SKILL.md")))
    .map(entry => entry.name).sort();
  if (!skillNames.length) throw new Error("No active skills found");
  const files = new Map();
  const isPlugin = ["claude", "codex", "openclaw"].includes(target);
  for (const name of skillNames) {
    // Plugin hosts nest Skills under gpk/skills; Hermes expects a skills/ tap root,
    // while WorkBuddy imports each Skill directory separately.
    const base = isPlugin ? `gpk/skills/${name}` : target === "hermes" ? `skills/${name}` : name;
    const skill = skillFiles(sourceRoot, name);
    if (target === "codex") {
      const presentation = name === "gpk" ? "openai.yaml" : `${name}.yaml`;
      skill.set("agents/openai.yaml", fs.readFileSync(path.join(repoRoot, "platforms/codex", presentation), "utf8"));
    }
    if (target === "workbuddy") {
      const frontmatter = { ...readJson("platforms/workbuddy/skill.json"), version: metadata.version, author: metadata.author.name };
      const text = contentOf(skill.get("SKILL.md"));
      if (!/^---\n[\s\S]*?\n---\n/.test(text)) throw new Error(`Missing Skill frontmatter: ${name}`);
      // JSON string literals also quote YAML scalars safely, including colons and newlines.
      skill.set("SKILL.md", text.replace(/\n---\n/, "\n" + Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n") + "\n---\n"));
    }
    skill.set("LICENSE", fs.readFileSync(path.join(repoRoot, "LICENSE")));
    for (const [relative, content] of skill) files.set(`${base}/${relative}`, content);
  }
  if (isPlugin) {
    const platform = target === "openclaw" ? "claude" : target;
    const template = readJson(`platforms/${platform}/plugin.json`);
    // Package identity overrides platform templates to prevent independently drifting versions.
    const { name, version, description, author, homepage, repository, license, keywords } = metadata;
    const manifest = { ...template, name, version, description, author, homepage, repository, license, keywords };
    // OpenClaw reuses the Skill bundle as a preview; Claude Hook configuration
    // must not imply that this preview supports the same host events.
    if (target === "openclaw") {
      delete manifest.hooks;
      delete manifest.mcpServers;
    }
    if (platform === "codex") manifest.interface = { ...template.interface, developerName: author.name, websiteURL: homepage };
    files.set(`gpk/.${platform}-plugin/plugin.json`, json(manifest));
    files.set("gpk/LICENSE", fs.readFileSync(path.join(repoRoot, "LICENSE")));
  }
  if (targets.includes(target)) {
    files.set("gpk/.mcp.json", sourceFile(path.join(repoRoot, "platforms", target, "mcp.json")));
    for (const [relative, content] of mcpRuntime) files.set(`gpk/mcp/${relative}`, content);
    files.set("gpk/hooks/entry.mjs", hookRuntime);
    files.set("gpk/hooks/entry.json", sourceFile(path.join(repoRoot, "platforms", target, "hooks.json")));
    for (const file of walkFiles(path.join(sourceRoot, "rules"))) {
      files.set(path.join("gpk/rules", path.relative(path.join(sourceRoot, "rules"), file)), sourceFile(file));
    }
  }
  return files;
}

// Compile once per build plan into disposable staging. No persistent runtime
// output exists outside the marketplace inventory, and failure precedes writes.
function compileHook() {
  walkFiles(path.join(repoRoot, "src/hooks"));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gpk-hooks-"));
  try {
    execFileSync(path.join(repoRoot, "node_modules/.bin/tsc"),
      ["-p", "tsconfig.hooks.json", "--outDir", temporary], { cwd: repoRoot, stdio: "pipe" });
    return fs.readFileSync(path.join(temporary, "entry.mjs"));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// The installed package needs Node, not a checkout, pnpm or node_modules.
// Typecheck before bundling; all compilation/validation precedes output writes.
function compileMcp() {
  walkFiles(path.join(repoRoot, "src"));
  execFileSync(path.join(repoRoot, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json", "--noEmit"], { cwd: repoRoot, stdio: "pipe" });
  const result = buildSync({
    absWorkingDir: repoRoot, entryPoints: ["src/mcp/stdio.mts"],
    bundle: true, platform: "node", format: "esm", target: "node22.13",
    write: false, metafile: true, legalComments: "eof",
    // Bundled entity templates ship inside the runtime for Craft's Templates area.
    loader: { ".md": "text" },
    define: { GPK_VERSION: JSON.stringify(metadata.version) },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const notices = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let directory = path.dirname(path.resolve(repoRoot, input));
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, "package.json");
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (!pkg.name || !pkg.version) {
          directory = path.dirname(directory);
          continue;
        }
        const identity = `${pkg.name}@${pkg.version}`;
        if (!notices.has(identity)) {
          const licenses = fs.readdirSync(directory).filter(name => /^licen[sc]e(?:\..*)?$/i.test(name));
          if (!licenses.length) throw new Error(`Missing bundled dependency license: ${identity}`);
          notices.set(identity, `${identity} (${pkg.license ?? "see license"})\n\n` +
            licenses.map(name => fs.readFileSync(path.join(directory, name), "utf8")).join("\n"));
        }
        break;
      }
      directory = path.dirname(directory);
    }
  }
  return new Map([
    ["stdio.mjs", result.outputFiles[0].contents],
    ["THIRD-PARTY-NOTICES.txt", [...notices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n\n---\n\n") + "\n"],
  ]);
}

// Catalog paths are relative to the marketplace root. Codex has no catalog version field.
function catalogs() {
  return new Map([
    [".claude-plugin/marketplace.json", json({
      name: "gpk", description: metadata.description, owner: { name: metadata.author.name },
      plugins: [{ name: metadata.name, version: metadata.version, description: metadata.description, source: "./claude/gpk", category: "productivity" }],
    })],
    [".agents/plugins/marketplace.json", json({
      name: "gpk", interface: { displayName: "GPK" },
      plugins: [{ name: metadata.name, source: { source: "local", path: "./codex/gpk" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }],
    })],
  ]);
}

const delivery = {
  claude: "- Claude Code: add this repository as a plugin marketplace and install gpk@gpk.",
  codex: "- Codex: add this repository as a plugin marketplace and install its GPK entry.",
  openclaw: "- OpenClaw: use the openclaw/gpk preview directory (without Claude/Codex Hook bindings).",
  hermes: "- Hermes: add this repository as a Skill tap; entrypoints are under skills/.",
  workbuddy: "- WorkBuddy: download the gpk-workbuddy ZIP from the source repository release.",
};

/** Plan one canonical marketplace tree. Release packaging consumes this same plan. */
export function prepareBuild({ output = marketplaceRoot, target, previews = false } = {}) {
  output = path.resolve(output);
  assertOutput(output, repoRoot, marketplaceRoot);
  if (target && !allTargets.includes(target)) throw new Error(`Unknown target: ${target}`);
  const selected = target ? [target] : previews ? allTargets : targets;
  const hookRuntime = selected.some(name => targets.includes(name)) ? compileHook() : undefined;
  const mcpRuntime = selected.some(name => targets.includes(name)) ? compileMcp() : undefined;
  const files = target ? new Map() : catalogs();
  if (target && fs.existsSync(output)) {
    // Retain other targets/catalogs. prepareWrite validates all existing ownership
    // before allowing any file to be replaced, including files copied into this map.
    for (const file of walkFiles(output)) {
      const relative = path.relative(output, file);
      const prefix = target === "hermes" ? "skills/" : `${target}/`;
      if (relative !== marker && !relative.startsWith(prefix)) files.set(relative, sourceFile(file));
    }
  }
  for (const name of selected) {
    for (const [relative, entry] of buildFiles(name, hookRuntime, mcpRuntime)) {
      files.set(name === "hermes" ? relative : `${name}/${relative}`, entry);
    }
  }
  if (!target) {
    files.set("LICENSE", fs.readFileSync(path.join(repoRoot, "LICENSE")));
    files.set("release.json", json({ name: metadata.name, version: metadata.version, source: metadata.repository, sourceCommit: process.env.GPK_SOURCE_SHA ?? null }));
    const previewNote = previews
      ? " OpenClaw, WorkBuddy and Hermes packages are previews that require installed-client validation; packaging does not establish live integration support."
      : "";
    files.set("README.md", `# GPK distribution

Generated from ${metadata.repository}, version ${metadata.version}. Do not edit generated files.

${selected.map(name => delivery[name]).join("\n")}

See [current support](${metadata.homepage}#current-support) for capability and validation boundaries.${previewNote}
`);
  }
  return { output, files, targets: selected, write: prepareWrite(output, files) };
}

const usage = "Usage: build-plugins.mjs [--target claude|codex|openclaw|workbuddy|hermes] [--output PATH] [--previews]";

/** Parse `--target X`, `--output PATH` and the `--previews` flag; reject anything else. */
export function parseArguments(args, { allowTarget = true, usage: message = usage } = {}) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--previews" && !options.previews) {
      options.previews = true;
      continue;
    }
    const key = args[i].slice(2);
    const valued = allowTarget ? ["--target", "--output"] : ["--output"];
    if (!valued.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options[key]) {
      throw new Error(message);
    }
    options[key] = args[++i];
  }
  return options;
}

// Importing from the release builder must not parse CLI arguments or write output.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = prepareBuild(parseArguments(process.argv.slice(2)));
  plan.write();
  console.log(`Built ${plan.targets.join(", ")} at ${plan.output}`);
}
