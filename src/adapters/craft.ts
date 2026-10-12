import { createHash } from "node:crypto";
import type { Ref, Task, TaskRef, TaskState } from "../domain/entities.js";
import type {
  AreaOperations, CaptureOperations, CaptureRef, CaptureSurface, CaptureSurfaceRef,
  KnowledgeBackendPort, TaskInput, TaskOperations, TaskQuery, TextEdit,
} from "../domain/knowledge-backend-port.js";
import type {
  Capabilities, Capability, ControlGrant, CreateReceipt, Failure, GrantedWriteGuard, Page,
  ReadOptions, Result, Snapshot, Version, WriteReceipt,
} from "../domain/operation-types.js";
import type { KnowledgeLayout } from "../domain/user-control-port.js";
import { createCollectionOperations, jsonArgument, type CraftBlock, type CraftContext } from "./craft-collections.js";
import { createDocumentOperations } from "./craft-documents.js";
import type { CraftConnection, CraftSpace } from "./craft-connection.js";
import { CRAFT_TEMPLATE_ROLES, craftTemplateBody, craftTemplateTitle, type TemplateLanguage } from "./craft-templates.js";
import { unsupported } from "./unsupported.js";

/**
 * Craft knowledge adapter over GPK's own MCP client. This slice implements the
 * Task and capture-surface operations needed by the first acceptance scenario;
 * every other operation returns unsupported without I/O.
 *
 * Representation (see docs/adapters/craft.md):
 * - A Task is a native task block; its action line is the title, its children are
 *   the body. `doing`/`waiting` are a line-end `#gpk/task/<state>` tag.
 * - A standalone Task lives in the Daily Note of the day it was accepted; the
 *   Inbox is a capture surface. A Project-owned Task is a task block inside the
 *   Project's Collection row (see craft-collections.ts); Tasks in other documents
 *   are outside GPK's locations and are not managed.
 * - Versions digest `lastModifiedAt` plus the action line and body; no stamps are
 *   visible to a plain client, so `expected` is detection by re-read, not CAS.
 */
export type CraftAdapterOptions = {
  connection: CraftConnection;
  backendId: string;
  /** Current layout locations from Settings, read on demand; null before Setup. */
  layout?: () => Promise<Result<KnowledgeLayout["locations"] | null>>;
};

/**
 * The grant root a Task falls under. `project` means a task block inside a row of the
 * Projects Collection: its key is that Collection's ID and `projectId` the row.
 */
export type CraftTaskContainer = { key: string; kind: "inbox" | "daily-note" | "document" | "project"; date?: string; rootId?: string; projectId?: string };

export type LayoutRole = keyof KnowledgeLayout["locations"];
export type LayoutLocationCheck = {
  role: LayoutRole; ref: Ref;
  status: "ok" | "unset" | "missing" | "wrong-kind";
  detail: string;
};
export type LayoutInspection = {
  locations: LayoutLocationCheck[];
  candidates: {
    collections: { id: string; name: string; items: number; documentId: string }[];
    folders: { id: string; name: string; documents: number; parentId: string | null }[];
  };
};
/**
 * Each role is either adopted by ID or created by name. In a workspace dedicated to
 * GPK (the default) the structures sit at the top level: the host document in
 * Unsorted and the three folders at the root. In a workspace that also holds other
 * material, a namespace folder keeps everything GPK creates together so the user's
 * own tree is untouched. Adoption of existing folders or Collections happens only
 * when the user names them.
 */
export type LayoutPlan = {
  /** Where created structures go: `root` (default, a dedicated workspace), or a namespace folder by name (reused if it exists at the root) or by ID. */
  namespace?: { folder: string } | { folderId: string } | "root";
  hostDocument: { title: string } | { rootId: string };
  areas: { name: string } | { id: string };
  projects: { name: string } | { id: string };
  sources: { name: string } | { id: string };
  wikis: { name: string } | { id: string };
  outputs: { name: string } | { id: string };
  /** Language of view names and template headings (default en). Collection and folder
   * names come from the plan; column names, state values and template titles stay English.
   */
  metadataLanguage?: TemplateLanguage;
  /** Create the Board / By Area / Active views on the Collections (default true). */
  views?: boolean;
  /** Install the bundled entity templates into Craft's Templates area (default true). */
  templates?: boolean;
};

/** View names per metadata language; they are labels for people, matched by name on reruns. */
const VIEW_NAMES: Record<TemplateLanguage, { board: string; byArea: string; active: string }> = {
  en: { board: "Board", byArea: "By Area", active: "Active" },
  "zh-CN": { board: "看板", byArea: "按领域", active: "进行中" },
};
export type LayoutEstablishment = {
  locations: KnowledgeLayout["locations"];
  created: Ref[]; adopted: Ref[];
  namespace: Ref | null;
  views: string[];
  templates: Ref[];
};

export const PROJECT_STATES = ["planned", "active", "paused", "completed", "canceled"] as const;
export const AREA_STATES = ["active", "inactive"] as const;

export type CraftKnowledgeAdapter = KnowledgeBackendPort & {
  /** Which grant root a Task falls under: `inbox`, `daily-notes/<date>` or a document root ID. */
  containerOf(ref: TaskRef): Promise<Result<CraftTaskContainer>>;
  /** Provider structures behind the Settings layout; Setup's only Craft-side responsibility. */
  layout: {
    inspect(locations?: KnowledgeLayout["locations"]): Promise<Result<LayoutInspection>>;
    establish(plan: LayoutPlan): Promise<Result<LayoutEstablishment>>;
  };
};

const TAG_STATES = ["doing", "waiting"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const LINE_PREFIX = /^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX-]\]\s*)?/;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
/** `tasks list --scope all` pages 1000 tasks; this bounds a full-space scan. */
const MAX_LISTING_PAGES = 25;
/** `blocks get` commands batched per craft_read call. */
const READ_BATCH = 20;

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  todo: ["doing", "waiting", "done", "canceled"],
  doing: ["todo", "waiting", "done", "canceled"],
  waiting: ["todo", "doing", "done", "canceled"],
  done: ["todo"],
  canceled: ["todo"],
};

