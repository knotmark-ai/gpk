#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { reviewRegressions } from "./review-regressions.mjs";
import { fakeCraft as createFakeCraft } from "./fake-craft.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gpk-runtime-"));
const serviceHome = path.join(temporary, "service-home");
const probe = buildSync({
  absWorkingDir: repo,
  stdin: { contents: [
    'export { createCraftAdapter } from "./src/adapters/craft.ts";',
    'export { createLocalControlAdapter, resolveControlRoot } from "./src/adapters/local-control.ts";',
    'export { memorySecretStore, fileSecretStore } from "./src/adapters/secret-store.ts";',
    'export { createCraftConnection } from "./src/adapters/craft-connection.ts";',
    'export { createCraftUploads } from "./src/adapters/craft-uploads.ts";',
    'export { createOperations } from "./src/runtime/operations.ts";',
    'export { bootstrap } from "./src/runtime/bootstrap.ts";',
    'export { createOnboarding } from "./src/onboarding/server.ts";',
    'export { reviewInventory } from "./src/runtime/review.ts";',
    'export { configureDebugLog, debug, redact } from "./src/runtime/debug-log.ts";',
  ].join("\n"), resolveDir: repo, loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, loader: { ".md": "text", ".html": "text" },
});
const probeFile = path.join(temporary, "probe.mjs");
fs.writeFileSync(probeFile, probe.outputFiles[0].contents);
const { createCraftAdapter, createLocalControlAdapter, resolveControlRoot, memorySecretStore, fileSecretStore, createCraftConnection, createCraftUploads, createOperations, bootstrap, createOnboarding, reviewInventory, configureDebugLog, debug, redact } =
  await import(pathToFileURL(probeFile).href);

const SPACE = { id: "space-1", name: "Test Space", timezone: "Asia/Shanghai" };
const fakeCraft = () => createFakeCraft(SPACE);
const settings = {
  schemaVersion: 1,
  preferences: { metadataLanguage: "en", contentLanguage: null, timezone: null, profileWiki: null, instructions: "" },
  knowledgeBackend: { activeId: "primary", configurations: [{
    id: "primary", adapter: "craft", instance: SPACE.id,
    connection: { kind: "mcp", transport: "http", endpoint: { kind: "public-url", url: "https://mcp.craft.do/my/mcp" } },
    layout: { locations: { area: { scope: SPACE.id, id: "a" }, project: { scope: SPACE.id, id: "p" }, source: { scope: SPACE.id, id: "s" }, wiki: { scope: SPACE.id, id: "w" }, output: { scope: SPACE.id, id: "o" } } },
  }] },
  templates: { area: null, project: null, task: null, source: null, wiki: null, output: null },
  ingestion: { automatic: { enabled: false, origins: [] } },
};
const grants = { schemaVersion: 1, grants: [
  { id: "daily", backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.create", "tasks.update", "tasks.transition", "tasks.schedule"], unattended: false },
] };

try {
// ---------- local control adapter ----------
{
  const root = path.join(temporary, "control");
  const control = createLocalControlAdapter({ root });
  assert.equal(resolveControlRoot({ HOME: "/home/x" }), path.join("/home/x", ".gpk"));
  assert.equal(resolveControlRoot({ GPK_CONTROL_ROOT: "/explicit/.gpk", HOME: "/home/x" }), "/explicit/.gpk");
  let read = await control.settings.read();
  assert.deepEqual([read.ok, read.value], [true, null], "missing root reads as never initialized");
  fs.mkdirSync(root, { recursive: true });
  // Portable local-vault connection and optional task/inbox/daily/system locations validate cleanly.
  const localVaultSettings = {
    ...settings,
    preferences: { ...settings.preferences, contentLanguage: "zh-CN" },
    knowledgeBackend: {
      activeId: "vault",
      configurations: [{
        id: "vault",
        adapter: "obsidian",
        instance: "personal-vault",
        connection: { kind: "local", path: "/Users/example/Vault" },
        layout: {
          locations: {
            ...settings.knowledgeBackend.configurations[0].layout.locations,
            task: { scope: "personal-vault", id: "tasks" },
            inbox: { scope: "personal-vault", id: "inbox" },
            daily: { scope: "personal-vault", id: "daily" },
            system: { scope: "personal-vault", id: ".gpk-system" },
          },
        },
      }],
    },
  };
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(localVaultSettings));
  const localRead = await control.settings.read();
  assert.equal(localRead.ok, true, JSON.stringify(localRead));
  assert.equal(localRead.value.value.preferences.contentLanguage, "zh-CN");
  assert.deepEqual(localRead.value.value.knowledgeBackend.configurations[0].connection, { kind: "local", path: "/Users/example/Vault" });
  assert.equal(localRead.value.value.knowledgeBackend.configurations[0].layout.locations.inbox.id, "inbox");
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
  const initialized = await freshControl.settings.initialize({ knowledgeBackend: settings.knowledgeBackend, preferences: { metadataLanguage: "zh-CN" } }, {});
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  assert.equal(initialized.value.verified, true);
  let current = await freshControl.settings.read();
  assert.equal(current.value.value.preferences.metadataLanguage, "zh-CN");
  assert.equal(current.value.value.preferences.instructions, "", "omitted preferences take their defaults");
  assert.equal(current.value.value.preferences.timezone, null, "declared defaults are materialized");
  assert.deepEqual(current.value.value.templates, { area: null, project: null, task: null, source: null, wiki: null, output: null });
  assert.equal(fs.readdirSync(fresh).filter(f => f.endsWith(".tmp")).length, 0, "temporary files are renamed away");
  assert.equal((await freshControl.settings.update({ preferences: { metadataLanguage: "zh-CN" } }, {})).error.code, "invalid", "no-op updates are rejected");
  assert.equal((await freshControl.settings.update({ preferences: { instructions: "x" } }, { expected: "sha256:stale" })).error.code, "conflict");
  const updated = await freshControl.settings.update({ preferences: { instructions: "Prefer concise answers." }, ingestion: { automatic: { enabled: true } } }, { expected: current.value.version });
  assert.equal(updated.value.verified, true);
  current = await freshControl.settings.read();
  assert.equal(current.value.value.preferences.instructions, "Prefer concise answers.");
  assert.equal(current.value.value.ingestion.automatic.enabled, true);
  assert.equal(current.value.value.preferences.metadataLanguage, "zh-CN", "omitted fields are preserved");
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

  // Settings written before the working language was dropped still read, and the next write removes it.
  {
    const legacyRoot = path.join(temporary, "legacy-control");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "settings.json"), JSON.stringify({ ...settings, preferences: { ...settings.preferences, workingLanguage: "zh-CN" } }));
    const legacy = createLocalControlAdapter({ root: legacyRoot });
    const read = await legacy.settings.read();
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal((await legacy.settings.update({ preferences: { instructions: "x" } }, {})).ok, true);
    assert.equal("workingLanguage" in JSON.parse(fs.readFileSync(path.join(legacyRoot, "settings.json"), "utf8")).preferences, false, "the legacy field is dropped on the next write");
  }
  console.log("PASS: Settings with the retired working language still read and lose it on the next write");
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
    second.settings.update({ preferences: { timezone: "Asia/Shanghai" } }, {}),
  ]);
  const merged = (await first.settings.read()).value.value.preferences;
  assert.deepEqual([merged.instructions, merged.timezone], ["Be brief.", "Asia/Shanghai"], "concurrent Settings updates both land");
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
  const status = await runtime.operations.tasksGet({});
  assert.equal(status.ok, false);
  assert.equal(status.error.code, "invalid", "the runtime reports invalid Settings instead of throwing");
  await runtime.close();
  console.log("PASS: a connection without an endpoint is rejected as invalid Settings and the runtime does not throw");
}

