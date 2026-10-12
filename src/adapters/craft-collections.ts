import type { Area, AreaRef, AreaState, Project, ProjectRef, ProjectState, Ref, TaskRef } from "../domain/entities.js";
import type {
  AreaInput, AreaOperations, AreaQuery, ProjectInput, ProjectMaterial, ProjectMaterialRef, ProjectMaterials,
  ProjectOperations, ProjectQuery, TextEdit,
} from "../domain/knowledge-backend-port.js";
import type {
  ControlGrant, CreateReceipt, Failure, GrantedWriteGuard, Page, Result, Snapshot, Version, WriteReceipt,
} from "../domain/operation-types.js";
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

/** Shared helpers the Task slice already provides; the Collections slice reuses them. */
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
  /** Enforce a runtime-resolved grant whose root must equal `rootId` exactly. */
  authorizeRoot(guard: GrantedWriteGuard, operation: string, rootId: string, target?: Ref): Promise<Result<ControlGrant>>;
  /** Plan literal edits against a block's children; conflict on ambiguity. */
  planEdits(block: CraftBlock, edits: TextEdit[], target: Ref): Result<Map<string, string>>;
  writeEdits(plans: Map<string, string>): Promise<Result<void>>;
  today(): string;
  /** The document hosting the Collections; null before Setup. */
  hostRoot(): Promise<Result<string | null>>;
  /** A Task's grant container (inbox, Daily Note, Project row or document). */
  taskContainer(ref: TaskRef): Promise<Result<{ key: string; kind: string; projectId?: string }>>;
  /** A folder and all its descendants (Craft's folder listing is not recursive). */
  folderWithDescendants(folderId: string, refresh?: boolean): Promise<Result<string[]>>;
  /** IDs linked to or from an endpoint, for relatedTo predicates; set once the link module exists. */
  relatedIds?: (ref: Ref & { kind: string }) => Promise<Result<{ ids: Set<string>; limits: string[] }>>;
};

export const PROJECT_TRANSITIONS: Record<ProjectState, ProjectState[]> = {
  planned: ["active", "canceled"],
  active: ["paused", "completed", "canceled"],
  paused: ["active", "completed", "canceled"],
  completed: [],
  canceled: [],
};
export const AREA_TRANSITIONS: Record<AreaState, AreaState[]> = { active: ["inactive"], inactive: ["active"] };
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

/** The new row's ID in an items-add receipt: the first block ID that is not the Collection's. */
function createdRowId(receipt: string, collectionId: string): string | undefined {
  return receipt.match(new RegExp(UUID.source, "g"))?.find(id => id.toLowerCase() !== collectionId.toLowerCase());
}

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

type ListedItem = { id: string; title: string; status?: string; areaId?: string; preview: string };

