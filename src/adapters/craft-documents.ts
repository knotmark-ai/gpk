import type { AreaRef, Output, OutputRef, ProjectRef, Ref, Source, SourceRef, TaskRef, Wiki, WikiRef } from "../domain/entities.js";
import type {
  ContentUpdate, KnowledgeLink, KnowledgeLinks, OutputOperations, SourceInput, SourceOperations, SourceUpdate, WikiOperations,
} from "../domain/knowledge-backend-port.js";
import type { CreateReceipt, Failure, GrantedWriteGuard, Page, ReadOptions, Result, Snapshot, WriteReceipt } from "../domain/operation-types.js";
import { readCursor, queryPage } from "./craft-pagination.js";
import type { KnowledgeLayout } from "../domain/user-control-port.js";
import type { CraftBlock, CraftContext, TaskContainer, createCollectionOperations } from "./craft-collections.js";

/**
 * Sources, Wikis and Outputs as documents in the folders Setup established, plus
 * contextual links written into the linking entity's body.
 */
type LinkEndpoint = AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
type DocumentKind = "Source" | "Wiki" | "Output";
type DocumentRole = "source" | "wiki" | "output";
type DocumentRef = SourceRef | WikiRef | OutputRef;

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const LINK_LINE = /^\s*(?:[-*]|\d+\.)\s*\[(.*?)\]\(block:\/\/([0-9a-fA-F-]{36})\)\s*(?:[—:-]\s*(.*))?$/;
const LINKS_HEADING = /^#{1,6}\s*links\s*$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LISTING_PAGES = 50;

/** Plain empty paragraphs may remain in a new Craft document. Keep them in Craft
 * and omit them only when checking the contents of a document during recovery. */
export function sourceRecoveryBlocks(page: CraftBlock): CraftBlock[] {
  return (page.content ?? []).filter(block => {
    const blankParagraph = block.type === "text"
      && (!block.textStyle || block.textStyle === "body")
      && (!block.listStyle || block.listStyle === "none")
      && !(block.markdown ?? "").trim() && !(block.title ?? "").trim()
      && !block.content?.length && !block.items?.length && !block.nextCursor
      && !block.taskInfo && !Object.keys(block.properties ?? {}).length;
    return !blankParagraph;
  });
}

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

function parseLinkLine(markdown: string): { title: string; id: string; context: string } | null {
  const match = markdown.match(LINK_LINE);
  return match ? { title: match[1]!, id: match[2]!.toLowerCase(), context: (match[3] ?? "").trim() } : null;
}

