import type { Area, AreaRef, AreaState, Project, ProjectRef, ProjectState, Ref, TaskRef } from "../domain/entities.js";
import type {
  AreaInput, AreaOperations, AreaQuery, ContentUpdate, ProjectInput, ProjectMaterial, ProjectMaterialRef, ProjectMaterials,
  ProjectOperations, ProjectQuery, TextEdit,
} from "../domain/knowledge-backend-port.js";
import type {
  ControlGrant, CreateReceipt, Failure, GrantedWriteGuard, Result, Snapshot, Version, WriteReceipt,
} from "../domain/operation-types.js";
import { readCursor, queryPage } from "./craft-pagination.js";
import type { KnowledgeLayout } from "../domain/user-control-port.js";
import type { CraftConnection, CraftSpace } from "./craft-connection.js";

/**
 * Areas and Projects as rows of the two Collections Setup established.
 *
 * Lifecycle state is the Collection's `Status` single-select column and the
 * primary Area is the Projects Collection's relation column, so people change
 * them in the table and the adapter reads them as typed properties. The row's
 * page holds the body: the Plan & Actions task blocks, Objective, KRs and
 * nested process pages. Row IDs are block IDs and serve as entity references.
 */
export type CraftBlock = {
  id: string; type: string; listStyle?: string; textStyle?: string; markdown?: string; title?: string;
  taskInfo?: { state?: string; scheduleDate?: string };
  properties?: Record<string, unknown>;
  metadata?: { lastModifiedAt?: string };
  content?: CraftBlock[];
  items?: CraftBlock[];
  nextCursor?: string;
};

/** Where a Task lives: its grant root key and kind (inbox, daily-note, project or document). */
export type TaskContainer = { key: string; kind: "inbox" | "daily-note" | "document" | "project"; date?: string; rootId?: string; projectId?: string };

/** Shared helpers the Task slice already provides; the Collections slice reuses them. */
export type CraftEdits = Map<string, { text: string; previousList: string | undefined }>;

export type CraftContext = {
  connection: CraftConnection;
  backendId: string;
  space(): Promise<Result<CraftSpace>>;
  layout(): Promise<Result<KnowledgeLayout["locations"] | null>>;
  readJson<T>(command: string): Promise<Result<T>>;
  readBlock(id: string, depth: number): Promise<Result<CraftBlock>>;
  readBlocks(ids: string[], depth: number): Promise<Result<Map<string, CraftBlock>>>;
  digestOf(block: CraftBlock): Version;
  bodyOf(block: CraftBlock): string;
  /** Nested native Collections are not completely represented by body text. */
  contentCoverage(block: CraftBlock): "complete" | "partial";
  /** Enforce a runtime-resolved grant whose root must equal `rootId` exactly. */
  authorizeRoot(guard: GrantedWriteGuard, operation: string, rootId: string, target?: Ref): Promise<Result<ControlGrant>>;
  /** Plan literal edits against a block's children; conflict on ambiguity. */
  planEdits(block: CraftBlock, edits: TextEdit[], target: Ref): Result<CraftEdits>;
  writeEdits(plans: CraftEdits): Promise<Result<void>>;
  /** Append a body to a page, copying the local files it references (see craft.ts writeBody). */
  writeBody(pageId: string, markdown: string, expected?: Version): Promise<Result<{ media: number; mediaVersion?: Version }>>;
  /** Check a body's local file references and upload route without writing; call before creating its record. */
  attachOriginal(ref: Ref, reference: string, expected: Version): Promise<Result<WriteReceipt>>;
  checkBody(markdown: string): Promise<Result<void>>;
  /** Prose, including reasons and link contexts, cannot create native Tasks. */
  checkProse(markdown: string): Result<void>;
  /** Whether a read-back shows every planned edit, including paragraphs split into following siblings. */
  matchesBody(children: CraftBlock[], text: string): boolean;
  editsApplied(after: CraftBlock, plans: CraftEdits): boolean;
  today(): string;
  /** The document hosting the Collections; null before Setup. */
  hostRoot(): Promise<Result<string | null>>;
  /** A Task's grant container (inbox, Daily Note, Project row or document). */
  taskContainer(ref: TaskRef): Promise<Result<TaskContainer>>;
  /** Enforce a grant against a Task's real container, so the `daily-notes` wildcard applies to Daily Note Tasks. */
  authorizeContainer(guard: GrantedWriteGuard, operation: string, container: TaskContainer, target?: Ref): Promise<Result<ControlGrant>>;
  /** A folder and all its descendants (Craft's folder listing is not recursive). */
  folderWithDescendants(folderId: string, refresh?: boolean): Promise<Result<string[]>>;
  /** IDs linked to or from an endpoint, for relatedTo predicates; set once the link module exists. */
  relatedIds?: (ref: Ref & { kind: string }) => Promise<Result<{ ids: Set<string>; limits: string[] }>>;
};

const PROJECT_TRANSITIONS: Record<ProjectState, ProjectState[]> = {
  planned: ["active", "canceled"],
  active: ["paused", "completed", "canceled"],
  paused: ["active", "completed", "canceled"],
  completed: [],
  canceled: [],
};
const AREA_TRANSITIONS: Record<AreaState, AreaState[]> = { active: ["inactive"], inactive: ["active"] };
const PROJECT_STATES: readonly ProjectState[] = ["planned", "active", "paused", "completed", "canceled"];
const AREA_STATES: readonly AreaState[] = ["active", "inactive"];
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * A JSON payload for a single-quoted `--json '…'` argument. Apostrophes become the
 * JSON escape \u0027, which Craft decodes back, so content keeps them (verified 2026-10-11).
 */