type ListedTask = { id: string; line: string; state: TaskState; scheduleDate?: string; container: CraftTaskContainer };

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function todayIn(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Split an action line into the bare title and the GPK state tag, if any. */
export function parseActionLine(markdown: string): { title: string; tagState?: "doing" | "waiting" } {
  let line = markdown.replace(LINE_PREFIX, "").trim();
  const struck = line.match(/^~(.*)~$/);
  if (struck) line = struck[1]!.trim();
  const tag = line.match(/\s*#gpk\/task\/(doing|waiting)\s*$/);
  if (tag) return { title: line.slice(0, tag.index).trim(), tagState: tag[1] as "doing" | "waiting" };
  return { title: line };
}

function renderActionLine(title: string, state: TaskState): string {
  return TAG_STATES.includes(state as "doing") ? `${title} #gpk/task/${state}` : title;
}

function stateOf(native: string | undefined, tagState?: "doing" | "waiting"): TaskState {
  if (native === "done") return "done";
  if (native === "canceled" || native === "cancelled") return "canceled";
  return tagState ?? "todo";
}

/** Parse the text listing of `tasks list`; only IDs, state, schedule and container are trusted. */
export function parseTaskListing(text: string): ListedTask[] {
  const tasks: ListedTask[] = [];
  let current: ListedTask | null = null;
  for (const raw of text.split("\n")) {
    const head = raw.match(/^\[([ x-])\] <([^>]+)> (.*)$/);
    if (head) {
      const [, mark, id, line] = head as unknown as [string, string, string, string];
      const parsed = parseActionLine(line);
      current = {
        id, line,
        state: mark === "x" ? "done" : mark === "-" ? "canceled" : (parsed.tagState ?? "todo"),
        container: { key: "unknown", kind: "document" },
      };
      tasks.push(current);
      continue;
    }
    if (!current) continue;
    const schedule = raw.match(/^\s+\(schedule: (\d{4}-\d{2}-\d{2})\)/);
    if (schedule) { current.scheduleDate = schedule[1]!; continue; }
    const where = raw.match(/^\s+in: (.*)$/);
    if (where) {
      const value = where[1]!.trim();
      if (value === "inbox") current.container = { key: "inbox", kind: "inbox" };
      else {
        const daily = value.match(/^daily note (\d{4}-\d{2}-\d{2})$/);
        if (daily) current.container = { key: `daily-notes/${daily[1]}`, kind: "daily-note", date: daily[1]! };
        else {
          const root = value.match(/<([^>]+)>\s*$/);
          if (root) current.container = { key: root[1]!, kind: "document", rootId: root[1]! };
        }
      }
    }
  }
  return tasks;
}

function digestOf(block: CraftBlock): Version {
  const hash = createHash("sha256");
  hash.update(block.metadata?.lastModifiedAt ?? "");
  hash.update("|").update(block.markdown ?? "");
  for (const child of block.content ?? []) hash.update("|").update(child.id).update(":").update(child.markdown ?? "");
  return "sha256:" + hash.digest("hex");
}

function bodyOf(block: CraftBlock): string {
  return (block.content ?? []).map(child => child.markdown ?? "").join("\n\n");
}

function unsupportedCapability(reason: string): Capability {
  return { mode: "unsupported", limits: [reason], evidence: [] };
}

export function createCraftAdapter(options: CraftAdapterOptions): CraftKnowledgeAdapter {
  const { connection, backendId } = options;
  let spaceCache: CraftSpace | null = null;

  async function space(): Promise<Result<CraftSpace>> {
    if (spaceCache) return { ok: true, value: spaceCache, limits: [] };
    const result = await connection.space();
    if (result.ok) spaceCache = result.value;
    return result;
  }

  async function readJson<T>(command: string): Promise<Result<T>> {
    const result = await connection.read(command);
    if (!result.ok) return result;
    try { return { ok: true, value: JSON.parse(result.value) as T, limits: [] }; }
    catch { return failure("unavailable", "Craft returned a non-JSON payload for a JSON read.", "Retry; if it persists the connector surface changed."); }
  }

  /** Any block with metadata; `not-found` when Craft cannot read the ID. */
  async function readBlock(id: string, depth: number): Promise<Result<CraftBlock>> {
    const read = await readJson<{ data?: CraftBlock[] }>(`blocks get --id ${id} --depth ${depth} --format json --fetchMetadata`);
    if (!read.ok) {
      return read.error.code === "not-found" || read.error.code === "invalid"
        ? failure("not-found", "No block with this ID is readable in the space.", "Re-resolve the reference; it may have been deleted.")
        : read;
    }
    const block = read.value.data?.[0];
    if (!block) return failure("not-found", "No block with this ID is readable in the space.", "Re-resolve the reference; it may have been deleted.");
    return { ok: true, value: block, limits: [] };
  }

  /** One craft_read call carrying several `blocks get` commands; results are blank-line separated. Unreadable IDs are absent. */
  async function readBlocks(ids: string[], depth: number): Promise<Result<Map<string, CraftBlock>>> {
    const blocks = new Map<string, CraftBlock>();
    for (let start = 0; start < ids.length; start += READ_BATCH) {
      const batch = ids.slice(start, start + READ_BATCH);
      const result = await connection.read(batch.map(id => `blocks get --id ${id} --depth ${depth} --format json --fetchMetadata`).join("; "));
      if (!result.ok) return result;
      for (const segment of result.value.split(/\n\s*\n(?=\{)/)) {
        try {
          const block = (JSON.parse(segment.trim()) as { data?: CraftBlock[] }).data?.[0];
          if (block) blocks.set(block.id.toLowerCase(), block);
        } catch { /* a failed segment leaves its block unreadable */ }
      }
    }
    return { ok: true, value: blocks, limits: [] };
  }

  async function readTaskBlock(ref: TaskRef): Promise<Result<CraftBlock>> {
    const scoped = await space();
    if (!scoped.ok) return scoped;
    if (ref.kind !== "Task" || ref.scope !== scoped.value.id || !UUID.test(ref.id)) {
      return failure("invalid", "The reference is not a Task in the bound Craft space.", "Resolve the Task in this space first.", [ref]);
    }
    const block = await readBlock(ref.id, 1);
    if (!block.ok) return block.error.code === "not-found" ? { ...block, error: { ...block.error, affected: [ref], next: "Re-resolve the Task; it may have been deleted." } } : block;
    if (block.value.listStyle !== "task") return failure("invalid", "The block is not a task block.", "Use the operations of the entity this block belongs to.", [ref]);
    return block;
  }

  async function readTaskBlocks(refs: TaskRef[]): Promise<Result<Map<string, CraftBlock>>> {
    const blocks = await readBlocks(refs.map(ref => ref.id), 1);
    if (!blocks.ok) return blocks;
    for (const [id, block] of blocks.value) if (block.listStyle !== "task") blocks.value.delete(id);
    return blocks;
  }

  function toTask(block: CraftBlock, container?: CraftTaskContainer, scope?: string): Task {
    const parsed = parseActionLine(block.markdown ?? "");
    const task: Task = {
      title: parsed.title,
      content: bodyOf(block),
      state: stateOf(block.taskInfo?.state, parsed.tagState),
    };
    if (block.taskInfo?.scheduleDate) task.time = block.taskInfo.scheduleDate;
    if (container?.kind === "project" && container.projectId && scope) task.project = { kind: "Project", scope, id: container.projectId };
    return task;
  }

  function snapshotOf(ref: TaskRef, block: CraftBlock, container?: CraftTaskContainer): Snapshot<Task, TaskRef> {
    return { ref, value: toTask(block, container, ref.scope), version: digestOf(block), coverage: "complete" };
  }

  /** The Projects Collection and the document hosting it; null before Setup. */
  let projectsHostCache: { collectionId: string; rootId: string } | null = null;
  async function projectsHost(): Promise<Result<{ collectionId: string; rootId: string } | null>> {
    const layout = options.layout ? await options.layout() : { ok: true as const, value: null, limits: [] };
    if (!layout.ok) return layout;
    const collectionId = layout.value?.project.id;
    if (!collectionId || collectionId === "unset") return { ok: true, value: null, limits: [] };
    if (projectsHostCache?.collectionId.toLowerCase() === collectionId.toLowerCase()) return { ok: true, value: projectsHostCache, limits: [] };
    const listing = await connection.read("collections list");
    if (!listing.ok) return listing;
    const line = listing.value.split("\n").find(row => row.toLowerCase().includes(`<${collectionId.toLowerCase()}>`));
    const rootId = line?.match(/in document ([^)\s]+)/)?.[1];
    if (!rootId) return failure("unavailable", "The configured Projects Collection is not listed in the space.", "Rerun Setup inspect to repair the layout.");
    projectsHostCache = { collectionId, rootId };
    return { ok: true, value: projectsHostCache, limits: [] };
  }

  /** Map task block IDs inside Project rows to their row; two batched reads. */
  async function projectOwners(host: { collectionId: string; rootId: string }): Promise<Result<Map<string, string>>> {
    const items = await collectionOps.listItems(host.collectionId);
    if (!items.ok) return items;
    const blocks = await readBlocks(items.value.map(item => item.id), 1);
    if (!blocks.ok) return blocks;
    const owners = new Map<string, string>();
    for (const item of items.value) {
      for (const child of blocks.value.get(item.id.toLowerCase())?.content ?? []) if (child.listStyle === "task") owners.set(child.id.toLowerCase(), item.id);
    }
    return { ok: true, value: owners, limits: [] };
  }

  /** Refine a host-document container into the owning Project row, when there is one. */
  async function refineContainer(ref: TaskRef, container: CraftTaskContainer): Promise<Result<CraftTaskContainer>> {
    if (container.kind !== "document" || !container.rootId) return { ok: true, value: container, limits: [] };
    const host = await projectsHost();
    if (!host.ok) return host;
    if (!host.value || host.value.rootId.toLowerCase() !== container.rootId.toLowerCase()) return { ok: true, value: container, limits: [] };
    const owners = await projectOwners(host.value);
    if (!owners.ok) return owners;
    const projectId = owners.value.get(ref.id.toLowerCase());
    if (!projectId) return { ok: true, value: container, limits: [] };
    const refined: CraftTaskContainer = { key: host.value.collectionId, kind: "project", rootId: host.value.rootId, projectId };
    containerHints.set(ref.id.toLowerCase(), refined);
    return { ok: true, value: refined, limits: [] };
  }

  // Container hints from creations and listings; verified before use, never authoritative.
  const containerHints = new Map<string, CraftTaskContainer>();
  function remember(tasksSeen: ListedTask[]): void {
    for (const task of tasksSeen) if (task.container.key !== "unknown") containerHints.set(task.id.toLowerCase(), task.container);
  }

  /** Follow the listing's pagination; `complete` is false when the page cap was hit. */
  async function listAll(): Promise<Result<{ tasks: ListedTask[]; complete: boolean }>> {
    const tasksSeen: ListedTask[] = [];
    let command = "tasks list --scope all";
    for (let page = 0; page < MAX_LISTING_PAGES; page++) {
      const listing = await connection.read(command);
      if (!listing.ok) {
        return listing.error.code === "invalid"
          ? failure("unsupported", "The Craft connection does not expose the full-space task listing.", "Authorize GPK for the whole space or narrow the query to a surface.")
          : listing;
      }
      const parsed = parseTaskListing(listing.value);
      remember(parsed);
      tasksSeen.push(...parsed);
      const next = listing.value.match(/^Next page: (tasks list --scope all --cursor \S+)\s*$/m)?.[1];
      if (!next) return { ok: true, value: { tasks: tasksSeen, complete: true }, limits: [] };
      command = next;
    }
    return { ok: true, value: { tasks: tasksSeen, complete: false }, limits: [] };
  }

  async function dailyNoteRoot(date: string): Promise<Result<string | null>> {
    const read = await readJson<{ data?: CraftBlock[] }>(`blocks get --date ${date} --format json --depth 0`);
    if (!read.ok) return read.error.code === "invalid" || read.error.code === "not-found" ? { ok: true, value: null, limits: [] } : read;
    return { ok: true, value: read.value.data?.[0]?.id ?? null, limits: [] };
  }

  /** Confirm a hinted container by listing just that document; cheap and authoritative. */
  async function verifyHint(ref: TaskRef, hint: CraftTaskContainer): Promise<boolean> {
    if (hint.kind === "project" && hint.projectId) {
      const item = await readBlock(hint.projectId, 1);
      return item.ok && (item.value.content ?? []).some(child => child.id.toLowerCase() === ref.id.toLowerCase());
    }
    let rootId = hint.rootId ?? null;
    if (hint.kind === "daily-note" && hint.date) {
      const root = await dailyNoteRoot(hint.date);
      rootId = root.ok ? root.value : null;
    }
    if (hint.kind === "inbox") {
      const listing = await connection.read("tasks list --scope inbox");
      return listing.ok && parseTaskListing(listing.value).some(task => task.id.toLowerCase() === ref.id.toLowerCase());
    }
    if (!rootId) return false;
    const listing = await connection.read(`tasks list --scope document --document ${rootId}`);
    return listing.ok && parseTaskListing(listing.value).some(task => task.id.toLowerCase() === ref.id.toLowerCase());
  }

  async function containerOf(ref: TaskRef): Promise<Result<CraftTaskContainer>> {
    const hint = containerHints.get(ref.id.toLowerCase());
    if (hint && await verifyHint(ref, hint)) return { ok: true, value: hint, limits: [] };
    const all = await listAll();
    if (!all.ok) return all;
    const found = all.value.tasks.find(task => task.id.toLowerCase() === ref.id.toLowerCase());
    if (!found) {
      return all.value.complete
        ? failure("not-found", "The Task is not present in the space task listing.", "Re-resolve the Task; it may have been deleted or moved out of scope.", [ref])
        : failure("unavailable", `The space task listing exceeded ${MAX_LISTING_PAGES} pages before the Task was found.`, "Narrow the space or retry later; the Task's container could not be established.", [ref]);
    }
    return refineContainer(ref, found.container);
  }

  /** Enforce the runtime-resolved grant against the Task's container. */
  async function authorize(guard: GrantedWriteGuard, operation: string, container: CraftTaskContainer, target?: Ref): Promise<Result<ControlGrant>> {
    const scoped = await space();
    if (!scoped.ok) return scoped;
    const grant = guard.grant;
    const rootMatches = grant.root.scope === scoped.value.id && (
      grant.root.id === container.key ||
      (grant.root.id === "daily-notes" && container.kind === "daily-note"));
    if (grant.backendId !== backendId || !grant.operations.includes(operation) || !rootMatches) {
      return failure("unauthorized", `No grant covers ${operation} on ${container.key}.`, "Ask Setup to grant this operation for this root.", target ? [target] : []);
    }
    return { ok: true, value: grant, limits: [] };
  }

  async function checkExpected(guard: GrantedWriteGuard, block: CraftBlock, ref: TaskRef): Promise<Result<void>> {
    if (guard.expected !== undefined && guard.expected !== digestOf(block)) {
      return failure("conflict", "The Task changed since it was read.", "Read the Task again and reapply the change to the current content.", [ref]);
    }
    return { ok: true, value: undefined, limits: [] };
  }

  async function verifyTask(ref: TaskRef, predicate: (task: Task, block: CraftBlock) => boolean, recovery: string): Promise<Result<WriteReceipt>> {
    const after = await readTaskBlock(ref);
    if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: recovery } };
    const verified = predicate(toTask(after.value), after.value);
    const receipt: WriteReceipt = { affected: [ref], verified, version: digestOf(after.value) };
    if (!verified) receipt.recovery = recovery;
    return { ok: true, value: receipt, limits: verified ? [] : ["Read-back did not show the requested effect."] };
  }

  /** Enforce a grant whose root is exactly one provider structure (a Collection). */
  async function authorizeRoot(guard: GrantedWriteGuard, operation: string, rootId: string, target?: Ref): Promise<Result<ControlGrant>> {
    return authorize(guard, operation, { key: rootId, kind: "document", rootId }, target);
  }

  /**
   * Plan literal edits against a block's children before writing anything: each
   * `before` must occur exactly once within exactly one child (see TextEdit).
   */
  function planEdits(block: CraftBlock, edits: TextEdit[], target: Ref): Result<Map<string, string>> {
    const children = (block.content ?? []).map(child => ({ id: child.id, body: child.markdown ?? "" }));
    const plans = new Map<string, string>();
    for (const edit of edits) {
      if (!edit.before) return failure("invalid", "TextEdit.before must be nonempty.", "Supply the exact text to replace.");
      const hits = children.filter(child => (plans.get(child.id) ?? child.body).includes(edit.before));
      if (hits.length !== 1) return failure("conflict", hits.length ? "The text occurs in more than one block." : "The text was not found in the body.", "Read the record again and choose a unique fragment within one block.", [target]);
      const child = hits[0]!;
      const working = plans.get(child.id) ?? child.body;
      if (working.split(edit.before).length !== 2) return failure("conflict", "The text occurs more than once within the block.", "Choose a longer, unique fragment.", [target]);
      plans.set(child.id, working.replace(edit.before, edit.after));
    }
    return { ok: true, value: plans, limits: [] };
  }

  /** Write planned edits block by block; the rendered list prefix is stripped so indentation survives. */
  async function writeEdits(plans: Map<string, string>): Promise<Result<void>> {
    for (const [id, text] of plans) {
      const written = await connection.write(`blocks update --id ${id} --markdown ${JSON.stringify(text.replace(LINE_PREFIX, ""))}`);
      if (!written.ok) return written;
    }
    return { ok: true, value: undefined, limits: [] };
  }

  const ctx: CraftContext = {
    connection, backendId, space, readJson, readBlock, readBlocks, digestOf, bodyOf, authorizeRoot, planEdits, writeEdits,
    layout: async () => options.layout ? options.layout() : { ok: true, value: null, limits: [] },
    today: () => todayIn(spaceCache?.timezone ?? "UTC"),
    hostRoot: async () => { const host = await projectsHost(); return host.ok ? { ok: true, value: host.value?.rootId ?? null, limits: [] } : host; },
    taskContainer: ref => containerOf(ref),
  };
  const collectionOps = createCollectionOperations(ctx);
  const documentOps = createDocumentOperations(ctx, collectionOps);
  ctx.relatedIds = ref => documentOps.relatedIds(ref as Parameters<typeof documentOps.relatedIds>[0]);

  /** Where a new task block goes inside a Project row: after the last Task, else after the Plan heading, else at the end. */
  function insertionFor(item: CraftBlock): string {
    const children = item.content ?? [];
    const lastTask = [...children].reverse().find(child => child.listStyle === "task");
    if (lastTask) return `--siblingId ${lastTask.id} --position after`;
    const heading = children.find(child => (child.textStyle ?? "").startsWith("h") && /plan/i.test(child.markdown ?? ""));
    if (heading) return `--siblingId ${heading.id} --position after`;
    return `--id ${item.id} --position end`;
  }

  const tasks: TaskOperations = {
    async resolve(locator) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const id = locator.match(UUID)?.[0];
      if (!id) return failure("invalid", "The locator contains no Craft block ID.", "Pass a block ID or a Craft link that includes blockId.");
      const ref: TaskRef = { kind: "Task", scope: scoped.value.id, id };
      const block = await readTaskBlock(ref);
      return block.ok ? { ok: true, value: ref, limits: [] } : block;
    },
    async read(ref) {
      const block = await readTaskBlock(ref);
      if (!block.ok) return block;
      const container = await containerOf(ref);
      if (!container.ok) return container;
      return { ok: true, value: snapshotOf(ref, block.value, container.value), limits: [] };
    },
    async query(query: TaskQuery) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      if (query.time) {
        for (const bound of [query.time.from, query.time.to]) if (bound !== undefined && !isValidDate(bound)) return failure("invalid", "time bounds must be valid YYYY-MM-DD dates.", "Correct the date.");
        if (query.time.from && query.time.to && query.time.from > query.time.to) return failure("invalid", "time.from must not be after time.to.", "Correct the range.");
      }
      let offset = 0;
      if (query.cursor !== undefined) {
        const parsed = Number.parseInt(Buffer.from(query.cursor, "base64url").toString("utf8").replace(/^tasks:/, ""), 10);
        if (!query.cursor.startsWith("dGFza3M6") || !Number.isInteger(parsed) || parsed < 0) return failure("invalid", "The cursor does not belong to tasks.query.", "Start the query again without a cursor.");
        offset = parsed;
      }
      const host = await projectsHost();
      if (!host.ok) return host;
      const limits: string[] = [];
      let candidates: ListedTask[];
      const containers = new Map<string, CraftTaskContainer>();
      if (query.project) {
        // One Project's Tasks come straight from its row; no space-wide listing.
        if (!host.value) return failure("unavailable", "The Projects Collection is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
        if (query.project.scope !== scoped.value.id) return failure("invalid", "The Project belongs to another space.", "Resolve the Project in this space.");
        const item = await collectionOps.readItem(query.project, host.value.collectionId, "Project");
        if (!item.ok) return item;
        candidates = (item.value.content ?? []).filter(child => child.listStyle === "task").map(child => {
          const parsed = parseActionLine(child.markdown ?? "");
          const listed: ListedTask = { id: child.id, line: child.markdown ?? "", state: stateOf(child.taskInfo?.state, parsed.tagState), container: { key: host.value!.collectionId, kind: "project", rootId: host.value!.rootId, projectId: query.project!.id } };
          if (child.taskInfo?.scheduleDate) listed.scheduleDate = child.taskInfo.scheduleDate;
          containers.set(child.id.toLowerCase(), listed.container);
          return listed;
        });
      } else {
        const all = await listAll();
        if (!all.ok) return all;
        limits.push("Discovery uses the space-wide task listing, which is not a transactional snapshot.");
        if (!all.value.complete) limits.push(`Only the first ${MAX_LISTING_PAGES} listing pages were scanned.`);
        // Only GPK's locations are managed: Inbox, Daily Notes and Project rows.
        let owners: Map<string, string> | null = null;
        if (host.value && all.value.tasks.some(task => task.container.rootId?.toLowerCase() === host.value!.rootId.toLowerCase())) {
          const resolved = await projectOwners(host.value);
          if (!resolved.ok) return resolved;
          owners = resolved.value;
        }
        let unmanaged = 0;
        candidates = [];
        for (const task of all.value.tasks) {
          let container = task.container;
          if (container.kind === "document") {
            const projectId = owners?.get(task.id.toLowerCase());
            if (!projectId || !host.value) { unmanaged++; continue; }
            container = { key: host.value.collectionId, kind: "project", rootId: host.value.rootId, projectId };
            containerHints.set(task.id.toLowerCase(), container);
          }
          if (query.project === null && container.kind === "project") continue;
          containers.set(task.id.toLowerCase(), container);
          candidates.push({ ...task, container });
        }
        if (unmanaged) limits.push(`${unmanaged} task block(s) in documents outside GPK's locations were not considered.`);
      }
      if (query.relatedTo) {
        const related = await ctx.relatedIds!(query.relatedTo);
        if (!related.ok) return related;
        candidates = candidates.filter(task => related.value.ids.has(task.id.toLowerCase()));
        limits.push(...related.value.limits);
      }
      if (query.states) candidates = candidates.filter(task => query.states!.includes(task.state));
      if (query.text) candidates = candidates.filter(task => parseActionLine(task.line).title.includes(query.text!));
      if (query.time) {
        const { from, to, includeUnset } = query.time;
        candidates = candidates.filter(task => task.scheduleDate
          ? (!from || task.scheduleDate >= from) && (!to || task.scheduleDate <= to)
          : Boolean(includeUnset));
      }
      const page = candidates.slice(offset, offset + limit);
      const items: Snapshot<Task, TaskRef>[] = [];
      const unreadable: string[] = [];
      const refs = page.map(listed => ({ kind: "Task", scope: scoped.value.id, id: listed.id }) as TaskRef);
      const blocks = await readTaskBlocks(refs);
      if (!blocks.ok) return blocks;
      for (const ref of refs) {
        const block = blocks.value.get(ref.id.toLowerCase());
        if (!block) { unreadable.push(ref.id); continue; }
        items.push(snapshotOf(ref, block, containers.get(ref.id.toLowerCase())));
      }
      const next = offset + limit;
      const exhausted = next >= candidates.length;
      const complete = exhausted && !limits.some(limit => limit.startsWith("Only the first")) && unreadable.length === 0;
      const result: Page<Snapshot<Task, TaskRef>> = !exhausted
        ? { items, coverage: "partial", next: Buffer.from(`tasks:${next}`).toString("base64url") }
        : complete ? { items, coverage: "complete" } : { items, coverage: "partial" };
      if (query.text) limits.push("text matched the Task action line only; bodies were not searched.");
      if (unreadable.length) limits.push(`Unreadable during the query and omitted: ${unreadable.join(", ")}.`);
      return { ok: true, value: result, limits };
    },
    async create(input: TaskInput, guard) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim()) return failure("invalid", "A Task needs a nonblank title.", "Supply the action text.");
      if (input.time !== undefined && !isValidDate(input.time)) return failure("invalid", "time must be a valid YYYY-MM-DD date.", "Correct the date.");
      const line = renderActionLine(input.title.trim(), input.state);
      let id: string | undefined;
      let container: CraftTaskContainer;
      let placement: string;
      if (input.project) {
        // Project-owned: a task block in the Plan & Actions sequence of the Project row.
        if (input.project.scope !== scoped.value.id) return failure("invalid", "The Project belongs to another space.", "Resolve the Project in this space.");
        const host = await projectsHost();
        if (!host.ok) return host;
        if (!host.value) return failure("unavailable", "The Projects Collection is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
        const granted = await authorizeRoot(guard, "tasks.create", host.value.collectionId, input.project);
        if (!granted.ok) return granted;
        const item = await collectionOps.readItem(input.project, host.value.collectionId, "Project");
        if (!item.ok) return item;
        container = { key: host.value.collectionId, kind: "project", rootId: host.value.rootId, projectId: input.project.id };
        const before = new Set((item.value.content ?? []).map(child => child.id.toLowerCase()));
        const created = await connection.write(`blocks add ${insertionFor(item.value)} --markdown ${JSON.stringify(`- [ ] ${line}`)}`);
        if (!created.ok) return created;
        id = created.value.match(/IDs: <([^>]+)>/)?.[1];
        if (!id) {
          const after = await readBlock(input.project.id, 1);
          id = after.ok ? (after.value.content ?? []).find(child => child.listStyle === "task" && !before.has(child.id.toLowerCase()))?.id : undefined;
        }
        if (!id) return failure("uncertain", "Craft did not report the created Task ID.", "Read the Project to find the new Task before retrying.");
        if (input.time || input.state === "done" || input.state === "canceled") {
          const parts = [`tasks update --task ${id}`];
          if (input.time) parts.push(`--schedule ${input.time}`);
          if (input.state === "done" || input.state === "canceled") parts.push(`--state ${input.state}`);
          const adjusted = await connection.write(parts.join(" "));
          if (!adjusted.ok) return { ok: false, error: { ...adjusted.error, code: "partial", affected: [{ kind: "Task", scope: scoped.value.id, id }], next: "The Task exists; set its date or state with tasks.schedule / tasks.transition." } };
        }
        placement = `Created in the Project row ${input.project.id} after its last Task.`;
      } else {
        const date = todayIn(scoped.value.timezone);
        container = { key: `daily-notes/${date}`, kind: "daily-note", date };
        const granted = await authorize(guard, "tasks.create", container);
        if (!granted.ok) return granted;
        const parts = [`tasks add --markdown ${JSON.stringify(line)} --location dailyNote --date ${date}`];
        if (input.time) parts.push(`--schedule ${input.time}`);
        if (input.state === "done" || input.state === "canceled") parts.push(`--state ${input.state}`);
        const created = await connection.write(parts.join(" "));
        if (!created.ok) return created;
        id = created.value.match(/Created task <([^>]+)>/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the created Task ID.", "List today's Daily Note tasks to find the new Task before retrying.");
        placement = `Created in the Daily Note for ${date}; Craft defaults an unscheduled Daily Note Task's time to that date.`;
      }
      const ref: TaskRef = { kind: "Task", scope: scoped.value.id, id };
      containerHints.set(id.toLowerCase(), container);
      const affected: Ref[] = [ref];
      if (input.content.trim()) {
        const body = await connection.write(`blocks add --id ${id} --markdown ${JSON.stringify(input.content)}`);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected, next: "The Task exists without its body; add the body with tasks.update instead of creating again." } };
      }
      const verified = await verifyTask(ref, task => task.title === input.title.trim() && task.state === input.state, "The Task was created; read it back and adjust with tasks.update.");
      if (!verified.ok) return verified;
      const receipt: CreateReceipt<TaskRef> = { ...verified.value, created: ref, affected };
      return { ok: true, value: receipt, limits: [placement] };
    },
    async update(ref, update, guard) {
      if (update.title === undefined && !update.edits?.length) return failure("invalid", "Supply a title or at least one edit.", "Nothing to change.");
      if (update.title !== undefined && !update.title.trim()) return failure("invalid", "A Task title cannot be blank.", "Supply the action text.");
      const current = await readTaskBlock(ref);
      if (!current.ok) return current;
      const container = await containerOf(ref);
      if (!container.ok) return container;
      const granted = await authorize(guard, "tasks.update", container.value, ref);
      if (!granted.ok) return granted;
      const fresh = await checkExpected(guard, current.value, ref);
      if (!fresh.ok) return fresh;
      const block = current.value;
      const parsed = parseActionLine(block.markdown ?? "");
      const state = stateOf(block.taskInfo?.state, parsed.tagState);
      const affected: Ref[] = [ref];
      const planned = planEdits(block, update.edits ?? [], ref);
      if (!planned.ok) return planned;
      const plans = planned.value;
      if (update.title !== undefined) {
        const renamed = await connection.write(`tasks update --task ${ref.id} --markdown ${JSON.stringify(renderActionLine(update.title.trim(), state))}`);
        if (!renamed.ok) return renamed;
      }
      const written = await writeEdits(plans);
      if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected, next: "Some edits were applied; read the Task back before retrying the rest." } };
      const after = await readTaskBlock(ref);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the Task back to see which edits persisted." } };
      const before = new Set((block.content ?? []).map(child => child.id));
      for (const child of after.value.content ?? []) if (!before.has(child.id)) affected.push({ scope: ref.scope, id: child.id });
      const titleOk = update.title === undefined || toTask(after.value).title === update.title.trim();
      const editsOk = [...plans].every(([id, text]) => (after.value.content ?? []).some(child => child.id === id && (child.markdown ?? "").replace(LINE_PREFIX, "") === text.replace(LINE_PREFIX, "").split("\n\n")[0]));
      return { ok: true, value: { affected, verified: titleOk && editsOk, version: digestOf(after.value), ...(titleOk && editsOk ? {} : { recovery: "Read the Task back and compare." }) }, limits: [] };
    },
    archive: async () => unsupported("craft.tasks.archive"),
    restore: async () => unsupported("craft.tasks.restore"),
    remove: async () => unsupported("craft.tasks.remove"),
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      const current = await readTaskBlock(ref);
      if (!current.ok) return current;
      const container = await containerOf(ref);
      if (!container.ok) return container;
      const granted = await authorize(guard, "tasks.transition", container.value, ref);
      if (!granted.ok) return granted;
      const fresh = await checkExpected(guard, current.value, ref);
      if (!fresh.ok) return fresh;
      const block = current.value;
      const parsed = parseActionLine(block.markdown ?? "");
      const from = stateOf(block.taskInfo?.state, parsed.tagState);
      if (!TRANSITIONS[from].includes(state)) return failure("conflict", `A ${from} Task cannot move to ${state}.`, "Read the current state and choose a valid transition.", [ref]);
      const parts = [`tasks update --task ${ref.id}`];
      if (state === "done" || state === "canceled") {
        parts.push(`--state ${state}`);
        // The native checkbox now carries the state; a leftover doing/waiting tag would contradict it.
        if (parsed.tagState) parts.push(`--markdown ${JSON.stringify(renderActionLine(parsed.title, state))}`);
      } else {
        parts.push(`--markdown ${JSON.stringify(renderActionLine(parsed.title, state))}`);
        if (from === "done" || from === "canceled") parts.push("--state todo");
      }
      const written = await connection.write(parts.join(" "));
      if (!written.ok) return written;
      const stamp = todayIn(spaceCache?.timezone ?? "UTC");
      const note = await connection.write(`blocks add --id ${ref.id} --markdown ${JSON.stringify(`${state} (${stamp}): ${reason.trim()}`)}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The state changed but the reason was not recorded; add it with tasks.update." } };
      return verifyTask(ref, (task, after) => task.state === state && parseActionLine(after.markdown ?? "").tagState === (TAG_STATES.includes(state as "doing") ? state : undefined), "Read the Task back; the state change may not have persisted.");
    },
    async assignProject(ref, project, reason, guard) {
      if (!reason.trim()) return failure("invalid", "Reassigning ownership needs a nonblank reason.", "Explain the change.");
      const current = await readTaskBlock(ref);
      if (!current.ok) return current;
      const source = await containerOf(ref);
      if (!source.ok) return source;
      if (source.value.kind === "document") return failure("unsupported", "The Task lives in a document outside GPK's locations; it is not moved.", "Recreate the Task under the Project instead.", [ref]);
      const fresh = await checkExpected(guard, current.value, ref);
      if (!fresh.ok) return fresh;
      const scoped = await space();
      if (!scoped.ok) return scoped;
      let destination: CraftTaskContainer;
      let command: string;
      if (project) {
        if (project.scope !== ref.scope) return failure("invalid", "The Project belongs to another space.", "Resolve the Project in this space.");
        const host = await projectsHost();
        if (!host.ok) return host;
        if (!host.value) return failure("unavailable", "The Projects Collection is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
        if (source.value.kind === "project" && source.value.projectId?.toLowerCase() === project.id.toLowerCase()) return failure("conflict", "The Task already belongs to this Project.", "Nothing to change.", [ref]);
        const granted = await authorizeRoot(guard, "tasks.assignProject", host.value.collectionId, ref);
        if (!granted.ok) return granted;
        const item = await collectionOps.readItem(project, host.value.collectionId, "Project");
        if (!item.ok) return item;
        destination = { key: host.value.collectionId, kind: "project", rootId: host.value.rootId, projectId: project.id };
        const anchor = insertionFor(item.value).replace("--siblingId", "--targetSiblingId").replace(`--id ${item.value.id}`, `--targetId ${item.value.id}`);
        command = `blocks move --id ${ref.id} ${anchor}`;
      } else {
        if (source.value.kind !== "project") return failure("conflict", "The Task is already standalone.", "Nothing to change.", [ref]);
        const date = todayIn(scoped.value.timezone);
        destination = { key: `daily-notes/${date}`, kind: "daily-note", date };
        const granted = await authorize(guard, "tasks.assignProject", destination, ref);
        if (!granted.ok) return granted;
        command = `blocks move --id ${ref.id} --targetDate ${date} --position end`;
      }
      const moved = await connection.write(command);
      if (!moved.ok) return moved;
      containerHints.set(ref.id.toLowerCase(), destination);
      const stamp = todayIn(scoped.value.timezone);
      const note = await connection.write(`blocks add --id ${ref.id} --markdown ${JSON.stringify(`${project ? `moved to Project ${project.id}` : "made standalone"} (${stamp}): ${reason.trim()}`)}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The Task moved but the reason was not recorded; add it with tasks.update." } };
      const after = await containerOf(ref);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the Task back to see where it is now." } };
      const verified = after.value.key === destination.key && after.value.projectId?.toLowerCase() === destination.projectId?.toLowerCase();
      const block = await readTaskBlock(ref);
      return { ok: true, value: { affected: [ref], verified, ...(block.ok ? { version: digestOf(block.value) } : {}), ...(verified ? {} : { recovery: "Read the Task back; the move may not have persisted." }) }, limits: [] };
    },
    async schedule(ref, time, guard) {
      if (time !== null && !isValidDate(time)) return failure("invalid", "time must be a valid YYYY-MM-DD date or null.", "Correct the date.");
      const current = await readTaskBlock(ref);
      if (!current.ok) return current;
      const container = await containerOf(ref);
      if (!container.ok) return container;
      const granted = await authorize(guard, "tasks.schedule", container.value, ref);
      if (!granted.ok) return granted;
      const fresh = await checkExpected(guard, current.value, ref);
      if (!fresh.ok) return fresh;
      const payload = jsonArgument({ id: ref.id, taskInfo: { scheduleDate: time } });
      const written = await connection.write(`blocks update --json '${payload}'`);
      if (!written.ok) return written;
      return verifyTask(ref, task => (task.time ?? null) === time, "Read the Task back; the planned time may not have persisted.");
    },
  };

  const captures: CaptureOperations = {
    async resolve(surface: CaptureSurface) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (surface.name === "inbox") return { ok: true, value: { scope: scoped.value.id, id: "inbox", role: "capture-surface" }, limits: [] };
      if (!isValidDate(surface.date)) return failure("invalid", "Daily Note dates must be valid YYYY-MM-DD.", "Correct the date.");
      const read = await readJson<{ data?: CraftBlock[] }>(`blocks get --date ${surface.date} --format json --depth 0`);
      if (!read.ok) return read.error.code === "invalid" ? failure("not-found", `No Daily Note exists for ${surface.date}.`, "Choose a date with a Daily Note.") : read;
      if (!read.value.data?.[0]) return failure("not-found", `No Daily Note exists for ${surface.date}.`, "Choose a date with a Daily Note.");
      return { ok: true, value: { scope: scoped.value.id, id: `daily-notes/${surface.date}`, role: "capture-surface" }, limits: [] };
    },
    async list(surface: CaptureSurfaceRef, options?: ReadOptions) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (surface.scope !== scoped.value.id) return failure("unauthorized", "The surface belongs to another space.", "Resolve the surface in this space.");
      if (options?.cursor) return failure("invalid", "Capture listings are returned in one page.", "Omit the cursor.");
      if (surface.id === "inbox") {
        const listing = await connection.read("tasks list --scope inbox");
        if (!listing.ok) return listing;
        const items = parseTaskListing(listing.value).map(task => ({
          ref: { scope: scoped.value.id, id: task.id, role: "capture" as const, surface },
          value: { content: task.line }, coverage: "complete" as const,
        }));
        return { ok: true, value: { items, coverage: "complete" }, limits: ["Craft's Inbox holds task blocks only; each item is its action line."] };
      }
      const date = surface.id.match(/^daily-notes\/(\d{4}-\d{2}-\d{2})$/)?.[1];
      if (!date) return failure("invalid", "Unknown capture surface.", "Resolve the surface first.");
      const read = await readJson<{ data?: CraftBlock[] }>(`blocks get --date ${date} --format json --depth 1`);
      if (!read.ok) return read;
      const root = read.value.data?.[0];
      if (!root) return failure("not-found", `No Daily Note exists for ${date}.`, "Choose a date with a Daily Note.");
      const items = (root.content ?? []).map(child => ({
        ref: { scope: scoped.value.id, id: child.id, role: "capture" as const, surface },
        value: { content: child.markdown ?? "" },
        coverage: (child.content?.length ? "partial" : "complete") as "partial" | "complete",
      }));
      return { ok: true, value: { items, coverage: "complete" }, limits: ["Top-level blocks of the Daily Note; nested content needs captures.read."] };
    },
    async read(ref: CaptureRef) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", "The capture reference is not a block in this space.", "List the surface again.", [ref]);
      const read = await readJson<{ data?: CraftBlock[] }>(`blocks get --id ${ref.id} --depth 1 --format json --fetchMetadata`);
      if (!read.ok) return read.error.code === "invalid" ? failure("not-found", "The capture block is not readable.", "List the surface again.", [ref]) : read;
      const block = read.value.data?.[0];
      if (!block) return failure("not-found", "The capture block is not readable.", "List the surface again.", [ref]);
      const content = [block.markdown ?? "", bodyOf(block)].filter(Boolean).join("\n\n");
      return { ok: true, value: { ref, value: { content }, version: digestOf(block), coverage: "complete" }, limits: [] };
    },
    append: async () => unsupported("craft.captures.append"),
    update: async () => unsupported("craft.captures.update"),
    remove: async () => unsupported("craft.captures.remove"),
  };

  // ---------- layout: Collections for Projects/Areas, folders for the rest ----------
  type SchemaColumn = { key: string; name: string; type: string; options: string[]; target?: string };
  async function readSchema(collectionId: string): Promise<Result<{ title: string; columns: SchemaColumn[] }>> {
    const result = await connection.read(`collections schema --collection ${collectionId}`);
    if (!result.ok) return result;
    const columns: SchemaColumn[] = [];
    for (const line of result.value.split("\n")) {
      // `key → "Name" (type)` optionally followed by `— options: …` or `— target collection: <id>`.
      const column = line.match(/^\s+(\w+) → "([^"]*)" \((\w+)\)(?: — (.*))?$/);
      if (!column) continue;
      const trailer = column[4] ?? "";
      const entry: SchemaColumn = { key: column[1]!, name: column[2]!, type: column[3]!, options: [] };
      if (trailer.startsWith("options:")) entry.options = [...trailer.matchAll(/"([^"]*)"/g)].map(m => m[1]!);
      const target = trailer.match(/target collection: (\S+)/)?.[1];
      if (target) entry.target = target;
      columns.push(entry);
    }
    const title = result.value.match(/^Collection: "([^"]*)"/m)?.[1] ?? "";
    return { ok: true, value: { title, columns }, limits: [] };
  }
  function checkStateColumn(columns: SchemaColumn[], states: readonly string[]): string | null {
    const status = columns.find(column => column.name === "Status" || column.key === "status");
    if (!status) return "no Status column";
    if (status.type !== "singleSelect") return `Status column is ${status.type}, not singleSelect`;
    const missing = states.filter(state => !status.options.includes(state));
    return missing.length ? `Status options missing ${missing.join(", ")}` : null;
  }
  async function listCollections(): Promise<Result<LayoutInspection["candidates"]["collections"]>> {
    const result = await connection.read("collections list");
    if (!result.ok) return result;
    const collections = [];
    for (const line of result.value.split("\n")) {
      const m = line.match(/^\s+(.*?)\s*<([^>]+)> - (\d+) items? \(in document ([^)]+)\)/);
      if (m) collections.push({ name: m[1] === "Collection" ? "" : m[1]!, id: m[2]!, items: Number(m[3]), documentId: m[4]! });
    }
    return { ok: true, value: collections, limits: [] };
  }
  /** `folders list` pages 20 folders; follow `--offset` until a short page (capped). */
  async function listFolders(filter?: string): Promise<Result<LayoutInspection["candidates"]["folders"]>> {
    const folders: LayoutInspection["candidates"]["folders"] = [];
    const base = filter ? `folders list --filter ${JSON.stringify(filter)}` : "folders list";
    for (let offset = 0, page = 0; page < 20; offset += 20, page++) {
      const result = await connection.read(offset ? `${base} --offset ${offset}` : base);
      if (!result.ok) return result;
      // Tree rows: `* <id> Name (n docs)` indented two spaces per level; empty folders carry no count.
      const stack: string[] = [];
      for (const line of result.value.split("\n")) {
        const m = line.match(/^(\s*)\*\s+<([^>]+)>\s+(.*?)(?:\s+\((\d+) docs?\))?\s*$/);
        if (!m) continue;
        const depth = Math.floor(m[1]!.length / 2);
        stack.length = depth;
        folders.push({ id: m[2]!, name: m[3]!, documents: Number(m[4] ?? 0), parentId: stack[depth - 1] ?? null });
        stack[depth] = m[2]!;
      }
      const range = result.value.match(/Showing \d+-(\d+) of (\d+) folders/);
      if (!range || Number(range[1]) >= Number(range[2])) break;
    }
    // Later pages repeat ancestor rows for context; keep the first occurrence of each ID.
    const seen = new Set<string>();
    return { ok: true, value: folders.filter(folder => !seen.has(folder.id) && seen.add(folder.id)), limits: [] };
  }
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function checkLocation(role: LayoutRole, ref: Ref, scopeId: string): Promise<LayoutLocationCheck> {
    if (ref.scope !== scopeId || !ref.id || ref.id === "unset") return { role, ref, status: "unset", detail: "No location selected." };
    if (role === "project" || role === "area") {
      const schema = await readSchema(ref.id);
      if (!schema.ok) return { role, ref, status: schema.error.code === "unavailable" ? "missing" : "missing", detail: schema.error.message };
      const problem = checkStateColumn(schema.value.columns, role === "project" ? PROJECT_STATES : AREA_STATES);
      if (problem) return { role, ref, status: "wrong-kind", detail: problem };
      if (role === "project" && !schema.value.columns.some(column => column.type === "relation")) return { role, ref, status: "wrong-kind", detail: "no relation column for the primary Area" };
      return { role, ref, status: "ok", detail: `Collection "${schema.value.title}" with the expected Status column.` };
    }
    const folders = await listFolders();
    if (!folders.ok) return { role, ref, status: "missing", detail: folders.error.message };
    const folder = folders.value.find(entry => entry.id.toLowerCase() === ref.id.toLowerCase());
    return folder
      ? { role, ref, status: "ok", detail: `Folder "${folder.name}" (${folder.documents} documents).` }
      : { role, ref, status: "missing", detail: "No folder with this ID." };
  }

  const layout: CraftKnowledgeAdapter["layout"] = {
    async inspect(locations) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const checks: LayoutLocationCheck[] = [];
      if (locations) {
        for (const role of ["area", "project", "source", "wiki", "output"] as const) checks.push(await checkLocation(role, locations[role], scoped.value.id));
      }
      const collections = await listCollections();
      if (!collections.ok) return collections;
      const folders = await listFolders();
      if (!folders.ok) return folders;
      return { ok: true, value: { locations: checks, candidates: { collections: collections.value, folders: folders.value } }, limits: [] };
    },
    async establish(plan) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const scopeId = scoped.value.id;
      const created: Ref[] = [];
      const adopted: Ref[] = [];
      const partial = (error: Failure, step: string): Result<never> => ({ ok: false, error: { ...error, code: created.length ? "partial" : error.code, affected: created, next: `${step} failed. ${created.length ? "Keep the created structures and rerun establish adopting them by ID." : error.next}` } });

      // Preflight every adoption before any write, so an invalid plan has no side effects.
      const adoptions: [LayoutRole, { id: string } | { name: string }][] = [
        ["area", plan.areas], ["project", plan.projects], ["source", plan.sources], ["wiki", plan.wikis], ["output", plan.outputs],
      ];
      for (const [role, choice] of adoptions) {
        if (!("id" in choice)) continue;
        const check = await checkLocation(role, { scope: scopeId, id: choice.id }, scopeId);
        if (check.status !== "ok") return failure("invalid", `${role} ${choice.id}: ${check.detail}`, "Adopt a matching Collection or folder, or create a new one by name.");
      }
      // Namespace folder: reuse a root-level folder of that name, else create it.
      let namespaceId: string | null = null;
      const namespacePlan = plan.namespace ?? "root";
      if (namespacePlan !== "root") {
        if ("folderId" in namespacePlan) {
          const all = await listFolders();
          if (!all.ok) return partial(all.error, "Listing folders");
          if (!all.value.some(entry => entry.id.toLowerCase() === namespacePlan.folderId.toLowerCase())) return failure("not-found", `No folder with ID ${namespacePlan.folderId}.`, "Choose an existing folder ID or a name.");
          namespaceId = namespacePlan.folderId;
          adopted.push({ scope: scopeId, id: namespaceId });
        } else {
          const all = await listFolders();
          if (!all.ok) return partial(all.error, "Listing folders");
          const existing = all.value.find(entry => entry.parentId === null && entry.name === namespacePlan.folder);
          if (existing) {
            namespaceId = existing.id;
            adopted.push({ scope: scopeId, id: existing.id });
          } else {
            const result = await connection.write(`folders create --name ${JSON.stringify(namespacePlan.folder)}`);
            if (!result.ok) return partial(result.error, "Creating the namespace folder");
            namespaceId = result.value.match(/<([0-9a-fA-F-]{36})>/)?.[1] ?? null;
            if (!namespaceId) return partial({ code: "uncertain", message: "Craft did not report the namespace folder ID.", affected: [], next: "List folders and rerun establish with the folder ID." }, "Creating the namespace folder");
            created.push({ scope: scopeId, id: namespaceId });
          }
        }
      }
      const inNamespace = namespaceId ? ` --folder ${namespaceId}` : "";
      const underNamespace = namespaceId ? ` --parent ${namespaceId}` : "";

      // Collections: adopt by ID after checking the schema, or create inside the host document.
      const host = plan.hostDocument;
      let hostRoot = "rootId" in host ? host.rootId : null;
      const needsHost = !("id" in plan.areas) || !("id" in plan.projects);
      if (needsHost && !hostRoot && "title" in host) {
        const result = await connection.write(`documents create --title ${JSON.stringify(host.title)}${inNamespace}`);
        if (!result.ok) return partial(result.error, "Creating the host document");
        hostRoot = result.value.match(/rootBlockId: ([0-9a-fA-F-]+)/)?.[1] ?? null;
        if (!hostRoot) return partial({ code: "uncertain", message: "Craft did not report the host document ID.", affected: [], next: "Find the document by title and rerun establish adopting it." }, "Creating the host document");
        created.push({ scope: scopeId, id: hostRoot });
      }
      async function collection(role: "area" | "project", choice: { name: string } | { id: string }, extra: string, states: readonly string[]): Promise<Result<string>> {
        if ("id" in choice) {
          const check = await checkLocation(role, { scope: scopeId, id: choice.id }, scopeId);
          if (check.status !== "ok") return failure("invalid", `${role} Collection ${choice.id}: ${check.detail}`, "Adopt a Collection with the expected Status column, or create a new one by name.");
          adopted.push({ scope: scopeId, id: choice.id });
          return { ok: true, value: choice.id, limits: [] };
        }
        const titleColumn = role === "area" ? "Area" : "Project";
        const result = await connection.write(`collections create --name ${JSON.stringify(choice.name)} --title ${JSON.stringify(titleColumn)} --Status ${JSON.stringify(`select:${states.join(",")}`)}${extra} --document ${hostRoot}`);
        if (!result.ok) return result;
        const id = result.value.match(/<([0-9a-fA-F-]{36})>/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the Collection ID.", "Inspect the host document and rerun establish adopting the Collection by ID.");
        created.push({ scope: scopeId, id });
        const check = await checkLocation(role, { scope: scopeId, id }, scopeId);
        if (check.status !== "ok") return failure("uncertain", `Created Collection does not read back as expected: ${check.detail}`, "Inspect the Collection schema in Craft.");
        return { ok: true, value: id, limits: [] };
      }
      const areas = await collection("area", plan.areas, "", AREA_STATES);
      if (!areas.ok) return partial(areas.error, "Establishing the Areas Collection");
      const projects = await collection("project", plan.projects, ` --Area ${JSON.stringify(`relation:${areas.value}`)}`, PROJECT_STATES);
      if (!projects.ok) return partial(projects.error, "Establishing the Projects Collection");

      async function folder(role: "source" | "wiki" | "output", choice: { name: string } | { id: string }): Promise<Result<string>> {
        if ("id" in choice) {
          const check = await checkLocation(role, { scope: scopeId, id: choice.id }, scopeId);
          if (check.status !== "ok") return failure("invalid", `${role} folder ${choice.id}: ${check.detail}`, "Adopt an existing folder by ID or create one by name.");
          adopted.push({ scope: scopeId, id: choice.id });
          return { ok: true, value: choice.id, limits: [] };
        }
        // A clash counts only among siblings under the namespace (or the root without one).
        const existing = await listFolders(`^${escapeRegex(choice.name)}$`);
        if (existing.ok && existing.value.some(entry => entry.name === choice.name && entry.parentId === namespaceId)) {
          return failure("ambiguous", `A folder named "${choice.name}" already exists there.`, "Adopt it by ID or choose another name.");
        }
        const result = await connection.write(`folders create --name ${JSON.stringify(choice.name)}${underNamespace}`);
        if (!result.ok) return result;
        const id = result.value.match(/<([0-9a-fA-F-]{36})>/)?.[1] ?? result.value.match(/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}/)?.[0];
        if (!id) return failure("uncertain", "Craft did not report the folder ID.", "List folders and rerun establish adopting the folder by ID.");
        created.push({ scope: scopeId, id });
        return { ok: true, value: id, limits: [] };
      }
      const sources = await folder("source", plan.sources);
      if (!sources.ok) return partial(sources.error, "Establishing the Sources folder");
      const wikis = await folder("wiki", plan.wikis);
      if (!wikis.ok) return partial(wikis.error, "Establishing the Wikis folder");
      const outputs = await folder("output", plan.outputs);
      if (!outputs.ok) return partial(outputs.error, "Establishing the Outputs folder");

      // Views are dashboards for people. Missing GPK views are added on created and
      // adopted Collections alike, so a recovery rerun ends in the same state.
      const limits: string[] = [];
      const views: string[] = [];
      const metadataLanguage = plan.metadataLanguage ?? "en";
      const viewNames = VIEW_NAMES[metadataLanguage];
      if (plan.views !== false) {
        const ensure = async (collectionId: string, label: string, wanted: [string, string][]) => {
          const listing = await connection.read(`collections views-list --collection ${collectionId}`);
          const existing = new Set<string>();
          if (listing.ok) for (const line of listing.value.split("\n")) { const m = line.match(/^\s+(.*?)\s+<[^>]+>\s+-\s+\w+/); if (m) existing.add(m[1]!); }
          for (const [name, command] of wanted) {
            if (existing.has(name)) continue;
            const result = await connection.write(command);
            if (result.ok) views.push(`${label}: ${name}`);
            else limits.push(`View "${name}" was not created on ${label}: ${result.error.message}`);
          }
        };
        await ensure(projects.value, "Projects", [
          [viewNames.board, `collections views-create --collection ${projects.value} --name ${JSON.stringify(viewNames.board)} --type kanban --group-by Status --column-order "${PROJECT_STATES.join(",")}" --visible-fields "Area" --show-column-colors true`],
          [viewNames.byArea, `collections views-create --collection ${projects.value} --name ${JSON.stringify(viewNames.byArea)} --type table --group '[{"property":"Area","ascending":true}]' --field-order "Project,Status,Area"`],
          [viewNames.active, `collections views-create --collection ${projects.value} --name ${JSON.stringify(viewNames.active)} --type table --filters '[{"property":"Status","filterType":"equals","filterValue":"active"}]' --field-order "Project,Area,Status"`],
        ]);
        await ensure(areas.value, "Areas", [
          [viewNames.board, `collections views-create --collection ${areas.value} --name ${JSON.stringify(viewNames.board)} --type kanban --group-by Status --column-order "${AREA_STATES.join(",")}" --show-column-colors true`],
        ]);
      }

      // Templates for people: installed once by title into Craft's Templates area.
      const templates: Ref[] = [];
      if (plan.templates !== false) {
        const listing = await connection.read("documents list --location templates");
        const existingTitles = new Set<string>();
        if (listing.ok) for (const line of listing.value.split("\n")) { const m = line.match(/^\s+<[^>]+>\s+(.*?)\s*$/); if (m) existingTitles.add(m[1]!); }
        for (const role of CRAFT_TEMPLATE_ROLES) {
          const title = craftTemplateTitle(role);
          if (existingTitles.has(title)) continue;
          const createdDoc = await connection.write(`documents create --title ${JSON.stringify(title)} --destination templates`);
          const id = createdDoc.ok ? createdDoc.value.match(/rootBlockId: ([0-9a-fA-F-]+)/)?.[1] : undefined;
          if (!createdDoc.ok || !id) { limits.push(`Template "${title}" was not installed${createdDoc.ok ? "" : `: ${createdDoc.error.message}`}`); continue; }
          const body = await connection.write(`blocks add --id ${id} --markdown ${JSON.stringify(craftTemplateBody(role, metadataLanguage))}`);
          if (!body.ok) limits.push(`Template "${title}" was created without its body: ${body.error.message}`);
          templates.push({ scope: scopeId, id });
          created.push({ scope: scopeId, id });
        }
      }

      if (hostRoot && created.some(ref => ref.id === hostRoot)) limits.push(`Host document ${hostRoot} was created to hold the Collections.`);
      return {
        ok: true,
        value: {
          locations: {
            area: { scope: scopeId, id: areas.value }, project: { scope: scopeId, id: projects.value },
            source: { scope: scopeId, id: sources.value }, wiki: { scope: scopeId, id: wikis.value }, output: { scope: scopeId, id: outputs.value },
          },
          created, adopted,
          namespace: namespaceId ? { scope: scopeId, id: namespaceId } : null,
          views, templates,
        },
        limits,
      };
    },
  };

  const adapter: CraftKnowledgeAdapter = {
    capabilities: async (): Promise<Result<Capabilities>> => {
      const capabilities: Capabilities = {};
      const evidence = ["Headless MCP client against mcp.craft.do, checks dated 2026-10-09 to 2026-10-11."];
      const native = (limits: string[]): Capability => ({ mode: "native", limits, evidence });
      const emulated = (limits: string[]): Capability => ({ mode: "emulated", limits, evidence });
      Object.assign(capabilities, {
        "tasks.resolve": native(["Block IDs and Craft links carrying blockId."]),
        "tasks.read": native(["Ownership comes from the Task's container: a Project row, a Daily Note or the Inbox."]),
        "tasks.query": emulated(["Space-wide task listing filtered in memory; only Inbox, Daily Note and Project-row Tasks are considered."]),
        "tasks.query.states": emulated(["Native checkbox plus line-end #gpk/task tag."]),
        "tasks.query.time": emulated(["Filters the listing's schedule dates."]),
        "tasks.query.text": { mode: "degraded", limits: ["Matches the Task action line only; bodies are not searched."], evidence },
        "tasks.query.project": emulated(["A Project's Tasks are its row's task blocks; project: null excludes them."]),
        "tasks.query.relatedTo": emulated(["Filters by links discovered through a body scan; see links.query."]),
        "tasks.create": native(["Standalone Tasks go to today's Daily Note; Project-owned Tasks follow the last Task of the Project row."]),
        "tasks.assignProject": emulated(["blocks move into the Project row or today's Daily Note; authorized on the destination root."]),
        "areas.resolve": native(["Row IDs of the Areas Collection."]),
        "areas.read": native([]),
        "areas.query": emulated(["Collection items read in one batch and filtered in memory."]),
        "areas.query.states": native(["Status single-select column."]),
        "areas.query.text": { mode: "degraded", limits: ["Matches row titles only."], evidence },
        "areas.query.relatedTo": emulated(["Filters by links discovered through a body scan; see links.query."]),
        "areas.create": native(["collections items-add with Status; the body is appended to the row page."]),
        "areas.update": emulated(["Title via items-update; body edits per child block."]),
        "areas.transition": emulated(["Status column plus an appended reason block."]),
        "projects.resolve": native(["Row IDs of the Projects Collection."]),
        "projects.read": native(["State and primary Area are the Status and Area columns."]),
        "projects.query": emulated(["Collection items read in one batch and filtered in memory."]),
        "projects.query.states": native(["Status single-select column."]),
        "projects.query.area": native(["Area relation column."]),
        "projects.query.text": { mode: "degraded", limits: ["Matches row titles only."], evidence },
        "projects.query.relatedTo": emulated(["Filters by links discovered through a body scan; see links.query."]),
        "sources.resolve": native(["Root block IDs of documents in the Sources folder (recursive)."]),
        "sources.read": native(["Title is the root block; body is its child blocks."]),
        "sources.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "sources.query.text": emulated(["Titles and bodies through Craft search scoped to the folder; search ignores case."]),
        "sources.query.relatedTo": emulated(["Filters by links discovered through a body scan."]),
        "sources.create": native(["documents create in the Sources folder, body appended."]),
        "sources.update": emulated(["Title via the root block; body edits per child block."]),
        "wikis.resolve": native(["Root block IDs of documents in the Wikis folder (recursive)."]),
        "wikis.read": native(["Title is the root block; body is its child blocks."]),
        "wikis.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "wikis.query.text": emulated(["Titles and bodies through Craft search scoped to the folder; search ignores case."]),
        "wikis.query.relatedTo": emulated(["Filters by links discovered through a body scan."]),
        "wikis.create": native(["documents create in the Wikis folder, body appended."]),
        "wikis.update": emulated(["Title via the root block; body edits per child block."]),
        "outputs.resolve": native(["Root block IDs of documents in the Outputs folder (recursive)."]),
        "outputs.read": native(["Title is the root block; body is its child blocks."]),
        "outputs.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "outputs.query.text": emulated(["Titles and bodies through Craft search scoped to the folder; search ignores case."]),
        "outputs.query.relatedTo": emulated(["Filters by links discovered through a body scan."]),
        "outputs.create": native(["documents create in the Outputs folder, body appended."]),
        "outputs.update": emulated(["Title via the root block; body edits per child block."]),
        "links.query": emulated(["Outgoing links parsed from the record body; incoming links found by searching the target's title, then reading the matching records and the Area and Project rows."]),
        "links.add": emulated(["A bullet with a block link and context under the record's Links heading (a child block on a Task)."]),
        "links.remove": emulated(["Deletes the matching link bullet."]),
        "checkpoints.read": emulated(["A nested page of the GPK System page in the host document, titled by key."]),
        "checkpoints.save": emulated(["Replaces the checkpoint page's blocks; authorized on the system root."]),
        "projects.create": native(["collections items-add with Status and Area; the body is appended to the row page."]),
        "projects.update": emulated(["Title via items-update; body edits per child block."]),
        "projects.transition": emulated(["Status column plus an appended reason block; closing requires no open Tasks."]),
        "projects.assignArea": native(["Area relation column plus an appended reason block."]),
        "projects.orderTasks": emulated(["Sequential blocks move --targetSiblingId; the order must list every current Task."]),
        "projects.materials.list": emulated(["Nested pages of the row that are not Tasks."]),
        "projects.materials.read": native([]),
        "projects.materials.append": native(["Inline heading plus body, or a nested page."]),
        "projects.materials.update": emulated(["Title via blocks update; body edits per child block."]),
        "tasks.update": emulated(["Title via tasks update; body edits per child block; expected is detected by re-read, not compare-and-swap."]),
        "tasks.transition": emulated(["done/canceled are native; doing/waiting are a line-end tag; the reason is appended as a child block."]),
        "tasks.schedule": native(["taskInfo.scheduleDate via JSON update."]),
        "captures.resolve": native(["inbox and daily-notes surfaces."]),
        "captures.list": native(["One page; Inbox items are task action lines."]),
        "captures.read": native([]),
      });
      const visit = (group: object, prefix: string) => {
        for (const [member, fn] of Object.entries(group)) {
          const name = `${prefix}.${member}`;
          if (typeof fn === "function") { if (!capabilities[name]) capabilities[name] = unsupportedCapability("Not implemented in this slice."); }
          else if (fn && typeof fn === "object") visit(fn, name);
        }
      };
      for (const [key, value] of Object.entries(adapter)) {
        if (key === "capabilities" || key === "containerOf" || key === "layout" || typeof value !== "object" || value === null) continue;
        visit(value, key);
      }
      return { ok: true, value: capabilities, limits: ["Capability inventory; archive, restore and remove are not implemented for any entity."] };
    },
    areas: collectionOps.areas,
    projects: collectionOps.projects,
    tasks,
    sources: documentOps.sources,
    wikis: documentOps.wikis,
    outputs: documentOps.outputs,
    captures,
    links: documentOps.links,
    checkpoints: documentOps.checkpoints,
    containerOf,
    layout,
  };
  return adapter;
}

export type { TextEdit };
