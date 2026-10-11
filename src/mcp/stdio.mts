import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { bootstrap } from "../runtime/bootstrap.js";
import { createGpkServer } from "./server.js";

declare const GPK_VERSION: string;

// stdout is reserved for MCP. Do not print input, credentials or exception stacks.
const runtime = bootstrap();
const handle = serveStdio(() => createGpkServer(runtime.operations, GPK_VERSION), {
  legacy: "serve",
  onerror: () => process.stderr.write("GPK MCP transport error.\n"),
});
let closing = false;
function close(): void {
  if (closing) return;
  closing = true;
  void Promise.all([handle.close(), runtime.close()]).catch(() => {
    process.stderr.write("GPK MCP shutdown failed.\n");
    process.exitCode = 1;
  });
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
