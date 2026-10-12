import type { AreaRef, Output, OutputRef, ProjectRef, Ref, Source, SourceRef, TaskRef, Wiki, WikiRef } from "../domain/entities.js";
import type {
  KnowledgeLink, KnowledgeLinks, OutputOperations, OutputQuery, ProcessingCheckpoints, SourceOperations, SourceQuery,
  TextEdit, WikiOperations, WikiQuery,
} from "../domain/knowledge-backend-port.js";
import type { CreateReceipt, Failure, GrantedWriteGuard, Page, ReadOptions, Result, Snapshot, WriteReceipt } from "../domain/operation-types.js";
import type { KnowledgeLayout } from "../domain/user-control-port.js";
import { jsonArgument, type CraftBlock, type CraftContext, type createCollectionOperations } from "./craft-collections.js";

/**
 * Sources, Wikis and Outputs as documents in the folders Setup established, plus
 * the two mechanisms that tie entities together: contextual links written into
 * the linking entity's body, and processing checkpoints kept in a `GPK System`
 * page nested in the host document.
 *
 * - A document's kind is the folder that contains it (listed recursively); a
 *   document moved elsewhere is unrecognized, not reclassified. Its root block
 *   ID is the entity ID; the root block's markdown is the title.
 * - A link is one bullet `- [title](block://<id>) — context` under a `## Links`
 *   heading of the linking record (a child block of a Task). Outgoing links are
 *   read from that body; incoming links are found by scanning the bodies of
 *   every GPK-managed record, so their coverage is declared per query.
 * - A checkpoint is a nested page of `GPK System` titled with its key; its
 *   child blocks are the stored content.
 */
export type LinkEndpoint = AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
type DocumentKind = "Source" | "Wiki" | "Output";
type DocumentRole = "source" | "wiki" | "output";
type DocumentRef = SourceRef | WikiRef | OutputRef;

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const LINK_LINE = /^\s*(?:[-*]|\d+\.)\s*\[(.*?)\]\(block:\/\/([0-9a-fA-F-]{36})\)\s*(?:[—:-]\s*(.*))?$/;
const LINKS_HEADING = /^#{1,6}\s*links\s*$/i;
const SYSTEM_TITLE = "GPK System";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LISTING_PAGES = 50;

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

export function parseLinkLine(markdown: string): { title: string; id: string; context: string } | null {
  const match = markdown.match(LINK_LINE);
  return match ? { title: match[1]!, id: match[2]!.toLowerCase(), context: (match[3] ?? "").trim() } : null;
}

export function renderLinkLine(title: string, id: string, context: string): string {
  return `- [${title.replace(/[\[\]]/g, "")}](block://${id}) — ${context.trim()}`;
}

type Listed = { id: string; title: string };

