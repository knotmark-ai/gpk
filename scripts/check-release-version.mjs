#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parse(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some(part => /^0\d+$/.test(part))) throw new Error(`Invalid release version: ${version}`);
  // Avoid Number precision loss when comparing arbitrarily large numeric identifiers.
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

// Compare SemVer precedence, including numeric prerelease identifiers. Build
// metadata does not turn the same version into a newer release.
export function compareVersions(left, right) {
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    return (xn ? BigInt(x) > BigInt(y) : x > y) ? 1 : -1;
  }
  return 0;
}

// CI uses this for new tags; retries of existing tags are checked against their content.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [incomingFile, currentFile, tag] = process.argv.slice(2);
  if (!incomingFile || !currentFile || !tag) throw new Error("Usage: check-release-version.mjs INCOMING CURRENT TAG");
  const incoming = JSON.parse(fs.readFileSync(incomingFile, "utf8")).version;
  parse(incoming);
  if (tag !== `v${incoming}`) throw new Error("Distribution tag must match release.json version");
  if (fs.existsSync(currentFile)) {
    const current = JSON.parse(fs.readFileSync(currentFile, "utf8")).version;
    if (compareVersions(incoming, current) <= 0) {
      throw new Error(`Refusing distribution rollback or duplicate version: ${current} -> ${incoming}`);
    }
  }
}
