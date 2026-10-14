import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { LockBusyError, withFileLock, writeFileAtomic } from "./file-lock.js";
import { debug, since } from "../runtime/debug-log.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Ref } from "../domain/entities.js";
import type {
  Capabilities, ControlGrant, CreateReceipt, Failure, Page, Result, Snapshot, Version, WriteGuard, WriteReceipt,
} from "../domain/operation-types.js";
import type {
  ControlLocator, SettingsChanges, SettingsInitialization, UserControlPort, UserSettings,
} from "../domain/user-control-port.js";
import { unsupported } from "./unsupported.js";

/**
 * Local `.gpk` control store.
 *
 * File envelope (decided with this first caller):
 * - `settings.json` holds the UserSettings object itself; `schemaVersion` is inside it.
 * - `grants.json` holds `{ "schemaVersion": 1, "grants": [{ "id": string, ...ControlGrant }] }`.
 * - `templates/<id>.md` holds personal templates (reads are not implemented yet).
 * Versions are `sha256:<hex>` digests of the file bytes; reads never repair files.
 * The instance identity is the absolute root path; refs use it as their scope.
 */
export type LocalControlOptions = {
  /** Absolute path of the selected `.gpk` root. */
  root: string;
  /** Port operation IDs grants may name; resolved lazily by the runtime. */
  knownOperations?: () => Promise<readonly string[]>;
};

export const LOCAL_CONTROL_PROVIDER = "local-files";
const SETTINGS_FILE = "settings.json";
const GRANTS_FILE = "grants.json";
const SETTINGS_SCHEMA_VERSION = 1;
const GRANTS_SCHEMA_VERSION = 1;

/** Resolve the control root from the environment: explicit path or the home default. */
export function resolveControlRoot(env: NodeJS.ProcessEnv = process.env, home = env.HOME ?? ""): string {
  const explicit = env.GPK_CONTROL_ROOT;
  if (explicit && explicit.trim()) return path.resolve(explicit.trim());
  return path.join(home, ".gpk");
}

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

