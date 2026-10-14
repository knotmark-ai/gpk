import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Opt-in debug trace for development runs. stdout belongs to MCP and the host keeps
 * stderr out of sight, so with `GPK_DEBUG` set the runtime appends one line per event
 * to a file (`GPK_DEBUG=1` → `<control root>/logs/debug.log`; any other value is the
 * file path). Unconfigured, `debug()` does nothing, so tests and normal runs stay quiet.
 *
 * Lines are redacted before they are written: OAuth codes and tokens, the onboarding
 * launch token and session cookie never reach the file, and every value is truncated
 * so record bodies do not land in the log whole.
 */
let file: string | null = null;
const MAX_VALUE = 300;

export function configureDebugLog(env: NodeJS.ProcessEnv, controlRoot: string): string | null {
  const setting = env.GPK_DEBUG?.trim();
  if (!setting || setting === "0" || setting === "false") { file = null; return null; }
  const target = setting === "1" || setting === "true" ? path.join(controlRoot, "logs", "debug.log") : path.resolve(setting);
  try {
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    file = target;
  } catch {
    file = null;
  }
  return file;
}

export function debugEnabled(): boolean {
  return file !== null;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/([?&#](?:t|code|state|code_verifier|access_token|refresh_token)=)[^&\s"']+/gi, "$1***"],
  [/("?(?:access_token|refresh_token|id_token|client_secret|code_verifier|verifier|token)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, "$1***"],
  [/(gpk_session=)[^;\s"]+/gi, "$1***"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1***"],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function render(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  const clean = redact(text).replace(/\s*\n\s*/g, " ⏎ ");
  return clean.length > MAX_VALUE ? `${clean.slice(0, MAX_VALUE)}…(+${clean.length - MAX_VALUE})` : clean;
}

/** Append `<time> [<area>] <event> key=value …`; never throws. */
export function debug(area: string, event: string, fields: Record<string, unknown> = {}): void {
  if (!file) return;
  const parts = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${render(value)}`);
  const line = `${new Date().toISOString()} [${area}] ${event}${parts.length ? " " + parts.join(" ") : ""}\n`;
  try { appendFileSync(file, line, { mode: 0o600 }); } catch { /* a debug trace must never break the runtime */ }
}

/** Milliseconds since `start`, for duration fields. */
export const since = (start: number) => `${Date.now() - start}ms`;
