import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchor paths to this module rather than cwd; callers may launch from another directory.
export const repoRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
export const distRoot = path.join(repoRoot, "dist");
export const marketplaceRoot = path.join(distRoot, "marketplace");
export const typesRoot = path.join(distRoot, "types");