function renderLinkLine(title: string, id: string, context: string): string {
  return `- [${title.replace(/[\[\]]/g, "").replace(/[\r\n]+/g, " ")}](block://${id}) — ${context.trim()}`;
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

  /** Every document in a folder and its subfolders. */
  async function listDocuments(folderId: string, refresh = true): Promise<Result<Listed[]>> {
    const folders = await ctx.folderWithDescendants(folderId, refresh);
    if (!folders.ok) return folders;
    const rows: Listed[] = [];
    const seen = new Set<string>();
    const collect = (text: string) => {
      for (const line of text.split("\n")) {
        const match = line.match(/^\s*<([^>]+)>\s+(.*)$/);
        if (match && !seen.has(match[1]!.toLowerCase())) { seen.add(match[1]!.toLowerCase()); rows.push({ id: match[1]!, title: match[2]!.trim() }); }
      }
    };
    for (let start = 0; start < folders.value.length; start += 20) {
      const batch = folders.value.slice(start, start + 20);
      const listing = await ctx.connection.read(batch.map(id => `documents list --folder ${id}`).join("; "));
      if (!listing.ok) return listing.error.code === "invalid" ? failure("not-found", "The configured folder is not listable.", "Rerun Setup inspect to repair the layout.") : listing;
      if (!/^Next page:.*--cursor\s+\S+/m.test(listing.value)) { collect(listing.value); continue; }
      for (const id of batch) {
        let command = `documents list --folder ${id}`;
        for (let page = 0; ; page++) {
          if (page >= MAX_LISTING_PAGES) return failure("unavailable", `A folder listing exceeded ${MAX_LISTING_PAGES} pages.`, "Narrow the folder or retry later.");
          const single = await ctx.connection.read(command);
          if (!single.ok) return single;
          collect(single.value);
          const next = single.value.match(/^Next page:.*--cursor\s+(\S+)\s*$/m)?.[1];
          if (!next) break;
          command = `documents list --folder ${id} --cursor ${next}`;
        }
      }
    }
    return { ok: true, value: rows, limits: [] };
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

  async function search(text: string): Promise<Result<{ hits: { documentId: string; blockIds: string[] }[]; truncated: boolean }>> {
    const hits: { documentId: string; blockIds: string[] }[] = [];
    let command = `search --include ${JSON.stringify(text)}`;
    let truncated = false;
    for (let page = 0; page < 10; page++) {
      const result = await ctx.connection.read(command);
      if (!result.ok) return result;
      let current: { documentId: string; blockIds: string[] } | null = null;
      for (const line of result.value.split("\n")) {
        const doc = line.match(/^\s*\d+\)\s+Document\s+<([^>]+)>/);
        if (doc) { current = { documentId: doc[1]!, blockIds: [] }; hits.push(current); continue; }
        const blocks = line.match(/^\s+Blocks:\s+(.*)$/);
        if (blocks && current) current.blockIds.push(...(blocks[1]!.match(new RegExp(UUID.source, "g")) ?? []));
      }
      const next = result.value.match(/^Next page:.*--cursor\s+"?([^"\s]+)"?\s*$/m)?.[1];
      if (!next) return { ok: true, value: { hits, truncated: false }, limits: [] };
      if (page === 9) truncated = true;
      command = `search --include ${JSON.stringify(text)} --cursor ${next}`;
    }
    return { ok: true, value: { hits, truncated }, limits: [] };
  }

  function documentEntity<K extends DocumentKind, R extends DocumentRef, V extends { title: string; content: string }>(kind: K, role: DocumentRole, operation: (name: string) => string) {
    const project = (block: CraftBlock): V => ({ title: block.markdown ?? "", content: ctx.bodyOf(block) } as V);
    const verify = async (ref: R, folderId: string, predicate: (value: V, block: CraftBlock) => boolean, recovery: string): Promise<Result<WriteReceipt>> => {
      const after = await readDocument(ref, kind, folderId);
      if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", next: recovery } };
      const verified = predicate(project(after.value), after.value);
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
        return { ok: true, value: { ref, value: project(block.value), version: ctx.digestOf(block.value), coverage: ctx.contentCoverage(block.value) }, limits: [] };
      },
      async query(query: ReadOptions & { text?: string; relatedTo?: LinkEndpoint }): Promise<Result<Page<Snapshot<V, R>>>> {
        const scoped = await ctx.space(); if (!scoped.ok) return scoped;
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const limit = query.limit ?? DEFAULT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
        const key = JSON.stringify([role, scoped.value.id, query.text ?? null, query.relatedTo ?? null]);
        const cursor = readCursor(query.cursor, key); if (!cursor.ok) return cursor;
        const offset = cursor.value.offset;
        const listed = await listDocuments(folder.value); if (!listed.ok) return listed;
        let candidates = listed.value;
        const limits: string[] = [];
        if (query.relatedTo) {
          const related = await relatedIds(query.relatedTo); if (!related.ok) return related;
          candidates = candidates.filter(row => related.value.ids.has(row.id.toLowerCase()));
          limits.push(...related.value.limits);
        }
        let scanned: Map<string, CraftBlock> | null = null;
        const omitted: string[] = [];
        if (query.text) {
          const needle = query.text.toLowerCase();
          const read = await ctx.readBlocks(candidates.map(row => row.id), 1); if (!read.ok) return read;
          scanned = read.value;
          candidates = candidates.filter(row => {
            const block = read.value.get(row.id.toLowerCase());
            if (!block) { omitted.push(row.id); return false; }
            const value = project(block);
            const matched = value.title.toLowerCase().includes(needle) || value.content.toLowerCase().includes(needle);
            if (!matched && ctx.contentCoverage(block) !== "complete") omitted.push(row.id);
            return matched;
          });
        }
        const page = candidates.slice(offset, offset + limit);
        const blocks = scanned ? { ok: true as const, value: scanned, limits: [] } : await ctx.readBlocks(page.map(row => row.id), 1); if (!blocks.ok) return blocks;
        const items: Snapshot<V, R>[] = [];
        const unreadable: string[] = [...omitted];
        for (const row of page) {
          const block = blocks.value.get(row.id.toLowerCase()); if (!block) { unreadable.push(row.id); continue; }
          items.push({ ref: { kind, scope: scoped.value.id, id: row.id } as R, value: project(block), version: ctx.digestOf(block), coverage: ctx.contentCoverage(block) });
        }
        const next = offset + limit;
        const result = queryPage(items, key, next < candidates.length ? next : undefined, cursor.value.incomplete || !!query.relatedTo, unreadable.map(id => ({ scope: scoped.value.id, id })));
        if (unreadable.length) limits.push(`Listed but unreadable or partial during the query and omitted: ${unreadable.join(", ")}.`);
        return { ok: true, value: result, limits };
      },
      async create(input: { title: string; content: string; originalFile?: string }, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<R>>> {
        const scoped = await ctx.space(); if (!scoped.ok) return scoped;
        const folder = await folderOf(role); if (!folder.ok) return folder;
        if (guard.expected !== undefined) return failure("invalid", "expected must be omitted when creating.", "Remove expected.");
        if (!input.title.trim() || /[\r\n]/.test(input.title)) return failure("invalid", `A ${kind} needs a single-line nonblank title.`, "Supply the title.");
        if (input.originalFile !== undefined && kind !== "Source") return failure("invalid", "originalFile is supported only on Sources.", "Omit originalFile.");
        const granted = await ctx.authorizeRoot(guard, operation("create"), folder.value); if (!granted.ok) return granted;
        const checked = await ctx.checkBody(input.content); if (!checked.ok) return checked;
        const created = await ctx.connection.write(`documents create --title ${JSON.stringify(input.title.trim())} --folder ${folder.value}`);
        if (!created.ok) return created;
        const id = created.value.match(/rootBlockId:\s*(\S+)/)?.[1];
        if (!id) return failure("uncertain", "Craft did not report the created document's root block.", `List ${kind}s to find the new document before retrying.`);
        const ref = { kind, scope: scoped.value.id, id } as R;
        if (input.content.trim()) {
          const body = await ctx.writeBody(id, input.content);
          if (!body.ok) return { ok: false, error: { ...body.error, code: "partial", affected: [ref], next: `The ${kind} exists but its body is missing or incomplete: ${body.error.next}` } };
        }
        const verified = await verify(ref, folder.value, value => value.title === input.title.trim(), `The ${kind} was created; read it back and adjust.`);
        if (!verified.ok) return verified;
        if (input.originalFile !== undefined && verified.value.version) {
          const attached = await ctx.attachOriginal(ref, input.originalFile, verified.value.version);
          if (!attached.ok) {
            return {
              ok: false,
              error: {
                ...attached.error, code: "partial", affected: [ref],
                completedSteps: ["sources.create"], failedStep: "sources.originalFile",
                next: `Source ${ref.id} was created, but attaching originalFile failed: ${attached.error.message} ${attached.error.next}`,
              },
            };
          }
          return { ok: true, value: { ...attached.value, created: ref }, limits: verified.limits };
        }
        return { ok: true, value: { ...verified.value, created: ref }, limits: [] };
      },
      async update(ref: R, update: ContentUpdate & { originalFile?: string }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>> {
        const hasEdits = Boolean(update.edits?.length);
        const hasAppend = update.append !== undefined && update.append.trim().length > 0;
        const hasReplace = update.replaceContent !== undefined;
        const hasOriginal = update.originalFile !== undefined;
        if (!hasOriginal && !hasReplace && update.title === undefined && !hasEdits && !hasAppend) {
          return failure("invalid", "Supply a title, edits, append, replaceContent or originalFile.", "Nothing to change.");
        }
        if (update.title !== undefined && (!update.title.trim() || /[\r\n]/.test(update.title))) {
          return failure("invalid", `A ${kind} title must be one nonblank line.`, "Supply the title.");
        }
        const folder = await folderOf(role); if (!folder.ok) return folder;
        const granted = await ctx.authorizeRoot(guard, operation("update"), folder.value, ref); if (!granted.ok) return granted;
        const current = await readDocument(ref, kind, folder.value); if (!current.ok) return current;
        if (guard.expected !== undefined && guard.expected !== ctx.digestOf(current.value)) {
          return failure("conflict", `The ${kind} changed since it was read.`, "Read it again and reapply the change.", [ref]);
        }
        if (hasOriginal) {
          if (kind !== "Source" || !guard.expected || hasEdits || hasAppend || update.title !== undefined || hasReplace) {
            return failure("invalid", "Attaching an original requires only its file URL and the latest Source version.", "Read the Source and retry.");
          }
          return ctx.attachOriginal(ref, update.originalFile!, guard.expected);
        }
        if (hasReplace) {
          const body = update.replaceContent!;
          if (!body.trim() || !guard.expected || update.title !== undefined || hasEdits || hasAppend) {
            return failure("invalid", "Body recovery/replacement needs nonblank content and the latest version alone.", "Read the record completely and retry replaceContent alone.");
          }
          if (ctx.contentCoverage(current.value) !== "complete") {
            return failure("conflict", `Cannot replace a partially read ${kind}.`, "Read the full record before retrying.", [ref]);
          }
          const existing = sourceRecoveryBlocks(current.value);
          if (ctx.matchesBody(existing, body)) {
            return { ok: true, value: { affected: [ref], version: guard.expected, verified: true }, limits: [] };
          }
          if (existing.length) {
            return failure("conflict", `The ${kind} already has different content (block types: ${[...new Set(existing.map(block => block.listStyle ?? block.textStyle ?? block.type))].join(", ")}).`, "Inspect its existing blocks before editing.", [ref]);
          }
          const written = await ctx.writeBody(ref.id, body, guard.expected);
          if (!written.ok) return { ok: false, error: { ...written.error, affected: [ref], next: `Read this ${kind} again before retrying replaceContent.` } };
          return verify(ref, folder.value, (_value, block) => ctx.contentCoverage(block) === "complete" && (written.value.mediaVersion ? ctx.digestOf(block) === written.value.mediaVersion : ctx.matchesBody(sourceRecoveryBlocks(block), body)), `Read and compare the recovered ${kind}.`);
        }
        if (hasAppend) {
          const checked = await ctx.checkBody(update.append!); if (!checked.ok) return checked;
        }
        const plans = ctx.planEdits(current.value, update.edits ?? [], ref); if (!plans.ok) return plans;
        if (update.title !== undefined) {
          const renamed = await ctx.connection.write(`blocks update --id ${ref.id} --markdown ${JSON.stringify(update.title.trim())}`);
          if (!renamed.ok) return renamed;
        }
        if (hasEdits) {
          const written = await ctx.writeEdits(plans.value);
          if (!written.ok) return { ok: false, error: { ...written.error, code: "partial", affected: [ref], next: `Some edits were applied; read the ${kind} back before retrying the rest.` } };
        }
        if (hasAppend) {
          const appended = await ctx.writeBody(ref.id, update.append!);
          if (!appended.ok) return { ok: false, error: { ...appended.error, code: (update.title !== undefined || hasEdits) ? "partial" : appended.error.code, affected: [ref], next: `Read the ${kind} back before retrying the append.` } };
        }
        return verify(ref, folder.value, (value, block) => (update.title === undefined || value.title === update.title.trim()) && (!hasEdits || ctx.editsApplied(block, plans.value)), `Read the ${kind} back and compare.`);
      },
    };
  }

  const sources: SourceOperations = documentEntity<"Source", SourceRef, Source>("Source", "source", name => `sources.${name}`) as SourceOperations & { create: (input: SourceInput, guard: GrantedWriteGuard) => Promise<Result<CreateReceipt<SourceRef>>>; update: (ref: SourceRef, update: SourceUpdate, guard: GrantedWriteGuard) => Promise<Result<WriteReceipt>> };
  const wikis: WikiOperations = documentEntity<"Wiki", WikiRef, Wiki>("Wiki", "wiki", name => `wikis.${name}`);
  const outputs: OutputOperations = documentEntity<"Output", OutputRef, Output>("Output", "output", name => `outputs.${name}`);

  // ---------- links ----------
  type Classified = { kind: LinkEndpoint["kind"]; id: string; rootId: string; title: string };

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

  async function endpoint(ref: LinkEndpoint, records: Map<string, Classified>): Promise<Result<{ block: CraftBlock; rootId: string; title: string; container?: TaskContainer }>> {
    const scoped = await ctx.space(); if (!scoped.ok) return scoped;
    if (ref.scope !== scoped.value.id || !UUID.test(ref.id)) return failure("invalid", "The reference is not a record in the bound Craft space.", "Resolve it in this space first.", [ref]);
    if (ref.kind === "Task") {
      const container = await ctx.taskContainer(ref); if (!container.ok) return container;
      const block = await ctx.readBlock(ref.id, 1); if (!block.ok) return block;
      if (block.value.listStyle !== "task") return failure("invalid", "The block is not a task block.", "Resolve the Task again.", [ref]);
      const parsed = block.value.markdown?.replace(/^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX-]\]\s*)?/, "").replace(/\s*#gpk\/task\/\w+\s*$/, "").trim() ?? "";
      return { ok: true, value: { block: block.value, rootId: container.value.key, title: parsed, container: container.value }, limits: [] };
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
    const rowIds = [...records.value.values()].filter(r => r.kind === "Area" || r.kind === "Project").map(r => r.id);
    let docIds = [...records.value.values()].filter(r => r.kind !== "Area" && r.kind !== "Project").map(r => r.id);
    const title = own.value.title.trim();
    const found = title ? await search(title) : null;
    if (found?.ok) {
      const hitDocs = new Set(found.value.hits.map(hit => hit.documentId.toLowerCase()));
      docIds = docIds.filter(id => hitDocs.has(id.toLowerCase()));
      limits.push("Incoming links were found by searching the target's title; a link whose visible text no longer matches the title is missed.");
      if (found.value.truncated) limits.push("Title search exceeded 10 pages; some incoming links may be omitted.");
    } else if (found) {
      limits.push(`Search was unavailable (${found.error.message}); every GPK record body was scanned instead.`);
    }
    const requestedIds = new Set([...rowIds, ...docIds].map(id => id.toLowerCase()));
    const rows = await ctx.readBlocks(rowIds, 2); if (!rows.ok) return rows;
    const docs = await ctx.readBlocks(docIds, 1); if (!docs.ok) return docs;
    const bodies: { from: LinkEndpoint; block: CraftBlock }[] = [];
    for (const record of records.value.values()) {
      if (!requestedIds.has(record.id.toLowerCase())) continue;
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
    limits.push("Links written by standalone Tasks in Daily Notes are not found.");
    return { ok: true, value: { outgoing, incoming, limits }, limits: [] };
  }

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
      if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT)) {
        return failure("invalid", `limit must be an integer from 1 to ${MAX_LIMIT}.`, "Adjust the limit.");
      }
      const found = await discover(ref); if (!found.ok) return found;
      const all = [...found.value.outgoing.map(entry => entry.link), ...found.value.incoming];
      const items = options?.limit ? all.slice(0, options.limit) : all;
      return { ok: true, value: { items, coverage: "partial" }, limits: found.value.limits };
    },
    async add(link, guard) {
      if (!link.context.trim() || /[\r\n]/.test(link.context)) return failure("invalid", "A link needs a nonblank, single-line context.", "Explain the relationship in one line.");
      const prose = ctx.checkProse(link.context); if (!prose.ok) return prose;
      if (link.from.scope !== link.to.scope) return failure("invalid", "Both endpoints must be in the same space.", "Resolve both in this space.");
      if (link.from.id.toLowerCase() === link.to.id.toLowerCase()) return failure("invalid", "A record cannot link to itself.", "Choose another target.");
      const records = await inventory(); if (!records.ok) return records;
      const from = await endpoint(link.from, records.value); if (!from.ok) return from;
      const to = await endpoint(link.to, records.value); if (!to.ok) return to;
      const granted = from.value.container ? await ctx.authorizeContainer(guard, "links.add", from.value.container, link.from) : await ctx.authorizeRoot(guard, "links.add", from.value.rootId, link.from); if (!granted.ok) return granted;
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
      const granted = from.value.container ? await ctx.authorizeContainer(guard, "links.remove", from.value.container, link.from) : await ctx.authorizeRoot(guard, "links.remove", from.value.rootId, link.from); if (!granted.ok) return granted;
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

  return { sources, wikis, outputs, links, relatedIds };
}
