import { readFileSync } from "node:fs";
import process from "node:process";

// Host configuration selects the event. Drain, but never interpret or retain,
// the host payload: routing requires neither prompt text nor backend context.
process.stdin.resume();

const event = process.argv[2];
try {
  if (event !== "SessionStart" && event !== "UserPromptSubmit") {
    throw new Error("Unsupported GPK entry Hook event");
  }
  const resource = event === "SessionStart" ? "routing.md" : "checkpoint.md";
  const context = readFileSync(new URL(`../rules/${resource}`, import.meta.url), "utf8").trim();
  if (!context) throw new Error("Empty GPK entry Hook resource");
  // Both supported hosts accept this additionalContext envelope. Do not emit
  // stop/permission decisions or echo user input into model instructions.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: context },
  }) + "\n");
} catch {
  process.stderr.write("GPK routing context could not be loaded; use the explicit gpk Skill.\n");
  // Non-blocking failure: code 2 has host-specific blocking semantics.
  process.exitCode = 1;
}
