import { randomUUID } from "node:crypto";
import { mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** A lock older than this was left by a crashed writer and may be broken. */
const STALE_LOCK_MS = 30_000;
const LOCK_WAIT_MS = 10_000;

/** Thrown when the lock stays held by another writer past the wait budget. */
export class LockBusyError extends Error {}

/**
 * Run `run` while holding an exclusive lock file. GPK's local files are shared by every
 * client on the machine (Codex and Claude Code run separate runtimes), so a
 * read/modify/write must not interleave with another one: an atomic rename alone keeps
 * readers from seeing a torn file but lets two writers both start from a stale copy.
 * `open(..., "wx")` is atomic across processes; a lock older than STALE_LOCK_MS is
 * treated as abandoned. Throws LockBusyError after LOCK_WAIT_MS, or the I/O error.
 */
export async function withFileLock<T>(lock: string, run: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const held = await stat(lock);
        if (Date.now() - held.mtimeMs > STALE_LOCK_MS) { await unlink(lock).catch(() => undefined); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new LockBusyError(`${lock} is held by another writer.`);
      await new Promise(resolve => setTimeout(resolve, Math.min(200, 10 * 2 ** Math.min(attempt, 4)) + Math.random() * 20));
    }
  }
  try { return await run(); }
  finally { await unlink(lock).catch(() => undefined); }
}

/** Write through a sibling temp file and rename, so readers never see a torn file. */
export async function writeFileAtomic(file: string, bytes: Buffer | string, mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
