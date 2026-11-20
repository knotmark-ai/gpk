import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IngestOriginPolicy } from "../domain/user-control-port.js";
import type { Result } from "../domain/operation-types.js";

export const AUTO_INGEST_PROMPT = "GPK automatic session retention.";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
export const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const codePointCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A reader projection, not another knowledge entity. Text excludes tool payloads,
 * thinking, setup instructions and GPK's generated continuation/receipts.
 */
export type SessionTurn = { id: string; time: string; text: string; digest: string };
export type SessionInput = { key: string; reader: string; session: string; origin: string; locator: string; turns: SessionTurn[] };

const fail = (message: string): Result<never> => ({ ok: false, error: { code: "invalid", message, affected: [], next: "Inspect the session configuration or transcript format before retrying." } });
export function validateSessionOrigins(origins: IngestOriginPolicy[]): Result<IngestOriginPolicy[]> {
  if (origins.length > 20) return fail("At most 20 session origins are supported.");
  const ids = new Set<string>();
  for (const origin of origins) {
    if (!origin || typeof origin.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(origin.id) || ids.has(origin.id)) return fail("Session origins need distinct, nonblank IDs (letters, digits, _ or -).");
    ids.add(origin.id);
    if (origin.reader !== "claude-code" && origin.reader !== "codex" && origin.reader !== "antigravity") return fail("Supported session readers are claude-code, codex and antigravity.");
    if (typeof origin.location !== "string" || !path.isAbsolute(origin.location) || path.dirname(origin.location) === origin.location) return fail("A session origin must be an absolute folder path below the filesystem root.");
    if (!Array.isArray(origin.exclusions) || !origin.exclusions.every(value => typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.split("/").includes("..") && !/[?*\[\]]/.test(value) && !path.isAbsolute(value))) return fail("Exclusions are literal relative paths or directory prefixes ending in /; globs and .. are unsupported.");
    if (origin.depth !== undefined && !["save", "wiki", "research"].includes(origin.depth)) return fail("Choose a supported ingest depth.");
    if (!["summary", "excerpts", "full"].includes(origin.retention) || typeof origin.instructions !== "string") return fail("Every origin needs retention and preparation instructions.");
  }
  return { ok: true, value: origins, limits: [] };
}

const DEFAULT_HARNESS_DIRS: readonly { id: string; reader: IngestOriginPolicy["reader"]; rel: string }[] = [
  { id: "claude-code", reader: "claude-code", rel: ".claude/projects" },
  { id: "codex", reader: "codex", rel: ".codex/sessions" },
  { id: "antigravity", reader: "antigravity", rel: ".gemini/antigravity-cli/brain" },
];

/** Discover installed host harness transcript roots automatically when no custom origins are stored. */
export function resolveDefaultSessionOrigins(options?: {
  homeDir?: string | undefined;
  retention?: IngestOriginPolicy["retention"] | undefined;
  depth?: IngestOriginPolicy["depth"] | undefined;
  instructions?: string | undefined;
}): IngestOriginPolicy[] {
  const home = options?.homeDir || process.env.HOME || os.homedir();
  if (!home || !path.isAbsolute(home)) return [];
  const retention = options?.retention ?? "summary";
  const depth = options?.depth ?? "save";
  const instructions = options?.instructions ?? "";
  const resolved: IngestOriginPolicy[] = [];
  for (const candidate of DEFAULT_HARNESS_DIRS) {
    try {
      const full = path.join(home, candidate.rel);
      const real = realpathSync(full);
      if (statSync(real).isDirectory() && path.dirname(real) !== real) {
        resolved.push({
          id: candidate.id,
          reader: candidate.reader,
          location: real,
          exclusions: [],
          retention,
          ...(depth ? { depth } : {}),
          instructions,
        });
      }
    } catch { /* Harness is not installed on this machine yet. */ }
  }
  return resolved;
}

/** Check synchronously whether `transcriptPath` is a real `.jsonl` file inside an approved origin without symlinks or exclusions. */
export function isApprovedSessionTranscriptSync(transcriptPath: string, origins: readonly IngestOriginPolicy[]): boolean {
  if (typeof transcriptPath !== "string" || !transcriptPath.endsWith(".jsonl")) return false;
  let transcript: string;
  try {
    const linkInfo = lstatSync(transcriptPath);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) return false;
    transcript = realpathSync(transcriptPath);
  } catch {
    return false;
  }
  return origins.some(origin => {
    try {
      const root = realpathSync(origin.location);
      const relative = path.relative(root, transcript);
      const portable = relative.split(path.sep).join("/");
      return !path.isAbsolute(relative)
        && relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !origin.exclusions.some(excluded => excluded.endsWith("/") ? `${portable}/`.startsWith(excluded) : portable === excluded);
    } catch {
      return false;
    }
  });
}

