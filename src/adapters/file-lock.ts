import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

/** A lock older than this was left by a crashed writer and may be broken. */
const STALE_LOCK_MS = 30_000;
const LOCK_WAIT_MS = 10_000;

/** Thrown when the lock stays held by another writer past the wait budget. */
export class LockBusyError extends Error {}

/**
 * Run `run` while holding an exclusive lock file. GPK's local control files can be
 * accessed concurrently across daemon, CLI and Hook processes (Claude Code, Codex and
 * Antigravity), so a read/modify/write must not interleave with another one: an atomic rename alone keeps
 * readers from seeing a torn file but lets two writers both start from a stale copy.
 * `open(..., "wx")` is atomic across processes; a lock older than STALE_LOCK_MS is
 * reclaimed via atomic rename so concurrent waiters cannot delete a newly acquired lock.
 */
export async function withFileLock<T>(lock: string, run: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  const owner = `${process.pid} ${randomUUID()} ${new Date().toISOString()}\n`;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, "wx", 0o600);
      try {
        await handle.writeFile(owner);
      } catch (writeErr) {
        await handle.close().catch(() => undefined);
        await unlink(lock).catch(() => undefined);
        throw writeErr;
      }
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const held = await lstat(lock);
        if (!held.isSymbolicLink() && Date.now() - held.mtimeMs > STALE_LOCK_MS) {
          const trash = `${lock}.stale.${process.pid}.${randomUUID().slice(0, 8)}`;
          if (await rename(lock, trash).then(() => true, () => false)) {
            await unlink(trash).catch(() => undefined);
            continue;
          }
        }
      } catch {
        // Ignore transient stat races; enforce deadline and backoff below.
      }
      if (Date.now() > deadline) throw new LockBusyError(`${lock} is held by another writer.`);
      await new Promise(resolve => setTimeout(resolve, Math.min(200, 10 * 2 ** Math.min(attempt, 4)) + Math.random() * 20));
    }
  }
  try {
    return await run();
  } finally {
    const current = await readFile(lock, "utf8").catch(() => null);
    if (current === owner) await unlink(lock).catch(() => undefined);
  }
}

/** Write through an exclusive sibling temp file, fsync and rename so readers never see a torn file. */
export async function writeFileAtomic(file: string, bytes: Buffer | string, mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
