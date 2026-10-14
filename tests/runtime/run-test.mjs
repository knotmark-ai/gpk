#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gpk-runtime-"));
const probe = buildSync({
  absWorkingDir: repo,
  stdin: { contents: [
    'export { createCraftAdapter, parseTaskListing, parseActionLine } from "./src/adapters/craft.ts";',
    'export { createLocalControlAdapter, resolveControlRoot } from "./src/adapters/local-control.ts";',
    'export { memorySecretStore, fileSecretStore } from "./src/adapters/secret-store.ts";',
    'export { createCraftConnection } from "./src/adapters/craft-connection.ts";',
    'export { createOperations } from "./src/runtime/operations.ts";',
    'export { bootstrap } from "./src/runtime/bootstrap.ts";',
    'export { createOnboarding } from "./src/onboarding/server.ts";',
    'export { reviewInventory } from "./src/runtime/review.ts";',
    'export { configureDebugLog, debug, redact } from "./src/runtime/debug-log.ts";',
  ].join("\n"), resolveDir: repo, loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, loader: { ".md": "text", ".html": "text" },
});
const { createCraftAdapter, parseTaskListing, parseActionLine, createLocalControlAdapter, resolveControlRoot, memorySecretStore, fileSecretStore, createCraftConnection, createOperations, bootstrap, createOnboarding, reviewInventory, configureDebugLog, debug, redact } =
  await import(`data:text/javascript;base64,${Buffer.from(probe.outputFiles[0].contents).toString("base64")}`);

const SPACE = { id: "space-1", name: "Test Space", timezone: "Asia/Shanghai" };
const settings = {
  schemaVersion: 1,
  preferences: { workingLanguage: "en", metadataLanguage: "en", timezone: null, profileWiki: null, instructions: "" },
  knowledgeBackend: { activeId: "primary", configurations: [{
    id: "primary", adapter: "craft", instance: SPACE.id,
    connection: { kind: "mcp", transport: "http", endpoint: { kind: "public-url", url: "https://mcp.craft.do/my/mcp" } },
    layout: { locations: { area: { scope: SPACE.id, id: "a" }, project: { scope: SPACE.id, id: "p" }, source: { scope: SPACE.id, id: "s" }, wiki: { scope: SPACE.id, id: "w" }, output: { scope: SPACE.id, id: "o" } } },
  }] },
  templates: { area: null, project: null, task: null, source: null, wiki: null, output: null },
  ingestion: { automatic: { enabled: false, origins: [], dailyNotes: false } },
};
const grants = { schemaVersion: 1, grants: [
  { id: "daily", backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.create", "tasks.update", "tasks.transition", "tasks.schedule"], unattended: false },
] };

// ---------- local control adapter ----------
{
  const root = path.join(temporary, "control");
  const control = createLocalControlAdapter({ root });
  assert.equal(resolveControlRoot({ HOME: "/home/x" }), path.join("/home/x", ".gpk"));
  assert.equal(resolveControlRoot({ GPK_CONTROL_ROOT: "/explicit/.gpk", HOME: "/home/x" }), "/explicit/.gpk");
  let read = await control.settings.read();
  assert.deepEqual([read.ok, read.value], [true, null], "missing root reads as never initialized");
  const discovered = await control.discover({ provider: "local-files", instance: root, location: root });
  assert.deepEqual([discovered.ok, discovered.value.items, discovered.value.coverage], [true, [], "complete"]);
  assert.equal((await control.discover({ provider: "other", instance: root, location: root })).error.code, "unsupported");
  assert.equal((await control.discover({ provider: "local-files", instance: root, location: "/elsewhere" })).error.code, "unauthorized");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "settings.json"), "{not json");
  read = await control.settings.read();
  assert.equal(read.error.code, "invalid", "malformed settings are invalid, not defaults");
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ ...settings, knowledgeBackend: { ...settings.knowledgeBackend, activeId: "missing" } }));
  assert.match((await control.settings.read()).error.message, /activeId/);
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(settings));
  read = await control.settings.read();
  assert.equal(read.ok, true);
  assert.equal(read.value.coverage, "complete");
  assert.match(read.value.version, /^sha256:[0-9a-f]{64}$/);
  assert.equal(read.value.value.knowledgeBackend.activeId, "primary");
  let listed = await control.grants.list();
  assert.deepEqual([listed.ok, listed.value.items], [true, []], "missing grants file means no grants");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [{ id: "x", backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["*"], unattended: false }] }));
  assert.equal((await control.grants.list()).error.code, "invalid", "wildcard operations are rejected");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify(grants));
  listed = await control.grants.list();
  assert.equal(listed.value.items.length, 1);
  assert.deepEqual(listed.value.items[0].value.operations, grants.grants[0].operations);
  assert.equal(listed.value.items[0].ref.id, "grant:daily");
  const capabilities = await control.capabilities();
  assert.equal(capabilities.value["control.settings.read"].mode, "native");
  console.log("PASS: local control reads settings and grants from a .gpk root without repairing them");

  // Writes: initialize refuses an existing record; update is a named patch; grants append/remove.
  assert.equal((await control.settings.initialize({ knowledgeBackend: settings.knowledgeBackend }, {})).error.code, "conflict");
  const fresh = path.join(temporary, "fresh-control");
  const freshControl = createLocalControlAdapter({ root: fresh, knownOperations: async () => ["tasks.create", "tasks.update"] });
  assert.equal((await freshControl.settings.initialize({ knowledgeBackend: settings.knowledgeBackend }, { expected: "x" })).error.code, "invalid");
  assert.equal((await freshControl.settings.initialize({ knowledgeBackend: { activeId: "nope", configurations: [] } }, {})).error.code, "invalid");
  const initialized = await freshControl.settings.initialize({ knowledgeBackend: settings.knowledgeBackend, preferences: { workingLanguage: "zh-CN" } }, {});
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  assert.equal(initialized.value.verified, true);
  let current = await freshControl.settings.read();
  assert.equal(current.value.value.preferences.workingLanguage, "zh-CN");
  assert.equal(current.value.value.preferences.metadataLanguage, "en", "metadata language defaults independently");
  assert.equal(current.value.value.preferences.timezone, null, "declared defaults are materialized");
  assert.deepEqual(current.value.value.templates, { area: null, project: null, task: null, source: null, wiki: null, output: null });
  assert.equal(fs.readdirSync(fresh).filter(f => f.endsWith(".tmp")).length, 0, "temporary files are renamed away");
  assert.equal((await freshControl.settings.update({ preferences: { workingLanguage: "zh-CN" } }, {})).error.code, "invalid", "no-op updates are rejected");
  assert.equal((await freshControl.settings.update({ preferences: { instructions: "x" } }, { expected: "sha256:stale" })).error.code, "conflict");
  const updated = await freshControl.settings.update({ preferences: { instructions: "Prefer concise answers." }, ingestion: { automatic: { dailyNotes: true } } }, { expected: current.value.version });
  assert.equal(updated.value.verified, true);
  current = await freshControl.settings.read();
  assert.equal(current.value.value.preferences.instructions, "Prefer concise answers.");
  assert.equal(current.value.value.ingestion.automatic.dailyNotes, true);
  assert.equal(current.value.value.preferences.workingLanguage, "zh-CN", "omitted fields are preserved");
  assert.equal((await freshControl.grants.grant({ backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.remove"], unattended: false }, {})).error.code, "invalid", "unknown operations are rejected");
  const granted = await freshControl.grants.grant({ backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.create"], unattended: false }, {});
  assert.equal(granted.value.verified, true);
  assert.match(granted.value.created.id, /^grant:g-/);
  let grantsNow = await freshControl.grants.list();
  assert.equal(grantsNow.value.items.length, 1);
  assert.equal((await freshControl.grants.revoke({ scope: grantsNow.value.items[0].ref.scope, id: "grant:missing" }, {})).error.code, "not-found");
  const revoked = await freshControl.grants.revoke(grantsNow.value.items[0].ref, { expected: grantsNow.value.items[0].version });
  assert.equal(revoked.value.verified, true);
  grantsNow = await freshControl.grants.list();
  assert.equal(grantsNow.value.items.length, 0);
  console.log("PASS: local control initializes, patches and grants through atomic file writes with digest checks");
}

// Review finding 2: two clients on one root serialize their read/modify/write.
{
  const root = path.join(temporary, "shared-control");
  const known = async () => ["tasks.create", "tasks.update"];
  const first = createLocalControlAdapter({ root, knownOperations: known });
  const second = createLocalControlAdapter({ root, knownOperations: known });
  const grantOf = id => ({ backendId: "primary", root: { scope: SPACE.id, id }, operations: ["tasks.create"], unattended: false });
  const old = await first.grants.grant(grantOf("old"), {});
  assert.equal(old.ok, true, JSON.stringify(old));
  const [revoked, added] = await Promise.all([first.grants.revoke(old.value.created, {}), second.grants.grant(grantOf("new"), {})]);
  assert.deepEqual([revoked.ok, added.ok], [true, true]);
  let roots = (await first.grants.list()).value.items.map(item => item.value.root.id);
  assert.deepEqual(roots, ["new"], "a concurrent grant neither resurrects the revoked grant nor is lost");
  const many = await Promise.all(["a", "b", "c", "d"].map((id, index) => (index % 2 ? first : second).grants.grant(grantOf(id), {})));
  assert.ok(many.every(result => result.ok));
  roots = (await second.grants.list()).value.items.map(item => item.value.root.id).sort();
  assert.deepEqual(roots, ["a", "b", "c", "d", "new"], "concurrent grants are all kept");
  assert.equal((await first.settings.initialize({ knowledgeBackend: settings.knowledgeBackend }, {})).ok, true);
  await Promise.all([
    first.settings.update({ preferences: { instructions: "Be brief." } }, {}),
    second.settings.update({ preferences: { workingLanguage: "zh-CN" } }, {}),
  ]);
  const merged = (await first.settings.read()).value.value.preferences;
  assert.deepEqual([merged.instructions, merged.workingLanguage], ["Be brief.", "zh-CN"], "concurrent Settings updates both land");
  assert.equal(fs.existsSync(path.join(root, ".control.lock")), false, "the lock is released");
  fs.writeFileSync(path.join(root, ".control.lock"), "stale");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(root, ".control.lock"), past, past);
  assert.equal((await first.grants.grant(grantOf("after-crash"), {})).ok, true, "a stale lock left by a crashed writer is broken");
  console.log("PASS: concurrent control writers serialize through a lock file without losing or resurrecting grants");
}

// Review finding 7: a hand-edited connection without an endpoint is invalid Settings, not an exception.
{
  const root = path.join(temporary, "no-endpoint");
  fs.mkdirSync(root, { recursive: true });
  const broken = structuredClone(settings);
  delete broken.knowledgeBackend.configurations[0].connection.endpoint;
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(broken));
  const read = await createLocalControlAdapter({ root }).settings.read();
  assert.equal(read.error.code, "invalid");
  assert.match(read.error.message, /connection\.endpoint/);
  const noLocations = structuredClone(settings);
  delete noLocations.knowledgeBackend.configurations[0].layout.locations.wiki;
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(noLocations));
  assert.match((await createLocalControlAdapter({ root }).settings.read()).error.message, /layout\.locations\.wiki/);
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(broken));
  const runtime = bootstrap({ env: { GPK_CONTROL_ROOT: root, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fakeCraft().connection });
  const status = await runtime.operations.tasksQuery({});
  assert.equal(status.ok, false);
  assert.equal(status.error.code, "invalid", "the runtime reports invalid Settings instead of throwing");
  await runtime.close();
  console.log("PASS: a connection without an endpoint is rejected as invalid Settings and the runtime does not throw");
}

// ---------- fake Craft connection with the observed command surface ----------
function fakeCraft() {
  const tasks = new Map();
  const calls = [];
  let nextId = 1;
  const id = () => `aaaaaaaa-0000-0000-0000-${String(nextId++).padStart(12, "0")}`;
  const mark = task => task.state === "done" ? "x" : task.state === "canceled" ? "-" : " ";
  const lineOf = task => task.state === "canceled" ? `- [ ] ~${task.line}~` : `- [${task.state === "done" ? "x" : " "}] ${task.line}`;
  const whereOf = task => task.container.kind === "inbox" ? "inbox" : task.container.kind === "daily-note" ? `daily note ${task.container.date}` : `GPK <${task.container.rootId}>`;
  // Collection rows: { id, title, properties, children: [{ id, type, markdown, taskId?, children? }] }
  const rowOf = itemId => { for (const c of collections.values()) { const row = (c.rows ?? []).find(r => r.id === itemId); if (row) return { c, row }; } return null; };
  const rowJson = (row, depth) => ({
    id: row.id, type: "collectionItem", title: row.title, markdown: row.title,
    properties: { status: row.properties.status, ...(row.properties.area ? { area: { relations: [{ blockId: row.properties.area }] } } : {}) },
    metadata: { lastModifiedAt: row.modified ?? "2026-10-11T00:00:00.000+08:00" },
    ...(depth > 0 ? { content: row.children.map(child => child.taskId ? blockJson(tasks.get(child.taskId), depth - 1) : { id: child.id, type: child.type, markdown: child.markdown, ...(child.textStyle ? { textStyle: child.textStyle } : {}) }) } : {}),
  });
  const pageOf = blockId => { for (const c of collections.values()) for (const row of c.rows ?? []) { const page = row.children.find(ch => ch.id === blockId && ch.type === "page"); if (page) return page; } return null; };
  const insertAfter = (row, siblingId, child) => { const i = row.children.findIndex(ch => (ch.taskId ?? ch.id) === siblingId); row.children.splice(i + 1, 0, child); };
  const addToRow = (row, markdown, position = "end", siblingId = null) => {
    let child;
    const taskLine = markdown.match(/^- \[([ x])\] (.*)$/);
    if (taskLine) {
      const task = seed(taskLine[2], taskLine[1] === "x" ? "done" : "todo", { kind: "project", itemId: row.id, rootId: rowOf(row.id).c.documentId }, undefined);
      child = { id: task.id, taskId: task.id };
    } else {
      // Craft splits paragraphs into sibling blocks; the receipt names the first.
      const blocks = markdown.split(/\n\s*\n/).filter(Boolean).map(text => ({ id: id(), type: "text", markdown: text, ...(text.startsWith("## ") ? { textStyle: "h2" } : {}) }));
      child = blocks[0];
      if (siblingId) { const i = row.children.findIndex(ch => (ch.taskId ?? ch.id) === siblingId); row.children.splice(i + 1, 0, ...blocks); }
      else if (position === "start") row.children.unshift(...blocks); else row.children.push(...blocks);
      row.modified = `2026-10-11T00:00:${String(nextId++).padStart(2, "0")}.000+08:00`;
      return child;
    }
    if (siblingId) insertAfter(row, siblingId, child); else if (position === "start") row.children.unshift(child); else row.children.push(child);
    row.modified = `2026-10-11T00:00:${String(nextId++).padStart(2, "0")}.000+08:00`;
    return child;
  };
  const detachTask = taskId => { for (const c of collections.values()) for (const row of c.rows ?? []) { const i = row.children.findIndex(ch => ch.taskId === taskId); if (i >= 0) { row.children.splice(i, 1); return row; } } return null; };
  // Documents: { title, folderId, location, body: [{ id, type, markdown, children? }] }; Craft splits paragraphs into blocks.
  const splitBlocks = markdown => markdown.split(/\n\s*\n/).filter(Boolean).map(text => ({ id: id(), type: "text", markdown: text, ...(text.startsWith("## ") ? { textStyle: "h2" } : {}) }));
  const docJson = (rootId, doc, depth) => ({ id: rootId, type: "page", textStyle: "page", markdown: doc.title, metadata: { lastModifiedAt: doc.modified ?? "2026-10-11T00:00:00.000+08:00" },
    ...(depth > 0 ? { content: (doc.body ?? []).map(b => ({ id: b.id, type: b.type, markdown: b.markdown, ...(b.textStyle ? { textStyle: b.textStyle } : {}) })) } : {}) });
  const pageInTree = (list, blockId) => { for (const b of list ?? []) { if (b.type === "page") { if (b.id === blockId) return b; const inner = pageInTree(b.children, blockId); if (inner) return inner; } } return null; };
  const nestedPageOf = blockId => { for (const doc of documents.values()) { const page = pageInTree(doc.body, blockId); if (page) return page; } return null; };
  const pageJson = (page, depth) => ({ id: page.id, type: "page", markdown: page.markdown, metadata: { lastModifiedAt: page.modified ?? "2026-10-11T00:00:00.000+08:00" },
    ...(depth > 0 ? { content: (page.children ?? []).map(b => ({ id: b.id, type: b.type ?? "text", markdown: b.markdown })) } : {}) });
  const stamp = () => `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`;
  const findInTree = (holder, list, blockId) => {
    if ((list ?? []).some(b => b.id === blockId)) return { list, touch: () => { holder.modified = stamp(); } };
    for (const page of (list ?? []).filter(b => b.type === "page")) { const found = findInTree(page, page.children, blockId); if (found) return found; }
    return null;
  };
  const ownerOfBlock = blockId => {
    for (const doc of documents.values()) { const found = findInTree(doc, doc.body, blockId); if (found) return found; }
    for (const c of collections.values()) for (const row of c.rows ?? []) { if (row.children.some(ch => (ch.taskId ?? ch.id) === blockId)) return { list: row.children, touch: () => { row.modified = `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`; } }; }
    for (const task of tasks.values()) if (task.children.some(ch => ch.id === blockId)) return { list: task.children, touch: () => touch(task) };
    return null;
  };
  const listing = (title, items) => [`Tasks (${title}): ${items.length} result(s)`, "", ...items.flatMap(task => [
    `[${mark(task)}] <${task.id}> ${lineOf(task)}`,
    ...(task.scheduleDate ? [`  (schedule: ${task.scheduleDate})`] : []),
    `  in: ${whereOf(task)}`, "",
  ])].join("\n");
  const blockJson = (task, depth) => ({
    id: task.id, type: task.children.length ? "page" : "text", listStyle: "task",
    taskInfo: { state: task.state === "doing" || task.state === "waiting" ? "todo" : task.state, ...(task.scheduleDate ? { scheduleDate: task.scheduleDate } : {}) },
    metadata: { lastModifiedAt: task.modified },
    markdown: lineOf(task),
    ...(depth > 0 ? { content: task.children.map(child => ({ id: child.id, type: "text", markdown: child.markdown })) } : {}),
  });
  const touch = task => { task.modified = `2026-10-10T00:00:${String(nextId++).padStart(2, "0")}.000+08:00`; };
  const seed = (line, state, container, scheduleDate, children = []) => {
    const task = { id: id(), line, state, container, scheduleDate, children: children.map(markdown => ({ id: id(), markdown })), modified: "2026-10-09T00:00:00.000+08:00" };
    tasks.set(task.id, task);
    return task;
  };
  const collections = new Map();
  const folders = new Map();
  const documents = new Map();
  const schemaText = c => [`Collection: "${c.name}" <${c.id}>`, "", "Item title (not a regular column):", `  ${c.title.toLowerCase()} → "${c.title}" (text, item name / row headline)`, "", "Regular columns (key -> display name):",
    ...c.columns.map(col => `  ${col.key} → "${col.name}" (${col.type})${col.options ? ` — options: ${col.options.map(o => `"${o}" (grey)`).join(", ")}` : col.type === "relation" ? ` — target collection: ${col.target}\n      Value format: {"relations": [{"blockId": "<collectionItemId>"}]}` : ""}`)].join("\n");
  const connection = {
    space: async () => ({ ok: true, value: SPACE, limits: [] }),
    status: async () => ({ endpoint: "fake", secretStore: "memory", registered: true, tokens: "verified", space: SPACE }),
    authorize: async () => ({ ok: true, value: { state: "authorized", space: SPACE }, limits: [] }),
    close: async () => undefined,
    // Craft returns at most 50 direct children per `blocks get`, with the cursor beside `data`.
    async read(command) {
      const paged = command.match(/^(blocks get (?:--id|--date) \S+ --depth -?\d+ --format json(?: --fetchMetadata)?)(?: --cursor (\d+):\S+)?$/);
      if (!paged) return connection.readFull(command);
      const full = await connection.readFull(paged[1]);
      if (!full.ok) return full;
      const parsed = JSON.parse(full.value);
      const block = parsed.data?.[0];
      if (!block?.content || block.content.length <= 50 && !paged[2]) return full;
      const offset = Number(paged[2] ?? 0);
      const all = block.content;
      block.content = all.slice(offset, offset + 50);
      if (offset + 50 < all.length) parsed.nextCursor = `${offset + 50}:${block.id}`;
      return { ok: true, value: JSON.stringify(parsed), limits: [] };
    },
    async readFull(command) {
      calls.push(["read", command]);
      if (command.includes("; ")) {
        const parts = [];
        for (const part of command.split("; ")) { const r = await connection.read(part); parts.push(r.ok ? r.value : r.error.message); }
        return { ok: true, value: parts.join("\n\n"), limits: [] };
      }
      if (command === "connection info") return { ok: true, value: JSON.stringify({ space: SPACE }), limits: [] };
      let m;
      if (command === "collections list") return { ok: true, value: [`Found ${collections.size} collections:`, "", ...[...collections.values()].map(c => `  ${c.name || "Collection"} <${c.id}> - ${c.items} items (in document ${c.documentId})`)].join("\n"), limits: [] };
      if ((m = command.match(/^collections views-list --collection (\S+)$/))) {
        const c = collections.get(m[1]); if (!c) return { ok: false, error: { code: "invalid", message: "Failed: collection not found", affected: [], next: "" } };
        const rows = [{ name: "Table", type: "table" }, ...(c.views ?? [])];
        return { ok: true, value: [`Collection views: <${c.id}>`, `Views: ${rows.length}`, "", ...rows.map(v => `  ${v.name} <${id()}> - ${v.type}`)].join("\n"), limits: [] };
      }
      if ((m = command.match(/^collections schema --collection (\S+)$/))) {
        const c = collections.get(m[1]); return c ? { ok: true, value: schemaText(c), limits: [] } : { ok: false, error: { code: "invalid", message: "Failed: collection not found", affected: [], next: "" } };
      }
      if ((m = command.match(/^folders list(?: --filter "(.*)")?(?: --offset \d+)?$/))) {
        const re = m[1] ? new RegExp(m[1], "i") : null;
        const rows = [];
        const walk = (parentId, depth) => {
          for (const f of [...folders.values()].filter(f => (f.parentId ?? null) === parentId)) {
            if (!re || re.test(f.name)) rows.push(`${"  ".repeat(depth)}* <${f.id}> ${f.name}${f.documents ? ` (${f.documents} docs)` : ""}`);
            walk(f.id, depth + 1);
          }
        };
        walk(null, 0);
        return { ok: true, value: [`Showing 1-${rows.length} of ${rows.length} folders with the following format: <folderId> Folder Name (document count)`, "", ...rows].join("\n"), limits: [] };
      }
      if ((m = command.match(/^documents list --folder (\S+)$/))) {
        const rows = [...documents.entries()].filter(([, d]) => d.folderId === m[1]).map(([id, d]) => `  <${id}> ${d.title}`);
        return { ok: true, value: [`${rows.length} document(s) — format: <rootBlockId> Title`, "", ...rows].join("\n"), limits: [] };
      }
      if ((m = command.match(/^search --include ("(?:[^"\\]|\\.)*")((?: --folder \S+)*)(?: --cursor \S+)?$/))) {
        // Case-insensitive text match over documents, Collection rows and their Tasks, grouped by document.
        const needle = JSON.parse(m[1]).toLowerCase();
        const folders = [...m[2].matchAll(/--folder (\S+)/g)].map(f => f[1]);
        const hits = new Map();
        const hit = (documentId, blockId) => { if (!hits.has(documentId)) hits.set(documentId, []); hits.get(documentId).push(blockId); };
        const walk = (documentId, list) => { for (const b of list ?? []) { if ((b.markdown ?? "").toLowerCase().includes(needle)) hit(documentId, b.id); if (b.children) walk(documentId, b.children); } };
        for (const [rootId, doc] of documents) {
          if (folders.length && !folders.includes(doc.folderId)) continue;
          if (doc.title.toLowerCase().includes(needle)) hit(rootId, rootId);
          walk(rootId, doc.body);
        }
        if (!folders.length) for (const c of collections.values()) for (const row of c.rows ?? []) {
          if (row.title.toLowerCase().includes(needle)) hit(c.documentId, row.id);
          for (const child of row.children) {
            const text = child.taskId ? [tasks.get(child.taskId).line, ...tasks.get(child.taskId).children.map(x => x.markdown)].join("\n") : child.markdown ?? "";
            if (text.toLowerCase().includes(needle)) hit(c.documentId, child.id);
          }
        }
        if (!hits.size) return { ok: true, value: "No matches found for the provided search criteria.", limits: [] };
        return { ok: true, value: [`Search results: ${hits.size} match(es)`, "", ...[...hits.entries()].flatMap(([doc, blocks], i) => [`${i + 1}) Document <${doc}>`, `   Blocks: ${blocks.join(", ")}`, ""])].join("\n"), limits: [] };
      }
      if (command === "documents list --location templates") {
        const rows = [...documents.entries()].filter(([, d]) => d.location === "templates").map(([id, d]) => `  <${id}> ${d.title}`);
        return { ok: true, value: [`${rows.length} document(s) — format: <rootBlockId> Title`, "", ...rows].join("\n"), limits: [] };
      }
      if (command === "tasks list --scope all") return { ok: true, value: listing("all", [...tasks.values()]), limits: [] };
      if ((m = command.match(/^blocks get --id (\S+) --format json --depth 1$/))) {
        const c = collections.get(m[1]);
        if (!c) return { ok: false, error: { code: "invalid", message: "Failed to read block: not found", affected: [], next: "" } };
        return { ok: true, value: JSON.stringify({ data: [{ id: c.id, type: "collection", markdown: c.name, items: (c.rows ?? []).map(row => ({ ...rowJson(row, 0), contentPreviewMd: "" })) }] }), limits: [] };
      }
      if (command === "tasks list --scope active" || command === "tasks list --scope upcoming") {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: SPACE.timezone }).format(new Date());
        const open = [...tasks.values()].filter(t => t.state !== "done" && t.state !== "canceled" && t.scheduleDate);
        const chosen = command.endsWith("active") ? open.filter(t => t.scheduleDate <= today) : open.filter(t => t.scheduleDate > today);
        return { ok: true, value: listing(command.split(" ").at(-1), chosen), limits: [] };
      }
      if (command === "tasks list --scope inbox") return { ok: true, value: listing("inbox", [...tasks.values()].filter(t => t.container.kind === "inbox")), limits: [] };
      if ((m = command.match(/^blocks get --date (\d{4}-\d{2}-\d{2}) --format json --depth 0$/))) {
        return { ok: true, value: JSON.stringify({ data: [{ id: `daily-${m[1]}`, type: "page", markdown: m[1].replaceAll("-", ".") }] }), limits: [] };
      }
      if ((m = command.match(/^tasks list --scope document --document (\S+)$/))) {
        const date = m[1].replace(/^daily-/, "");
        const inDoc = [...tasks.values()].filter(t => (t.container.kind === "daily-note" && t.container.date === date) || t.container.rootId === m[1]);
        return { ok: true, value: listing("document", inDoc), limits: [] };
      }
      if ((m = command.match(/^blocks get --id (\S+) --depth (\d) --format json( --fetchMetadata)?$/))) {
        const task = tasks.get(m[1]);
        if (task) return { ok: true, value: JSON.stringify({ data: [blockJson(task, Number(m[2]))] }), limits: [] };
        const found = rowOf(m[1]);
        if (found) return { ok: true, value: JSON.stringify({ data: [rowJson(found.row, Number(m[2]))] }), limits: [] };
        const page = pageOf(m[1]);
        if (page) return { ok: true, value: JSON.stringify({ data: [{ id: page.id, type: "page", markdown: page.markdown, metadata: { lastModifiedAt: page.modified ?? "2026-10-11T00:00:00.000+08:00" }, content: (page.children ?? []).map(ch => ({ id: ch.id, type: "text", markdown: ch.markdown })) }] }), limits: [] };
        const doc = documents.get(m[1]);
        if (doc) return { ok: true, value: JSON.stringify({ data: [docJson(m[1], doc, Number(m[2]))] }), limits: [] };
        const nested = nestedPageOf(m[1]);
        if (nested) return { ok: true, value: JSON.stringify({ data: [pageJson(nested, Number(m[2]))] }), limits: [] };
        return { ok: false, error: { code: "invalid", message: "Failed to read block: not found", affected: [], next: "" } };
      }
      throw new Error("unexpected read " + command);
    },
    async write(command) {
      calls.push(["write", command]);
      let m;
      if ((m = command.match(/^documents create --title (".*?")(?: --folder (\S+))?(?: --destination (\S+))?$/))) {
        const root = id(); documents.set(root, { title: JSON.parse(m[1]), folderId: m[2] ?? null, location: m[3] ?? (m[2] ? "folder" : "unsorted"), body: [] });
        return { ok: true, value: `Created document ${m[1]}\nrootBlockId: ${root}\nUse with: blocks get ${root}`, limits: [] };
      }
      if ((m = command.match(/^collections views-create --collection (\S+) --name (".*?") --type (\S+)/))) {
        const c = collections.get(m[1]); if (!c) return { ok: false, error: { code: "invalid", message: "Failed: collection not found", affected: [], next: "" } };
        (c.views ??= []).push({ name: JSON.parse(m[2]), type: m[3] });
        return { ok: true, value: `Created ${m[3]} view ${m[2]} <${id()}> for collection <${m[1]}>`, limits: [] };
      }
      if ((m = command.match(/^collections create --name (".*?") --title (".*?") --Status ("select:[^"]*")(?: --Area ("relation:[^"]*"))? --document (\S+)$/))) {
        const c = { id: id(), name: JSON.parse(m[1]), title: JSON.parse(m[2]), items: 0, documentId: m[5], columns: [{ key: "status", name: "Status", type: "singleSelect", options: JSON.parse(m[3]).slice(7).split(",") }] };
        if (m[4]) c.columns.push({ key: "area", name: "Area", type: "relation", target: JSON.parse(m[4]).slice(9) });
        collections.set(c.id, c);
        return { ok: true, value: `Created collection ${m[1]} <${c.id}>`, limits: [] };
      }
      if ((m = command.match(/^folders create --name (".*?")(?: --parent (\S+))?$/))) {
        const f = { id: id(), name: JSON.parse(m[1]), documents: 0, parentId: m[2] ?? null }; folders.set(f.id, f);
        return { ok: true, value: `Created folder ${m[1]} <${f.id}>`, limits: [] };
      }
      if ((m = command.match(/^tasks add --markdown (".*?") --location dailyNote --date (\d{4}-\d{2}-\d{2})(?: --schedule (\S+))?(?: --state (\S+))?$/))) {
        const task = seed(JSON.parse(m[1]), m[4] ?? "todo", { kind: "daily-note", date: m[2] }, m[3] ?? m[2]);
        return { ok: true, value: `Created task <${task.id}>`, limits: [] };
      }
      if ((m = command.match(/^collections items-add --collection (\S+) --(\w+) (".*?") --Status (\S+)(?: --Area (\S+))?$/))) {
        const c = collections.get(m[1]); if (!c) return { ok: false, error: { code: "invalid", message: "Failed: collection not found", affected: [], next: "" } };
        if (m[2] !== c.title) return { ok: false, error: { code: "invalid", message: `Failed: unknown property ${m[2]}`, affected: [], next: "" } };
        const row = { id: id(), title: JSON.parse(m[3]), properties: { status: m[4], ...(m[5] ? { area: m[5] } : {}) }, children: [] };
        (c.rows ??= []).push(row); c.items = c.rows.length;
        return { ok: true, value: `Added 1 item to collection <${c.id}>\n  <${row.id}> ${row.title}`, limits: [] };
      }
      if ((m = command.match(/^collections items-update --collection (\S+) --id (\S+) --(\w+) (.+)$/))) {
        const c = collections.get(m[1]); const row = (c?.rows ?? []).find(r => r.id === m[2]);
        if (!row) return { ok: false, error: { code: "invalid", message: "Failed: item not found", affected: [], next: "" } };
        if (m[3] === c.title) row.title = JSON.parse(m[4]); else if (m[3] === "Status") row.properties.status = m[4]; else if (m[3] === "Area") row.properties.area = m[4]; else throw new Error("unexpected property " + m[3]);
        row.modified = `2026-10-11T00:00:${String(nextId++).padStart(2, "0")}.000+08:00`;
        return { ok: true, value: `Updated item <${row.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks add --siblingId (\S+) --position (before|after) --markdown ("(?:[^"\\]|\\.)*")$/))) {
        const owner = [...collections.values()].flatMap(c => c.rows ?? []).find(row => row.children.some(ch => (ch.taskId ?? ch.id) === m[1]));
        if (owner) { const child = addToRow(owner, JSON.parse(m[3]), "end", m[1]); return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] }; }
        const docOwner = ownerOfBlock(m[1]);
        if (!docOwner) return { ok: false, error: { code: "not-found", message: "Failed: no such sibling", affected: [], next: "" } };
        const blocks = splitBlocks(JSON.parse(m[3])); const at = docOwner.list.findIndex(b => b.id === m[1]);
        docOwner.list.splice(m[2] === "before" ? at : at + 1, 0, ...blocks); docOwner.touch();
        return { ok: true, value: `Added ${blocks.length} block(s).\nIDs: ${blocks.map(b => `<${b.id}>`).join(", ")}`, limits: [] };
      }
      if ((m = command.match(/^blocks add --id (\S+) --position (start|end) --markdown ("(?:[^"\\]|\\.)*")$/))) {
        const found = rowOf(m[1]); if (!found) return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } };
        const child = addToRow(found.row, JSON.parse(m[3]), m[2]);
        return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks add --id (\S+) --json '(.*)'$/))) {
        const payload = JSON.parse(m[2])[0];
        const page = { id: id(), type: "page", markdown: payload.markdown, children: (payload.content ?? []).map(b => ({ id: id(), type: "text", markdown: b.markdown })) };
        const found = rowOf(m[1]);
        if (found) found.row.children.push(page);
        else if (documents.get(m[1])) (documents.get(m[1]).body ??= []).push(page);
        else if (nestedPageOf(m[1])) (nestedPageOf(m[1]).children ??= []).push(page);
        else return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } };
        return { ok: true, value: `Added 1 block.\nIDs: <${page.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks delete --ids? (\S+)$/))) {
        for (const blockId of m[1].split(",")) { const owner = ownerOfBlock(blockId); if (!owner) return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } }; owner.list.splice(owner.list.findIndex(b => (b.taskId ?? b.id) === blockId), 1); owner.touch(); }
        return { ok: true, value: `Deleted ${m[1].split(",").length} block(s).`, limits: [] };
      }
      if ((m = command.match(/^blocks move --id (\S+) --target(SiblingId|Id|Date) (\S+) --position (start|end|before|after)$/))) {
        const task = tasks.get(m[1]); if (!task) return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } };
        detachTask(task.id);
        if (m[2] === "Date") { task.container = { kind: "daily-note", date: m[3] }; }
        else {
          const target = m[2] === "Id" ? rowOf(m[3])?.row : [...collections.values()].flatMap(c => c.rows ?? []).find(row => row.children.some(ch => (ch.taskId ?? ch.id) === m[3]));
          if (!target) return { ok: false, error: { code: "not-found", message: "Failed: no such target", affected: [], next: "" } };
          task.container = { kind: "project", itemId: target.id, rootId: rowOf(target.id).c.documentId };
          const child = { id: task.id, taskId: task.id };
          if (m[2] === "Id") { if (m[4] === "start") target.children.unshift(child); else target.children.push(child); }
          else { const i = target.children.findIndex(ch => (ch.taskId ?? ch.id) === m[3]); target.children.splice(m[4] === "before" ? i : i + 1, 0, child); }
        }
        touch(task);
        return { ok: true, value: `Moved 1 block`, limits: [] };
      }
      if ((m = command.match(/^tasks update --task (\S+)(.*)$/))) {
        const task = tasks.get(m[1]); if (!task) return { ok: false, error: { code: "not-found", message: "Failed", affected: [], next: "" } };
        const line = m[2].match(/--markdown ("(?:[^"\\]|\\.)*")/); if (line) task.line = JSON.parse(line[1]);
        const state = m[2].match(/--state (\S+)/); if (state) task.state = state[1];
        const schedule = m[2].match(/--schedule (\S+)/); if (schedule) task.scheduleDate = schedule[1];
        touch(task);
        return { ok: true, value: `Updated task <${task.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks add --id (\S+) --markdown ("(?:[^"\\]|\\.)*")$/))) {
        const task = tasks.get(m[1]);
        if (!task) {
          const found = rowOf(m[1]);
          if (found) { const child = addToRow(found.row, JSON.parse(m[2])); return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] }; }
          const doc = documents.get(m[1]) ?? collections.get(m[1]) ?? nestedPageOf(m[1]);
          if (!doc) return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } };
          const blocks = splitBlocks(JSON.parse(m[2]));
          if (doc.children !== undefined || nestedPageOf(m[1])) (doc.children ??= []).push(...blocks); else (doc.body ??= []).push(...blocks);
          doc.modified = `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`;
          return { ok: true, value: `Added ${blocks.length} block(s).\nIDs: ${blocks.map(b => `<${b.id}>`).join(", ")}`, limits: [] };
        }
        const child = { id: id(), markdown: JSON.parse(m[2]) }; task.children.push(child); touch(task);
        return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks update --id (\S+) --markdown ("(?:[^"\\]|\\.)*")$/))) {
        for (const task of tasks.values()) { const child = task.children.find(c => c.id === m[1]); if (child) { child.markdown = JSON.parse(m[2]); touch(task); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; } }
        if (documents.get(m[1])) { documents.get(m[1]).title = JSON.parse(m[2]); documents.get(m[1]).modified = `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`; return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; }
        const docOwner = ownerOfBlock(m[1]);
        if (docOwner && !rowOf(m[1])) { const block = docOwner.list.find(b => b.id === m[1]); if (block && !block.taskId) { block.markdown = JSON.parse(m[2]); docOwner.touch(); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; } }
        for (const c of collections.values()) for (const row of c.rows ?? []) {
          const child = row.children.find(ch => ch.id === m[1] && !ch.taskId); if (child) { child.markdown = JSON.parse(m[2]); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; }
          for (const page of row.children.filter(ch => ch.type === "page")) { const inner = (page.children ?? []).find(ch => ch.id === m[1]); if (inner) { inner.markdown = JSON.parse(m[2]); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; } }
        }
        return { ok: false, error: { code: "not-found", message: "Failed", affected: [], next: "" } };
      }
      if ((m = command.match(/^blocks update --json '(.*)'$/))) {
        const payload = JSON.parse(m[1]);
        if (Array.isArray(payload)) {
          // Craft rejects the whole array when any markdown would yield several blocks.
          if (payload.some(update => /\n\s*\n/.test(update.markdown ?? ""))) return { ok: false, error: { code: "invalid", message: "error(MARKDOWN_PARSING_ERROR): Expected markdown to yield a single block", affected: [], next: "" } };
          for (const update of payload) { const r = await connection.write(`blocks update --id ${update.id} --markdown ${JSON.stringify(update.markdown)}`); if (!r.ok) return r; }
          connection.jsonBatches = (connection.jsonBatches ?? 0) + 1;
          return { ok: true, value: `Updated ${payload.length} blocks.`, limits: [] };
        }
        const task = tasks.get(payload.id);
        if ("scheduleDate" in payload.taskInfo) task.scheduleDate = payload.taskInfo.scheduleDate ?? undefined; touch(task);
        return { ok: true, value: `Updated block <${task.id}>.`, limits: [] };
      }
      throw new Error("unexpected write " + command);
    },
  };
  const seedFolder = (name, documents = 0, parentId = null) => { const f = { id: id(), name, documents, parentId }; folders.set(f.id, f); return f; };
  return { connection, tasks, calls, seed, seedFolder, collections, folders, documents };
}

// ---------- Craft adapter mapping ----------
{
  assert.deepEqual(parseActionLine("  - [ ] Submit reimbursement #gpk/task/waiting"), { title: "Submit reimbursement", tagState: "waiting" });
  assert.deepEqual(parseActionLine("- [x] Done thing"), { title: "Done thing" });
  assert.deepEqual(parseActionLine("- [ ] ~Dropped~"), { title: "Dropped" });
  const parsed = parseTaskListing([
    "Tasks (all): 3 result(s)", "",
    "[ ] <A1> - [ ] Make Resume", "  (schedule: 2026-08-31)", "  in: inbox", "",
    "[-] <B2> - [ ] ~Old~", "  in: daily note 2020-01-01", "  canceledAt: x", "",
    "[x] <C3> - [x] Shipped #gpk/task/doing", "  in: GPK scratch <ROOT-1>",
  ].join("\n"));
  assert.deepEqual(parsed.map(t => [t.id, t.state, t.scheduleDate, t.container.key]), [
    ["A1", "todo", "2026-08-31", "inbox"], ["B2", "canceled", undefined, "daily-notes/2020-01-01"], ["C3", "done", undefined, "ROOT-1"],
  ]);

  const fake = fakeCraft();
  const inbox = fake.seed("Submit the dinner reimbursement by Friday", "todo", { kind: "inbox" }, "2026-10-16");
  const waiting = fake.seed("Access approval #gpk/task/waiting", "waiting", { kind: "daily-note", date: "2026-10-01" }, "2026-10-17", ["Blocked on IT ticket 42"]);
  const inDoc = fake.seed("Doc task", "todo", { kind: "document", rootId: "ROOT-1" }, undefined);
  let layoutLocations = null; // set once Setup establishes the layout below
  const knowledge = createCraftAdapter({ connection: fake.connection, backendId: "primary", layout: async () => ({ ok: true, value: layoutLocations, limits: [] }) });
  const grant = grants.grants[0];

  const surface = await knowledge.captures.resolve({ name: "inbox" });
  assert.deepEqual(surface.value, { scope: SPACE.id, id: "inbox", role: "capture-surface" });
  const captures = await knowledge.captures.list(surface.value);
  assert.equal(captures.value.items.length, 1);
  assert.equal(captures.value.items[0].value.content, "- [ ] Submit the dinner reimbursement by Friday");
  assert.equal((await knowledge.captures.resolve({ name: "daily-notes", date: "2026-02-30" })).error.code, "invalid");

  const ref = { kind: "Task", scope: SPACE.id, id: waiting.id };
  const read = await knowledge.tasks.read(ref);
  assert.equal(read.value.coverage, "complete");
  assert.deepEqual(read.value.value, { title: "Access approval", content: "Blocked on IT ticket 42", state: "waiting", time: "2026-10-17" });
  assert.equal((await knowledge.tasks.read({ ...ref, scope: "other" })).error.code, "invalid");
  assert.equal((await knowledge.tasks.read({ ...ref, id: "aaaaaaaa-0000-0000-0000-999999999999" })).error.code, "not-found");

  let query = await knowledge.tasks.query({ states: ["todo", "waiting"], limit: 1 });
  assert.equal(query.value.coverage, "partial");
  assert.ok(query.value.next);
  const rest = await knowledge.tasks.query({ states: ["todo", "waiting"], limit: 1, cursor: query.value.next });
  assert.equal(rest.value.items.length, 1);
  query = await knowledge.tasks.query({ time: { from: "2026-10-17", includeUnset: true } });
  assert.deepEqual(query.value.items.map(i => i.ref.id), [waiting.id], "Tasks in documents outside GPK's locations are not managed");
  assert.ok(query.limits.some(l => /outside GPK/.test(l)), JSON.stringify(query.limits));
  assert.equal(query.value.coverage, "complete");
  void inDoc;
  assert.equal((await knowledge.tasks.query({ cursor: "bogus" })).error.code, "invalid");
  assert.equal((await knowledge.tasks.query({ project: { kind: "Project", scope: SPACE.id, id: "p" } })).error.code, "unavailable", "Project queries need the layout");
  query = await knowledge.tasks.query({ text: "Access approval" });
  assert.deepEqual(query.value.items.map(i => i.ref.id), [waiting.id], "text matches the action line");
  query = await knowledge.tasks.query({ text: "ticket 42" });
  assert.deepEqual(query.value.items, [], "bodies are not searched");
  assert.ok(query.limits.some(l => /action line only/.test(l)));

  const container = await knowledge.containerOf(ref);
  assert.deepEqual(container.value, { key: "daily-notes/2026-10-01", kind: "daily-note", date: "2026-10-01" });

  // Grant enforcement at the port boundary.
  const wrongRoot = { ...grant, root: { scope: SPACE.id, id: "inbox" } };
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", { grant: wrongRoot })).error.code, "unauthorized");
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", { grant: { ...grant, operations: ["tasks.create"] } })).error.code, "unauthorized");
  const stale = { grant, expected: "sha256:stale" };
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", stale)).error.code, "conflict");

  // Create, schedule, update, transition with read-back verification.
  const created = await knowledge.tasks.create({ title: "Submit the dinner reimbursement", content: "Receipt attached in Inbox", state: "todo", time: "2026-10-16" }, { grant });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.value.verified, true);
  assert.equal(created.value.created.kind, "Task");
  const newRef = created.value.created;
  const stored = fake.tasks.get(newRef.id);
  assert.equal(stored.container.kind, "daily-note");
  assert.equal(stored.children[0].markdown, "Receipt attached in Inbox");
  assert.equal((await knowledge.tasks.create({ title: " ", content: "", state: "todo" }, { grant })).error.code, "invalid");
  assert.equal((await knowledge.tasks.create({ title: "x", content: "", state: "todo", project: { kind: "Project", scope: SPACE.id, id: "p" } }, { grant })).error.code, "unavailable");

  const callsBefore = fake.calls.length;
  const cleared = await knowledge.tasks.schedule(newRef, null, { grant, expected: created.value.version });
  assert.ok(!fake.calls.slice(callsBefore).some(([, c]) => c === "tasks list --scope all"), "a created Task's container is verified through its Daily Note, not a full-space scan");
  assert.equal(cleared.value.verified, true);
  assert.equal((await knowledge.tasks.read(newRef)).value.value.time, undefined);
  assert.ok(fake.calls.some(([, c]) => c.includes('"taskInfo":{"scheduleDate":null}')), "clearing uses the JSON null form");

  const edited = await knowledge.tasks.update(newRef, { title: "Submit the dinner reimbursement (R-2291)", edits: [{ before: "attached in Inbox", after: "submitted, reference R-2291" }] }, { grant });
  assert.equal(edited.value.verified, true, JSON.stringify(edited));
  assert.equal(fake.tasks.get(newRef.id).children[0].markdown, "Receipt submitted, reference R-2291");
  assert.equal((await knowledge.tasks.update(newRef, { edits: [{ before: "nowhere", after: "x" }] }, { grant })).error.code, "conflict");

  const moved = await knowledge.tasks.transition(newRef, "waiting", "Waiting for finance to confirm", { grant });
  assert.equal(moved.value.verified, true);
  assert.equal(fake.tasks.get(newRef.id).line, "Submit the dinner reimbursement (R-2291) #gpk/task/waiting");
  assert.ok(fake.tasks.get(newRef.id).children.at(-1).markdown.startsWith("waiting ("), "the reason is appended as a child block");
  const done = await knowledge.tasks.transition(newRef, "done", "Submitted and confirmed", { grant });
  assert.equal(done.value.verified, true);
  assert.equal(fake.tasks.get(newRef.id).line, "Submit the dinner reimbursement (R-2291)", "completing a waiting Task removes its state tag");
  assert.equal((await knowledge.tasks.read(newRef)).value.value.state, "done");
  assert.equal((await knowledge.tasks.transition(newRef, "waiting", "no", { grant })).error.code, "conflict", "done can only reopen to todo");
  assert.equal((await knowledge.tasks.transition(newRef, "todo", "", { grant })).error.code, "invalid");
  const renamedAfterTag = await knowledge.tasks.update({ kind: "Task", scope: SPACE.id, id: waiting.id }, { title: "Access approval renamed" }, { grant });
  assert.equal(renamedAfterTag.value.verified, true);
  assert.equal(fake.tasks.get(waiting.id).line, "Access approval renamed #gpk/task/waiting", "renaming re-emits the state tag");

  // Layout: inspect candidates, adopt an existing folder, create the rest.
  const existingSources = fake.seedFolder("Sources", 413);
  let inspection = await knowledge.layout.inspect(settings.knowledgeBackend.configurations[0].layout.locations);
  assert.equal(inspection.ok, true, JSON.stringify(inspection));
  assert.deepEqual(inspection.value.locations.map(l => l.status), ["missing", "missing", "missing", "missing", "missing"]);
  assert.equal(inspection.value.candidates.folders[0].name, "Sources");
  const clash = await knowledge.layout.establish({ namespace: "root", hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, views: false, templates: false });
  assert.ok(["partial", "ambiguous"].includes(clash.error.code), "a root-level name clash is refused: " + JSON.stringify(clash));
  // A shared workspace: a namespace folder keeps GPK's structures apart from the user's own.
  const established = await knowledge.layout.establish({ namespace: { folder: "GPK" }, hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { id: existingSources.id }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, metadataLanguage: "zh-CN" });
  assert.equal(established.ok, true, JSON.stringify(established));
  assert.equal(established.value.locations.source.id, existingSources.id);
  assert.equal(established.value.adopted.length, 1);
  assert.ok(established.value.created.length >= 5);
  // Namespace: everything created sits under the named root folder; adopted folders stay where they are.
  const namespace = fake.folders.get(established.value.namespace.id);
  assert.equal(namespace.name, "GPK");
  assert.equal(namespace.parentId, null);
  assert.equal(fake.folders.get(established.value.locations.wiki.id).parentId, namespace.id);
  assert.equal(fake.folders.get(established.value.locations.output.id).parentId, namespace.id);
  const hostDoc = fake.documents.get(established.value.created.map(r => r.id).find(id => fake.documents.get(id)?.title === "GPK"));
  assert.equal(hostDoc.folderId, namespace.id, "the host document is created inside the namespace folder");
  // Views and templates for people.
  assert.deepEqual(established.value.views, ["Projects: 看板", "Projects: 按领域", "Projects: 进行中", "Areas: 看板"], "view names follow the metadata language");
  assert.deepEqual(fake.collections.get(established.value.locations.project.id).views.map(v => v.type), ["kanban", "table", "table"]);
  assert.equal(established.value.templates.length, 5);
  const installed = [...fake.documents.values()].filter(d => d.location === "templates");
  assert.deepEqual(installed.map(d => d.title).sort(), ["GPK Area", "GPK Output", "GPK Project", "GPK Source", "GPK Wiki"]);
  const projectTemplate = installed.find(d => d.title === "GPK Project").body.map(b => b.markdown).join("\n\n");
  assert.ok(projectTemplate.includes("计划与行动"), "the Chinese template body is installed");
  assert.ok(!/^- (状态|主 Area)/m.test(projectTemplate), "Collection-column lines are stripped from the Project template");
  assert.ok(!projectTemplate.includes("<!--"), "authoring comments are stripped");
  // Rerunning with the same names reuses the namespace folder and does not reinstall templates.
  const again = await knowledge.layout.establish({ namespace: { folder: "GPK" }, hostDocument: { rootId: established.value.created.find(r => fake.documents.get(r.id)?.title === "GPK").id }, areas: { id: established.value.locations.area.id }, projects: { id: established.value.locations.project.id }, sources: { id: existingSources.id }, wikis: { id: established.value.locations.wiki.id }, outputs: { id: established.value.locations.output.id }, metadataLanguage: "zh-CN" });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.value.namespace.id, namespace.id, "an existing root-level GPK folder is adopted");
  assert.equal(again.value.templates.length, 0, "templates already present by title are not duplicated");
  assert.deepEqual(again.value.views, [], "existing GPK views are not recreated on adopted Collections");
  assert.equal(fake.collections.get(established.value.locations.project.id).views.length, 3);
  assert.equal([...fake.documents.values()].filter(d => d.location === "templates").length, 5);
  const projectsCollection = fake.collections.get(established.value.locations.project.id);
  assert.deepEqual(projectsCollection.columns.map(c => c.type), ["singleSelect", "relation"]);
  assert.deepEqual(fake.collections.get(established.value.locations.area.id).columns[0].options, ["active", "inactive"]);
  inspection = await knowledge.layout.inspect(established.value.locations);
  assert.deepEqual(inspection.value.locations.map(l => l.status), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal((await knowledge.layout.establish({ hostDocument: { title: "GPK" }, areas: { id: existingSources.id }, projects: { name: "P" }, sources: { name: "S" }, wikis: { name: "W" }, outputs: { name: "O" } })).error.code, "invalid", "adopting a folder as the Areas Collection is refused");

  const capabilities = await knowledge.capabilities();
  assert.equal(capabilities.value["tasks.create"].mode, "native");
  assert.equal(capabilities.value["projects.create"].mode, "native");
  assert.equal(capabilities.value["sources.create"].mode, "native");
  assert.equal(capabilities.value["sources.archive"].mode, "unsupported");
  assert.equal((await knowledge.projects.query({})).error.code, "unavailable", "Collections need the layout from Settings");
  console.log("PASS: Craft adapter maps Tasks and captures onto the observed command surface with grant and version checks");

  // ---------- Project slice: Areas and Projects as Collection rows, Tasks inside Project rows ----------
  layoutLocations = established.value.locations;
  const areaGrant = { backendId: "primary", root: layoutLocations.area, operations: ["areas.create", "areas.update", "areas.transition"], unattended: false };
  const projectGrant = { backendId: "primary", root: layoutLocations.project, operations: ["projects.create", "projects.update", "projects.transition", "projects.assignArea", "projects.orderTasks", "projects.materials.append", "projects.materials.update", "tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject", "links.add"], unattended: false };
  assert.equal((await knowledge.areas.create({ title: "研究实践", content: "", state: "active" }, { grant: projectGrant })).error.code, "unauthorized", "Area writes need a grant on the Areas Collection");
  const area = await knowledge.areas.create({ title: "研究实践", content: "方向：把方法论做成可用的插件", state: "active" }, { grant: areaGrant });
  assert.equal(area.ok, true, JSON.stringify(area));
  assert.equal(area.value.verified, true);
  const areaRef = area.value.created;
  assert.deepEqual((await knowledge.areas.read(areaRef)).value.value, { title: "研究实践", content: "方向：把方法论做成可用的插件", state: "active" });
  assert.deepEqual((await knowledge.areas.resolve(areaRef.id)).value, areaRef);
  assert.equal((await knowledge.areas.resolve("aaaaaaaa-0000-0000-0000-999999999999")).error.code, "not-found");
  const areas = await knowledge.areas.query({ states: ["active"] });
  assert.deepEqual(areas.value.items.map(i => i.ref.id), [areaRef.id]);
  assert.equal(areas.value.coverage, "complete");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "same", { grant: areaGrant })).error.code, "conflict");
  const inactive = await knowledge.areas.transition(areaRef, "inactive", "Paused for the quarter", { grant: areaGrant, expected: area.value.version });
  assert.equal(inactive.value.verified, true, JSON.stringify(inactive));
  assert.equal((await knowledge.areas.read(areaRef)).value.value.state, "inactive");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "Back", { grant: areaGrant, expected: area.value.version })).error.code, "conflict", "a stale version is detected");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "Back", { grant: areaGrant })).ok, true);

  const project = await knowledge.projects.create({ title: "GPK 第一个切片", content: "## Objective\n\n证明端到端可用", state: "active", primaryArea: areaRef }, { grant: projectGrant });
  assert.equal(project.ok, true, JSON.stringify(project));
  assert.equal(project.value.verified, true);
  const projectRef = project.value.created;
  const projectRead = await knowledge.projects.read(projectRef);
  assert.equal(projectRead.value.value.state, "active");
  assert.deepEqual(projectRead.value.value.primaryArea, areaRef);
  assert.equal((await knowledge.projects.create({ title: "Orphan", content: "", state: "planned", primaryArea: { kind: "Area", scope: SPACE.id, id: "aaaaaaaa-0000-0000-0000-999999999999" } }, { grant: projectGrant })).error.code, "not-found", "the primary Area must be a row");
  assert.deepEqual((await knowledge.projects.query({ area: areaRef, states: ["active"] })).value.items.map(i => i.ref.id), [projectRef.id]);
  assert.deepEqual((await knowledge.projects.query({ states: ["completed"] })).value.items, []);

  // Tasks inside the Project row, in plan order.
  const t1 = await knowledge.tasks.create({ title: "读契约", content: "Done when: 读完 port 文件", state: "todo", project: projectRef }, { grant: projectGrant });
  assert.equal(t1.ok, true, JSON.stringify(t1));
  const t2 = await knowledge.tasks.create({ title: "写适配器", content: "", state: "todo", time: "2026-10-12", project: projectRef }, { grant: projectGrant });
  assert.equal(t2.value.verified, true, JSON.stringify(t2));
  assert.equal((await knowledge.tasks.create({ title: "x", content: "", state: "todo", project: projectRef }, { grant })).error.code, "unauthorized", "Project-owned Tasks need the Projects grant");
  const t1Read = await knowledge.tasks.read(t1.value.created);
  assert.deepEqual(t1Read.value.value.project, projectRef, "ownership is the Project row");
  assert.equal((await knowledge.containerOf(t1.value.created)).value.kind, "project");
  const inProject = await knowledge.tasks.query({ project: projectRef });
  assert.deepEqual(inProject.value.items.map(i => i.ref.id), [t1.value.created.id, t2.value.created.id], "plan order is the block order");
  assert.equal(inProject.value.items[1].value.time, "2026-10-12");
  const standalone = await knowledge.tasks.query({ project: null, states: ["todo"] });
  assert.ok(!standalone.value.items.some(i => i.ref.id === t1.value.created.id), "project: null excludes Project-owned Tasks");
  const everything = await knowledge.tasks.query({ states: ["todo"] });
  assert.deepEqual(everything.value.items.find(i => i.ref.id === t2.value.created.id).value.project, projectRef, "space-wide queries report ownership");
  const reordered = await knowledge.projects.orderTasks(projectRef, [t2.value.created, t1.value.created], { grant: projectGrant });
  assert.equal(reordered.value.verified, true, JSON.stringify(reordered));
  assert.deepEqual((await knowledge.tasks.query({ project: projectRef })).value.items.map(i => i.ref.id), [t2.value.created.id, t1.value.created.id]);
  assert.equal((await knowledge.projects.orderTasks(projectRef, [t1.value.created], { grant: projectGrant })).error.code, "conflict", "the order must cover every Task");
  const t3 = await knowledge.tasks.create({ title: "第三步", content: "", state: "todo", project: projectRef }, { grant: projectGrant });
  assert.deepEqual((await knowledge.tasks.query({ project: projectRef })).value.items.map(i => i.ref.id).at(-1), t3.value.created.id, "new Tasks follow the last Task");

  // Moving ownership: Daily Note -> Project -> standalone.
  const loose = await knowledge.tasks.create({ title: "零散任务", content: "", state: "todo" }, { grant });
  const adopted = await knowledge.tasks.assignProject(loose.value.created, projectRef, "Belongs to the slice", { grant: projectGrant });
  assert.equal(adopted.value.verified, true, JSON.stringify(adopted));
  assert.deepEqual((await knowledge.tasks.read(loose.value.created)).value.value.project, projectRef);
  assert.equal((await knowledge.tasks.assignProject(loose.value.created, projectRef, "again", { grant: projectGrant })).error.code, "conflict");
  const released = await knowledge.tasks.assignProject(loose.value.created, null, "Not part of the slice after all", { grant: { ...grant, operations: [...grant.operations, "tasks.assignProject"] } });
  assert.equal(released.value.verified, true, JSON.stringify(released));
  assert.equal((await knowledge.tasks.read(loose.value.created)).value.value.project, undefined);
  assert.equal((await knowledge.tasks.assignProject({ kind: "Task", scope: SPACE.id, id: inDoc.id }, projectRef, "x", { grant: projectGrant })).error.code, "unsupported", "Tasks outside GPK's locations are not moved");

  // Materials and closure.
  const inline = await knowledge.projects.materials.append(projectRef, { title: "Research", content: "Notes", presentation: "inline" }, { grant: projectGrant });
  assert.equal(inline.ok, true, JSON.stringify(inline));
  const childDoc = await knowledge.projects.materials.append(projectRef, { title: "Decision: MCP over REST", content: "Both compare on read-back.", presentation: "child-document" }, { grant: projectGrant });
  assert.equal(childDoc.ok, true, JSON.stringify(childDoc));
  const materials = await knowledge.projects.materials.list(projectRef);
  assert.deepEqual(materials.value.items.map(i => i.value.title), ["Decision: MCP over REST"], "nested pages are materials; inline sections stay in the body");
  const material = await knowledge.projects.materials.read(materials.value.items[0].ref);
  assert.deepEqual(material.value.value, { title: "Decision: MCP over REST", content: "Both compare on read-back.", presentation: "child-document" });
  const materialEdit = await knowledge.projects.materials.update(materials.value.items[0].ref, { edits: [{ before: "Both compare", after: "Both transports compare" }] }, { grant: projectGrant, expected: material.value.version });
  assert.equal(materialEdit.value.verified, true, JSON.stringify(materialEdit));
  assert.equal((await knowledge.projects.transition(projectRef, "completed", "Done", { grant: projectGrant })).error.code, "conflict", "open Tasks block closure");
  for (const t of [t1, t2, t3]) assert.equal((await knowledge.tasks.transition(t.value.created, "done", "ok", { grant: projectGrant })).value.verified, true);
  const renamed = await knowledge.projects.update(projectRef, { title: "GPK 第一个切片（完成）", edits: [{ before: "证明端到端可用", after: "证明端到端可用：已完成" }] }, { grant: projectGrant });
  assert.equal(renamed.value.verified, true, JSON.stringify(renamed));
  const otherArea = await knowledge.areas.create({ title: "产品", content: "", state: "active" }, { grant: areaGrant });
  const reassigned = await knowledge.projects.assignArea(projectRef, otherArea.value.created, "Ownership moved", { grant: projectGrant });
  assert.equal(reassigned.value.verified, true, JSON.stringify(reassigned));
  const completed = await knowledge.projects.transition(projectRef, "completed", "All Tasks done", { grant: projectGrant });
  assert.equal(completed.value.verified, true, JSON.stringify(completed));
  const finalRead = await knowledge.projects.read(projectRef);
  assert.equal(finalRead.value.value.state, "completed");
  assert.equal(finalRead.value.value.title, "GPK 第一个切片（完成）");
  assert.deepEqual(finalRead.value.value.primaryArea, otherArea.value.created);
  assert.ok(finalRead.value.value.content.includes("completed ("), "the closure reason is recorded in the body");
  assert.equal((await knowledge.projects.transition(projectRef, "active", "Reopen", { grant: projectGrant })).error.code, "conflict", "closed Projects are not reopened here");
  console.log("PASS: Areas and Projects live as Collection rows; Tasks are owned by the Project row they sit in");

  // ---------- Knowledge slice: Sources/Wikis/Outputs as folder documents, links, checkpoints ----------
  const sourceGrant = { backendId: "primary", root: layoutLocations.source, operations: ["sources.create", "sources.update", "links.add", "links.remove"], unattended: false };
  const wikiGrant = { backendId: "primary", root: layoutLocations.wiki, operations: ["wikis.create", "wikis.update", "links.add"], unattended: false };
  const outputGrant = { backendId: "primary", root: layoutLocations.output, operations: ["outputs.create", "outputs.update", "links.add"], unattended: false };
  const systemGrant = { backendId: "primary", root: { scope: SPACE.id, id: "system" }, operations: ["checkpoints.save"], unattended: false };
  assert.equal((await knowledge.sources.create({ title: "x", content: "" }, { grant: wikiGrant })).error.code, "unauthorized", "Source writes need the Sources folder grant");
  const source = await knowledge.sources.create({ title: "Craft 3.4.4 release notes", content: "Origin: https://example.com/notes (accessed 2026-10-11)\n\nSummary: adds collection views." }, { grant: sourceGrant });
  assert.equal(source.ok, true, JSON.stringify(source));
  assert.equal(source.value.verified, true);
  const sourceRef = source.value.created;
  assert.equal(sourceRef.kind, "Source");
  assert.equal(fake.documents.get(sourceRef.id).folderId, layoutLocations.source.id, "created in the Sources folder");
  const sourceRead = await knowledge.sources.read(sourceRef);
  assert.deepEqual(sourceRead.value.value, { title: "Craft 3.4.4 release notes", content: "Origin: https://example.com/notes (accessed 2026-10-11)\n\nSummary: adds collection views." });
  assert.deepEqual((await knowledge.sources.resolve(sourceRef.id)).value, sourceRef);
  assert.equal((await knowledge.wikis.resolve(sourceRef.id)).error.code, "not-found", "a Source is not a Wiki");
  const sourceEdit = await knowledge.sources.update(sourceRef, { title: "Craft 3.4.4 release notes (official)", edits: [{ before: "adds collection views", after: "adds collection views and templates" }] }, { grant: sourceGrant, expected: sourceRead.value.version });
  assert.equal(sourceEdit.value.verified, true, JSON.stringify(sourceEdit));
  assert.equal((await knowledge.sources.update(sourceRef, { title: "stale" }, { grant: sourceGrant, expected: sourceRead.value.version })).error.code, "conflict");
  const wiki = await knowledge.wikis.create({ title: "Craft Collections", content: "## Summary\n\nCollections are tables of pages." }, { grant: wikiGrant });
  assert.equal(wiki.ok, true, JSON.stringify(wiki));
  const wikiRef = wiki.value.created;
  const output = await knowledge.outputs.create({ title: "Architecture review report", content: "Delivered to the team on 2026-10-11." }, { grant: outputGrant });
  assert.equal(output.ok, true, JSON.stringify(output));
  const outputRef = output.value.created;
  assert.deepEqual((await knowledge.sources.query({ text: "release" })).value.items.map(i => i.ref.id), [sourceRef.id]);
  assert.equal((await knowledge.outputs.query({})).value.coverage, "complete");
  assert.equal((await knowledge.sources.archive(sourceRef, { grant: sourceGrant })).error.code, "unsupported");

  // Links: written into the linking record's body, discovered in both directions.
  const link = { from: wikiRef, to: sourceRef, context: "Summary cites the release notes" };
  assert.equal((await knowledge.links.add(link, { grant: sourceGrant })).error.code, "unauthorized", "the grant follows the linking record");
  const added = await knowledge.links.add(link, { grant: wikiGrant });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.value.verified, true);
  const wikiBody = fake.documents.get(wikiRef.id).body.map(b => b.markdown);
  assert.ok(wikiBody.includes("## Links"), "a Links heading is added once");
  assert.ok(wikiBody.at(-1).startsWith(`- [Craft 3.4.4 release notes (official)](block://${sourceRef.id}) — Summary cites`), JSON.stringify(wikiBody));
  assert.equal((await knowledge.links.add(link, { grant: wikiGrant })).error.code, "conflict", "the same link is not added twice");
  const second = await knowledge.links.add({ from: wikiRef, to: projectRef, context: "Explains the slice" }, { grant: wikiGrant });
  assert.equal(second.value.verified, true, JSON.stringify(second));
  assert.equal(fake.documents.get(wikiRef.id).body.filter(b => b.markdown === "## Links").length, 1);
  const taskLink = await knowledge.links.add({ from: t1.value.created, to: outputRef, context: "Produced the report" }, { grant: projectGrant });
  assert.equal(taskLink.ok, true, JSON.stringify(taskLink)); assert.equal(taskLink.value.verified, true);
  const fromProject = await knowledge.links.add({ from: projectRef, to: wikiRef, context: "Background reading" }, { grant: projectGrant });
  assert.equal(fromProject.value.verified, true, JSON.stringify(fromProject));
  const sourceLinks = await knowledge.links.query(sourceRef);
  assert.deepEqual(sourceLinks.value.items.map(l => [l.from.kind, l.to.kind, l.context]), [["Wiki", "Source", "Summary cites the release notes"]], "incoming links are found by scanning");
  const wikiLinks = await knowledge.links.query(wikiRef);
  assert.deepEqual(wikiLinks.value.items.map(l => [l.from.kind, l.to.kind]).sort(), [["Project", "Wiki"], ["Wiki", "Project"], ["Wiki", "Source"]].sort());
  const outputLinks = await knowledge.links.query(outputRef);
  assert.deepEqual(outputLinks.value.items.map(l => [l.from.kind, l.from.id]), [["Task", t1.value.created.id]], "links written by Project Tasks are found");
  assert.deepEqual((await knowledge.sources.query({ relatedTo: wikiRef })).value.items.map(i => i.ref.id), [sourceRef.id], "relatedTo filters by discovered links");
  assert.deepEqual((await knowledge.projects.query({ relatedTo: wikiRef })).value.items.map(i => i.ref.id), [projectRef.id]);
  assert.deepEqual((await knowledge.tasks.query({ relatedTo: outputRef })).value.items.map(i => i.ref.id), [t1.value.created.id]);
  assert.equal((await knowledge.links.remove(link, { grant: wikiGrant })).error.code, "unauthorized", "links.remove is a separate operation");
  const removed = await knowledge.links.remove(link, { grant: { ...wikiGrant, operations: ["links.remove"] } });
  assert.equal(removed.value.verified, true, JSON.stringify(removed));
  assert.equal((await knowledge.links.query(sourceRef)).value.items.length, 0);

  // Checkpoints: nested pages of the GPK System page in the host document.
  assert.equal((await knowledge.checkpoints.read("ingest/example")).value, null, "absence is null, not an error");
  const hostRootId = fake.collections.get(layoutLocations.project.id).documentId;
  assert.ok(!(fake.documents.get(hostRootId).body ?? []).some(b => b.markdown === "GPK System"), "reading creates nothing");
  assert.equal((await knowledge.checkpoints.save("ingest/example", "cursor=1", { grant: sourceGrant })).error.code, "unauthorized");
  const saved = await knowledge.checkpoints.save("ingest/example", "cursor=1\n\nlast=abc", { grant: systemGrant });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.value.verified, true);
  const checkpoint = await knowledge.checkpoints.read("ingest/example");
  assert.equal(checkpoint.value.value, "cursor=1\n\nlast=abc");
  assert.ok((fake.documents.get(hostRootId).body ?? []).some(b => b.markdown === "GPK System"), "the system page is created on first save");
  assert.equal((await knowledge.checkpoints.save("ingest/example", "cursor=2", { grant: systemGrant, expected: "sha256:stale" })).error.code, "conflict");
  const replaced = await knowledge.checkpoints.save("ingest/example", "cursor=2", { grant: systemGrant, expected: checkpoint.value.version });
  assert.equal(replaced.ok, true, JSON.stringify(replaced)); assert.equal(replaced.value.verified, true);
  assert.equal((await knowledge.checkpoints.read("ingest/example")).value.value, "cursor=2");
  assert.equal((await knowledge.checkpoints.read("ingest/other")).value, null);
  // Performance: no whole-Collection read per row operation, no body scan of unrelated documents.
  const collectionReads = () => fake.calls.filter(([, c]) => c === `blocks get --id ${layoutLocations.project.id} --format json --depth 1`).length;
  await knowledge.projects.read(projectRef);
  const readsBefore = collectionReads();
  await knowledge.projects.read(projectRef);
  assert.equal(collectionReads(), readsBefore, "reads of known rows do not list the whole Collection again");
  await knowledge.projects.update(projectRef, { edits: [{ before: "证明端到端可用：已完成", after: "证明端到端可用：已完成。" }] }, { grant: projectGrant });
  assert.equal(collectionReads(), readsBefore + 1, "a write checks membership once against a fresh listing, and its read-back reuses it");
  const unrelated = await knowledge.sources.create({ title: "Unrelated paper", content: "Nothing links anywhere." }, { grant: sourceGrant });
  const callsBeforeLinks = fake.calls.length;
  const viaSearch = await knowledge.links.query(outputRef);
  assert.deepEqual(viaSearch.value.items.map(l => l.from.kind).sort(), ["Task"], JSON.stringify(viaSearch));
  assert.ok(!fake.calls.slice(callsBeforeLinks).some(([, c]) => c.includes(unrelated.value.created.id)), "documents that do not mention the target are not read");
  assert.ok(viaSearch.limits.some(l => /searching the target's title/.test(l)));
  assert.deepEqual((await knowledge.sources.query({ text: "Nothing links" })).value.items.map(i => i.ref.id), [unrelated.value.created.id], "text queries match bodies through search");
  // Long pages: Craft pages direct children at 50; every page is read.
  const longWiki = await knowledge.wikis.create({ title: "Long wiki", content: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join("\n\n") }, { grant: wikiGrant });
  assert.equal(longWiki.ok, true, JSON.stringify(longWiki));
  const longRead = await knowledge.wikis.read(longWiki.value.created);
  assert.ok(longRead.value.value.content.endsWith("Paragraph 59"), "children beyond the first 50 are read");
  const lateEdit = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 57", after: "Paragraph 57 revised" }] }, { grant: wikiGrant, expected: longRead.value.version });
  assert.equal(lateEdit.value.verified, true, "an edit past the 50th block finds and verifies its block");
  const lateLink = await knowledge.links.add({ from: longWiki.value.created, to: sourceRef, context: "Cited at the end" }, { grant: wikiGrant });
  assert.equal(lateLink.value.verified, true, "a link appended after 60 blocks is read back");
  assert.ok((await knowledge.links.query(sourceRef)).value.items.some(l => l.from.id === longWiki.value.created.id), "incoming links past the 50th block are found");

  // Subfolders: Craft's folder listing is not recursive, so GPK expands the tree.
  const subfolder = fake.seedFolder("Papers", 1, layoutLocations.source.id);
  const nestedId = "bbbbbbbb-0000-0000-0000-000000000001";
  fake.documents.set(nestedId, { title: "Nested paper", folderId: subfolder.id, location: "folder", body: [{ id: "bbbbbbbb-0000-0000-0000-000000000002", type: "text", markdown: "In a subfolder." }] });
  assert.equal((await knowledge.sources.resolve(nestedId)).ok, true, "a document in a subfolder of Sources is a Source");
  assert.deepEqual((await knowledge.sources.read({ kind: "Source", scope: SPACE.id, id: nestedId })).value.value.title, "Nested paper");

  // Dated open-state queries skip the full listing of every completed Task.
  const fullListings = () => fake.calls.filter(([, c]) => c === "tasks list --scope all").length;
  const beforeScoped = fullListings();
  const dated = await knowledge.tasks.query({ states: ["todo", "doing", "waiting"], time: { from: "2026-01-01", to: "2030-12-31" } });
  assert.equal(dated.ok, true, JSON.stringify(dated));
  assert.equal(fullListings(), beforeScoped, "the active/upcoming scopes replace the full listing");
  const viaAll = await knowledge.tasks.query({ states: ["todo", "doing", "waiting"], time: { from: "2026-01-01", to: "2030-12-31", includeUnset: true } });
  const datedIds = viaAll.value.items.filter(i => i.value.time).map(i => i.ref.id).sort();
  assert.deepEqual(dated.value.items.map(i => i.ref.id).sort(), datedIds, "the scoped path returns the same dated Tasks as the full listing");
  assert.ok(fullListings() > beforeScoped, "including undated Tasks still needs the full listing");

  // Several single-paragraph edits go out as one JSON update; a multi-paragraph edit stays separate.
  const batchesBefore = fake.connection.jsonBatches ?? 0;
  const twoEdits = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 31", after: "Paragraph thirty-one" }, { before: "Paragraph 32", after: "Paragraph thirty-two" }] }, { grant: wikiGrant });
  assert.equal(twoEdits.ok, true, JSON.stringify(twoEdits)); assert.equal(twoEdits.value.verified, true);
  assert.equal((fake.connection.jsonBatches ?? 0) - batchesBefore, 1, "single-paragraph edits share one request");
  const split = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 43", after: "Paragraph forty-three\n\nInserted after forty-three" }, { before: "Paragraph 44", after: "Paragraph forty-four" }] }, { grant: wikiGrant });
  assert.equal(split.ok, true, JSON.stringify(split));
  assert.ok((await knowledge.wikis.read(longWiki.value.created)).value.value.content.includes("Paragraph forty-three\n\nInserted after forty-three\n\nParagraph forty-four"), "a paragraph break inserts a sibling block");
  console.log("PASS: Sources, Wikis and Outputs are folder documents; links live in record bodies; checkpoints in the GPK System page");

  // A dedicated workspace: the default plan puts everything at the top level.
  {
    const freshFake = fakeCraft();
    const freshKnowledge = createCraftAdapter({ connection: freshFake.connection, backendId: "primary" });
    const fresh = await freshKnowledge.layout.establish({ hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, views: false, templates: false });
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.value.namespace, null, "no namespace folder by default");
    assert.deepEqual([...freshFake.folders.values()].map(f => [f.name, f.parentId]).sort(), [["Outputs", null], ["Sources", null], ["Wikis", null]]);
    const freshHost = [...freshFake.documents.values()].find(d => d.title === "GPK");
    assert.equal(freshHost.folderId, null, "the host document sits at the top level (Unsorted)");
  }
  console.log("PASS: the default Setup plan builds a dedicated workspace at its top level");

  // Containment: rows must belong to the configured Collection, materials to their Project.
  const areaAsProject = { kind: "Project", scope: SPACE.id, id: areaRef.id };
  assert.equal((await knowledge.projects.update(areaAsProject, { title: "hijack" }, { grant: projectGrant })).error.code, "not-found", "an Areas row is not a Project");
  assert.equal(fake.collections.get(layoutLocations.area.id).rows.find(r => r.id === areaRef.id).title !== "hijack", true);
  assert.equal((await knowledge.projects.transition(areaAsProject, "paused", "x", { grant: projectGrant })).error.code, "not-found");
  assert.equal((await knowledge.tasks.create({ title: "stray", content: "", state: "todo", project: areaAsProject }, { grant: projectGrant })).error.code, "not-found", "Tasks cannot be put into a row of another Collection");
  const otherProject = await knowledge.projects.create({ title: "Other", content: "", state: "planned", primaryArea: areaRef }, { grant: projectGrant });
  const materialOfFirst = (await knowledge.projects.materials.list(projectRef)).value.items[0].ref;
  const misattributed = { ...materialOfFirst, project: otherProject.value.created };
  assert.equal((await knowledge.projects.materials.update(misattributed, { title: "moved" }, { grant: projectGrant })).error.code, "not-found", "a material is edited only through its own Project");
  assert.equal((await knowledge.projects.materials.read(misattributed)).error.code, "not-found");
  const wikiPageAsMaterial = { scope: SPACE.id, id: wikiRef.id, role: "project-material", project: projectRef };
  assert.equal((await knowledge.projects.materials.update(wikiPageAsMaterial, { title: "x" }, { grant: projectGrant })).error.code, "not-found", "an arbitrary page is not a material");

  // Apostrophes survive JSON arguments.
  const quoted = await knowledge.projects.materials.append(projectRef, { title: "Owner's notes", content: "Don't drop this.", presentation: "child-document" }, { grant: projectGrant });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  const quotedRead = await knowledge.projects.materials.read(quoted.value.created);
  assert.deepEqual([quotedRead.value.value.title, quotedRead.value.value.content], ["Owner's notes", "Don't drop this."]);
  assert.equal((await knowledge.checkpoints.save("ingest/o'brien", "x", { grant: systemGrant })).value.verified, true);
  assert.equal((await knowledge.checkpoints.read("ingest/o'brien")).value.value, "x", "a key with an apostrophe reads back");
  assert.equal((await knowledge.checkpoints.save("ingest/o'brien", "y", { grant: systemGrant, expected: (await knowledge.checkpoints.read("ingest/o'brien")).value.version })).value.verified, true);
  const systemPage = fake.documents.get(hostRootId).body.find(b => b.markdown === "GPK System");
  assert.equal(systemPage.children.filter(p => p.markdown === "ingest/o'brien").length, 1, "saving again replaces, not duplicates");
  console.log("PASS: rows, materials and Tasks stay inside their configured containers; apostrophes survive JSON arguments");

  // Review finding 1: authorization re-resolves a cached container instead of trusting it.
  {
    const step = await knowledge.tasks.create({ title: "Bound to the slice", content: "", state: "todo", project: projectRef }, { grant: projectGrant });
    assert.equal(step.ok, true, JSON.stringify(step));
    const stepRef = step.value.created;
    assert.equal((await knowledge.tasks.read(stepRef)).ok, true, "the read caches the container");
    const configured = layoutLocations;
    layoutLocations = { ...configured, project: configured.area };
    const afterLayoutChange = await knowledge.tasks.update(stepRef, { title: "Under a stale layout" }, { grant: projectGrant });
    layoutLocations = configured;
    assert.ok(!afterLayoutChange.ok && ["unauthorized", "not-found"].includes(afterLayoutChange.error.code), "a layout change invalidates the cached Project container: " + JSON.stringify(afterLayoutChange));
    assert.notEqual(fake.tasks.get(stepRef.id).line, "Under a stale layout");
    assert.equal((await knowledge.tasks.read(stepRef)).ok, true);
    const projects = fake.collections.get(layoutLocations.project.id);
    const holder = [...fake.collections.values()].find(c => c.id !== projects.id && c.rows);
    const row = projects.rows.find(r => r.id === projectRef.id);
    projects.rows.splice(projects.rows.indexOf(row), 1);
    holder.rows.push(row);
    const afterMove = await knowledge.tasks.update(stepRef, { title: "In a moved row" }, { grant: projectGrant });
    holder.rows.splice(holder.rows.indexOf(row), 1);
    projects.rows.push(row);
    assert.ok(!afterMove.ok && ["unauthorized", "not-found"].includes(afterMove.error.code), "a row that left the Projects Collection no longer authorizes its Tasks: " + JSON.stringify(afterMove));
    assert.notEqual(fake.tasks.get(stepRef.id).line, "In a moved row");
  }
  console.log("PASS: a cached Task container is re-checked against the current layout and Collection before a write");

  // Review finding 3: an edit the backend silently drops is reported unverified.
  {
    const write = fake.connection.write;
    const dropEdits = async command => command.startsWith("blocks update") ? { ok: true, value: "Updated 1 block(s)", limits: [] } : write(command);
    const step = await knowledge.tasks.create({ title: "Silent drop", content: "Original body", state: "todo" }, { grant });
    const note = await knowledge.wikis.create({ title: "Silent wiki", content: "Original wiki body" }, { grant: wikiGrant });
    fake.connection.write = dropEdits;
    try {
      const taskEdit = await knowledge.tasks.update(step.value.created, { edits: [{ before: "Original body", after: "Changed body" }] }, { grant });
      assert.equal(taskEdit.value?.verified, false, "a dropped Task body edit is unverified: " + JSON.stringify(taskEdit));
      const wikiEdit = await knowledge.wikis.update(note.value.created, { edits: [{ before: "Original wiki body", after: "Changed wiki body" }] }, { grant: wikiGrant });
      assert.equal(wikiEdit.value?.verified, false, "a dropped Wiki body edit is unverified: " + JSON.stringify(wikiEdit));
      const projectEdit = await knowledge.projects.update(otherProject.value.created, { edits: [{ before: "", after: "x" }] }, { grant: projectGrant });
      assert.ok(!projectEdit.ok || projectEdit.value.verified === false, "a dropped Project body edit is never verified");
    } finally {
      fake.connection.write = write;
    }
  }
  console.log("PASS: body edits the backend accepted but did not apply are reported as unverified");

  // Review finding 5: a listed record that cannot be read makes the page partial.
  {
    const broken = await knowledge.wikis.create({ title: "Unreadable wiki", content: "Body" }, { grant: wikiGrant });
    const readFull = fake.connection.readFull;
    fake.connection.readFull = async command => command.startsWith(`blocks get --id ${broken.value.created.id} `)
      ? { ok: false, error: { code: "unavailable", message: "Failed to read block", affected: [], next: "" } }
      : readFull(command);
    try {
      const listed = await knowledge.wikis.query({});
      assert.equal(listed.ok, true, JSON.stringify(listed));
      assert.ok(!listed.value.items.some(item => item.ref.id === broken.value.created.id));
      assert.equal(listed.value.coverage, "partial", "an omitted record is not complete coverage");
      assert.ok(listed.limits.some(limit => limit.includes(broken.value.created.id)), JSON.stringify(listed.limits));
    } finally {
      fake.connection.readFull = readFull;
    }
  }
  console.log("PASS: a listed but unreadable Wiki leaves the query partial with a limit naming it");

  // Review finding 6: a Daily Note Task links under the daily-notes grant.
  {
    const dailyStep = await knowledge.tasks.create({ title: "Read the Collections wiki", content: "", state: "todo" }, { grant });
    const dailyLinks = { ...grant, operations: [...grant.operations, "links.add", "links.remove"] };
    const linked = await knowledge.links.add({ from: dailyStep.value.created, to: wikiRef, context: "Background for today" }, { grant: dailyLinks });
    assert.equal(linked.ok, true, "the daily-notes wildcard covers links from a Daily Note Task: " + JSON.stringify(linked));
    assert.equal(linked.value.verified, true);
    assert.equal((await knowledge.links.add({ from: dailyStep.value.created, to: wikiRef, context: "again" }, { grant: projectGrant })).error.code, "unauthorized", "a Project grant does not cover a Daily Note Task");
  }
  console.log("PASS: links from a Daily Note Task are authorized by the daily-notes grant");

  // Operations resolve grants from the control store; tool arguments carry none.
  const root = path.join(temporary, "control");
  const control = createLocalControlAdapter({ root });
  const bindingValue = { backendId: "primary", endpoint: "https://mcp.craft.do/my/mcp", secretKey: "gpk:craft:primary", connection: fake.connection, knowledge, layout: async () => ({ ok: true, value: layoutLocations, limits: [] }) };
  const operations = createOperations({ controlRoot: root, control, binding: async () => ({ ok: true, value: bindingValue, limits: [] }), setupBinding: async () => ({ ok: true, value: bindingValue, limits: [] }) });
  const viaOps = await operations.tasksCreate({ title: "Through operations", content: "", state: "todo" });
  assert.equal(viaOps.ok, true, JSON.stringify(viaOps));
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [] }));
  // Onboarding gates every knowledge operation, reads included, until a grant exists.
  for (const gated of [operations.tasksCreate({ title: "No grant", content: "", state: "todo" }), operations.projectsQuery({}), operations.tasksRead(viaOps.value.created), operations.reviewInventory("weekly")]) {
    const result = await gated;
    assert.equal(result.error?.code, "unavailable", JSON.stringify(result));
    assert.match(result.error.next, /gpk_setup_open/);
  }
  assert.equal((await operations.knowledgeCapabilities()).ok, true, "the capability inventory stays available during onboarding");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [{ ...grants.grants[0], id: "elsewhere", root: { scope: SPACE.id, id: "inbox" } }] }));
  assert.equal((await operations.tasksCreate({ title: "No grant", content: "", state: "todo" })).error.code, "unauthorized");
  assert.equal((await operations.tasksTransition(viaOps.value.created, "done", "x")).error.code, "unauthorized");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify(grants));
  // Review inventory: one read of the reviewed population with coverage.
  const planned = await knowledge.projects.create({ title: "Planned later", content: "", state: "planned", primaryArea: areaRef }, { grant: projectGrant });
  const stalled = await knowledge.projects.create({ title: "Stalled one", content: "", state: "active", primaryArea: areaRef }, { grant: projectGrant });
  const live = await knowledge.projects.create({ title: "Live one", content: "", state: "active", primaryArea: areaRef }, { grant: projectGrant });
  await knowledge.tasks.create({ title: "Overdue step", content: "", state: "todo", time: "2026-10-01", project: live.value.created }, { grant: projectGrant });
  await knowledge.tasks.create({ title: "Soon step", content: "", state: "todo", time: "2026-10-14", project: live.value.created }, { grant: projectGrant });
  // A planned Project's due Task is held, not executable; actual work under it is a discrepancy.
  const heldDue = await knowledge.tasks.create({ title: "Due under planned", content: "", state: "todo", time: "2026-10-01", project: planned.value.created }, { grant: projectGrant });
  const doneEarly = await knowledge.tasks.create({ title: "Done under planned", content: "", state: "done", project: planned.value.created }, { grant: projectGrant });
  const review = await operations.reviewInventory("weekly");
  assert.equal(review.ok, true, JSON.stringify(review));
  const inv = review.value;
  assert.equal(inv.cadence, "weekly");
  assert.equal(inv.horizon, (() => { const d = new Date(`${inv.today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })());
  assert.deepEqual(Object.fromEntries(Object.entries(inv.projects).map(([k, v]) => [k, v.length])), { planned: 2, active: 2, paused: 0, completed: 1, canceled: 0 });
  assert.deepEqual(inv.projects.active.find(p => p.title === "Stalled one").signals, ["no-next-action"]);
  const liveEntry = inv.projects.active.find(p => p.title === "Live one");
  assert.deepEqual([liveEntry.signals, liveEntry.tasks.open, liveEntry.tasks.overdue, liveEntry.tasks.next], [["overdue"], 2, 1, "2026-10-01"]);
  assert.ok(inv.actions.overdue.some(t => t.title === "Overdue step" && t.project.id === live.value.created.id), "Project-owned overdue Tasks are listed with their Project");
  const everyAction = Object.values(inv.actions).flat().map(t => t.ref.id);
  assert.ok(!everyAction.includes(heldDue.value.created.id), "a due Task of a planned Project is not an executable candidate");
  assert.deepEqual(inv.held.map(t => [t.ref.id, t.projectState]), [[heldDue.value.created.id, "planned"]], "it is listed as held under its planned Project");
  assert.deepEqual(inv.discrepancies.map(t => t.ref.id), [doneEarly.value.created.id], "completed work under a planned Project is surfaced, not changed");
  assert.ok(inv.actions.waiting.some(t => t.ref.id === waiting.id), "standalone waiting follow-ups are listed");
  assert.ok(inv.actions.today.some(t => t.title === "Through operations"), "a Daily Note Task defaults to its day");
  assert.equal(inv.captures.inbox.length, 1);
  assert.ok(inv.areas.find(a => a.ref.id === areaRef.id).projects.active >= 2, "Areas count their Projects by state");
  assert.equal(inv.population.coverage, "complete", JSON.stringify(inv.population));
  assert.equal(inv.population.projects, 5);
  assert.equal((await operations.reviewInventory("daily", 400)).error.code, "invalid");
  console.log("PASS: the review inventory reads captures, actions, Projects with signals and Areas in one call with coverage");

  // Review coverage: completeness is never inferred from the absence of a next page.
  {
    const page = (items, coverage) => async () => ({ ok: true, value: { items, coverage }, limits: [] });
    const port = coverage => ({
      areas: { query: page([], coverage) },
      projects: { query: page([], coverage) },
      tasks: { query: page([], coverage) },
      captures: { resolve: async () => ({ ok: true, value: { scope: SPACE.id, id: "inbox", role: "capture-surface" }, limits: [] }), list: page([], coverage) },
    });
    const unknown = await reviewInventory(port("unknown"), "weekly", "2026-10-13");
    assert.equal(unknown.value.population.coverage, "partial", "unknown coverage is not complete");
    assert.ok(["areas", "projects", "standalone tasks", "captures"].every(label => unknown.value.population.gaps.some(gap => gap.startsWith(`${label}:`))), JSON.stringify(unknown.value.population.gaps));
    const complete = await reviewInventory(port("complete"), "weekly", "2026-10-13");
    assert.deepEqual([complete.value.population.coverage, complete.value.population.gaps], ["complete", []]);
    const inboxOnly = { ...port("complete"), captures: { ...port("complete").captures, list: page([], "unknown") } };
    assert.equal((await reviewInventory(inboxOnly, "weekly", "2026-10-13")).value.population.coverage, "partial", "an Inbox of unknown coverage is a gap");
    const partialRecord = { ...port("complete"), areas: { query: page([{ ref: { kind: "Area", scope: SPACE.id, id: "area-1" }, value: { title: "Half read", state: "active" }, coverage: "partial" }], "complete") } };
    const recordGap = await reviewInventory(partialRecord, "weekly", "2026-10-13");
    assert.equal(recordGap.value.population.coverage, "partial", "a record read partially is a gap even on a complete page");
    assert.ok(recordGap.value.population.gaps.some(gap => gap.includes("area-1")));
  }
  console.log("PASS: the review inventory treats unknown or partial page and record coverage as gaps");

  const status = await operations.runtimeStatus();
  assert.equal(status.value.settings, "ready");
  assert.equal(status.value.stage, "review-slice");
  console.log("PASS: operations resolve grants from the control store and refuse writes without one");

  // Setup through operations on an empty root: establish writes Settings, proposal lists defaults, grant persists them.
  const setupRoot = path.join(temporary, "setup-control");
  const setupControl = createLocalControlAdapter({ root: setupRoot, knownOperations: async () => Object.keys((await knowledge.capabilities()).value).filter(k => !k.includes(".query.")) });
  const setupFake = fakeCraft();
  const setupKnowledge = createCraftAdapter({ connection: setupFake.connection, backendId: "craft" });
  const setupBinding = { backendId: "craft", endpoint: "https://mcp.craft.do/my/mcp", secretKey: "gpk:craft:craft", connection: setupFake.connection, knowledge: setupKnowledge, layout: async () => ({ ok: true, value: null, limits: [] }) };
  const setupOps = createOperations({ controlRoot: setupRoot, control: setupControl, binding: async () => ({ ok: false, error: { code: "unavailable", message: "no settings", affected: [], next: "" } }), setupBinding: async () => ({ ok: true, value: setupBinding, limits: [] }) });
  let inspected = await setupOps.setupInspect();
  assert.equal(inspected.value.settings, "uninitialized");
  assert.equal(inspected.value.connection.tokens, "verified");
  assert.ok(inspected.value.layout, "layout candidates are inspected once Craft is authorized");
  assert.equal((await setupOps.setupProposeGrants()).error.code, "unavailable", "proposals need initialized Settings");
  const setup = await setupOps.setupEstablish({ hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, preferences: { workingLanguage: "zh-CN", metadataLanguage: "zh-CN" } });
  assert.equal(setup.ok, true, JSON.stringify(setup));
  assert.equal(setup.value.settings.verified, true);
  const written = JSON.parse(fs.readFileSync(path.join(setupRoot, "settings.json"), "utf8"));
  assert.equal(written.knowledgeBackend.activeId, "craft");
  assert.equal(written.knowledgeBackend.configurations[0].instance, SPACE.id);
  assert.equal(written.knowledgeBackend.configurations[0].connection.credentialsRef, "gpk:craft:craft");
  assert.equal(written.knowledgeBackend.configurations[0].layout.locations.project.id, setup.value.locations.project.id);
  assert.equal(written.preferences.workingLanguage, "zh-CN");
  assert.equal(written.preferences.metadataLanguage, "zh-CN");
  const setupOps2 = createOperations({ controlRoot: setupRoot, control: setupControl, binding: async () => ({ ok: true, value: setupBinding, limits: [] }), setupBinding: async () => ({ ok: true, value: setupBinding, limits: [] }) });
  const proposal = await setupOps2.setupProposeGrants();
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  assert.equal(proposal.value.length, 8);
  assert.ok(proposal.value.some(g => g.root.id === "system" && g.operations.includes("checkpoints.save")), "checkpoints get their own root");
  assert.ok(proposal.value.every(g => !g.operations.some(op => /\.(remove|archive|restore)$/.test(op))), "destructive operations are never proposed");
  assert.ok(proposal.value.some(g => g.root.id === setup.value.locations.project.id && g.operations.includes("projects.create")));
  const grantedAll = await setupOps2.grantsGrant(proposal.value);
  assert.equal(grantedAll.ok, true, JSON.stringify(grantedAll));
  assert.equal(grantedAll.value.length, 8);
  assert.equal((await setupControl.grants.list()).value.items.length, 8);
  inspected = await setupOps2.setupInspect();
  assert.equal(inspected.value.settings, "ready");
  assert.deepEqual(inspected.value.layout.locations.map(l => l.status), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(inspected.value.grants, 8);
  const reEstablish = await setupOps2.setupEstablish({ hostDocument: { rootId: "x" }, areas: { id: setup.value.locations.area.id }, projects: { id: setup.value.locations.project.id }, sources: { id: setup.value.locations.source.id }, wikis: { id: setup.value.locations.wiki.id }, outputs: { id: setup.value.locations.output.id } });
  assert.equal(reEstablish.ok, true, JSON.stringify(reEstablish));
  assert.equal(reEstablish.value.created.length, 0, "re-running Setup adopts the existing layout and updates Settings");
  const updatedPrefs = await setupOps2.settingsUpdate({ preferences: { instructions: "中文优先" } });
  assert.equal(updatedPrefs.value.verified, true);
  console.log("PASS: Setup establishes the Craft layout, initializes Settings and persists the confirmed default grants");

  // Review finding 4: Setup checks the control store before creating anything in Craft.
  {
    const plan = { hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" } };
    const brokenRoot = path.join(temporary, "broken-setup-control");
    fs.mkdirSync(brokenRoot, { recursive: true });
    fs.writeFileSync(path.join(brokenRoot, "settings.json"), "{not json");
    const untouched = fakeCraft();
    const untouchedBinding = { ...setupBinding, connection: untouched.connection, knowledge: createCraftAdapter({ connection: untouched.connection, backendId: "craft" }) };
    const brokenOps = createOperations({ controlRoot: brokenRoot, control: createLocalControlAdapter({ root: brokenRoot }), binding: async () => ({ ok: false, error: { code: "unavailable", message: "no settings", affected: [], next: "" } }), setupBinding: async () => ({ ok: true, value: untouchedBinding, limits: [] }) });
    const refused = await brokenOps.setupEstablish(plan);
    assert.equal(refused.error.code, "invalid", JSON.stringify(refused));
    assert.match(refused.error.next, /Nothing was created/);
    assert.equal(untouched.calls.filter(([kind]) => kind === "write").length, 0, "malformed settings.json stops Setup before any Craft write");

    const flakyRoot = path.join(temporary, "flaky-setup-control");
    const flakyControl = createLocalControlAdapter({ root: flakyRoot });
    let reads = 0;
    const realRead = flakyControl.settings.read;
    flakyControl.settings.read = async () => ++reads === 1 ? realRead() : { ok: false, error: { code: "unavailable", message: "settings.json became unreadable", affected: [], next: "Restore access to the control root." } };
    const created = fakeCraft();
    const createdBinding = { ...setupBinding, connection: created.connection, knowledge: createCraftAdapter({ connection: created.connection, backendId: "craft" }) };
    const flakyOps = createOperations({ controlRoot: flakyRoot, control: flakyControl, binding: async () => ({ ok: false, error: { code: "unavailable", message: "no settings", affected: [], next: "" } }), setupBinding: async () => ({ ok: true, value: createdBinding, limits: [] }) });
    const half = await flakyOps.setupEstablish(plan);
    assert.equal(half.error.code, "partial", JSON.stringify(half));
    const createdIds = [...created.folders.keys(), ...created.documents.keys()];
    assert.ok(half.error.affected.length >= 5 && half.error.affected.every(ref => createdIds.includes(ref.id) || [...created.collections.values()].some(c => c.id === ref.id || c.documentId === ref.id)), "the created Craft references are reported for recovery: " + JSON.stringify(half.error.affected));
    assert.match(half.error.next, /adopting the created structures/);
  }
  console.log("PASS: Setup refuses unreadable Settings before touching Craft and reports created structures when Settings fail afterwards");

  // Bootstrap resolves the binding from Settings and uses the injected secret store.
  const booted = bootstrap({ env: { GPK_CONTROL_ROOT: root, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fake.connection });
  const bootedStatus = await booted.operations.runtimeStatus();
  assert.equal(bootedStatus.value.backend.id, "primary");
  assert.equal((await booted.operations.connectionStatus()).value.tokens, "verified");
  await booted.close();
  const uninitialized = bootstrap({ env: { GPK_CONTROL_ROOT: path.join(temporary, "empty"), HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fake.connection });
  assert.equal((await uninitialized.operations.tasksQuery({})).error.code, "unavailable", "knowledge operations need initialized Settings");
  assert.equal((await uninitialized.operations.runtimeStatus()).value.settings, "uninitialized");
  assert.equal((await uninitialized.operations.connectionStatus()).ok, true, "connection diagnostics work before Settings exist");
  assert.equal((await uninitialized.operations.setupInspect()).value.settings, "uninitialized");
  const secretFile = fileSecretStore(path.join(temporary, "secrets", "secrets.json"));
  await secretFile.write("k", "v");
  assert.equal(await secretFile.read("k"), "v");
  assert.equal(fs.statSync(path.join(temporary, "secrets", "secrets.json")).mode & 0o777, 0o600);
  // Two clients saving different keys at once keep both; no temp or lock files remain.
  const sharedSecrets = path.join(temporary, "shared-secrets", "secrets.json");
  const firstStore = fileSecretStore(sharedSecrets);
  const secondStore = fileSecretStore(sharedSecrets);
  await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? firstStore : secondStore).write(`fixture-key-${i}`, `fixture-value-${i}`)));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(sharedSecrets, "utf8"))).sort(), Array.from({ length: 6 }, (_, i) => `fixture-key-${i}`), "concurrent saves of different keys are all kept");
  await Promise.all([firstStore.remove("fixture-key-0"), secondStore.write("fixture-key-6", "fixture-value-6")]);
  const afterMixed = JSON.parse(fs.readFileSync(sharedSecrets, "utf8"));
  assert.deepEqual([afterMixed["fixture-key-0"], afterMixed["fixture-key-6"]], [undefined, "fixture-value-6"], "a concurrent remove and write both land");
  assert.deepEqual(fs.readdirSync(path.dirname(sharedSecrets)), ["secrets.json"], "no temporary or lock file is left behind");
  assert.equal(fs.statSync(sharedSecrets).mode & 0o777, 0o600);
  console.log("PASS: bootstrap binds Craft from Settings and keeps secrets out of the control files");
}

// ---------- Onboarding page: the only Setup surface ----------
{
  const http = await import("node:http");
  const onboardingFake = fakeCraft();
  const root = path.join(temporary, "onboarding-control");
  const opened = [];
  const booted = bootstrap({ env: { GPK_CONTROL_ROOT: root, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => onboardingFake.connection, openBrowser: async url => { opened.push(url); return true; } });
  const status0 = await booted.operations.runtimeStatus();
  assert.equal(status0.value.onboarding, "required");
  const blocked = await booted.operations.tasksQuery({});
  assert.equal(blocked.error.code, "unavailable");
  assert.match(blocked.error.next, /gpk_setup_open/, "knowledge work points at the onboarding page");
  const open = await booted.onboarding.open();
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.equal(opened.length, 1, "the page is opened in the browser");
  assert.deepEqual(open.value, { opened: true }, "the Agent does not receive the page URL when the browser opened it");
  const page = new URL(opened[0]);
  assert.equal(page.hostname, "127.0.0.1");
  const launch = page.searchParams.get("t");
  assert.ok(launch && launch.length >= 32, "the page URL carries a long one-time launch token");
  const request = (pathname, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: page.port, path: pathname, method, headers: { host: `127.0.0.1:${page.port}`, ...headers } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });

  // The launch token is spent by the first load and traded for an HttpOnly cookie.
  assert.equal((await request("/")).status, 403, "the page needs a launch token or session");
  assert.equal((await request(`/?t=${"x".repeat(launch.length)}`)).status, 403);
  assert.equal((await request(`/?t=${launch}`, { headers: { host: "evil.example:80" } })).status, 403, "a rebound Host is refused");
  const launched = await request(`/?t=${launch}`);
  assert.equal(launched.status, 303);
  assert.equal(launched.headers.location, "/", "the token leaves the address bar");
  const setCookie = launched.headers["set-cookie"][0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(";")[0];
  assert.equal((await request(`/?t=${launch}`)).status, 403, "a launch URL works once");
  const html = await request("/", { headers: { cookie } });
  assert.equal(html.status, 200);
  assert.ok(html.text.includes("GPK Setup"));
  assert.ok(!html.text.includes("x-gpk-token"), "the page holds no bearer token");
  const browser = { cookie, origin: page.origin, "sec-fetch-site": "same-origin" };
  const api = (pathname, body) => request(pathname, body === undefined
    ? { headers: { cookie, "sec-fetch-site": "same-origin" } }
    : { method: "POST", headers: { ...browser, "content-type": "application/json" }, body });

  // Requests without the browser session, or without same-origin markers on writes, are refused.
  assert.equal((await request("/api/state")).status, 403, "the API needs the session cookie");
  assert.equal((await request("/api/state", { headers: { "x-gpk-token": launch } })).status, 403, "the launch token is not an API credential");
  assert.equal((await request("/api/state", { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 403, "a cross-site read is refused");
  assert.equal((await request("/api/grants", { method: "POST", headers: { ...browser, "content-type": "text/plain" }, body: "{}" })).status, 415, "writes need a JSON body");
  assert.equal((await request("/api/grants", { method: "POST", headers: { ...browser, "content-type": "application/json", origin: "https://evil.example" }, body: {} })).status, 403, "a foreign Origin is refused");
  const { origin: _origin, ...noOrigin } = browser;
  assert.equal((await request("/api/grants", { method: "POST", headers: { ...noOrigin, "content-type": "application/json" }, body: {} })).status, 403, "a write without Origin is refused");
  const { "sec-fetch-site": _site, ...noSite } = browser;
  assert.equal((await request("/api/grants", { method: "POST", headers: { ...noSite, "content-type": "application/json" }, body: {} })).status, 403, "a write without Sec-Fetch-Site is refused");

  // Without a browser the URL is returned once for the user; opening again mints a new one.
  const fallback = createOnboarding({ operations: booted.operations, openBrowser: async () => false });
  const shown = await fallback.open();
  assert.equal(shown.value.opened, false);
  assert.match(shown.value.url, /\?t=/, "the URL is returned when no browser opened");
  const again = await fallback.open();
  assert.notEqual(again.value.url, shown.value.url, "each open mints a new launch token");
  const fallbackPort = new URL(again.value.url).port;
  const stale = await new Promise(resolve => http.get({ host: "127.0.0.1", port: fallbackPort, path: new URL(shown.value.url).pathname + new URL(shown.value.url).search, headers: { host: `127.0.0.1:${fallbackPort}` } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(stale, 403, "an earlier, unspent launch URL is replaced");
  await fallback.close();

  let state = (await api("/api/state")).json();
  assert.equal(state.ok, true, JSON.stringify(state));
  assert.equal(state.value.onboarding, "required");
  assert.equal(state.value.connection.tokens, "verified");
  assert.deepEqual(state.value.backends.filter(b => b.available).map(b => b.id), ["craft"], "only implemented knowledge bases are available");
  assert.equal((await api("/api/authorize", { backend: "notion" })).json().error.code, "invalid", "a coming-soon knowledge base cannot be connected");
  assert.equal((await api("/api/authorize", {})).json().error.code, "invalid", "the knowledge base must be named");
  assert.equal((await api("/api/authorize", { backend: "craft" })).json().value.state, "authorized");

  const form = { workspace: "dedicated", workingLanguage: "zh-CN", metadataLanguage: "zh-CN", timezone: null, names: { host: "GPK", areas: "领域", projects: "项目", sources: "来源", wikis: "知识", outputs: "产出" } };
  assert.equal((await api("/api/establish", { ...form, names: { ...form.names, areas: " " } })).json().error.code, "invalid", "blank names are refused");
  assert.equal((await api("/api/establish", { ...form, metadataLanguage: "fr" })).json().error.code, "invalid");
  const established = (await api("/api/establish", form)).json();
  assert.equal(established.ok, true, JSON.stringify(established));
  const written = JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8"));
  assert.deepEqual([written.preferences.workingLanguage, written.preferences.metadataLanguage], ["zh-CN", "zh-CN"]);
  assert.deepEqual([...onboardingFake.folders.values()].map(f => [f.name, f.parentId]).sort(), [["产出", null], ["来源", null], ["知识", null]], "a dedicated workspace is built at the top level");
  assert.deepEqual(onboardingFake.collections.get(written.knowledgeBackend.configurations[0].layout.locations.project.id).views.map(v => v.name), ["看板", "按领域", "进行中"], "view names follow the metadata language");
  assert.ok([...onboardingFake.documents.values()].find(d => d.title === "GPK Project").body.map(b => b.markdown).join("\n").includes("计划与行动"), "template headings follow the metadata language");
  assert.equal((await api("/api/establish", form)).json().error.code, "invalid", "a set-up workspace is not established twice");

  state = (await api("/api/state")).json().value;
  assert.equal(state.settings, "ready");
  assert.equal(state.onboarding, "required", "Settings alone do not complete onboarding");
  assert.equal(state.proposal.length, 8);
  const projectRoot = written.knowledgeBackend.configurations[0].layout.locations.project.id;
  assert.equal((await api("/api/grants", { grants: [{ root: projectRoot, operations: ["projects.remove"] }] })).json().error.code, "invalid", "the page cannot widen a proposed grant");
  assert.equal((await api("/api/grants", { grants: [{ root: "some-other-root", operations: ["tasks.create"] }] })).json().error.code, "invalid", "the page cannot add a root");
  const selection = state.proposal.map(grant => ({ root: grant.root.id, operations: grant.root.id === projectRoot ? grant.operations.filter(op => op !== "links.add") : grant.operations }));
  const granted = (await api("/api/grants", { grants: selection })).json();
  assert.deepEqual(granted.value, { written: 8, skipped: 0 }, JSON.stringify(granted));
  const grantsFile = JSON.parse(fs.readFileSync(path.join(root, "grants.json"), "utf8"));
  assert.ok(!grantsFile.grants.find(g => g.root.id === projectRoot).operations.includes("links.add"), "unticked operations are not granted");
  assert.deepEqual((await api("/api/grants", { grants: selection })).json().value, { written: 0, skipped: 8 }, "granting again writes nothing");
  assert.equal((await api("/api/state")).json().value.onboarding, "complete");
  assert.equal((await booted.operations.runtimeStatus()).value.onboarding, "complete");
  assert.equal((await api("/api/preferences", { workingLanguage: "en" })).json().ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).preferences.workingLanguage, "en");

  await booted.close();
  await assert.rejects(request("/api/state"), "the server stops with the runtime");
}
console.log("PASS: the onboarding page is the only Setup surface; a one-time launch URL becomes an HttpOnly session, the Agent gets no credential, and writes need same-origin browser markers");

// ---------- Debug log: opt-in, redacted, covers the onboarding flow ----------
{
  assert.equal(configureDebugLog({}, temporary), null, "the debug log is off unless GPK_DEBUG is set");
  assert.equal(redact("http://127.0.0.1:5/?t=abc123&x=1"), "http://127.0.0.1:5/?t=***&x=1");
  assert.equal(redact("callback?code=SECRET&state=S2"), "callback?code=***&state=***");
  assert.equal(redact('{"access_token":"A","refresh_token":"R","tokens":"verified"}'), '{"access_token":"***","refresh_token":"***","tokens":"verified"}');
  assert.equal(redact("cookie: gpk_session=XYZ; other=1"), "cookie: gpk_session=***; other=1");
  assert.equal(redact("Authorization: Bearer abc.def"), "Authorization: Bearer ***");
  const logRoot = path.join(temporary, "debug-control");
  const logFile = configureDebugLog({ GPK_DEBUG: "1" }, logRoot);
  assert.equal(logFile, path.join(logRoot, "logs", "debug.log"));
  try {
    const http = await import("node:http");
    const urls = [];
    const traced = bootstrap({ env: { GPK_CONTROL_ROOT: logRoot, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fakeCraft().connection, openBrowser: async url => { urls.push(url); return true; } });
    await traced.onboarding.open();
    const launchUrl = new URL(urls[0]);
    const cookie = await new Promise(resolve => http.get({ host: "127.0.0.1", port: launchUrl.port, path: launchUrl.pathname + launchUrl.search, headers: { host: launchUrl.host } }, res => { res.resume(); resolve(res.headers["set-cookie"][0].split(";")[0]); }));
    debug("test", "long", { body: "x".repeat(1000) });
    await traced.close();
    const log = fs.readFileSync(logFile, "utf8");
    for (const event of ["[onboarding] server-start", "[onboarding] open opened=true", "[onboarding] launch-spent", "status=303", "[onboarding] server-stop"]) assert.ok(log.includes(event), `missing ${event} in\n${log}`);
    assert.ok(!log.includes(launchUrl.searchParams.get("t")), "the launch token never reaches the log");
    assert.ok(!log.includes(cookie.split("=")[1]), "the session cookie never reaches the log");
    assert.ok(log.split("\n").every(line => line.length < 1200), "values are truncated");
    assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
  } finally {
    configureDebugLog({}, logRoot);
  }
}
console.log("PASS: the debug log is opt-in, traces the onboarding flow and keeps tokens, cookies and long bodies out");

// ---------- Craft connection retry policy against a local MCP-over-HTTP endpoint ----------
{
  const http = await import("node:http");
  const calls = { craft_read: 0, craft_write: 0 };
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    let body = ""; for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    if (message.method === "initialize") {
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-craft", version: "0" } } }));
      return;
    }
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    if (message.method === "tools/call") {
      calls[message.params.name]++;
      // The write may or may not have run on the server; the client cannot tell.
      response.writeHead(500, { "content-type": "text/plain" }).end("internal error");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const connection = createCraftConnection({ endpoint, secretKey: "k", secrets: memorySecretStore() });
  const write = await connection.write("documents create --title \"Once\"");
  assert.equal(write.ok, false);
  assert.equal(write.error.code, "unavailable");
  assert.equal(calls.craft_write, 1, "a write that failed with 500 is not repeated");
  const read = await connection.read("folders list");
  assert.equal(read.ok, false);
  assert.ok(calls.craft_read >= 2, "a read is repeated after a 500");
  await connection.close();
  server.close();
}
console.log("PASS: the Craft connection repeats reads after a server error but never a write whose effect is unknown");

function domainResult(result) {
  const parsed = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, parsed);
  assert.equal(Boolean(result.isError), !parsed.ok);
  return parsed;
}

const EXPECTED_TOOLS = [
  "gpk_runtime_status", "gpk_connection_status", "gpk_knowledge_capabilities", "gpk_control_capabilities",
  "gpk_settings_read", "gpk_grants_list", "gpk_setup_inspect", "gpk_setup_open", 
  "gpk_grants_revoke", "gpk_settings_update", "gpk_captures_resolve", "gpk_captures_list", "gpk_captures_read",
  "gpk_tasks_resolve", "gpk_tasks_read", "gpk_tasks_query", "gpk_tasks_create", "gpk_tasks_update", "gpk_tasks_transition", "gpk_tasks_schedule",
  "gpk_tasks_assign_project", "gpk_areas_resolve", "gpk_areas_read", "gpk_areas_create", "gpk_areas_update", "gpk_areas_transition",
  "gpk_projects_resolve", "gpk_projects_read", "gpk_projects_create", "gpk_projects_update", "gpk_projects_transition", "gpk_projects_assign_area", "gpk_projects_order_tasks",
  "gpk_materials_list", "gpk_materials_read", "gpk_materials_append", "gpk_materials_update",
  "gpk_sources_resolve", "gpk_sources_read", "gpk_sources_create", "gpk_sources_update",
  "gpk_wikis_resolve", "gpk_wikis_read", "gpk_wikis_create", "gpk_wikis_update",
  "gpk_outputs_resolve", "gpk_outputs_read", "gpk_outputs_create", "gpk_outputs_update",
  "gpk_links_query", "gpk_links_add", "gpk_links_remove", "gpk_checkpoints_read", "gpk_checkpoints_save", "gpk_review_inventory",
  "gpk_areas_query", "gpk_projects_query", "gpk_sources_query", "gpk_wikis_query", "gpk_outputs_query",
].sort();

/** The installed runtime writes its debug trace only when GPK_DEBUG is set. */
async function checkDebugLog(root, controlRoot) {
  const logFile = path.join(temporary, "stdio-debug.log");
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(root, "mcp/stdio.mjs")], cwd: root, stderr: "pipe",
    env: { GPK_CONTROL_ROOT: controlRoot, HOME: controlRoot, PATH: process.env.PATH, GPK_DEBUG: logFile },
  });
  const client = new Client({ name: "gpk-debug-check", version: "0" });
  await client.connect(transport, { timeout: 15000 });
  try {
    await client.callTool({ name: "gpk_runtime_status", arguments: {} });
    await client.callTool({ name: "gpk_tasks_query", arguments: { text: "dinner" } });
  } finally {
    await client.close();
  }
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /\[runtime\] start pid=\d+/);
  assert.match(log, /\[tool\] call name=gpk_runtime_status/);
  assert.match(log, /\[tool\] call name=gpk_tasks_query args=\{"text":"dinner"\}/, "arguments are traced");
  assert.match(log, /\[tool\] done name=gpk_tasks_query took=\d+ms ok=false code=unavailable/, "results are traced with their code");
}

async function checkStdio(root, config, negotiation, controlRoot) {
  assert.deepEqual(Object.keys(config.mcpServers), ["gpk"]);
  const entry = config.mcpServers.gpk;
  assert.equal(entry.type, "stdio");
  assert.equal(entry.command, "node");
  const args = entry.args.map(arg => arg.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, root));
  assert.equal(args[0], path.join(root, "mcp/stdio.mjs"));
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath, args, cwd: root, stderr: "pipe",
    env: { GPK_TEST_PRIVATE_SENTINEL: "do-not-echo-me", GPK_CONTROL_ROOT: controlRoot, HOME: controlRoot, PATH: process.env.PATH },
  });
  transport.stderr.on("data", chunk => { stderr += chunk; });
  const client = new Client({ name: "gpk-slice-test", version: "1.0.0" }, { versionNegotiation: { mode: negotiation } });
  try {
    await client.connect(transport, { timeout: 10000 });
    assert.equal(client.getServerVersion().version, version);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), EXPECTED_TOOLS);
    for (const tool of tools) {
      const writes = /_(create|update|transition|schedule|open|revoke|assign_project|assign_area|order_tasks|append|add|remove|save)$/.test(tool.name);
      assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
    }
    const call = (name, input = {}) => client.callTool({ name, arguments: input }, { timeout: 10000 });
    const status = domainResult(await call("gpk_runtime_status"));
    assert.equal(status.ok, true);
    assert.equal(status.value.stage, "review-slice");
    assert.equal(status.value.settings, "uninitialized");
    assert.equal(status.value.controlRoot, controlRoot);
    const settings = domainResult(await call("gpk_settings_read"));
    assert.deepEqual([settings.ok, settings.value], [true, null]);
    assert.equal(domainResult(await call("gpk_grants_list")).value.items.length, 0);
    assert.equal(status.value.onboarding, "required", "a fresh root must be onboarded first");
    for (const name of ["gpk_tasks_query", "gpk_knowledge_capabilities", "gpk_projects_query"]) {
      assert.equal(domainResult(await call(name)).error.code, "unavailable", `${name} needs initialized Settings`);
    }
    const connection = domainResult(await call("gpk_connection_status"));
    assert.equal(connection.ok, true, "connection status works before Settings exist");
    assert.equal(connection.value.tokens, "none");
    const inspect = domainResult(await call("gpk_setup_inspect"));
    assert.equal(inspect.value.settings, "uninitialized");
    assert.equal(inspect.value.grants, 0);
    assert.equal(domainResult(await call("gpk_tasks_create", { title: "x" })).error.code, "unavailable");
    for (const [name, input] of [
      ["gpk_runtime_status", { unexpected: true }],
      ["gpk_projects_query", { states: ["todo"] }],
      ["gpk_tasks_query", { limit: 0 }],
      ["gpk_tasks_query", { time: { from: "2026-02-30" } }],
      ["gpk_tasks_query", { project: { scope: "s", id: "x", kind: "Wiki" } }],
      ["gpk_tasks_create", { title: "x", grant: { operations: ["tasks.create"] } }],
      ["gpk_tasks_transition", { ref: { kind: "Task", scope: "s", id: "x" }, state: "deferred", reason: "r" }],
      ["gpk_tasks_update", { ref: { kind: "Task", scope: "s", id: "x" } }],
      ["gpk_tasks_schedule", { ref: { kind: "Task", scope: "s", id: "x" }, time: "" }],
      ["gpk_settings_read", { authority: "invented" }],
      ["gpk_grants_grant", { grants: [{ backendId: "b", root: { scope: "s", id: "r" }, operations: ["*"], unattended: false }] }],
      ["gpk_setup_establish", { hostDocument: { title: "GPK" } }],
      ["gpk_tasks_remove", {}],
    ]) {
      let result;
      try { result = await call(name, input); }
      catch { result = { isError: true }; }
      assert.equal(result.isError, true, `${name} must reject invalid input/unknown tool`);
      assert.notEqual(result.structuredContent?.error?.code, "unavailable", "invalid input must not reach the handlers");
    }
    assert.equal(domainResult(await call("gpk_runtime_status")).ok, true, "validation failures must not kill the process");
  } finally {
    await client.close();
  }
  assert.equal(stderr, "", "valid calls must not produce diagnostics or private output");
}

async function checkShutdown(entry, signal, controlRoot) {
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"], env: { GPK_CONTROL_ROOT: controlRoot, HOME: controlRoot, PATH: process.env.PATH } });
  const exited = once(child, "exit");
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        try {
          const message = JSON.parse(buffer.split("\n")[0]);
          assert.equal(message.id, 1);
          assert.ok(message.result);
          resolve();
        } catch (error) { reject(error); }
      });
      child.once("error", reject);
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "gpk-shutdown-test", version: "1" },
      },
    }) + "\n");
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stdio did not initialize")), 5000); })]);
    clearTimeout(timer);
    if (signal) child.kill(signal);
    else child.stdin.end();
    const [code, exitSignal] = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stdio did not shut down")), 5000); })]);
    assert.equal(code, 0);
    assert.equal(exitSignal, null);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

try {
  const emptyRoot = path.join(temporary, "empty-control");
  for (const target of ["claude", "codex"]) {
    const root = path.join(temporary, `${target} installed plugin with spaces`);
    fs.cpSync(path.join(repo, "dist/marketplace", target, "gpk"), root, { recursive: true });
    const before = fs.readdirSync(root).sort();
    const config = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    await checkStdio(root, config, "legacy", emptyRoot);
    await checkStdio(root, config, { pin: "2026-07-28" }, emptyRoot);
    if (target === "claude") await checkDebugLog(root, emptyRoot);
    await checkShutdown(path.join(root, "mcp/stdio.mjs"), undefined, emptyRoot);
    await checkShutdown(path.join(root, "mcp/stdio.mjs"), "SIGTERM", emptyRoot);
    assert.deepEqual(fs.readdirSync(root).sort(), before);
    assert.equal(fs.existsSync(emptyRoot), false, "the runtime never creates a control root");
    const notices = fs.readFileSync(path.join(root, "mcp/THIRD-PARTY-NOTICES.txt"), "utf8");
    for (const name of ["@modelcontextprotocol/server@", "@modelcontextprotocol/client@", "zod@"]) assert.ok(notices.includes(name), name);
    assert.equal(notices.includes(repo), false);
  }
  console.log("PASS: isolated Claude/Codex stdio exposes the Task-slice tools, both protocol eras, schemas and shutdown");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
