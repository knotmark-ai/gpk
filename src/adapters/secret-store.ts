import { execFile, spawn } from "node:child_process";
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

const ENCODED_PREFIX = "gpk-b64:";

function encodeKeychainValue(value: string): string {
  return ENCODED_PREFIX + Buffer.from(value, "utf8").toString("base64url");
}

function decodeKeychainValue(raw: string): string {
  if (raw.startsWith(ENCODED_PREFIX)) {
    return Buffer.from(raw.slice(ENCODED_PREFIX.length), "base64url").toString("utf8");
  }
  return raw;
}

function securityQuote(arg: string): string {
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** macOS keychain through `security`: writes feed `security -i` over stdin so secrets never appear in argv. */
function keychainSecretStore(service = "gpk"): SecretStore {
  return {
    description: `macOS keychain service ${service}`,
    async read(key) {
      try {
        const { stdout } = await run("security", ["find-generic-password", "-a", key, "-s", service, "-w"]);
        return decodeKeychainValue(stdout.replace(/\n$/, ""));
      } catch (error) {
        // Exit status 44 is "item not found"; anything else is a real access failure.
        if ((error as { code?: number }).code === 44) return null;
        throw new Error("Keychain read failed.");
      }
    },
    async write(key, value) {
      const encoded = encodeKeychainValue(value);
      const command = `add-generic-password -a ${securityQuote(key)} -s ${securityQuote(service)} -U -w ${securityQuote(encoded)}\n`;
      await new Promise<void>((resolve, reject) => {
        const child = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
        child.once("error", () => reject(new Error("Keychain write failed.")));
        child.once("close", code => code === 0 ? resolve() : reject(new Error("Keychain write failed.")));
        child.stdin.end(command);
      });
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
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.values(parsed).every(v => typeof v === "string")) {
        throw new Error("Invalid secret map");
      }
      return Object.assign(Object.create(null) as Record<string, string>, parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null) as Record<string, string>;
      throw new Error("Secret file read failed.");
    }
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
    async read(key) {
      const map = await load();
      return Object.hasOwn(map, key) ? map[key]! : null;
    },
    async write(key, value) { await change(map => { map[key] = value; }); },
    async remove(key) { await change(map => { delete map[key]; }); },
  };
}

/** Keychain on macOS; elsewhere a 0600 file under the control root. */
export function defaultSecretStore(controlRoot: string, platform = process.platform): SecretStore {
  if (platform === "darwin") return keychainSecretStore();
  return fileSecretStore(path.join(controlRoot, "secrets.json"));
}
