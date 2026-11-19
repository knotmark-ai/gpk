import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { AreaRef, OutputRef, ProjectRef, Ref, SourceRef, TaskRef, TaskState, WikiRef } from "../domain/entities.js";
import type { ContentUpdate, KnowledgeLink, SourceOperations, TaskInput, TextEdit } from "../domain/knowledge-backend-port.js";
import type { CreateReceipt, Failure, Result, Snapshot, Version, WriteReceipt } from "../domain/operation-types.js";
import type { UserSettings } from "../domain/user-control-port.js";
import { fingerprint, readSessions, resolveDefaultSessionOrigins, validateSessionOrigins, type SessionInput, type SessionTurn } from "./session-reader.js";

export type SessionEntityRef = AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
type Effect = { state: "pending" | "verified"; ref?: SessionEntityRef };
type Batch = { id: string; dailyDate?: string; turns: Record<string, string>; times: Record<string, string>; prepared?: { title: string; content: string }; sourceAttempted?: boolean; retained?: boolean; effects: Record<string, Effect> };
type Progress = { schemaVersion: 1; key: string; source?: SourceRef; turns: Record<string, string>; batch?: Batch };

/** Concrete host integration callbacks; semantic Ingest still runs in the Skill.
 * Every callback uses the ordinary operation guards and current backend binding.
 */
export type SessionIngestionOptions = {
  controlRoot: string;
  homeDir?: string | undefined;
  settings: () => Promise<Result<UserSettings>>;
  today: () => Promise<Result<string>>;
  recordSource: (source: SourceRef, date: string) => Promise<Result<WriteReceipt>>;
  checkpointRead: (key: string) => Promise<Result<Snapshot<string> | null>>;
  checkpointSave: (key: string, content: string, expected?: Version) => Promise<Result<WriteReceipt>>;
  sourcesQuery: SourceOperations["query"];
  sourcesRead: SourceOperations["read"];
  sourcesCreate: (input: { title: string; content: string }) => Promise<Result<CreateReceipt<SourceRef>>>;
  sourcesUpdate: (ref: SourceRef, edits: TextEdit[], expected?: Version) => Promise<Result<WriteReceipt>>;
  inspect: (ref: SessionEntityRef) => Promise<Result<{ version?: string; coverage: string }>>;
  wikisCreate?: (input: { title: string; content: string }) => Promise<Result<CreateReceipt<WikiRef>>>;
  wikisUpdate?: (ref: WikiRef, update: ContentUpdate, expected?: Version) => Promise<Result<WriteReceipt>>;
  tasksCreate?: (input: TaskInput) => Promise<Result<CreateReceipt<TaskRef>>>;
  linksAdd?: (link: KnowledgeLink) => Promise<Result<WriteReceipt>>;
};

/** days is a rolling N×24-hour window of original user-turn timestamps, not file
 * mtime or import date. Omit for all approved history. until defaults to now.
 * mode never grants access: automatic additionally requires enabled=true.
 */
export type SessionSelection = { mode: "manual" | "automatic"; days?: number; until?: string; origin?: string };
export type SessionQuery = SessionSelection & { cursor?: string; limit?: number };
export type SessionNextInput = SessionSelection & {
  /** Explicit session key to claim; omit to claim the next session with changed turns or unfinished batch. */
  key?: string;
  /** Active session token when continuing to read a multi-page transcript. */
  token?: string;
  /** Exact character offset from the preceding page when `token` is supplied. */
  cursor?: number;
};
export type SessionWikiAction =
  | { action: "create"; name: string; title: string; content: string }
  | { action: "update"; name: string; ref: WikiRef; title?: string; edits?: TextEdit[]; append?: string; expected?: Version };
export type SessionTaskAction = {
  name: string;
  title: string;
  content?: string;
  state?: TaskState;
  time?: string;
  project?: ProjectRef;
};
export type SessionLinkAction = {
  name: string;
  /** Pass `"source"` to link from/to this session's retained Source, or an explicit entity reference. */
  from: "source" | SessionEntityRef;
  to: "source" | SessionEntityRef;
  context: string;
};
export type SessionApplyInput = {
  token: string;
  outcome: "retain" | "skip" | "release";
  reason: string;
  source?: { title: string; content: string };
  wikis?: SessionWikiAction[];
  tasks?: SessionTaskAction[];
  links?: SessionLinkAction[];
  reconcile?: { name: string; ref: SessionEntityRef; expected: Version }[];
};

