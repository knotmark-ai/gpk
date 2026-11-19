import http from "node:http";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { bootstrap } from "../runtime/bootstrap.js";
import { debugLogPath, withDebugLog } from "../runtime/debug-log.js";
import { serialQueue } from "../runtime/serial.js";
import { writeFileAtomic } from "../adapters/file-lock.js";
import { createGpkServer } from "./server.js";
import { registry, serviceDir, proof } from "./discovery.js";

declare const GPK_VERSION: string;
const secret = randomBytes(32).toString("hex");
let origin: string;
const bindings = new Map<string, ReturnType<typeof createInstance>>();
const closing = new AbortController();
const masterFile = path.join(serviceDir, "instance-key");
let master: string;
try { master = await readFile(masterFile, "utf8"); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  master = randomBytes(32).toString("hex");
  await writeFileAtomic(masterFile, master, 0o600);
}
if (!/^[a-f0-9]{64}$/.test(master)) throw Error("Invalid GPK instance key.");

function createInstance(root: string, token: string) {
  const exclusive = serialQueue();
  let cachedTools: Awaited<ReturnType<Client["listTools"]>>["tools"] | null = null;
  const runtime = bootstrap({ env: { ...process.env, HOME: process.env.HOME || homedir(), GPK_CONTROL_ROOT: root }, service: {
    exclusive,
    async serviceInfo() {
      if (cachedTools) return { tools: cachedTools, version: GPK_VERSION, pid: process.pid, endpoint: origin + "/mcp" };
      const client = new Client({ name: "gpk-console", version: GPK_VERSION });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), { requestInit: { headers: { authorization: "Bearer " + token }, redirect: "error" } }));
        const { tools } = await client.listTools();
        cachedTools = tools;
        return { tools, version: GPK_VERSION, pid: process.pid, endpoint: origin + "/mcp" };
      } finally { await client.close(); }
    },
  } });
  const handler = createMcpHandler(() => createGpkServer(runtime.operations, GPK_VERSION, runtime.onboarding, exclusive), { legacy: "stateless", responseMode: "json" });
  return { root, runtime, exclusive, handler, debugFile: null as string | null };
}