export function createCollectionOperations(ctx: CraftContext) {
  const schemaTitles = new Map<string, string>();
  /**
   * Row IDs seen per Collection. Craft never moves a row between Collections, so a
   * cached member stays a member; a miss refreshes the listing once. This keeps the
   * containment check from re-reading a large Collection on every row operation.
   */
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
    if (!name) return failure("unavailable", "The Collection schema did not name its title column.", "Inspect the Collection in Craft.");
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
        const entry: ListedItem = { id: item.id, title: item.title ?? item.markdown ?? "", preview: (item as { contentPreviewMd?: string }).contentPreviewMd ?? "" };
        if (typeof properties.status === "string") entry.status = properties.status;
        const areaId = properties.area?.relations?.[0]?.blockId;
        if (areaId) entry.areaId = areaId;
        items.push(entry);
      }
      // Craft puts the paging cursor beside `data`; items have arrived in one response so far.
      cursor = read.value.nextCursor ?? block.nextCursor;
      if (!cursor) break;
    }
    members.set(collectionId.toLowerCase(), new Set(items.map(item => item.id.toLowerCase())));
    return { ok: true, value: items, limits: [] };
  }

  async function readItem<R extends Ref>(ref: R, collectionId: string, kind: string): Promise<Result<CraftBlock>> {
    const scoped = await ctx.space();
    if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", `The reference is not a ${kind} in the bound Craft space.`, `Resolve the ${kind} in this space first.`, [ref]);
    const block = await ctx.readBlock(ref.id, 1);
    if (!block.ok) return block.error.code === "invalid" ? failure("not-found", `No ${kind} row with this ID is readable.`, `Re-resolve the ${kind}.`, [ref]) : block;
    if (block.value.type !== "collectionItem") return failure("invalid", `The block is not a Collection row.`, `Use the operations of the entity this block belongs to.`, [ref]);
    // A row block does not name its Collection, so membership is checked against the
    // configured Collection's items; a row of any other Collection is not this entity.
    if (!members.get(collectionId.toLowerCase())?.has(ref.id.toLowerCase())) {
      const rows = await listItems(collectionId);
      if (!rows.ok) return rows;
      if (!members.get(collectionId.toLowerCase())?.has(ref.id.toLowerCase())) return failure("not-found", `The row is not in the ${kind}s Collection.`, `Resolve the ${kind} again; rows of other Collections are not GPK ${kind}s.`, [ref]);
    }
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

  function parseCursor(cursor: string | undefined, tag: string): Result<number> {
    if (cursor === undefined) return { ok: true, value: 0, limits: [] };
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const offset = decoded.startsWith(`${tag}:`) ? Number.parseInt(decoded.slice(tag.length + 1), 10) : NaN;
    if (!Number.isInteger(offset) || offset < 0) return failure("invalid", `The cursor does not belong to ${tag}.`, "Start the query again without a cursor.");
    return { ok: true, value: offset, limits: [] };
  }

  async function verifyItem<R extends Ref, T>(ref: R, collectionId: string, kind: string, project: (block: CraftBlock) => T, predicate: (value: T) => boolean, recovery: string): Promise<Result<WriteReceipt>> {
    const after = await readItem(ref, collectionId, kind);
    if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: recovery } };
    const verified = predicate(project(after.value));
    return { ok: true, value: { affected: [ref], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery }) }, limits: verified ? [] : ["Read-back did not show the requested effect."] };
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
      const block = await readItem(ref, loc.value.area, "Area"); if (!block.ok) return block;
      return { ok: true, value: { ref, value: toArea(block.value), version: ctx.digestOf(block.value), coverage: "complete" }, limits: [] };
    },
    async query(query: AreaQuery) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;

      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      const offset = parseCursor(query.cursor, "areas"); if (!offset.ok) return offset;
      const items = await listItems(loc.value.area); if (!items.ok) return items;
      let candidates = items.value;
      const limits: string[] = [];
      if (query.relatedTo) {
        const related = await ctx.relatedIds!(query.relatedTo); if (!related.ok) return related;
        candidates = candidates.filter(item => related.value.ids.has(item.id.toLowerCase()));
        limits.push(...related.value.limits);
      }
      if (query.states) candidates = candidates.filter(item => item.status && query.states!.includes(item.status as AreaState));
      if (query.text) candidates = candidates.filter(item => item.title.includes(query.text!));
      const page = candidates.slice(offset.value, offset.value + limit);
      const blocks = await ctx.readBlocks(page.map(item => item.id), 1); if (!blocks.ok) return blocks;
      const snapshots: Snapshot<Area, AreaRef>[] = [];
      for (const item of page) {
        const block = blocks.value.get(item.id.toLowerCase()); if (!block) continue;
        snapshots.push({ ref: { kind: "Area", scope: scoped.value.id, id: item.id }, value: toArea(block), version: ctx.digestOf(block), coverage: "complete" });
      }
      const next = offset.value + limit;
      const result: Page<Snapshot<Area, AreaRef>> = next < candidates.length ? { items: snapshots, coverage: "partial", next: Buffer.from(`areas:${next}`).toString("base64url") } : { items: snapshots, coverage: "complete" };
      if (query.text) limits.push("text matched Area titles only.");
      return { ok: true, value: result, limits };
    },
    async create(input: AreaInput, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim()) return failure("invalid", "An Area needs a nonblank title.", "Supply the title.");
      const granted = await ctx.authorizeRoot(guard, "areas.create", loc.value.area); if (!granted.ok) return granted;
      const column = await titleColumn(loc.value.area); if (!column.ok) return column;
      const added = await ctx.connection.write(`collections items-add --collection ${loc.value.area} --${column.value} ${JSON.stringify(input.title.trim())} --Status ${input.state}`);
      if (!added.ok) return added;
      const id = createdRowId(added.value, loc.value.area);
      if (!id) return failure("uncertain", "Craft did not report the created row ID.", "List Areas to find the new row before retrying.");
      const ref: AreaRef = { kind: "Area", scope: scoped.value.id, id };
      members.get(loc.value.area.toLowerCase())?.add(id.toLowerCase());
      if (input.content.trim()) {
        const body = await appendNote(id, input.content);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: "The Area row exists without its body; add the body with areas.update." } };
      }
      const verified = await verifyItem(ref, loc.value.area, "Area", toArea, area => area.title === input.title.trim() && area.state === input.state, "The Area was created; read it back and adjust.");
      if (!verified.ok) return verified;
      return { ok: true, value: { ...verified.value, created: ref } satisfies CreateReceipt<AreaRef>, limits: [] };
    },
    async update(ref, update, guard) {
      if (update.title === undefined && !update.edits?.length) return failure("invalid", "Supply a title or at least one edit.", "Nothing to change.");
      if (update.title !== undefined && !update.title.trim()) return failure("invalid", "An Area title cannot be blank.", "Supply the title.");
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.area, "Area"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "areas.update", loc.value.area, ref); if (!granted.ok) return granted;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Area changed since it was read.", "Read it again and reapply the change.", [ref]);
      const plans = ctx.planEdits(current.value, update.edits ?? [], ref); if (!plans.ok) return plans;
      if (update.title !== undefined) {
        const column = await titleColumn(loc.value.area); if (!column.ok) return column;
        const renamed = await ctx.connection.write(`collections items-update --collection ${loc.value.area} --id ${ref.id} --${column.value} ${JSON.stringify(update.title.trim())}`);
        if (!renamed.ok) return renamed;
      }
      const written = await ctx.writeEdits(plans.value);
      if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: "Some edits were applied; read the Area back before retrying the rest." } };
      return verifyItem(ref, loc.value.area, "Area", toArea, area => update.title === undefined || area.title === update.title.trim(), "Read the Area back and compare.");
    },
    archive: async () => failure("unsupported", "areas.archive is not implemented.", "Not implemented in this slice."),
    restore: async () => failure("unsupported", "areas.restore is not implemented.", "Not implemented in this slice."),
    remove: async () => failure("unsupported", "areas.remove is not implemented.", "Not implemented in this slice."),
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.area, "Area"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "areas.transition", loc.value.area, ref); if (!granted.ok) return granted;
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
  async function projectOf(block: CraftBlock, scope: string): Promise<Project> { return toProject(block, scope); }

  /** A material is a nested non-task page of its Project's row; anything else is out of scope. */
  async function readMaterial(ref: ProjectMaterialRef): Promise<Result<CraftBlock>> {
    const scoped = await ctx.space(); if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", "The material reference is not a block in this space.", "List the Project's materials again.", [ref]);
    const loc = await locations(); if (!loc.ok) return loc;
    const owner = await readItem(ref.project, loc.value.project, "Project"); if (!owner.ok) return owner;
    const child = (owner.value.content ?? []).find(block => block.id.toLowerCase() === ref.id.toLowerCase());
    if (!child || child.type !== "page" || child.listStyle === "task") return failure("not-found", "The block is not a material page of this Project.", "List the Project's materials again.", [ref]);
    return ctx.readBlock(ref.id, 1);
  }

  const materials: ProjectMaterials = {
    async list(project, options) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (options?.cursor) return failure("invalid", "Material listings are returned in one page.", "Omit the cursor.");
      const block = await readItem(project, loc.value.project, "Project"); if (!block.ok) return block;
      const items: Snapshot<ProjectMaterial, ProjectMaterialRef>[] = [];
      for (const child of block.value.content ?? []) {
        if (child.type !== "page" || child.listStyle === "task") continue;
        items.push({ ref: { scope: scoped.value.id, id: child.id, role: "project-material", project }, value: { title: child.title ?? child.markdown ?? "", content: "", presentation: "child-document" }, coverage: "partial" });
      }
      return { ok: true, value: { items, coverage: "complete" }, limits: ["Nested pages only; inline sections are part of the Project body. Read each material for its content."] };
    },
    async read(ref) {
      const block = await readMaterial(ref); if (!block.ok) return block;
      return { ok: true, value: { ref, value: { title: block.value.title ?? block.value.markdown ?? "", content: ctx.bodyOf(block.value), presentation: "child-document" }, version: ctx.digestOf(block.value), coverage: "complete" }, limits: [] };
    },
    async append(project, material, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (!material.title.trim()) return failure("invalid", "Material needs a nonblank title.", "Supply the heading.");
      const granted = await ctx.authorizeRoot(guard, "projects.materials.append", loc.value.project, project); if (!granted.ok) return granted;
      const current = await readItem(project, loc.value.project, "Project"); if (!current.ok) return current;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [project]);
      let command: string;
      if (material.presentation === "child-document") {
        const payload = [{ type: "page", markdown: material.title.trim(), content: material.content.trim() ? [{ type: "text", markdown: material.content }] : [] }];
        command = `blocks add --id ${project.id} --json '${jsonArgument(payload)}'`;
      } else {
        command = `blocks add --id ${project.id} --markdown ${JSON.stringify(`## ${material.title.trim()}\n\n${material.content}`)}`;
      }
      const added = await ctx.connection.write(command); if (!added.ok) return added;
      const id = added.value.match(/IDs: <([^>]+)>/)?.[1];
      if (!id) return failure("uncertain", "Craft did not report the created block ID.", "List the Project's materials before retrying.");
      const ref: ProjectMaterialRef = { scope: scoped.value.id, id, role: "project-material", project };
      return { ok: true, value: { created: ref, affected: [ref, project], verified: true }, limits: material.presentation === "inline" ? ["Inline material is a heading plus paragraphs in the Project body; its reference is the heading block."] : [] };
    },
    async update(ref, update, guard) {
      if (update.title === undefined && !update.edits?.length) return failure("invalid", "Supply a title or at least one edit.", "Nothing to change.");
      const loc = await locations(); if (!loc.ok) return loc;
      const granted = await ctx.authorizeRoot(guard, "projects.materials.update", loc.value.project, ref); if (!granted.ok) return granted;
      const block = await readMaterial(ref); if (!block.ok) return block;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(block.value)) return failure("conflict", "The material changed since it was read.", "Read it again and retry.", [ref]);
      const plans = ctx.planEdits(block.value, update.edits ?? [], ref); if (!plans.ok) return plans;
      if (update.title !== undefined) {
        const renamed = await ctx.connection.write(`blocks update --id ${ref.id} --markdown ${JSON.stringify(update.title.trim())}`); if (!renamed.ok) return renamed;
      }
      const written = await ctx.writeEdits(plans.value);
      if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: "Some edits were applied; read the material back before retrying." } };
      const after = await ctx.readBlock(ref.id, 1);
      return after.ok ? { ok: true, value: { affected: [ref], verified: true, version: ctx.digestOf(after.value) }, limits: [] } : { ok: false, error: { ...after.error, code: "uncertain" } };
    },
    remove: async () => failure("unsupported", "projects.materials.remove is not implemented.", "Not implemented in this slice."),
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
      const block = await readItem(ref, loc.value.project, "Project"); if (!block.ok) return block;
      return { ok: true, value: { ref, value: await projectOf(block.value, ref.scope), version: ctx.digestOf(block.value), coverage: "complete" }, limits: [] };
    },
    async query(query: ProjectQuery) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;

      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      const offset = parseCursor(query.cursor, "projects"); if (!offset.ok) return offset;
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
      if (query.text) candidates = candidates.filter(item => item.title.includes(query.text!));
      const page = candidates.slice(offset.value, offset.value + limit);
      const blocks = await ctx.readBlocks(page.map(item => item.id), 1); if (!blocks.ok) return blocks;
      const snapshots: Snapshot<Project, ProjectRef>[] = [];
      for (const item of page) {
        const block = blocks.value.get(item.id.toLowerCase()); if (!block) continue;
        snapshots.push({ ref: { kind: "Project", scope: scoped.value.id, id: item.id }, value: toProject(block, scoped.value.id), version: ctx.digestOf(block), coverage: "complete" });
      }
      const next = offset.value + limit;
      const result: Page<Snapshot<Project, ProjectRef>> = next < candidates.length ? { items: snapshots, coverage: "partial", next: Buffer.from(`projects:${next}`).toString("base64url") } : { items: snapshots, coverage: "complete" };
      if (query.text) limits.push("text matched Project titles only.");
      return { ok: true, value: result, limits };
    },
    async create(input: ProjectInput, guard) {
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const loc = await locations(); if (!loc.ok) return loc;
      if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
      if (!input.title.trim()) return failure("invalid", "A Project needs a nonblank title.", "Supply the title.");
      if (input.primaryArea.scope !== scoped.value.id) return failure("invalid", "The primary Area belongs to another space.", "Resolve an Area in this space.");
      const granted = await ctx.authorizeRoot(guard, "projects.create", loc.value.project); if (!granted.ok) return granted;
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
        const body = await appendNote(id, input.content);
        if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: "The Project row exists without its body; add the body with projects.update." } };
      }
      const verified = await verifyItem(ref, loc.value.project, "Project", block => toProject(block, scoped.value.id), project => project.title === input.title.trim() && project.state === input.state && project.primaryArea?.id.toLowerCase() === input.primaryArea.id.toLowerCase(), "The Project was created; read it back and adjust.");
      if (!verified.ok) return verified;
      return { ok: true, value: { ...verified.value, created: ref } satisfies CreateReceipt<ProjectRef>, limits: [] };
    },
    async update(ref, update, guard) {
      if (update.title === undefined && !update.edits?.length) return failure("invalid", "Supply a title or at least one edit.", "Nothing to change.");
      if (update.title !== undefined && !update.title.trim()) return failure("invalid", "A Project title cannot be blank.", "Supply the title.");
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "projects.update", loc.value.project, ref); if (!granted.ok) return granted;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and reapply the change.", [ref]);
      const plans = ctx.planEdits(current.value, update.edits ?? [], ref); if (!plans.ok) return plans;
      if (update.title !== undefined) {
        const column = await titleColumn(loc.value.project); if (!column.ok) return column;
        const renamed = await ctx.connection.write(`collections items-update --collection ${loc.value.project} --id ${ref.id} --${column.value} ${JSON.stringify(update.title.trim())}`);
        if (!renamed.ok) return renamed;
      }
      const written = await ctx.writeEdits(plans.value);
      if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: "Some edits were applied; read the Project back before retrying the rest." } };
      return verifyItem(ref, loc.value.project, "Project", block => toProject(block, ref.scope), project => update.title === undefined || project.title === update.title.trim(), "Read the Project back and compare.");
    },
    archive: async () => failure("unsupported", "projects.archive is not implemented.", "Not implemented in this slice."),
    restore: async () => failure("unsupported", "projects.restore is not implemented.", "Not implemented in this slice."),
    remove: async () => failure("unsupported", "projects.remove is not implemented.", "Not implemented in this slice."),
    async transition(ref, state, reason, guard) {
      if (!reason.trim()) return failure("invalid", "A transition needs a nonblank reason.", "Explain why the state changes.");
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "projects.transition", loc.value.project, ref); if (!granted.ok) return granted;
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
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "projects.assignArea", loc.value.project, ref); if (!granted.ok) return granted;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The Project changed since it was read.", "Read it again and retry.", [ref]);
      const areaRows = await listItems(loc.value.area); if (!areaRows.ok) return areaRows;
      if (!areaRows.value.some(item => item.id.toLowerCase() === area.id.toLowerCase())) return failure("not-found", "The Area is not a row of the Areas Collection.", "Create or resolve the Area first.", [area]);
      const written = await ctx.connection.write(`collections items-update --collection ${loc.value.project} --id ${ref.id} --Area ${area.id}`); if (!written.ok) return written;
      const note = await appendNote(ref.id, `primary Area → ${area.id} (${ctx.today()}): ${reason.trim()}`);
      if (!note.ok) return { ok: false, error: { ...note.error, code: "partial", affected: [ref], next: "The Area changed but the reason was not recorded." } };
      return verifyItem(ref, loc.value.project, "Project", block => toProject(block, ref.scope), project => project.primaryArea?.id.toLowerCase() === area.id.toLowerCase(), "Read the Project back; the Area change may not have persisted.");
    },
    async orderTasks(ref, tasks, guard) {
      const loc = await locations(); if (!loc.ok) return loc;
      const current = await readItem(ref, loc.value.project, "Project"); if (!current.ok) return current;
      const granted = await ctx.authorizeRoot(guard, "projects.orderTasks", loc.value.project, ref); if (!granted.ok) return granted;
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
      const after = await readItem(ref, loc.value.project, "Project");
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the Project back to see the resulting order." } };
      const resulting = (after.value.content ?? []).filter(child => child.listStyle === "task").map(child => child.id.toLowerCase());
      const verified = resulting.join(",") === requested.join(",");
      return { ok: true, value: { affected: [ref, ...tasks], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the Project back and compare the Task order." }) }, limits: [] };
    },
    materials,
  };

  return { areas, projects, listItems, locations, readItem, propertiesOf };
}
