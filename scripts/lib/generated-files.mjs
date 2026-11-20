import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const marker = ".generated-from-gpk";
export const json = value => JSON.stringify(value, null, 2) + "\n";
const hash = content => createHash("sha256").update(content).digest("hex");
export const contentOf = file => file.content ?? file;
export const modeOf = file => file.mode ?? 0o644;
// Preserve executability, but normalize other permissions so builds do not inherit
// machine-specific modes and ZIP contents stay reproducible.
export const sourceFile = (file, content = fs.readFileSync(file)) => ({
  content, mode: fs.statSync(file).mode & 0o111 ? 0o755 : 0o644,
});
// Lexical containment only; filesystem symlink checks are a separate prerequisite.
function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Check ancestors too: a nonexistent leaf can still escape through a linked parent.
function assertNoSymlinks(target) {
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Refusing symlink path: ${current}`);
    }
    if (path.dirname(current) === current) break;
  }
}

// Within the checkout, only this command's exact generated root is writable.
// Also reject ancestors and shared home/temp roots that a bad --output could target.
export function assertOutput(root, repoRoot, allowedRoot) {
  assertNoSymlinks(root);
  if (within(root, repoRoot) || (within(repoRoot, root) && root !== allowedRoot) ||
      root === fs.realpathSync(os.homedir()) || root === fs.realpathSync(os.tmpdir())) {
    throw new Error(`Refusing unsafe output path: ${root}`);
  }
}

export function walkFiles(root) {
  // A linked root or ancestor is followed by readdirSync before its entries can
  // be checked. Validate that boundary too, for both source and output trees.
  assertNoSymlinks(root);
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in package: ${file}`);
    if (entry.isDirectory()) files.push(...walkFiles(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported package entry: ${file}`);
  }
  return files;
}

/** Validate a filename -> content/mode plan, then return its write closure.
 * Only unchanged inventory-owned files may be replaced or removed. Ownership is
 * checked before writes, including permission changes and unknown empty folders.
 * This is preflight validation, not an atomic transaction or a concurrent-writer
 * lock; keep the plan and output stable until the returned closure completes.
 */
export function prepareWrite(root, files) {
  assertNoSymlinks(root);
  for (const relative of files.keys()) {
    if (!relative || relative === "." || /[\r\n]/.test(relative) || path.normalize(relative) !== relative ||
        path.isAbsolute(relative) || !within(root, path.resolve(root, relative)) || relative === marker) {
      throw new Error(`Unsafe generated filename: ${relative}`);
    }
    for (let parent = path.dirname(relative); parent !== "."; parent = path.dirname(parent)) {
      if (files.has(parent) || parent === marker) throw new Error(`Conflicting generated filename: ${relative}`);
    }
  }
  let existing = [];
  if (fs.existsSync(root)) {
    if (!fs.statSync(root).isDirectory()) throw new Error("Output must be a directory");
    existing = walkFiles(root).map(file => path.relative(root, file));
    if (fs.readdirSync(root).length) {
      const markerPath = path.join(root, marker);
      if (!fs.existsSync(markerPath)) throw new Error(`Refusing nonempty output without a GPK generated marker: ${root}`);
      const inventory = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      if (inventory.generator !== "gpk" || !inventory.files) throw new Error(`Invalid generated marker: ${root}`);
      for (const relative of existing.filter(file => file !== marker)) {
        if (inventory.files[relative] !== hash(fs.readFileSync(path.join(root, relative)))) {
          throw new Error(`Refusing unexpected or modified output file: ${path.join(root, relative)}`);
        }
        if (inventory.modes?.[relative] !== undefined &&
            inventory.modes[relative] !== (fs.statSync(path.join(root, relative)).mode & 0o777)) {
          throw new Error(`Refusing modified output permissions: ${path.join(root, relative)}`);
        }
      }
    }
  }
  // Only directories implied by owned files may be pruned. Refuse a replacement
  // that would also remove an unknown (even empty) directory, before any writes.
  const ownedDirectories = new Set();
  for (const relative of existing) {
    for (let parent = path.dirname(relative); parent !== "."; parent = path.dirname(parent)) ownedDirectories.add(parent);
  }
  function checkReplaceableDirectory(relative) {
    if (!ownedDirectories.has(relative)) throw new Error(`Refusing unknown output directory: ${path.join(root, relative)}`);
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.isDirectory()) checkReplaceableDirectory(path.join(relative, entry.name));
    }
  }
  for (const relative of files.keys()) {
    // An owned ancestor may currently be a file and will be removed below.
    let stat;
    try { stat = fs.statSync(path.join(root, relative), { throwIfNoEntry: false }); }
    catch (error) { if (error.code !== "ENOTDIR") throw error; }
    if (stat?.isDirectory()) checkReplaceableDirectory(relative);
  }
  const sorted = [...files].sort(([a], [b]) => a.localeCompare(b, "en"));
  const inventory = {
    generator: "gpk",
    files: Object.fromEntries(sorted.map(([name, file]) => [name, hash(contentOf(file))])),
    modes: Object.fromEntries(sorted.map(([name, file]) => [name, modeOf(file)])),
  };
  return () => {
    // Remove obsolete files before pruning empty owned directories, allowing a
    // resource to change between file and directory without deleting unknown content.
    for (const relative of existing.filter(file => file !== marker && !files.has(file))) fs.unlinkSync(path.join(root, relative));
    for (const relative of [...ownedDirectories].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)) {
      const directory = path.join(root, relative);
      if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
    }
    for (const [relative, entry] of files) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contentOf(entry));
      fs.chmodSync(file, modeOf(entry));
    }
    fs.mkdirSync(root, { recursive: true });
    // Record ownership last; a failed write must not advertise a fully committed plan.
    fs.writeFileSync(path.join(root, marker), json(inventory));
  };
}