function descriptor(token: string) {
  return path.join(serviceDir, "instances", createHash("sha256").update(token).digest("hex") + ".json");
}
async function canonicalRoot(root: string): Promise<string> {
  try { return await realpath(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(root) === root) throw error;
    return path.join(await canonicalRoot(path.dirname(root)), path.basename(root));
  }
}
async function bind(root: string, debug?: string) {
  const token = proof(master, "instance:" + await canonicalRoot(root));
  if (!bindings.has(token)) bindings.set(token, createInstance(root, token));
  const instance = bindings.get(token)!;
  if (debug !== undefined) instance.debugFile = debugLogPath({ GPK_DEBUG: debug }, instance.root);
  const config = { root: instance.root, url: origin + "/mcp", headers: { Authorization: "Bearer " + token } };
  await writeFileAtomic(descriptor(token), JSON.stringify(config), 0o600);
  return token;
}
async function resolve(token: string) {
  const active = bindings.get(token);
  if (active) return active;
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  let saved;
  try { saved = JSON.parse(await readFile(descriptor(token), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (typeof saved.root !== "string" || proof(master, "instance:" + await canonicalRoot(saved.root)) !== token) return undefined;
  await bind(saved.root);
  return bindings.get(token);
}
async function payload(req: http.IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new RangeError("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const end = (code: number, body = "") => { res.writeHead(code, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }); res.end(body); };
  const address = new URL(origin);
  if (![address.host, "localhost:" + address.port].includes(req.headers.host ?? "") || (req.headers.origin && req.headers.origin !== origin)) return end(403);
  const pathName = req.url ?? "/";
  const challenge = /^\/health\/([a-f0-9]{48})$/.exec(pathName);
  if (req.method === "GET" && challenge) return end(200, proof(secret, challenge[1]!));
  if (closing.signal.aborted) return end(503);
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (pathName === "/bind" || pathName === "/stop") {
    if (req.method !== "POST" || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return end(403);
    if (pathName === "/stop") { await shutdown(); return end(200, "stopped"); }
    const parsed = JSON.parse(await payload(req, 8192));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return end(400);
    const { root, debug } = parsed as { root?: unknown; debug?: unknown };
    if (typeof root !== "string" || !path.isAbsolute(root)) return end(400);
    return end(200, JSON.stringify({ token: await bind(path.resolve(root), typeof debug === "string" ? debug : undefined) }));
  }
  const instance = await resolve(token);
  if (!instance) return end(401);
  if (req.method === "POST") {
    if (pathName === "/connection") return end(200, descriptor(token));
    if (pathName === "/status") {
      const local = await instance.runtime.operations.setupLocal();
      const settingsState = local.ok ? local.value.settings : local.error.code;
      const onboardingState = local.ok ? local.value.onboarding : "required";
      return end(200, `GPK ${GPK_VERSION} · PID ${process.pid}\nMCP: ${origin}/mcp\nInstance: ${instance.root}\nSettings: ${settingsState}\nOnboarding: ${onboardingState}`);
    }
    if (pathName === "/open") {
      const local = await instance.runtime.operations.setupLocal();
      const targetView = local.ok && local.value.onboarding === "complete" ? "console" : "setup";
      const result = await withDebugLog(instance.debugFile, () => instance.runtime.onboarding.open(targetView));
      return end(result.ok ? 200 : 503, result.ok ? result.value.url || "Opened GPK console." : result.error.message);
    }
  }
  if (pathName !== "/mcp") return end(404);
  if (!["POST","GET","DELETE"].includes(req.method ?? "")) return end(405);
  const raw = req.method === "POST" ? await payload(req, 4 * 1024 * 1024) : undefined;
  const headers = new Headers();
  for (const [key,value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key,value);
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  const request = new Request(origin + "/mcp", { method: req.method!, headers, ...(raw === undefined ? {} : { body: raw }), signal: AbortSignal.any([abort.signal, closing.signal]) });
  await withDebugLog(instance.debugFile, async () => {
    const reply = await instance.handler.fetch(request);
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    if (reply.body) await pipeline(Readable.from(reply.body as unknown as AsyncIterable<Uint8Array>), res);
    else res.end();
  });

}

const server = http.createServer((req, res) => {
  void route(req, res).catch(error => {
    if (!res.headersSent) res.writeHead(error instanceof RangeError ? 413 : error instanceof SyntaxError ? 400 : 500);
    res.end();
  });
});
async function listen(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ready = () => { server.off("error", failed); resolve(); };
    const failed = (error: Error) => { server.off("listening", ready); reject(error); };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(port, "127.0.0.1");
  });
}
await mkdir(serviceDir, { recursive: true, mode: 0o700 });
let preferred = 46321;
try {
  const saved = JSON.parse(await readFile(registry, "utf8"));
  if (saved && typeof saved === "object" && Number.isInteger(saved.port) && saved.port > 0 && saved.port <= 65535) preferred = saved.port;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
}
try { await listen(preferred); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error; await listen(0); }
const address = server.address();
if (!address || typeof address === "string") throw Error("GPK could not listen on loopback.");
origin = "http://127.0.0.1:" + address.port;
const selfDigest = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
await writeFileAtomic(registry, JSON.stringify({ port: address.port, secret, version: GPK_VERSION, digest: selfDigest, pid: process.pid }), 0o600);

async function shutdown() {
  if (closing.signal.aborted) return;
  closing.abort();
  try {
    await Promise.allSettled([...bindings.values()].map(async instance => {
      try { await instance.handler.close(); }
      finally { await instance.exclusive(() => instance.runtime.close()); }
    }));
  } finally {
    server.close();
  }
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