// ---------- fake Craft connection with the observed command surface ----------
// ---------- Craft adapter mapping ----------
{
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
  assert.deepEqual(query.value.items.map(i => i.ref.id), [waiting.id], "text queries include bodies");
  assert.deepEqual((await knowledge.tasks.query({ text: "Ticket 42" })).value.items.map(i => i.ref.id), [waiting.id], "text matching is case-insensitive");

  const container = await knowledge.containerOf(ref);
  assert.deepEqual(container.value, { key: "daily-notes/2026-10-01", kind: "daily-note", date: "2026-10-01" });

  // Grant enforcement at the port boundary.
  const wrongRoot = { ...grant, root: { scope: SPACE.id, id: "inbox" } };
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", { grants: [wrongRoot] })).error.code, "unauthorized");
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", { grants: [{ ...grant, operations: ["tasks.create"] }] })).error.code, "unauthorized");
  const stale = { grants: [grant], expected: "sha256:stale" };
  assert.equal((await knowledge.tasks.schedule(ref, "2026-10-20", stale)).error.code, "conflict");

  // Create, schedule, update, transition with read-back verification.
  const created = await knowledge.tasks.create({ title: "Submit the dinner reimbursement", content: "Receipt attached in Inbox", state: "todo", time: "2026-10-16" }, { grants: [grant] });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.value.verified, true);
  assert.equal(created.value.created.kind, "Task");
  const newRef = created.value.created;
  const stored = fake.tasks.get(newRef.id);
  assert.equal(stored.container.kind, "daily-note");
  assert.equal(stored.children[0].markdown, "Receipt attached in Inbox");
  assert.equal((await knowledge.tasks.create({ title: " ", content: "", state: "todo" }, { grants: [grant] })).error.code, "invalid");
  assert.equal((await knowledge.tasks.create({ title: "x", content: "", state: "todo", project: { kind: "Project", scope: SPACE.id, id: "p" } }, { grants: [grant] })).error.code, "unavailable");

  const callsBefore = fake.calls.length;
  const cleared = await knowledge.tasks.schedule(newRef, null, { grants: [grant], expected: created.value.version });
  assert.ok(!fake.calls.slice(callsBefore).some(([, c]) => c === "tasks list --scope all"), "a created Task's container is verified through its Daily Note, not a full-space scan");
  assert.equal(cleared.value.verified, true);
  assert.equal((await knowledge.tasks.read(newRef)).value.value.time, undefined);
  assert.ok(fake.calls.some(([, c]) => c.includes('"taskInfo":{"scheduleDate":null}')), "clearing uses the JSON null form");

  const edited = await knowledge.tasks.update(newRef, { title: "Submit the dinner reimbursement (R-2291)", edits: [{ before: "attached in Inbox", after: "submitted, reference R-2291" }], append: "Checked amount against card statement" }, { grants: [grant] });
  assert.equal(edited.value.verified, true, JSON.stringify(edited));
  assert.equal(fake.tasks.get(newRef.id).children[0].markdown, "Receipt submitted, reference R-2291");
  assert.equal(fake.tasks.get(newRef.id).children[1].markdown, "Checked amount against card statement");
  assert.equal((await knowledge.tasks.update(newRef, { edits: [{ before: "nowhere", after: "x" }] }, { grants: [grant] })).error.code, "conflict");

  const moved = await knowledge.tasks.transition(newRef, "waiting", "Waiting for finance to confirm", { grants: [grant] });
  assert.equal(moved.value.verified, true);
  assert.equal(fake.tasks.get(newRef.id).line, "Submit the dinner reimbursement (R-2291) #gpk/task/waiting");
  assert.ok(fake.tasks.get(newRef.id).children.at(-1).markdown.startsWith("waiting ("), "the reason is appended as a child block");
  const done = await knowledge.tasks.transition(newRef, "done", "Submitted and confirmed", { grants: [grant] });
  assert.equal(done.value.verified, true);
  assert.equal(fake.tasks.get(newRef.id).line, "Submit the dinner reimbursement (R-2291)", "completing a waiting Task removes its state tag");
  assert.equal((await knowledge.tasks.read(newRef)).value.value.state, "done");
  assert.equal((await knowledge.tasks.transition(newRef, "waiting", "no", { grants: [grant] })).error.code, "conflict", "done can only reopen to todo");
  assert.equal((await knowledge.tasks.transition(newRef, "todo", "", { grants: [grant] })).error.code, "invalid");
  const renamedAfterTag = await knowledge.tasks.update({ kind: "Task", scope: SPACE.id, id: waiting.id }, { title: "Access approval renamed" }, { grants: [grant] });
  assert.equal(renamedAfterTag.value.verified, true);
  assert.equal(fake.tasks.get(waiting.id).line, "Access approval renamed #gpk/task/waiting", "renaming re-emits the state tag");

  // Layout: inspect candidates, adopt an existing folder, create the rest.
  const existingSources = fake.seedFolder("Sources", 413);
  let inspection = await knowledge.workspace.inspect(settings.knowledgeBackend.configurations[0].layout.locations);
  assert.equal(inspection.ok, true, JSON.stringify(inspection));
  assert.deepEqual(inspection.value.locations.map(l => l.status), ["missing", "missing", "missing", "missing", "missing"]);
  assert.equal(inspection.value.candidates.folders[0].name, "Sources");
  const writesBeforeClash = fake.calls.filter(([kind]) => kind === "write").length;
  const clash = await knowledge.workspace.establish({ namespace: "root", hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, views: false, templates: false });
  assert.equal(clash.error.code, "conflict", "a root-level name clash is refused: " + JSON.stringify(clash));
  assert.match(clash.error.message, /"Sources" already exists .* Nothing was created/);
  assert.deepEqual(clash.error.affected.map(ref => ref.id), [existingSources.id], "the clashing folder is named");
  assert.equal(fake.calls.filter(([kind]) => kind === "write").length, writesBeforeClash, "a clash is found before anything is created");
  // A shared workspace: a namespace folder keeps GPK's structures apart from the user's own.
  const established = await knowledge.workspace.establish({ namespace: { folder: "GPK" }, hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { id: existingSources.id }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, metadataLanguage: "zh-CN" });
  assert.equal(established.ok, true, JSON.stringify(established));
  assert.equal(established.value.locations.source.id, existingSources.id);
  assert.equal(established.value.adopted.length, 1);
  assert.ok(established.value.created.length >= 5);
  assert.deepEqual(Object.keys(established.value.templateBindings).sort(), ["area", "output", "project", "source", "wiki"], "native Craft template bindings are recorded by role");
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
  assert.ok(projectTemplate.includes("Plan & Actions"), "the English template body is installed in every workspace");
  assert.ok(!/^- (Status|Primary Area)/m.test(projectTemplate), "Collection-column lines are stripped from the Project template");
  assert.ok(!projectTemplate.includes("<!--"), "authoring comments are stripped");
  // Rerunning with the same names reuses the namespace folder and does not reinstall templates.
  const again = await knowledge.workspace.establish({ namespace: { folder: "GPK" }, hostDocument: { rootId: established.value.created.find(r => fake.documents.get(r.id)?.title === "GPK").id }, areas: { id: established.value.locations.area.id }, projects: { id: established.value.locations.project.id }, sources: { id: existingSources.id }, wikis: { id: established.value.locations.wiki.id }, outputs: { id: established.value.locations.output.id }, metadataLanguage: "zh-CN" });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.value.namespace.id, namespace.id, "an existing root-level GPK folder is adopted");
  assert.equal(again.value.templates.length, 0, "templates already present by title are not duplicated");
  assert.deepEqual(again.value.templateBindings, established.value.templateBindings, "existing templates are still bound on re-establish");
  assert.deepEqual(again.value.views, [], "existing GPK views are not recreated on adopted Collections");
  assert.equal(fake.collections.get(established.value.locations.project.id).views.length, 3);
  assert.equal([...fake.documents.values()].filter(d => d.location === "templates").length, 5);
  const projectsCollection = fake.collections.get(established.value.locations.project.id);
  assert.deepEqual(projectsCollection.columns.map(c => c.type), ["singleSelect", "relation"]);
  assert.deepEqual(fake.collections.get(established.value.locations.area.id).columns[0].options, ["active", "inactive"]);
  inspection = await knowledge.workspace.inspect(established.value.locations);
  assert.deepEqual(inspection.value.locations.map(l => l.status), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal((await knowledge.workspace.establish({ hostDocument: { title: "GPK" }, areas: { id: existingSources.id }, projects: { name: "P" }, sources: { name: "S" }, wikis: { name: "W" }, outputs: { name: "O" } })).error.code, "invalid", "adopting a folder as the Areas Collection is refused");

  const capabilities = await knowledge.capabilities();
  assert.equal(capabilities.value["tasks.create"].mode, "native");
  assert.equal(capabilities.value["projects.create"].mode, "native");
  assert.equal(capabilities.value["sources.create"].mode, "native");
  assert.equal(capabilities.value["templates.read"].mode, "native");
  assert.equal("sources.archive" in capabilities.value, false, "unimplemented destructive stubs were removed");
  assert.equal((await knowledge.projects.query({})).error.code, "unavailable", "Collections need the layout from Settings");
  console.log("PASS: Craft adapter maps Tasks and captures onto the observed command surface with grant and version checks");

  // ---------- Project slice: Areas and Projects as Collection rows, Tasks inside Project rows ----------
  layoutLocations = established.value.locations;
  const areaGrant = { backendId: "primary", root: layoutLocations.area, operations: ["areas.create", "areas.update", "areas.transition"], unattended: false };
  const projectGrant = { backendId: "primary", root: layoutLocations.project, operations: ["projects.create", "projects.update", "projects.transition", "projects.assignArea", "projects.orderTasks", "projects.materials.append", "projects.materials.update", "tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject", "links.add"], unattended: false };
  assert.equal((await knowledge.areas.create({ title: "研究实践", content: "", state: "active" }, { grants: [projectGrant] })).error.code, "unauthorized", "Area writes need a grant on the Areas Collection");
  const area = await knowledge.areas.create({ title: "研究实践", content: "方向：把方法论做成可用的插件", state: "active" }, { grants: [areaGrant] });
  assert.equal(area.ok, true, JSON.stringify(area));
  assert.equal(area.value.verified, true);
  const areaRef = area.value.created;
  assert.deepEqual((await knowledge.areas.read(areaRef)).value.value, { title: "研究实践", content: "方向：把方法论做成可用的插件", state: "active" });
  assert.deepEqual((await knowledge.areas.resolve(areaRef.id)).value, areaRef);
  assert.equal((await knowledge.areas.resolve("aaaaaaaa-0000-0000-0000-999999999999")).error.code, "not-found");
  const areas = await knowledge.areas.query({ states: ["active"] });
  assert.deepEqual(areas.value.items.map(i => i.ref.id), [areaRef.id]);
  assert.equal(areas.value.coverage, "complete");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "same", { grants: [areaGrant] })).error.code, "conflict");
  const inactive = await knowledge.areas.transition(areaRef, "inactive", "Paused for the quarter", { grants: [areaGrant], expected: area.value.version });
  assert.equal(inactive.value.verified, true, JSON.stringify(inactive));
  assert.equal((await knowledge.areas.read(areaRef)).value.value.state, "inactive");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "Back", { grants: [areaGrant], expected: area.value.version })).error.code, "conflict", "a stale version is detected");
  assert.equal((await knowledge.areas.transition(areaRef, "active", "Back", { grants: [areaGrant] })).ok, true);

  const project = await knowledge.projects.create({ title: "GPK 第一个切片", content: "## Objective\n\n证明端到端可用", state: "active", primaryArea: areaRef }, { grants: [projectGrant] });
  assert.equal(project.ok, true, JSON.stringify(project));
  assert.equal(project.value.verified, true);
  const projectRef = project.value.created;
  const projectRead = await knowledge.projects.read(projectRef);
  assert.equal(projectRead.value.value.state, "active");
  assert.deepEqual(projectRead.value.value.primaryArea, areaRef);
  assert.equal((await knowledge.projects.create({ title: "Orphan", content: "", state: "planned", primaryArea: { kind: "Area", scope: SPACE.id, id: "aaaaaaaa-0000-0000-0000-999999999999" } }, { grants: [projectGrant] })).error.code, "not-found", "the primary Area must be a row");
  assert.deepEqual((await knowledge.projects.query({ area: areaRef, states: ["active"] })).value.items.map(i => i.ref.id), [projectRef.id]);
  assert.deepEqual((await knowledge.projects.query({ states: ["completed"] })).value.items, []);
  // Closed states are created only from recorded history, never as a fresh commitment.
  assert.equal((await knowledge.projects.create({ title: "Old audit", content: "", state: "completed", primaryArea: areaRef }, { grants: [projectGrant] })).error.code, "invalid", "a completed Project needs history");
  assert.equal((await knowledge.projects.create({ title: "Fresh", content: "", state: "planned", history: { origin: "x", date: "2024-05-01" }, primaryArea: areaRef }, { grants: [projectGrant] })).error.code, "invalid", "history does not apply to open work");
  assert.equal((await knowledge.projects.create({ title: "Old audit", content: "", state: "completed", history: { origin: "vault", date: "2024-02-30" }, primaryArea: areaRef }, { grants: [projectGrant] })).error.code, "invalid", "the history date must be real");
  assert.equal((await knowledge.tasks.create({ title: "Old step", content: "", state: "done", project: projectRef }, { grants: [projectGrant] })).error.code, "invalid", "a done Task needs history");
  assert.equal((await knowledge.tasks.create({ title: "Old errand", content: "", state: "done", history: { origin: "vault" } }, { grants: [grant] })).error.code, "invalid", "a recorded standalone Task needs its date for the Daily Note");
  assert.equal((await knowledge.tasks.create({ title: "Next step", content: "", state: "todo", history: { origin: "x", date: "2024-05-01" } }, { grants: [grant] })).error.code, "invalid", "history does not apply to an open Task");

  // Tasks inside the Project row, in plan order.
  const t1 = await knowledge.tasks.create({ title: "读契约", content: "Done when: 读完 port 文件", state: "todo", project: projectRef }, { grants: [projectGrant] });
  assert.equal(t1.ok, true, JSON.stringify(t1));
  const t2 = await knowledge.tasks.create({ title: "写适配器", content: "", state: "todo", time: "2026-10-12", project: projectRef }, { grants: [projectGrant] });
  assert.equal(t2.value.verified, true, JSON.stringify(t2));
  assert.equal((await knowledge.tasks.create({ title: "x", content: "", state: "todo", project: projectRef }, { grants: [grant] })).error.code, "unauthorized", "Project-owned Tasks need the Projects grant");
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
  const reordered = await knowledge.projects.orderTasks(projectRef, [t2.value.created, t1.value.created], { grants: [projectGrant] });
  assert.equal(reordered.value.verified, true, JSON.stringify(reordered));
  assert.deepEqual((await knowledge.tasks.query({ project: projectRef })).value.items.map(i => i.ref.id), [t2.value.created.id, t1.value.created.id]);
  assert.equal((await knowledge.projects.orderTasks(projectRef, [t1.value.created], { grants: [projectGrant] })).error.code, "conflict", "the order must cover every Task");
  const t3 = await knowledge.tasks.create({ title: "第三步", content: "", state: "todo", project: projectRef }, { grants: [projectGrant] });
  assert.deepEqual((await knowledge.tasks.query({ project: projectRef })).value.items.map(i => i.ref.id).at(-1), t3.value.created.id, "new Tasks follow the last Task");

  // Moving ownership: Daily Note -> Project -> standalone (requires grants on BOTH source and destination containers).
  const loose = await knowledge.tasks.create({ title: "零散任务", content: "", state: "todo" }, { grants: [grant] });
  const dailyAssignGrant = { ...grant, operations: [...grant.operations, "tasks.assignProject"] };
  assert.equal((await knowledge.tasks.assignProject(loose.value.created, projectRef, "Missing source grant", { grants: [projectGrant] })).error.code, "unauthorized", "moving out of Daily Note requires daily-notes grant");
  assert.equal((await knowledge.tasks.assignProject(loose.value.created, projectRef, "Missing dest grant", { grants: [dailyAssignGrant] })).error.code, "unauthorized", "moving into Project requires Projects grant");
  const adopted = await knowledge.tasks.assignProject(loose.value.created, projectRef, "Belongs to the slice", { grants: [dailyAssignGrant, projectGrant] });
  assert.equal(adopted.value.verified, true, JSON.stringify(adopted));
  assert.deepEqual((await knowledge.tasks.read(loose.value.created)).value.value.project, projectRef);
  assert.equal((await knowledge.tasks.assignProject(loose.value.created, projectRef, "again", { grants: [dailyAssignGrant, projectGrant] })).error.code, "conflict");
  const released = await knowledge.tasks.assignProject(loose.value.created, null, "Not part of the slice after all", { grants: [dailyAssignGrant, projectGrant] });
  assert.equal(released.value.verified, true, JSON.stringify(released));
  assert.equal((await knowledge.tasks.read(loose.value.created)).value.value.project, undefined);
  assert.equal((await knowledge.tasks.assignProject({ kind: "Task", scope: SPACE.id, id: inDoc.id }, projectRef, "x", { grants: [dailyAssignGrant, projectGrant] })).error.code, "unsupported", "Tasks outside GPK's locations are not moved");

  // Materials and closure.
  const inline = await knowledge.projects.materials.append(projectRef, { title: "Research", content: "Notes", presentation: "inline" }, { grants: [projectGrant] });
  assert.equal(inline.ok, true, JSON.stringify(inline));
  const childDoc = await knowledge.projects.materials.append(projectRef, { title: "Decision: MCP over REST", content: "Both compare on read-back.", presentation: "child-document" }, { grants: [projectGrant] });
  assert.equal(childDoc.ok, true, JSON.stringify(childDoc));
  const materials = await knowledge.projects.materials.list(projectRef);
  assert.deepEqual(materials.value.items.map(i => i.value.title), ["Decision: MCP over REST"], "nested pages are materials; inline sections stay in the body");
  const material = await knowledge.projects.materials.read(materials.value.items[0].ref);
  assert.deepEqual(material.value.value, { title: "Decision: MCP over REST", content: "Both compare on read-back.", presentation: "child-document" });
  const materialEdit = await knowledge.projects.materials.update(materials.value.items[0].ref, { edits: [{ before: "Both compare", after: "Both transports compare" }], append: "Confirmed on HTTP." }, { grants: [projectGrant], expected: material.value.version });
  assert.equal(materialEdit.value.verified, true, JSON.stringify(materialEdit));
  assert.equal((await knowledge.projects.transition(projectRef, "completed", "Done", { grants: [projectGrant] })).error.code, "conflict", "open Tasks block closure");
  for (const t of [t1, t2, t3]) assert.equal((await knowledge.tasks.transition(t.value.created, "done", "ok", { grants: [projectGrant] })).value.verified, true);
  const renamed = await knowledge.projects.update(projectRef, { title: "GPK 第一个切片（完成）", edits: [{ before: "证明端到端可用", after: "证明端到端可用：已完成" }] }, { grants: [projectGrant] });
  assert.equal(renamed.value.verified, true, JSON.stringify(renamed));
  const otherArea = await knowledge.areas.create({ title: "产品", content: "", state: "active" }, { grants: [areaGrant] });
  const reassigned = await knowledge.projects.assignArea(projectRef, otherArea.value.created, "Ownership moved", { grants: [projectGrant] });
  assert.equal(reassigned.value.verified, true, JSON.stringify(reassigned));
  const completed = await knowledge.projects.transition(projectRef, "completed", "All Tasks done", { grants: [projectGrant] });
  assert.equal(completed.value.verified, true, JSON.stringify(completed));
  const finalRead = await knowledge.projects.read(projectRef);
  assert.equal(finalRead.value.value.state, "completed");
  assert.equal(finalRead.value.value.title, "GPK 第一个切片（完成）");
  assert.deepEqual(finalRead.value.value.primaryArea, otherArea.value.created);
  assert.ok(finalRead.value.value.content.includes("completed ("), "the closure reason is recorded in the body");
  assert.equal((await knowledge.projects.transition(projectRef, "active", "Reopen", { grants: [projectGrant] })).error.code, "conflict", "closed Projects are not reopened here");
  console.log("PASS: Areas and Projects live as Collection rows; Tasks are owned by the Project row they sit in");

  // ---------- Knowledge slice: Sources/Wikis/Outputs as folder documents, links, checkpoints ----------
  const sourceGrant = { backendId: "primary", root: layoutLocations.source, operations: ["sources.create", "sources.update", "links.add", "links.remove"], unattended: false };
  const wikiGrant = { backendId: "primary", root: layoutLocations.wiki, operations: ["wikis.create", "wikis.update", "links.add"], unattended: false };
  const outputGrant = { backendId: "primary", root: layoutLocations.output, operations: ["outputs.create", "outputs.update", "links.add"], unattended: false };
  const systemGrant = { backendId: "primary", root: { scope: SPACE.id, id: "system" }, operations: ["checkpoints.save"], unattended: false };
  assert.equal((await knowledge.sources.create({ title: "x", content: "" }, { grants: [wikiGrant] })).error.code, "unauthorized", "Source writes need the Sources folder grant");
  const source = await knowledge.sources.create({ title: "Craft 3.4.4 release notes", content: "Origin: https://example.com/notes (accessed 2026-10-11)\n\nSummary: adds collection views." }, { grants: [sourceGrant] });
  assert.equal(source.ok, true, JSON.stringify(source));
  assert.equal(source.value.verified, true);
  const sourceRef = source.value.created;

  // Local files in a created body: copied in place through the upload route, only from approved folders.
  const vault = fs.realpathSync(fs.mkdtempSync(path.join(temporary, "vault-")));
  fs.mkdirSync(path.join(vault, "Assets"));
  fs.writeFileSync(path.join(vault, "Assets", "chart.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(vault, "Assets", "a report.pdf"), "%PDF-1.4");
  fs.writeFileSync(path.join(vault, "Assets", "notes"), "no extension");
  fs.writeFileSync(path.join(temporary, "outside.png"), "outside");
  fs.symlinkSync(path.join(temporary, "outside.png"), path.join(vault, "Assets", "escape.png"));
  const uploadsSeen = [];
  let uploadNo = 0, loseUploadReceipt = false;
  const fakeFetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname.endsWith("/connection")) return new Response(JSON.stringify({ space: { id: SPACE.id } }), { status: 200 });
    const pageId = target.searchParams.get("pageId");
    const doc = fake.documents.get(pageId) ?? [...fake.documents.values()].flatMap(doc => doc.body).find(block => block?.id === pageId);
    if (!doc) return new Response("{}", { status: 404 });
    const blockId = `cccccccc-0000-0000-0000-${String(++uploadNo).padStart(12, "0")}`;
    const image = String(init.headers["content-type"]).startsWith("image/");
    (doc.children ?? doc.body).push({ id: blockId, type: image ? "image" : "file", markdown: `![](https://r.craft.do/${blockId})` });
    uploadsSeen.push({ pageId, fileName: target.searchParams.get("fileName"), type: init.headers["content-type"], auth: init.headers.authorization, bytes: init.body.length });
    if (loseUploadReceipt) { loseUploadReceipt = false; return new Response("unreadable receipt", { status: 200 }); }
    return new Response(JSON.stringify({ blockId, assetUrl: `https://r.craft.do/${blockId}` }), { status: 200 });
  };
  const uploads = createCraftUploads({ fetch: fakeFetch, intervalMs: 0 });
  let mediaConfig = { credentials: { url: "https://connect.craft.do/links/abc/api/v1", key: "pdk_test" }, roots: [vault] };
  const mediaKnowledge = createCraftAdapter({ connection: fake.connection, backendId: "primary", layout: async () => ({ ok: true, value: layoutLocations, limits: [] }), media: async () => ({ ok: true, value: mediaConfig, limits: [] }), uploads });
  const fileUrl = name => `file://${path.join(vault, "Assets", name)}`;
  const withMedia = await mediaKnowledge.sources.create({ title: "Traffic replay talk", content: `Intro paragraph.\n\n![chart](${fileUrl("chart.png")})\n\nAfter the chart.\n\n[slides](<file://${path.join(vault, "Assets", "a report.pdf")}>)` }, { grants: [sourceGrant] });
  assert.equal(withMedia.ok, true, JSON.stringify(withMedia));
  assert.deepEqual(fake.documents.get(withMedia.value.created.id).body.map(b => b.type), ["text", "image", "text", "file"], "files land where they were referenced");
  assert.deepEqual(uploadsSeen.map(u => [u.fileName, u.type, u.auth]), [["chart.png", "image/png", "Bearer pdk_test"], ["a report.pdf", "application/pdf", "Bearer pdk_test"]]);
  const before = fake.documents.size;
  const refused = async (content, code, why) => {
    const result = await mediaKnowledge.sources.create({ title: "Refused", content }, { grants: [sourceGrant] });
    assert.equal(result.ok ? "ok" : result.error.code, code, why);
    assert.equal(fake.documents.size, before, `${why}: nothing is created`);
  };
  await refused(`![x](file://${path.join(temporary, "outside.png")})`, "unauthorized", "a file outside the approved folders is refused");
  await refused(`![x](${fileUrl("escape.png")})`, "unauthorized", "a link out of the approved folder is refused");
  await refused(`[x](${fileUrl("notes")})`, "invalid", "a file without a media or document type is refused");
  await refused(`See ![x](${fileUrl("chart.png")}) inline.`, "invalid", "a local file must be alone on its line");
  await refused(`![x](${fileUrl("missing.png")})`, "not-found", "a missing file is refused");
  mediaConfig = { credentials: null, roots: [vault] };
  await refused(`![x](${fileUrl("chart.png")})`, "unavailable", "without an upload route nothing is copied");
  mediaConfig = { credentials: mediaConfig.credentials ?? { url: "https://connect.craft.do/links/abc/api/v1" }, roots: [] };
  await refused(`![x](${fileUrl("chart.png")})`, "unauthorized", "with no approved folder nothing is read");
  assert.equal((await knowledge.sources.create({ title: "No media runtime", content: `![x](${fileUrl("chart.png")})` }, { grants: [sourceGrant] })).error.code, "unsupported", "a runtime without uploads refuses local files");
  mediaConfig = { credentials: { url: "https://connect.craft.do/links/abc/api/v1" }, roots: [vault] };
  assert.equal((await mediaKnowledge.sources.update(withMedia.value.created, { edits: [{ before: "After the chart.", after: `![x](${fileUrl("chart.png")})` }] }, { grants: [sourceGrant] })).error.code, "unsupported", "edits do not copy files");
  assert.equal(uploadsSeen.length, 2, "refused bodies upload nothing");
  const originalOnCreate = await mediaKnowledge.sources.create({ title: "Inline original on create", content: "Created with original attachment.", originalFile: fileUrl("a report.pdf") }, { grants: [sourceGrant] });
  assert.equal(originalOnCreate.ok, true, JSON.stringify(originalOnCreate));
  assert.equal(originalOnCreate.value.verified, true);
  assert.equal(uploadsSeen.length, 3, "originalFile on sources.create uploads in the same operation");
  const originalRef = (await mediaKnowledge.sources.create({ title: "Submitted originals", content: "Verified summary." }, { grants: [sourceGrant] })).value.created;
  for (const extension of ["pdf", "md", "epub", "jsonl"]) {
    const fileName = "original." + extension;
    fs.writeFileSync(path.join(vault, "Assets", fileName), "Original bytes for " + extension);
    const initial = await mediaKnowledge.sources.read(originalRef);
    const original = { originalFile: fileUrl(fileName) };
    const attempts = await Promise.all([1, 2].map(() => mediaKnowledge.sources.update(originalRef, original, { grants: [sourceGrant], expected: initial.value.version })));
    assert.ok(attempts.some(result => result.value?.verified), JSON.stringify(attempts));
    const latest = await mediaKnowledge.sources.read(originalRef);
    const retry = await mediaKnowledge.sources.update(originalRef, original, { grants: [sourceGrant], expected: latest.value.version });
    assert.ok(retry.value?.verified, JSON.stringify(retry));
    assert.equal(uploadsSeen.filter(upload => upload.fileName === fileName).length, 1);
  }
  loseUploadReceipt = true;
  const lost = { originalFile: fileUrl("chart.png") };
  const lostAttempt = await mediaKnowledge.sources.update(originalRef, lost, { grants: [sourceGrant], expected: (await mediaKnowledge.sources.read(originalRef)).value.version });
  assert.equal(lostAttempt.error?.code, "uncertain");
  const sentCount = uploadsSeen.length;
  const afterLoss = await mediaKnowledge.sources.update(originalRef, lost, { grants: [sourceGrant], expected: (await mediaKnowledge.sources.read(originalRef)).value.version });
  assert.ok(afterLoss.value?.verified, JSON.stringify(afterLoss));
  assert.equal(uploadsSeen.length, sentCount, "response loss after upload reuses the native attachment");
  const mediaRef = (await mediaKnowledge.sources.create({ title: "Recover media", content: "" }, { grants: [sourceGrant] })).value.created;
  const mediaDoc = fake.documents.get(mediaRef.id);
  mediaDoc.body.push({ id: "cccccccc-0000-0000-0001-000000000001", type: "text", markdown: "" });
  const mediaRead = await mediaKnowledge.sources.read(mediaRef);
  const recovered = await mediaKnowledge.sources.update(mediaRef, {
    replaceContent: `![chart](${fileUrl("chart.png")})\n\nCaption`,
  }, { grants: [sourceGrant], expected: mediaRead.value.version });
  assert.equal(recovered.value?.verified, true, JSON.stringify(recovered));
  assert.deepEqual(mediaDoc.body.map(block => block.type), ["text", "image", "text"]);
  assert.equal((await uploads.verify({ url: "https://evil.example/links/abc/api/v1" }, SPACE.id)).error.code, "invalid", "only Craft API links are accepted");
  assert.equal((await uploads.verify({ url: "https://connect.craft.do/links/abc/api/v1" }, "another-space")).error.code, "invalid", "a connection to another space is refused");
  console.log("PASS: local files in a created body are copied in place from approved folders only, and refused before anything is written");
  const dailyGuard = { grants: [{ ...sourceGrant, root: { scope: sourceRef.scope, id: "daily-notes" }, operations: ["captures.recordSource"] }] };
  const log = () => knowledge.captures.recordActivity("2026-11-19", "Saved", sourceRef, dailyGuard);
  assert.equal((await knowledge.captures.recordActivity("2026-11-19", "Saved", sourceRef, { grants: [sourceGrant] })).error.code, "unauthorized");
  const dailyBefore = fake.calls.filter(([, command]) => command.startsWith("blocks add --date")).length;
  const logs = await Promise.all([log(), log(), log()]);
  assert.ok(logs.every(result => result.value?.verified), JSON.stringify(logs));
  assert.deepEqual(logs[0].value.affected, logs[2].value.affected);
  assert.equal(fake.calls.filter(([, command]) => command.startsWith("blocks add --date")).length, dailyBefore + 1);
  const activityGrant = { grants: [{ ...dailyGuard.grants[0], operations: ["captures.recordActivity"] }] };
  const record = (summary, related) => knowledge.captures.recordActivity("2026-11-19", summary, related, activityGrant);
  const progress = await record("Finished the launch rehearsal.", projectRef);
  assert.ok(progress.value?.verified, JSON.stringify(progress));
  assert.deepEqual((await record("Finished the launch rehearsal.", projectRef)).value.affected, progress.value.affected);
  assert.notDeepEqual((await record("Moved the launch to Friday.", projectRef)).value.affected, progress.value.affected);
  assert.ok((await record("Attended the accessibility workshop.")).value?.verified);
  assert.equal((await knowledge.captures.recordActivity("2026-11-19", "Changed the plan.", projectRef, dailyGuard)).error.code, "unauthorized");
  assert.equal((await record("Injected\n- [ ] task")).error.code, "invalid");
  assert.deepEqual((await knowledge.captures.recordActivity("2026-11-19", "Saved", sourceRef, activityGrant)).value.affected, logs[0].value.affected);
  const listing = await knowledge.sources.create({ title: "Native formatting", content: "## Options\n· First\n- Second\n\n1. Third\n2. Fourth" }, { grants: [sourceGrant] });
  assert.ok(listing.value?.verified, JSON.stringify(listing));
  const body = fake.documents.get(listing.value.created.id).body;
  assert.deepEqual(body.map(block => block.listStyle ?? block.textStyle), ["h2", "bullet", "bullet", "numbered", "numbered"]);
  delete body[1].listStyle;
  const flattened = await knowledge.sources.read(listing.value.created);
  const mismatched = await knowledge.sources.update(listing.value.created, { replaceContent: "## Options\n- First\n- Second\n1. Third\n2. Fourth" }, { grants: [sourceGrant], expected: flattened.value.version });
  assert.equal(mismatched.error?.code, "conflict", "matching characters cannot verify a flattened list");
  assert.equal(sourceRef.kind, "Source");
  assert.equal(fake.documents.get(sourceRef.id).folderId, layoutLocations.source.id, "created in the Sources folder");
  const sourceRead = await knowledge.sources.read(sourceRef);
  assert.deepEqual(sourceRead.value.value, { title: "Craft 3.4.4 release notes", content: "Origin: https://example.com/notes (accessed 2026-10-11)\n\nSummary: adds collection views." });
  assert.deepEqual((await knowledge.sources.resolve(sourceRef.id)).value, sourceRef);
  assert.equal((await knowledge.wikis.resolve(sourceRef.id)).error.code, "not-found", "a Source is not a Wiki");
  const sourceEdit = await knowledge.sources.update(sourceRef, { title: "Craft 3.4.4 release notes (official)", edits: [{ before: "adds collection views", after: "adds collection views and templates" }] }, { grants: [sourceGrant], expected: sourceRead.value.version });
  assert.equal(sourceEdit.value.verified, true, JSON.stringify(sourceEdit));
  assert.equal((await knowledge.sources.update(sourceRef, { title: "stale" }, { grants: [sourceGrant], expected: sourceRead.value.version })).error.code, "conflict");
  const wiki = await knowledge.wikis.create({ title: "Craft Collections", content: "## Summary\n\nCollections are tables of pages." }, { grants: [wikiGrant] });
  assert.equal(wiki.ok, true, JSON.stringify(wiki));
  const wikiRef = wiki.value.created;
  const output = await knowledge.outputs.create({ title: "Architecture review report", content: "Delivered to the team on 2026-10-11." }, { grants: [outputGrant] });
  assert.equal(output.ok, true, JSON.stringify(output));
  const outputRef = output.value.created;
  assert.deepEqual((await knowledge.sources.query({ text: "release" })).value.items.map(i => i.ref.id), [sourceRef.id]);
  assert.equal((await knowledge.outputs.query({})).value.coverage, "complete");
  const outputAppended = await knowledge.outputs.update(outputRef, { append: "Follow-up summary appended." }, { grants: [outputGrant] });
  assert.equal(outputAppended.value.verified, true);
  assert.ok((await knowledge.outputs.read(outputRef)).value.value.content.endsWith("Follow-up summary appended."));

  // Links: written into the linking record's body, discovered in both directions.
  const link = { from: wikiRef, to: sourceRef, context: "Summary cites the release notes" };
  assert.equal((await knowledge.links.add(link, { grants: [sourceGrant] })).error.code, "unauthorized", "the grant follows the linking record");
  const added = await knowledge.links.add(link, { grants: [wikiGrant] });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.value.verified, true);
  const wikiBody = fake.documents.get(wikiRef.id).body.map(b => b.markdown);
  assert.ok(wikiBody.includes("## Links"), "a Links heading is added once");
  assert.ok(wikiBody.at(-1).startsWith(`- [Craft 3.4.4 release notes (official)](block://${sourceRef.id}) — Summary cites`), JSON.stringify(wikiBody));
  assert.equal((await knowledge.links.add(link, { grants: [wikiGrant] })).error.code, "conflict", "the same link is not added twice");
  const second = await knowledge.links.add({ from: wikiRef, to: projectRef, context: "Explains the slice" }, { grants: [wikiGrant] });
  assert.equal(second.value.verified, true, JSON.stringify(second));
  assert.equal(fake.documents.get(wikiRef.id).body.filter(b => b.markdown === "## Links").length, 1);
  const taskLink = await knowledge.links.add({ from: t1.value.created, to: outputRef, context: "Produced the report" }, { grants: [projectGrant] });
  assert.equal(taskLink.ok, true, JSON.stringify(taskLink)); assert.equal(taskLink.value.verified, true);
  const fromProject = await knowledge.links.add({ from: projectRef, to: wikiRef, context: "Background reading" }, { grants: [projectGrant] });
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
  assert.equal((await knowledge.links.remove(link, { grants: [wikiGrant] })).error.code, "unauthorized", "links.remove is a separate operation");
  const removed = await knowledge.links.remove(link, { grants: [{ ...wikiGrant, operations: ["links.remove"] }] });
  assert.equal(removed.value.verified, true, JSON.stringify(removed));
  assert.equal((await knowledge.links.query(sourceRef)).value.items.length, 0);

  // Checkpoints: nested pages of the GPK System page in the host document.
  assert.equal((await knowledge.checkpoints.read("ingest/example")).value, null, "absence is null, not an error");
  const hostRootId = fake.collections.get(layoutLocations.project.id).documentId;
  const systemPageOf = () => (fake.documents.get(hostRootId).body ?? []).find(b => b.markdown === "GPK System");
  assert.deepEqual(systemPageOf().children.filter(child => child.type === "page").map(page => page.markdown), ["gpk/layout"], "Setup keeps only the layout record there; reading a checkpoint creates nothing");
  assert.equal((await knowledge.checkpoints.save("ingest/example", "cursor=1", { grants: [sourceGrant] })).error.code, "unauthorized");
  assert.equal((await knowledge.checkpoints.save("gpk/layout", "{}", { grants: [systemGrant] })).error.code, "invalid", "the layout record cannot be overwritten as a checkpoint");
  const saved = await knowledge.checkpoints.save("ingest/example", "cursor=1\n\nlast=abc", { grants: [systemGrant] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.value.verified, true);
  const checkpoint = await knowledge.checkpoints.read("ingest/example");
  assert.equal(checkpoint.value.value, "cursor=1\n\nlast=abc");
  assert.ok((fake.documents.get(hostRootId).body ?? []).some(b => b.markdown === "GPK System"), "the system page holds the checkpoint");
  assert.equal((await knowledge.checkpoints.save("ingest/example", "cursor=2", { grants: [systemGrant], expected: "sha256:stale" })).error.code, "conflict");
  const replaced = await knowledge.checkpoints.save("ingest/example", "cursor=2", { grants: [systemGrant], expected: checkpoint.value.version });
  assert.equal(replaced.ok, true, JSON.stringify(replaced)); assert.equal(replaced.value.verified, true);
  assert.equal((await knowledge.checkpoints.read("ingest/example")).value.value, "cursor=2");
  assert.equal((await knowledge.checkpoints.read("ingest/other")).value, null);
  // Performance: no whole-Collection read per row operation, no body scan of unrelated documents.
  const collectionReads = () => fake.calls.filter(([, c]) => c === `blocks get --id ${layoutLocations.project.id} --format json --depth 1`).length;
  await knowledge.projects.read(projectRef);
  const readsBefore = collectionReads();
  await knowledge.projects.read(projectRef);
  assert.equal(collectionReads(), readsBefore, "reads of known rows do not list the whole Collection again");
  await knowledge.projects.update(projectRef, { edits: [{ before: "证明端到端可用：已完成", after: "证明端到端可用：已完成。" }] }, { grants: [projectGrant] });
  assert.equal(collectionReads(), readsBefore + 1, "a write checks membership once against a fresh listing, and its read-back reuses it");
  const unrelated = await knowledge.sources.create({ title: "Unrelated paper", content: "Nothing links anywhere." }, { grants: [sourceGrant] });
  const callsBeforeLinks = fake.calls.length;
  const viaSearch = await knowledge.links.query(outputRef);
  assert.deepEqual(viaSearch.value.items.map(l => l.from.kind).sort(), ["Task"], JSON.stringify(viaSearch));
  assert.ok(!fake.calls.slice(callsBeforeLinks).some(([, c]) => c.includes(unrelated.value.created.id)), "documents that do not mention the target are not read");
  assert.ok(viaSearch.limits.some(l => /searching the target's title/.test(l)));
  assert.deepEqual((await knowledge.sources.query({ text: "Nothing links" })).value.items.map(i => i.ref.id), [unrelated.value.created.id], "text queries match bodies through search");
  // Long pages: Craft pages direct children at 50; every page is read.
  const longWiki = await knowledge.wikis.create({ title: "Long wiki", content: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join("\n\n") }, { grants: [wikiGrant] });
  assert.equal(longWiki.ok, true, JSON.stringify(longWiki));
  const longRead = await knowledge.wikis.read(longWiki.value.created);
  assert.ok(longRead.value.value.content.endsWith("Paragraph 59"), "children beyond the first 50 are read");
  const lateEdit = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 57", after: "Paragraph 57 revised" }] }, { grants: [wikiGrant], expected: longRead.value.version });
  assert.equal(lateEdit.value.verified, true, "an edit past the 50th block finds and verifies its block");
  const lateLink = await knowledge.links.add({ from: longWiki.value.created, to: sourceRef, context: "Cited at the end" }, { grants: [wikiGrant] });
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
  const twoEdits = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 31", after: "Paragraph thirty-one" }, { before: "Paragraph 32", after: "Paragraph thirty-two" }] }, { grants: [wikiGrant] });
  assert.equal(twoEdits.ok, true, JSON.stringify(twoEdits)); assert.equal(twoEdits.value.verified, true);
  assert.equal((fake.connection.jsonBatches ?? 0) - batchesBefore, 1, "single-paragraph edits share one request");
  const split = await knowledge.wikis.update(longWiki.value.created, { edits: [{ before: "Paragraph 43", after: "Paragraph forty-three\n\nInserted after forty-three" }, { before: "Paragraph 44", after: "Paragraph forty-four" }] }, { grants: [wikiGrant] });
  assert.equal(split.ok, true, JSON.stringify(split));
  assert.ok((await knowledge.wikis.read(longWiki.value.created)).value.value.content.includes("Paragraph forty-three\n\nInserted after forty-three\n\nParagraph forty-four"), "a paragraph break inserts a sibling block");
  console.log("PASS: Sources, Wikis and Outputs are folder documents; links live in record bodies; checkpoints in the GPK System page");

  // A dedicated workspace: the default plan puts everything at the top level.
  {
    const freshFake = fakeCraft();
    const freshKnowledge = createCraftAdapter({ connection: freshFake.connection, backendId: "primary" });
    const fresh = await freshKnowledge.workspace.establish({ hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, views: false, templates: false });
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.value.namespace, null, "no namespace folder by default");
    assert.deepEqual([...freshFake.folders.values()].map(f => [f.name, f.parentId]).sort(), [["Outputs", null], ["Sources", null], ["Wikis", null]]);
    const freshHost = [...freshFake.documents.values()].find(d => d.title === "GPK");
    assert.equal(freshHost.folderId, null, "the host document sits at the top level (Unsorted)");

    // Settings lost (new machine, reset): inspection finds the workspace by its table schemas
    // and its layout record, and continuing with it by ID creates nothing.
    const creates = () => freshFake.calls.filter(([kind, command]) => kind === "write" && /^(documents|collections|folders) create/.test(command)).length;
    let found = await freshKnowledge.workspace.inspect();
    assert.equal(found.ok, true, JSON.stringify(found));
    assert.equal(found.value.existing.length, 1, JSON.stringify(found.value.existing));
    const workspace = found.value.existing[0];
    assert.deepEqual([workspace.areas.id, workspace.projects.id, workspace.folders?.source.id, workspace.folders?.wiki.id, workspace.folders?.output.id, workspace.namespace, workspace.metadataLanguage],
      [fresh.value.locations.area.id, fresh.value.locations.project.id, fresh.value.locations.source.id, fresh.value.locations.wiki.id, fresh.value.locations.output.id, null, "en"], "the layout record names every structure");
    assert.equal(workspace.home.title, "GPK");
    const before = creates();
    const rerun = await freshKnowledge.workspace.establish({ hostDocument: { rootId: workspace.home.id }, areas: { id: workspace.areas.id }, projects: { id: workspace.projects.id }, sources: { id: workspace.folders.source.id }, wikis: { id: workspace.folders.wiki.id }, outputs: { id: workspace.folders.output.id }, views: false, templates: false });
    assert.equal(rerun.ok, true, JSON.stringify(rerun));
    assert.equal(creates(), before, "continuing with the workspace creates nothing");
    assert.equal([...freshFake.documents.values()].filter(d => d.title === "GPK").length, 1);
    // `collections list` also lists tables of trashed documents; those are not workspaces.
    const copyHome = (documentId, location) => {
      freshFake.documents.set(documentId, { title: "GPK", folderId: null, location, body: [] });
      for (const id of [fresh.value.locations.area.id, fresh.value.locations.project.id]) {
        freshFake.collections.set(`${id}-${documentId}`, { ...freshFake.collections.get(id), id: `${id}-${documentId}`, documentId });
      }
    };
    copyHome("trashed-home", "trash");
    found = await freshKnowledge.workspace.inspect();
    assert.deepEqual(found.value.existing.map(entry => entry.home.id), [workspace.home.id], "a trashed home page is ignored");
    copyHome("second-home", "unsorted");
    found = await freshKnowledge.workspace.inspect();
    assert.equal(found.value.existing.length, 2, "every live workspace is offered");
    assert.equal(found.value.existing.find(entry => entry.home.id === "second-home").folders, null, "a home page without a layout record has no known folders");
    assert.equal((await freshKnowledge.workspace.inspect(fresh.value.locations)).value.existing, undefined, "a configured layout is not searched for alternatives");
  }
  console.log("PASS: the default Setup plan builds a dedicated workspace at its top level");

  // Containment: rows must belong to the configured Collection, materials to their Project.
  const areaAsProject = { kind: "Project", scope: SPACE.id, id: areaRef.id };
  assert.equal((await knowledge.projects.update(areaAsProject, { title: "hijack" }, { grants: [projectGrant] })).error.code, "not-found", "an Areas row is not a Project");
  assert.equal(fake.collections.get(layoutLocations.area.id).rows.find(r => r.id === areaRef.id).title !== "hijack", true);
  assert.equal((await knowledge.projects.transition(areaAsProject, "paused", "x", { grants: [projectGrant] })).error.code, "not-found");
  assert.equal((await knowledge.tasks.create({ title: "stray", content: "", state: "todo", project: areaAsProject }, { grants: [projectGrant] })).error.code, "not-found", "Tasks cannot be put into a row of another Collection");
  const otherProject = await knowledge.projects.create({ title: "Other", content: "", state: "planned", primaryArea: areaRef }, { grants: [projectGrant] });
  const materialOfFirst = (await knowledge.projects.materials.list(projectRef)).value.items[0].ref;
  const misattributed = { ...materialOfFirst, project: otherProject.value.created };
  assert.equal((await knowledge.projects.materials.update(misattributed, { title: "moved" }, { grants: [projectGrant] })).error.code, "not-found", "a material is edited only through its own Project");
  assert.equal((await knowledge.projects.materials.read(misattributed)).error.code, "not-found");
  const wikiPageAsMaterial = { scope: SPACE.id, id: wikiRef.id, role: "project-material", project: projectRef };
  assert.equal((await knowledge.projects.materials.update(wikiPageAsMaterial, { title: "x" }, { grants: [projectGrant] })).error.code, "not-found", "an arbitrary page is not a material");

  // Apostrophes survive JSON arguments.
  const quoted = await knowledge.projects.materials.append(projectRef, { title: "Owner's notes", content: "Don't drop this.", presentation: "child-document" }, { grants: [projectGrant] });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  const quotedRead = await knowledge.projects.materials.read(quoted.value.created);
  assert.deepEqual([quotedRead.value.value.title, quotedRead.value.value.content], ["Owner's notes", "Don't drop this."]);
  assert.equal((await knowledge.checkpoints.save("ingest/o'brien", "x", { grants: [systemGrant] })).value.verified, true);
  assert.equal((await knowledge.checkpoints.read("ingest/o'brien")).value.value, "x", "a key with an apostrophe reads back");
  assert.equal((await knowledge.checkpoints.save("ingest/o'brien", "y", { grants: [systemGrant], expected: (await knowledge.checkpoints.read("ingest/o'brien")).value.version })).value.verified, true);
  const systemPage = fake.documents.get(hostRootId).body.find(b => b.markdown === "GPK System");
  assert.equal(systemPage.children.filter(p => p.markdown === "ingest/o'brien").length, 1, "saving again replaces, not duplicates");
  console.log("PASS: rows, materials and Tasks stay inside their configured containers; apostrophes survive JSON arguments");

  // Review finding 1: authorization re-resolves a cached container instead of trusting it.
  {
    const step = await knowledge.tasks.create({ title: "Bound to the slice", content: "", state: "todo", project: projectRef }, { grants: [projectGrant] });
    assert.equal(step.ok, true, JSON.stringify(step));
    const stepRef = step.value.created;
    assert.equal((await knowledge.tasks.read(stepRef)).ok, true, "the read caches the container");
    const configured = layoutLocations;
    layoutLocations = { ...configured, project: configured.area };
    const afterLayoutChange = await knowledge.tasks.update(stepRef, { title: "Under a stale layout" }, { grants: [projectGrant] });
    layoutLocations = configured;
    assert.ok(!afterLayoutChange.ok && ["unauthorized", "not-found"].includes(afterLayoutChange.error.code), "a layout change invalidates the cached Project container: " + JSON.stringify(afterLayoutChange));
    assert.notEqual(fake.tasks.get(stepRef.id).line, "Under a stale layout");
    assert.equal((await knowledge.tasks.read(stepRef)).ok, true);
    const projects = fake.collections.get(layoutLocations.project.id);
    const holder = [...fake.collections.values()].find(c => c.id !== projects.id && c.rows);
    const row = projects.rows.find(r => r.id === projectRef.id);
    projects.rows.splice(projects.rows.indexOf(row), 1);
    holder.rows.push(row);
    const afterMove = await knowledge.tasks.update(stepRef, { title: "In a moved row" }, { grants: [projectGrant] });
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
    const step = await knowledge.tasks.create({ title: "Silent drop", content: "Original body", state: "todo" }, { grants: [grant] });
    const note = await knowledge.wikis.create({ title: "Silent wiki", content: "Original wiki body" }, { grants: [wikiGrant] });
    fake.connection.write = dropEdits;
    try {
      const taskEdit = await knowledge.tasks.update(step.value.created, { edits: [{ before: "Original body", after: "Changed body" }] }, { grants: [grant] });
      assert.equal(taskEdit.value?.verified, false, "a dropped Task body edit is unverified: " + JSON.stringify(taskEdit));
      const wikiEdit = await knowledge.wikis.update(note.value.created, { edits: [{ before: "Original wiki body", after: "Changed wiki body" }] }, { grants: [wikiGrant] });
      assert.equal(wikiEdit.value?.verified, false, "a dropped Wiki body edit is unverified: " + JSON.stringify(wikiEdit));
      const projectEdit = await knowledge.projects.update(otherProject.value.created, { edits: [{ before: "", after: "x" }] }, { grants: [projectGrant] });
      assert.ok(!projectEdit.ok || projectEdit.value.verified === false, "a dropped Project body edit is never verified");
    } finally {
      fake.connection.write = write;
    }
  }
  console.log("PASS: body edits the backend accepted but did not apply are reported as unverified");

  // Review finding 5: a listed record that cannot be read makes the page partial.
  {
    const broken = await knowledge.wikis.create({ title: "Unreadable wiki", content: "Body" }, { grants: [wikiGrant] });
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
    const dailyStep = await knowledge.tasks.create({ title: "Read the Collections wiki", content: "", state: "todo" }, { grants: [grant] });
    const dailyLinks = { ...grant, operations: [...grant.operations, "links.add", "links.remove"] };
    const linked = await knowledge.links.add({ from: dailyStep.value.created, to: wikiRef, context: "Background for today" }, { grants: [dailyLinks] });
    assert.equal(linked.ok, true, "the daily-notes wildcard covers links from a Daily Note Task: " + JSON.stringify(linked));
    assert.equal(linked.value.verified, true);
    assert.equal((await knowledge.links.add({ from: dailyStep.value.created, to: wikiRef, context: "again" }, { grants: [projectGrant] })).error.code, "unauthorized", "a Project grant does not cover a Daily Note Task");
  }
  console.log("PASS: links from a Daily Note Task are authorized by the daily-notes grant");

  // Operations resolve grants from the control store; tool arguments carry none.
  const root = path.join(temporary, "control");
  const control = createLocalControlAdapter({ root });
  const bindingValue = { backendId: "primary", adapter: "craft", endpoint: "https://mcp.craft.do/my/mcp", secretKey: "gpk:craft:primary", connection: fake.connection, knowledge, layout: async () => ({ ok: true, value: layoutLocations, limits: [] }) };
  const mediaSecrets = memorySecretStore();
  const operations = createOperations({ controlRoot: root, control, binding: async () => ({ ok: true, value: bindingValue, limits: [] }), setupBinding: async () => ({ ok: true, value: bindingValue, limits: [] }), media: { uploads, secretKey: id => `gpk:craft-uploads:${id}`, secrets: () => mediaSecrets } });
  const viaOps = await operations.tasksCreate({ title: "Through operations", content: "", state: "todo" });
  assert.equal(viaOps.ok, true, JSON.stringify(viaOps));
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [] }));
  // Onboarding gates every knowledge operation, reads included, until a grant exists.
  for (const gated of [operations.tasksCreate({ title: "No grant", content: "", state: "todo" }), operations.projectsGet({}), operations.tasksGet({ targets: [viaOps.value.created] }), operations.reviewInventory("weekly")]) {
    const result = await gated;
    assert.equal(result.error?.code, "unavailable", JSON.stringify(result));
    assert.match(result.error.next, /gpk_setup_open/);
  }
  assert.equal((await operations.knowledgeCapabilities()).ok, true, "the capability inventory stays available during onboarding");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [{ ...grants.grants[0], id: "elsewhere", root: { scope: SPACE.id, id: "inbox" } }] }));
  assert.equal((await operations.tasksCreate({ title: "No grant", content: "", state: "todo" })).error.code, "unauthorized");
  assert.equal((await operations.tasksUpdate({ ref: viaOps.value.created, transition: { state: "done", reason: "x" } })).error.code, "unauthorized");
  fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify(grants));
  // Images & files (onboarding page only): the upload route lives in the secret store, folders in Settings.
  assert.deepEqual((await operations.filesInspect()).value, { roots: [], uploads: "none" }, "Settings without files read as nothing approved");
  assert.equal((await operations.uploadsConnect("https://example.com/links/x/api/v1")).error.code, "invalid", "only Craft API links are accepted");
  const connected = await operations.uploadsConnect("https://connect.craft.do/links/abc/api/v1", "pdk_secret");
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.equal(connected.value.uploads, "connected");
  assert.equal(JSON.parse(await mediaSecrets.read("gpk:craft-uploads:primary")).key, "pdk_secret", "the link and key go to the secret store");
  const settingsText = fs.readFileSync(path.join(root, "settings.json"), "utf8");
  assert.ok(!settingsText.includes("pdk_secret") && !settingsText.includes("links/abc"), "Settings never hold the link or key");
  assert.match(settingsText, /gpk:craft-uploads:primary/);
  for (const broad of ["/", os.homedir(), root]) assert.equal((await operations.filesSetRoots([broad])).error.code, "invalid", `${broad} is too broad or GPK's own`);
  assert.equal((await operations.filesSetRoots(["relative/path"])).error.code, "invalid");
  assert.equal((await operations.filesSetRoots([path.join(vault, "nope")])).error.code, "not-found");
  assert.deepEqual((await operations.filesSetRoots([vault, `${vault}/`])).value.roots, [vault], "folders are stored once, as real paths");
  assert.deepEqual((await operations.setupInspect()).value.files, { roots: [vault], uploads: "connected" });
  const disconnected = await operations.uploadsDisconnect();
  assert.equal(disconnected.value.uploads, "none");
  assert.equal(await mediaSecrets.read("gpk:craft-uploads:primary"), null, "disconnecting removes the secret");
  console.log("PASS: the upload route is verified and kept in the secret store; approved folders are real, bounded paths");
  // Review inventory: one read of the reviewed population with coverage.
  const planned = await knowledge.projects.create({ title: "Planned later", content: "", state: "planned", primaryArea: areaRef }, { grants: [projectGrant] });
  const stalled = await knowledge.projects.create({ title: "Stalled one", content: "", state: "active", primaryArea: areaRef }, { grants: [projectGrant] });
  const live = await knowledge.projects.create({ title: "Live one", content: "", state: "active", primaryArea: areaRef }, { grants: [projectGrant] });
  await knowledge.tasks.create({ title: "Overdue step", content: "", state: "todo", time: "2026-10-01", project: live.value.created }, { grants: [projectGrant] });
  // Three days ahead of the real clock, so the step stays inside the weekly horizon and never turns overdue.
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await knowledge.tasks.create({ title: "Soon step", content: "", state: "todo", time: soon, project: live.value.created }, { grants: [projectGrant] });
  // A planned Project's due Task is held, not executable; actual work under it is a discrepancy.
  const heldDue = await knowledge.tasks.create({ title: "Due under planned", content: "", state: "todo", time: "2026-10-01", project: planned.value.created }, { grants: [projectGrant] });
  const doneEarly = await knowledge.tasks.create({ title: "Done under planned", content: "", state: "done", history: { origin: "the user's account in conversation", date: "2026-10-02" }, project: planned.value.created }, { grants: [projectGrant] });
  assert.equal(doneEarly.ok, true, JSON.stringify(doneEarly));
  assert.ok((await knowledge.tasks.read(doneEarly.value.created)).value.value.content.includes("done (2026-10-02): recorded from the user's account in conversation"), "the history is a dated state record");
  // An imported past Project keeps its own dates: the state record, its done Tasks, and a standalone Task in its day's Daily Note.
  const pastProject = await knowledge.projects.create({ title: "Audit 2024", content: "## Objective\n\nPass the audit", state: "completed", history: { origin: "Obsidian JeffSpace/10 Projects/Audit 2024.md", date: "2024-11-30" }, primaryArea: areaRef }, { grants: [projectGrant] });
  assert.equal(pastProject.ok, true, JSON.stringify(pastProject));
  const pastRead = (await knowledge.projects.read(pastProject.value.created)).value.value;
  assert.equal(pastRead.state, "completed");
  assert.ok(pastRead.content.includes("completed (2024-11-30): recorded from Obsidian JeffSpace/10 Projects/Audit 2024.md"), pastRead.content);
  const pastStep = await knowledge.tasks.create({ title: "Collect evidence", content: "", state: "done", history: { origin: "Obsidian JeffSpace/10 Projects/Audit 2024.md" }, project: pastProject.value.created }, { grants: [projectGrant] });
  assert.equal(pastStep.ok, true, JSON.stringify(pastStep));
  assert.ok((await knowledge.tasks.read(pastStep.value.created)).value.value.content.includes("done (date unknown): recorded from"), "an unknown date is stated, not estimated");
  const pastLoose = await knowledge.tasks.create({ title: "Renew the domain", content: "", state: "canceled", history: { origin: "Obsidian JeffSpace/20 Logs/2024-03-02.md", date: "2024-03-02" } }, { grants: [grant] });
  assert.equal(pastLoose.ok, true, JSON.stringify(pastLoose));
  assert.equal((await knowledge.containerOf(pastLoose.value.created)).value.date, "2024-03-02", "a recorded standalone Task lands in the Daily Note of its date");
  const review = await operations.reviewInventory("weekly");
  assert.equal(review.ok, true, JSON.stringify(review));
  const inv = review.value;
  assert.equal(inv.cadence, "weekly");
  assert.equal(inv.horizon, (() => { const d = new Date(`${inv.today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })());
  assert.deepEqual(Object.fromEntries(Object.entries(inv.projects).map(([k, v]) => [k, v.length])), { planned: 2, active: 2, paused: 0, completed: 2, canceled: 0 });
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
  assert.equal(inv.population.projects, 6);
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

  const status = await operations.status(["grants", "capabilities"]);
  assert.equal(status.value.settings, "ready");
  assert.equal(status.value.grants.items.length, 1);
  assert.equal(status.value.capabilities.knowledge["projects.create"].mode, "native");
  console.log("PASS: operations resolve grants from the control store and refuse writes without one");

  // Setup through operations on an empty root: establish writes Settings + template bindings, proposal lists defaults, grant persists them.
  const setupRoot = path.join(temporary, "setup-control");
  const setupControl = createLocalControlAdapter({ root: setupRoot, knownOperations: async () => Object.keys((await knowledge.capabilities()).value).filter(k => !k.includes(".query.")) });
  const setupFake = fakeCraft();
  const setupLayout = async () => {
    const s = await setupControl.settings.read();
    return s.ok ? { ok: true, value: s.value?.value.knowledgeBackend.configurations[0]?.layout.locations ?? null, limits: [] } : s;
  };
  const setupKnowledge = createCraftAdapter({ connection: setupFake.connection, backendId: "craft", layout: setupLayout });
  const setupBinding = { backendId: "craft", adapter: "craft", endpoint: "https://mcp.craft.do/my/mcp", secretKey: "gpk:craft:craft", connection: setupFake.connection, knowledge: setupKnowledge, layout: setupLayout };
  const setupOps = createOperations({ controlRoot: setupRoot, control: setupControl, binding: async () => ({ ok: false, error: { code: "unavailable", message: "no settings", affected: [], next: "" } }), setupBinding: async () => ({ ok: true, value: setupBinding, limits: [] }) });
  let inspected = await setupOps.setupInspect();
  assert.equal(inspected.value.settings, "uninitialized");
  assert.equal(inspected.value.connection.tokens, "verified");
  assert.ok(inspected.value.layout, "layout candidates are inspected once Craft is authorized");
  assert.equal((await setupOps.setupProposeGrants()).error.code, "unavailable", "proposals need initialized Settings");
  const setup = await setupOps.setupEstablish({ hostDocument: { title: "GPK" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, preferences: { metadataLanguage: "zh-CN" } });
  assert.equal(setup.ok, true, JSON.stringify(setup));
  assert.equal(setup.value.settings.verified, true);
  const written = JSON.parse(fs.readFileSync(path.join(setupRoot, "settings.json"), "utf8"));
  assert.equal(written.knowledgeBackend.activeId, "craft");
  assert.equal(written.knowledgeBackend.configurations[0].instance, SPACE.id);
  assert.equal(written.knowledgeBackend.configurations[0].connection.credentialsRef, "gpk:craft:craft");
  assert.equal(written.knowledgeBackend.configurations[0].layout.locations.project.id, setup.value.locations.project.id);
  assert.ok(written.templates.project?.id, "Setup binds installed Craft template references in Settings");
  assert.equal("workingLanguage" in written.preferences, false, "there is no working-language setting");
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
  const updatedPrefs = await setupOps2.preferencesUpdate({ preferences: { instructions: "中文优先", contentLanguage: "zh-CN" } });
  assert.equal(updatedPrefs.value.verified, true);
  console.log("PASS: Setup establishes the Craft layout, binds native Templates, initializes Settings and persists the confirmed default grants");

  // Native-first Craft Templates & Compound BFF Operations end-to-end.
  {
    const initialProjects = await setupOps2.projectsGet({});
    assert.equal(initialProjects.ok, true, JSON.stringify(initialProjects));
    assert.equal(initialProjects.value.customTemplates, undefined, "unmodified native templates cost zero extra context tokens");
    const statusWithTemplates = await setupOps2.status(["templates"]);
    assert.equal(statusWithTemplates.value.templates.project.source, "backend");
    assert.equal(statusWithTemplates.value.templates.project.customized, false);
    assert.equal(statusWithTemplates.value.templates.task.source, "bundled");

    // Simulate user editing GPK Project inside Craft's native Templates area.
    const tplDoc = setupFake.documents.get(written.templates.project.id);
    tplDoc.body.push(
      { id: "dddddddd-0000-0000-0000-000000000101", type: "text", markdown: "<callout>Keep KPI metrics explicit</callout>" },
      { id: "dddddddd-0000-0000-0000-000000000102", type: "text", textStyle: "h2", markdown: "## Risk Register" },
      { id: "dddddddd-0000-0000-0000-000000000103", type: "text", listStyle: "task", markdown: "- [ ] Accidental template checkbox" },
    );
    const setupOps3 = createOperations({ controlRoot: setupRoot, control: setupControl, binding: async () => ({ ok: true, value: setupBinding, limits: [] }), setupBinding: async () => ({ ok: true, value: setupBinding, limits: [] }) });
    const customizedProjects = await setupOps3.projectsGet({});
    assert.ok(customizedProjects.value.customTemplates?.project, "customized Craft template is piggybacked onto projectsGet");
    assert.ok(customizedProjects.value.customTemplates.project.includes("<callout>Keep KPI metrics explicit</callout>"), "user callouts survive template sanitization");
    assert.ok(customizedProjects.value.customTemplates.project.includes("## Risk Register"));
    assert.ok(customizedProjects.value.customTemplates.project.includes("- ☐ Accidental template checkbox"), "raw checkboxes in non-Task templates are converted to ☐");
    assert.ok(!customizedProjects.value.customTemplates.project.includes("GPK template ·"), "GPK's instruction banner callout is stripped");

    // Compound BFF creates, hydrated reads, batch Tasks, chained Task updates, and partial-failure receipts.
    const createdArea = await setupOps3.areasCreate({ title: "Platform Engineering", content: "## Scope\n\nCore agent infrastructure.", state: "active", activitySummary: "Established Platform Engineering area." });
    assert.equal(createdArea.ok, true, JSON.stringify(createdArea));
    const compoundProject = await setupOps3.projectsCreate({
      title: "BFF Rollout",
      content: "## Objective\n\nShip 28-tool MCP facade.\n\n## Risk Register\n\nSchema strictness.",
      state: "active",
      primaryArea: createdArea.value.created,
      initialTasks: [
        { title: "Audit tool schemas", content: "Check strictObject roots.", time: "2026-11-21" },
        { title: "Run release gate", state: "todo" },
      ],
      materials: [
        { title: "Migration Notes", content: "28 tools replace 68.", presentation: "child-document" },
      ],
      activitySummary: "Created BFF Rollout project with initial plan.",
    });
    assert.equal(compoundProject.ok, true, JSON.stringify(compoundProject));
    assert.equal(compoundProject.value.tasks.length, 2);
    assert.equal(compoundProject.value.materials.length, 1);

    const hydrated = await setupOps3.projectsGet({
      targets: [compoundProject.value.created],
      include: ["area", "tasks", "materials", "links"],
    });
    assert.equal(hydrated.ok, true, JSON.stringify(hydrated));
    const expanded = hydrated.value.included[compoundProject.value.created.id];
    assert.equal(expanded.area.value.title, "Platform Engineering");
    assert.equal(expanded.tasks.items.length, 2);
    assert.equal(expanded.materials.items.length, 1);

    const batchTasks = await setupOps3.tasksCreate({
      items: [
        { title: "Write migration guide", project: compoundProject.value.created },
        { title: "Verify Claude & Codex hooks", project: compoundProject.value.created },
      ],
    });
    assert.equal(batchTasks.ok, true, JSON.stringify(batchTasks));
    assert.equal(batchTasks.value.created.length, 2);

    const chainedTaskUpdate = await setupOps3.tasksUpdate({
      ref: compoundProject.value.tasks[0],
      title: "Audit all 28 tool schemas",
      append: "Verified top-level type: object on every tool.",
      time: "2026-11-22",
      transition: { state: "done", reason: "All 28 schemas validated" },
      activitySummary: "Completed schema audit.",
    });
    assert.equal(chainedTaskUpdate.ok, true, JSON.stringify(chainedTaskUpdate));
    assert.equal(chainedTaskUpdate.value.verified, true);

    // Mid-flight failure in a compound operation returns structured code: "partial" with completedSteps & failedStep.
    const partialBatch = await setupOps3.tasksCreate({
      items: [
        { title: "Valid first batch task", project: compoundProject.value.created },
        { title: "Invalid closed task without history", state: "done", project: compoundProject.value.created },
      ],
    });
    assert.equal(partialBatch.ok, false);
    assert.equal(partialBatch.error.code, "partial");
    assert.deepEqual(partialBatch.error.completedSteps, ["tasks.create[0]"]);
    assert.equal(partialBatch.error.failedStep, "tasks.create[1]");

    // Deleting a bound Craft template falls back gracefully to bundled default with a limits disclosure.
    setupFake.documents.delete(written.templates.project.id);
    const setupOps4 = createOperations({ controlRoot: setupRoot, control: setupControl, binding: async () => ({ ok: true, value: setupBinding, limits: [] }), setupBinding: async () => ({ ok: true, value: setupBinding, limits: [] }) });
    const afterDelete = await setupOps4.projectsGet({});
    assert.equal(afterDelete.ok, true);
    assert.equal(afterDelete.value.customTemplates, undefined, "falls back to bundled default when native template was deleted");
    assert.ok(afterDelete.limits.some(l => l.includes("bundled default")), JSON.stringify(afterDelete.limits));
  }
  console.log("PASS: native Craft template customization, sanitization, deletion fallback, compound BFF operations and partial receipts work end-to-end");

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
  const bootedStatus = await booted.operations.status();
  assert.equal(bootedStatus.value.backend.id, "primary");
  assert.equal((await booted.operations.connectionStatus()).value.tokens, "verified");
  await booted.close();
  const uninitialized = bootstrap({ env: { GPK_CONTROL_ROOT: path.join(temporary, "empty"), HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fake.connection });
  assert.equal((await uninitialized.operations.tasksGet({})).error.code, "unavailable", "knowledge operations need initialized Settings");
  assert.equal((await uninitialized.operations.status()).value.settings, "uninitialized");
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
  const status0 = await booted.operations.status();
  assert.equal(status0.value.onboarding, "required");
  const blocked = await booted.operations.tasksGet({});
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

  const form = { workspace: "dedicated", metadataLanguage: "zh-CN", timezone: null, names: { host: "GPK", areas: "领域", projects: "项目", sources: "来源", wikis: "知识", outputs: "产出" } };
  assert.equal((await api("/api/establish", { ...form, names: { ...form.names, areas: " " } })).json().error.code, "invalid", "blank names are refused");
  assert.equal((await api("/api/establish", { ...form, metadataLanguage: "fr" })).json().error.code, "invalid");
  // A same-named folder already in the space: refused before anything is created, then reused on request.
  const leftover = onboardingFake.seedFolder("来源", 3);
  const writesBefore = onboardingFake.calls.filter(([kind]) => kind === "write").length;
  const clashed = (await api("/api/establish", form)).json();
  assert.equal(clashed.error.code, "conflict", JSON.stringify(clashed));
  assert.equal(onboardingFake.calls.filter(([kind]) => kind === "write").length, writesBefore, "a clash creates nothing in Craft");
  assert.equal((await api("/api/establish", { ...form, adopt: { sources: "aaaaaaaa-0000-0000-0000-000000009999" } })).json().error.code, "invalid", "only the inspected same-named folder can be reused");
  assert.equal((await api("/api/establish", { ...form, adopt: { wikis: leftover.id } })).json().error.code, "invalid", "a folder is reused only for the name it carries");
  const established = (await api("/api/establish", { ...form, adopt: { sources: leftover.id } })).json();
  assert.equal(established.ok, true, JSON.stringify(established));
  assert.equal(established.value.locations.source.id, leftover.id, "the existing folder is used for Sources");
  const written = JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8"));
  assert.equal(written.preferences.metadataLanguage, "zh-CN");
  assert.deepEqual([...onboardingFake.folders.values()].map(f => [f.name, f.parentId]).sort(), [["产出", null], ["来源", null], ["知识", null]], "a dedicated workspace is built at the top level");
  assert.deepEqual(onboardingFake.collections.get(written.knowledgeBackend.configurations[0].layout.locations.project.id).views.map(v => v.name), ["看板", "按领域", "进行中"], "view names follow the metadata language");
  assert.ok([...onboardingFake.documents.values()].find(d => d.title === "GPK Project").body.map(b => b.markdown).join("\n").includes("Plan & Actions"), "template headings use English");
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
  assert.equal((await booted.operations.status()).value.onboarding, "complete");
  assert.equal((await api("/api/preferences", { timezone: "Europe/Berlin" })).json().ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).preferences.timezone, "Europe/Berlin");
  for (const route of ["/console", "/config", "/tools", "/sources"]) {
    assert.equal((await request(route)).status, 403);
    assert.equal((await request(route, { headers: { cookie } })).text, html.text);
  }
  const beforeEdit = (await api("/api/state")).json().value;
  const preferenceEdit = { instructions: "Use concise summaries.", expected: beforeEdit.settingsVersion };
  assert.equal((await api("/api/preferences", preferenceEdit)).json().ok, true);
  assert.equal((await api("/api/preferences", preferenceEdit)).json().error.code, "conflict");
  assert.equal((await api("/api/state")).json().value.preferences.instructions, preferenceEdit.instructions);
  const access = (await api("/api/access")).json().value;
  const extra = access.grants.find(g => g.value.root.id === projectRoot);
  const revoke = { ref: extra.ref, expected: extra.version };
  assert.equal((await api("/api/revoke", { ...revoke, expected: "stale" })).json().error.code, "conflict");
  assert.equal((await api("/api/revoke", revoke)).json().value.verified, true);
  assert.equal((await api("/api/access")).json().value.grants.some(g => g.ref.id === extra.ref.id), false);
  assert.equal((await api("/api/grants", { grants: selection })).json().value.written, 1);
  // Images & files stay available on the page after onboarding.
  assert.equal((await api("/api/uploads", { url: "" })).json().error.code, "invalid");
  assert.equal((await api("/api/files", { roots: "not a list" })).json().error.code, "invalid");
  const notes = fs.realpathSync(fs.mkdtempSync(path.join(temporary, "notes-")));
  assert.deepEqual((await api("/api/files", { roots: [notes] })).json().value, { roots: [notes], uploads: "none" });
  assert.deepEqual((await api("/api/state")).json().value.files, { roots: [notes], uploads: "none" }, "the page shows the approved folders");

  // Both entrypoints use the real operations/grants and Craft adapter against the
  // observed-command fake, including JSON checkpoints and narrow Source updates.
  const sessionsFolder = fs.realpathSync(fs.mkdtempSync(path.join(temporary, "sessions-")));
  const sessionFile = path.join(sessionsFolder, "conversation.jsonl");
  const sessionRows = [{ type: "user", sessionId: "integration-session", uuid: "turn-1", timestamp: new Date().toISOString(), message: { role: "user", content: "Explain a verified mechanism" } },
    { type: "assistant", sessionId: "integration-session", uuid: "reply-1", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "A useful explanation" }] } }];
  const sessionWrite = () => fs.writeFileSync(sessionFile, sessionRows.map(row => JSON.stringify(row)).join("\n") + "\n"); sessionWrite();
  assert.equal((await api("/api/ingestion", { enabled: true, origins: [] })).json().error.code, "invalid");
  const origins = [{ id: "sessions", reader: "claude-code", location: sessionsFolder, retention: "summary", depth: "wiki", exclusions: [], instructions: "Retain useful mechanisms" }];
  const configured = (await api("/api/ingestion", { enabled: true, origins })).json(); assert.equal(configured.ok, true, JSON.stringify(configured));
  assert.equal((await api("/api/state")).json().value.ingestion.enabled, true);
  const firstClaim = await booted.operations.sessionsNext({ mode: "automatic", days: 7 }); assert.equal(firstClaim.ok, true, JSON.stringify(firstClaim));
  assert.equal(firstClaim.value.done, false);
  const wiki = await booted.operations.wikisCreate({ title: "A maintained mechanism", content: "The supported explanation." }); assert.equal(wiki.ok, true, JSON.stringify(wiki));
  const firstApplied = await booted.operations.sessionsApply({
    token: firstClaim.value.token,
    outcome: "retain",
    reason: "Source verified",
    source: { title: "A conversation", content: "An owner's observation, with evidence." },
  });
  assert.equal(firstApplied.ok, true, JSON.stringify(firstApplied));
  assert.equal((await booted.operations.sessionsNext({ mode: "manual", days: 7 })).value.done, true);
  sessionRows.push({ type: "user", sessionId: "integration-session", uuid: "turn-2", timestamp: new Date().toISOString(), message: { role: "user", content: "An additional finding" } }); sessionWrite();
  const incremental = await booted.operations.sessionsNext({ mode: "manual", days: 7, key: "claude-code:integration-session" }); assert.equal(incremental.ok, true, JSON.stringify(incremental));
  const retainedAgain = await booted.operations.sessionsApply({
    token: incremental.value.token,
    outcome: "retain",
    reason: "Increment verified",
    source: { title: "A conversation", content: "A further qualification." },
  });
  assert.equal(retainedAgain.ok, true, JSON.stringify(retainedAgain));
  assert.deepEqual(retainedAgain.value.source, firstApplied.value.source, "the real Craft adapter updates the same Source");
  sessionRows.push({ type: "user", sessionId: "integration-session", uuid: "turn-3", timestamp: new Date().toISOString(), message: { role: "user", content: "BFF queue check" } }); sessionWrite();
  const nextClaim = await booted.operations.sessionsNext({ mode: "automatic", days: 7 }); assert.equal(nextClaim.ok, true, JSON.stringify(nextClaim));
  assert.equal(nextClaim.value.done, false);
  const applied = await booted.operations.sessionsApply({
    token: nextClaim.value.token,
    outcome: "retain",
    reason: "Retained via 2-step sessionsApply",
    source: { title: "A conversation", content: "Retained via sessionsApply." },
    wikis: [{ action: "update", name: "wiki/mechanism-update", ref: wiki.value.created, append: "Updated via sessionsApply." }],
  });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal((await booted.operations.sessionsNext({ mode: "automatic", days: 7 })).value.done, true);
  console.log("PASS: session Setup, automatic/manual overlap, Source identity, JSON progress and 2-step next/apply verification through the guarded Craft operations");

  // Another control root on the same space (a new machine, a reset): the page offers the
  // existing workspace and continuing with it creates nothing in Craft.
  {
    const otherRoot = path.join(temporary, "onboarding-second-machine");
    const urls = [];
    const second = bootstrap({ env: { GPK_CONTROL_ROOT: otherRoot, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => onboardingFake.connection, openBrowser: async url => { urls.push(url); return true; } });
    await second.onboarding.open();
    const launch = new URL(urls[0]);
    const call = (pathname, body) => new Promise((resolve, reject) => {
      const go = (headers, payload) => {
        const req = http.request({ host: "127.0.0.1", port: launch.port, path: pathname, method: payload === undefined ? "GET" : "POST", headers: { host: launch.host, ...headers } }, res => {
          let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(JSON.stringify(payload));
        req.end();
      };
      go(body?.headers ?? {}, body?.payload);
    });
    const first = await call(launch.pathname + launch.search);
    const session = first.headers["set-cookie"][0].split(";")[0];
    const browserHeaders = { cookie: session, origin: launch.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const seen = (await call("/api/state", { headers: { cookie: session, "sec-fetch-site": "same-origin" } })).json().value;
    assert.equal(seen.layout.existing.length, 1, "the workspace set up from the first root is offered");
    const home = seen.layout.existing[0];
    assert.deepEqual(home.folders?.source.id, written.knowledgeBackend.configurations[0].layout.locations.source.id);
    const createsBefore = onboardingFake.calls.filter(([kind, command]) => kind === "write" && /^(documents|collections|folders) create/.test(command)).length;
    assert.equal((await call("/api/establish", { headers: browserHeaders, payload: { ...form, resume: "not-a-workspace" } })).json().error.code, "invalid", "only a found workspace can be continued");
    const resumed = (await call("/api/establish", { headers: browserHeaders, payload: { ...form, resume: home.home.id } })).json();
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(onboardingFake.calls.filter(([kind, command]) => kind === "write" && /^(documents|collections|folders) create/.test(command)).length, createsBefore, "continuing creates nothing in Craft");
    const secondSettings = JSON.parse(fs.readFileSync(path.join(otherRoot, "settings.json"), "utf8"));
    assert.deepEqual(secondSettings.knowledgeBackend.configurations[0].layout.locations, written.knowledgeBackend.configurations[0].layout.locations, "the second root points at the same structures");
    assert.equal(secondSettings.preferences.metadataLanguage, "zh-CN", "the workspace's metadata language is kept");
    await second.close();
  }

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
    // The upload route's link and key are submitted through the page but never logged.
    await new Promise(resolve => {
      const req = http.request({ host: "127.0.0.1", port: launchUrl.port, path: "/api/uploads", method: "POST", headers: { host: launchUrl.host, cookie, origin: launchUrl.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } }, res => { res.resume(); res.on("end", resolve); });
      req.end(JSON.stringify({ url: "https://connect.craft.do/links/LOGLEAKLINK/api/v1", key: "pdk_LOGLEAKKEY" }));
    });
    await traced.close();
    const log = fs.readFileSync(logFile, "utf8");
    for (const event of ["[onboarding] server-start", "[onboarding] open opened=true", "[onboarding] launch-spent", "status=303", "[onboarding] server-stop"]) assert.ok(log.includes(event), `missing ${event} in\n${log}`);
    assert.ok(!log.includes(launchUrl.searchParams.get("t")), "the launch token never reaches the log");
    assert.ok(!log.includes(cookie.split("=")[1]), "the session cookie never reaches the log");
    assert.ok(log.includes("/api/uploads") && !log.includes("LOGLEAKKEY") && !log.includes("LOGLEAKLINK"), "the upload link and key never reach the log");
    assert.ok(log.split("\n").every(line => line.length < 1200), "values are truncated");
    assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
  } finally {
    configureDebugLog({}, logRoot);
  }
}
console.log("PASS: the debug log is opt-in, traces the onboarding flow and keeps tokens, cookies and long bodies out");

await reviewRegressions({ fakeCraft, createCraftAdapter, bootstrap, memorySecretStore, createCraftConnection, reviewInventory, temporary, repo, settings, SPACE });

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
  "gpk_status", "gpk_setup_open", "gpk_preferences_update",
  "gpk_captures_get", "gpk_daily_record",
  "gpk_areas_get", "gpk_areas_create", "gpk_areas_update",
  "gpk_projects_get", "gpk_projects_create", "gpk_projects_update",
  "gpk_tasks_get", "gpk_tasks_create", "gpk_tasks_update",
  "gpk_sources_get", "gpk_sources_create", "gpk_sources_update",
  "gpk_wikis_get", "gpk_wikis_create", "gpk_wikis_update",
  "gpk_outputs_get", "gpk_outputs_create", "gpk_outputs_update",
  "gpk_links", "gpk_review_inventory", "gpk_sessions_next", "gpk_sessions_apply", "gpk_checkpoints",
].sort();

/** The installed runtime writes its debug trace only when GPK_DEBUG is set. */
async function checkDebugLog(root, controlRoot) {
  const logFile = path.join(temporary, "stdio-debug.log");
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(root, "mcp/stdio.mjs")], cwd: root, stderr: "pipe",
    env: { GPK_CONTROL_ROOT: controlRoot, HOME: serviceHome, PATH: process.env.PATH, GPK_DEBUG: logFile },
  });
  const client = new Client({ name: "gpk-debug-check", version: "0" });
  await client.connect(transport, { timeout: 15000 });
  try {
    await client.callTool({ name: "gpk_status", arguments: {} });
    await client.callTool({ name: "gpk_tasks_get", arguments: { text: "dinner" } });
  } finally {
    await client.close();
  }
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /\[runtime\] start pid=\d+/);
  assert.match(log, /\[tool\] call name=gpk_status/);
  assert.match(log, /\[tool\] call name=gpk_tasks_get args=\{"text":"dinner"\}/, "arguments are traced");
  assert.match(log, /\[tool\] done name=gpk_tasks_get took=\d+ms ok=false code=unavailable/, "results are traced with their code");
}

async function checkStdio(target, root, config, negotiation, controlRoot) {
  assert.deepEqual(Object.keys(config.mcpServers), ["gpk"]);
  const entry = config.mcpServers.gpk;
  if (target !== "antigravity") assert.equal(entry.type, "stdio");
  assert.equal(entry.command, "node");
  const cwd = entry.cwd ? path.resolve(root, entry.cwd) : temporary;
  const args = entry.args.map(arg => arg.replace("${CLAUDE_PLUGIN_ROOT}", root).replace("${PLUGIN_ROOT}", root));
  assert.equal(path.resolve(cwd, args[0]), path.join(root, "mcp/stdio.mjs"));
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath, args, cwd, stderr: "pipe",
    env: { GPK_TEST_PRIVATE_SENTINEL: "do-not-echo-me", GPK_CONTROL_ROOT: controlRoot, HOME: serviceHome, PATH: process.env.PATH },
  });
  transport.stderr.on("data", chunk => { stderr += chunk; });
  const client = new Client({ name: "gpk-slice-test", version: "1.0.0" }, { versionNegotiation: { mode: negotiation } });
  try {
    await client.connect(transport, { timeout: 10000 });
    assert.equal(client.getServerVersion().version, version);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 28);
    assert.deepEqual(tools.map(tool => tool.name).sort(), EXPECTED_TOOLS);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} must expose a top-level object inputSchema`);
      const isReadOnly = /^(gpk_status|gpk_review_inventory|gpk_(captures|areas|projects|tasks|sources|wikis|outputs)_get)$/.test(tool.name);
      assert.equal(tool.annotations.readOnlyHint, isReadOnly, tool.name);
    }
    const call = (name, input = {}) => client.callTool({ name, arguments: input }, { timeout: 10000 });
    const status = domainResult(await call("gpk_status", { include: ["grants", "capabilities", "setup"] }));
    assert.equal(status.ok, true);
    assert.equal(status.value.settings, "uninitialized");
    assert.equal(status.value.controlRoot, controlRoot);
    assert.equal(status.value.grants.items.length, 0);
    assert.equal(status.value.onboarding, "required", "a fresh root must be onboarded first");
    assert.equal(status.value.setup.settings, "uninitialized");
    assert.equal(status.value.setup.grants, 0);
    assert.equal(status.value.setup.connection.tokens, "none");
    assert.equal(domainResult(await call("gpk_captures_get", { surface: { name: "inbox" }, limit: 1, cursor: "test" })).error.code, "unavailable", "paging arguments reach the normal onboarding gate");
    for (const name of ["gpk_tasks_get", "gpk_projects_get"]) {
      assert.equal(domainResult(await call(name)).error.code, "unavailable", `${name} needs initialized Settings`);
    }
    assert.equal(domainResult(await call("gpk_tasks_create", { title: "x" })).error.code, "unavailable");
    for (const [name, input] of [
      ["gpk_status", { unexpected: true }],
      ["gpk_projects_get", { states: ["todo"] }],
      ["gpk_tasks_get", { limit: 0 }],
      ["gpk_tasks_get", { time: { from: "2026-02-30" } }],
      ["gpk_tasks_get", { project: { scope: "s", id: "x", kind: "Wiki" } }],
      ["gpk_tasks_create", { title: "x", grant: { operations: ["tasks.create"] } }],
      ["gpk_tasks_create", { title: "x", items: [{ title: "y" }] }],
      ["gpk_tasks_update", { ref: { kind: "Task", scope: "s", id: "x" }, transition: { state: "deferred", reason: "r" } }],
      ["gpk_tasks_update", { ref: { kind: "Task", scope: "s", id: "x" }, time: "" }],
      ["gpk_preferences_update", {}],
      ["gpk_links", { action: "add" }],
      ["gpk_checkpoints", { action: "save", key: "k" }],
      ["gpk_captures_get", {}],
      ["gpk_tasks_remove", {}],
    ]) {
      let result;
      try { result = await call(name, input); }
      catch { result = { isError: true }; }
      assert.equal(result.isError, true, `${name} must reject invalid input/unknown tool`);
      assert.notEqual(result.structuredContent?.error?.code, "unavailable", "invalid input must not reach the handlers");
    }
    assert.equal(domainResult(await call("gpk_status")).ok, true, "validation failures must not kill the process");
  } finally {
    await client.close();
  }
  assert.equal(stderr, "", "valid calls must not produce diagnostics or private output");
}

