import { serialQueue } from "../runtime/serial.js";
import { createHash } from "node:crypto";
import type { Ref, Task, TaskRef, TaskState } from "../domain/entities.js";
import type {
  BackendTemplate, Capture, CaptureOperations, CaptureRef, CaptureSurface, CaptureSurfaceRef,
  DiscoveredWorkspace, KnowledgeBackendPort, KnowledgeTemplateOperations, TaskInput, TaskOperations,
  TaskQuery, TextEdit, WorkspaceInspection, WorkspaceLocationCheck,
  WorkspaceOperations,
} from "../domain/knowledge-backend-port.js";
import type {
  Capabilities, Capability, ControlGrant, CreateReceipt, Failure, GrantedWriteGuard,
  ReadOptions, Result, Snapshot, Version, WriteReceipt,
} from "../domain/operation-types.js";
import { readCursor, queryPage } from "./craft-pagination.js";
import type { KnowledgeLayout, TemplateBindingChanges, TemplateRole } from "../domain/user-control-port.js";
import { checkLocalFile, readLocalFile, type LocalFile } from "./local-files.js";
import type { CraftUploads, UploadCredentials } from "./craft-uploads.js";
import { craftBodyMarkdown, markdownArgument, nextFenceState } from "./craft-markdown.js";
import { createCollectionOperations, isValidDate, jsonArgument, type CraftBlock, type CraftEdits, type CraftContext } from "./craft-collections.js";
import { createDocumentOperations, sourceRecoveryBlocks } from "./craft-documents.js";
import { createCheckpointOperations, SYSTEM_TITLE } from "./craft-checkpoints.js";
import type { CraftConnection, CraftSpace } from "./craft-connection.js";
import {
  CRAFT_TEMPLATE_ROLES, craftTemplateBody, craftTemplateTitle, sanitizeCraftTemplate,
  type CraftTemplateRole, type TemplateLanguage,
} from "./craft-templates.js";
import { debug } from "../runtime/debug-log.js";

/**
 * Craft knowledge adapter over GPK's own MCP client. Shared reads, authorization,
 * prose validation, Tasks, captures, native Templates and Workspace Setup are composed
 * with Collection, document/link and checkpoint operations.
 */
export type CraftAdapterOptions = {
  connection: CraftConnection;
  backendId: string;
  /** Current layout locations from Settings, read on demand; null before Setup. */
  layout?: () => Promise<Result<KnowledgeLayout["locations"] | null>>;
  /** The upload route's credentials (null when none is configured) and local file policy, read on demand. */
  media?: () => Promise<Result<{ credentials: UploadCredentials | null; roots: string[]; unrestricted?: boolean; disallowedRoots?: readonly string[] }>>;
  uploads?: CraftUploads;
};

const LOCAL_MEDIA_LINE = /^\s*(!?)\[([^\]]*)\]\((?:<(file:\/\/[^>]+)>|(file:\/\/[^\s)]+))\)\s*$/;

export type CraftTaskContainer = { key: string; kind: "inbox" | "daily-note" | "document" | "project"; date?: string; rootId?: string; projectId?: string };

type LayoutRole = keyof KnowledgeLayout["locations"];
type LayoutLocationCheck = WorkspaceLocationCheck;
type ExistingWorkspace = DiscoveredWorkspace;
type LayoutInspection = WorkspaceInspection;

const LAYOUT_RECORD = "gpk/layout";
type LayoutRecord = {
  version: 1;
  areas: string; projects: string; sources: string; wikis: string; outputs: string;
  namespace: string | null;
  metadataLanguage: TemplateLanguage;
  templates?: Partial<Record<CraftTemplateRole, string>>;
  setupPlanKey?: string;
};

const VIEW_NAMES: Record<TemplateLanguage, { board: string; byArea: string; active: string }> = {
  en: { board: "Board", byArea: "By Area", active: "Active" },
  "zh-CN": { board: "看板", byArea: "按领域", active: "进行中" },
};

const PROJECT_STATES = ["planned", "active", "paused", "completed", "canceled"] as const;
const AREA_STATES = ["active", "inactive"] as const;
const TASK_STATES: readonly TaskState[] = ["todo", "doing", "waiting", "done", "canceled"];

export type CraftKnowledgeAdapter = KnowledgeBackendPort & {
  /** Which grant root a Task falls under: `inbox`, `daily-notes/<date>` or a document root ID. */
  containerOf(ref: TaskRef, mode?: "fresh" | "cached"): Promise<Result<CraftTaskContainer>>;
};

const TAG_STATES = ["doing", "waiting"] as const;
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const LINE_PREFIX = /^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX-]\]\s*)?/;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_LISTING_PAGES = 25;
const READ_BATCH = 20;
const FOLDER_TREE_TTL_MS = 60_000;
const MAX_CHILD_PAGES = 100;

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

function todayIn(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseActionLine(markdown: string): { title: string; tagState?: "doing" | "waiting" } {
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

function parseTaskListing(text: string): ListedTask[] {
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
  const visit = (entry: CraftBlock): void => {
    hash.update(JSON.stringify([entry.id, entry.metadata?.lastModifiedAt, entry.markdown, entry.properties, entry.taskInfo]));
    for (const child of entry.content ?? []) visit(child);
  };
  visit(block);
  return "sha256:" + hash.digest("hex");
}

function bodyOf(block: CraftBlock): string {
  return (block.content ?? []).map(child => [child.markdown ?? "", bodyOf(child)].filter(Boolean).join("\n\n")).join("\n\n");
}

const tableDivider = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.trim());
}

function tableLength(lines: string[]): number {
  if (!lines[0]?.includes("|") || !tableDivider.test(lines[1] ?? "")) return 0;
  let end = 2;
  while (lines[end]?.includes("|")) end++;
  return end;
}

