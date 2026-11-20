import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

/** Regression scenarios from the full-tree review; all provider traffic is local. */
export async function reviewRegressions(api) {
  const { fakeCraft, createCraftAdapter, bootstrap, memorySecretStore, createCraftConnection, temporary, repo, settings, SPACE } = api;
  const plan = { hostDocument: { title: "Review" }, areas: { name: "Areas" }, projects: { name: "Projects" }, sources: { name: "Sources" }, wikis: { name: "Wikis" }, outputs: { name: "Outputs" }, views: false, templates: false };
  async function fixture() {
    const fake = fakeCraft();
    let locations = null;
    const knowledge = createCraftAdapter({ connection: fake.connection, backendId: "primary", layout: async () => ({ ok: true, value: locations, limits: [] }) });
    const setup = await knowledge.workspace.establish(plan); assert.equal(setup.ok, true, JSON.stringify(setup));
    locations = setup.value.locations;
    const guard = (root, operations) => ({ grants: [{ backendId: "primary", root, operations, unattended: false }] });
    const area = await knowledge.areas.create({ title: "Area", content: "", state: "active" }, guard(locations.area, ["areas.create"]));
    const project = await knowledge.projects.create({ title: "Project", content: "", state: "active", primaryArea: area.value.created }, guard(locations.project, ["projects.create"]));
    return { fake, knowledge, locations, guard, area: area.value.created, project: project.value.created };
  }

  {
    const root = path.join(temporary, "reset-preserves-originals"); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "original.txt"), "keep");
    const result = spawnSync(process.execPath, ["scripts/dev.mjs", "reset", "--craft", "--yes", "--root", root], { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 1); assert.match(result.stderr, /Nothing was changed/);
    assert.equal(fs.readFileSync(path.join(root, "original.txt"), "utf8"), "keep");
    console.log("PASS: reset refuses unproven Craft cleanup before touching credentials or local files");
  }

  const f = await fixture();
  const { fake, knowledge, locations, guard, area, project } = f;
  {
    const table = "| 产品 | 用户目标 |\n|---|---|\n| 语音输入 | 快速输入文字 |\n| 会议转写 | 整理会议纪要 |";
    const input = { title: "Import recovery", content: table };
    const create = guard(locations.source, ["sources.create"]);
    const update = guard(locations.source, ["sources.update"]);
    const initialCount = fake.documents.size;
    const write = fake.connection.write;
    fake.connection.write = async command => command.includes("--markdown") ?
      { ok: false, error: { code: "unavailable", message: "502", affected: [], next: "Read back" } } : write(command);
    let partial;
    try { partial = await knowledge.sources.create(input, create); }
    finally { fake.connection.write = write; }
    assert.equal(partial.error.code, "partial");
    const [ref] = partial.error.affected;
    const read = () => knowledge.sources.read(ref);
    const recover = expected => knowledge.sources.update(ref, { replaceContent: table }, { ...update, expected });
    const empty = await read();
    assert.equal(empty.value.value.content, "");
    assert.equal((await recover(empty.value.version)).value.verified, true);
    const complete = await read();
    assert.equal(complete.value.value.content, table);
    const doc = fake.documents.get(ref.id);
    assert.equal(doc.body[0].type, "table");
    assert.ok(fake.calls.some(([kind, cmd]) => kind === "write" && cmd.includes(table)), "Craft receives physical row boundaries");
    const writes = () => fake.calls.filter(([kind]) => kind === "write").length;
    const before = writes();
    assert.equal((await recover(complete.value.version)).value.verified, true, "replaying a committed body verifies without an append");
    assert.equal((await recover(empty.value.version)).error.code, "conflict");
    doc.body[0].markdown = table.replaceAll("\n", "\\n");
    doc.body[0].type = "text";
    const broken = await read();
    assert.equal((await recover(broken.value.version)).error.code, "conflict");
    assert.equal(writes(), before);
    const repair = await knowledge.sources.update(ref, { edits: [{ before: broken.value.value.content, after: table }] }, { ...update, expected: broken.value.version });
    assert.equal(repair.value.verified, true);
    assert.equal(doc.body[0].type, "table");
    assert.equal((await read()).value.value.content, table);
    assert.equal(fake.documents.size, initialCount + 1);
    doc.body[0].type = "text";
    assert.equal((await recover((await read()).value.version)).error.code, "conflict", "plain text cannot attest to a native table");
    console.log("PASS: partial Source recovery preserves identity, guards revisions, verifies native table rows and repairs flattened blocks");
  }
  {
    const create = guard(locations.source, ["sources.create"]);
    const update = guard(locations.source, ["sources.update"]);
    const ref = (await knowledge.sources.create({ title: "Empty paragraphs", content: "" }, create)).value.created;
    const doc = fake.documents.get(ref.id);
    const blank = { id: "55555555-0000-0000-0000-000000000001", type: "text", textStyle: "body", markdown: "" };
    const second = { ...blank, id: "55555555-0000-0000-0000-000000000002", markdown: "  " };
    doc.body.push(blank, second);
    const body = "Origin and retained material";
    const read = () => knowledge.sources.read(ref);
    const recover = expected => knowledge.sources.update(ref, { replaceContent: body }, { ...update, expected });
    const original = await read();
    assert.equal(original.value.value.content.trim(), "");
    assert.equal((await recover(original.value.version)).value.verified, true);
    const written = await read();
    assert.equal(written.value.value.content.trim(), body);
    assert.deepEqual(doc.body.slice(0, 2), [blank, second]);
    const writes = () => fake.calls.filter(([kind]) => kind === "write").length;
    const before = writes();
    assert.equal((await recover(written.value.version)).value.verified, true);
    assert.equal((await recover(original.value.version)).error.code, "conflict");
    for (const block of [{ type: "image" }, { type: "file" }, { type: "collection" }, { textStyle: "h2" }, { listStyle: "task" }, { markdown: "User note" }]) {
      doc.body = [blank, { ...second, ...block }];
      assert.equal((await recover((await read()).value.version)).error.code, "conflict", JSON.stringify(block));
    }
    assert.equal(writes(), before);
    console.log("PASS: Source recovery with existing blank paragraphs appends once, keeps their IDs and refuses structured or edited content");
  }
  {
    const input = "Reason\n\n- [ ] Undeclared task";
    const task = await knowledge.tasks.create({ title: "Guarded action", content: "", state: "todo", project }, guard(locations.project, ["tasks.create"]));
    const ref = task.value.created;
    const before = fake.calls.filter(([kind]) => kind === "write").length;
    const calls = [
      () => knowledge.tasks.transition(ref, "waiting", input, guard(locations.project, ["tasks.transition"])),
      () => knowledge.tasks.assignProject(ref, null, input, { grants: [{ backendId: "primary", root: locations.project, operations: ["tasks.assignProject"], unattended: false }, { backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.assignProject"], unattended: false }] }),
      () => knowledge.areas.transition(area, "inactive", input, guard(locations.area, ["areas.transition"])),
      () => knowledge.projects.transition(project, "paused", input, guard(locations.project, ["projects.transition"])),
      () => knowledge.projects.assignArea(project, area, input, guard(locations.project, ["projects.assignArea"])),
      () => knowledge.links.add({ from: project, to: area, context: input }, guard(locations.project, ["links.add"])),
      () => knowledge.projects.create({ title: "History", content: "", state: "completed", primaryArea: area, history: { origin: input } }, guard(locations.project, ["projects.create"])),
      () => knowledge.tasks.create({ title: "History", content: "", state: "done", project, history: { origin: input } }, guard(locations.project, ["tasks.create"])),
    ];
    for (const call of calls) { const result = await call(); assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, "invalid"); }
    assert.equal(fake.calls.filter(([kind]) => kind === "write").length, before, "prose validation precedes every state, ownership, link and creation effect");
    console.log("PASS: transition, reassignment, link and history prose cannot create native Tasks under another operation's grant");
  }
  {
    const checkpointGuard = guard({ scope: SPACE.id, id: "system" }, ["checkpoints.save"]);
    const key = "ingest/recovery";
    const old = JSON.stringify({ source: "stable-source", turns: { old: "done" }, effects: { wiki: "verified" } });
    const first = await knowledge.checkpoints.save(key, old, checkpointGuard); assert.equal(first.value.verified, true);
    const hostId = fake.collections.get(locations.project.id).documentId;
    const page = fake.documents.get(hostId).body.find(child => child.markdown === "GPK System").children.find(child => child.markdown === key);
    // Exercise upgrade from the former plain-body encoding as well.
    page.children[0].markdown = old;
    const legacy = await knowledge.checkpoints.read(key); assert.equal(legacy.value.value, old);
    const write = fake.connection.write;
    const fail = { ok: false, error: { code: "unavailable", message: "Interrupted checkpoint write", affected: [], next: "Read it back" } };
    let mode = "absent";
    fake.connection.write = async command => {
      if (command.startsWith(`blocks add --id ${page.id} --markdown`)) {
        if (mode === "absent") return fail;
        if (mode === "partial") { await write(`blocks add --id ${page.id} --markdown "GPK checkpoint v1:truncated"`); return fail; }
        if (mode === "committed") { await write(command); return fail; }
      }
      if (mode === "cleanup" && command.startsWith("blocks delete --ids")) return fail;
      return write(command);
    };
    try {
      for (const failure of ["absent", "partial"]) {
        mode = failure;
        const before = await knowledge.checkpoints.read(key);
        assert.equal((await knowledge.checkpoints.save(key, "new", { ...checkpointGuard, expected: before.value.version })).ok, false);
        const restarted = createCraftAdapter({ connection: fake.connection, backendId: "primary", layout: async () => ({ ok: true, value: locations, limits: [] }) });
        assert.equal((await restarted.checkpoints.read(key)).value.value, old, "a fresh process still sees the intact legacy progress after an interrupted append");
      }
      mode = "committed";
      assert.equal((await knowledge.checkpoints.save(key, "new", checkpointGuard)).ok, false);
      assert.equal((await knowledge.checkpoints.read(key)).value.value, "new", "a lost response does not lose a fully committed revision");
      mode = "ok";
      const roundtrip = "Paragraph one\n\n- [ ] This is checkpoint data\n\nOwner's Unicode: 中文";
      assert.equal((await knowledge.checkpoints.save(key, roundtrip, checkpointGuard)).value.verified, true);
      assert.equal((await knowledge.checkpoints.read(key)).value.value, roundtrip);
      mode = "cleanup";
      assert.equal((await knowledge.checkpoints.save(key, "latest", checkpointGuard)).value.verified, true, "failed pruning cannot destroy a verified successor");
      assert.equal((await knowledge.checkpoints.read(key)).value.value, "latest");
      mode = "ok";
      const before = await knowledge.checkpoints.read(key);
      assert.equal((await knowledge.checkpoints.save(key, "", { ...checkpointGuard, expected: before.value.version })).value.verified, true);
      assert.equal((await knowledge.checkpoints.read(key)).value.value, "");
      assert.equal(page.children.filter(child => child.markdown.startsWith("GPK checkpoint v1:") && !child.markdown.endsWith("truncated")).length, 2, "normal pruning keeps the current revision and an intact backup");
      assert.ok(page.children.some(child => child.markdown === old), "legacy and unknown native content are preserved");
      assert.equal((await knowledge.checkpoints.save(key, "stale", { ...checkpointGuard, expected: legacy.value.version })).error.code, "conflict");
    } finally { fake.connection.write = write; }
    console.log("PASS: checkpoint append failures, truncated revisions, lost replies, restart recovery, legacy bodies, empty values and failed pruning preserve durable progress");
  }
  {
    const owned = await fixture();
    await owned.knowledge.tasks.create({ title: "Must remain visible", content: "", state: "todo", project: owned.project }, owned.guard(owned.locations.project, ["tasks.create"]));
    const read = owned.fake.connection.read;
    owned.fake.connection.read = async command => command === `blocks get --id ${owned.project.id} --depth 1 --format json --fetchMetadata`
      ? { ok: true, value: JSON.stringify({ data: [] }), limits: [] } : read(command);
    try { assert.equal((await owned.knowledge.tasks.query({})).error.code, "unavailable", "missing Project reads cannot establish that their Tasks are outside GPK"); }
    finally { owned.fake.connection.read = read; }
  }
  {
    const captures = await fixture();
    const firstId = captures.fake.seed("First capture", "todo", { kind: "inbox" }).id;
    const secondId = captures.fake.seed("Second capture", "todo", { kind: "inbox" }).id;
    const read = captures.fake.connection.read;
    const listing = (id, title, next = "") => ({ ok: true, value: `Tasks (inbox): 1 result(s)\n\n[ ] <${id}> - [ ] ${title}\n  in: inbox\n${next}`, limits: [] });
    captures.fake.connection.read = async command => command === "tasks list --scope inbox" ? listing(firstId, "First capture", "Next page: tasks list --scope inbox --cursor second")
      : command === "tasks list --scope inbox --cursor second" ? listing(secondId, "Second capture") : read(command);
    try {
      const surface = { scope: SPACE.id, id: "inbox", role: "capture-surface" };
      const result = await captures.knowledge.captures.list(surface);
      assert.deepEqual(result.value.items.map(item => item.ref.id), [firstId, secondId]); assert.equal(result.value.coverage, "complete");
      const first = await captures.knowledge.captures.list(surface, { limit: 1 });
      assert.deepEqual(first.value.items.map(item => item.ref.id), [firstId]);
      assert.equal(first.value.coverage, "partial");
      assert.ok(first.value.next);
      const last = await captures.knowledge.captures.list(surface, { cursor: first.value.next, limit: 1 });
      assert.deepEqual(last.value.items.map(item => item.ref.id), [secondId]);
      assert.equal(last.value.coverage, "complete");
      assert.equal(last.value.next, undefined);
      const daily = { ...surface, id: "daily-notes/2026-11-04" };
      assert.equal((await captures.knowledge.captures.list(daily, { cursor: first.value.next })).error.code, "invalid");
      const children = [firstId, secondId].map((id, index) => ({ id, type: "text", markdown: `Note ${index}` }));
      captures.fake.connection.read = async command => command === "blocks get --date 2026-11-04 --depth 1 --format json"
        ? { ok: true, value: JSON.stringify({ data: [{ id: "daily", type: "page", content: children }] }), limits: [] } : read(command);
      const notePage = await captures.knowledge.captures.list(daily, { limit: 1 });
      assert.deepEqual(notePage.value.items.map(item => item.value.content), ["Note 0"]);
      const noteEnd = await captures.knowledge.captures.list(daily, { cursor: notePage.value.next });
      assert.deepEqual(noteEnd.value.items.map(item => item.value.content), ["Note 1"]);
      assert.equal(noteEnd.value.coverage, "complete");
      captures.fake.connection.read = async command => command.startsWith("tasks list --scope inbox") ? listing(firstId, "First capture", "Next page: tasks list --scope inbox --cursor keeps-going") : read(command);
      assert.equal((await captures.knowledge.captures.list({ scope: SPACE.id, id: "inbox", role: "capture-surface" })).value.coverage, "partial", "an exhausted traversal budget is disclosed");
    } finally { captures.fake.connection.read = read; }
  }
  {
    const paged = await fixture();
    const rows = paged.fake.collections.get(paged.locations.area.id).rows;
    for (let i = 1; i < 101; i++) rows.push({ id: `cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`, title: `Area ${i}`, properties: { status: "active" }, children: [] });
    const read = paged.fake.connection.readFull;
    paged.fake.connection.readFull = async command => command === `blocks get --id ${paged.area.id} --depth 1 --format json --fetchMetadata` ? { ok: true, value: JSON.stringify({ data: [] }), limits: [] } : read(command);
    try {
      const page = await paged.knowledge.areas.query({ limit: 100 }); assert.ok(page.value.next); assert.equal(page.value.gaps[0].id, paged.area.id);
      const last = await paged.knowledge.areas.query({ limit: 100, cursor: page.value.next });
      assert.equal(last.value.coverage, "partial", "a continuation itself remembers earlier unreadable records");
      const inventory = await api.reviewInventory(paged.knowledge, "weekly", "2026-11-04");
      assert.equal(inventory.value.population.areas, 100); assert.equal(inventory.value.population.coverage, "partial");
      assert.ok(inventory.value.population.gaps.some(gap => gap.includes(paged.area.id)));
    } finally { paged.fake.connection.readFull = read; }
    console.log("PASS: missing parent reads fail closed, Inbox continuations are traversed and earlier page gaps survive Review aggregation");
  }
  {
    const media = await fixture(); const approved = path.join(temporary, "race-approved"); fs.mkdirSync(approved);
    const file = path.join(approved, "picture.png"), outside = path.join(temporary, "race-outside-secret");
    fs.writeFileSync(outside, "must never be uploaded");
    let uploads = 0, swap;
    const adapter = createCraftAdapter({ connection: media.fake.connection, backendId: "primary", layout: async () => ({ ok: true, value: media.locations, limits: [] }),
      media: async () => ({ ok: true, value: { roots: [approved], credentials: { url: "https://connect.craft.do/links/fake/api/v1" } }, limits: [] }),
      uploads: { verify: async () => ({ ok: true, value: undefined, limits: [] }), upload: async () => { uploads++; return { ok: false, error: { code: "unsupported", message: "unverified bytes reached upload", affected: [], next: "Fix the read guard" } }; } },
    });
    const write = media.fake.connection.write;
    media.fake.connection.write = async command => {
      const result = await write(command);
      const argument = command.match(/--markdown ("(?:[^"\\]|\\.)*")$/)?.[1];
      if (argument && JSON.parse(argument.replaceAll("\n", "\\n")).trim() === "Intro") swap();
      return result;
    };
    try {
      for (const kind of ["symlink", "growth"]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.writeFileSync(file, "image");
        swap = () => { if (kind === "symlink") { fs.unlinkSync(file); fs.symlinkSync(outside, file); } else fs.truncateSync(file, 101 * 1024 * 1024); };
        const result = await adapter.sources.create({ title: "Race", content: `Intro\n\n![picture](file://${file})` }, media.guard(media.locations.source, ["sources.create"]));
        assert.equal(result.ok, false); assert.equal(result.error.code, "partial"); assert.equal(uploads, 0);
      }
    } finally { media.fake.connection.write = write; }
    console.log("PASS: a checked attachment replaced by a symlink or grown during earlier body writes never reaches upload");
  }
  {
    const before = fake.tasks.size;
    const rejected = await knowledge.projects.create({ title: "Raw Tasks", content: "- [x] Closed without history", state: "planned", primaryArea: area }, guard(locations.project, ["projects.create"]));
    assert.equal(rejected.error.code, "invalid"); assert.equal(fake.tasks.size, before);
    assert.equal((await knowledge.projects.materials.append(project, { title: "Raw Task", content: "- [ ] Bypass", presentation: "inline" }, guard(locations.project, ["projects.materials.append"]))).error.code, "invalid");
    const task = await knowledge.tasks.create({ title: "Action", content: "", state: "todo", project }, guard(locations.project, ["tasks.create"]));
    const changed = await knowledge.tasks.update(task.value.created, { title: "Action #gpk/task/waiting" }, guard(locations.project, ["tasks.update"]));
    assert.equal(changed.error.code, "invalid"); assert.equal((await knowledge.tasks.read(task.value.created)).value.value.state, "todo");
    assert.equal((await knowledge.projects.update(project, { edits: [{ before: "Action", after: "Changed #gpk/task/waiting" }] }, guard(locations.project, ["projects.update"]))).error.code, "conflict");
    console.log("PASS: Project prose and Task renames cannot bypass Task creation or transitions");
  }
  const wiki = await knowledge.wikis.create({ title: "Wiki", content: "Budget evidence" }, guard(locations.wiki, ["wikis.create"]));
  {
    const bullet = await knowledge.wikis.create({ title: "Prose list", content: "- pending" }, guard(locations.wiki, ["wikis.create"]));
    const changed = await knowledge.wikis.update(bullet.value.created, { edits: [{ before: "pending", after: "[ ] Hidden task" }] }, guard(locations.wiki, ["wikis.update"]));
    assert.equal(changed.error.code, "invalid", "task syntax assembled across an edit boundary is still refused");
  }
  {
    const write = fake.connection.write;
    fake.connection.write = command => write(command.endsWith('--markdown "- First\\n- Second"') ? command.replace('"- First\\n- Second"', '"- First\\n\\n- Second"') : command);
    try {
      const bullets = await knowledge.wikis.create({ title: "Native list", content: "- First\n- Second" }, guard(locations.wiki, ["wikis.create"]));
      assert.equal(bullets.value.verified, true, JSON.stringify(bullets));
    } finally { fake.connection.write = write; }
  }
  {
    const pageId = "bbbbbbbb-0000-0000-0000-000000000001";
    fake.documents.get(wiki.value.created.id).body.push({ id: pageId, type: "page", markdown: "Nested", children: Array.from({ length: 61 }, (_, i) => ({ id: `bbbbbbbb-0000-0000-0000-${String(i + 2).padStart(12, "0")}`, type: "text", markdown: `Nested evidence ${i}` })) });
    const read = await knowledge.wikis.read(wiki.value.created);
    assert.equal(read.value.coverage, "complete"); assert.ok(read.value.value.content.includes("Nested evidence 60"));
    const forgedCapture = await knowledge.captures.read({ scope: SPACE.id, id: pageId, role: "capture", surface: { scope: SPACE.id, id: "inbox", role: "capture-surface" } });
    assert.equal(forgedCapture.error.code, "not-found", "forged CaptureRef cannot read blocks outside the capture surface");
    const dailyCaptureId = "bbbbbbbb-0000-0000-0000-000000000099";
    fake.daily.set("2026-10-15", [{ id: dailyCaptureId, type: "page", markdown: "Daily Nested", children: Array.from({ length: 61 }, (_, i) => ({ id: `bbbbbbbb-0000-0000-0001-${String(i + 1).padStart(12, "0")}`, type: "text", markdown: `Daily evidence ${i}` })) }]);
    const capture = await knowledge.captures.read({ scope: SPACE.id, id: dailyCaptureId, role: "capture", surface: { scope: SPACE.id, id: "daily-notes/2026-10-15", role: "capture-surface" } });
    assert.equal(capture.ok, true, JSON.stringify(capture));
    assert.ok(capture.value.value.content.includes("Daily evidence 60"));
    const originalRead = fake.connection.read;
    fake.connection.read = async command => { assert.ok(!command.startsWith("search "), "text predicates on enumerated folders must not depend on the search index"); return originalRead(command); };
    try {
      assert.equal((await knowledge.wikis.query({ text: "budget" })).value.items.length, 1);
      assert.equal((await knowledge.wikis.query({ text: "Budget" })).value.items.length, 1);
      assert.equal((await knowledge.wikis.query({ text: "nonexistent" })).value.items.length, 0);
      assert.equal((await knowledge.wikis.query({ text: "Nested evidence 60" })).value.items.length, 1);
    } finally { fake.connection.read = originalRead; }
    console.log("PASS: complete reads traverse nested child pages, captures verify surface membership, and text queries match case-insensitively");
  }
  {
    const folder = fake.seedFolder("New nested folder", 1, locations.source.id);
    const id = "dddddddd-0000-0000-0000-000000000001";
    fake.documents.set(id, { title: "Nested source", folderId: folder.id, location: "folder", body: [{ id: "dddddddd-0000-0000-0000-000000000002", type: "text", markdown: "Newly added evidence" }] });
    assert.equal((await knowledge.sources.query({ text: "Newly added evidence" })).value.items.length, 1, "new subfolders are included without a cache delay");
    folder.parentId = null;
    const writes = fake.calls.filter(([kind]) => kind === "write").length;
    const moved = await knowledge.sources.update({ kind: "Source", scope: SPACE.id, id }, { title: "Must not change" }, guard(locations.source, ["sources.update"]));
    assert.equal(moved.error.code, "not-found");
    assert.equal(fake.calls.filter(([kind]) => kind === "write").length, writes, "moving a subfolder out invalidates its write containment immediately");
  }
  {
    const task = fake.seed("Standalone", "todo", { kind: "daily-note", date: "2026-10-10" }, undefined, [`- [Wiki](block://${wiki.value.created.id}) — Evidence`]);
    assert.equal((await knowledge.links.query(wiki.value.created)).value.coverage, "partial");
    assert.equal((await knowledge.tasks.query({ relatedTo: wiki.value.created })).value.coverage, "partial");
    assert.equal((await knowledge.wikis.query({ relatedTo: { kind: "Task", scope: SPACE.id, id: task.id } })).value.coverage, "partial");
    console.log("PASS: incomplete link discovery propagates partial coverage into relatedTo queries");
  }
  {
    const write = fake.connection.write;
    fake.connection.write = async command => command.endsWith('--markdown "Dropped body"') ? { ok: true, value: "Accepted", limits: [] } : write(command);
    try {
      const creates = [
        () => knowledge.wikis.create({ title: "Dropped Wiki", content: "Dropped body" }, guard(locations.wiki, ["wikis.create"])),
        () => knowledge.areas.create({ title: "Dropped Area", content: "Dropped body", state: "active" }, guard(locations.area, ["areas.create"])),
        () => knowledge.projects.create({ title: "Dropped Project", content: "Dropped body", state: "planned", primaryArea: area }, guard(locations.project, ["projects.create"])),
        () => knowledge.tasks.create({ title: "Dropped Task", content: "Dropped body", state: "todo", project }, guard(locations.project, ["tasks.create"])),
      ];
      for (const create of creates) { const result = await create(); assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, "partial"); assert.ok(result.error.affected.length); }
    } finally { fake.connection.write = write; }
    console.log("PASS: accepted but missing create bodies never produce a verified creation receipt");
  }
  {
    const first = await knowledge.projects.materials.append(project, { title: "First material", content: "First body", presentation: "inline" }, guard(locations.project, ["projects.materials.append"]));
    await knowledge.projects.materials.append(project, { title: "Next material", content: "Next body", presentation: "inline" }, guard(locations.project, ["projects.materials.append"]));
    const before = await knowledge.projects.materials.read(first.value.created);
    assert.equal(before.value.value.presentation, "inline"); assert.equal(before.value.value.content, "First body");
    const changed = await knowledge.projects.materials.update(first.value.created, { title: "Renamed material", edits: [{ before: "First body", after: "Updated body" }] }, { ...guard(locations.project, ["projects.materials.update"]), expected: before.value.version });
    assert.equal(changed.value.verified, true, JSON.stringify(changed));
    const after = await knowledge.projects.materials.read(first.value.created);
    assert.equal(after.value.value.content, "Updated body"); assert.equal(after.value.value.title, "Renamed material");
    assert.ok((await knowledge.projects.read(project)).value.value.content.includes("Next body"));
    console.log("PASS: inline material references read and update only their bounded section");
  }
  {
    const root = path.join(temporary, "timezone-override"); fs.mkdirSync(root);
    const configured = structuredClone(settings); configured.preferences.timezone = "America/Los_Angeles"; configured.knowledgeBackend.configurations[0].layout.locations = locations;
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(configured));
    fs.writeFileSync(path.join(root, "grants.json"), JSON.stringify({ schemaVersion: 1, grants: [{ id: "daily", backendId: "primary", root: { scope: SPACE.id, id: "daily-notes" }, operations: ["tasks.create"], unattended: false }] }));
    const runtime = bootstrap({ env: { GPK_CONTROL_ROOT: root, HOME: temporary }, secrets: memorySecretStore(), createConnection: () => fake.connection });
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-01-01T23:30:00Z"])); } };
    try {
      const task = await runtime.operations.tasksCreate({ title: "Timezone placement", content: "", state: "todo" });
      assert.equal(task.ok, true, JSON.stringify(task)); assert.equal(fake.tasks.get(task.value.created.id).container.date, "2026-01-01");
      assert.equal((await runtime.operations.reviewInventory("daily")).value.today, "2026-01-01");
    } finally { globalThis.Date = RealDate; await runtime.close(); }
    console.log("PASS: the configured timezone controls both Task placement and the review date");
  }
  for (const failed of ["Areas", "Projects", "Sources", "Wikis", "Outputs"]) {
    const backend = fakeCraft(); const write = backend.connection.write; let once = true;
    backend.connection.write = async command => {
      if (once && command.startsWith(`${["Areas", "Projects"].includes(failed) ? "collections" : "folders"} create --name "${failed}"`)) { once = false; return { ok: false, error: { code: "unavailable", message: "Transient failure", affected: [], next: "Inspect and retry" } }; }
      return write(command);
    };
    const first = createCraftAdapter({ connection: backend.connection, backendId: "primary" });
    assert.equal((await first.workspace.establish(plan)).error.code, "partial");
    // A fresh adapter must use backend evidence, not a process-local recovery map.
    const second = createCraftAdapter({ connection: backend.connection, backendId: "primary" });
    const resumed = await second.workspace.establish(plan); assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal([...backend.documents.values()].filter(doc => doc.title === "Review").length, 1);
    assert.equal([...backend.collections.values()].filter(c => c.name === "Areas").length, 1);
    assert.equal([...backend.collections.values()].filter(c => c.name === "Projects").length, 1);
  }
  console.log("PASS: Setup resumes each interrupted creation step from backend evidence without duplicate homes or Collections");
  {
    const read = fake.connection.read; let pages = 0;
    fake.connection.read = async command => command.startsWith(`blocks get --id ${locations.area.id} --format json --depth 1`) ? { ok: true, value: JSON.stringify({ data: [{ id: locations.area.id, type: "collection", items: [] }], nextCursor: String(++pages) }), limits: [] } : read(command);
    try { assert.equal((await knowledge.areas.query({})).error.code, "unavailable"); assert.equal(pages, 20); }
    finally { fake.connection.read = read; }
    console.log("PASS: a Collection page cap fails explicitly instead of claiming complete coverage");
  }
  {
    const script = fs.readFileSync(path.join(repo, "src/onboarding/page.html"), "utf8").match(/<script>([\s\S]*)<\/script>/)[1].replace(/\nstartConsole\(\);\s*$/, "");
    const context = vm.createContext({ location: { pathname: "/sources" }, navigator: { language: "en" }, setInterval, clearInterval });
    vm.runInContext(script, context);
    vm.runInContext(`
      h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(), value: props?.value || "", replaceChildren(...next) { this.children = next.flat(); }, setAttribute() {}, addEventListener() {} });
      const missing = missingGrantSelections(
        [{ backendId: "primary", root: { scope: "s", id: "inbox" }, operations: ["tasks.update", "links.add"] }],
        [{ backendId: "primary", root: { scope: "s", id: "inbox" }, operations: ["tasks.update"] }],
        "primary",
      );
      const params = extractSchemaParams({
        type: "object",
        required: ["cadence"],
        properties: {
          cadence: { type: "string", enum: ["daily", "weekly", "monthly"] },
          horizonDays: { type: "integer" },
        },
      });
      const explorer = toolsView([
        { name: "gpk_review_inventory", description: "Snapshot review", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["cadence"], properties: { cadence: { type: "string", enum: ["daily", "weekly", "monthly"] } } } },
      ]);
      globalThis.__missing = missing;
      globalThis.__params = params;
      globalThis.__skillsCount = SKILLS_CATALOG.length;
      globalThis.__currentPath = currentPath;
      globalThis.__explorerTag = explorer.tag;
    `, context);
    assert.equal(context.__currentPath, "/config", "/sources redirects cleanly into Configuration");
    assert.deepEqual(JSON.parse(JSON.stringify(context.__missing)), [{ root: "inbox", operations: ["links.add"] }]);
    assert.equal(context.__skillsCount, 6);
    assert.equal(context.__params[0].name, "cadence");
    assert.equal(context.__params[0].required, true);
    assert.match(context.__params[0].type, /daily.*weekly.*monthly/);
    assert.equal(context.__params[1].required, false);
    assert.equal(context.__explorerTag, "div");
    console.log("PASS: Console auto-detects missing workspace grants and renders Skill-to-MCP structured explorer");
  }
  await oauthRegression({ createCraftConnection, memorySecretStore });
}