async function checkShutdown(entry, signal, controlRoot) {
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"], env: { GPK_CONTROL_ROOT: controlRoot, HOME: serviceHome, PATH: process.env.PATH } });
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

{
  const emptyRoot = path.join(temporary, "empty-control");
  const cli = host => path.join(repo, "dist/marketplace", host, "gpk/mcp/cli.mjs");
  async function command(host, action, root = emptyRoot) {
    const { stdout } = await promisify(execFile)(process.execPath, [cli(host), action], {
      env: { ...process.env, HOME: serviceHome, GPK_CONTROL_ROOT: root },
    });
    return stdout.trim();
  }
  assert.equal(await command("codex", "status"), "GPK is stopped.");
  const paths = await Promise.all(["codex", "claude"].map(host => command(host, "connection")));
  assert.equal(paths[0], paths[1]);
  const config = JSON.parse(fs.readFileSync(paths[0], "utf8"));
  const other = JSON.parse(fs.readFileSync(await command("codex", "connection", path.join(temporary, "second-control")), "utf8"));
  assert.equal(config.url, other.url);
  assert.notEqual(config.headers.Authorization, other.headers.Authorization);
  assert.equal((await fetch(config.url)).status, 401);
  const direct = new Client({ name: "gpk-http-test", version: "1" });
  try {
    await direct.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }));
    const list = await direct.listTools();
    assert.equal(list.tools.length, 28);
    const status = await direct.callTool({ name: "gpk_status", arguments: {} });
    assert.equal(status.structuredContent.value.controlRoot, emptyRoot);
  } finally { await direct.close(); }
  const first = await command("codex", "start");
  const pid = output => Number(output.match(/PID (\d+)/)[1]);
  assert.equal(pid(first), pid(await command("claude", "status")));
  const restarted = await command("codex", "restart");
  assert.notEqual(pid(first), pid(restarted));
  assert.equal(await command("claude", "start"), restarted);
  assert.deepEqual(JSON.parse(fs.readFileSync(await command("codex", "connection"), "utf8")), config);
  assert.equal(await command("claude", "stop"), "GPK is stopped.");
  assert.equal(await command("codex", "status"), "GPK is stopped.");
  assert.equal(await command("codex", "stop"), "GPK is stopped.");
  const cold = await command("claude", "restart");
  const active = await Promise.all(["claude", "codex"].map(host => command(host, "start")));
  assert.deepEqual(active, [cold, cold]);
  assert.equal(await command("codex", "status"), await command("claude", "status"));
  console.log("PASS: simultaneous cold starts share one daemon, root credentials stay separate, and direct HTTP serves the registered tools");
  for (const target of ["claude", "codex", "antigravity"]) {
    const root = path.join(temporary, `${target} installed plugin with spaces`);
    fs.cpSync(path.join(repo, "dist/marketplace", target, "gpk"), root, { recursive: true });
    const before = fs.readdirSync(root).sort();
    const mcpFile = target === "antigravity" ? "mcp_config.json" : ".mcp.json";
    const config = JSON.parse(fs.readFileSync(path.join(root, mcpFile), "utf8"));
    await checkStdio(target, root, config, "legacy", emptyRoot);
    await checkStdio(target, root, config, { pin: "2026-07-28" }, emptyRoot);
    if (target === "claude") await checkDebugLog(root, emptyRoot);
    await checkShutdown(path.join(root, "mcp/stdio.mjs"), undefined, emptyRoot);
    await checkShutdown(path.join(root, "mcp/stdio.mjs"), "SIGTERM", emptyRoot);
    assert.deepEqual(fs.readdirSync(root).sort(), before);
    assert.equal(fs.existsSync(emptyRoot), false, "the runtime never creates a control root");
    const notices = fs.readFileSync(path.join(root, "mcp/THIRD-PARTY-NOTICES.txt"), "utf8");
    for (const name of ["@modelcontextprotocol/server@", "@modelcontextprotocol/client@", "zod@"]) assert.ok(notices.includes(name), name);
    assert.equal(notices.includes(repo), false);
  }
  console.log("PASS: isolated Claude/Codex/Antigravity stdio exposes the 28 BFF tools, both protocol eras, top-level object schemas and shutdown");
}
} finally {
  spawnSync(process.execPath, [path.join(repo, "dist/marketplace/codex/gpk/mcp/cli.mjs"), "stop"], { env: { ...process.env, HOME: serviceHome } });
  fs.rmSync(temporary, { recursive: true, force: true });
}
