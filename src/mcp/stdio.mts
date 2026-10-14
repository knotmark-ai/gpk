import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { resolveControlRoot } from "../adapters/local-control.js";
import { bootstrap } from "../runtime/bootstrap.js";
import { configureDebugLog, debug } from "../runtime/debug-log.js";
import { createGpkServer } from "./server.js";

declare const GPK_VERSION: string;

// stdout is reserved for MCP. Do not print input, credentials or exception stacks.
const debugFile = configureDebugLog(process.env, resolveControlRoot(process.env));
debug("runtime", "start", { pid: process.pid, version: GPK_VERSION, controlRoot: resolveControlRoot(process.env), node: process.version });
if (debugFile) process.stderr.write(`GPK debug log: ${debugFile}\n`);
const runtime = bootstrap();
const handle = serveStdio(() => createGpkServer(runtime.operations, GPK_VERSION, runtime.onboarding), {
  legacy: "serve",
  onerror: error => { debug("mcp", "transport-error", { error: error instanceof Error ? error.message : String(error) }); process.stderr.write("GPK MCP transport error.\n"); },
});
let closing = false;
function close(): void {
  if (closing) return;
  closing = true;
  debug("runtime", "shutdown");
  void Promise.all([handle.close(), runtime.close()]).catch(() => {
    process.stderr.write("GPK MCP shutdown failed.\n");
    process.exitCode = 1;
  });
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
