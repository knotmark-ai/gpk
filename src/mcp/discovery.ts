import { createHash, createHmac, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withFileLock, writeFileAtomic } from "../adapters/file-lock.js";

export const serviceDir = path.join(process.env.HOME || homedir(), ".gpk-runtime");
export const registry = path.join(serviceDir, "service.json");
export type Discovery = { port: number; secret: string; version: string; digest?: string; pid: number };
export const originOf = (service: Discovery) => `http://127.0.0.1:${service.port}`;
export const proof = (secret: string, nonce: string) => createHmac("sha256", secret).update(nonce).digest("hex");

export async function discover(): Promise<Discovery | null> {
  let entry: Discovery;
  try { entry = JSON.parse(await readFile(registry, "utf8")) as Discovery; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
  if (!entry || typeof entry !== "object" || !Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535 || !/^[a-f0-9]{64}$/.test(entry.secret)) return null;
  const nonce = randomBytes(24).toString("hex");
  try {
    const res = await fetch(originOf(entry) + "/health/" + nonce, { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (res.ok && await res.text() === proof(entry.secret, nonce)) return entry;
    return null;
  } catch (error) {
    if ((error as { cause?: NodeJS.ErrnoException }).cause?.code === "ECONNREFUSED") return null;
  }
  // An unresponsive live owner must not be replaced by a second writer.
  if (Number.isSafeInteger(entry.pid) && entry.pid > 0) {
    try { process.kill(entry.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return null; throw error; }
    throw Error("Registered GPK service is still running but did not answer discovery.");
  }
  return null;
}

declare const GPK_VERSION: string;

const lifecycleLock = path.join(serviceDir, "start.lock");

async function launchService(): Promise<Discovery> {
  const bytes = await readFile(fileURLToPath(new URL("./service.mjs", import.meta.url)));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const installed = path.join(serviceDir, "versions", digest, "service.mjs");
  await writeFileAtomic(installed, bytes, 0o600);
  const child = spawn(process.execPath, [installed], { detached: true, stdio: "ignore", windowsHide: true, cwd: serviceDir });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    await delay(50);
    if (child.exitCode !== null || child.signalCode !== null) throw Error("GPK service could not start.");
    const entry = await discover();
    if (entry && entry.pid === child.pid) return entry;
  }
  child.kill();
  throw Error("Timed out starting GPK.");
}

async function stopRunning(entry: Discovery): Promise<void> {
  const response = await fetch(originOf(entry) + "/stop", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(9000),
    headers: { authorization: "Bearer " + entry.secret, connection: "close" },
  });
  if (!response.ok) throw Error("Could not stop GPK.");
  if (await response.text() === "stopped") return;

  // Older services acknowledge the request before closing their connections.
  for (let attempt = 0; attempt < 160; attempt++) {
    try { process.kill(entry.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
    await delay(50);
  }
  throw Error("The previous GPK service is still stopping. Check gpk status before retrying.");
}

export function stopService(): Promise<void> {
  return withFileLock(lifecycleLock, async () => {
    const current = await discover();
    if (current) await stopRunning(current);
  });
}

export function ensureService(restart = false): Promise<Discovery> {
  return withFileLock(lifecycleLock, async () => {
    const current = await discover();
    if (current && !restart) {
      if (current.version !== GPK_VERSION) throw Error(`GPK ${current.version} is running. Use gpk restart to load ${GPK_VERSION}.`);
      const bytes = await readFile(fileURLToPath(new URL("./service.mjs", import.meta.url)));
      const localDigest = createHash("sha256").update(bytes).digest("hex");
      if (current.digest === localDigest) return current;
    }
    if (current) await stopRunning(current);
    return launchService();
  });
}

export async function bindInstance(entry: Discovery, root: string): Promise<string> {
  const result = await fetch(originOf(entry) + "/bind", { method: "POST", redirect: "error",
    headers: { authorization: "Bearer " + entry.secret, "content-type": "application/json" }, body: JSON.stringify({ root, debug: process.env.GPK_DEBUG }) });
  if (!result.ok) throw Error("Could not bind the GPK instance.");
  return (await result.json() as { token: string }).token;
}
