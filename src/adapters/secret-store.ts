import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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

/** Plain JSON file with mode 0600: the fallback where no keychain exists. Not a vault. */
export function fileSecretStore(file: string): SecretStore {
  async function load(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(file, "utf8")) as Record<string, string>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Secret file read failed."); }
  }
  async function save(map: Record<string, string>): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(map, null, 2) + "\n", { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return {
    description: `file ${file} (mode 0600)`,
    async read(key) { return (await load())[key] ?? null; },
    async write(key, value) { const map = await load(); map[key] = value; await save(map); },
    async remove(key) { const map = await load(); delete map[key]; await save(map); },
  };
}

/** Keychain on macOS; elsewhere a 0600 file under the control root. The store's
 * description surfaces in connection status so the fallback is visible there.
 */
export function defaultSecretStore(controlRoot: string, platform = process.platform): SecretStore {
  if (platform === "darwin") return keychainSecretStore();
  return fileSecretStore(path.join(controlRoot, "secrets.json"));
}
