const parseMarkdown = argument => JSON.parse(argument.replaceAll("\n", "\\n"));
/** Observed Craft command surface, shared by adapter and runtime regression scenarios. */
export function fakeCraft(SPACE) {
  const tasks = new Map();
  const daily = new Map();
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
    ...(depth > 0 ? { content: row.children.map(child => child.taskId ? blockJson(tasks.get(child.taskId), depth - 1) : { id: child.id, type: child.type, markdown: child.markdown, ...(child.listStyle ? { listStyle: child.listStyle } : {}), ...(child.textStyle ? { textStyle: child.textStyle } : {}) }) } : {}),
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
      const blocks = splitBlocks(markdown);
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
  const splitBlocks = markdown => markdown.split(/\n\s*\n/).filter(Boolean).map(text => ({ id: id(), type: /^\|.*\n\|[-: |]+\|/.test(text) ? "table" : "text", markdown: text, ...(/^#{1,4} /.test(text) ? { textStyle: "h" + text.match(/^#+/)[0].length } : {}), ...(/^\s*[-+*] /.test(text) ? { listStyle: "bullet" } : /^\s*\d+\. /.test(text) ? { listStyle: "numbered" } : {}) }));
  const docJson = (rootId, doc, depth) => ({ id: rootId, type: "page", textStyle: "page", markdown: doc.title, metadata: { lastModifiedAt: doc.modified ?? "2026-10-11T00:00:00.000+08:00" },
    ...(depth > 0 ? { content: (doc.body ?? []).map(b => ({ id: b.id, type: b.type, markdown: b.markdown, ...(b.listStyle ? { listStyle: b.listStyle } : {}), ...(b.textStyle ? { textStyle: b.textStyle } : {}) })) } : {}) });
  const pageInTree = (list, blockId) => { for (const b of list ?? []) { if (b.type === "page") { if (b.id === blockId) return b; const inner = pageInTree(b.children, blockId); if (inner) return inner; } } return null; };
  const nestedPageOf = blockId => { for (const doc of documents.values()) { const page = pageInTree(doc.body, blockId); if (page) return page; } return null; };
  const dailyBlockOf = blockId => {
    for (const entries of daily.values()) {
      for (const b of entries) {
        if (b.id === blockId) return b;
        const inner = pageInTree(b.children, blockId);
        if (inner) return inner;
      }
    }
    return null;
  };
  const pageJson = (page, depth) => ({ id: page.id, type: page.type ?? "page", markdown: page.markdown, metadata: { lastModifiedAt: page.modified ?? "2026-10-11T00:00:00.000+08:00" },
    ...(depth > 0 ? { content: (page.children ?? []).map(b => ({ id: b.id, type: b.type ?? "text", markdown: b.markdown, listStyle: b.listStyle, textStyle: b.textStyle })) } : {}) });
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
      if ((m = command.match(/^documents list --location (templates|unsorted|trash)$/))) {
        const rows = [...documents.entries()].filter(([, d]) => d.location === m[1]).map(([id, d]) => `  <${id}> ${d.title}`);
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
      if ((m = command.match(/^blocks get --date (\S+) --depth 1 --format json$/))) {
        return { ok: true, value: JSON.stringify({ data: daily.has(m[1]) ? [{ id: "daily-" + m[1], content: daily.get(m[1]) }] : [] }), limits: [] };
      }
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
        const nested = nestedPageOf(m[1]) ?? dailyBlockOf(m[1]);
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
      if ((m = command.match(/^blocks add --date (\S+) --markdown (".*")$/))) {
        const entries = daily.get(m[1]) ?? [];
        entries.push(...splitBlocks(parseMarkdown(m[2]))); daily.set(m[1], entries);
        return { ok: true, value: "Added block", limits: [] };
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
        const page = { id: id(), type: "page", markdown: payload.markdown, children: (payload.content ?? []).map(b => ({ id: id(), type: "text", markdown: b.markdown, listStyle: b.listStyle, textStyle: b.textStyle })) };
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
          if (found) { const child = addToRow(found.row, parseMarkdown(m[2])); return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] }; }
          const doc = documents.get(m[1]) ?? collections.get(m[1]) ?? nestedPageOf(m[1]) ?? pageOf(m[1]);
          if (!doc) return { ok: false, error: { code: "not-found", message: "Failed: no such block", affected: [], next: "" } };
          const blocks = splitBlocks(parseMarkdown(m[2]));
          if (doc.children !== undefined || nestedPageOf(m[1])) (doc.children ??= []).push(...blocks); else (doc.body ??= []).push(...blocks);
          doc.modified = `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`;
          return { ok: true, value: `Added ${blocks.length} block(s).\nIDs: ${blocks.map(b => `<${b.id}>`).join(", ")}`, limits: [] };
        }
        const child = { id: id(), markdown: parseMarkdown(m[2]) }; task.children.push(child); touch(task);
        return { ok: true, value: `Added 1 block.\nIDs: <${child.id}>`, limits: [] };
      }
      if ((m = command.match(/^blocks update --id (\S+) --markdown ("(?:[^"\\]|\\.)*")$/))) {
        for (const task of tasks.values()) { const child = task.children.find(c => c.id === m[1]); if (child) { child.markdown = parseMarkdown(m[2]); touch(task); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; } }
        if (documents.get(m[1])) { documents.get(m[1]).title = parseMarkdown(m[2]); documents.get(m[1]).modified = `2026-10-11T00:01:${String(nextId++).padStart(2, "0")}.000+08:00`; return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; }
        const docOwner = ownerOfBlock(m[1]);
        if (docOwner && !rowOf(m[1])) {
          const index = docOwner.list.findIndex(b => b.id === m[1]); const block = docOwner.list[index];
          if (block && !block.taskId) {
            const paragraphs = splitBlocks(parseMarkdown(m[2]));
            if (paragraphs.length) { paragraphs[0].id = block.id; docOwner.list.splice(index, 1, ...paragraphs); }
            else block.markdown = "";
            docOwner.touch(); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] };
          }
        }
        for (const c of collections.values()) for (const row of c.rows ?? []) {
          const child = row.children.find(ch => ch.id === m[1] && !ch.taskId); if (child) { child.markdown = parseMarkdown(m[2]); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; }
          for (const page of row.children.filter(ch => ch.type === "page")) { const inner = (page.children ?? []).find(ch => ch.id === m[1]); if (inner) { inner.markdown = parseMarkdown(m[2]); return { ok: true, value: `Updated block <${m[1]}>.`, limits: [] }; } }
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
  return { connection, tasks, daily, calls, seed, seedFolder, collections, folders, documents };
}
