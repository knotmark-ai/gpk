import { open, realpath, stat } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Failure, Result } from "../domain/operation-types.js";

/**
 * Reading local files that a record body references when uploading media/attachments.
 *
 * By default (`unrestricted: true` when `files.roots` is empty), local file read access
 * follows the mounted Agent harness while refusing protected credential, system and GPK
 * directories (`disallowedRoots`), symlinks escaping bounded roots, files > 100 MB, and
 * non-media/document extensions (so keys and extensionless dotfiles are always refused).
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp", ".svg": "image/svg+xml",
};
const FILE_TYPES: Record<string, string> = {
  ".epub": "application/epub+zip", ".md": "text/markdown", ".jsonl": "application/x-ndjson", ".json": "application/json",
  ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pages": "application/vnd.apple.pages", ".numbers": "application/vnd.apple.numbers",
  ".zip": "application/zip", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};

export type LocalFile = {
  path: string; fileName: string; contentType: string; size: number; image: boolean;
  /** Identity and revision checked inside an approved real directory. Reading
   * must use this same regular file, not a replacement at the checked pathname.
   */
  identity: { dev: number; ino: number; mtimeMs: number; ctimeMs: number };
};

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export type CheckLocalFileOptions = {
  /** Allow any regular media/document file outside sensitive/disallowed directories when roots is empty. */
  unrestricted?: boolean | undefined;
  disallowedRoots?: readonly string[] | undefined;
};

/**
 * Check a referenced local file without reading its content.
 * @param reference A `file://` URL as written in the record body or Source input.
 * @param roots Approved directories from Settings; when empty, requires `options.unrestricted` (default runtime mode).
 */
export async function checkLocalFile(reference: string, roots: string[], options?: CheckLocalFileOptions): Promise<Result<LocalFile>> {
  let given: string;
  try { given = fileURLToPath(reference); }
  catch { return failure("invalid", `${reference} is not a file URL.`, "Write local files as file:///absolute/path URLs."); }
  if (!roots.length && !options?.unrestricted) {
    return failure("unauthorized", "No local folder is approved for reading files.", "Configure local file access or connect uploads in the GPK console (gpk open).");
  }
  const approved = roots.length
    ? (await Promise.all(roots.map(root => realpath(root).catch(() => null)))).filter((r): r is string => r !== null)
    : [];
  const disallowed = options?.disallowedRoots?.length
    ? (await Promise.all(options.disallowedRoots.map(root => realpath(root).catch(() => path.resolve(root))))).filter(Boolean)
    : [];
  let real: string;
  try { real = await realpath(given); }
  catch {
    if (roots.length && !approved.some(root => inside(path.resolve(given), root))) {
      return failure("unauthorized", `${given} is outside the folders approved for reading files.`, "Choose an allowed file path.");
    }
    return failure("not-found", `${given} does not exist.`, "Check the path; a renamed attachment needs its new name.");
  }
  if (roots.length && !approved.some(root => inside(real, root))) {
    return failure("unauthorized", `${given} is outside the folders approved for reading files.`, "Choose an allowed file path.");
  }
  if (disallowed.some(root => real === root || inside(real, root))) {
    return failure("unauthorized", `${given} is inside a protected system or GPK directory.`, "Reference an ordinary user document or image file.");
  }
  // The type comes from the resolved file, so a link named like an image cannot carry another file.
  const extension = path.extname(real).toLowerCase();
  const contentType = IMAGE_TYPES[extension] ?? FILE_TYPES[extension];
  if (!contentType) return failure("invalid", `${path.basename(real)} is not an image or document type GPK copies.`, "Leave it out of the record and report it as not transferred.");
  let info: Stats;
  try { info = await stat(real); }
  catch { return failure("unavailable", `${given} could not be inspected.`, "Check that the file is available locally and retry."); }
  if (!info.isFile()) return failure("invalid", `${given} is not a file.`, "Reference a file, not a folder.");
  if (info.size > MAX_FILE_BYTES) return failure("invalid", `${path.basename(real)} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, "Leave it out and report it as not transferred.");
  const { dev, ino, mtimeMs, ctimeMs } = info;
  const givenName = path.basename(given);
  const fileName = path.extname(givenName).toLowerCase() === extension ? givenName : path.basename(real);
  return { ok: true, value: { path: real, fileName, contentType, size: info.size, image: extension in IMAGE_TYPES, identity: { dev, ino, mtimeMs, ctimeMs } }, limits: [] };
}

/** Read a checked file; a cloud-synced placeholder downloads here, which can be slow. */
export async function readLocalFile(file: LocalFile): Promise<Result<Buffer>> {
  let handle;
  try {
    handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const same = (info: Stats) => info.isFile() && info.size === file.size && info.size <= MAX_FILE_BYTES &&
      info.dev === file.identity.dev && info.ino === file.identity.ino && info.mtimeMs === file.identity.mtimeMs && info.ctimeMs === file.identity.ctimeMs;
    if (!same(await handle.stat())) return failure("conflict", "The selected file changed after its approval check.", "Check the current file again before copying it.");
    const bytes = Buffer.alloc(file.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== file.size || !same(await handle.stat())) return failure("conflict", "The selected file changed while being read.", "Check it again before copying; no bytes were uploaded.");
    return { ok: true, value: bytes.subarray(0, length), limits: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") return failure("unauthorized", "The selected file was replaced by a symbolic link.", "Check the current file and its approved directory again.");
    return failure("unavailable", `Cannot read ${file.path}.`, "Check that the file is available locally (a cloud drive may need to download it) and retry.");
  } finally { await handle?.close(); }
}
