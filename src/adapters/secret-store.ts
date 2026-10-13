import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { LockBusyError, withFileLock, writeFileAtomic } from "./file-lock.js";

const run = promisify(execFile);

/** Host-neutral secret storage keyed by GPK instance, shared by every harness on the machine. */
export interface SecretStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Human-readable location for diagnostics; never includes secret values. */
  readonly description: string;
}

/** macOS keychain through the `security` CLI: one generic password per key under the GPK service. */
export function keychainSecretStore(service = "gpk"): SecretStore {
  return {
    description: `macOS keychain service ${service}`,
    async read(key) {
      try {
        const { stdout } = await run("security", ["find-generic-password", "-a", key, "-s", service, "-w"]);
        return stdout.replace(/\n$/, "");
      } catch (error) {
        // Exit status 44 is "item not found"; anything else is a real access failure.
        if ((error as { code?: number }).code === 44) return null;
        throw new Error("Keychain read failed.");
      }
    },
    async write(key, value) {
      try {
        await run("security", ["add-generic-password", "-a", key, "-s", service, "-U", "-w", value]);
      } catch {
        throw new Error("Keychain write failed.");
      }
    },
    async remove(key) {
      try { await run("security", ["delete-generic-password", "-a", key, "-s", service]); }
      catch (error) { if ((error as { code?: number }).code !== 44) throw new Error("Keychain delete failed."); }
    },
  };
}

/** In-process store for tests; nothing survives the process. */
export function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    description: "in-memory",
    async read(key) { return map.get(key) ?? null; },
    async write(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

/**
 * Plain JSON file with mode 0600: the fallback where no keychain exists. Not a vault.
 * Every client on the machine shares it, so changes run under a lock file and replace
 * the file atomically; a concurrent save of another key is kept, and an interrupted
 * write never leaves partial JSON.
 */
export function fileSecretStore(file: string): SecretStore {
  async function load(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(file, "utf8")) as Record<string, string>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Secret file read failed."); }
  }
  async function change(apply: (map: Record<string, string>) => void): Promise<void> {
    try {
      await withFileLock(`${file}.lock`, async () => {
        const map = await load();
        apply(map);
        await writeFileAtomic(file, JSON.stringify(map, null, 2) + "\n", 0o600);
      });
    } catch (error) {
      if (error instanceof LockBusyError) throw new Error("Another GPK client is changing the secret file.");
      throw error instanceof Error && error.message === "Secret file read failed." ? error : new Error("Secret file write failed.");
    }
  }
  return {
    description: `file ${file} (mode 0600)`,
    async read(key) { return (await load())[key] ?? null; },
    async write(key, value) { await change(map => { map[key] = value; }); },
    async remove(key) { await change(map => { delete map[key]; }); },
  };
}

/** Keychain on macOS; elsewhere a 0600 file under the control root. The store's
 * description surfaces in connection status so the fallback is visible there.
 */
export function defaultSecretStore(controlRoot: string, platform = process.platform): SecretStore {
  if (platform === "darwin") return keychainSecretStore();
  return fileSecretStore(path.join(controlRoot, "secrets.json"));
}
