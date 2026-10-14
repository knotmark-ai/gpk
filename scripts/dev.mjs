#!/usr/bin/env node
// Developer commands around a local GPK run. Authorization and Setup are not here:
// they belong to the product flow inside the host (the gpk-setup Skill).
// Usage: pnpm gpk <command> [options]; `pnpm gpk help` lists them.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repo, "dist/marketplace/claude/gpk");
const runtimeEntry = path.join(pluginDir, "mcp/stdio.mjs");
const CRAFT_ENDPOINT = "https://mcp.craft.do/my/mcp";
const REVOKE_ENDPOINT = "https://mcp.craft.do/my/auth/revoke";
const TEMPLATE_TITLE = /^GPK (Area|Project|Task|Source|Wiki|Output)$/;

const HELP = `GPK developer commands (pnpm gpk <command>)

  status                      Settings, Craft authorization, bound space, grants, layout
  reset [--craft]             Revoke and delete the token and delete the control root;
                              --craft first removes what Setup created in the space
  claude [--no-debug]         Build the Claude Code package and start Claude with it;
                              the runtime writes a debug log unless --no-debug
  logs [--clear]              Follow the runtime debug log (run in a second terminal);
                              --clear empties it first

Options for every command:
  --root <dir>                Control root (default: GPK_CONTROL_ROOT or ~/.gpk)
  --yes                       Skip confirmations
`;

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--root") flags.set("root", argv[++i]);
  else if (arg.startsWith("--")) flags.set(arg.slice(2), true);
  else positional.push(arg);
}
const command = positional.shift() ?? "help";
const controlRoot = path.resolve(flags.get("root") ?? process.env.GPK_CONTROL_ROOT ?? path.join(os.homedir(), ".gpk"));
const assumeYes = flags.has("yes");
const debugLog = process.env.GPK_DEBUG && !["0", "1", "true", "false"].includes(process.env.GPK_DEBUG) ? path.resolve(process.env.GPK_DEBUG) : path.join(controlRoot, "logs", "debug.log");

// ---------- helpers ----------
const line = (label, value) => console.log(`${label.padEnd(14)}${value}`);
function fail(message) { console.error(`gpk: ${message}`); process.exit(1); }

