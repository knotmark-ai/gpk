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
const REVOKE_ENDPOINT = "https://mcp.craft.do/my/auth/revoke";

const HELP = `GPK developer commands (pnpm gpk <command>)

  status                      Settings, Craft authorization, bound space, grants, layout
  reset                      Revoke and delete the token and delete the control root;
                              Craft records stay in the space for manual cleanup
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
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--") {
    passthrough.push(...argv.slice(i + 1));
    break;
  }
  if (arg === "--root" || arg.startsWith("--root=")) {
    const val = arg === "--root" ? argv[++i] : arg.slice("--root=".length);
    if (!val || val.startsWith("--")) { console.error("gpk: --root requires a directory path"); process.exit(1); }
    flags.set("root", val);
  } else if (["--yes", "--no-debug", "--clear", "--craft"].includes(arg)) {
    flags.set(arg.slice(2), true);
  } else if (arg.startsWith("--") && positional[0] === "claude") {
    passthrough.push(arg);
  } else if (arg.startsWith("--")) {
    flags.set(arg.slice(2), true);
  } else {
    positional.push(arg);
  }
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
  return { key, store: defaultSecretStore(controlRoot), active };
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
    const runtime = must(await call("gpk_status", { include: ["grants", "setup"] }), "status");
    const connection = runtime.connection ?? {};
    line("control root", runtime.controlRoot);
    line("settings", runtime.settings);
    line("onboarding", runtime.onboarding);
    line("secret store", connection.secretStore ?? "-");
    line("tokens", connection.tokens ?? "-");
    if (connection.space) line("space", `${connection.space.name} (${connection.space.id})`);
    if (connection.pendingAuthorizationUrl) line("pending", connection.pendingAuthorizationUrl);
    if (connection.authorizationError) line("auth error", connection.authorizationError);
    line("grants", runtime.grants ? String(runtime.grants.items.length) : "-");
    if (runtime.settings === "ready") {
      for (const location of runtime.setup?.layout?.locations ?? []) line(`  ${location.role}`, `${location.status}  ${location.detail}`);
    }
  });
}

async function reset() {
  if (flags.has("craft")) fail("--craft cannot safely distinguish created resources from adopted or user-edited content. Nothing was changed. Select any Craft cleanup manually in Craft, then run reset without --craft.");
  const home = path.resolve(os.homedir());
  const tmp = path.resolve(os.tmpdir());
  if (
    controlRoot === path.parse(controlRoot).root
    || controlRoot === home
    || controlRoot === tmp
    || controlRoot === repo
    || repo.startsWith(`${controlRoot}${path.sep}`)
  ) {
    fail(`refusing to delete unsafe control root: ${controlRoot}`);
  }
  const { key, store, active } = await credentials();
  const uploadRef = active?.uploads?.endpoint?.ref;
  const record = await store.read(key).catch(() => null);
  let tokens = null;
  if (record) {
    try { tokens = JSON.parse(record); } catch { tokens = null; }
  }
  console.log("Locally:");
  console.log(tokens?.tokens?.refresh_token ? `  revoke the refresh token at Craft` : "  no refresh token to revoke");
  console.log(record ? `  delete secret ${key} (${store.description})` : `  no secret stored under ${key}`);
  if (uploadRef) console.log(`  delete upload secret ${uploadRef}`);
  console.log(fs.existsSync(controlRoot) ? `  delete ${controlRoot}` : `  ${controlRoot} does not exist`);
  if (!(await confirm("Proceed?"))) return console.log("Nothing was changed.");

  if (tokens?.tokens?.refresh_token && tokens.client?.client_id) {
    try {
      const response = await fetch(REVOKE_ENDPOINT, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.tokens.refresh_token, token_type_hint: "refresh_token", client_id: tokens.client.client_id }),
      });
      console.log(response.ok ? "revoked the refresh token" : `revocation answered ${response.status}; remove GPK under Craft's Connections`);
    } catch { console.log("revocation failed; remove GPK under Craft's Connections"); }
  }
  if (record) { await store.remove(key).catch(() => undefined); console.log(`deleted secret ${key}`); }
  if (uploadRef) { await store.remove(uploadRef).catch(() => undefined); console.log(`deleted upload secret ${uploadRef}`); }
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
  const child = spawn("claude", ["--plugin-dir", pluginDir, ...positional, ...passthrough], { cwd: process.cwd(), stdio: "inherit", env });
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