export function jsonArgument(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "\\u0027");
}

/** A real calendar date in YYYY-MM-DD form. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The new row's ID in an items-add receipt: the first block ID that is not the Collection's. */
function createdRowId(receipt: string, collectionId: string): string | undefined {
  return receipt.match(new RegExp(UUID.source, "g"))?.find(id => id.toLowerCase() !== collectionId.toLowerCase());
}

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

function nonBlankBodyBlocks(page: CraftBlock): CraftBlock[] {
  return (page.content ?? []).filter(block => {
    if (block.listStyle === "task") return false;
    const blank = block.type === "text"
      && (!block.textStyle || block.textStyle === "body")
      && (!block.listStyle || block.listStyle === "none")
      && !(block.markdown ?? "").trim() && !(block.title ?? "").trim()
      && !block.content?.length && !block.items?.length && !block.nextCursor
      && !block.taskInfo && !Object.keys(block.properties ?? {}).length;
    return !blank;
  });
}

type ListedItem = { id: string; title: string; status?: string; areaId?: string };

export function createCollectionOperations(ctx: CraftContext) {
  const schemaTitles = new Map<string, string>();
  const members = new Map<string, Set<string>>();

  async function locations(): Promise<Result<{ project: string; area: string }>> {
    const layout = await ctx.layout();
    if (!layout.ok) return layout;
    if (!layout.value || layout.value.project.id === "unset" || layout.value.area.id === "unset") {
      return failure("unavailable", "The Projects and Areas Collections are not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
    }
    return { ok: true, value: { project: layout.value.project.id, area: layout.value.area.id }, limits: [] };
  }

  /** The item-name column's display name, read from the schema once per Collection. */
  async function titleColumn(collectionId: string): Promise<Result<string>> {
    const cached = schemaTitles.get(collectionId);
    if (cached) return { ok: true, value: cached, limits: [] };
    const schema = await ctx.connection.read(`collections schema --collection ${collectionId}`);
    if (!schema.ok) return schema;
    const name = schema.value.match(/Item title[^\n]*\n\s+\w+ → "([^"]+)"/)?.[1];
    if (!name || !/^\w+$/.test(name)) return failure("unavailable", "The Collection schema did not report a supported identifier title column.", "Inspect the Collection in Craft.");
    schemaTitles.set(collectionId, name);
    return { ok: true, value: name, limits: [] };
  }

  async function listItems(collectionId: string): Promise<Result<ListedItem[]>> {
    const items: ListedItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const read = await ctx.readJson<{ data?: CraftBlock[]; nextCursor?: string }>(`blocks get --id ${collectionId} --format json --depth 1${cursor ? ` --cursor ${cursor}` : ""}`);
      if (!read.ok) return read;
      const block = read.value.data?.[0];
      if (!block || block.type !== "collection") return failure("invalid", "The configured location is not a Collection.", "Rerun Setup to repair the layout.");
      for (const item of block.items ?? []) {
        const properties = (item.properties ?? {}) as { status?: string; area?: { relations?: { blockId: string }[] } };
        const entry: ListedItem = { id: item.id, title: item.title ?? item.markdown ?? "" };
        if (typeof properties.status === "string") entry.status = properties.status;
        const areaId = properties.area?.relations?.[0]?.blockId;
        if (areaId) entry.areaId = areaId;
        items.push(entry);
      }
      cursor = read.value.nextCursor ?? block.nextCursor;
      if (!cursor) break;
    }
    if (cursor) return failure("unavailable", "The Collection listing exceeded 20 pages.", "Narrow the Collection or retry later; no complete membership was established.");
    members.set(collectionId.toLowerCase(), new Set(items.map(item => item.id.toLowerCase())));
    return { ok: true, value: items, limits: [] };
  }

  async function isRow(collectionId: string, rowId: string, mode: "fresh" | "cached" = "fresh"): Promise<Result<boolean>> {
    const known = members.get(collectionId.toLowerCase())?.has(rowId.toLowerCase());
    if (mode === "cached" && known) return { ok: true, value: true, limits: [] };
    const rows = await listItems(collectionId);
    if (!rows.ok) return rows;
    return { ok: true, value: Boolean(members.get(collectionId.toLowerCase())?.has(rowId.toLowerCase())), limits: [] };
  }

  async function readItem<R extends Ref>(ref: R, collectionId: string, kind: string, mode: "fresh" | "cached" = "fresh"): Promise<Result<CraftBlock>> {
    const scoped = await ctx.space();
    if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", `The reference is not a ${kind} in the bound Craft space.`, `Resolve the ${kind} in this space first.`, [ref]);
    const block = await ctx.readBlock(ref.id, 1);
    if (!block.ok) return block.error.code === "invalid" ? failure("not-found", `No ${kind} row with this ID is readable.`, `Re-resolve the ${kind}.`, [ref]) : block;
    if (block.value.type !== "collectionItem") return failure("invalid", `The block is not a Collection row.`, `Use the operations of the entity this block belongs to.`, [ref]);
    const member = await isRow(collectionId, ref.id, mode);
    if (!member.ok) return member;
    if (!member.value) return failure("not-found", `The row is not in the ${kind}s Collection.`, `Resolve the ${kind} again; rows of other Collections are not GPK ${kind}s.`, [ref]);
    return { ok: true, value: block.value, limits: [] };
  }

  function propertiesOf(block: CraftBlock): { status?: string; areaId?: string } {
    const properties = (block.properties ?? {}) as { status?: string; area?: { relations?: { blockId: string }[] } };
    const out: { status?: string; areaId?: string } = {};
    if (typeof properties.status === "string") out.status = properties.status;
    const areaId = properties.area?.relations?.[0]?.blockId;
    if (areaId) out.areaId = areaId;
    return out;
  }

  function toProject(block: CraftBlock, scope: string): Project {
    const props = propertiesOf(block);
    const project: Project = { title: block.title ?? block.markdown ?? "", content: ctx.bodyOf(block) };
    if (props.status && (PROJECT_STATES as readonly string[]).includes(props.status)) project.state = props.status as ProjectState;
    if (props.areaId) project.primaryArea = { kind: "Area", scope, id: props.areaId };
    return project;
  }
  function toArea(block: CraftBlock): Area {
    const props = propertiesOf(block);
    const area: Area = { title: block.title ?? block.markdown ?? "", content: ctx.bodyOf(block) };
    if (props.status && (AREA_STATES as readonly string[]).includes(props.status)) area.state = props.status as AreaState;
    return area;
  }

  async function appendNote(itemId: string, text: string): Promise<Result<string>> {
    return ctx.connection.write(`blocks add --id ${itemId} --markdown ${JSON.stringify(text)}`);
  }

  async function verifyItem<R extends Ref, T>(ref: R, collectionId: string, kind: string, project: (block: CraftBlock) => T, predicate: (value: T, block: CraftBlock) => boolean, recovery: string): Promise<Result<WriteReceipt>> {
    const after = await readItem(ref, collectionId, kind, "cached");
    if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: recovery } };
    const verified = predicate(project(after.value), after.value);
    return { ok: true, value: { affected: [ref], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery }) }, limits: verified ? [] : ["Read-back did not show the requested effect."] };
  }

  async function applyRowUpdate<R extends Ref, T>(
    ref: R, collectionId: string, kind: string, operation: string, update: ContentUpdate, guard: GrantedWriteGuard, toEntity: (block: CraftBlock) => T,
  ): Promise<Result<WriteReceipt>> {
    const hasEdits = Boolean(update.edits?.length);
    const hasAppend = update.append !== undefined && update.append.trim().length > 0;
    const hasReplace = update.replaceContent !== undefined;
    if (update.title === undefined && !hasEdits && !hasAppend && !hasReplace) {
      return failure("invalid", "Supply a title, edits, append or replaceContent.", "Nothing to change.");
    }
    if (update.title !== undefined && (!update.title.trim() || /[\r\n]/.test(update.title))) {
      return failure("invalid", `A ${kind} title must be one nonblank line.`, "Supply the title.");
    }
    if (hasReplace && (!guard.expected || hasEdits || hasAppend || !update.replaceContent!.trim())) {
      return failure("invalid", `replaceContent requires expected and cannot be combined with edits or append.`, "Read the record and retry replaceContent alone.");
    }
    const granted = await ctx.authorizeRoot(guard, operation, collectionId, ref); if (!granted.ok) return granted;
    const current = await readItem(ref, collectionId, kind); if (!current.ok) return current;
    if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) {
      return failure("conflict", `The ${kind} changed since it was read.`, "Read it again and reapply the change.", [ref]);
    }
    if (hasReplace) {
      const body = update.replaceContent!;
      if (ctx.contentCoverage(current.value) !== "complete") return failure("conflict", `Cannot replace a partially read ${kind}.`, "Read the full record first.", [ref]);
      const existing = nonBlankBodyBlocks(current.value);
      if (ctx.matchesBody(existing, body)) return { ok: true, value: { affected: [ref], version: guard.expected!, verified: true }, limits: [] };
      if (existing.length) return failure("conflict", `The ${kind} already has non-empty body content.`, "Use edits or append instead of replacing existing user content.", [ref]);
      if (update.title !== undefined) {
        const column = await titleColumn(collectionId); if (!column.ok) return column;
        const renamed = await ctx.connection.write(`collections items-update --collection ${collectionId} --id ${ref.id} --${column.value} ${JSON.stringify(update.title.trim())}`);
        if (!renamed.ok) return renamed;
      }
      const written = await ctx.writeBody(ref.id, body, guard.expected);
      if (!written.ok) return { ok: false, error: { ...written.error, affected: [ref] } };
      return verifyItem(ref, collectionId, kind, toEntity, (_val, block) => ctx.contentCoverage(block) === "complete" && (written.value.mediaVersion ? ctx.digestOf(block) === written.value.mediaVersion : ctx.matchesBody(nonBlankBodyBlocks(block), body)), `Read the ${kind} back and compare.`);
    }
    if (hasAppend) {
      const checked = await ctx.checkBody(update.append!); if (!checked.ok) return checked;
    }
    const plans = ctx.planEdits(current.value, update.edits ?? [], ref); if (!plans.ok) return plans;
    if (update.title !== undefined) {
      const column = await titleColumn(collectionId); if (!column.ok) return column;
      const renamed = await ctx.connection.write(`collections items-update --collection ${collectionId} --id ${ref.id} --${column.value} ${JSON.stringify(update.title.trim())}`);
      if (!renamed.ok) return renamed;
    }
    if (hasEdits) {
      const written = await ctx.writeEdits(plans.value);
      if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: `Some edits were applied; read the ${kind} back before retrying.` } };
    }
    if (hasAppend) {
      const appended = await ctx.writeBody(ref.id, update.append!);
      if (!appended.ok) return { ok: false, error: { ...appended.error, code: (update.title !== undefined || hasEdits) ? "partial" : appended.error.code, affected: [ref], next: `Read the ${kind} back before retrying the append.` } };
    }
    return verifyItem(
      ref, collectionId, kind, toEntity,
      (val, block) => (update.title === undefined || (val as { title: string }).title === update.title.trim()) && (!hasEdits || ctx.editsApplied(block, plans.value)),
      `Read the ${kind} back and compare.`,
    );
  }

  // ---------- Areas ----------
  const areas: AreaOperations = {
    async resolve(locator) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      const id = locator.match(UUID)?.[0];
      if (!id) return failure("invalid", "The locator contains no Craft block ID.", "Pass a row ID or a Craft link that includes blockId.");
      const items = await listItems(loc.value.area); if (!items.ok) return items;
      if (!items.value.some(item => item.id.toLowerCase() === id.toLowerCase())) return failure("not-found", "No Area row with this ID exists in the Areas Collection.", "List Areas to find the current rows.");
      return { ok: true, value: { kind: "Area", scope: scoped.value.id, id }, limits: [] };
    },
    async read(ref) {
      const loc = await locations(); if (!loc.ok) return loc;
      const block = await readItem(ref, loc.value.area, "Area", "cached"); if (!block.ok) return block;
      return { ok: true, value: { ref, value: toArea(block.value), version: ctx.digestOf(block.value), coverage: ctx.contentCoverage(block.value) }, limits: [] };
    },
    async query(query: AreaQuery) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;

      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      const key = JSON.stringify(["areas", scoped.value.id, query.states ?? null, query.text ?? null, query.relatedTo ?? null]);
      const cursor = readCursor(query.cursor, key); if (!cursor.ok) return cursor;
      const offset = cursor.value.offset;
      const items = await listItems(loc.value.area); if (!items.ok) return items;
      let candidates = items.value;
      const limits: string[] = [];
      if (query.relatedTo) {
        const related = await ctx.relatedIds!(query.relatedTo); if (!related.ok) return related;
        candidates = candidates.filter(item => related.value.ids.has(item.id.toLowerCase()));
        limits.push(...related.value.limits);
      }
      if (query.states) candidates = candidates.filter(item => item.status && query.states!.includes(item.status as AreaState));
      let scanned: Map<string, CraftBlock> | null = null;
      const omitted: string[] = [];
      if (query.text) {
        const needle = query.text.toLowerCase();
        const read = await ctx.readBlocks(candidates.map(item => item.id), 1); if (!read.ok) return read;
        scanned = read.value;
        candidates = candidates.filter(item => {
          const block = read.value.get(item.id.toLowerCase());
          if (!block) { omitted.push(item.id); return false; }
          const matched = (block.title ?? block.markdown ?? "").toLowerCase().includes(needle) || ctx.bodyOf(block).toLowerCase().includes(needle);
          if (!matched && ctx.contentCoverage(block) !== "complete") omitted.push(item.id);
          return matched;
        });
      }
      const page = candidates.slice(offset, offset + limit);
      const blocks = scanned ? { ok: true as const, value: scanned, limits: [] } : await ctx.readBlocks(page.map(item => item.id), 1); if (!blocks.ok) return blocks;
      const snapshots: Snapshot<Area, AreaRef>[] = [];
      const unreadable: string[] = [...omitted];
      for (const item of page) {
        const block = blocks.value.get(item.id.toLowerCase()); if (!block) { unreadable.push(item.id); continue; }
        snapshots.push({ ref: { kind: "Area", scope: scoped.value.id, id: item.id }, value: toArea(block), version: ctx.digestOf(block), coverage: ctx.contentCoverage(block) });
      }
      const next = offset + limit;
      const result = queryPage(snapshots, key, next < candidates.length ? next : undefined, cursor.value.incomplete || !!query.relatedTo, unreadable.map(id => ({ scope: scoped.value.id, id })));
      if (unreadable.length) limits.push(`Listed but unreadable or partial during the query and omitted: ${unreadable.join(", ")}.`);
      return { ok: true, value: result, limits };
    },
    async create(input: AreaInput, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim() || /[\r\n]/.test(input.title)) return failure("invalid", "An Area needs a single-line nonblank title.", "Supply the title.");
      if (!AREA_STATES.includes(input.state)) return failure("invalid", "Area state must be active or inactive.", "Choose active or inactive.");
      const granted = await ctx.authorizeRoot(guard, "areas.create", loc.value.area); if (!granted.ok) return granted;
      const checked = await ctx.checkBody(input.content); if (!checked.ok) return checked;
      const column = await titleColumn(loc.value.area); if (!column.ok) return column;
      const added = await ctx.connection.write(`collections items-add --collection ${loc.value.area} --${column.value} ${JSON.stringify(input.title.trim())} --Status ${input.state}`);
      if (!added.ok) return added;
      const id = createdRowId(added.value, loc.value.area);
      if (!id) return failure("uncertain", "Craft did not report the created row ID.", "List Areas to find the new row before retrying.");
      const ref: AreaRef = { kind: "Area", scope: scoped.value.id, id };
      members.get(loc.value.area.toLowerCase())?.add(id.toLowerCase());
      if (input.content.trim()) {
        const body = await ctx.writeBody(id, input.content);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: "The Area row exists without its body; add the body with areas.update." } };
      }
      const verified = await verifyItem(ref, loc.value.area, "Area", toArea, area => area.title === input.title.trim() && area.state === input.state, "The Area was created; read it back and adjust.");
      if (!verified.ok) return verified;
      return { ok: true, value: { ...verified.value, created: ref } satisfies CreateReceipt<AreaRef>, limits: [] };
    },
    async update(ref, update, guard) {
      const loc = await locations(); if (!loc.ok) return loc;
      return applyRowUpdate(ref, loc.value.area, "Area", "areas.update", update, guard, toArea);
    },
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      if (!AREA_STATES.includes(state)) return failure("invalid", "Area state must be active or inactive.", "Choose active or inactive.");
      const prose = ctx.checkProse(reason); if (!prose.ok) return prose;
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "areas.transition", loc.value.area, ref); if (!granted.ok) return granted;
      const current = await readItem(ref, loc.value.area, "Area"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Area changed since it was read.", "Read it again and retry.", [ref]);
      const from = toArea(current.value).state;
      if (!from) return failure("ambiguous", "The Area's current state is not one of the known values.", "Fix the Status cell in Craft before transitioning.", [ref]);
      if (!AREA_TRANSITIONS[from].includes(state)) return failure("conflict", `An ${from} Area cannot move to ${state}.`, "Choose a valid transition.", [ref]);
      const written = await ctx.connection.write(`collections items-update --collection ${loc.value.area} --id ${ref.id} --Status ${state}`); if (!written.ok) return written;
      const note = await appendNote(ref.id, `${state} (${ctx.today()}): ${reason.trim()}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The state changed but the reason was not recorded; add it with areas.update." } };
      return verifyItem(ref, loc.value.area, "Area", toArea, area => area.state === state, "Read the Area back; the state change may not have persisted.");
    },
  };

  // ---------- Projects ----------
  async function readMaterial(ref: ProjectMaterialRef, mode: "fresh" | "cached" = "fresh"): Promise<Result<CraftBlock>> {
    const scoped = await ctx.space(); if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", "The material reference is not a block in this space.", "List the Project's materials again.", [ref]);
    const loc = await locations(); if (!loc.ok) return loc;
    const owner = await readItem(ref.project, loc.value.project, "Project", mode); if (!owner.ok) return owner;
    const children = owner.value.content ?? [];
    const index = children.findIndex(block => block.id.toLowerCase() === ref.id.toLowerCase());
    const child = children[index];
    if (!child || child.listStyle === "task") return failure("not-found", "The material is not in this Project.", "Read the Project's materials again.", [ref]);
    if (child.type === "page") return ctx.readBlock(ref.id, 1);
    const heading = (child.markdown ?? "").match(/^(#{1,6})\s+(.+)$/);
    if (!heading) return failure("not-found", "The inline material heading no longer exists.", "Read the Project again.", [ref]);
    let end = index + 1;
    while (end < children.length) {
      const next = (children[end]!.markdown ?? "").match(/^(#{1,6})\s+/);
      if (next && next[1]!.length <= heading[1]!.length) break;
      if (children[end]!.listStyle === "task") break;
      end++;
    }
    return { ok: true, value: { ...child, title: heading[2]!, content: children.slice(index + 1, end) }, limits: [] };
  }

  const materials: ProjectMaterials = {
    async list(project, options) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (options?.cursor) return failure("invalid", "Material listings are returned in one page.", "Omit the cursor.");
      if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT)) {
        return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      }
      const block = await readItem(project, loc.value.project, "Project", "cached"); if (!block.ok) return block;
      const all: Snapshot<ProjectMaterial, ProjectMaterialRef>[] = [];
      for (const child of block.value.content ?? []) {
        if (child.type !== "page" || child.listStyle === "task") continue;
        all.push({ ref: { scope: scoped.value.id, id: child.id, role: "project-material", project }, value: { title: child.title ?? child.markdown ?? "", content: "", presentation: "child-document" }, coverage: "partial" });
      }
      const items = options?.limit ? all.slice(0, options.limit) : all;
      const inline = (block.value.content ?? []).some(child => /^#{1,6}\s+/.test(child.markdown ?? ""));
      return { ok: true, value: { items, coverage: (inline || items.length < all.length) ? "partial" : "complete" }, limits: ["Lists nested pages only. Inline sections remain in the Project body and can be read/updated with the heading reference returned at append."] };
    },
    async read(ref) {
      const block = await readMaterial(ref, "cached"); if (!block.ok) return block;
      return { ok: true, value: { ref, value: { title: block.value.title ?? block.value.markdown ?? "", content: ctx.bodyOf(block.value), presentation: block.value.type === "page" ? "child-document" : "inline" }, version: ctx.digestOf(block.value), coverage: ctx.contentCoverage(block.value) }, limits: [] };
    },
    async append(project, material, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (!material.title.trim() || /[\r\n]/.test(material.title)) return failure("invalid", "Material needs a single-line nonblank title.", "Supply the heading.");
      const granted = await ctx.authorizeRoot(guard, "projects.materials.append", loc.value.project, project); if (!granted.ok) return granted;
      const current = await readItem(project, loc.value.project, "Project"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [project]);
      const checked = await ctx.checkBody(material.content); if (!checked.ok) return checked;
      let id: string | undefined;
      if (material.presentation === "child-document") {
        const added = await ctx.connection.write(`blocks add --id ${project.id} --json '${jsonArgument([{ type: "page", markdown: material.title.trim(), content: [] }])}'`); if (!added.ok) return added;
        id = added.value.match(/IDs: <([^>]+)>/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the created block ID.", "List the Project's materials before retrying.");
        if (material.content.trim()) {
          const body = await ctx.writeBody(id, material.content);
          if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [{ scope: scoped.value.id, id }, project], next: `The material page exists but its body is missing or incomplete: ${body.error.next}` } };
        }
      } else {
        const before = new Set((current.value.content ?? []).map(child => child.id.toLowerCase()));
        const body = await ctx.writeBody(project.id, `## ${material.title.trim()}\n\n${material.content}`); if (!body.ok) return body;
        const after = await ctx.readBlock(project.id, 1); if (!after.ok) return after;
        id = (after.value.content ?? []).find(child => !before.has(child.id.toLowerCase()))?.id;
        if (!id) return failure("uncertain", "Craft did not report the created heading block.", "List the Project's materials before retrying.");
      }
      const ref: ProjectMaterialRef = { scope: scoped.value.id, id, role: "project-material", project };
      const back = await readMaterial(ref, "cached");
      if (!back.ok) return { ok: false, error: { ...back.error, code: "uncertain", affected: [ref, project], next: "Read the Project before retrying; the material may already exist." } };
      const verified = (back.value.title ?? back.value.markdown ?? "").trim() === material.title.trim() &&
        (!material.content.trim() || material.content.includes("file://") || ctx.matchesBody(back.value.content ?? [], material.content));
      return { ok: true, value: { created: ref, affected: [ref, project], verified, version: ctx.digestOf(back.value), ...(verified ? {} : { recovery: "Read the material back and compare its title and body before retrying." }) }, limits: material.presentation === "inline" ? ["Inline material is a heading plus paragraphs in the Project body; its reference is the heading block."] : [] };
    },
    async update(ref, update, guard) {
      const hasEdits = Boolean(update.edits?.length);
      const hasAppend = update.append !== undefined && update.append.trim().length > 0;
      if (update.replaceContent !== undefined) return failure("unsupported", "replaceContent is not supported on Project materials.", "Use edits or append.");
      if (update.title === undefined && !hasEdits && !hasAppend) return failure("invalid", "Supply a title, edits or append.", "Nothing to change.");
      if (update.title !== undefined && (!update.title.trim() || /[\r\n]/.test(update.title))) return failure("invalid", "A material title must be one nonblank line.", "Correct the title.");
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "projects.materials.update", loc.value.project, ref); if (!granted.ok) return granted;
      const block = await readMaterial(ref); if (!block.ok) return block;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(block.value)) return failure("conflict", "The material changed since it was read.", "Read it again and retry.", [ref]);
      if (hasAppend) {
        const checked = await ctx.checkProse(update.append!); if (!checked.ok) return checked;
      }
      const plans = ctx.planEdits(block.value, update.edits ?? [], ref); if (!plans.ok) return plans;
      if (update.title !== undefined) {
        const prefix = block.value.type === "page" ? "" : `${block.value.markdown!.match(/^#+/)![0]} `;
        const renamed = await ctx.connection.write(`blocks update --id ${ref.id} --markdown ${JSON.stringify(prefix + update.title.trim())}`); if (!renamed.ok) return renamed;
      }
      if (hasEdits) {
        const written = await ctx.writeEdits(plans.value);
        if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: "Some edits were applied; read the material back before retrying." } };
      }
      if (hasAppend) {
        if (block.value.type === "page") {
          const appended = await ctx.writeBody(ref.id, update.append!);
          if (!appended.ok) return { ok: false, error: { ...appended.error, code: (update.title !== undefined || hasEdits) ? "partial" : appended.error.code, affected: [ref] } };
        } else {
          const anchor = (block.value.content ?? []).at(-1)?.id ?? ref.id;
          const appended = await ctx.connection.write(`blocks add --siblingId ${anchor} --position after --markdown ${JSON.stringify(update.append!.trim())}`);
          if (!appended.ok) return { ok: false, error: { ...appended.error, code: (update.title !== undefined || hasEdits) ? "partial" : appended.error.code, affected: [ref] } };
        }
      }
      const after = await readMaterial(ref, "cached");
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain" } };
      const verified = (update.title === undefined || (after.value.title ?? after.value.markdown ?? "").trim() === update.title.trim()) && (!hasEdits || ctx.editsApplied(after.value, plans.value));
      return { ok: true, value: { affected: [ref], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the material back and compare." }) }, limits: verified ? [] : ["Read-back did not show the requested effect."] };
    },
  };

  const projects: ProjectOperations = {
    async resolve(locator) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      const id = locator.match(UUID)?.[0];
      if (!id) return failure("invalid", "The locator contains no Craft block ID.", "Pass a row ID or a Craft link that includes blockId.");
      const items = await listItems(loc.value.project); if (!items.ok) return items;
      if (!items.value.some(item => item.id.toLowerCase() === id.toLowerCase())) return failure("not-found", "No Project row with this ID exists in the Projects Collection.", "List Projects to find the current rows.");
      return { ok: true, value: { kind: "Project", scope: scoped.value.id, id }, limits: [] };
    },
    async read(ref) {
      const loc = await locations(); if (!loc.ok) return loc;
      const block = await readItem(ref, loc.value.project, "Project", "cached"); if (!block.ok) return block;
      return { ok: true, value: { ref, value: toProject(block.value, ref.scope), version: ctx.digestOf(block.value), coverage: ctx.contentCoverage(block.value) }, limits: [] };
    },
    async query(query: ProjectQuery) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;

      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      const key = JSON.stringify(["projects", scoped.value.id, query.states ?? null, query.area ?? null, query.text ?? null, query.relatedTo ?? null]);
      const cursor = readCursor(query.cursor, key); if (!cursor.ok) return cursor;
      const offset = cursor.value.offset;
      const items = await listItems(loc.value.project); if (!items.ok) return items;
      let candidates = items.value;
      const limits: string[] = [];
      if (query.relatedTo) {
        const related = await ctx.relatedIds!(query.relatedTo); if (!related.ok) return related;
        candidates = candidates.filter(item => related.value.ids.has(item.id.toLowerCase()));
        limits.push(...related.value.limits);
      }
      if (query.states) candidates = candidates.filter(item => item.status && query.states!.includes(item.status as ProjectState));
      if (query.area) candidates = candidates.filter(item => item.areaId && item.areaId.toLowerCase() === query.area!.id.toLowerCase());
      let scanned: Map<string, CraftBlock> | null = null;
      const omitted: string[] = [];
      if (query.text) {
        const needle = query.text.toLowerCase();
        const read = await ctx.readBlocks(candidates.map(item => item.id), 1); if (!read.ok) return read;
        scanned = read.value;
        candidates = candidates.filter(item => {
          const block = read.value.get(item.id.toLowerCase());
          if (!block) { omitted.push(item.id); return false; }
          const matched = (block.title ?? block.markdown ?? "").toLowerCase().includes(needle) || ctx.bodyOf(block).toLowerCase().includes(needle);
          if (!matched && ctx.contentCoverage(block) !== "complete") omitted.push(item.id);
          return matched;
        });
      }
      const page = candidates.slice(offset, offset + limit);
      const blocks = scanned ? { ok: true as const, value: scanned, limits: [] } : await ctx.readBlocks(page.map(item => item.id), 1); if (!blocks.ok) return blocks;
      const snapshots: Snapshot<Project, ProjectRef>[] = [];
      const unreadable: string[] = [...omitted];
      for (const item of page) {
        const block = blocks.value.get(item.id.toLowerCase()); if (!block) { unreadable.push(item.id); continue; }
        snapshots.push({ ref: { kind: "Project", scope: scoped.value.id, id: item.id }, value: toProject(block, scoped.value.id), version: ctx.digestOf(block), coverage: ctx.contentCoverage(block) });
      }
      const next = offset + limit;
      const result = queryPage(snapshots, key, next < candidates.length ? next : undefined, cursor.value.incomplete || !!query.relatedTo, unreadable.map(id => ({ scope: scoped.value.id, id })));
      if (unreadable.length) limits.push(`Listed but unreadable or partial during the query and omitted: ${unreadable.join(", ")}.`);
      return { ok: true, value: result, limits };
    },
    async create(input: ProjectInput, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim() || /[\r\n]/.test(input.title)) return failure("invalid", "A Project needs a single-line nonblank title.", "Supply the title.");
      if (!PROJECT_STATES.includes(input.state)) return failure("invalid", "Invalid Project state.", "Choose planned, active, paused, completed or canceled.");
      if (input.primaryArea.scope !== scoped.value.id) return failure("invalid", "The primary Area belongs to another space.", "Resolve an Area in this space.");
      const historical = input.state === "paused" || input.state === "completed" || input.state === "canceled";
      if (historical !== (input.history !== undefined)) return failure("invalid", historical ? `A Project is created ${input.state} only from recorded history.` : "history applies only to a paused, completed or canceled Project.", historical ? "Supply history with its origin and date, or create it planned or active." : "Remove history.");
      if (input.history && (!input.history.origin.trim() || (input.history.date !== undefined && !isValidDate(input.history.date)))) return failure("invalid", "history needs a nonblank origin, and a date when given must be a valid YYYY-MM-DD.", "Correct history.");
      if (input.history) { const prose = ctx.checkProse(input.history.origin); if (!prose.ok) return prose; }
      const granted = await ctx.authorizeRoot(guard, "projects.create", loc.value.project); if (!granted.ok) return granted;
      const checked = await ctx.checkBody(input.content); if (!checked.ok) return checked;
      const areaRows = await listItems(loc.value.area); if (!areaRows.ok) return areaRows;
      if (!areaRows.value.some(item => item.id.toLowerCase() === input.primaryArea.id.toLowerCase())) return failure("not-found", "The primary Area is not a row of the Areas Collection.", "Create or resolve the Area first.", [input.primaryArea]);
      const column = await titleColumn(loc.value.project); if (!column.ok) return column;
      const added = await ctx.connection.write(`collections items-add --collection ${loc.value.project} --${column.value} ${JSON.stringify(input.title.trim())} --Status ${input.state} --Area ${input.primaryArea.id}`);
      if (!added.ok) return added;
      const id = createdRowId(added.value, loc.value.project);
      if (!id) return failure("uncertain", "Craft did not report the created row ID.", "List Projects to find the new row before retrying.");
      const ref: ProjectRef = { kind: "Project", scope: scoped.value.id, id };
      members.get(loc.value.project.toLowerCase())?.add(id.toLowerCase());
      if (input.content.trim()) {
        const body = await ctx.writeBody(id, input.content);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: "The Project row exists without its body; add the body with projects.update." } };
      }
      if (input.history) {
        const note = await appendNote(id, `${input.state} (${input.history.date ?? "date unknown"}): recorded from ${input.history.origin.trim()}`);
        if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The Project exists without its history record; add it with projects.update." } };
      }
      const verified = await verifyItem(ref, loc.value.project, "Project", block => toProject(block, scoped.value.id), project => project.title === input.title.trim() && project.state === input.state && project.primaryArea?.id.toLowerCase() === input.primaryArea.id.toLowerCase(), "The Project was created; read it back and adjust.");
      if (!verified.ok) return verified;
      return { ok: true, value: { ...verified.value, created: ref } satisfies CreateReceipt<ProjectRef>, limits: [] };
    },
    async update(ref, update, guard) {
      const loc = await locations(); if (!loc.ok) return loc;
      return applyRowUpdate(ref, loc.value.project, "Project", "projects.update", update, guard, block => toProject(block, ref.scope));
    },
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      if (!PROJECT_STATES.includes(state)) return failure("invalid", "Invalid Project state.", "Choose planned, active, paused, completed or canceled.");
      const prose = ctx.checkProse(reason); if (!prose.ok) return prose;
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "projects.transition", loc.value.project, ref); if (!granted.ok) return granted;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [ref]);
      const from = toProject(current.value, ref.scope).state;
      if (!from) return failure("ambiguous", "The Project's current state is not one of the known values.", "Fix the Status cell in Craft before transitioning.", [ref]);
      if (!PROJECT_TRANSITIONS[from].includes(state)) return failure("conflict", `A ${from} Project cannot move to ${state}.`, "Choose a valid transition; closed Projects are not reopened here.", [ref]);
      if (state === "completed" || state === "canceled") {
        const open = (current.value.content ?? []).filter(child => child.listStyle === "task" && !["done", "canceled", "cancelled"].includes(child.taskInfo?.state ?? "todo"));
        if (open.length) return failure("conflict", `${open.length} Task(s) are still open; closing requires their explicit disposition.`, "Complete, cancel or move the remaining Tasks first, then close the Project.", open.map(child => ({ scope: ref.scope, id: child.id })));
      }
      const written = await ctx.connection.write(`collections items-update --collection ${loc.value.project} --id ${ref.id} --Status ${state}`); if (!written.ok) return written;
      const note = await appendNote(ref.id, `${state} (${ctx.today()}): ${reason.trim()}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The state changed but the reason was not recorded; add it with projects.update." } };
      return verifyItem(ref, loc.value.project, "Project", block => toProject(block, ref.scope), project => project.state === state, "Read the Project back; the state change may not have persisted.");
    },
    async assignArea(ref, area, reason, guard) {
      if (!reason.trim()) return failure("invalid", "Reassigning the primary Area needs a nonblank reason.", "Explain the change.");
      const prose = ctx.checkProse(reason); if (!prose.ok) return prose;
      if (area.scope !== ref.scope) return failure("invalid", "The Area belongs to another space.", "Resolve an Area in this space.");
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "projects.assignArea", loc.value.project, ref); if (!granted.ok) return granted;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [ref]);
      const areaRows = await listItems(loc.value.area); if (!areaRows.ok) return areaRows;
      if (!areaRows.value.some(item => item.id.toLowerCase() === area.id.toLowerCase())) return failure("not-found", "The Area is not a row of the Areas Collection.", "Create or resolve the Area first.", [area]);
      const written = await ctx.connection.write(`collections items-update --collection ${loc.value.project} --id ${ref.id} --Area ${area.id}`); if (!written.ok) return written;
      const note = await appendNote(ref.id, `primary Area → ${area.id} (${ctx.today()}): ${reason.trim()}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The Area changed but the reason was not recorded." } };
      return verifyItem(ref, loc.value.project, "Project", block => toProject(block, ref.scope), project => project.primaryArea?.id.toLowerCase() === area.id.toLowerCase(), "Read the Project back; the Area change may not have persisted.");
    },
    async orderTasks(ref, tasks, guard) {
      if (tasks.some(task => task.scope !== ref.scope)) return failure("invalid", "Every Task in the order must belong to the same space.", "Resolve Tasks in this space.");
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "projects.orderTasks", loc.value.project, ref); if (!granted.ok) return granted;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [ref]);
      const currentTasks = (current.value.content ?? []).filter(child => child.listStyle === "task").map(child => child.id.toLowerCase());
      const requested = tasks.map(task => task.id.toLowerCase());
      if (new Set(requested).size !== requested.length) return failure("invalid", "The order lists a Task more than once.", "List each Task exactly once.");
      if (requested.length !== currentTasks.length || !requested.every(id => currentTasks.includes(id))) {
        return failure("conflict", "The order must list exactly the Project's current Tasks.", "Read the Project again and include every current Task once.", [ref]);
      }
      for (let i = 1; i < tasks.length; i++) {
        const moved = await ctx.connection.write(`blocks move --id ${tasks[i]!.id} --targetSiblingId ${tasks[i - 1]!.id} --position after`);
        if (!moved.ok) return { ok: false, error: { ...moved.error, code: "partial", affected: [ref], next: "The order was partly applied; read the Project back and retry." } };
      }
      const after = await readItem(ref, loc.value.project, "Project", "cached");
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the Project back to see the resulting order." } };
      const resulting = (after.value.content ?? []).filter(child => child.listStyle === "task").map(child => child.id.toLowerCase());
      const verified = resulting.join(",") === requested.join(",");
      return { ok: true, value: { affected: [ref, ...tasks], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the Project back and compare the Task order." }) }, limits: [] };
    },
    materials,
  };

  return { areas, projects, listItems, readItem, isRow };
}