type Run = { token: string; file: string; selection: SessionSelection; binding: string; input: SessionInput; progress: Progress; version?: string; batch: Batch; material: string; readTo: number };
const PAGE_CHARS = 24_000;
const LOCK_LEASE_MS = 30 * 60_000;
const fail = (code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> => ({ ok: false, error: { code, message, next, affected } });
const ok = <T>(value: T, limits: string[] = []): Result<T> => ({ ok: true, value, limits });
const marker = (key: string) => `GPK session: ${key}`;
const batchMarker = (id: string) => `GPK input: ${id}`;
const hasLine = (content: string, line: string) => content.split(/\r?\n/).some(part => part.trim() === line);

function dedupeRefs(refs: readonly Ref[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const ref of refs) {
    const key = `${"kind" in ref && typeof ref.kind === "string" ? ref.kind : ""}:${ref.scope}:${ref.id}`;
    if (!seen.has(key)) { seen.add(key); out.push(ref); }
  }
  return out;
}

function containsPreparation(body: string, batch: Batch): boolean {
  const found = new RegExp(`(^|\\r?\\n)${batchMarker(batch.id)}(?:\\r?\\n|$)`).exec(body);
  if (!found || !batch.prepared) return false;
  // Providers can separate native list items and headings with paragraph breaks.
  const lines = (text: string) => text.trim().split(/\r?\n/).filter(line => line.trim()).map(line => line.replace(/^(\s*)[·•] /, "$1- "));
  const actual = lines(body.slice(found.index + found[0].length));
  return lines(batch.prepared.content).every((line, index) => line === actual[index]);
}
const turnMap = (turns: SessionTurn[]) => Object.fromEntries(turns.map(turn => [fingerprint(turn.id), turn.digest]));

export function createSessionIngestion(options: SessionIngestionOptions) {
  const runs = new Map<string, Run>();
  // No knowledge or processing progress lives in these files: they are exclusive
  // local process ownership only. Backend checkpoints remain the durable authority.
  async function claim(key: string, token: string): Promise<Result<string>> {
    const file = path.join(options.controlRoot, "locks", `session-${fingerprint(key)}.lock`);
    try { await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); }
    catch { return fail("unavailable", "The session processing lock directory could not be created.", "Check the selected control root."); }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(file, "wx", 0o600);
        let written = false;
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, claimedAt: Date.now() }));
          written = true;
        } finally {
          await handle.close().catch(() => undefined);
          if (!written) await unlink(file).catch(() => undefined);
        }
        return ok(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return fail("unavailable", "The session processing lock could not be created.", "Check the selected control root.");
        try {
          const bytes = await readFile(file, "utf8");
          const owner = JSON.parse(bytes) as { pid?: number; token?: string; claimedAt?: number };
          if (!Number.isSafeInteger(owner.pid) || owner.pid! < 1) throw new Error();
          const expired = typeof owner.claimedAt === "number" && Number.isFinite(owner.claimedAt) && Date.now() - owner.claimedAt > LOCK_LEASE_MS;
          let deadProcess = false;
          try { process.kill(owner.pid!, 0); }
          catch (dead) {
            if ((dead as NodeJS.ErrnoException).code === "ESRCH") deadProcess = true;
          }
          if ((deadProcess || expired) && await readFile(file, "utf8") === bytes) {
            if (typeof owner.token === "string") runs.delete(owner.token);
            await unlink(file);
            continue;
          }
        } catch { /* An unknown owner must not be stolen. */ }
        return fail("conflict", "This session is already being processed by another client or run.", "Let that run finish or release its token; a crashed process or expired lease is reclaimed on retry.");
      }
    }
    return fail("conflict", "Session ownership changed while claiming it.", "Retry later.");
  }
  async function unlock(file: string, token: string): Promise<void> {
    try { const owner = JSON.parse(await readFile(file, "utf8")); if (owner.token === token) await unlink(file); } catch { /* Preserve a replacement owner's lock. */ }
  }
  async function release(run: Run): Promise<void> {
    runs.delete(run.token);
    await unlock(run.file, run.token);
  }
  async function policy(selection: SessionSelection) {
    if ((selection.mode !== "manual" && selection.mode !== "automatic") || (selection.days !== undefined && (!Number.isInteger(selection.days) || selection.days < 1 || selection.days > 3650)) || (selection.until !== undefined && !Number.isFinite(Date.parse(selection.until)))) return fail("invalid", "Choose manual/automatic mode, 1–3650 days and an ISO until time when supplied.", "Correct the session selection.");
    const settings = await options.settings(); if (!settings.ok) return settings;
    const automatic = settings.value.ingestion.automatic;
    const rawOrigins = automatic.origins.length > 0
      ? automatic.origins
      : resolveDefaultSessionOrigins({
          homeDir: options.homeDir,
          retention: automatic.retention,
          depth: automatic.depth,
          instructions: automatic.instructions,
        });
    const checked = validateSessionOrigins(rawOrigins); if (!checked.ok) return checked;
    if (selection.mode === "automatic" && !automatic.enabled) return fail("unauthorized", "Automatic session retention is disabled.", "Enable it in the GPK Configuration console (gpk open) if wanted.");
    const origins = rawOrigins.filter(origin => !selection.origin || origin.id === selection.origin);
    if (!origins.length) return fail("unauthorized", "No installed harness session directory matches this request.", "Run a conversation in Claude Code, Codex or Antigravity first.");
    const eligible = selection.mode === "automatic" ? origins.filter(origin => origin.depth) : origins;
    if (!eligible.length) return fail("invalid", "No selected origin has an automatic ingest depth.", "Choose an automatic ingest depth in the GPK Configuration console (gpk open), or ingest manually.");
    const active = settings.value.knowledgeBackend.configurations.find(item => item.id === settings.value.knowledgeBackend.activeId);
    if (!active) return fail("invalid", "No active backend is configured.", "Complete GPK setup.");
    return ok({ origins: eligible, binding: `${active.id}:${active.instance}`, automatic });
  }
  async function load(key: string): Promise<Result<{ progress: Progress; version?: string }>> {
    const found = await options.checkpointRead(`ingest/session/${key}`); if (!found.ok) return found;
    if (!found.value) return ok({ progress: { schemaVersion: 1, key, turns: {} } });
    if (found.value.coverage !== "complete") return fail("unavailable", "The session checkpoint was read only partially.", "Complete or repair that checkpoint read before ingesting.");
    try {
      const progress = JSON.parse(found.value.value) as Progress;
      const hashes = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, digest]) => /^[a-f0-9]{64}$/.test(id) && typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest));
      if (progress.schemaVersion !== 1 || progress.key !== key || !hashes(progress.turns) || (progress.source && (progress.source.kind !== "Source" || typeof progress.source.id !== "string" || typeof progress.source.scope !== "string"))) throw new Error();
      if (progress.batch && (!/^[a-f0-9]{64}$/.test(progress.batch.id) || !hashes(progress.batch.turns) || !progress.batch.times || Object.keys(progress.batch.turns).some(id => !Number.isFinite(Date.parse(progress.batch!.times[id] ?? ""))) || !progress.batch.effects || Object.values(progress.batch.effects).some(effect => !effect || !["pending", "verified"].includes(effect.state)) || (progress.batch.prepared && (typeof progress.batch.prepared.title !== "string" || typeof progress.batch.prepared.content !== "string")))) throw new Error();
      return ok({ progress, ...(found.value.version ? { version: found.value.version } : {}) });
    } catch { return fail("invalid", "The session checkpoint is invalid or uses an unsupported schema.", "Inspect and repair it; do not discard progress and re-ingest blindly."); }
  }
  async function save(run: Run): Promise<Result<WriteReceipt>> {
    // Different sessions can share a previously absent GPK System page. Serialize
    // that native checkpoint-container creation as well as each checkpoint write.
    const owner = randomUUID();
    const held = await claim(`${run.binding}:session-progress`, owner); if (!held.ok) return held;
    try {
      const previous = await load(run.input.key); if (!previous.ok) return previous;
      if (previous.value.version !== run.version) return fail("conflict", "Session progress changed outside this run.", "Release the token and read the current checkpoint before continuing.");
      const written = await options.checkpointSave(`ingest/session/${run.input.key}`, JSON.stringify(run.progress), run.version);
      if (!written.ok) return written;
      if (!written.value.verified) return fail("uncertain", "The processing checkpoint was not verified.", "Read it back before any further write.");
      if (written.value.version) run.version = written.value.version;
      else delete run.version;
      return written;
    } finally { await unlock(held.value, owner); }
  }
  async function active(token: string): Promise<Result<Run>> {
    const run = runs.get(token); if (!run) return fail("not-found", "The session processing token is not active in this runtime.", "Call gpk_sessions_next again to recover its backend progress.");
    try {
      const owner = JSON.parse(await readFile(run.file, "utf8"));
      if (owner.pid !== process.pid || owner.token !== token) throw new Error();
    } catch { return fail("conflict", "This runtime no longer owns the session processing lock.", "Release this token via gpk_sessions_apply and claim again via gpk_sessions_next; do not write through stale ownership."); }
    const current = await policy(run.selection); if (!current.ok) return current;
    const origin = current.value.origins.find(origin => origin.id === run.input.origin && origin.reader === run.input.reader);
    if (current.value.binding !== run.binding || !origin) return fail("unauthorized", "The session origin or backend changed during processing.", "Release the token and start again under current configuration.");
    try {
      const relative = path.relative(await realpath(origin.location), await realpath(run.input.locator));
      const portable = relative.split(path.sep).join("/");
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || origin.exclusions.some(excluded => excluded.endsWith("/") ? `${portable}/`.startsWith(excluded) : portable === excluded)) throw new Error();
    } catch { return fail("unauthorized", "The session is no longer accessible under the approved origin and exclusions.", "Release this run; do not continue with revoked input."); }
    return ok(run);
  }
  function selected(input: SessionInput, selection: SessionSelection): SessionTurn[] {
    const until = selection.until ? Date.parse(selection.until) : Date.now();
    const since = selection.days ? until - selection.days * 86_400_000 : -Infinity;
    return input.turns.filter(turn => Date.parse(turn.time) >= since && Date.parse(turn.time) <= until);
  }
  function page(run: Run, offset: number) {
    const end = Math.min(offset + PAGE_CHARS, run.material.length);
    run.readTo = Math.max(run.readTo, end);
    return {
      token: run.token, key: run.input.key, text: run.material.slice(offset, end),
      ...(end < run.material.length ? { next: end } : {}),
      source: run.progress.source ?? null, effects: run.batch.effects, resuming: !!run.progress.batch,
      ...(run.batch.prepared ? { preparation: run.batch.prepared } : {}),
    };
  }

  const coordinator = {
    async query(query: SessionQuery) {
      const current = await policy(query); if (!current.ok) return current;
      const scan = await readSessions(current.value.origins); if (!scan.ok) return scan;
      let until = query.until ?? new Date().toISOString();
      let after = "";
      if (query.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
          if (!query.until) until = decoded.until;
          if (!Number.isFinite(Date.parse(until)) || decoded.selection !== fingerprint([query.mode, query.origin, query.days, until]) || typeof decoded.after !== "string") throw new Error();
          after = decoded.after;
        }
        catch { return fail("invalid", "The session cursor does not match this selection.", "Use the next cursor with the same selection."); }
      }
      const selection = { mode: query.mode, ...(query.days ? { days: query.days } : {}), ...(query.origin ? { origin: query.origin } : {}), until };
      const selectionHash = fingerprint([query.mode, query.origin, query.days, until]);
      const limit = query.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail("invalid", "Session page limit must be 1–50.", "Choose a smaller page.");
      const items: { key: string; origin: string; reader: string; session: string; changedTurns: number; pending: boolean }[] = [];
      let skipped = 0, last = after, more = false;
      for (const input of scan.value.filter(item => item.key > after)) {
        if (items.length >= limit) { more = true; break; }
        last = input.key;
        const turns = selected(input, selection); if (!turns.length) continue;
        const checkpoint = await load(input.key); if (!checkpoint.ok) return checkpoint;
        const changed = turns.filter(turn => checkpoint.value.progress.turns[fingerprint(turn.id)] !== turn.digest);
        if (!changed.length && !checkpoint.value.progress.batch) { skipped++; continue; }
        items.push({ key: input.key, origin: input.origin, reader: input.reader, session: input.session, changedTurns: changed.length, pending: !!checkpoint.value.progress.batch });
      }
      return ok({ items, skipped, selection, coverage: scan.limits.length ? "partial" : "complete", ...(more ? { next: Buffer.from(JSON.stringify({ selection: selectionHash, after: last, until })).toString("base64url") } : {}) }, scan.limits);
    },
    async begin(selection: SessionSelection, key: string) {
      const current = await policy(selection); if (!current.ok) return current;
      const scan = await readSessions(current.value.origins); if (!scan.ok) return scan;
      const input = scan.value.find(item => item.key === key); if (!input) return fail("not-found", "No session has that key.", "Omit key on gpk_sessions_next to claim the next changed session.");
      const token = randomUUID();
      const lock = await claim(`${current.value.binding}:${key}`, token); if (!lock.ok) return lock;
      let held = true;
      try {
        const checkpoint = await load(key); if (!checkpoint.ok) return checkpoint;
        const changed = selected(input, selection).filter(turn => checkpoint.value.progress.turns[fingerprint(turn.id)] !== turn.digest);
        const batch = checkpoint.value.progress.batch ?? { id: fingerprint(turnMap(changed)), turns: turnMap(changed), times: Object.fromEntries(changed.map(turn => [fingerprint(turn.id), turn.time])), effects: {} };
        if (!changed.length && !checkpoint.value.progress.batch) return ok({ skipped: true as const, key });
        const until = selection.until ? Date.parse(selection.until) : Date.now();
        const since = selection.days ? until - selection.days * 86_400_000 : -Infinity;
        if (Object.values(batch.times).some(time => Date.parse(time) < since || Date.parse(time) > until)) return fail("conflict", "This session has unfinished input outside the requested time window.", "Choose whether to resume that earlier window; it was not silently included in this request.");
        const original = input.turns.filter(turn => batch.turns[fingerprint(turn.id)] === turn.digest);
        if (original.length !== Object.keys(batch.turns).length && !batch.prepared) return fail("conflict", "The unretained input changed before recovery.", "Inspect its pending checkpoint and origin before retrying.");
        const material = original.length === Object.keys(batch.turns).length ? original.map(turn => `${turn.time} / ${turn.id}\n${turn.text}`).join("\n\n---\n\n") : `Recover the previously prepared material before processing newer changes:\n${batch.prepared!.content}`;
        const run: Run = { token, file: lock.value, selection, binding: current.value.binding, input, progress: checkpoint.value.progress, batch, material, readTo: 0, ...(checkpoint.value.version ? { version: checkpoint.value.version } : {}) };
        runs.set(token, run); held = false;
        const origin = current.value.origins.find(origin => origin.id === input.origin)!;
        return ok({ ...page(run, 0), skipped: false as const, origin: { reader: input.reader, session: input.session, locator: input.locator, retention: origin.retention, depth: origin.depth, instructions: origin.instructions }, sourceMarker: marker(key), checkpointKey: `ingest/session/${key}` }, scan.limits);
      } finally { if (held) await unlock(lock.value, token); }
    },
    async read(token: string, cursor: number) {
      const found = await active(token); if (!found.ok) return found;
      if (!Number.isInteger(cursor) || cursor !== found.value.readTo || cursor >= found.value.material.length) return fail("invalid", "Pass the exact next character cursor from the preceding session page.", "Continue reading this token in order.");
      return ok(page(found.value, cursor));
    },
    /** Source identity and retention are deterministic. The Skill supplies only
     * the purpose-appropriate title/preparation. Before every uncertain write its
     * intent is durable; a retry searches the marker and never blindly recreates.
     */
    async retain(token: string, title: string, content: string) {
      const found = await active(token); if (!found.ok) return found;
      const run = found.value;
      if (run.readTo < run.material.length) return fail("invalid", "Read every input page before retaining it.", "Follow the next cursor.");
      if (!title.trim() || !content.trim() || content.length > 128_000 || /^\s*GPK (session|input):/m.test(content)) return fail("invalid", "A Source preparation needs a title and 1–128000 characters without reserved GPK marker lines.", "Prepare material within the selected retention policy; quote any marker-like source text.");
      if (run.batch.prepared && fingerprint(run.batch.prepared) !== fingerprint({ title, content })) return fail("conflict", "This batch already has a different retained preparation.", "Recover that preparation and its pending effects before starting a new purpose.");
      const prevPrepared = run.batch.prepared;
      const prevBatch = run.progress.batch;
      run.batch.prepared = { title, content }; run.progress.batch = run.batch;
      const saved = await save(run);
      if (!saved.ok) {
        if (prevPrepared) run.batch.prepared = prevPrepared; else delete run.batch.prepared;
        if (prevBatch) run.progress.batch = prevBatch; else delete run.progress.batch;
        return saved;
      }
      async function sourceFailure(error: Failure): Promise<Result<never>> {
        if (["unauthorized", "invalid", "unsupported", "conflict", "not-found"].includes(error.code)) {
          delete run.batch.sourceAttempted;
          const cleared = await save(run); if (!cleared.ok) return cleared;
        }
        return { ok: false, error };
      }
      let source = run.progress.source;
      if (!source) {
        const candidates: SourceRef[] = []; let cursor: string | undefined; const cursors = new Set<string>();
        do {
          const queried = await options.sourcesQuery({ text: marker(run.input.key), ...(cursor ? { cursor } : {}) }); if (!queried.ok) return queried;
          if (queried.value.gaps?.length) return fail("unavailable", "Source identity lookup omitted unreadable records.", "Complete those reads before creating a Source.");
          for (const item of queried.value.items) {
            if (item.coverage !== "complete") return fail("unavailable", "A candidate Source was read partially.", "Complete the identity lookup before creating a Source.");
            if (hasLine(item.value.content, marker(run.input.key))) candidates.push(item.ref);
          }
          cursor = "next" in queried.value ? queried.value.next : undefined;
          if (queried.value.coverage !== "complete" && !cursor) return fail("unavailable", "Source identity lookup was incomplete.", "Complete the lookup before creating a Source.");
          if (cursor && (cursors.has(cursor) || cursors.size >= 100)) return fail("unavailable", "Source identity lookup exceeded its traversal budget.", "Narrow or repair the Source inventory before creating another record.");
          if (cursor) cursors.add(cursor);
        } while (cursor);
        if (candidates.length > 1) return fail("ambiguous", "Several Sources claim this session identity.", "Reconcile those Sources before continuing.");
        source = candidates[0];
      }
      const section = `${batchMarker(run.batch.id)}\n\n${content.trim()}`;
      if (source) {
        const existing = await options.sourcesRead(source); if (!existing.ok) return existing;
        if (existing.value.coverage !== "complete") return fail("unavailable", "The session Source was read only partially.", "Complete its read before retaining more material.");
        if (!hasLine(existing.value.value.content, marker(run.input.key))) return fail("conflict", "The mapped Source no longer carries this session identity.", "Inspect the Source and checkpoint; do not create a replacement automatically.");
        if (!hasLine(existing.value.value.content, batchMarker(run.batch.id))) {
          if (run.batch.sourceAttempted) return fail("uncertain", "A previous Source write is unresolved.", "Inspect the mapped Source before retrying; do not append this batch twice.");
          run.batch.sourceAttempted = true;
          const intent = await save(run);
          if (!intent.ok) { delete run.batch.sourceAttempted; return intent; }
          const written = await options.sourcesUpdate(source, [{ before: marker(run.input.key), after: `${marker(run.input.key)}\n\n${section}` }], existing.value.version);
          if (!written.ok) return sourceFailure(written.error);
          if (!written.value.verified) return fail("uncertain", "The Source update was not verified.", "Inspect it before retrying.");
        }
      } else {
        if (run.batch.sourceAttempted) return fail("uncertain", "A previous Source creation has an unknown effect.", "Inspect the Sources folder and recover its marker before retrying; no second Source was created.");
        run.batch.sourceAttempted = true;
        const intent = await save(run);
        if (!intent.ok) { delete run.batch.sourceAttempted; return intent; }
        const created = await options.sourcesCreate({ title, content: `${marker(run.input.key)}\nOrigin: ${run.input.reader} / ${run.input.session}\nAccess: ${new Date().toISOString()}; selected user/assistant text; tools, thinking and generated GPK receipts excluded.\n\n${section}` });
        if (!created.ok) return sourceFailure(created.error);
        source = created.value.created;
        if (!created.value.verified) return fail("uncertain", "The Source creation was not verified.", "Inspect its identity marker before retrying.");
      }
      const verified = await options.sourcesRead(source); if (!verified.ok) return verified;
      if (verified.value.coverage !== "complete" || !containsPreparation(verified.value.value.content, run.batch)) return fail("uncertain", "The retained preparation could not be verified beside its input marker.", "Inspect the Source before advancing progress; a marker alone is insufficient.");
      const prevSource = run.progress.source;
      const prevRetained = run.batch.retained;
      run.progress.source = source; run.batch.retained = true;
      const recorded = await save(run);
      if (!recorded.ok) {
        if (prevSource) run.progress.source = prevSource; else delete run.progress.source;
        if (prevRetained) run.batch.retained = prevRetained; else delete run.batch.retained;
        return recorded;
      }
      return ok({ source, version: verified.value.version, verified: true, batch: run.batch.id });
    },
    /** Intent precedes a downstream write. Existing pending effects are returned
     * as conflicts so recovery must inspect them; verified effects are skipped.
     * ref/expected confirm the actual current destination, not semantic success.
     */
    async step(token: string, name: string, state: "pending" | "verified", ref?: SessionEntityRef, expected?: string) {
      const found = await active(token); if (!found.ok) return found;
      const run = found.value;
      if (!run.batch.retained || run.readTo < run.material.length) return fail("invalid", "Read the input and verify this batch's Source before downstream effects.", "Finish reading and retain the session Source so interrupted work can recover its prepared evidence.");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_/. -]{0,199}$/.test(name)) return fail("invalid", "Use a stable effect name of at most 200 characters.", "Name the destination/operation consistently within this batch.");
      const previous = Object.hasOwn(run.batch.effects, name) ? run.batch.effects[name] : undefined;
      if (previous?.state === "verified") return ok({ skipped: true, effect: previous });
      if (state === "pending" && previous) return fail("conflict", "This effect already has an unresolved write intent.", "Inspect the current destination and verify the effect; do not repeat the write blindly.");
      if (state === "verified") {
        if (!previous || !ref || !expected) return fail("invalid", "Verification needs a preceding intent, a destination and its read-back version.", "Read the destination and verify the intended effect first.");
        const inspected = await options.inspect(ref); if (!inspected.ok) return inspected;
        if (inspected.value.coverage !== "complete" || inspected.value.version !== expected) return fail("conflict", "The destination is partial or changed after verification.", "Read it again and reconcile the effect.");
      }
      const prevBatch = run.progress.batch;
      run.batch.effects[name] = { state, ...(ref ? { ref } : {}) }; run.progress.batch = run.batch;
      const saved = await save(run);
      if (!saved.ok) {
        if (previous) run.batch.effects[name] = previous; else delete run.batch.effects[name];
        if (prevBatch) run.progress.batch = prevBatch; else delete run.progress.batch;
        return saved;
      }
      return ok({ skipped: false, effect: run.batch.effects[name] });
    },
    /** complete advances only this fixed input boundary. New turns remain pending.
     * release abandons ownership without erasing any backend progress.
     */
    async finish(token: string, outcome: "complete" | "release", reason: string) {
      const held = runs.get(token); if (!held) return fail("not-found", "No active session token exists.", "Call gpk_sessions_next again to recover progress.");
      if (outcome === "release") { await release(held); return ok({ released: true as const }); }
      const found = await active(token); if (!found.ok) return found;
      const run = found.value;
      if (!reason.trim() || run.readTo < run.material.length || Object.values(run.batch.effects).some(effect => effect.state !== "verified") || (run.batch.prepared && !run.batch.retained)) return fail("conflict", "Input reading, retention or a pending downstream effect is unresolved.", "Verify the remaining effects, or release the token and report what remains.");
      if (run.batch.retained && run.progress.source) {
        if (!run.batch.dailyDate) {
          const day = await options.today(); if (!day.ok) return day;
          const prevBatch = run.progress.batch;
          run.batch.dailyDate = day.value;
          run.progress.batch = run.batch;
          const saved = await save(run);
          if (!saved.ok) {
            delete run.batch.dailyDate;
            if (prevBatch) run.progress.batch = prevBatch; else delete run.progress.batch;
            return saved;
          }
        }
        const logged = await options.recordSource(run.progress.source, run.batch.dailyDate);
        if (!logged.ok) return logged;
        if (!logged.value.verified) return fail("uncertain", "The session Source is saved but its Daily Note link is pending.", "Release and resume the same batch.");
      }
      const prevTurns = run.progress.turns;
      const prevBatch = run.progress.batch;
      run.progress.turns = { ...run.progress.turns, ...run.batch.turns };
      delete run.progress.batch;
      const saved = await save(run);
      if (!saved.ok) {
        run.progress.turns = prevTurns;
        if (prevBatch) run.progress.batch = prevBatch;
        return saved;
      }
      await release(run);
      return ok({ completed: true as const, source: run.progress.source ?? null, reason });
    },
    /**
     * Coarse-grained session queue advance and paging for MCP (`gpk_sessions_next`).
     * - With `token` + `cursor`: reads the next 24k-char page of an active claimed session.
     * - Without `token`: discovers the next pending/changed session (or claims `key`),
     *   returning its first page and metadata, or `{ done: true }` when none remain.
     */
    async next(input: SessionNextInput) {
      if (input.token !== undefined) {
        if (input.cursor === undefined) return fail("invalid", "Supply cursor when reading the next page of an active session token.", "Pass the next cursor returned by the previous gpk_sessions_next call.");
        const paged = await coordinator.read(input.token, input.cursor);
        return paged.ok ? ok({ done: false as const, ...paged.value }) : paged;
      }
      const selection: SessionSelection = {
        mode: input.mode,
        ...(input.days !== undefined ? { days: input.days } : {}),
        ...(input.until !== undefined ? { until: input.until } : {}),
        ...(input.origin !== undefined ? { origin: input.origin } : {}),
      };
      if (input.key !== undefined) {
        const begun = await coordinator.begin(selection, input.key);
        if (!begun.ok) return begun;
        if (begun.value.skipped) return ok({ done: true as const, skipped: 1, coverage: "complete" as const, key: input.key }, begun.limits);
        return ok({ done: false as const, ...begun.value }, begun.limits);
      }
      const current = await policy(selection); if (!current.ok) return current;
      const scan = await readSessions(current.value.origins); if (!scan.ok) return scan;
      const bounded: SessionSelection = { ...selection, until: selection.until ?? new Date().toISOString() };
      let skipped = 0;
      const conflicts: Failure[] = [];
      for (const candidate of scan.value) {
        const turns = selected(candidate, bounded);
        if (!turns.length) continue;
        const checkpoint = await load(candidate.key); if (!checkpoint.ok) return checkpoint;
        const changed = turns.filter(turn => checkpoint.value.progress.turns[fingerprint(turn.id)] !== turn.digest);
        if (!changed.length && !checkpoint.value.progress.batch) { skipped++; continue; }
        const begun = await coordinator.begin(bounded, candidate.key);
        if (begun.ok) {
          if (begun.value.skipped) { skipped++; continue; }
          return ok({ done: false as const, ...begun.value, skippedBefore: skipped }, [...new Set([...scan.limits, ...begun.limits])]);
        }
        if (begun.error.code === "conflict") { conflicts.push(begun.error); continue; }
        return begun;
      }
      if (conflicts.length) {
        const first = conflicts[0]!;
        return { ok: false as const, error: { ...first, message: conflicts.length > 1 ? `${conflicts.length} pending sessions could not be claimed (${first.message})` : first.message } };
      }
      return ok({ done: true as const, skipped, coverage: (scan.limits.length ? "partial" : "complete") as "partial" | "complete" }, scan.limits);
    },
    /**
     * Coarse-grained session completion for MCP (`gpk_sessions_apply`).
     * Encapsulates deterministic Source retention, durable `step` tracking around
     * optional Wiki/Task/Link side effects, Daily Note recording, and `finish`.
     */
    async apply(input: SessionApplyInput) {
      if (input.outcome === "release") {
        const released = await coordinator.finish(input.token, "release", input.reason || "Released");
        return released.ok ? ok({ outcome: "release" as const, completed: false, released: true, reason: input.reason }) : released;
      }
      if (input.outcome === "skip") {
        if (input.source || input.wikis?.length || input.tasks?.length || input.links?.length) {
          return fail("invalid", "outcome: skip cannot include source, wikis, tasks or links.", "Use outcome: retain when saving knowledge, or omit outputs when skipping.");
        }
        const completed = await coordinator.finish(input.token, "complete", input.reason);
        return completed.ok ? ok({ outcome: "skip" as const, completed: true, source: "source" in completed.value ? completed.value.source : null, appliedSteps: [] as string[], reason: input.reason }) : completed;
      }
      const found = await active(input.token); if (!found.ok) return found;
      const run = found.value;
      const completedSteps: string[] = [];
      const affected: Ref[] = [];
      const failPartial = (failedStep: string, error: Failure): Result<never> => ({
        ok: false,
        error: {
          ...error,
          code: completedSteps.length ? "partial" : error.code,
          affected: dedupeRefs([...affected, ...error.affected]),
          ...(completedSteps.length ? { completedSteps, failedStep } : {}),
          next: completedSteps.length
            ? `Completed [${completedSteps.join(", ")}] before ${failedStep} failed (${error.message}). Inspect affected records or reconcile pending effects before retrying; pass outcome: release to unlock if stopping. ${error.next}`
            : error.next,
        },
      });

      const prep = input.source ?? run.batch.prepared;
      if (!prep) return fail("invalid", "Supply source { title, content } when outcome is retain.", "Provide the prepared Source title and content.");
      if (!run.batch.retained || !run.progress.source) {
        const retained = await coordinator.retain(input.token, prep.title, prep.content);
        if (!retained.ok) return retained;
        completedSteps.push("source.retain");
        affected.push(retained.value.source);
      } else {
        if (input.source && fingerprint(run.batch.prepared) !== fingerprint(input.source)) {
          return fail("conflict", "This batch already retained a different Source preparation.", "Omit source or supply the existing preparation to complete remaining effects.");
        }
        affected.push(run.progress.source);
      }
      const sourceRef = run.progress.source!;

      for (const item of input.reconcile ?? []) {
        const reconciled = await coordinator.step(input.token, item.name, "verified", item.ref, item.expected);
        if (!reconciled.ok) return failPartial(`reconcile:${item.name}`, reconciled.error);
        completedSteps.push(`reconcile:${item.name}`);
      }

      const verifyVersion = async (ref: SessionEntityRef, reported?: Version): Promise<Result<Version>> => {
        if (reported) return ok(reported);
        const inspected = await options.inspect(ref);
        if (!inspected.ok) return inspected;
        if (!inspected.value.version) return fail("uncertain", "Destination version could not be read back.", "Inspect the record before retrying.", [ref]);
        return ok(inspected.value.version);
      };

      for (const wiki of input.wikis ?? []) {
        if (!options.wikisCreate || !options.wikisUpdate) return failPartial(`wiki:${wiki.name}`, { code: "unsupported", message: "Wiki downstream actions are not wired in this session coordinator.", affected: [], next: "Use standalone Wiki operations." });
        const existing = Object.hasOwn(run.batch.effects, wiki.name) ? run.batch.effects[wiki.name] : undefined;
        if (existing?.state === "verified") {
          if (existing.ref) affected.push(existing.ref);
          completedSteps.push(`wiki:${wiki.name}(already-verified)`);
          continue;
        }
        const pending = await coordinator.step(input.token, wiki.name, "pending");
        if (!pending.ok) return failPartial(`wiki:${wiki.name}`, pending.error);
        if (wiki.action === "create") {
          const created = await options.wikisCreate({ title: wiki.title, content: wiki.content });
          if (!created.ok) return failPartial(`wiki:${wiki.name}`, created.error);
          if (!created.value.verified) return failPartial(`wiki:${wiki.name}`, { code: "uncertain", message: created.value.recovery ?? "Wiki creation was not verified on read-back.", affected: [created.value.created], next: "Inspect the Wiki and reconcile the pending step before retrying." });
          const ver = await verifyVersion(created.value.created, created.value.version);
          if (!ver.ok) return failPartial(`wiki:${wiki.name}`, ver.error);
          const verified = await coordinator.step(input.token, wiki.name, "verified", created.value.created, ver.value);
          if (!verified.ok) return failPartial(`wiki:${wiki.name}`, verified.error);
          affected.push(created.value.created);
        } else {
          const update: ContentUpdate = {
            ...(wiki.title !== undefined ? { title: wiki.title } : {}),
            ...(wiki.edits !== undefined ? { edits: wiki.edits } : {}),
            ...(wiki.append !== undefined ? { append: wiki.append } : {}),
          };
          const updated = await options.wikisUpdate(wiki.ref, update, wiki.expected);
          if (!updated.ok) return failPartial(`wiki:${wiki.name}`, updated.error);
          if (!updated.value.verified) return failPartial(`wiki:${wiki.name}`, { code: "uncertain", message: updated.value.recovery ?? "Wiki update was not verified on read-back.", affected: [wiki.ref], next: "Inspect the Wiki and reconcile the pending step before retrying." });
          const ver = await verifyVersion(wiki.ref, updated.value.version);
          if (!ver.ok) return failPartial(`wiki:${wiki.name}`, ver.error);
          const verified = await coordinator.step(input.token, wiki.name, "verified", wiki.ref, ver.value);
          if (!verified.ok) return failPartial(`wiki:${wiki.name}`, verified.error);
          affected.push(wiki.ref);
        }
        completedSteps.push(`wiki:${wiki.name}`);
      }

      for (const task of input.tasks ?? []) {
        if (!options.tasksCreate) return failPartial(`task:${task.name}`, { code: "unsupported", message: "Task downstream actions are not wired in this session coordinator.", affected: [], next: "Use standalone Task operations." });
        const existing = Object.hasOwn(run.batch.effects, task.name) ? run.batch.effects[task.name] : undefined;
        if (existing?.state === "verified") {
          if (existing.ref) affected.push(existing.ref);
          completedSteps.push(`task:${task.name}(already-verified)`);
          continue;
        }
        const pending = await coordinator.step(input.token, task.name, "pending");
        if (!pending.ok) return failPartial(`task:${task.name}`, pending.error);
        const created = await options.tasksCreate({
          title: task.title,
          content: task.content ?? "",
          state: task.state ?? "todo",
          ...(task.time !== undefined ? { time: task.time } : {}),
          ...(task.project !== undefined ? { project: task.project } : {}),
        });
        if (!created.ok) return failPartial(`task:${task.name}`, created.error);
        if (!created.value.verified) return failPartial(`task:${task.name}`, { code: "uncertain", message: created.value.recovery ?? "Task creation was not verified on read-back.", affected: [created.value.created], next: "Inspect the Task and reconcile the pending step before retrying." });
        const ver = await verifyVersion(created.value.created, created.value.version);
        if (!ver.ok) return failPartial(`task:${task.name}`, ver.error);
        const verified = await coordinator.step(input.token, task.name, "verified", created.value.created, ver.value);
        if (!verified.ok) return failPartial(`task:${task.name}`, verified.error);
        affected.push(created.value.created);
        completedSteps.push(`task:${task.name}`);
      }

      for (const link of input.links ?? []) {
        if (!options.linksAdd) return failPartial(`link:${link.name}`, { code: "unsupported", message: "Link downstream actions are not wired in this session coordinator.", affected: [], next: "Use standalone Link operations." });
        const existing = Object.hasOwn(run.batch.effects, link.name) ? run.batch.effects[link.name] : undefined;
        if (existing?.state === "verified") {
          if (existing.ref) affected.push(existing.ref);
          completedSteps.push(`link:${link.name}(already-verified)`);
          continue;
        }
        const from = link.from === "source" ? sourceRef : link.from;
        const to = link.to === "source" ? sourceRef : link.to;
        const pending = await coordinator.step(input.token, link.name, "pending");
        if (!pending.ok) return failPartial(`link:${link.name}`, pending.error);
        const added = await options.linksAdd({ from, to, context: link.context });
        if (!added.ok) return failPartial(`link:${link.name}`, added.error);
        if (!added.value.verified) return failPartial(`link:${link.name}`, { code: "uncertain", message: added.value.recovery ?? "Link addition was not verified on read-back.", affected: [from], next: "Inspect the linking record and reconcile the pending step before retrying." });
        const ver = await verifyVersion(from, added.value.version);
        if (!ver.ok) return failPartial(`link:${link.name}`, ver.error);
        const verified = await coordinator.step(input.token, link.name, "verified", from, ver.value);
        if (!verified.ok) return failPartial(`link:${link.name}`, verified.error);
        affected.push(from);
        completedSteps.push(`link:${link.name}`);
      }

      const done = await coordinator.finish(input.token, "complete", input.reason);
      if (!done.ok) return failPartial("finish", done.error);
      return ok({
        outcome: "retain" as const,
        completed: true,
        source: "source" in done.value ? done.value.source : null,
        appliedSteps: completedSteps,
        affected: dedupeRefs(affected),
        reason: input.reason,
      });
    },
    async close() { await Promise.all([...runs.values()].map(release)); },
  };
  return coordinator;
}
