import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { homedir } from "node:os";
import { ensureService, stopService, discover, bindInstance, originOf } from "./discovery.js";
import { resolveControlRoot } from "../adapters/local-control.js";
import { configureDebugLog, debug, since } from "../runtime/debug-log.js";

declare const GPK_VERSION: string;
const root = resolveControlRoot(process.env, process.env.HOME || homedir());
const command = process.argv[2] ?? "stdio";

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log("gpk start | stop | restart | status | open | connection\nUse gpk connection for the private MCP configuration file.");
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(GPK_VERSION);
    return;
  }
  if (command === "stop") {
    await stopService();
    console.log("GPK is stopped.");
    return;
  }
  if (command === "start" || command === "restart") {
    const service = await ensureService(command === "restart");
    console.log(`GPK ${service.version} is running (PID ${service.pid}).\nMCP: ${originOf(service)}/mcp`);
    return;
  }
  if (!["open", "status", "connection", "stdio"].includes(command)) throw Error("Unknown command. Run gpk help.");
  const entry = command === "status" ? await discover() : await ensureService();
  if (!entry) { console.log("GPK is stopped."); return; }
  const origin = originOf(entry);
  const token = await bindInstance(entry, root);
  const headers = { authorization: "Bearer " + token };
  if (command === "open" || command === "status" || command === "connection") {
    const result = await fetch(origin + "/" + command, { method: "POST", headers, redirect: "error" });
    if (!result.ok) throw Error("Service request failed.");
    console.log(await result.text()); return;
  }
  configureDebugLog(process.env, root);
  debug("runtime", "start", { pid: process.pid, version: GPK_VERSION, controlRoot: root });
  const client = new Client({ name: "gpk-stdio", version: GPK_VERSION });
  await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), { requestInit: { headers, redirect: "error" } }));
  const handle = serveStdio(() => {
    const server = new Server({ name: "gpk", version: GPK_VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", (request, ctx) => client.listTools(request.params, { signal: ctx.mcpReq.signal }));
    server.setRequestHandler("tools/call", async ({ params }, ctx) => {
      const start = Date.now();
      const result = await client.callTool(params, { signal: ctx.mcpReq.signal, timeout: 600_000 });
      const outcome = result.structuredContent as { ok?: boolean; error?: { code?: string } } | undefined;
      debug("stdio", "forwarded", { name: params.name, took: since(start), ok: outcome?.ok, code: outcome?.error?.code });
      return result;
    });
    return server;
  }, { legacy: "serve" });
  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    return (closing ??= Promise.allSettled([handle.close(), client.close()]).then(() => undefined));
  }
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  process.stdin.once("end", () => void close());
}
main().catch(error => { console.error(error instanceof Error ? error.message : "GPK failed."); process.exitCode = 1; });