function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part && ["text", "input_text", "output_text"].includes(part.type) && typeof part.text === "string").map(part => part.text).join("\n");
}
function automaticCall(name: unknown, input: unknown): boolean {
  if (typeof name !== "string" || !/(?:^|[_:])gpk_sessions_(?:query|begin|next)$/.test(name)) return false;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { return false; } }
  if (!input || typeof input !== "object" || !("mode" in input)) return false;
  return input.mode === "automatic" || input.mode === '"automatic"';
}
function antigravityUserText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const match = raw.match(/<USER_REQUEST>\r?\n?([\s\S]*?)\r?\n?<\/USER_REQUEST>/);
  if (match) return match[1]!.trim();
  return raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, "")
    .trim();
}
function antigravitySessionId(rows: any[], locator: string): string | undefined {
  const rowIds = new Set(rows.map(row => row?.conversationId ?? row?.conversation_id).filter((id): id is string => typeof id === "string" && id.length > 0));
  if (rowIds.size > 1) return undefined;
  if (rowIds.size === 1) return [...rowIds][0];
  const normalized = locator.split(path.sep).join("/");
  const brain = normalized.match(/(?:^|\/)([a-zA-Z0-9_-]{1,160})\/\.system_generated\/logs\/transcript(?:_full)?\.jsonl$/);
  if (brain) return brain[1];
  const stem = path.basename(locator, ".jsonl");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem)) return stem;
  return undefined;
}
function hasTruncatedConversationStep(bytes: string): boolean {
  if (!bytes.includes('"truncated_fields"')) return false;
  for (const line of bytes.split("\n")) {
    if (!line.includes('"truncated_fields"') || (!line.includes('"USER_INPUT"') && !line.includes('"PLANNER_RESPONSE"'))) continue;
    try {
      const row = JSON.parse(line);
      if ((row?.type === "USER_INPUT" || row?.type === "PLANNER_RESPONSE") && Array.isArray(row.truncated_fields)
        && row.truncated_fields.some((field: unknown) => field === "content" || field === "tool_calls")) return true;
    } catch { /* handled by parseSession */ }
  }
  return false;
}

/** Supported on-disk JSONL shapes are deliberately explicit. An unknown/malformed
 * record makes coverage partial; it never becomes model instructions or proof of
 * full access. Native session identity is independent of path and export time.
 */