function digest(content: Buffer | string): Version {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

type FileRead = { kind: "missing" } | { kind: "unreadable"; message: string } | { kind: "present"; bytes: Buffer };

async function readControlFile(file: string): Promise<FileRead> {
  try {
    return { kind: "present", bytes: await readFile(file) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
    return { kind: "unreadable", message: code ?? "read error" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): value is Ref {
  return isRecord(value) && typeof value.scope === "string" && typeof value.id === "string";
}

/**
 * The connection union of KnowledgeConnection, field by field: hand edits to the
 * control files are expected, and a missing endpoint must surface as invalid
 * Settings here rather than as an exception wherever the field is first used.
 */
function validateConnection(value: unknown): string | null {
  if (!isRecord(value)) return "connection must be an object";
  const endpoint = (candidate: unknown): string | null => {
    if (!isRecord(candidate)) return "connection.endpoint is required";
    if (candidate.kind === "public-url") return typeof candidate.url === "string" && /^https?:\/\//.test(candidate.url) ? null : "connection.endpoint.url must be an http(s) URL";
    if (candidate.kind === "secret-reference") return typeof candidate.ref === "string" && candidate.ref ? null : "connection.endpoint.ref must be a nonempty string";
    return "connection.endpoint.kind must be public-url or secret-reference";
  };
  if (value.credentialsRef !== undefined && (typeof value.credentialsRef !== "string" || !value.credentialsRef)) return "connection.credentialsRef must be a nonempty string when present";
  if (value.kind === "mcp" && value.transport === "http") return endpoint(value.endpoint);
  if (value.kind === "mcp" && value.transport === "stdio") return typeof value.profileRef === "string" && value.profileRef ? null : "connection.profileRef is required for stdio";
  if (value.kind === "api") return endpoint(value.endpoint);
  return "connection.kind/transport must be mcp+http, mcp+stdio or api";
}

/** Structural validation of the named Settings fields the runtime depends on. */
function validateSettings(value: unknown): string | null {
  if (!isRecord(value)) return "settings.json must hold an object";
  if (value.schemaVersion !== SETTINGS_SCHEMA_VERSION) return `settings.json schemaVersion must be ${SETTINGS_SCHEMA_VERSION}`;
  const kb = value.knowledgeBackend;
  if (!isRecord(kb) || typeof kb.activeId !== "string" || !Array.isArray(kb.configurations)) {
    return "settings.json knowledgeBackend needs activeId and configurations";
  }
  const ids = new Set<string>();
  for (const configuration of kb.configurations) {
    if (!isRecord(configuration) || typeof configuration.id !== "string" || typeof configuration.adapter !== "string" ||
        typeof configuration.instance !== "string" || !isRecord(configuration.connection) || !isRecord(configuration.layout)) {
      return "settings.json knowledgeBackend.configurations entries need id, adapter, instance, connection and layout";
    }
    const where = `settings.json knowledgeBackend configuration ${configuration.id}`;
    const connectionProblem = validateConnection(configuration.connection);
    if (connectionProblem) return `${where}: ${connectionProblem}`;
    const locations = (configuration.layout as Record<string, unknown>).locations;
    if (!isRecord(locations)) return `${where}: layout.locations must hold the five locations`;
    for (const role of ["area", "project", "source", "wiki", "output"]) {
      if (!isRef(locations[role])) return `${where}: layout.locations.${role} must be a reference with scope and id`;
    }
    if (ids.has(configuration.id)) return `settings.json duplicate backend configuration id ${configuration.id}`;
    ids.add(configuration.id);
  }
  if (!ids.has(kb.activeId)) return `settings.json activeId ${kb.activeId} is not a configured backend`;
  const preferences = value.preferences;
  if (!isRecord(preferences) || typeof preferences.workingLanguage !== "string" || !preferences.workingLanguage ||
      typeof preferences.metadataLanguage !== "string" || !preferences.metadataLanguage ||
      !(preferences.timezone === null || typeof preferences.timezone === "string") ||
      !(preferences.profileWiki === null || isRef(preferences.profileWiki)) || typeof preferences.instructions !== "string") {
    return "settings.json preferences need workingLanguage, metadataLanguage, timezone, profileWiki and instructions";
  }
  const templates = value.templates;
  if (!isRecord(templates)) return "settings.json templates must hold the six role bindings";
  for (const role of ["area", "project", "task", "source", "wiki", "output"]) {
    const binding = templates[role];
    if (!(binding === null || isRef(binding))) return `settings.json templates.${role} must be a reference or null`;
  }
  const ingestion = value.ingestion;
  if (!isRecord(ingestion) || !isRecord(ingestion.automatic) || typeof ingestion.automatic.enabled !== "boolean" ||
      !Array.isArray(ingestion.automatic.origins) || typeof ingestion.automatic.dailyNotes !== "boolean") {
    return "settings.json ingestion.automatic needs enabled, origins and dailyNotes";
  }
  return null;
}

function validateGrant(value: unknown): value is ControlGrant & { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.backendId === "string" && isRef(value.root) &&
    Array.isArray(value.operations) && value.operations.every(op => typeof op === "string" && /^[a-z]+(\.[a-zA-Z]+)+$/.test(op)) &&
    typeof value.unattended === "boolean";
}

async function writeJsonAtomic(file: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  await writeFileAtomic(file, bytes);
  debug("control", "write", { file: path.basename(file), bytes: bytes.length });
  return bytes;
}

const LOCK_FILE = ".control.lock";

/** Run one read/modify/write of the control files under the root's lock (see withFileLock). */
async function withControlLock<T>(root: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
  let ran = false;
  const start = Date.now();
  try { return await withFileLock(path.join(root, LOCK_FILE), () => { ran = true; debug("control", "lock", { waited: since(start) }); return run(); }); }
  catch (error) {
    if (ran) throw error;
    debug("control", "lock-failed", { waited: since(start), busy: error instanceof LockBusyError });
    if (error instanceof LockBusyError) return failure("unavailable", "Another GPK client is changing the control files.", "Retry in a moment; if it persists, remove .control.lock from the control root.");
    return failure("unavailable", `Cannot lock ${root}.`, "Check filesystem permissions for the control root.");
  }
}

/** Materialize declared defaults around the caller's actual backend selection. */
function materializeSettings(input: SettingsInitialization): UserSettings {
  const preferences = input.preferences ?? {};
  const templates = input.templates ?? {};
  const automatic = input.ingestion?.automatic ?? {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preferences: {
      workingLanguage: preferences.workingLanguage ?? "en",
      metadataLanguage: preferences.metadataLanguage ?? "en",
      timezone: preferences.timezone ?? null,
      profileWiki: preferences.profileWiki ?? null,
      instructions: preferences.instructions ?? "",
    },
    knowledgeBackend: input.knowledgeBackend,
    templates: {
      area: templates.area ?? null, project: templates.project ?? null, task: templates.task ?? null,
      source: templates.source ?? null, wiki: templates.wiki ?? null, output: templates.output ?? null,
    },
    ingestion: { automatic: {
      enabled: automatic.enabled ?? false,
      origins: automatic.origins ?? [],
      dailyNotes: automatic.dailyNotes ?? false,
    } },
  };
}

/** Apply named changes; returns null when nothing actually changes. */
function applySettingsChanges(current: UserSettings, changes: SettingsChanges): UserSettings | null {
  const next: UserSettings = JSON.parse(JSON.stringify(current)) as UserSettings;
  let changed = false;
  const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined) => {
    if (value === undefined) return;
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) { target[key] = value; changed = true; }
  };
  if (changes.preferences) {
    set(next.preferences, "workingLanguage", changes.preferences.workingLanguage);
    set(next.preferences, "metadataLanguage", changes.preferences.metadataLanguage);
    set(next.preferences, "timezone", changes.preferences.timezone);
    set(next.preferences, "profileWiki", changes.preferences.profileWiki);
    set(next.preferences, "instructions", changes.preferences.instructions);
  }
  if (changes.knowledgeBackend) set(next, "knowledgeBackend", changes.knowledgeBackend);
  if (changes.templates) {
    for (const role of ["area", "project", "task", "source", "wiki", "output"] as const) set(next.templates, role, changes.templates[role]);
  }
  if (changes.ingestion?.automatic) {
    set(next.ingestion.automatic, "enabled", changes.ingestion.automatic.enabled);
    set(next.ingestion.automatic, "origins", changes.ingestion.automatic.origins);
    set(next.ingestion.automatic, "dailyNotes", changes.ingestion.automatic.dailyNotes);
  }
  return changed ? next : null;
}

export function createLocalControlAdapter(options: LocalControlOptions): UserControlPort {
  const root = path.resolve(options.root);
  const scope = `${LOCAL_CONTROL_PROVIDER}:${root}`;
  const settingsFile = path.join(root, SETTINGS_FILE);
  const grantsFile = path.join(root, GRANTS_FILE);
  const limits = [`Control root ${root}; files are read fresh on every call and never repaired.`];

  const adapter: UserControlPort = {
    capabilities: async () => ({
      ok: true,
      limits: [],
      value: {
        "control.discover": { mode: "native", limits: ["Lists the selected root only; no parent or machine search."], evidence: ["Local filesystem read, 2026-10-10."] },
        "control.settings.read": { mode: "native", limits: ["Whole-file read; cursor and limit are accepted but the record is returned in one page."], evidence: ["Local filesystem read, 2026-10-10."] },
        "control.grants.list": { mode: "native", limits: ["Whole-file read; the list is returned in one page."], evidence: ["Local filesystem read, 2026-10-10."] },
        "control.settings.initialize": { mode: "native", limits: ["Atomic file replace; refuses an existing or unrecognized record."], evidence: ["Local filesystem write, 2026-10-11."] },
        "control.settings.update": { mode: "native", limits: ["Named changes only; expected is the file digest, detected on re-read, not locked."], evidence: ["Local filesystem write, 2026-10-11."] },
        "control.templates.resolve": { mode: "unsupported", limits: ["Personal templates are not implemented yet."], evidence: [] },
        "control.templates.read": { mode: "unsupported", limits: ["Personal templates are not implemented yet."], evidence: [] },
        "control.templates.create": { mode: "unsupported", limits: ["Personal templates are not implemented yet."], evidence: [] },
        "control.templates.update": { mode: "unsupported", limits: ["Personal templates are not implemented yet."], evidence: [] },
        "control.grants.grant": { mode: "native", limits: ["Appends to grants.json; operation IDs must be implemented operations."], evidence: ["Local filesystem write, 2026-10-11."] },
        "control.grants.revoke": { mode: "native", limits: ["Removes one grant; expected is the file digest."], evidence: ["Local filesystem write, 2026-10-11."] },
      } satisfies Capabilities,
    }),
    discover: async (locator: ControlLocator): Promise<Result<Page<Ref>>> => {
      if (locator.provider !== LOCAL_CONTROL_PROVIDER) {
        return failure("unsupported", `Control provider ${locator.provider} is not implemented.`, "Use the local-files provider.");
      }
      if (path.resolve(locator.location) !== root) {
        return failure("unauthorized", "The locator names a root outside the bound control scope.", "Launch GPK with that root selected instead.");
      }
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: { items: [], coverage: "complete" }, limits: [`${root} does not exist; nothing is initialized.`] };
        return failure("unavailable", `Cannot list ${root}.`, "Check filesystem permissions for the selected root.");
      }
      const items: Ref[] = [];
      for (const name of [SETTINGS_FILE, GRANTS_FILE]) if (entries.includes(name)) items.push({ scope, id: name });
      if (entries.includes("templates")) {
        try {
          for (const file of await readdir(path.join(root, "templates"))) if (file.endsWith(".md")) items.push({ scope, id: `templates/${file}` });
        } catch { return failure("unavailable", "Cannot list the templates directory.", "Check filesystem permissions for the selected root."); }
      }
      return { ok: true, value: { items, coverage: "complete" }, limits };
    },
    settings: {
      read: async (): Promise<Result<Snapshot<UserSettings> | null>> => {
        const read = await readControlFile(settingsFile);
        if (read.kind === "missing") return { ok: true, value: null, limits: [`${SETTINGS_FILE} is absent in ${root}: never initialized.`] };
        if (read.kind === "unreadable") return failure("unavailable", `Cannot read ${SETTINGS_FILE} (${read.message}).`, "Restore access to the control root; do not reinitialize.");
        let parsed: unknown;
        try { parsed = JSON.parse(read.bytes.toString("utf8")); }
        catch { return failure("invalid", `${SETTINGS_FILE} is not valid JSON.`, "Repair the file by hand or restore it from backup; GPK does not rewrite it.", [{ scope, id: SETTINGS_FILE }]); }
        const problem = validateSettings(parsed);
        if (problem) return failure("invalid", problem, "Repair the file by hand or rerun Setup once it is available.", [{ scope, id: SETTINGS_FILE }]);
        return { ok: true, value: { ref: { scope, id: SETTINGS_FILE }, value: parsed as UserSettings, version: digest(read.bytes), coverage: "complete" }, limits };
      },
      initialize: async (input: SettingsInitialization, guard: WriteGuard): Promise<Result<WriteReceipt>> => {
        return withControlLock(root, async () => {
          if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when initializing.", "Remove expected; resuming an interrupted initialization is not implemented.");
          const existing = await readControlFile(settingsFile);
          if (existing.kind === "present") return failure("conflict", `${SETTINGS_FILE} already exists in ${root}.`, "Use settings.update to change it; initialization never resets an existing record.", [{ scope, id: SETTINGS_FILE }]);
          if (existing.kind === "unreadable") return failure("unavailable", `Cannot inspect ${SETTINGS_FILE} (${existing.message}).`, "Restore access to the control root.");
          const settings = materializeSettings(input);
          const problem = validateSettings(settings);
          if (problem) return failure("invalid", problem, "Supply a complete backend selection with unique configuration IDs.");
          try { await writeJsonAtomic(settingsFile, settings); }
          catch { return failure("unavailable", `Cannot write ${SETTINGS_FILE}.`, "Check filesystem permissions for the control root."); }
          const back = await adapter.settings.read();
          const verified = back.ok && back.value !== null && JSON.stringify(back.value.value) === JSON.stringify(settings);
          return { ok: true, value: { affected: [{ scope, id: SETTINGS_FILE }], verified, ...(back.ok && back.value ? { version: back.value.version } : {}), ...(verified ? {} : { recovery: "Read settings back and compare." }) }, limits };
        });
      },
      update: async (changes: SettingsChanges, guard: WriteGuard): Promise<Result<WriteReceipt>> => {
        return withControlLock(root, async () => {
          const current = await adapter.settings.read();
          if (!current.ok) return current;
          if (current.value === null) return failure("not-found", `${SETTINGS_FILE} is not initialized.`, "Initialize Settings first.");
          if (guard.expected !== undefined && guard.expected !== current.value.version) return failure("conflict", "Settings changed since they were read.", "Read Settings again and reapply the change.", [{ scope, id: SETTINGS_FILE }]);
          const next = applySettingsChanges(current.value.value, changes);
          if (!next) return failure("invalid", "No field actually changes.", "Supply at least one differing named field.");
          const problem = validateSettings(next);
          if (problem) return failure("invalid", problem, "Correct the change.");
          try { await writeJsonAtomic(settingsFile, next); }
          catch { return failure("unavailable", `Cannot write ${SETTINGS_FILE}.`, "Check filesystem permissions for the control root."); }
          const back = await adapter.settings.read();
          const verified = back.ok && back.value !== null && JSON.stringify(back.value.value) === JSON.stringify(next);
          return { ok: true, value: { affected: [{ scope, id: SETTINGS_FILE }], verified, ...(back.ok && back.value ? { version: back.value.version } : {}), ...(verified ? {} : { recovery: "Read settings back and compare." }) }, limits };
        });
      },
    },
    templates: {
      resolve: async () => unsupported("local-control.templates.resolve"),
      read: async () => unsupported("local-control.templates.read"),
      create: async () => unsupported("local-control.templates.create"),
      update: async () => unsupported("local-control.templates.update"),
    },
    grants: {
      list: async (): Promise<Result<Page<Snapshot<ControlGrant>>>> => {
        const read = await readControlFile(grantsFile);
        if (read.kind === "missing") return { ok: true, value: { items: [], coverage: "complete" }, limits: [`${GRANTS_FILE} is absent in ${root}: no grants exist.`] };
        if (read.kind === "unreadable") return failure("unavailable", `Cannot read ${GRANTS_FILE} (${read.message}).`, "Restore access to the control root.");
        let parsed: unknown;
        try { parsed = JSON.parse(read.bytes.toString("utf8")); }
        catch { return failure("invalid", `${GRANTS_FILE} is not valid JSON.`, "Repair the file by hand; GPK does not rewrite it.", [{ scope, id: GRANTS_FILE }]); }
        if (!isRecord(parsed) || parsed.schemaVersion !== GRANTS_SCHEMA_VERSION || !Array.isArray(parsed.grants)) {
          return failure("invalid", `${GRANTS_FILE} needs schemaVersion ${GRANTS_SCHEMA_VERSION} and a grants array.`, "Repair the file by hand.", [{ scope, id: GRANTS_FILE }]);
        }
        const version = digest(read.bytes);
        const items: Snapshot<ControlGrant>[] = [];
        const seen = new Set<string>();
        for (const entry of parsed.grants) {
          if (!validateGrant(entry) || seen.has(entry.id)) {
            return failure("invalid", `${GRANTS_FILE} contains a malformed or duplicate grant.`, "Repair the file by hand; no grant is applied while the file is invalid.", [{ scope, id: GRANTS_FILE }]);
          }
          seen.add(entry.id);
          const { id, ...grant } = entry;
          items.push({ ref: { scope, id: `grant:${id}` }, value: grant, version, coverage: "complete" });
        }
        return { ok: true, value: { items, coverage: "complete" }, limits };
      },
      grant: async (input: ControlGrant, guard: WriteGuard): Promise<Result<CreateReceipt<Ref>>> => {
        return withControlLock(root, async () => {
          if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when granting.", "Remove expected.");
          if (!input.backendId || !isRef(input.root) || !input.operations.length) return failure("invalid", "A grant needs a backendId, a root reference and at least one operation.", "Correct the grant.");
          const known = options.knownOperations ? await options.knownOperations() : null;
          const unknown = input.operations.filter(op => !/^[a-z]+(\.[a-zA-Z]+)+$/.test(op) || (known && !known.includes(op)));
          if (unknown.length) return failure("invalid", `Unknown or malformed operation IDs: ${unknown.join(", ")}.`, "Grant only implemented port operations; wildcards are rejected.");
          const current = await adapter.grants.list();
          if (!current.ok) return current;
          const entries = current.value.items.map(item => ({ id: item.ref.id.replace(/^grant:/, ""), ...item.value }));
          const id = `g-${randomUUID().slice(0, 8)}`;
          entries.push({ id, backendId: input.backendId, root: input.root, operations: [...input.operations], unattended: input.unattended });
          try { await writeJsonAtomic(grantsFile, { schemaVersion: GRANTS_SCHEMA_VERSION, grants: entries }); }
          catch { return failure("unavailable", `Cannot write ${GRANTS_FILE}.`, "Check filesystem permissions for the control root."); }
          const back = await adapter.grants.list();
          const created: Ref = { scope, id: `grant:${id}` };
          const verified = back.ok && back.value.items.some(item => item.ref.id === created.id);
          return { ok: true, value: { created, affected: [created, { scope, id: GRANTS_FILE }], verified, ...(back.ok && back.value.items[0] ? { version: back.value.items[0].version } : {}) }, limits };
        });
      },
      revoke: async (ref: Ref, guard: WriteGuard): Promise<Result<WriteReceipt>> => {
        return withControlLock(root, async () => {
          const current = await adapter.grants.list();
          if (!current.ok) return current;
          const target = current.value.items.find(item => item.ref.scope === ref.scope && item.ref.id === ref.id);
          if (!target) return failure("not-found", "No grant with this reference exists.", "List grants to find the current references.", [ref]);
          if (guard.expected !== undefined && guard.expected !== target.version) return failure("conflict", "The grant store changed since it was read.", "List grants again and retry.", [ref]);
          const entries = current.value.items.filter(item => item.ref.id !== ref.id).map(item => ({ id: item.ref.id.replace(/^grant:/, ""), ...item.value }));
          try { await writeJsonAtomic(grantsFile, { schemaVersion: GRANTS_SCHEMA_VERSION, grants: entries }); }
          catch { return failure("unavailable", `Cannot write ${GRANTS_FILE}.`, "Check filesystem permissions for the control root."); }
          const back = await adapter.grants.list();
          const verified = back.ok && !back.value.items.some(item => item.ref.id === ref.id);
          return { ok: true, value: { affected: [ref, { scope, id: GRANTS_FILE }], verified }, limits };
        });
      },
    },
  };
  return adapter;
}