export function createDocumentOperations(ctx: CraftContext, collections: ReturnType<typeof createCollectionOperations>) {
  async function layout(): Promise<Result<KnowledgeLayout["locations"]>> {
    const current = await ctx.layout();
    if (!current.ok) return current;
    if (!current.value) return failure("unavailable", "The layout is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
    return { ok: true, value: current.value, limits: [] };
  }

  async function folderOf(role: DocumentRole): Promise<Result<string>> {
    const current = await layout();
    if (!current.ok) return current;
    const id = current.value[role].id;
    if (id === "unset") return failure("unavailable", `The ${role} location is not configured.`, "Call gpk_setup_open and let the user finish onboarding in the browser.");
    return { ok: true, value: id, limits: [] };
  }

  /** Every document in a folder (recursively), following the listing cursor. */
  async function listDocuments(folderId: string): Promise<Result<Listed[]>> {
    const rows: Listed[] = [];
    const seen = new Set<string>();
    let command = `documents list --folder ${folderId}`;
    for (let page = 0; page < MAX_LISTING_PAGES; page++) {
      const listing = await ctx.connection.read(command);
      if (!listing.ok) return listing.error.code === "invalid" ? failure("not-found", "The configured folder is not listable.", "Rerun Setup inspect to repair the layout.") : listing;
      for (const line of listing.value.split("\n")) {
        const match = line.match(/^\s*<([^>]+)>\s+(.*)$/);
        if (match && !seen.has(match[1]!.toLowerCase())) { seen.add(match[1]!.toLowerCase()); rows.push({ id: match[1]!, title: match[2]!.trim() }); }
      }
      const next = listing.value.match(/--cursor\s+(\S+)/)?.[1];
      if (!next) return { ok: true, value: rows, limits: [] };
      command = `documents list --folder ${folderId} --cursor ${next}`;
    }
    return failure("unavailable", `The folder listing exceeded ${MAX_LISTING_PAGES} pages.`, "Narrow the folder or retry later.");
  }

  async function readDocument(ref: Ref, kind: DocumentKind, folderId: string): Promise<Result<CraftBlock>> {
    const scoped = await ctx.space();
    if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", `The reference is not a ${kind} in the bound Craft space.`, `Resolve the ${kind} in this space first.`, [ref]);
    const listed = await listDocuments(folderId);
    if (!listed.ok) return listed;
    if (!listed.value.some(row => row.id.toLowerCase() === ref.id.toLowerCase())) return failure("not-found", `No ${kind} document with this ID is in the ${kind} location.`, `List ${kind}s to find the current documents.`, [ref]);
    const block = await ctx.readBlock(ref.id, 1);
    if (!block.ok) return block.error.code === "not-found" ? { ...block, error: { ...block.error, affected: [ref] } } : block;
    if (block.value.type !== "page") return failure("invalid", "The block is not a document root.", `Resolve the ${kind} again.`, [ref]);
    return block;
  }

  function parseCursor(cursor: string | undefined, tag: string): Result<number> {
    if (cursor === undefined) return { ok: true, value: 0, limits: [] };
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const offset = decoded.startsWith(`${tag}:`) ? Number.parseInt(decoded.slice(tag.length + 1), 10) : NaN;
    if (!Number.isInteger(offset) || offset < 0) return failure("invalid", `The cursor does not belong to ${tag}.`, "Start the query again without a cursor.");
    return { ok: true, value: offset, limits: [] };
  }

  // ---------- one implementation for the three folder-backed entities ----------
  function documentEntity<K extends DocumentKind, R extends DocumentRef, V extends { title: string; content: string }>(kind: K, role: DocumentRole, operation: (name: string) => string) {
    const project = (block: CraftBlock): V => ({ title: block.markdown ?? "", content: ctx.bodyOf(block) } as V);
    const verify = async (ref: R, folderId: string, predicate: (value: V) => boolean, recovery: string): Promise<Result<WriteReceipt>> => {
      const after = await readDocument(ref, kind, folderId);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: recovery } };
      const verified = predicate(project(after.value));
      return { ok: true, value: { affected: [ref], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery }) }, limits: verified ? [] : ["Read-back did not show the requested effect."] };
    };
    return {
      async resolve(locator: string): Promise<Result<R>> {
        const scoped = await ctx.space(); if (!scoped.ok) return scoped;
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const id = locator.match(UUID)?.[0];
        if (!id) return failure("invalid", "The locator contains no Craft block ID.", "Pass a document root ID or a Craft link that includes blockId.");
        const listed = await listDocuments(folder.value); if (!listed.ok) return listed;
        const row = listed.value.find(item => item.id.toLowerCase() === id.toLowerCase());
        if (!row) return failure("not-found", `No ${kind} document with this ID is in the ${kind} location.`, `List ${kind}s to find the current documents.`);
        return { ok: true, value: { kind, scope: scoped.value.id, id: row.id } as R, limits: [] };
      },
      async read(ref: R): Promise<Result<Snapshot<V, R>>> {
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const block = await readDocument(ref, kind, folder.value); if (!block.ok) return block;
        return { ok: true, value: { ref, value: project(block.value), version: ctx.digestOf(block.value), coverage: "complete" }, limits: [] };
      },
      async query(query: ReadOptions & { text?: string; relatedTo?: LinkEndpoint }): Promise<Result<Page<Snapshot<V, R>>>> {
        const scoped = await ctx.space(); if (!scoped.ok) return scoped;
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const limit = query.limit ?? DEFAULT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
        const offset = parseCursor(query.cursor, role); if (!offset.ok) return offset;
        const listed = await listDocuments(folder.value); if (!listed.ok) return listed;
        let candidates = listed.value;
        const limits: string[] = [];
        if (query.relatedTo) {
          const related = await relatedIds(query.relatedTo); if (!related.ok) return related;
          candidates = candidates.filter(row => related.value.ids.has(row.id.toLowerCase()));
          limits.push(...related.value.limits);
        }
        if (query.text) { candidates = candidates.filter(row => row.title.includes(query.text!)); limits.push(`text matched ${kind} titles only.`); }
        const page = candidates.slice(offset.value, offset.value + limit);
        const blocks = await ctx.readBlocks(page.map(row => row.id), 1); if (!blocks.ok) return blocks;
        const items: Snapshot<V, R>[] = [];
        for (const row of page) {
          const block = blocks.value.get(row.id.toLowerCase()); if (!block) continue;
          items.push({ ref: { kind, scope: scoped.value.id, id: row.id } as R, value: project(block), version: ctx.digestOf(block), coverage: "complete" });
        }
        const next = offset.value + limit;
        const result: Page<Snapshot<V, R>> = next < candidates.length ? { items, coverage: "partial", next: Buffer.from(`${role}:${next}`).toString("base64url") } : { items, coverage: "complete" };
        return { ok: true, value: result, limits };
      },
      async create(input: { title: string; content: string }, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<R>>> {
        const scoped = await ctx.space(); if (!scoped.ok) return scoped;
        const folder = await folderOf(role); if (!folder.ok) return folder;
        if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
        if (!input.title.trim()) return failure("invalid", `A ${kind} needs a nonblank title.`, "Supply the title.");
        const granted = await ctx.authorizeRoot(guard, operation("create"), folder.value); if (!granted.ok) return granted;
        const created = await ctx.connection.write(`documents create --title ${JSON.stringify(input.title.trim())} --folder ${folder.value}`);
        if (!created.ok) return created;
        const id = created.value.match(/rootBlockId:\s*(\S+)/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the created document's root block.", `List ${kind}s to find the new document before retrying.`);
        const ref = { kind, scope: scoped.value.id, id } as R;
        if (input.content.trim()) {
          const body = await ctx.connection.write(`blocks add --id ${id} --markdown ${JSON.stringify(input.content)}`);
          if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: `The ${kind} exists without its body; add the body with ${operation("update")}.` } };
        }
        const verified = await verify(ref, folder.value, value => value.title === input.title.trim(), `The ${kind} was created; read it back and adjust.`);
        if (!verified.ok) return verified;
        return { ok: true, value: { ...verified.value, created: ref }, limits: [] };
      },
      async update(ref: R, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>> {
        if (update.title === undefined && !update.edits?.length) return failure("invalid", "Supply a title or at least one edit.", "Nothing to change.");
        if (update.title !== undefined && !update.title.trim()) return failure("invalid", `A ${kind} title cannot be blank.`, "Supply the title.");
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const current = await readDocument(ref, kind, folder.value); if (!current.ok) return current;
        const granted = await ctx.authorizeRoot(guard, operation("update"), folder.value, ref); if (!granted.ok) return granted;
        if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", `The ${kind} changed since it was read.`, "Read it again and reapply the change.", [ref]);
        const plans = ctx.planEdits(current.value, update.edits ?? [], ref); if (!plans.ok) return plans;
        if (update.title !== undefined) {
          const renamed = await ctx.connection.write(`blocks update --id ${ref.id} --markdown ${JSON.stringify(update.title.trim())}`);
          if (!renamed.ok) return renamed;
        }
        const written = await ctx.writeEdits(plans.value);
        if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: `Some edits were applied; read the ${kind} back before retrying the rest.` } };
        return verify(ref, folder.value, value => update.title === undefined || value.title === update.title.trim(), `Read the ${kind} back and compare.`);
      },
      archive: async () => failure("unsupported", `${operation("archive")} is not implemented; Craft's trash purges after 30 days, which is not archiving.`, "Keep the document; note its status in the body."),
      restore: async () => failure("unsupported", `${operation("restore")} is not implemented.`, "Not implemented in this slice."),
      remove: async () => failure("unsupported", `${operation("remove")} is not implemented.`, "Not implemented in this slice."),
    };
  }

  const sources: SourceOperations = documentEntity<"Source", SourceRef, Source>("Source", "source", name => `sources.${name}`);
  const wikis: WikiOperations = documentEntity<"Wiki", WikiRef, Wiki>("Wiki", "wiki", name => `wikis.${name}`);
  const outputs: OutputOperations = documentEntity<"Output", OutputRef, Output>("Output", "output", name => `outputs.${name}`);

  // ---------- links ----------
  type Classified = { kind: LinkEndpoint["kind"]; id: string; rootId: string; title: string };

  /** Every GPK-managed record that can carry or receive a link, with its grant root. */
  async function inventory(): Promise<Result<Map<string, Classified>>> {
    const current = await layout(); if (!current.ok) return current;
    const records = new Map<string, Classified>();
    for (const [kind, id] of [["Area", current.value.area.id], ["Project", current.value.project.id]] as const) {
      if (id === "unset") continue;
      const rows = await collections.listItems(id); if (!rows.ok) return rows;
      for (const row of rows.value) records.set(row.id.toLowerCase(), { kind, id: row.id, rootId: id, title: row.title });
    }
    for (const [kind, id] of [["Source", current.value.source.id], ["Wiki", current.value.wiki.id], ["Output", current.value.output.id]] as const) {
      if (id === "unset") continue;
      const docs = await listDocuments(id); if (!docs.ok) return docs;
      for (const doc of docs.value) records.set(doc.id.toLowerCase(), { kind, id: doc.id, rootId: id, title: doc.title });
    }
    return { ok: true, value: records, limits: [] };
  }

  /** The block that carries an endpoint's links and the root its grant must name. */
  async function endpoint(ref: LinkEndpoint, records: Map<string, Classified>): Promise<Result<{ block: CraftBlock; rootId: string; title: string }>> {
    const scoped = await ctx.space(); if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", "The reference is not a record in the bound Craft space.", "Resolve it in this space first.", [ref]);
    if (ref.kind === "Task") {
      const container = await ctx.taskContainer(ref); if (!container.ok) return container;
      const block = await ctx.readBlock(ref.id, 1); if (!block.ok) return block;
      if (block.value.listStyle !== "task") return failure("invalid", "The block is not a task block.", "Resolve the Task again.", [ref]);
      const parsed = block.value.markdown?.replace(/^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX-]\]\s*)?/, "").replace(/\s*#gpk\/task\/\w+\s*$/, "").trim() ?? "";
      return { ok: true, value: { block: block.value, rootId: container.value.key, title: parsed }, limits: [] };
    }
    const record = records.get(ref.id.toLowerCase());
    if (!record || record.kind !== ref.kind) return failure("not-found", `No ${ref.kind} with this ID is in its GPK location.`, `Resolve the ${ref.kind} again.`, [ref]);
    const block = await ctx.readBlock(ref.id, 1); if (!block.ok) return block;
    return { ok: true, value: { block: block.value, rootId: record.rootId, title: record.title }, limits: [] };
  }

  function linksIn(block: CraftBlock, from: LinkEndpoint, records: Map<string, Classified>, taskKinds: Map<string, true>): { link: KnowledgeLink; blockId: string }[] {
    const found: { link: KnowledgeLink; blockId: string }[] = [];
    for (const child of block.content ?? []) {
      const parsed = parseLinkLine(child.markdown ?? "");
      if (!parsed) continue;
      const target = records.get(parsed.id);
      const to: LinkEndpoint | null = target ? ({ kind: target.kind, scope: from.scope, id: target.id } as LinkEndpoint)
        : taskKinds.has(parsed.id) ? { kind: "Task", scope: from.scope, id: parsed.id } : null;
      if (!to) continue;
      found.push({ link: { from, to, context: parsed.context }, blockId: child.id });
    }
    return found;
  }

  /** Resolve link targets that are not inventory records: task blocks keep their Task kind. */
  async function taskTargets(blocks: CraftBlock[], records: Map<string, Classified>): Promise<Result<Map<string, true>>> {
    const unknown = new Set<string>();
    for (const block of blocks) for (const child of block.content ?? []) {
      const parsed = parseLinkLine(child.markdown ?? "");
      if (parsed && !records.has(parsed.id)) unknown.add(parsed.id);
    }
    const tasks = new Map<string, true>();
    if (!unknown.size) return { ok: true, value: tasks, limits: [] };
    const read = await ctx.readBlocks([...unknown], 0); if (!read.ok) return read;
    for (const [id, block] of read.value) if (block.listStyle === "task") tasks.set(id, true);
    return { ok: true, value: tasks, limits: [] };
  }

  async function discover(ref: LinkEndpoint): Promise<Result<{ outgoing: { link: KnowledgeLink; blockId: string }[]; incoming: KnowledgeLink[]; limits: string[] }>> {
    const records = await inventory(); if (!records.ok) return records;
    const own = await endpoint(ref, records.value); if (!own.ok) return own;
    const limits: string[] = [];
    // Incoming: scan every record body (rows at depth 2 so Task bodies inside them count).
    const rowIds = [...records.value.values()].filter(r => r.kind === "Area" || r.kind === "Project").map(r => r.id);
    const docIds = [...records.value.values()].filter(r => r.kind !== "Area" && r.kind !== "Project").map(r => r.id);
    const rows = await ctx.readBlocks(rowIds, 2); if (!rows.ok) return rows;
    const docs = await ctx.readBlocks(docIds, 1); if (!docs.ok) return docs;
    const bodies: { from: LinkEndpoint; block: CraftBlock }[] = [];
    for (const record of records.value.values()) {
      const block = (record.kind === "Area" || record.kind === "Project" ? rows.value : docs.value).get(record.id.toLowerCase());
      if (!block) { limits.push(`${record.kind} ${record.id} was unreadable during the scan.`); continue; }
      bodies.push({ from: { kind: record.kind, scope: ref.scope, id: record.id } as LinkEndpoint, block });
      if (record.kind === "Project") for (const child of block.content ?? []) if (child.listStyle === "task") bodies.push({ from: { kind: "Task", scope: ref.scope, id: child.id }, block: child });
    }
    const tasks = await taskTargets([own.value.block, ...bodies.map(b => b.block)], records.value); if (!tasks.ok) return tasks;
    const outgoing = linksIn(own.value.block, ref, records.value, tasks.value);
    const incoming: KnowledgeLink[] = [];
    for (const body of bodies) {
      if (body.from.id.toLowerCase() === ref.id.toLowerCase()) continue;
      for (const { link } of linksIn(body.block, body.from, records.value, tasks.value)) if (link.to.id.toLowerCase() === ref.id.toLowerCase()) incoming.push(link);
    }
    limits.push("Incoming links come from scanning Area, Project (with their Tasks), Source, Wiki and Output bodies; links written by standalone Tasks are not found.");
    return { ok: true, value: { outgoing, incoming, limits }, limits: [] };
  }

  /** IDs linked to or from an endpoint, for relatedTo predicates. */
  async function relatedIds(ref: LinkEndpoint): Promise<Result<{ ids: Set<string>; limits: string[] }>> {
    const found = await discover(ref); if (!found.ok) return found;
    const ids = new Set<string>();
    for (const { link } of found.value.outgoing) ids.add(link.to.id.toLowerCase());
    for (const link of found.value.incoming) ids.add(link.from.id.toLowerCase());
    return { ok: true, value: { ids, limits: found.value.limits }, limits: [] };
  }

  const links: KnowledgeLinks = {
    async query(ref, options) {
      if (options?.cursor) return failure("invalid", "Link discovery is returned in one page.", "Omit the cursor.");
      const found = await discover(ref); if (!found.ok) return found;
      const items = [...found.value.outgoing.map(entry => entry.link), ...found.value.incoming];
      return { ok: true, value: { items, coverage: found.value.limits.some(l => /unreadable/.test(l)) ? "partial" : "complete" }, limits: found.value.limits };
    },
    async add(link, guard) {
      if (!link.context.trim()) return failure("invalid", "A link needs a nonblank context.", "Explain the relationship.");
      if (link.from.scope !== link.to.scope) return failure("invalid", "Both endpoints must be in the same space.", "Resolve both in this space.");
      if (link.from.id.toLowerCase() === link.to.id.toLowerCase()) return failure("invalid", "A record cannot link to itself.", "Choose another target.");
      const records = await inventory(); if (!records.ok) return records;
      const from = await endpoint(link.from, records.value); if (!from.ok) return from;
      const to = await endpoint(link.to, records.value); if (!to.ok) return to;
      const granted = await ctx.authorizeRoot(guard, "links.add", from.value.rootId, link.from); if (!granted.ok) return granted;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(from.value.block)) return failure("conflict", "The linking record changed since it was read.", "Read it again and retry.", [link.from]);
      const existing = (from.value.block.content ?? []).map(child => parseLinkLine(child.markdown ?? "")).find(parsed => parsed?.id === link.to.id.toLowerCase() && parsed.context === link.context.trim());
      if (existing) return failure("conflict", "This link already exists with the same context.", "Nothing to add.", [link.from]);
      const line = renderLinkLine(to.value.title, link.to.id, link.context);
      let command: string;
      if (link.from.kind === "Task") command = `blocks add --id ${link.from.id} --markdown ${JSON.stringify(line)}`;
      else {
        const children = from.value.block.content ?? [];
        const heading = children.findIndex(child => LINKS_HEADING.test(child.markdown ?? ""));
        if (heading < 0) command = `blocks add --id ${link.from.id} --markdown ${JSON.stringify(`## Links\n\n${line}`)}`;
        else {
          let anchor = children[heading]!;
          for (let i = heading + 1; i < children.length; i++) { if (parseLinkLine(children[i]!.markdown ?? "")) anchor = children[i]!; else break; }
          command = `blocks add --siblingId ${anchor.id} --position after --markdown ${JSON.stringify(line)}`;
        }
      }
      const written = await ctx.connection.write(command); if (!written.ok) return written;
      const after = await ctx.readBlock(link.from.id, 1);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the linking record back to see whether the link was written." } };
      const verified = (after.value.content ?? []).some(child => { const parsed = parseLinkLine(child.markdown ?? ""); return parsed?.id === link.to.id.toLowerCase() && parsed.context === link.context.trim(); });
      return { ok: true, value: { affected: [link.from], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the linking record back; the link line may not have persisted." }) }, limits: [] };
    },
    async remove(link, guard) {
      const records = await inventory(); if (!records.ok) return records;
      const from = await endpoint(link.from, records.value); if (!from.ok) return from;
      const granted = await ctx.authorizeRoot(guard, "links.remove", from.value.rootId, link.from); if (!granted.ok) return granted;
      if (guard.expected !== undefined && guard.expected !== ctx.digestOf(from.value.block)) return failure("conflict", "The linking record changed since it was read.", "Read it again and retry.", [link.from]);
      const matches = (from.value.block.content ?? []).filter(child => { const parsed = parseLinkLine(child.markdown ?? ""); return parsed?.id === link.to.id.toLowerCase() && parsed.context === link.context.trim(); });
      if (!matches.length) return failure("not-found", "No such link line exists on the record.", "Query the record's links to see the current ones.", [link.from]);
      if (matches.length > 1) return failure("ambiguous", "Several identical link lines exist.", "Edit the record body to leave one, then retry.", [link.from]);
      const removed = await ctx.connection.write(`blocks delete --id ${matches[0]!.id}`); if (!removed.ok) return removed;
      const after = await ctx.readBlock(link.from.id, 1);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the linking record back." } };
      const verified = !(after.value.content ?? []).some(child => child.id === matches[0]!.id);
      return { ok: true, value: { affected: [link.from], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the record back; the link line may still be there." }) }, limits: [] };
    },
  };

  // ---------- checkpoints ----------
  async function systemPage(create: boolean): Promise<Result<CraftBlock | null>> {
    const host = await ctx.hostRoot(); if (!host.ok) return host;
    if (!host.value) return failure("unavailable", "The host document is not configured.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
    const root = await ctx.readBlock(host.value, 1); if (!root.ok) return root;
    const existing = (root.value.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === SYSTEM_TITLE);
    if (existing) { const page = await ctx.readBlock(existing.id, 1); return page.ok ? page : page; }
    if (!create) return { ok: true, value: null, limits: [] };
    const payload = jsonArgument([{ type: "page", markdown: SYSTEM_TITLE, content: [{ type: "text", markdown: "GPK keeps processing checkpoints here; the Agent reads and writes them." }] }]);
    const added = await ctx.connection.write(`blocks add --id ${host.value} --json '${payload}'`); if (!added.ok) return added;
    const id = added.value.match(/IDs: <([^>]+)>/)?.[1];
    if (!id) return failure("uncertain", "Craft did not report the created system page.", "Read the host document to find it.");
    return ctx.readBlock(id, 1);
  }

  const checkpoints: ProcessingCheckpoints = {
    async read(key) {
      if (!key.trim()) return failure("invalid", "A checkpoint key must be nonblank.", "Use the workflow's logical key.");
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const page = await systemPage(false); if (!page.ok) return page;
      const entry = (page.value?.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === key.trim());
      if (!entry) return { ok: true, value: null, limits: [] };
      const block = await ctx.readBlock(entry.id, 1); if (!block.ok) return block;
      return { ok: true, value: { ref: { scope: scoped.value.id, id: entry.id }, value: ctx.bodyOf(block.value), version: ctx.digestOf(block.value), coverage: "complete" }, limits: [] };
    },
    async save(key, content, guard) {
      if (!key.trim()) return failure("invalid", "A checkpoint key must be nonblank.", "Use the workflow's logical key.");
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const granted = await ctx.authorizeRoot(guard, "checkpoints.save", "system"); if (!granted.ok) return granted;
      const page = await systemPage(true); if (!page.ok) return page;
      if (!page.value) return failure("uncertain", "The system page could not be read after creation.", "Retry.");
      const entry = (page.value.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === key.trim());
      let entryId: string;
      if (entry) {
        const current = await ctx.readBlock(entry.id, 1); if (!current.ok) return current;
        if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) return failure("conflict", "The checkpoint changed since it was read.", "Read it again and retry.", [{ scope: scoped.value.id, id: entry.id }]);
        const children = current.value.content ?? [];
        if (children.length) {
          const removed = await ctx.connection.write(`blocks delete --ids ${children.map(child => child.id).join(",")}`);
          if (!removed.ok) return { ok: false, error: { ...removed.error, code: "partial", affected: [{ scope: scoped.value.id, id: entry.id }], next: "The old checkpoint content may remain; read it back." } };
        }
        entryId = entry.id;
      } else {
        if (guard.expected !== undefined) return failure("conflict", "No checkpoint exists for this key, but expected was supplied.", "Omit expected for the first save.");
        const payload = jsonArgument([{ type: "page", markdown: key.trim(), content: [] }]);
        const added = await ctx.connection.write(`blocks add --id ${page.value.id} --json '${payload}'`); if (!added.ok) return added;
        const id = added.value.match(/IDs: <([^>]+)>/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the created checkpoint page.", "Read the system page to find it.");
        entryId = id;
      }
      if (content.length) {
        const written = await ctx.connection.write(`blocks add --id ${entryId} --markdown ${JSON.stringify(content)}`);
        if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [{ scope: scoped.value.id, id: entryId }], next: "The checkpoint page exists without its content; save again." } };
      }
      const after = await ctx.readBlock(entryId, 1);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: "Read the checkpoint back." } };
      const verified = ctx.bodyOf(after.value).trim() === content.trim();
      return { ok: true, value: { affected: [{ scope: scoped.value.id, id: entryId }], verified, version: ctx.digestOf(after.value), ...(verified ? {} : { recovery: "Read the checkpoint back and compare." }) }, limits: content.length ? [] : ["Empty content is stored as a page without blocks."] };
    },
  };

  return { sources, wikis, outputs, links, checkpoints, relatedIds, listDocuments };
}