function parseSession(bytes: string, origin: IngestOriginPolicy, locator: string): Result<SessionInput | null> {
  const rows: any[] = [];
  let incomplete = false;
  for (const line of bytes.split("\n")) {
    if (!line.trim()) continue;
    try { const value = JSON.parse(line); if (!value || typeof value !== "object") incomplete = true; else rows.push(value); }
    catch { incomplete = true; }
  }
  if (origin.reader === "antigravity" && !incomplete && rows.length > 0
    && rows.every(row => typeof row.step_index === "number")
    && !rows.some(row => row.type === "USER_INPUT")
    && rows[0]?.type === "SYSTEM_MESSAGE") {
    return { ok: true, value: null, limits: [] };
  }
  const meta = origin.reader === "codex" ? rows.find(row => row.type === "session_meta")?.payload : null;
  const ids = new Set<string>(
    origin.reader === "codex" ? [meta?.id].filter(Boolean)
      : origin.reader === "antigravity" ? [antigravitySessionId(rows, locator)].filter((id): id is string => Boolean(id))
      : rows.filter(row => !row.isSidechain).map(row => row.sessionId).filter(Boolean),
  );
  if (ids.size !== 1 || ![...ids].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id))) return fail("The transcript has no unambiguous supported native session identity.");
  const session = [...ids][0]!;
  const turns: SessionTurn[] = [];
  let current: { id: string; time: string; parts: string[] } | null = null;
  let generated = false;
  const flush = () => {
    if (current) {
      const text = current.parts.join("\n\n");
      turns.push({ id: current.id, time: current.time, text, digest: fingerprint([current.time, text]) });
    }
    current = null;
  };
  // Use response_item when available; event_msg is a separate older projection,
  // never a second copy of the same messages.
  const responses = rows.some(row => row.type === "response_item" && row.payload?.type === "message");
  for (const row of rows) {
    let role: string | undefined, text = "", nativeId: string | undefined;
    if (origin.reader === "antigravity") {
      if (row.type === "SYSTEM_MESSAGE") {
        if (typeof row.content === "string" && row.content.includes(AUTO_INGEST_PROMPT)) { flush(); generated = true; }
        continue;
      }
      if (row.type === "USER_INPUT") {
        if (row.source && row.source !== "USER_EXPLICIT") continue;
        role = "user";
        text = antigravityUserText(row.content);
        nativeId = typeof row.step_index === "number" && Number.isInteger(row.step_index) && row.step_index >= 0 ? `step-${row.step_index}` : undefined;
      } else if (row.type === "PLANNER_RESPONSE") {
        role = "assistant";
        const content = typeof row.content === "string" ? row.content : "";
        if (Array.isArray(row.tool_calls) && row.tool_calls.some((call: any) => automaticCall(call?.name, call?.args ?? call?.arguments ?? call?.input))) {
          if (current && !generated && content.trim() && !content.startsWith(AUTO_INGEST_PROMPT)) current.parts.push(`Assistant: ${content}`);
          flush(); generated = true; continue;
        }
        text = content;
      } else continue;
    } else if (origin.reader === "claude-code") {
      if (row.isSidechain || row.isMeta || !["user", "assistant"].includes(row.type)) continue;
      role = row.message?.role; text = plainText(row.message?.content); nativeId = typeof row.uuid === "string" ? row.uuid : undefined;
      if (role === "assistant" && Array.isArray(row.message?.content)) {
        const index = row.message.content.findIndex((part: any) => part?.type === "tool_use" && automaticCall(part.name, part.input));
        if (index >= 0) {
          const preceding = plainText(row.message.content.slice(0, index));
          if (current && !generated && preceding.trim()) current.parts.push(`Assistant: ${preceding}`);
          flush(); generated = true; continue;
        }
      }
    } else if (responses) {
      if (row.type !== "response_item") continue;
      if (row.payload?.type === "function_call" && automaticCall(row.payload.name, row.payload.arguments)) { flush(); generated = true; continue; }
      if (row.payload?.type !== "message") continue;
      role = row.payload.role; text = plainText(row.payload.content); nativeId = typeof row.payload.id === "string" ? row.payload.id : undefined;
    } else {
      if (row.type !== "event_msg") continue;
      if (row.payload?.type === "user_message") role = "user";
      if (row.payload?.type === "agent_message") role = "assistant";
      text = typeof row.payload?.message === "string" ? row.payload.message : "";
    }
    if (!text.trim() || (role !== "user" && role !== "assistant")) continue;
    if (role === "assistant" && text.startsWith(AUTO_INGEST_PROMPT)) { flush(); generated = true; continue; }
    if (role === "user") {
      flush(); generated = false;
      if (text.startsWith(AUTO_INGEST_PROMPT)) { generated = true; continue; }
      if (/^(# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<INSTRUCTIONS>)/.test(text.trim())) continue;
      const rawTime = origin.reader === "antigravity" ? row.created_at : row.timestamp;
      const time = typeof rawTime === "string" ? rawTime : "";
      if (!time || !Number.isFinite(Date.parse(time))) { incomplete = true; continue; }
      // Timestamp+ordinal remains stable on append when the host omits message IDs.
      current = { id: nativeId || `${time}/${turns.length}`, time, parts: [`User: ${text}`] };
    } else if (current && !generated) current.parts.push(`Assistant: ${text}`);
  }
  flush();
  if (!turns.length) return fail("No supported, dated user/assistant turns were found in the transcript.");
  if (new Set(turns.map(turn => turn.id)).size !== turns.length) return { ok: false, error: { code: "ambiguous", message: "The transcript repeats native turn identities.", affected: [], next: "Reconcile its branch before importing." } };
  return { ok: true, value: { key: `${origin.reader}:${session}`, reader: origin.reader, session, origin: origin.id, locator, turns }, limits: incomplete ? ["Some transcript records were malformed or undated; only the returned turns are covered."] : [] };
}

/** Scan only approved real directories, never follow symlinks, and bound both
 * traversal and each JSONL read. Gaps are reported rather than silently skipped.
 */
export async function readSessions(origins: IngestOriginPolicy[]): Promise<Result<SessionInput[]>> {
  const valid = validateSessionOrigins(origins); if (!valid.ok) return valid;
  const sessions = new Map<string, SessionInput>();
  const limits: string[] = [];
  let entries = 0;
  for (const origin of origins) {
    let root: string;
    try { root = await realpath(origin.location); if (path.dirname(root) === root || !(await stat(root)).isDirectory()) throw new Error(); }
    catch { limits.push(`Origin ${origin.id} is not an accessible directory.`); continue; }
    const queue = [root];
    while (queue.length && entries < MAX_ENTRIES) {
      const dir = queue.shift()!;
      let children;
      try { children = await readdir(dir, { withFileTypes: true }); }
      catch { limits.push(`A directory in origin ${origin.id} was inaccessible.`); continue; }
      children.sort((a, b) => codePointCompare(a.name, b.name));
      for (const child of children) {
        if (++entries > MAX_ENTRIES) break;
        const file = path.join(dir, child.name);
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (origin.exclusions.some(excluded => excluded.endsWith("/") ? `${relative}/`.startsWith(excluded) : relative === excluded)) continue;
        if (child.isSymbolicLink()) { limits.push(`A symlink in origin ${origin.id} was excluded.`); continue; }
        if (child.isDirectory()) {
          if (origin.reader === "antigravity") {
            const parentName = path.basename(dir);
            if ((parentName === ".system_generated" && child.name !== "logs") || (parentName === "logs" && child.name === "chunks")) continue;
          }
          queue.push(file); continue;
        }
        if (!child.isFile() || !child.name.endsWith(".jsonl")) continue;
        if (origin.reader === "antigravity" && child.name === "transcript_full.jsonl") continue;
        try {
          // Resolve again just before reading to reject replaced directory links.
          const actual = await realpath(file);
          const inside = path.relative(root, actual);
          if (inside.startsWith(`..${path.sep}`) || inside === ".." || path.isAbsolute(inside)) throw new Error();
          const info = await stat(actual);
          if (info.size > MAX_FILE_BYTES) { limits.push(`A transcript in origin ${origin.id} exceeds the 16 MiB reader budget.`); continue; }
          let bytes = await readFile(actual, "utf8");
          if (origin.reader === "antigravity" && child.name === "transcript.jsonl" && hasTruncatedConversationStep(bytes)) {
            const fullCandidate = path.join(path.dirname(actual), "transcript_full.jsonl");
            try {
              const fullLink = lstatSync(fullCandidate);
              if (!fullLink.isSymbolicLink() && fullLink.isFile()) {
                const fullActual = await realpath(fullCandidate);
                const fullInside = path.relative(root, fullActual);
                if (!fullInside.startsWith(`..${path.sep}`) && fullInside !== ".." && !path.isAbsolute(fullInside) && fullLink.size <= MAX_FILE_BYTES) {
                  bytes = await readFile(fullActual, "utf8");
                } else limits.push(`A transcript in origin ${origin.id} had truncated steps whose transcript_full.jsonl exceeded the 16 MiB reader budget.`);
              } else limits.push(`A transcript in origin ${origin.id} had truncated steps without an accessible transcript_full.jsonl.`);
            } catch {
              limits.push(`A transcript in origin ${origin.id} had truncated steps without an accessible transcript_full.jsonl.`);
            }
          }
          const parsed = parseSession(bytes, origin, actual);
          if (!parsed.ok) {
            if (parsed.error.code === "ambiguous") return parsed;
            limits.push(`An unsupported transcript in origin ${origin.id} was excluded: ${parsed.error.message}`); continue;
          }
          limits.push(...parsed.limits);
          if (parsed.value === null) continue;
          const previous = sessions.get(parsed.value.key);
          if (previous && fingerprint(previous.turns) !== fingerprint(parsed.value.turns)) return { ok: false, error: { code: "ambiguous", message: `Different transcripts have the same session identity ${parsed.value.key}.`, affected: [], next: "Exclude the conflicting export or choose its intended version; nothing was ingested." } };
          if (!previous) sessions.set(parsed.value.key, parsed.value);
        } catch { limits.push(`A transcript in origin ${origin.id} could not be read safely.`); }
      }
    }
  }
  if (entries >= MAX_ENTRIES) limits.push("The 10000-entry scan budget was reached; use a narrower days window to cover recent sessions.");
  return { ok: true, value: [...sessions.values()].sort((a, b) => codePointCompare(a.key, b.key)), limits: [...new Set(limits)] };
}