async function oauthRegression({ createCraftConnection, memorySecretStore }) {
  let origin;
  let registrations = 0;
  let rejectedRefreshes = 0;
  const server = http.createServer(async (request, response) => {
    const json = value => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (request.url.includes("oauth-protected-resource")) return json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
    if (request.url.includes("oauth-authorization-server") || request.url.includes("openid-configuration")) return json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    let raw = ""; for await (const chunk of request) raw += chunk;
    if (request.url === "/register") {
      registrations++;
      return json({ ...JSON.parse(raw), client_id: "review-client" });
    }
    if (request.url === "/token" && new URLSearchParams(raw).get("grant_type") === "refresh_token") {
      rejectedRefreshes++;
      return response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token has expired" }));
    }
    if (request.url === "/token") return json({ access_token: "local-fixture", token_type: "Bearer", expires_in: 3600 });
    if (request.headers.authorization !== "Bearer local-fixture") return response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }).end();
    if (request.method !== "POST") return response.writeHead(405).end();
    const message = JSON.parse(raw);
    if (message.id === undefined) return response.writeHead(202).end();
    const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local-oauth", version: "0" } } : { content: [{ type: "text", text: JSON.stringify({ space: { id: "local", name: "Local", timezone: "UTC" } }) }] };
    json({ jsonrpc: "2.0", id: message.id, result });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const portFinder = net.createServer(); await new Promise(resolve => portFinder.listen(0, "127.0.0.1", resolve)); const callbackPort = portFinder.address().port; await new Promise(resolve => portFinder.close(resolve));
  const secrets = memorySecretStore();
  const options = { endpoint: `${origin}/mcp`, secretKey: "local", secrets, callbackPort };
  const connection = createCraftConnection(options);
  async function approveAndVerify(target, authorizationUrl) {
    const state = new URL(authorizationUrl).searchParams.get("state");
    assert.ok(state && state.length >= 16, "OAuth authorization URL includes state nonce");
    assert.equal((await fetch(`http://127.0.0.1:${callbackPort}/callback?code=local&state=forged&iss=${encodeURIComponent(origin)}`)).status, 400, "wrong OAuth state is rejected");
    assert.equal((await fetch(`http://127.0.0.1:${callbackPort}/callback?code=local&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(origin)}`)).status, 200);
    for (let i = 0; i < 100; i++) {
      if ((await target.status()).tokens === "verified") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Craft authorization did not reach verified status");
  }
  let reconnecting;
  let waiting;
  try {
    assert.equal((await connection.read("connection info")).error.code, "unauthorized");
    const firstAuth = await connection.authorize();
    assert.equal(firstAuth.value.state, "pending");
    await approveAndVerify(connection, firstAuth.value.authorizationUrl);
    await connection.close();

    const stored = JSON.parse(await secrets.read("local"));
    stored.tokens = { ...stored.tokens, access_token: "expired", refresh_token: "expired-refresh", obtainedAt: 1 };
    await secrets.write("local", JSON.stringify(stored));
    reconnecting = createCraftConnection(options);
    assert.equal((await reconnecting.status()).tokens, "none");
    assert.equal(JSON.parse(await secrets.read("local")).tokens, undefined);
    const reconnect = await reconnecting.authorize();
    assert.equal(reconnect.value.state, "pending");
    assert.equal(new URL(reconnect.value.authorizationUrl).pathname, "/authorize");
    await approveAndVerify(reconnecting, reconnect.value.authorizationUrl);
    assert.equal(rejectedRefreshes, 1);
    assert.equal(registrations, 1);
    await reconnecting.close();
    console.log("PASS: expired Craft refresh token leads to browser reauthorization with the existing client");
    waiting = createCraftConnection({ endpoint: `${origin}/mcp`, secretKey: "waiting", secrets: memorySecretStore(), callbackPort });
    assert.equal((await waiting.authorize()).value.state, "pending");
    await waiting.close();
    const listener = net.createServer(); await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(callbackPort, "127.0.0.1", resolve); }); await new Promise(resolve => listener.close(resolve));
    console.log("PASS: OAuth after a failed read completes, and shutdown releases a pending callback port");
  } finally { await waiting?.close(); await reconnecting?.close(); await connection.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
