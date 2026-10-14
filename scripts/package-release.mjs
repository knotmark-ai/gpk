#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArguments, prepareBuild, metadata } from "./build-plugins.mjs";
import { assertOutput, contentOf, modeOf, prepareWrite } from "./lib/generated-files.mjs";
import { distRoot, repoRoot } from "./lib/paths.mjs";

const options = parseArguments(process.argv.slice(2), {
  allowTarget: false, usage: "Usage: package-release.mjs [--output PATH] [--previews]",
});
const output = path.resolve(options.output ?? distRoot);
assertOutput(output, repoRoot, distRoot);
const release = new Map();
// Both installable directories and ZIPs derive from this one validated file plan.
const plan = prepareBuild({ output: path.join(output, "marketplace"), previews: options.previews });
const marketplace = plan.files;
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gpk-release-"));

// ZIP uses the platform's zip command; all input files have a fixed timestamp,
// sorted paths and no extended attributes. No developer files enter the archive.
function archive(name, files) {
  const staging = path.join(temporary, name);
  for (const [relative, entry] of files) {
    const file = path.join(staging, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contentOf(entry));
    fs.chmodSync(file, modeOf(entry));
    fs.utimesSync(file, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
  }
  const zip = path.join(temporary, `${name}.zip`);
  execFileSync("zip", ["-X", "-q", zip, "-@"], {
    cwd: staging, input: [...files.keys()].sort().join("\n") + "\n",
    env: { ...process.env, TZ: "UTC" }, stdio: ["pipe", "pipe", "pipe"],
  });
  release.set(`${name}.zip`, fs.readFileSync(zip));
}

try {
  for (const target of plan.targets) {
    // Keep Hermes' skills/ tap layout; remove other platform prefixes for standalone ZIPs.
    const prefix = target === "hermes" ? "skills/" : `${target}/`;
    const files = new Map([...marketplace].filter(([file]) => file.startsWith(prefix))
      .map(([file, entry]) => [target === "hermes" ? file : file.slice(prefix.length), entry]));
    if (target === "workbuddy") {
      // WorkBuddy consumes one Skill per archive rather than a multi-Skill plugin bundle.
      const skills = [...new Set([...files.keys()].map(file => file.split("/")[0]))];
      for (const skill of skills) archive(`${skill}-workbuddy-${metadata.version}`, new Map([...files].filter(([file]) => file.startsWith(`${skill}/`))));
    } else archive(`${metadata.name}-${target}-${metadata.version}`, files);
  }
  archive(`${metadata.name}-marketplace-${metadata.version}`, marketplace);
  const checksums = [...release].filter(([file]) => file.endsWith(".zip")).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([file, content]) => `${createHash("sha256").update(content).digest("hex")}  ${file}`).join("\n") + "\n";
  release.set("SHA256SUMS", checksums);
  // Preflight both owners so an ownership conflict leaves both trees untouched.
  // The sequential writes are not a filesystem transaction. Type output is independent.
  const writeArchives = prepareWrite(path.join(output, "archives"), release);
  plan.write();
  writeArchives();
  console.log(`Packaged ${metadata.version}: marketplace/ and archives/ at ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
