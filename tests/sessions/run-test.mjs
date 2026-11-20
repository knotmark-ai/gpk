import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const built = buildSync({ stdin: { contents: 'export { createSessionIngestion } from "./src/runtime/session-ingestion.ts"; export { readSessions, fingerprint, AUTO_INGEST_PROMPT } from "./src/runtime/session-reader.ts";', resolveDir: repo, loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
const { createSessionIngestion, readSessions, fingerprint, AUTO_INGEST_PROMPT } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "gpk-sessions-"));
const groups = [];
const at = days => new Date(Date.now() - days * 86400000).toISOString();
const ok = value => ({ ok: true, value, limits: [] });
const bad = (code, message) => ({ ok: false, error: { code, message, affected: [], next: "Inspect before retrying." } });
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const claudeTurn = (session, id, days, user = "Question", assistant = "A verified finding") => [
  { type: "user", sessionId: session, uuid: id, timestamp: at(days), message: { role: "user", content: user } },
  { type: "assistant", sessionId: session, uuid: `${id}-a`, timestamp: at(days), message: { role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: assistant }] } },
];
const codexTurn = (id, days, user = "Question", assistant = "Another finding") => [
  { type: "response_item", timestamp: at(days), payload: { type: "message", id, role: "user", content: [{ type: "input_text", text: user }] } },
  { type: "response_item", timestamp: at(days), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: assistant }] } },
];
const antigravityTurn = (stepIndex, days, user = "Question", assistant = "Antigravity finding") => [
  { step_index: stepIndex, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: at(days), content: `<USER_REQUEST>\n${user}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nprivate clock metadata\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nprivate model setting\n</USER_SETTINGS_CHANGE>` },
  { step_index: stepIndex + 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(days), thinking: "private reasoning", content: assistant },
];
const write = (file, rows) => fs.writeFile(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");

async function fixture(name) {
  const root = path.join(temporary, name); const origin = path.join(root, "transcripts"); await fs.mkdir(origin, { recursive: true });
  const checkpoints = new Map(), documents = new Map(), wikis = new Map(), tasks = new Map(), links = [];
  let sequence = 0, creates = 0, updates = 0, saveCount = 0, wikiCount = 0, taskCount = 0;
  const settings = { schemaVersion: 1, ingestion: { automatic: { enabled: true, origins: [{ id: "claude", reader: "claude-code", location: origin, exclusions: [], retention: "summary", depth: "save", instructions: "Retain useful engineering findings" }] } }, knowledgeBackend: { activeId: "primary", configurations: [{ id: "primary", instance: "space" }] } };
  const snapshot = ref => {
    const store = ref.kind === "Wiki" ? wikis : ref.kind === "Task" ? tasks : documents;
    const item = store.get(ref.id);
    return item ? ok({ ref, value: { title: item.title, content: item.content }, version: item.version, coverage: "complete" }) : bad("not-found", "No document");
  };
  let createFailure = null, checkpointFailure = false, grants = true, failNextTask = false;
  const options = {
    controlRoot: path.join(root, "control"), settings: async () => ok(settings),
    today: async () => ok("2026-11-19"),
    recordSource: async () => ok({ verified: true, affected: [] }),
    checkpointRead: async key => ok(checkpoints.has(key) ? structuredClone(checkpoints.get(key)) : null),
    checkpointSave: async (key, content, expected) => {
      if (!grants) return bad("unauthorized", "Checkpoint grant revoked");
      if (checkpointFailure) { checkpointFailure = false; return bad("unavailable", "Checkpoint offline"); }
      const before = checkpoints.get(key); if (expected !== before?.version) return bad("conflict", "Stale checkpoint");
      const version = `v${++sequence}`; checkpoints.set(key, { ref: { scope: "space", id: key }, value: content, version, coverage: "complete" }); saveCount++;
      return ok({ verified: true, affected: [], version });
    },
    sourcesQuery: async query => ok({ items: [...documents].filter(([, doc]) => doc.content.includes(query.text)).map(([id]) => value(snapshot({ scope: "space", id, kind: "Source" }))), coverage: "complete" }),
    sourcesRead: async ref => snapshot(ref),
    sourcesCreate: async input => {
      if (!grants) return bad("unauthorized", "Source grant revoked");
      creates++; const ref = { scope: "space", id: `source-${creates}`, kind: "Source" }; const version = `v${++sequence}`;
      if (createFailure !== "absent") documents.set(ref.id, { ...input, content: createFailure === "partial" ? input.content.slice(0, input.content.lastIndexOf("\n\n")) : input.content, version });
      if (createFailure) { createFailure = null; return bad("uncertain", "Connection lost after submission"); }
      return ok({ created: ref, verified: true, affected: [ref], version });
    },
    sourcesUpdate: async (ref, edits, expected) => {
      if (!grants) return bad("unauthorized", "Source grant revoked");
      const doc = documents.get(ref.id); if (!doc || doc.version !== expected) return bad("conflict", "Source changed");
      for (const edit of edits) doc.content = doc.content.replace(edit.before, edit.after);
      updates++; doc.version = `v${++sequence}`; return ok({ verified: true, affected: [ref], version: doc.version });
    },
    wikisCreate: async input => {
      if (!grants) return bad("unauthorized", "Wiki grant revoked");
      wikiCount++; const ref = { scope: "space", id: `wiki-${wikiCount}`, kind: "Wiki" }; const version = `v${++sequence}`;
      wikis.set(ref.id, { ...input, version });
      return ok({ created: ref, verified: true, affected: [ref], version });
    },
    wikisUpdate: async (ref, update, expected) => {
      if (!grants) return bad("unauthorized", "Wiki grant revoked");
      const doc = wikis.get(ref.id); if (!doc || (expected && doc.version !== expected)) return bad("conflict", "Wiki changed");
      if (update.title) doc.title = update.title;
      for (const edit of update.edits ?? []) doc.content = doc.content.replace(edit.before, edit.after);
      if (update.append) doc.content = `${doc.content}\n\n${update.append}`;
      doc.version = `v${++sequence}`;
      return ok({ verified: true, affected: [ref], version: doc.version });
    },
    tasksCreate: async input => {
      if (failNextTask) { failNextTask = false; return bad("unavailable", "Task service temporarily unavailable"); }
      taskCount++; const ref = { scope: "space", id: `task-${taskCount}`, kind: "Task" }; const version = `v${++sequence}`;
      tasks.set(ref.id, { title: input.title, content: input.content, state: input.state, version });
      return ok({ created: ref, verified: true, affected: [ref], version });
    },
    linksAdd: async link => {
      const store = link.from.kind === "Wiki" ? wikis : link.from.kind === "Task" ? tasks : documents;
      const fromDoc = store.get(link.from.id);
      if (!fromDoc) return bad("not-found", "From record missing");
      links.push(link);
      fromDoc.version = `v${++sequence}`;
      return ok({ verified: true, affected: [link.from, link.to], version: fromDoc.version });
    },
    inspect: async ref => { const read = snapshot(ref); return read.ok ? ok({ version: read.value.version, coverage: "complete" }) : read; },
  };
  const clients = [createSessionIngestion(options), createSessionIngestion(options)];
  const group = { root, origin, settings, clients, checkpoints, documents, wikis, tasks, links, options, counts: () => ({ creates, updates, saveCount, wikiCount, taskCount, links: links.length }), failCreate: effect => { createFailure = effect; }, failCheckpoint: () => { checkpointFailure = true; }, failTaskOnce: () => { failNextTask = true; }, revokeGrants: () => { grants = false; } };
  groups.push(group);
  return group;
}
async function begin(client, key, extra = {}) { return value(await client.begin({ mode: "manual", ...extra }, key)); }
async function finish(client, token) { return value(await client.finish(token, "complete", "Useful input and all selected effects verified")); }

try {
  // Identity is native and independent of the selected window, path and reader policy ID.
  const f = await fixture("identity"); const file = path.join(f.origin, "a.jsonl");
  const old = claudeTurn("same-id", "old", 20), recent = claudeTurn("same-id", "recent", 1);
  await write(file, [...old, ...recent]);
  const [a, b] = f.clients;
  const first = value(await a.query({ mode: "automatic", days: 7 })); assert.equal(first.items.length, 1);
  const held = value(await a.begin(first.selection, first.items[0].key)); assert.ok(held.text.includes("recent")); assert.ok(!held.text.includes("old"));
  assert.equal((await b.begin({ mode: "manual" }, held.key)).error.code, "conflict", "manual/automatic overlap must not acquire the same session");
  const retained = value(await a.retain(held.token, "Engineering conversation", "A useful finding"));
  const recordedDays = [];
  let day = "2026-11-19";
  f.options.today = async () => ok(day);
  f.options.recordSource = async (source, date) => {
    recordedDays.push(date); assert.deepEqual(source, retained.source);
    return recordedDays.length === 1 ? bad("unauthorized", "Missing Daily Note grant") : ok({ verified: true, affected: [] });
  };
  assert.equal((await a.finish(held.token, "complete", "Done")).error.code, "unauthorized");
  value(await a.finish(held.token, "release", "Daily Note pending"));
  day = "2026-11-20";
  const resumedDaily = await begin(b, held.key, { days: 7 });
  await finish(b, resumedDaily.token);
  assert.deepEqual(recordedDays, ["2026-11-19", "2026-11-19"]);
  f.options.recordSource = async () => ok({ verified: true, affected: [] });
  const before = f.counts(); assert.equal(value(await b.query({ mode: "manual", days: 3 })).items.length, 0);
  assert.deepEqual(f.counts(), before, "unchanged discovery performs no writes");
  await fs.rename(file, path.join(f.origin, "renamed.jsonl"));
  f.settings.ingestion.automatic.origins[0].id = "renamed-policy";
  assert.equal(value(await a.query({ mode: "manual", days: 7 })).items.length, 0);
  const backfill = await begin(b, held.key, { days: 30 }); assert.ok(backfill.text.includes("old")); assert.ok(!backfill.text.includes("recent"));
  assert.deepEqual(value(await b.retain(backfill.token, "Engineering conversation", "An older observation")).source, retained.source);
  await finish(b, backfill.token); assert.equal(f.counts().creates, 1); assert.equal(f.counts().updates, 1);
  const appended = claudeTurn("same-id", "new", .1); await write(path.join(f.origin, "renamed.jsonl"), [...old, ...recent, ...appended]);
  const delta = await begin(a, held.key); assert.ok(delta.text.includes("new")); assert.ok(!delta.text.includes("recent"));
  value(await a.retain(delta.token, "Engineering conversation", "A new observation"));
  // Newly arriving input belongs to a later pass, even if it arrives before completion.
  const late = claudeTurn("same-id", "late", .01); await write(path.join(f.origin, "renamed.jsonl"), [...old, ...recent, ...appended, ...late]);
  await finish(a, delta.token); assert.equal(value(await a.query({ mode: "manual" })).items[0].changedTurns, 1);
  const lateRun = await begin(a, held.key); await finish(a, lateRun.token);
  recent[1].message.content[1].text = "A corrected finding";
  await write(path.join(f.origin, "renamed.jsonl"), [...old, ...recent, ...appended, ...late]);
  const edited = await begin(a, held.key); assert.ok(edited.text.includes("corrected")); await finish(a, edited.token);
  console.log("PASS: shared session identity, rolling history overlap, moved files, append/edit detection and fixed input boundaries");

  // Source creation may succeed while its response is lost. Retry must find it by marker.
  const r = await fixture("recovery"); await write(path.join(r.origin, "a.jsonl"), claudeTurn("recover", "t", 1));
  const run = await begin(r.clients[0], "claude-code:recover"); r.failCreate("present");
  assert.equal((await r.clients[0].retain(run.token, "Retained", "Prepared evidence")).error.code, "uncertain");
  value(await r.clients[0].finish(run.token, "release", "Inspect the uncertain write"));
  const resumed = await begin(r.clients[1], run.key); assert.equal(resumed.resuming, true);
  const recovered = value(await r.clients[1].retain(resumed.token, resumed.preparation.title, resumed.preparation.content));
  assert.equal(r.counts().creates, 1, "an uncertain create is never repeated");
  value(await r.clients[1].step(resumed.token, "wiki/explanation", "pending", recovered.source));
  assert.equal((await r.clients[1].finish(resumed.token, "complete", "Done")).error.code, "conflict");
  value(await r.clients[1].finish(resumed.token, "release", "Interrupted after a downstream intent"));
  const pending = await begin(r.clients[0], run.key);
  assert.equal((await r.clients[0].step(pending.token, "wiki/explanation", "pending")).error.code, "conflict");
  value(await r.clients[0].step(pending.token, "wiki/explanation", "verified", recovered.source, recovered.version));
  assert.equal(value(await r.clients[0].step(pending.token, "wiki/explanation", "pending")).skipped, true);
  await finish(r.clients[0], pending.token);
  assert.equal(value(await r.clients[1].query({ mode: "automatic" })).items.length, 0);
  const uncertain = await fixture("unknown-absence"); await write(path.join(uncertain.origin, "a.jsonl"), claudeTurn("absent", "t", 1));
  const unknown = await begin(uncertain.clients[0], "claude-code:absent"); uncertain.failCreate("absent");
  assert.equal((await uncertain.clients[0].retain(unknown.token, "Unknown", "Some evidence")).error.code, "uncertain");
  assert.equal((await uncertain.clients[0].retain(unknown.token, "Unknown", "Some evidence")).error.code, "uncertain");
  assert.equal(uncertain.counts().creates, 1); value(await uncertain.clients[0].finish(unknown.token, "release", "Manual inspection needed"));
  const partial = await fixture("partial-body"); await write(path.join(partial.origin, "a.jsonl"), claudeTurn("partial", "t", 1));
  const partialRun = await begin(partial.clients[0], "claude-code:partial"); partial.failCreate("partial");
  assert.equal((await partial.clients[0].retain(partialRun.token, "Partial", "Evidence that must actually be retained")).error.code, "uncertain");
  assert.equal((await partial.clients[0].retain(partialRun.token, "Partial", "Evidence that must actually be retained")).error.code, "uncertain", "a marker without its preparation is not a verified effect");
  assert.equal(partial.counts().creates, 1); value(await partial.clients[0].finish(partialRun.token, "release", "Inspect the incomplete body"));
  console.log("PASS: uncertain Source recovery, pending effect inspection and verified-effect deduplication without blind replay");

  const p = await fixture("policy"); await write(path.join(p.origin, "a.jsonl"), claudeTurn("policy", "t", 1, "x".repeat(50000)));
  const paged = await begin(p.clients[0], "claude-code:policy"); assert.ok(paged.next);
  assert.equal((await p.clients[0].retain(paged.token, "Partial", "Wrong")).error.code, "invalid");
  let next = paged.next; while (next !== undefined) next = value(await p.clients[0].read(paged.token, next)).next;
  p.settings.ingestion.automatic.enabled = false;
  assert.equal((await p.clients[1].query({ mode: "automatic" })).error.code, "unauthorized");
  assert.equal(value(await p.clients[1].query({ mode: "manual" })).items.length, 1);
  p.settings.ingestion.automatic.origins[0].exclusions = ["a.jsonl"];
  assert.equal((await p.clients[0].retain(paged.token, "Revoked", "Wrong")).error.code, "unauthorized");
  value(await p.clients[0].finish(paged.token, "release", "Scope revoked"));
  p.settings.ingestion.automatic.origins[0].exclusions = [];
  const denied = await begin(p.clients[0], "claude-code:policy");
  next = denied.next; while (next !== undefined) next = value(await p.clients[0].read(denied.token, next)).next;
  p.revokeGrants(); assert.equal((await p.clients[0].retain(denied.token, "Denied", "Wrong")).error.code, "unauthorized");
  assert.equal(p.counts().creates, 0); value(await p.clients[0].finish(denied.token, "release", "Grant revoked"));
  console.log("PASS: page coverage, live origin revocation, automatic disablement, manual selection and fresh grant checks");

  const offline = await fixture("offline"); await write(path.join(offline.origin, "a.jsonl"), claudeTurn("offline", "t", 1));
  const interrupted = await begin(offline.clients[0], "claude-code:offline"); offline.failCheckpoint();
  assert.equal((await offline.clients[0].retain(interrupted.token, "Later", "Useful evidence")).error.code, "unavailable");
  assert.equal(offline.counts().creates, 0, "an unverified intent stops before a knowledge write");
  value(await offline.clients[0].finish(interrupted.token, "release", "Offline"));
  const retry = await begin(offline.clients[1], "claude-code:offline"); value(await offline.clients[1].retain(retry.token, "Later", "Useful evidence")); await finish(offline.clients[1], retry.token);
  assert.equal(value(await offline.clients[0].query({ mode: "manual" })).items.length, 0);
  console.log("PASS: offline failure leaves input pending and a later client resumes without duplication");

  const gaps = await fixture("source-identity-gap"); await write(path.join(gaps.origin, "a.jsonl"), claudeTurn("gap", "u", 1));
  const querySources = gaps.options.sourcesQuery;
  gaps.options.sourcesQuery = async () => ok({ items: [], coverage: "partial", next: "later-page", gaps: [{ scope: "space", id: "unreadable-source" }] });
  const gapRun = await begin(gaps.clients[0], "claude-code:gap");
  assert.equal((await gaps.clients[0].retain(gapRun.token, "Retained", "Evidence")).error.code, "unavailable");
  assert.equal(gaps.counts().creates, 0, "an earlier identity-lookup gap must stop creation before a later complete page can hide it");
  gaps.options.sourcesQuery = querySources;
  value(await gaps.clients[0].retain(gapRun.token, "Retained", "Evidence")); await finish(gaps.clients[0], gapRun.token);

  const readers = await fixture("readers"); const codex = path.join(readers.root, "codex"); const agy = path.join(readers.root, "antigravity"); await fs.mkdir(codex); await fs.mkdir(agy);
  readers.settings.ingestion.automatic.origins.push(
    { id: "codex", reader: "codex", location: codex, exclusions: [], retention: "excerpts", instructions: "" },
    { id: "antigravity", reader: "antigravity", location: agy, exclusions: [], retention: "excerpts", instructions: "" },
  );
  await write(path.join(readers.origin, "a.jsonl"), [
    ...claudeTurn("claude", "real", 1),
    { type: "user", sessionId: "claude", uuid: "tool", timestamp: at(1), message: { role: "user", content: [{ type: "tool_result", content: "private tool result" }] } },
    ...claudeTurn("claude", "generated", .1, `${AUTO_INGEST_PROMPT} Run Ingest`, "Generated receipts"),
  ]);
  await write(path.join(codex, "a.jsonl"), [
    { type: "session_meta", payload: { id: "codex-id", cwd: "/synthetic/project" } },
    ...codexTurn("c", 1),
    { type: "event_msg", timestamp: at(1), payload: { type: "user_message", message: "duplicate event representation" } },
    ...codexTurn("ingest", .1, "Retain useful knowledge", "Before retention"),
    { type: "response_item", payload: { type: "function_call", name: "mcp__gpk__gpk_sessions_query", arguments: JSON.stringify({ mode: "automatic", origin: "private arguments" }) } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Generated GPK receipt" }] } },
  ]);
  const agyConv = path.join(agy, "41160eda-3a3f-4f91-b77d-96bcc69de0ee/.system_generated");
  const agySubagent = path.join(agy, "53b7ccc8-37bf-4d3d-9b4c-a316cb90f4b8/.system_generated/logs");
  await fs.mkdir(path.join(agyConv, "logs/chunks"), { recursive: true });
  await fs.mkdir(path.join(agyConv, "steps"), { recursive: true });
  await fs.mkdir(agySubagent, { recursive: true });
  await fs.writeFile(path.join(agyConv, "steps/step-0.jsonl"), "ignored internal step\n");
  await fs.writeFile(path.join(agyConv, "logs/chunks/chunk.jsonl"), "ignored chunk\n");
  await write(path.join(agySubagent, "transcript.jsonl"), [
    { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", created_at: at(1), content: "Subagent brief" },
    { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(1), content: "Subagent report" },
  ]);
  const agyFullRows = [
    ...antigravityTurn(0, 1, "Question", "Full untruncated Antigravity answer"),
    { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", created_at: at(1), content: "private tool result" },
    { step_index: 3, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", created_at: at(0.1), content: `<SYSTEM_MESSAGE>${AUTO_INGEST_PROMPT} Run gpk-ingest</SYSTEM_MESSAGE>` },
    { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(0.1), content: "Generated GPK receipt" },
  ];
  const agyCompactRows = structuredClone(agyFullRows);
  agyCompactRows[1].content = "Truncated...";
  agyCompactRows[1].truncated_fields = ["content"];
  await write(path.join(agyConv, "logs/transcript.jsonl"), agyCompactRows);
  await write(path.join(agyConv, "logs/transcript_full.jsonl"), agyFullRows);
  await fs.symlink(path.join(codex, "a.jsonl"), path.join(readers.origin, "outside.jsonl"));
  const parsed = value(await readSessions(readers.settings.ingestion.automatic.origins)); assert.equal(parsed.length, 3);
  const text = parsed.flatMap(session => session.turns.map(turn => turn.text)).join("\n");
  assert.ok(text.includes("Full untruncated Antigravity answer"), "truncated step hydrated from transcript_full.jsonl");
  for (const excluded of ["private reasoning", "private tool result", "private clock metadata", "private model setting", "Subagent report", "Generated receipts", "Generated GPK receipt", "private arguments", "duplicate event representation"]) assert.ok(!text.includes(excluded), excluded);
  await fs.copyFile(path.join(codex, "a.jsonl"), path.join(codex, "copy.jsonl")); assert.equal(value(await readSessions(readers.settings.ingestion.automatic.origins)).length, 3);
  const other = JSON.parse((await fs.readFile(path.join(codex, "a.jsonl"), "utf8")).split("\n")[1]); other.payload.content[0].text = "A conflicting export";
  await fs.appendFile(path.join(codex, "copy.jsonl"), JSON.stringify(other) + "\n");
  assert.equal((await readSessions(readers.settings.ingestion.automatic.origins)).ok, false);
  console.log("PASS: all three explicit JSONL readers, generated/tool/thinking/subagent exclusions, transcript_full hydration, symlinks and conflicting exports");

  // Manual retention tools are ordinary work: later findings in the same user
  // turn must survive. Automatic mode establishes its own explicit boundary.
  const mixed = await fixture("mixed-work"); const mixedCodex = path.join(mixed.root, "codex"); const mixedAgy = path.join(mixed.root, "antigravity"); await fs.mkdir(mixedCodex); await fs.mkdir(mixedAgy);
  mixed.settings.ingestion.automatic.origins.push(
    { id: "codex", reader: "codex", location: mixedCodex, exclusions: [], retention: "full", instructions: "" },
    { id: "antigravity", reader: "antigravity", location: mixedAgy, exclusions: [], retention: "full", instructions: "" },
  );
  await write(path.join(mixed.origin, "a.jsonl"), [
    ...claudeTurn("mixed-claude", "u", 1, "Check retention progress, then fix the bug", "Initial diagnosis"),
    { type: "assistant", sessionId: "mixed-claude", message: { role: "assistant", content: [{ type: "text", text: "Text beside a manual tool" }, { type: "tool_use", name: "mcp__gpk__gpk_sessions_query", input: { mode: "manual" } }] } },
    { type: "assistant", sessionId: "mixed-claude", message: { role: "assistant", content: [{ type: "text", text: "Real repair and verification" }] } },
    { type: "assistant", sessionId: "mixed-claude", message: { role: "assistant", content: [{ type: "tool_use", name: "mcp__gpk__gpk_sessions_query", input: { mode: "automatic" } }] } },
    { type: "assistant", sessionId: "mixed-claude", message: { role: "assistant", content: [{ type: "text", text: "Automatic receipt" }] } },
  ]);
  await write(path.join(mixedCodex, "a.jsonl"), [
    { type: "session_meta", payload: { id: "mixed-codex" } }, ...codexTurn("u", 1, "Check retention progress, then fix the bug", "Initial diagnosis"),
    { type: "response_item", payload: { type: "function_call", name: "mcp__gpk__gpk_sessions_query", arguments: JSON.stringify({ mode: "manual" }) } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Real repair and verification" }] } },
    { type: "response_item", payload: { type: "function_call", name: "mcp__gpk__gpk_sessions_next", arguments: JSON.stringify({ mode: "automatic" }) } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Automatic receipt" }] } },
  ]);
  const mixedAgyLogs = path.join(mixedAgy, "9edccf77-6810-4594-96f5-8d7ca56312eb/.system_generated/logs");
  await fs.mkdir(mixedAgyLogs, { recursive: true });
  await write(path.join(mixedAgyLogs, "transcript.jsonl"), [
    ...antigravityTurn(0, 1, "Check retention progress, then fix the bug", "Initial diagnosis"),
    { step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(1), content: "Text beside a manual tool", tool_calls: [{ name: "mcp_gpk_gpk_sessions_next", args: { mode: '"manual"' } }] },
    { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(1), content: "Real repair and verification", tool_calls: [{ name: "mcp_gpk_gpk_sessions_next", args: { mode: '"automatic"' } }] },
    { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: at(1), content: "Automatic receipt" },
  ]);
  const mixedText = value(await readSessions(mixed.settings.ingestion.automatic.origins)).map(input => input.turns.map(turn => turn.text).join("\n"));
  assert.equal(mixedText.length, 3);
  for (const text of mixedText) { assert.ok(text.includes("Real repair and verification")); assert.ok(!text.includes("Automatic receipt")); }
  assert.ok(mixedText.some(text => text.includes("Text beside a manual tool")));
  const stable = value(await mixed.clients[0].query({ mode: "manual" }));
  const mixedRun = value(await mixed.clients[0].begin(stable.selection, "claude-code:mixed-claude"));
  await finish(mixed.clients[0], mixedRun.token);
  const unchanged = await fs.readFile(path.join(mixed.origin, "a.jsonl"), "utf8");
  await fs.writeFile(path.join(mixed.origin, "a.jsonl"), unchanged.replace("Automatic receipt", "Another automatic receipt"));
  assert.ok(!value(await mixed.clients[0].query({ mode: "manual" })).items.some(item => item.key === "claude-code:mixed-claude"), "automatic receipts cannot continually change processed input");
  console.log("PASS: manual session tools preserve later real work; explicit automatic boundaries exclude their receipts and do not retrigger input");

  // Process ownership is transient; an actual dead PID is reclaimable after restart.
  const dead = await fixture("dead-owner"); await write(path.join(dead.origin, "a.jsonl"), claudeTurn("dead", "t", 1));
  const locks = path.join(dead.options.controlRoot, "locks"); await fs.mkdir(locks, { recursive: true });
  await fs.writeFile(path.join(locks, `session-${fingerprint("primary:space:claude-code:dead")}.lock`), JSON.stringify({ pid: 99999999, token: "dead" }));
  const reclaimed = await begin(dead.clients[0], "claude-code:dead"); await dead.clients[0].close();
  const owner = await begin(dead.clients[1], reclaimed.key); assert.equal(owner.skipped, false);
  await fs.rm(locks, { recursive: true });
  const replacement = await begin(dead.clients[0], reclaimed.key);
  assert.equal((await dead.clients[1].retain(owner.token, "Stale", "Do not write")).error.code, "conflict");
  value(await dead.clients[1].finish(owner.token, "release", "Ownership changed"));
  await finish(dead.clients[0], replacement.token);
  console.log("PASS: restart/dead-owner recovery releases coordination without a local knowledge mirror");

  // Coarse-grained BFF workflow: next + apply (paging, retain + downstream wiki/task/link, partial failure recovery, skip & release).
  const bff = await fixture("bff-next-apply");
  await write(path.join(bff.origin, "one.jsonl"), claudeTurn("s1", "u1", 1, "z".repeat(30_000), "Key architectural decision"));
  await write(path.join(bff.origin, "two.jsonl"), claudeTurn("s2", "u2", 1, "Minor typo fix", "Done"));
  const page1 = value(await bff.clients[0].next({ mode: "automatic" }));
  assert.equal(page1.done, false);
  assert.ok(page1.next !== undefined, "large session pages via next");
  assert.equal((await bff.clients[0].next({ mode: "automatic", token: page1.token })).error.code, "invalid");
  let pageCursor = page1.next;
  while (pageCursor !== undefined) {
    const pagedNext = value(await bff.clients[0].next({ mode: "automatic", token: page1.token, cursor: pageCursor }));
    assert.equal(pagedNext.done, false);
    pageCursor = pagedNext.next;
  }
  bff.failTaskOnce();
  const partialApply = await bff.clients[0].apply({
    token: page1.token,
    outcome: "retain",
    reason: "Retain architecture decision and follow-up",
    source: { title: "Architecture Session", content: "Decided on 28-tool BFF surface." },
    wikis: [{ action: "create", name: "wiki/bff", title: "BFF Design", content: "Coarse-grained MCP tools." }],
    tasks: [{ name: "task/verify", title: "Verify BFF conformance", state: "todo" }],
    links: [{ name: "link/wiki", from: "source", to: { scope: "space", id: "wiki-1", kind: "Wiki" }, context: "Distilled into Wiki" }],
  });
  assert.equal(partialApply.ok, false);
  assert.equal(partialApply.error.code, "partial");
  assert.deepEqual(partialApply.error.completedSteps, ["source.retain", "wiki:wiki/bff"]);
  assert.equal(partialApply.error.failedStep, "task:task/verify");
  value(await bff.clients[0].apply({ token: page1.token, outcome: "release", reason: "Retry task after service recovers" }));

  const resumedPage = value(await bff.clients[1].next({ mode: "automatic", key: page1.key }));
  assert.equal(resumedPage.done, false);
  let resumeCursor = resumedPage.next;
  while (resumeCursor !== undefined) resumeCursor = value(await bff.clients[1].next({ mode: "automatic", token: resumedPage.token, cursor: resumeCursor })).next;
  // Reconcile the pending task step or create it after reconciling/re-verifying:
  // since task/verify was recorded as pending before tasksCreate failed, reconcile an inspected task or verify conflict without reconcile:
  assert.equal((await bff.clients[1].apply({
    token: resumedPage.token,
    outcome: "retain",
    reason: "Retry without reconciling pending task",
    wikis: [{ action: "create", name: "wiki/bff", title: "BFF Design", content: "Coarse-grained MCP tools." }],
    tasks: [{ name: "task/verify", title: "Verify BFF conformance", state: "todo" }],
  })).error.code, "partial");
  // Simulate operator/agent creating or inspecting task-manual and reconciling the pending effect:
  const manualTask = value(await bff.options.tasksCreate({ title: "Verify BFF conformance", content: "", state: "todo" }));
  const completedApply = value(await bff.clients[1].apply({
    token: resumedPage.token,
    outcome: "retain",
    reason: "Completed after reconciling pending task",
    reconcile: [{ name: "task/verify", ref: manualTask.created, expected: manualTask.version }],
    wikis: [{ action: "create", name: "wiki/bff", title: "BFF Design", content: "Coarse-grained MCP tools." }],
    tasks: [{ name: "task/verify", title: "Verify BFF conformance", state: "todo" }],
    links: [{ name: "link/wiki", from: "source", to: { scope: "space", id: "wiki-1", kind: "Wiki" }, context: "Distilled into Wiki" }],
  }));
  assert.equal(completedApply.completed, true);
  assert.equal(bff.counts().creates, 1, "Source was retained once across partial retry");
  assert.equal(bff.counts().wikiCount, 1, "Already-verified wiki step was not duplicated");
  assert.equal(bff.counts().links, 1);

  const secondSession = value(await bff.clients[1].next({ mode: "automatic" }));
  assert.equal(secondSession.done, false);
  assert.equal(secondSession.key, "claude-code:s2");
  assert.equal((await bff.clients[1].apply({ token: secondSession.token, outcome: "skip", reason: "Trivial", source: { title: "No", content: "No" } })).error.code, "invalid");
  const skippedSession = value(await bff.clients[1].apply({ token: secondSession.token, outcome: "skip", reason: "Trivial typo fix" }));
  assert.equal(skippedSession.completed, true);
  const queueDone = value(await bff.clients[0].next({ mode: "automatic" }));
  assert.equal(queueDone.done, true);
  assert.equal(queueDone.skipped, 2);
  console.log("PASS: 2-tool next + apply session queue paging, downstream wiki/task/link orchestration, partial recovery and skip");
} finally {
  for (const group of groups) for (const client of group.clients) await client.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