function matchesBody(children: CraftBlock[], text: string, followingSiblings = false): boolean {
  let remaining = craftBodyMarkdown(text).trim();
  for (const child of children) {
    if (followingSiblings && !remaining) return true;
    const chunk = [child.markdown ?? "", bodyOf(child)].filter(Boolean).join("\n\n").trim();
    const lines = remaining.split("\n");
    const first = lines[0] ?? "";
    const item = first.match(/^\s*([-+*]|\d+\.)\s+/);
    const heading = first.match(/^(#{1,4})\s/);
    if (item) {
      const style = item[1] === "+" ? "toggle" : /^\d/.test(item[1]!) ? "numbered" : "bullet";
      if (child.listStyle !== style || child.type !== "text") return false;
      const body = first.slice(item[0].length);
      if (chunk.replace(/^(?:[-+*]|\d+\.)\s+/, "") !== body) return false;
      remaining = lines.slice(1).join("\n").trimStart();
      continue;
    }
    if (heading && child.textStyle !== `h${heading[1]!.length}`) return false;
    const rows = tableLength(lines);
    if (rows) {
      const actual = chunk.split("\n");
      if (child.type !== "table" || actual.length !== rows) return false;
      for (const [i, row] of actual.entries()) {
        const cells = (line: string) => tableCells(line).map(cell =>
          i === 1 ? cell.replace(/^(:?)-+(:?)$/, "$1-$2") : cell);
        if (JSON.stringify(cells(row)) !== JSON.stringify(cells(lines[i]!))) return false;
      }
      remaining = lines.slice(rows).join("\n").replace(/^(?:\r?\n)+/, "");
    } else {
      if (!chunk || !remaining.startsWith(chunk)) return false;
      if (child.type === "text" && !/^(`{3,}|~{3,})/.test(chunk)) {
        const lines = chunk.split("\n");
        if (lines.some(line => tableDivider.test(line)) || lines.slice(1).some(line => /^\s*(?:[-+*]|\d+\.|#{1,4})\s/.test(line))) return false;
      }
      remaining = remaining.slice(chunk.length);
      if (remaining && !/^\r?\n/.test(remaining)) return false;
      remaining = remaining.replace(/^(?:\r?\n)+/, "");
    }
  }
  return !remaining;
}

function contentCoverage(block: CraftBlock): "complete" | "partial" {
  return (block.content ?? []).some(child => child.type === "collection" || contentCoverage(child) === "partial") ? "partial" : "complete";
}

/** Raw body operations must not create native Tasks. Code fences are literal text. */
function containsTaskSyntax(markdown: string): boolean {
  let fence = "";
  for (const line of markdown.split(/\r?\n/)) {
    const state = nextFenceState(fence, line);
    if (state.insideFence) {
      fence = state.nextFence;
      continue;
    }
    if (/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[ xX-]\]/.test(line)) return true;
    if (/<[^>]*\b(?:listStyle|taskInfo)\s*[:=]/i.test(line)) return true;
  }
  return false;
}

function checkProse(markdown: string): Result<void> {
  return containsTaskSyntax(craftBodyMarkdown(markdown))
    ? failure("invalid", "Prose cannot create native Task blocks.", "Use tasks.create for accepted actions, or plain ☐ / ☑ text for quoted checkboxes.")
    : { ok: true, value: undefined, limits: [] };
}

export function createCraftAdapter(options: CraftAdapterOptions): CraftKnowledgeAdapter {
  const { connection, backendId } = options;
  const originalWrites = serialQueue();
  const dailyWrites = serialQueue();
  let spaceCache: CraftSpace | null = null;

  async function space(): Promise<Result<CraftSpace>> {
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

  async function appendChildPages(block: CraftBlock, command: string, cursor: string | undefined): Promise<Result<CraftBlock>> {
    for (let page = 0; cursor; page++) {
      if (page >= MAX_CHILD_PAGES) return failure("unavailable", `The block has more than ${MAX_CHILD_PAGES * 50} direct children.`, "Split the page; GPK reads at most that many blocks of one page.");
      const next = await readJson<{ data?: CraftBlock[]; nextCursor?: string }>(`${command} --cursor ${cursor}`);
      if (!next.ok) return next;
      (block.content ??= []).push(...(next.value.data?.[0]?.content ?? []));
      cursor = next.value.nextCursor;
    }
    return { ok: true, value: block, limits: [] };
  }

  async function readWhole(target: string, depth: number, metadata = true): Promise<Result<CraftBlock | null>> {
    const command = `blocks get ${target} --depth ${depth} --format json${metadata ? " --fetchMetadata" : ""}`;
    const read = await readJson<{ data?: CraftBlock[]; nextCursor?: string }>(command);
    if (!read.ok) return read;
    const block = read.value.data?.[0];
    if (!block) return { ok: true, value: null, limits: [] };
    return appendChildPages(block, command, read.value.nextCursor);
  }

  async function readBlock(id: string, depth: number): Promise<Result<CraftBlock>> {
    const read = await readWhole(`--id ${id}`, depth);
    if (!read.ok) {
      return read.error.code === "not-found" || read.error.code === "invalid"
        ? failure("not-found", "No block with this ID is readable in the space.", "Re-resolve the reference; it may have been deleted.")
        : read;
    }
    if (!read.value) return failure("not-found", "No block with this ID is readable in the space.", "Re-resolve the reference; it may have been deleted.");
    return depth > 0 ? hydrate(read.value) : { ok: true, value: read.value, limits: [] };
  }

  async function hydrate(block: CraftBlock, ancestors = new Set<string>(), budget = { remaining: 5000 }): Promise<Result<CraftBlock>> {
    if (ancestors.has(block.id) || ancestors.size >= 30 || --budget.remaining < 0) return failure("unavailable", "Nested content exceeded the read budget or contains a cycle.", "Narrow the record before relying on complete content.");
    const chain = new Set([...ancestors, block.id]);
    for (let i = 0; i < (block.content ?? []).length; i++) {
      let child = block.content![i]!;
      if (child.type === "page" || child.content?.length || child.nextCursor) {
        const full = await readWhole(`--id ${child.id}`, 1);
        if (!full.ok) return full;
        if (!full.value) return failure("unavailable", `Nested block ${child.id} was unreadable.`, "Read the record again before changing it.");
        child = full.value;
        const nested = await hydrate(child, chain, budget); if (!nested.ok) return nested;
        block.content![i] = nested.value;
      }
    }
    return { ok: true, value: block, limits: [] };
  }

  async function readBlocks(ids: string[], depth: number): Promise<Result<Map<string, CraftBlock>>> {
    const blocks = new Map<string, CraftBlock>();
    if (!ids.length) return { ok: true, value: blocks, limits: [] };
    for (let start = 0; start < ids.length; start += READ_BATCH) {
      const batch = ids.slice(start, start + READ_BATCH);
      const result = await connection.read(batch.map(id => `blocks get --id ${id} --depth ${depth} --format json --fetchMetadata`).join("; "));
      if (!result.ok) return result;
      const paged: { block: CraftBlock; cursor: string }[] = [];
      for (const segment of result.value.split(/\n\s*\n(?=\{)/)) {
        try {
          const parsed = JSON.parse(segment.trim()) as { data?: CraftBlock[]; nextCursor?: string };
          const block = parsed.data?.[0];
          if (!block) continue;
          blocks.set(block.id.toLowerCase(), block);
          if (parsed.nextCursor) paged.push({ block, cursor: parsed.nextCursor });
        } catch { /* unreadable segment stays omitted */ }
      }
      for (const { block, cursor } of paged) {
        const whole = await appendChildPages(block, `blocks get --id ${block.id} --depth ${depth} --format json --fetchMetadata`, cursor);
        if (!whole.ok) blocks.delete(block.id.toLowerCase());
      }
      if (depth > 0) for (const id of batch) {
        const block = blocks.get(id.toLowerCase());
        if (!block) continue;
        const full = await hydrate(block);
        if (!full.ok) blocks.delete(id.toLowerCase());
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
    return { ref, value: toTask(block, container, ref.scope), version: digestOf(block), coverage: contentCoverage(block) };
  }

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

  async function projectOwners(host: { collectionId: string; rootId: string }): Promise<Result<Map<string, string>>> {
    const items = await collectionOps.listItems(host.collectionId);
    if (!items.ok) return items;
    const blocks = await readBlocks(items.value.map(item => item.id), 1);
    if (!blocks.ok) return blocks;
    const owners = new Map<string, string>();
    for (const item of items.value) {
      const block = blocks.value.get(item.id.toLowerCase());
      if (!block) return failure("unavailable", `Project ${item.id} could not be read to establish Task ownership.`, "Retry the Project read before relying on this Task inventory.");
      for (const child of block.content ?? []) if (child.listStyle === "task") owners.set(child.id.toLowerCase(), item.id);
    }
    return { ok: true, value: owners, limits: [] };
  }

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

  const containerHints = new Map<string, CraftTaskContainer>();
  function remember(tasksSeen: ListedTask[]): void {
    for (const task of tasksSeen) if (task.container.key !== "unknown") containerHints.set(task.id.toLowerCase(), task.container);
  }

  async function listTasks(scope: "all" | "active" | "upcoming" | "inbox" = "all"): Promise<Result<{ tasks: ListedTask[]; complete: boolean }>> {
    const tasksSeen: ListedTask[] = [];
    let command = `tasks list --scope ${scope}`;
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
      const next = listing.value.match(/^Next page: (tasks list --scope \w+ --cursor \S+)\s*$/m)?.[1];
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

  async function verifyHint(ref: TaskRef, hint: CraftTaskContainer, mode: "fresh" | "cached"): Promise<boolean> {
    if (hint.kind === "project" && hint.projectId) {
      const host = await projectsHost();
      if (!host.ok || !host.value || host.value.collectionId.toLowerCase() !== hint.key.toLowerCase()) return false;
      const member = await collectionOps.isRow(host.value.collectionId, hint.projectId, mode);
      if (!member.ok || !member.value) return false;
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

  async function containerOf(ref: TaskRef, mode: "fresh" | "cached" = "fresh"): Promise<Result<CraftTaskContainer>> {
    const hint = containerHints.get(ref.id.toLowerCase());
    if (hint && await verifyHint(ref, hint, mode)) return { ok: true, value: hint, limits: [] };
    const all = await listTasks();
    if (!all.ok) return all;
    const found = all.value.tasks.find(task => task.id.toLowerCase() === ref.id.toLowerCase());
    if (!found) {
      return all.value.complete
        ? failure("not-found", "The Task is not present in the space task listing.", "Re-resolve the Task; it may have been deleted or moved out of scope.", [ref])
        : failure("unavailable", `The space task listing exceeded ${MAX_LISTING_PAGES} pages before the Task was found.`, "Narrow the space or retry later; the Task's container could not be established.", [ref]);
    }
    return refineContainer(ref, found.container);
  }

  /** Enforce runtime-resolved grants against a Craft container. */
  async function authorize(guard: GrantedWriteGuard, operations: string | readonly string[], container: CraftTaskContainer, target?: Ref): Promise<Result<ControlGrant>> {
    const scoped = await space();
    if (!scoped.ok) return scoped;
    const wanted = typeof operations === "string" ? [operations] : operations;
    const match = guard.grants.find(grant => {
      if (grant.backendId !== backendId) return false;
      if (guard.unattended && !grant.unattended) return false;
      if (!wanted.some(op => grant.operations.includes(op))) return false;
      if (grant.root.scope.toLowerCase() !== scoped.value.id.toLowerCase()) return false;
      const rootId = grant.root.id.toLowerCase();
      const key = container.key.toLowerCase();
      return rootId === key || (rootId === "daily-notes" && container.kind === "daily-note");
    });
    if (!match) {
      return failure("unauthorized", `No grant covers ${wanted[0]} on ${container.key}.`, "Open the GPK console via gpk_setup_open to sync workspace permissions, or verify the target belongs to GPK's bound containers.", target ? [target] : []);
    }
    return { ok: true, value: match, limits: [] };
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

  async function authorizeRoot(guard: GrantedWriteGuard, operation: string, rootId: string, target?: Ref): Promise<Result<ControlGrant>> {
    return authorize(guard, operation, { key: rootId, kind: "document", rootId }, target);
  }

  function planEdits(block: CraftBlock, edits: TextEdit[], target: Ref): Result<CraftEdits> {
    const children = (block.content ?? []).filter(child => child.type === "text" && child.listStyle !== "task");
    const plans: CraftEdits = new Map();
    for (const edit of edits) {
      if (!edit.before) return failure("invalid", "TextEdit.before must be nonempty.", "Supply the exact text to replace.");
      if (edit.after.includes("file://")) return failure("unsupported", "Local files are copied only when a record or Project material is created, not by an edit.", "Add the file as new Project material, or report it as not transferred.");
      const prose = checkProse(edit.after); if (!prose.ok) return prose;
      const hits = children.filter(child => (plans.get(child.id)?.text ?? child.markdown ?? "").includes(edit.before));
      if (hits.length !== 1) return failure("conflict", hits.length ? "The text occurs in more than one block." : "The text was not found in the body.", "Read the record again and choose a unique fragment within one block.", [target]);
      const child = hits[0]!;
      const working = plans.get(child.id)?.text ?? child.markdown ?? "";
      if (working.split(edit.before).length !== 2) return failure("conflict", "The text occurs more than once within the block.", "Choose a longer, unique fragment.", [target]);
      const updated = working.replace(edit.before, () => edit.after);
      const combined = checkProse(updated); if (!combined.ok) return combined;
      plans.set(child.id, { text: updated, previousList: child.listStyle });
    }
    return { ok: true, value: plans, limits: [] };
  }

  async function writeEdits(plans: CraftEdits): Promise<Result<void>> {
    const single: { id: string; markdown: string }[] = [];
    const multi: { id: string; markdown: string }[] = [];
    for (const [id, { text, previousList }] of plans) {
      const markdown = craftBodyMarkdown(previousList && previousList !== "none" ? text.replace(LINE_PREFIX, "") : text);
      (markdown.includes("\n") ? multi : single).push({ id, markdown });
    }
    if (single.length > 1) {
      const written = await connection.write(`blocks update --json '${jsonArgument(single)}'`);
      if (!written.ok) return written;
    } else if (single.length === 1) multi.unshift(single[0]!);
    for (const { id, markdown } of multi) {
      const written = await connection.write(`blocks update --id ${id} --markdown ${markdownArgument(markdown)}`);
      if (!written.ok) return written;
    }
    return { ok: true, value: undefined, limits: [] };
  }

  function editsApplied(after: CraftBlock, plans: CraftEdits): boolean {
    const children = after.content ?? [];
    for (const [id, { text, previousList }] of plans) {
      const index = children.findIndex(child => child.id.toLowerCase() === id.toLowerCase());
      if (index < 0) return false;
      const first = children[index]!;
      if (previousList && previousList !== "none" && first.listStyle !== previousList) return false;
      if (!text.trim()) { if (first.markdown?.trim()) return false; continue; }
      if (!matchesBody(children.slice(index), text, true)) return false;
    }
    return true;
  }

  type BodyPlan = { segments: ({ text: string } | { file: LocalFile })[]; media: number; credentials: UploadCredentials | null };

  /** Split a body at non-fenced local file lines and check every file and the upload route, writing nothing. */
  async function planBody(markdown: string): Promise<Result<BodyPlan>> {
    const prose = checkProse(markdown); if (!prose.ok) return prose;
    const segments: BodyPlan["segments"] = [];
    const references: { index: number; reference: string }[] = [];
    let text: string[] = [];
    let fence = "";
    for (const line of markdown.split("\n")) {
      const state = nextFenceState(fence, line);
      if (state.insideFence) {
        fence = state.nextFence;
        text.push(line);
        continue;
      }
      const match = line.match(LOCAL_MEDIA_LINE);
      if (!match) {
        if (line.includes("file://")) return failure("invalid", "A local file reference must be alone on its line as ![alt](file:///…) or [name](file:///…).", "Put each local image or attachment on its own line.");
        text.push(line);
        continue;
      }
      if (text.join("\n").trim()) segments.push({ text: text.join("\n") });
      text = [];
      references.push({ index: segments.length, reference: (match[3] ?? match[4])! });
      segments.push({ text: "" });
    }
    if (text.join("\n").trim()) segments.push({ text: text.join("\n") });
    if (!references.length) return { ok: true, value: { segments: [{ text: markdown }], media: 0, credentials: null }, limits: [] };
    if (!options.media || !options.uploads) return failure("unsupported", "Copying local files is not available in this runtime.", "Leave the files out and report them as not transferred.");
    const config = await options.media(); if (!config.ok) return config;
    if (!config.value.credentials) return failure("unavailable", "No Craft API connection is set up for copying local files.", "Ask the user to connect the Craft API URL in the GPK Configuration console (gpk open).");
    for (const { index, reference } of references) {
      const checked = await checkLocalFile(reference, config.value.roots, { unrestricted: config.value.unrestricted, disallowedRoots: config.value.disallowedRoots });
      if (!checked.ok) return checked;
      segments[index] = { file: checked.value };
    }
    return { ok: true, value: { segments, media: references.length, credentials: config.value.credentials }, limits: [] };
  }

  async function writeBody(pageId: string, markdown: string, expected?: Version): Promise<Result<{ media: number; mediaVersion?: Version }>> {
    const plan = await planBody(markdown); if (!plan.ok) return plan;
    let initialVersion = expected;
    const readBeforeAppend = async (): Promise<Result<CraftBlock>> => {
      const current = await readBlock(pageId, 1);
      if (current.ok && initialVersion !== undefined) {
        if (digestOf(current.value) !== initialVersion || sourceRecoveryBlocks(current.value).length) {
          return failure("conflict", "The record changed during recovery.", "Read the record again.");
        }
        initialVersion = undefined;
      }
      return current;
    };
    const order: string[] = [];
    const textRevisions = new Map<string, Version>();
    const appendText = async (text: string): Promise<Result<void>> => {
      const before = await readBeforeAppend(); if (!before.ok) return before;
      const ids = new Set((before.value.content ?? []).map(child => child.id));
      const written = await connection.write(`blocks add --id ${pageId} --markdown ${markdownArgument(craftBodyMarkdown(text))}`);
      if (!written.ok) return written;
      const after = await readBlock(pageId, 1); if (!after.ok) return after;
      const added = (after.value.content ?? []).filter(child => !ids.has(child.id));
      if (!matchesBody(added, text)) return failure("uncertain", "Read-back did not verify the appended body text.", "Inspect the record and compare the provider's rendering before retrying; the append may have occurred.", [{ scope: spaceCache?.id ?? "", id: pageId }]);
      if (expected !== undefined && plan.value.media) {
        for (const block of added) {
          order.push(block.id.toLowerCase());
          textRevisions.set(block.id.toLowerCase(), digestOf(block));
        }
      }
      return { ok: true, value: undefined, limits: [] };
    };
    if (!plan.value.media) {
      const written = await appendText(markdown);
      return written.ok ? { ok: true, value: { media: 0 }, limits: [] } : written;
    }
    const segments = plan.value.segments;
    const media = segments.filter(segment => "file" in segment);
    const credentials = plan.value.credentials!;
    const uploaded: string[] = [];
    let written = 0;
    const partial = (error: Failure, done: string): Result<never> => ({ ok: false, error: { ...error, code: written ? "partial" : error.code, affected: [{ scope: spaceCache?.id ?? "", id: pageId }], next: written ? `${done} ${error.next}` : error.next } });
    for (const segment of segments) {
      const done = `The body was written up to the item before this one (${uploaded.length} of ${media.length} files copied).`;
      if ("text" in segment) {
        const added = await appendText(segment.text);
        if (!added.ok) return partial(added.error, done);
      } else {
        const bytes = await readLocalFile(segment.file); if (!bytes.ok) return partial(bytes.error, done);
        if (initialVersion !== undefined) {
          const before = await readBeforeAppend(); if (!before.ok) return before;
        }
        const sent = await options.uploads!.upload(credentials, { bytes: bytes.value, contentType: segment.file.contentType, fileName: segment.file.fileName }, pageId);
        if (!sent.ok) return partial(sent.error, done);
        uploaded.push(sent.value.blockId.toLowerCase());
        if (expected !== undefined) order.push(sent.value.blockId.toLowerCase());
      }
      written++;
    }
    const after = await readBlock(pageId, 1);
    if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "The body was written; read it back to confirm the copied files." } };
    const present = new Set((after.value.content ?? []).filter(child => child.type === "image" || child.type === "file" || child.type === "video").map(child => child.id.toLowerCase()));
    const missing = uploaded.filter(id => !present.has(id));
    if (missing.length) return failure("uncertain", `${missing.length} of ${uploaded.length} copied files are not in the page on read-back.`, "Read the record and compare it with the source before retrying.");
    if (expected !== undefined) {
      const children = sourceRecoveryBlocks(after.value);
      if (children.length !== order.length || children.some((block, index) => {
        const key = block.id.toLowerCase();
        return key !== order[index] || (textRevisions.has(key) && textRevisions.get(key) !== digestOf(block));
      })) {
        return failure("uncertain", "The recovered body changed during the upload.", "Compare the existing Source and its attachments before retrying.");
      }
    }
    debug("craft", "body-media", { pageId, files: uploaded.length, segments: segments.length });
    return { ok: true, value: { media: uploaded.length, mediaVersion: digestOf(after.value) }, limits: [] };
  }

  async function attachOriginal(ref: Ref, reference: string, expected: Version): Promise<Result<WriteReceipt>> {
    if (!options.media || !options.uploads) return failure("unsupported", "Original uploads are unavailable.", "Use a runtime with Craft uploads.");
    const config = await options.media(); if (!config.ok) return config;
    if (!config.value.credentials) return failure("unavailable", "Craft uploads are not connected.", "Connect the Craft API URL in the GPK Configuration console (gpk open), then retry this Source.");
    const file = await checkLocalFile(reference, config.value.roots, { unrestricted: config.value.unrestricted, disallowedRoots: config.value.disallowedRoots }); if (!file.ok) return file;
    const bytes = await readLocalFile(file.value); if (!bytes.ok) return bytes;
    const marker = "Original SHA-256: " + createHash("sha256").update(bytes.value).digest("hex");
    const slots = (block: CraftBlock) => (block.content ?? []).filter(child =>
      child.type === "page" && child.content?.some(line => line.type === "text" && line.markdown === marker));
    const inspect = async () => readBlock(ref.id, 1);
    let current = await inspect(); if (!current.ok) return current;
    if (digestOf(current.value) !== expected) return failure("conflict", "The Source changed.", "Read the Source again.", [ref]);
    let createdSlot = false;
    if (!slots(current.value).length) {
      const page = { type: "page", markdown: "Original file · " + file.value.fileName.replace(/[\r\n<>]/g, " "), content: [{ type: "text", markdown: marker }] };
      const added = await connection.write(`blocks add --id ${ref.id} --json '${jsonArgument([page])}'`); if (!added.ok) return added;
      createdSlot = true;
      current = await inspect(); if (!current.ok) return current;
    }
    const candidates = slots(current.value);
    if (candidates.length !== 1) return failure("uncertain", "The original file location is ambiguous.", "Inspect the existing Source before retrying.", [ref]);
    const slot = candidates[0]!;
    const assets = (block: CraftBlock) => (block.content ?? []).filter(child => ["file", "image", "video"].includes(child.type));
    const previous = assets(slot);
    if (previous.length > 1) return failure("conflict", "The original file location has multiple attachments.", "Inspect them before retrying.", [ref]);
    if (!previous.length) {
      const sent = await options.uploads.upload(config.value.credentials, { bytes: bytes.value, fileName: file.value.fileName, contentType: file.value.contentType }, slot.id);
      if (!sent.ok) {
        return createdSlot
          ? { ok: false, error: { ...sent.error, code: sent.error.code === "uncertain" ? "uncertain" : "partial", affected: [ref], next: `The Original file slot page was created on the Source, so read the Source again for its new version before retrying: ${sent.error.next}` } }
          : sent;
      }
      current = await inspect(); if (!current.ok) return current;
      const confirmed = slots(current.value);
      if (confirmed.length !== 1 || assets(confirmed[0]!).length !== 1 || assets(confirmed[0]!)[0]!.id.toLowerCase() !== sent.value.blockId.toLowerCase()) {
        return failure("uncertain", "The uploaded original was not verified.", "Read and retry the same Source.", [ref]);
      }
    }
    return { ok: true, value: { affected: [ref], verified: true, version: digestOf(current.value) }, limits: [] };
  }

  const ctx: CraftContext = {
    attachOriginal: (ref, reference, expected) => originalWrites(() => attachOriginal(ref, reference, expected)),
    connection, backendId, space, readJson, readBlock, readBlocks, digestOf, bodyOf, matchesBody, contentCoverage, authorizeRoot, planEdits, writeEdits, editsApplied, writeBody,
    checkProse,
    checkBody: async markdown => { const plan = await planBody(markdown); return plan.ok ? { ok: true, value: undefined, limits: [] } : plan; },
    layout: async () => options.layout ? options.layout() : { ok: true, value: null, limits: [] },
    today: () => todayIn(spaceCache?.timezone ?? "UTC"),
    async folderWithDescendants(folderId, refresh) {
      if (refresh) folderTreeCache = null;
      const tree = await folderTree();
      if (!tree.ok) return tree;
      const ids = [folderId];
      for (let i = 0; i < ids.length; i++) for (const folder of tree.value) if (folder.parentId?.toLowerCase() === ids[i]!.toLowerCase()) ids.push(folder.id);
      return { ok: true, value: ids, limits: [] };
    },
    hostRoot: async () => { const host = await projectsHost(); return host.ok ? { ok: true, value: host.value?.rootId ?? null, limits: [] } : host; },
    taskContainer: ref => containerOf(ref),
    authorizeContainer: (guard, operation, container, target) => authorize(guard, operation, container, target),
  };
  const collectionOps = createCollectionOperations(ctx);
  const documentOps = createDocumentOperations(ctx, collectionOps);
  ctx.relatedIds = ref => documentOps.relatedIds(ref as Parameters<typeof documentOps.relatedIds>[0]);

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
      const container = await containerOf(ref, "cached");
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
      const key = JSON.stringify(["tasks", scoped.value.id, query.states ?? null, query.project ?? "any", query.time ?? null, query.text ?? null, query.relatedTo ?? null]);
      const cursor = readCursor(query.cursor, key); if (!cursor.ok) return cursor;
      const offset = cursor.value.offset;
      const host = await projectsHost();
      if (!host.ok) return host;
      const limits: string[] = [];
      let candidates: ListedTask[];
      const containers = new Map<string, CraftTaskContainer>();
      if (query.project) {
        if (!host.value) return failure("unavailable", "The Projects Collection is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
        if (query.project.scope !== scoped.value.id) return failure("invalid", "The Project belongs to another space.", "Resolve the Project in this space.");
        const item = await collectionOps.readItem(query.project, host.value.collectionId, "Project", "cached");
        if (!item.ok) return item;
        candidates = (item.value.content ?? []).filter(child => child.listStyle === "task").map(child => {
          const parsed = parseActionLine(child.markdown ?? "");
          const listed: ListedTask = { id: child.id, line: child.markdown ?? "", state: stateOf(child.taskInfo?.state, parsed.tagState), container: { key: host.value!.collectionId, kind: "project", rootId: host.value!.rootId, projectId: query.project!.id } };
          if (child.taskInfo?.scheduleDate) listed.scheduleDate = child.taskInfo.scheduleDate;
          containers.set(child.id.toLowerCase(), listed.container);
          return listed;
        });
      } else {
        const openOnly = Boolean(query.states?.length) && query.states!.every(state => state === "todo" || state === "doing" || state === "waiting");
        const datedWindow = Boolean(query.time) && !query.time!.includeUnset;
        let all: Result<{ tasks: ListedTask[]; complete: boolean }>;
        if (openOnly && datedWindow) {
          const today = todayIn(scoped.value.timezone);
          const needActive = !query.time!.from || query.time!.from <= today;
          const needUpcoming = !query.time!.to || query.time!.to > today;
          const parts = [needActive ? await listTasks("active") : null, needUpcoming ? await listTasks("upcoming") : null].filter(Boolean) as Result<{ tasks: ListedTask[]; complete: boolean }>[];
          const failed = parts.find(part => !part.ok);
          if (failed) return failed as Result<never>;
          const seen = new Set<string>();
          const merged: ListedTask[] = [];
          let complete = true;
          for (const part of parts as { ok: true; value: { tasks: ListedTask[]; complete: boolean } }[]) {
            complete &&= part.value.complete;
            for (const task of part.value.tasks) if (!seen.has(task.id.toLowerCase())) { seen.add(task.id.toLowerCase()); merged.push(task); }
          }
          all = { ok: true, value: { tasks: merged, complete }, limits: [] };
          limits.push("Open dated Tasks came from Craft's active/upcoming task scopes.");
        } else {
          all = await listTasks();
        }
        if (!all.ok) return all;
        limits.push("Discovery uses the space-wide task listing, which is not a transactional snapshot.");
        if (!all.value.complete) limits.push(`Only the first ${MAX_LISTING_PAGES} listing pages were scanned.`);
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
      if (query.time) {
        const { from, to, includeUnset } = query.time;
        candidates = candidates.filter(task => task.scheduleDate
          ? (!from || task.scheduleDate >= from) && (!to || task.scheduleDate <= to)
          : Boolean(includeUnset));
      }
      let scanned: Map<string, CraftBlock> | null = null;
      const unreadable: string[] = [];
      if (query.text) {
        const needle = query.text.toLowerCase();
        const read = await readTaskBlocks(candidates.map(task => ({ kind: "Task", scope: scoped.value.id, id: task.id }))); if (!read.ok) return read;
        scanned = read.value;
        candidates = candidates.filter(task => {
          const block = read.value.get(task.id.toLowerCase());
          if (!block) { unreadable.push(task.id); return false; }
          const matched = parseActionLine(block.markdown ?? "").title.toLowerCase().includes(needle) || bodyOf(block).toLowerCase().includes(needle);
          if (!matched && contentCoverage(block) !== "complete") unreadable.push(task.id);
          return matched;
        });
      }
      const page = candidates.slice(offset, offset + limit);
      const items: Snapshot<Task, TaskRef>[] = [];
      const refs = page.map(listed => ({ kind: "Task", scope: scoped.value.id, id: listed.id }) as TaskRef);
      const blocks = scanned ? { ok: true as const, value: scanned, limits: [] } : await readTaskBlocks(refs);
      if (!blocks.ok) return blocks;
      for (const ref of refs) {
        const block = blocks.value.get(ref.id.toLowerCase());
        if (!block) { unreadable.push(ref.id); continue; }
        items.push(snapshotOf(ref, block, containers.get(ref.id.toLowerCase())));
      }
      const next = offset + limit;
      const exhausted = next >= candidates.length;
      const incomplete = cursor.value.incomplete || !!query.relatedTo || limits.some(limit => limit.startsWith("Only the first"));
      const result = queryPage(items, key, exhausted ? undefined : next, incomplete, unreadable.map(id => ({ scope: scoped.value.id, id })));
      if (unreadable.length) limits.push(`Unreadable or partial during the query and omitted: ${unreadable.join(", ")}.`);
      return { ok: true, value: result, limits };
    },
    async create(input: TaskInput, guard) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim()) return failure("invalid", "A Task needs a nonblank title.", "Supply the action text.");
      if (!TASK_STATES.includes(input.state)) return failure("invalid", "Invalid Task state.", "Choose todo, doing, waiting, done or canceled.");
      if (/[\r\n]|#gpk\/task\//.test(input.title) || containsTaskSyntax(input.title) || containsTaskSyntax(input.content)) return failure("invalid", "Task text cannot inject a state tag or nested native Tasks.", "Use the state field and Task operations instead.");
      if (input.time !== undefined && !isValidDate(input.time)) return failure("invalid", "time must be a valid YYYY-MM-DD date.", "Correct the date.");
      if (input.content.includes("file://")) return failure("unsupported", "A Task body cannot hold copied local files.", "Put the file in the Project's material or a Source and link it from the Task.");
      const closed = input.state === "done" || input.state === "canceled";
      if (closed !== (input.history !== undefined)) return failure("invalid", closed ? `A Task is created ${input.state} only from recorded history.` : "history applies only to a done or canceled Task.", closed ? "Supply history with its origin and date, or create the Task open and transition it later." : "Remove history.");
      if (input.history && (!input.history.origin.trim() || (input.history.date !== undefined && !isValidDate(input.history.date)))) return failure("invalid", "history needs a nonblank origin, and a date when given must be a valid YYYY-MM-DD.", "Correct history.");
      if (input.history) { const prose = checkProse(input.history.origin); if (!prose.ok) return prose; }
      if (input.history && !input.project && input.history.date === undefined) return failure("invalid", "A recorded standalone Task in Craft needs history.date, because it is placed in that day's Daily Note.", "Supply the date, or record the Task under its Project.");
      const line = renderActionLine(input.title.trim(), input.state);
      let id: string | undefined;
      let container: CraftTaskContainer;
      let placement: string;
      if (input.project) {
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
        const date = input.history?.date ?? todayIn(scoped.value.timezone);
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
        const body = await writeBody(id, input.content);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected, next: "The Task exists without its body; add the body with tasks.update instead of creating again." } };
      }
      if (input.history) {
        const note = await connection.write(`blocks add --id ${id} --markdown ${JSON.stringify(`${input.state} (${input.history.date ?? "date unknown"}): recorded from ${input.history.origin.trim()}`)}`);
        if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected, next: "The Task exists without its history record; add it with tasks.update instead of creating again." } };
      }
      const verified = await verifyTask(ref, task => task.title === input.title.trim() && task.state === input.state && (input.time === undefined || task.time === input.time), "The Task was created; read it back and adjust with tasks.update.");
      if (!verified.ok) return verified;
      const receipt: CreateReceipt<TaskRef> = { ...verified.value, created: ref, affected };
      return { ok: true, value: receipt, limits: [placement] };
    },
    async update(ref, update, guard) {
      const hasEdits = Boolean(update.edits?.length);
      const hasAppend = update.append !== undefined && update.append.trim().length > 0;
      if (update.replaceContent !== undefined) return failure("unsupported", "replaceContent is not supported on Tasks.", "Use edits or append.");
      if (update.title === undefined && !hasEdits && !hasAppend) return failure("invalid", "Supply a title, edits or append.", "Nothing to change.");
      if (update.title !== undefined && !update.title.trim()) return failure("invalid", "A Task title cannot be blank.", "Supply the action text.");
      if (update.title !== undefined && (/[\r\n]|#gpk\/task\//.test(update.title) || containsTaskSyntax(update.title))) return failure("invalid", "A Task title cannot carry state encoding or extra blocks.", "Use tasks.transition to change state.");
      if (hasAppend && (update.append!.includes("file://") || !checkProse(update.append!).ok)) {
        return update.append!.includes("file://")
          ? failure("unsupported", "A Task body cannot hold copied local files.", "Put the file in a Source or Project material and link it.")
          : checkProse(update.append!) as Result<never>;
      }
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
      if (hasEdits) {
        const written = await writeEdits(plans);
        if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected, next: "Some edits were applied; read the Task back before retrying the rest." } };
      }
      if (hasAppend) {
        const appended = await writeBody(ref.id, update.append!);
        if (!appended.ok) return { ok: false, error: { ...appended.error, code: (update.title !== undefined || hasEdits) ? "partial" : appended.error.code, affected, next: "Read the Task back before retrying the append." } };
      }
      const after = await readTaskBlock(ref);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the Task back to see which edits persisted." } };
      const before = new Set((block.content ?? []).map(child => child.id));
      for (const child of after.value.content ?? []) if (!before.has(child.id)) affected.push({ scope: ref.scope, id: child.id });
      const titleOk = update.title === undefined || toTask(after.value).title === update.title.trim();
      const editsOk = !hasEdits || editsApplied(after.value, plans);
      return { ok: true, value: { affected, verified: titleOk && editsOk, version: digestOf(after.value), ...(titleOk && editsOk ? {} : { recovery: "Read the Task back and compare." }) }, limits: [] };
    },
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      if (!TASK_STATES.includes(state)) return failure("invalid", "Invalid Task state.", "Choose todo, doing, waiting, done or canceled.");
      const prose = checkProse(reason); if (!prose.ok) return prose;
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
      const prose = checkProse(reason); if (!prose.ok) return prose;
      const current = await readTaskBlock(ref);
      if (!current.ok) return current;
      const source = await containerOf(ref);
      if (!source.ok) return source;
      if (source.value.kind === "document") return failure("unsupported", "The Task lives in a document outside GPK's locations; it is not moved.", "Recreate the Task under the Project instead.", [ref]);
      const sourceGranted = await authorize(guard, "tasks.assignProject", source.value, ref);
      if (!sourceGranted.ok) return sourceGranted;
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
      const verified = after.value.key.toLowerCase() === destination.key.toLowerCase() && after.value.projectId?.toLowerCase() === destination.projectId?.toLowerCase();
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

  async function recordDaily(date: string, summary: string, related: Parameters<CaptureOperations["recordActivity"]>[2], guard: GrantedWriteGuard): Promise<Result<WriteReceipt>> {
    if (guard.expected !== undefined) return failure("unsupported", "expected revision assertions are not supported on Daily Note appends.", "Omit expected.");
    if (!isValidDate(date)) return failure("invalid", "Invalid Daily Note date.", "Supply a calendar date as YYYY-MM-DD.");
    const text = summary.trim();
    if (!text || text.length > 600 || /[\r\n<>\[\]]/.test(summary) || /^\s*(?:[-+*#>`]|\d+[.)]\s)/.test(text)) {
      return failure("invalid", "A daily entry needs a short sentence in plain text.", "Supply one line and use the related field for the record link.");
    }
    const allowedOps = (text === "Saved" && related?.kind === "Source")
      ? ["captures.recordActivity", "captures.recordSource"]
      : ["captures.recordActivity"];
    const granted = await authorize(guard, allowedOps, { key: `daily-notes/${date}`, kind: "daily-note", date }, related);
    if (!granted.ok) return granted;
    let markdown = text;
    let link = "";
    if (related) {
      const record = related.kind === "Project" ? await collectionOps.projects.read(related)
        : related.kind === "Area" ? await collectionOps.areas.read(related)
        : related.kind === "Task" ? await tasks.read(related)
        : related.kind === "Source" ? await documentOps.sources.read(related)
        : related.kind === "Wiki" ? await documentOps.wikis.read(related)
        : await documentOps.outputs.read(related);
      if (!record.ok) return record;
      link = `(block://${related.id.toLowerCase()})`;
      const title = record.value.value.title.replace(/[\[\]\\<>\r\n]/g, " ").replace(/\s+/g, " ").trim() || related.kind;
      markdown += ` [${title}]${link}`;
    }
    const lookup = async () => {
      const day = await readWhole(`--date ${date}`, 1, false);
      if (!day.ok) return day;
      const entry = day.value?.content?.find(block => block.type === "text" && block.listStyle !== "task" &&
        (link ? block.markdown?.startsWith(text + " [") && block.markdown.toLowerCase().endsWith(link) : block.markdown === text));
      return { ok: true as const, value: entry, limits: [] };
    };
    const before = await lookup();
    if (!before.ok && before.error.code !== "not-found" &&
        !(before.error.code === "invalid" && /not found|does not exist|no (?:daily )?note/i.test(before.error.message))) return before;
    let entry = before.ok ? before.value : undefined;
    if (!entry) {
      const written = await connection.write(`blocks add --date ${date} --markdown ${markdownArgument(markdown)}`);
      if (!written.ok) return written;
      const after = await lookup(); if (!after.ok) return after;
      entry = after.value;
    }
    if (!entry) return failure("uncertain", "The activity was not visible in the Daily Note.", "Retry only the entry with the same date, sentence and reference.");
    return { ok: true, value: { affected: [{ scope: granted.value.root.scope, id: entry.id }], verified: true, version: digestOf(entry) }, limits: [] };
  }

  const captures: CaptureOperations = {
    recordActivity: (date, summary, related, guard) => dailyWrites(() => recordDaily(date, summary, related, guard)),
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
      const limit = options?.limit;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
        return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      }
      const key = JSON.stringify(["captures", surface.scope, surface.id]);
      const cursor = readCursor(options?.cursor, key);
      if (!cursor.ok) return cursor;
      const { offset, incomplete } = cursor.value;
      function page(items: Snapshot<Capture, CaptureRef>[], complete: boolean) {
        const end = limit === undefined ? items.length : offset + limit;
        return queryPage(items.slice(offset, end), key, end < items.length ? end : undefined, incomplete || !complete, []);
      }
      if (surface.id === "inbox") {
        const listing = await listTasks("inbox");
        if (!listing.ok) return listing;
        const items = listing.value.tasks.map(task => ({
          ref: { scope: scoped.value.id, id: task.id, role: "capture" as const, surface },
          value: { content: task.line }, coverage: "complete" as const,
        }));
        return { ok: true, value: page(items, listing.value.complete), limits: ["Craft's Inbox holds task blocks only; each item is its action line.", ...(listing.value.complete ? [] : [`Inbox traversal stopped after ${MAX_LISTING_PAGES} pages.`])] };
      }
      const date = surface.id.match(/^daily-notes\/(\d{4}-\d{2}-\d{2})$/)?.[1];
      if (!date || !isValidDate(date)) return failure("invalid", "Unknown capture surface.", "Resolve the surface first.");
      const read = await readWhole(`--date ${date}`, 1, false);
      if (!read.ok) return read;
      const root = read.value;
      if (!root) return failure("not-found", `No Daily Note exists for ${date}.`, "Choose a date with a Daily Note.");
      const items = (root.content ?? []).map(child => ({
        ref: { scope: scoped.value.id, id: child.id, role: "capture" as const, surface },
        value: { content: child.markdown ?? "" },
        coverage: (child.content?.length ? "partial" : "complete") as "partial" | "complete",
      }));
      return { ok: true, value: page(items, true), limits: ["Top-level blocks of the Daily Note; nested content needs captures.read."] };
    },
    async read(ref: CaptureRef) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (ref.scope !== scoped.value.id || !ref.surface || ref.surface.scope !== scoped.value.id || !UUID.test(ref.id)) {
        return failure("invalid", "The capture reference or its surface is not in this space.", "List the surface again.", [ref]);
      }
      // Verify surface membership before reading the block so forged CaptureRefs cannot read arbitrary blocks.
      if (ref.surface.id === "inbox") {
        const listing = await listTasks("inbox");
        if (!listing.ok) return listing;
        const present = listing.value.tasks.some(task => task.id.toLowerCase() === ref.id.toLowerCase());
        if (!present) {
          return listing.value.complete
            ? failure("not-found", "The capture is not in the Inbox.", "List the Inbox again.", [ref])
            : failure("unavailable", "Inbox membership could not be established within the listing cap.", "Clear or narrow the Inbox.", [ref]);
        }
      } else {
        const date = ref.surface.id.match(/^daily-notes\/(\d{4}-\d{2}-\d{2})$/)?.[1];
        if (!date || !isValidDate(date)) return failure("invalid", "Unknown capture surface.", "Resolve the surface first.", [ref]);
        const day = await readWhole(`--date ${date}`, 1, false);
        if (!day.ok) return day;
        if (!day.value) return failure("not-found", `No Daily Note exists for ${date}.`, "Choose a date with a Daily Note.", [ref]);
        if (!(day.value.content ?? []).some(child => child.id.toLowerCase() === ref.id.toLowerCase())) {
          return failure("not-found", `The capture block is not on the Daily Note for ${date}.`, "List that Daily Note again.", [ref]);
        }
      }
      const read = await readBlock(ref.id, 1);
      if (!read.ok) return read.error.code === "invalid" ? failure("not-found", "The capture block is not readable.", "List the surface again.", [ref]) : read;
      const block = read.value;
      if (!block) return failure("not-found", "The capture block is not readable.", "List the surface again.", [ref]);
      const content = [block.markdown ?? "", bodyOf(block)].filter(Boolean).join("\n\n");
      return { ok: true, value: { ref, value: { content }, version: digestOf(block), coverage: contentCoverage(block) }, limits: contentCoverage(block) === "partial" ? ["Nested native Collections need a separate native read."] : [] };
    },
  };

  // ---------- workspace & native templates ----------
  type SchemaColumn = { key: string; name: string; type: string; options: string[]; target?: string };
  async function readSchema(collectionId: string): Promise<Result<{ title: string; columns: SchemaColumn[] }>> {
    const result = await connection.read(`collections schema --collection ${collectionId}`);
    if (!result.ok) return result;
    const columns: SchemaColumn[] = [];
    for (const line of result.value.split("\n")) {
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
  async function listFolders(): Promise<Result<LayoutInspection["candidates"]["folders"]>> {
    const folders: LayoutInspection["candidates"]["folders"] = [];
    let truncated = false;
    for (let offset = 0, page = 0; page < 20; offset += 20, page++) {
      const result = await connection.read(offset ? `folders list --offset ${offset}` : "folders list");
      if (!result.ok) return result;
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
      if (page === 19) truncated = true;
    }
    if (truncated) return failure("unavailable", "The space has more than 400 folders; complete folder discovery exceeded 20 pages.", "Reduce top-level folder count or narrow the workspace.");
    const seen = new Set<string>();
    return { ok: true, value: folders.filter(folder => !seen.has(folder.id) && seen.add(folder.id)), limits: [] };
  }

  /** List documents in Craft's native `templates` area, following pagination. */
  async function listTemplateDocuments(): Promise<Result<Map<string, { id: string; title: string }>>> {
    const map = new Map<string, { id: string; title: string }>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await connection.read(`documents list --location templates${cursor ? ` --cursor ${cursor}` : ""}`);
      if (!result.ok) return result;
      for (const line of result.value.split("\n")) {
        const m = line.match(/^\s*<([^>]+)>\s+(.*?)\s*$/);
        if (m) map.set(m[1]!.toLowerCase(), { id: m[1]!, title: m[2]! });
      }
      cursor = result.value.match(/^Next page:.*--cursor\s+(\S+)\s*$/m)?.[1];
      if (!cursor) return { ok: true, value: map, limits: [] };
    }
    return failure("unavailable", "The Templates listing exceeded 20 pages.", "Clean up unused templates before retrying.");
  }

  const childPage = (block: CraftBlock, title: string) => (block.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === title) ?? null;

  async function readLayoutRecord(hostRoot: string): Promise<LayoutRecord | null> {
    const root = await readBlock(hostRoot, 1); if (!root.ok) return null;
    const system = childPage(root.value, SYSTEM_TITLE); if (!system) return null;
    const systemBlock = await readBlock(system.id, 1); if (!systemBlock.ok) return null;
    const entry = childPage(systemBlock.value, LAYOUT_RECORD); if (!entry) return null;
    const block = await readBlock(entry.id, 1); if (!block.ok) return null;
    try {
      const children = block.value.content ?? [];
      for (let i = children.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse((children[i]!.markdown ?? "").trim()) as LayoutRecord;
          if (parsed && parsed.version === 1) return parsed;
        } catch { /* check earlier block if present */ }
      }
      const joined = JSON.parse(children.map(child => child.markdown ?? "").join("").trim()) as LayoutRecord;
      return joined && joined.version === 1 ? joined : null;
    } catch { return null; }
  }

  async function writeLayoutRecord(hostRoot: string, record: LayoutRecord): Promise<string | null> {
    const root = await readBlock(hostRoot, 1); if (!root.ok) return root.error.message;
    let systemId = childPage(root.value, SYSTEM_TITLE)?.id;
    if (!systemId) {
      const added = await connection.write(`blocks add --id ${hostRoot} --json '${jsonArgument([{ type: "page", markdown: SYSTEM_TITLE, content: [{ type: "text", markdown: "GPK keeps processing checkpoints here; the Agent reads and writes them." }] }])}'`);
      if (!added.ok) return added.error.message;
      systemId = added.value.match(/IDs: <([^>]+)>/)?.[1];
      if (!systemId) return "Craft did not report the GPK System page.";
    }
    const system = await readBlock(systemId, 1); if (!system.ok) return system.error.message;
    let entryId = childPage(system.value, LAYOUT_RECORD)?.id;
    let previousIds: string[] = [];
    if (entryId) {
      const current = await readBlock(entryId, 1); if (!current.ok) return current.error.message;
      previousIds = (current.value.content ?? []).map(child => child.id);
    } else {
      const added = await connection.write(`blocks add --id ${systemId} --json '${jsonArgument([{ type: "page", markdown: LAYOUT_RECORD, content: [] }])}'`);
      if (!added.ok) return added.error.message;
      entryId = added.value.match(/IDs: <([^>]+)>/)?.[1];
      if (!entryId) return "Craft did not report the layout record page.";
    }
    // Append the new layout record before deleting prior blocks so a failed write never erases recovery metadata.
    const written = await connection.write(`blocks add --id ${entryId} --markdown ${JSON.stringify(JSON.stringify(record))}`);
    if (!written.ok) return written.error.message;
    if (previousIds.length) {
      await connection.write(`blocks delete --ids ${previousIds.join(",")}`);
    }
    const back = await readLayoutRecord(hostRoot);
    return JSON.stringify(back) === JSON.stringify(record) ? null : "The layout record did not verify on read-back.";
  }

  async function findExistingWorkspaces(collections: LayoutInspection["candidates"]["collections"], folders: LayoutInspection["candidates"]["folders"], scopeId: string): Promise<Result<ExistingWorkspace[]>> {
    const byDocument = new Map<string, typeof collections>();
    for (const entry of collections) byDocument.set(entry.documentId, [...(byDocument.get(entry.documentId) ?? []), entry]);
    const candidates = [...byDocument.entries()].filter(([, tables]) => tables.length >= 2);
    if (!candidates.length) return { ok: true, value: [], limits: [] };
    const trashed = await listDocumentIds("--location trash");
    if (!trashed.ok) return trashed;
    const found: ExistingWorkspace[] = [];
    for (const [documentId, tables] of candidates) {
      if (trashed.value.has(documentId.toLowerCase())) continue;
      let areas: typeof tables[number] | undefined, projects: typeof tables[number] | undefined;
      for (const table of tables) {
        if (!projects && (await checkLocation("project", { scope: "", id: table.id }, "")).status === "ok") projects = table;
        else if (!areas && (await checkLocation("area", { scope: "", id: table.id }, "")).status === "ok") areas = table;
      }
      if (!areas || !projects) continue;
      const root = await readBlock(documentId, 0);
      const record = await readLayoutRecord(documentId);
      const folder = (id: string | undefined) => { const hit = id ? folders.find(entry => entry.id.toLowerCase() === id.toLowerCase()) : undefined; return hit ? { id: hit.id, name: hit.name, documents: hit.documents } : null; };
      const source = folder(record?.sources), wiki = folder(record?.wikis), output = folder(record?.outputs);
      const templateBindings: TemplateBindingChanges = {};
      if (record?.templates) {
        for (const role of CRAFT_TEMPLATE_ROLES) {
          const tplId = record.templates[role];
          if (tplId) templateBindings[role] = { scope: scopeId, id: tplId };
        }
      }
      found.push({
        home: { id: documentId, title: root.ok ? (root.value.markdown ?? "").trim() : "" },
        areas: { id: areas.id, name: areas.name, items: areas.items },
        projects: { id: projects.id, name: projects.name, items: projects.items },
        folders: source && wiki && output ? { source, wiki, output } : null,
        ...(Object.keys(templateBindings).length ? { templates: templateBindings } : {}),
        namespace: record?.namespace ?? null,
        metadataLanguage: record?.metadataLanguage ?? null,
      });
    }
    return { ok: true, value: found, limits: [] };
  }

  async function listDocumentIds(selector: string): Promise<Result<Set<string>>> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await connection.read(`documents list ${selector}${cursor ? ` --cursor ${cursor}` : ""}`);
      if (!result.ok) return result;
      for (const m of result.value.matchAll(/^\s*<([^>]+)>/gm)) ids.add(m[1]!.toLowerCase());
      cursor = result.value.match(/^Next page:.*--cursor\s+(\S+)\s*$/m)?.[1];
      if (!cursor) break;
    }
    if (cursor) return failure("unavailable", "The document listing exceeded 20 pages.", "Narrow the listing before inferring absence.");
    return { ok: true, value: ids, limits: [] };
  }

  let folderTreeCache: { at: number; value: LayoutInspection["candidates"]["folders"] } | null = null;
  async function folderTree(): Promise<Result<LayoutInspection["candidates"]["folders"]>> {
    if (folderTreeCache && Date.now() - folderTreeCache.at < FOLDER_TREE_TTL_MS) return { ok: true, value: folderTreeCache.value, limits: [] };
    const listed = await listFolders();
    if (listed.ok) folderTreeCache = { at: Date.now(), value: listed.value };
    return listed;
  }

  async function checkLocation(role: LayoutRole, ref: Ref, scopeId: string): Promise<LayoutLocationCheck> {
    if (ref.scope !== scopeId || !ref.id || ref.id === "unset") return { role, ref, status: "unset", detail: "No location selected." };
    if (role === "project" || role === "area") {
      const schema = await readSchema(ref.id);
      if (!schema.ok) return { role, ref, status: "missing", detail: schema.error.message };
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

  const workspace: WorkspaceOperations = {
    space,
    defaultGrants(scope, locations) {
      const taskOps = ["tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject"];
      return [
        { backendId, root: { scope, id: "daily-notes" }, operations: ["captures.recordActivity", ...taskOps, "links.add"], unattended: false },
        { backendId, root: { scope, id: "inbox" }, operations: ["tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject", "links.add"], unattended: false },
        { backendId, root: { scope, id: "system" }, operations: ["checkpoints.save"], unattended: false },
        { backendId, root: locations.project, operations: ["projects.create", "projects.update", "projects.transition", "projects.assignArea", "projects.orderTasks", "projects.materials.append", "projects.materials.update", ...taskOps, "links.add"], unattended: false },
        { backendId, root: locations.area, operations: ["areas.create", "areas.update", "areas.transition", "links.add"], unattended: false },
        { backendId, root: locations.source, operations: ["sources.create", "sources.update", "links.add"], unattended: false },
        { backendId, root: locations.wiki, operations: ["wikis.create", "wikis.update", "links.add"], unattended: false },
        { backendId, root: locations.output, operations: ["outputs.create", "outputs.update", "links.add"], unattended: false },
      ];
    },
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
      const inspection: LayoutInspection = { locations: checks, candidates: { collections: collections.value, folders: folders.value } };
      if (!locations) {
        const existing = await findExistingWorkspaces(collections.value, folders.value, scoped.value.id);
        if (!existing.ok) return existing;
        inspection.existing = existing.value;
      }
      return { ok: true, value: inspection, limits: [] };
    },
    async establish(plan) {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const scopeId = scoped.value.id;
      const created: Ref[] = [];
      const adopted: Ref[] = [];
      const partial = (error: Failure, step: string): Result<never> => ({ ok: false, error: { ...error, code: created.length ? "partial" : error.code, affected: created, next: `${step} failed. ${created.length ? "Keep the created structures and rerun establish adopting them by ID." : error.next}` } });

      const setupPlanKey = createHash("sha256").update(JSON.stringify([plan.namespace ?? "root", plan.hostDocument, plan.areas, plan.projects, plan.sources, plan.wikis, plan.outputs, plan.metadataLanguage ?? "en", plan.views !== false, plan.templates !== false])).digest("hex");
      const tracking = "title" in plan.hostDocument;
      if ("title" in plan.hostDocument) {
        const tree = await listFolders(); if (!tree.ok) return tree;
        const namespace = plan.namespace ?? "root";
        const parent = namespace === "root" ? null : "folderId" in namespace ? namespace.folderId : tree.value.find(folder => folder.parentId === null && folder.name === namespace.folder)?.id;
        const listed = parent === undefined ? { ok: true as const, value: new Set<string>(), limits: [] } : await listDocumentIds(parent === null ? "--location unsorted" : `--folder ${parent}`);
        if (!listed.ok) return listed;
        const homes = await readBlocks([...listed.value], 0); if (!homes.ok) return homes;
        const title = plan.hostDocument.title;
        const matches = [...homes.value.values()].filter(block => block.markdown === title);
        if (homes.value.size !== listed.value.size) return failure("unavailable", "Some possible home documents were unreadable.", "Restore access before creating a duplicate structure.");
        if (matches.length > 1) return failure("ambiguous", "Several home documents have the requested title.", "Inspect them in Craft and choose a distinct home name.");
        if (matches.length) {
          const home = matches[0]!;
          const record = await readLayoutRecord(home.id);
          if (!record || record.setupPlanKey !== setupPlanKey) return failure("conflict", "A home document with this name already exists and is not this unfinished plan.", "Continue with the existing workspace, inspect the leftover document, or choose another home name.", [{ scope: scopeId, id: home.id }]);
          plan = {
            ...plan, hostDocument: { rootId: home.id },
            ...(record.areas ? { areas: { id: record.areas } } : {}), ...(record.projects ? { projects: { id: record.projects } } : {}),
            ...(record.sources ? { sources: { id: record.sources } } : {}), ...(record.wikis ? { wikis: { id: record.wikis } } : {}), ...(record.outputs ? { outputs: { id: record.outputs } } : {}),
            ...(record.namespace ? { namespace: { folderId: record.namespace } } : {}),
          };
        }
      }

      const adoptions: [LayoutRole, { id: string } | { name: string }][] = [
        ["area", plan.areas], ["project", plan.projects], ["source", plan.sources], ["wiki", plan.wikis], ["output", plan.outputs],
      ];
      for (const [role, choice] of adoptions) {
        if (!("id" in choice)) continue;
        const check = await checkLocation(role, { scope: scopeId, id: choice.id }, scopeId);
        if (check.status !== "ok") return failure("invalid", `${role} ${choice.id}: ${check.detail}`, "Adopt a matching Collection or folder, or create a new one by name.");
      }
      const tree = await listFolders();
      if (!tree.ok) return tree;
      const namespacePlan = plan.namespace ?? "root";
      const existingNamespace = namespacePlan === "root" ? null
        : "folderId" in namespacePlan ? tree.value.find(entry => entry.id.toLowerCase() === namespacePlan.folderId.toLowerCase()) ?? null
        : tree.value.find(entry => entry.parentId === null && entry.name === namespacePlan.folder) ?? null;
      if (namespacePlan !== "root" && "folderId" in namespacePlan && !existingNamespace) return failure("not-found", `No folder with ID ${namespacePlan.folderId}.`, "Choose an existing folder ID or a name.");
      const folderParent = namespacePlan === "root" ? null : existingNamespace?.id ?? undefined;
      const clashes = folderParent === undefined ? [] : ([["source", plan.sources], ["wiki", plan.wikis], ["output", plan.outputs]] as const)
        .flatMap(([role, choice]) => "name" in choice ? tree.value.filter(entry => entry.parentId === folderParent && entry.name === choice.name).map(entry => ({ role, name: choice.name, id: entry.id })) : []);
      if (clashes.length) {
        return failure("conflict", `${clashes.map(clash => `"${clash.name}"`).join(", ")} already ${clashes.length === 1 ? "exists" : "exist"} where GPK would create its folders. Nothing was created.`,
          "Use the existing folder, or choose another name.", clashes.map(clash => ({ scope: scopeId, id: clash.id })));
      }
      const host = plan.hostDocument;
      let hostRoot = "rootId" in host ? host.rootId : null;

      let namespaceId: string | null = null;
      if (namespacePlan !== "root") {
        if ("folderId" in namespacePlan) {
          namespaceId = existingNamespace!.id;
          adopted.push({ scope: scopeId, id: namespaceId });
        } else if (existingNamespace) {
          namespaceId = existingNamespace.id;
          adopted.push({ scope: scopeId, id: existingNamespace.id });
        } else {
          const result = await connection.write(`folders create --name ${JSON.stringify(namespacePlan.folder)}`);
          if (!result.ok) return partial(result.error, "Creating the namespace folder");
          namespaceId = result.value.match(/<([0-9a-fA-F-]{36})>/)?.[1] ?? null;
          if (!namespaceId) return partial({ code: "uncertain", message: "Craft did not report the namespace folder ID.", affected: [], next: "List folders and rerun establish with the folder ID." }, "Creating the namespace folder");
          created.push({ scope: scopeId, id: namespaceId });
        }
      }
      const inNamespace = namespaceId ? ` --folder ${namespaceId}` : "";
      const underNamespace = namespaceId ? ` --parent ${namespaceId}` : "";

      const needsHost = !("id" in plan.areas) || !("id" in plan.projects);
      if (needsHost && !hostRoot && "title" in host) {
        const result = await connection.write(`documents create --title ${JSON.stringify(host.title)}${inNamespace}`);
        if (!result.ok) return partial(result.error, "Creating the host document");
        hostRoot = result.value.match(/rootBlockId: ([0-9a-fA-F-]+)/)?.[1] ?? null;
        if (!hostRoot) return partial({ code: "uncertain", message: "Craft did not report the host document ID.", affected: [], next: "Find the document by title and rerun establish adopting it." }, "Creating the host document");
        created.push({ scope: scopeId, id: hostRoot });
      }
      const progress: LayoutRecord = {
        version: 1, areas: "id" in plan.areas ? plan.areas.id : "", projects: "id" in plan.projects ? plan.projects.id : "",
        sources: "id" in plan.sources ? plan.sources.id : "", wikis: "id" in plan.wikis ? plan.wikis.id : "", outputs: "id" in plan.outputs ? plan.outputs.id : "",
        namespace: namespaceId, metadataLanguage: plan.metadataLanguage ?? "en", setupPlanKey,
      };
      const saveProgress = async (): Promise<Result<void>> => {
        if (!tracking || !hostRoot) return { ok: true, value: undefined, limits: [] };
        const error = await writeLayoutRecord(hostRoot, progress);
        return error ? failure("uncertain", error, "Inspect the home document's GPK System page before retrying Setup.") : { ok: true, value: undefined, limits: [] };
      };
      const started = await saveProgress(); if (!started.ok) return partial(started.error, "Recording Setup progress");

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
      progress.areas = areas.value;
      const areaProgress = await saveProgress(); if (!areaProgress.ok) return partial(areaProgress.error, "Recording the Areas Collection");
      const projects = await collection("project", plan.projects, ` --Area ${JSON.stringify(`relation:${areas.value}`)}`, PROJECT_STATES);
      if (!projects.ok) return partial(projects.error, "Establishing the Projects Collection");
      progress.projects = projects.value;
      const projectProgress = await saveProgress(); if (!projectProgress.ok) return partial(projectProgress.error, "Recording the Projects Collection");

      async function folder(role: "source" | "wiki" | "output", choice: { name: string } | { id: string }): Promise<Result<string>> {
        if ("id" in choice) {
          const check = await checkLocation(role, { scope: scopeId, id: choice.id }, scopeId);
          if (check.status !== "ok") return failure("invalid", `${role} folder ${choice.id}: ${check.detail}`, "Adopt an existing folder by ID or create one by name.");
          adopted.push({ scope: scopeId, id: choice.id });
          return { ok: true, value: choice.id, limits: [] };
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
      progress.sources = sources.value;
      const sourceProgress = await saveProgress(); if (!sourceProgress.ok) return partial(sourceProgress.error, "Recording the Sources folder");
      const wikis = await folder("wiki", plan.wikis);
      if (!wikis.ok) return partial(wikis.error, "Establishing the Wikis folder");
      progress.wikis = wikis.value;
      const wikiProgress = await saveProgress(); if (!wikiProgress.ok) return partial(wikiProgress.error, "Recording the Wikis folder");
      const outputs = await folder("output", plan.outputs);
      if (!outputs.ok) return partial(outputs.error, "Establishing the Outputs folder");
      progress.outputs = outputs.value;
      const outputProgress = await saveProgress(); if (!outputProgress.ok) return partial(outputProgress.error, "Recording the Outputs folder");

      folderTreeCache = null;

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

      // Native Craft templates: installed into Craft's `templates` area and bound by ID so
      // edits made in Craft UI are read back on subsequent entity creation.
      const templates: Ref[] = [];
      const templateBindings: TemplateBindingChanges = {};
      const recordedTemplates: Partial<Record<CraftTemplateRole, string>> = {};
      if (plan.templates !== false) {
        const listed = await listTemplateDocuments();
        const byTitle = new Map<string, string>();
        if (listed.ok) {
          for (const entry of listed.value.values()) if (!byTitle.has(entry.title)) byTitle.set(entry.title, entry.id);
        }
        for (const role of CRAFT_TEMPLATE_ROLES) {
          const title = craftTemplateTitle(role);
          const existingId = byTitle.get(title);
          if (existingId) {
            const ref = { scope: scopeId, id: existingId };
            templateBindings[role] = ref;
            recordedTemplates[role] = existingId;
            adopted.push(ref);
            continue;
          }
          const createdDoc = await connection.write(`documents create --title ${JSON.stringify(title)} --destination templates`);
          const id = createdDoc.ok ? createdDoc.value.match(/rootBlockId: ([0-9a-fA-F-]+)/)?.[1] : undefined;
          if (!createdDoc.ok || !id) { limits.push(`Template "${title}" was not installed${createdDoc.ok ? "" : `: ${createdDoc.error.message}`}`); continue; }
          const body = await connection.write(`blocks add --id ${id} --markdown ${markdownArgument(craftBodyMarkdown(craftTemplateBody(role)))}`);
          if (!body.ok) limits.push(`Template "${title}" was created without its body: ${body.error.message}`);
          const ref = { scope: scopeId, id };
          templates.push(ref);
          templateBindings[role] = ref;
          recordedTemplates[role] = id;
          created.push(ref);
        }
      }

      if (hostRoot && created.some(ref => ref.id === hostRoot)) limits.push(`Host document ${hostRoot} was created to hold the Collections.`);
      if (hostRoot) {
        const recorded = await writeLayoutRecord(hostRoot, {
          version: 1, areas: areas.value, projects: projects.value, sources: sources.value, wikis: wikis.value, outputs: outputs.value,
          namespace: namespaceId, metadataLanguage,
          ...(Object.keys(recordedTemplates).length ? { templates: recordedTemplates } : {}),
        });
        if (recorded) limits.push(`The layout record was not saved on the home page: ${recorded}`);
      }
      return {
        ok: true,
        value: {
          locations: {
            area: { scope: scopeId, id: areas.value }, project: { scope: scopeId, id: projects.value },
            source: { scope: scopeId, id: sources.value }, wiki: { scope: scopeId, id: wikis.value }, output: { scope: scopeId, id: outputs.value },
          },
          templateBindings,
          created, adopted,
          namespace: namespaceId ? { scope: scopeId, id: namespaceId } : null,
          views, templates,
        },
        limits,
      };
    },
  };

  const templatesOps: KnowledgeTemplateOperations = {
    async discover(): Promise<Result<TemplateBindingChanges>> {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      const listed = await listTemplateDocuments();
      if (!listed.ok) return listed;
      const found: TemplateBindingChanges = {};
      for (const role of CRAFT_TEMPLATE_ROLES) {
        const title = craftTemplateTitle(role);
        const matches = [...listed.value.values()].filter(doc => doc.title === title);
        if (matches.length === 1) found[role] = { scope: scoped.value.id, id: matches[0]!.id };
      }
      return { ok: true, value: found, limits: [] };
    },
    async read(ref: Ref, role: TemplateRole): Promise<Result<Snapshot<BackendTemplate>>> {
      const scoped = await space();
      if (!scoped.ok) return scoped;
      if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) {
        return failure("invalid", "The template reference is not in the bound Craft space.", "Check the template binding in Settings.", [ref]);
      }
      const listed = await listTemplateDocuments();
      if (!listed.ok) return listed;
      if (!listed.value.has(ref.id.toLowerCase())) {
        return failure("not-found", `No template with ID ${ref.id} exists in Craft's Templates area.`, "Restore the template in Craft or reset to the bundled default.", [ref]);
      }
      const block = await readBlock(ref.id, 1);
      if (!block.ok) return block;
      const coverage = contentCoverage(block.value);
      const sanitized = sanitizeCraftTemplate(bodyOf(block.value), role);
      const limits = [...sanitized.limits];
      if (coverage === "partial") {
        limits.push("The template contains nested native structures that are not represented as Markdown; readable sections were kept.");
      }
      return {
        ok: true,
        value: {
          ref,
          value: { role, content: sanitized.content },
          version: digestOf(block.value),
          coverage,
        },
        limits,
      };
    },
  };

  const adapter: CraftKnowledgeAdapter = {
    capabilities: async (): Promise<Result<Capabilities>> => {
      const capabilities: Capabilities = {};
      const evidence = ["Headless MCP client against mcp.craft.do, checks dated 2026-10-09 to 2026-10-16."];
      const native = (limits: string[]): Capability => ({ mode: "native", limits, evidence });
      const emulated = (limits: string[]): Capability => ({ mode: "emulated", limits, evidence });
      Object.assign(capabilities, {
        "workspace.space": native([]),
        "workspace.inspect": native(["Finds GPK workspaces by Collection schema and skips trashed documents."]),
        "workspace.establish": native(["Creates Collections, folders, views and native Craft Templates."]),
        "templates.read": native(["Reads from Craft's native Templates area, preserving Craft dialect blocks and sanitizing stray checkboxes."]),
        "tasks.resolve": native(["Block IDs and Craft links carrying blockId."]),
        "tasks.read": native(["Ownership comes from the Task's container: a Project row, a Daily Note or the Inbox."]),
        "tasks.query": emulated(["Space-wide task listing filtered in memory; only Inbox, Daily Note and Project-row Tasks are considered."]),
        "tasks.query.states": emulated(["Native checkbox plus line-end #gpk/task tag."]),
        "tasks.query.time": emulated(["Filters the listing's schedule dates."]),
        "tasks.query.text": emulated(["Case-insensitive substring match over title and body."]),
        "tasks.query.project": emulated(["A Project's Tasks are its row's task blocks; project: null excludes them."]),
        "tasks.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan; see links.query."] },
        "tasks.create": native(["Standalone Tasks go to today's Daily Note; Project-owned Tasks follow the last Task of the Project row."]),
        "tasks.update": emulated(["Title via tasks update; body edits and appends per child block; expected is detected by re-read."]),
        "tasks.transition": emulated(["done/canceled are native; doing/waiting are a line-end tag; the reason is appended as a child block."]),
        "tasks.schedule": native(["taskInfo.scheduleDate via JSON update."]),
        "tasks.assignProject": emulated(["blocks move into the Project row or today's Daily Note; authorized on both source and destination roots."]),
        "areas.resolve": native(["Row IDs of the Areas Collection."]),
        "areas.read": native([]),
        "areas.query": emulated(["Collection items read in one batch and filtered in memory."]),
        "areas.query.states": native(["Status single-select column."]),
        "areas.query.text": emulated(["Case-insensitive substring match over title and body."]),
        "areas.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan; see links.query."] },
        "areas.create": native(["collections items-add with Status; the body is appended to the row page."]),
        "areas.update": emulated(["Title via items-update; body edits, appends and empty-body recovery."]),
        "areas.transition": emulated(["Status column plus an appended reason block."]),
        "projects.resolve": native(["Row IDs of the Projects Collection."]),
        "projects.read": native(["State and primary Area are the Status and Area columns."]),
        "projects.query": emulated(["Collection items read in one batch and filtered in memory."]),
        "projects.query.states": native(["Status single-select column."]),
        "projects.query.area": native(["Area relation column."]),
        "projects.query.text": emulated(["Case-insensitive substring match over title and body."]),
        "projects.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan; see links.query."] },
        "projects.create": native(["collections items-add with Status and Area; the body is appended to the row page."]),
        "projects.update": emulated(["Title via items-update; body edits, appends and empty-body recovery."]),
        "projects.transition": emulated(["Status column plus an appended reason block; closing requires no open Tasks."]),
        "projects.assignArea": native(["Area relation column plus an appended reason block."]),
        "projects.orderTasks": emulated(["Sequential blocks move --targetSiblingId; the order must list every current Task."]),
        "projects.materials.list": { mode: "degraded", evidence, limits: ["Lists nested pages; inline sections use their heading reference or the Project body."] },
        "projects.materials.read": native([]),
        "projects.materials.append": native(["Inline heading plus body, or a nested page."]),
        "projects.materials.update": emulated(["Title via blocks update; body edits and appends."]),
        "sources.resolve": native(["Root block IDs of documents in the Sources folder (recursive)."]),
        "sources.read": native(["Title is the root block; body is its child blocks."]),
        "sources.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "sources.query.text": emulated(["Case-insensitive substring match over enumerated folder documents."]),
        "sources.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan."] },
        "sources.create": native(["documents create in the Sources folder, body appended, optional originalFile attached."]),
        "sources.update": emulated(["Title, body edits/append/replaceContent, or originalFile attachment."]),
        "wikis.resolve": native(["Root block IDs of documents in the Wikis folder (recursive)."]),
        "wikis.read": native(["Title is the root block; body is its child blocks."]),
        "wikis.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "wikis.query.text": emulated(["Case-insensitive substring match over enumerated folder documents."]),
        "wikis.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan."] },
        "wikis.create": native(["documents create in the Wikis folder, body appended."]),
        "wikis.update": emulated(["Title via the root block; body edits, append and empty-body recovery."]),
        "outputs.resolve": native(["Root block IDs of documents in the Outputs folder (recursive)."]),
        "outputs.read": native(["Title is the root block; body is its child blocks."]),
        "outputs.query": emulated(["Folder listing filtered in memory; one batched read per page."]),
        "outputs.query.text": emulated(["Case-insensitive substring match over enumerated folder documents."]),
        "outputs.query.relatedTo": { mode: "degraded", evidence, limits: ["Filters by links discovered through a body scan."] },
        "outputs.create": native(["documents create in the Outputs folder, body appended."]),
        "outputs.update": emulated(["Title via the root block; body edits, append and empty-body recovery."]),
        "links.query": { mode: "degraded", evidence, limits: ["Incoming links use title search and omit standalone Task bodies; discovery is partial."] },
        "links.add": emulated(["A bullet with a block link and context under the record's Links heading (a child block on a Task)."]),
        "links.remove": emulated(["Deletes the matching link bullet."]),
        "checkpoints.read": emulated(["A nested page of the GPK System page in the host document, titled by key."]),
        "checkpoints.save": emulated(["Appends a checksummed checkpoint revision, verifies it before pruning old revisions, and preserves an intact backup; authorized on the system root."]),
        "captures.resolve": native(["inbox and daily-notes surfaces."]),
        "captures.list": native(["Inbox items are task action lines. Omit limit for all items in the bounded traversal."]),
        "captures.read": native(["Verifies surface membership before reading the block."]),
        "captures.recordActivity": { mode: "emulated", evidence: ["Adapter regression fixture."], limits: ["Daily Note entries are identified by date, sentence and optional related record."] },
        "captures.recordSource": { mode: "emulated", evidence: ["Adapter regression fixture."], limits: ["Legacy grant alias accepted for Saved Source Daily Note entries."] },
      });
      return { ok: true, value: capabilities, limits: [] };
    },
    workspace,
    templates: templatesOps,
    areas: collectionOps.areas,
    projects: collectionOps.projects,
    tasks,
    sources: documentOps.sources,
    wikis: documentOps.wikis,
    outputs: documentOps.outputs,
    captures,
    links: documentOps.links,
    checkpoints: createCheckpointOperations(ctx),
    containerOf,
  };
  return adapter;
}