async function confirm(question) {
  if (assumeYes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Source modules for raw Craft access, bundled once per run. */
let sourceModules;
async function source() {
  if (sourceModules) return sourceModules;
  const result = buildSync({
    absWorkingDir: repo,
    stdin: { contents: [
      'export { createCraftConnection } from "./src/adapters/craft-connection.ts";',
      'export { defaultSecretStore } from "./src/adapters/secret-store.ts";',
      'export { defaultCredentialsRef } from "./src/runtime/bootstrap.ts";',
    ].join("\n"), resolveDir: repo, loader: "ts" },
    bundle: true, platform: "node", format: "esm", write: false, loader: { ".md": "text", ".html": "text" },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const file = path.join(os.tmpdir(), `gpk-dev-${process.pid}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].contents);
  try { sourceModules = await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
  return sourceModules;
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(controlRoot, "settings.json"), "utf8")); } catch { return null; }
}

/** The active configuration's credentials key, or the key the runtime derives before Setup. */
async function credentials() {
  const { defaultSecretStore, defaultCredentialsRef } = await source();
  const settings = readSettings();
  const active = settings?.knowledgeBackend?.configurations?.find(c => c.id === settings.knowledgeBackend.activeId);
  const key = active?.connection?.credentialsRef ?? defaultCredentialsRef(active?.id ?? "craft", controlRoot, os.homedir());
  return { key, store: defaultSecretStore(controlRoot), endpoint: active?.connection?.endpoint?.url ?? CRAFT_ENDPOINT, active };
}

async function rawConnection() {
  const { createCraftConnection } = await source();
  const { key, store, endpoint } = await credentials();
  return createCraftConnection({ endpoint, secretKey: key, secrets: store });
}

async function withRuntime(run) {
  if (!fs.existsSync(runtimeEntry)) fail(`no built runtime at ${path.relative(repo, runtimeEntry)}; run pnpm build first.`);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [runtimeEntry], cwd: pluginDir, stderr: "pipe",
    env: { PATH: process.env.PATH, HOME: os.homedir(), GPK_CONTROL_ROOT: controlRoot },
  });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk; });
  const client = new Client({ name: "gpk-dev", version: "0" });
  await client.connect(transport, { timeout: 15000 });
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args }, { timeout: 600000 })).structuredContent;
  try { return await run(call); }
  catch (error) { if (stderr) console.error(stderr.trim()); throw error; }
  finally { await client.close(); }
}

function must(result, what) {
  if (result?.ok) return result.value;
  const error = result?.error;
  fail(`${what} failed: ${error ? `${error.code}: ${error.message} ${error.next ?? ""}` : JSON.stringify(result)}`);
}

// ---------- commands ----------
async function status() {
  await withRuntime(async call => {
    const runtime = must(await call("gpk_runtime_status"), "runtime status");
    const connection = runtime.connection ?? {};
    line("control root", runtime.controlRoot);
    line("settings", runtime.settings);
    line("stage", runtime.stage);
    line("secret store", connection.secretStore ?? "-");
    line("tokens", connection.tokens ?? "-");
    if (connection.space) line("space", `${connection.space.name} (${connection.space.id})`);
    if (connection.pendingAuthorizationUrl) line("pending", connection.pendingAuthorizationUrl);
    if (connection.authorizationError) line("auth error", connection.authorizationError);
    const grants = await call("gpk_grants_list");
    line("grants", grants.ok ? String(grants.value.items.length) : `unreadable (${grants.error.code})`);
    if (runtime.settings === "ready") {
      const inspection = must(await call("gpk_setup_inspect"), "setup inspect");
      for (const location of inspection.layout?.locations ?? []) line(`  ${location.role}`, `${location.status}  ${location.detail}`);
    }
  });
}

/** Folder tree from the paged listing: id → { name, parentId }. */
async function folderTree(connection) {
  const tree = new Map();
  const stack = [];
  for (let offset = 0; offset < 2000; offset += 20) {
    const page = await connection.read(offset ? `folders list --offset ${offset}` : "folders list");
    if (!page.ok) break;
    let rows = 0;
    for (const row of page.value.split("\n")) {
      const match = row.match(/^( *)\* <([^>]+)> (.*?)(?: \(\d+ docs?\))?$/);
      if (!match) continue;
      rows++;
      const depth = match[1].length / 2;
      stack.length = depth;
      if (!tree.has(match[2])) tree.set(match[2], { name: match[3], parentId: depth ? stack[depth - 1] ?? null : null });
      stack[depth] = match[2];
    }
    const total = Number(page.value.match(/of (\d+) folders/)?.[1] ?? 0);
    if (!rows || offset + 20 >= total) break;
  }
  return tree;
}

/** Everything Setup created that the current Settings let us find. */
async function craftCleanupPlan(connection, active) {
  const steps = [];
  const locations = active?.layout?.locations;
  if (!locations) return { steps, notes: ["No Settings layout: nothing in Craft can be attributed to GPK."] };
  const collections = await connection.read("collections list");
  const hostIds = new Set();
  for (const id of [locations.area.id, locations.project.id]) {
    const row = collections.ok ? collections.value.split("\n").find(r => r.toLowerCase().includes(`<${id.toLowerCase()}>`)) : undefined;
    const host = row?.match(/in document ([^)\s]+)/)?.[1];
    if (host) hostIds.add(host);
  }
  const tree = await folderTree(connection);
  const folderIds = [locations.source.id, locations.wiki.id, locations.output.id].filter(id => tree.has(id));
  for (const folderId of folderIds) {
    const listing = await connection.read(`documents list --folder ${folderId}`);
    for (const match of (listing.ok ? listing.value : "").matchAll(/^\s*<([^>]+)>\s+(.*)$/gm)) steps.push({ label: `document ${match[2]}`, command: `documents delete --document ${match[1]}` });
  }
  for (const host of hostIds) steps.push({ label: "host document (Areas and Projects Collections, GPK System)", command: `documents delete --document ${host}` });
  for (const folderId of folderIds) steps.push({ label: `folder ${tree.get(folderId).name}`, command: `folders delete --folder ${folderId}` });
  // A namespace folder is the shared parent of the three folders, when they have one.
  const parents = new Set(folderIds.map(id => tree.get(id).parentId));
  const namespace = parents.size === 1 ? [...parents][0] : null;
  if (namespace && tree.get(namespace)) steps.push({ label: `namespace folder ${tree.get(namespace).name}`, command: `folders delete --folder ${namespace}` });
  const templates = await connection.read("documents list --location templates");
  for (const match of (templates.ok ? templates.value : "").matchAll(/^\s*<([^>]+)>\s+(.*)$/gm)) {
    if (TEMPLATE_TITLE.test(match[2].trim())) steps.push({ label: `template ${match[2].trim()}`, command: `documents delete --document ${match[1]}` });
  }
  return { steps, notes: ["Tasks GPK created in Daily Notes are not removed; they look like any other Task.", "Deleted documents go to Craft's trash; empty it to drop their Tasks from Craft's task list."] };
}

async function reset() {
  const { key, store, active } = await credentials();
  const record = await store.read(key).catch(() => null);
  const tokens = record ? JSON.parse(record) : null;
  let craftPlan = null;
  let connection = null;
  if (flags.has("craft")) {
    if (!tokens?.tokens?.access_token) fail("--craft needs the stored token; it is already gone, so remove the structures in Craft by hand.");
    connection = await rawConnection();
    const space = await connection.space();
    if (!space.ok) fail(`cannot reach the space: ${space.error.message}`);
    craftPlan = await craftCleanupPlan(connection, active);
    console.log(`In Craft workspace ${space.value.name} (${space.value.id}):`);
    if (!craftPlan.steps.length) console.log("  nothing found");
    for (const step of craftPlan.steps) console.log(`  delete ${step.label}`);
    for (const note of craftPlan.notes) console.log(`  note: ${note}`);
  }
  console.log("Locally:");
  console.log(tokens?.tokens?.refresh_token ? `  revoke the refresh token at Craft` : "  no refresh token to revoke");
  console.log(record ? `  delete secret ${key} (${store.description})` : `  no secret stored under ${key}`);
  console.log(fs.existsSync(controlRoot) ? `  delete ${controlRoot}` : `  ${controlRoot} does not exist`);
  if (!(await confirm("Proceed?"))) { await connection?.close(); return console.log("Nothing was changed."); }

  for (const step of craftPlan?.steps ?? []) {
    const result = await connection.write(step.command);
    console.log(result.ok ? `deleted ${step.label}` : `FAILED ${step.label}: ${result.error.message}`);
  }
  await connection?.close();
  if (tokens?.tokens?.refresh_token && tokens.client?.client_id) {
    try {
      const response = await fetch(REVOKE_ENDPOINT, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.tokens.refresh_token, token_type_hint: "refresh_token", client_id: tokens.client.client_id }),
      });
      console.log(response.ok ? "revoked the refresh token" : `revocation answered ${response.status}; remove GPK under Craft's Connections`);
    } catch { console.log("revocation failed; remove GPK under Craft's Connections"); }
  }
  if (record) { await store.remove(key); console.log(`deleted secret ${key}`); }
  fs.rmSync(controlRoot, { recursive: true, force: true });
  console.log(`deleted ${controlRoot}`);
}

function claude() {
  const build = spawnSync("pnpm", ["build:claude"], { cwd: repo, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  try { execFileSync("which", ["claude"], { stdio: "ignore" }); } catch { fail("the claude CLI is not on PATH."); }
  const env = { ...process.env, GPK_CONTROL_ROOT: controlRoot };
  if (flags.has("no-debug")) delete env.GPK_DEBUG;
  else {
    env.GPK_DEBUG ??= "1";
    console.log(`GPK debug log: ${debugLog}\nFollow it in another terminal: pnpm gpk logs`);
  }
  const child = spawn("claude", ["--plugin-dir", pluginDir, ...positional], { cwd: process.cwd(), stdio: "inherit", env });
  child.on("exit", code => process.exit(code ?? 0));
}

/** Follow the debug log the runtime writes when GPK_DEBUG is set; waits for it to appear. */
function logs() {
  fs.mkdirSync(path.dirname(debugLog), { recursive: true, mode: 0o700 });
  if (flags.has("clear")) fs.writeFileSync(debugLog, "", { mode: 0o600 });
  else if (!fs.existsSync(debugLog)) fs.writeFileSync(debugLog, "", { mode: 0o600 });
  console.log(`Following ${debugLog} (Ctrl-C to stop)`);
  const child = spawn("tail", ["-n", "200", "-F", debugLog], { stdio: "inherit" });
  process.once("SIGINT", () => child.kill("SIGINT"));
  child.on("exit", code => process.exit(code ?? 0));
}

const commands = { status, reset, claude, logs, help: () => console.log(HELP) };
if (!commands[command]) { console.error(`Unknown command: ${command}\n`); console.log(HELP); process.exit(1); }
await commands[command]();
