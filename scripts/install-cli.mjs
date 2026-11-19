// Shipped alongside the CLI bundle. Install a snapshot independent of the host's plugin cache.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundle = path.dirname(fileURLToPath(import.meta.url));
const staging = mkdtempSync(path.join(os.tmpdir(), "gpk-install-"));
const cacheDir = path.join(staging, "npm-cache");
function npm(args, stdio) {
  const fullArgs = [...args, "--cache", cacheDir];
  const options = { cwd: staging, encoding: "utf8", stdio };
  try {
    if (process.platform !== "win32") return execFileSync("npm", fullArgs, options);
    const bins = [path.dirname(process.execPath), ...(process.env.PATH || "").split(path.delimiter)];
    const cli = bins.map(dir => path.join(dir, "node_modules/npm/bin/npm-cli.js")).find(existsSync);
    if (!cli) throw Error("Install Node.js with npm to install the GPK command.");
    return execFileSync(process.execPath, [cli, ...fullArgs], options);
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error && error.stderr) {
      process.stderr.write(String(error.stderr));
    }
    throw error;
  }
}
try {
  const [packed] = JSON.parse(npm(["pack", bundle, "--json", "--ignore-scripts", "--offline"], "pipe"));
  npm(["install", "--global", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", path.join(staging, packed.filename)], "inherit");
} finally {
  rmSync(staging, { recursive: true, force: true });
}
