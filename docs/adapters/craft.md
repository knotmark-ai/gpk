# Craft backend mapping

Status: initial mapping; domain 0.4 alignment and validation pending.
Documentation review: **2026-09-11**, against Craft's public MCP, API, and help
pages. Live check: **2026-09-11**, through the Craft MCP connector
available in Claude Code. Items marked *verified* were observed on a real space.
A scoped, authorized tag-write check updated one block twice; every
other observation is read-only. A **2026-09-22 read-only MCP help check** reconfirmed
the query surface below; it did not repeat the historical tag-write test.
A **2026-10-09 inline-formatting and field-preservation check** read one
existing highlighted block and then created, updated and trashed one scratch
document to observe which block fields `blocks update --markdown` preserves,
then a second scratch document to observe task, capture and Collection mechanics.
The **2026-10-10 first slice live run** exercised the packaged runtime end to end.
A **2026-10-10 headless OAuth check** connected GPK's own MCP client to
`mcp.craft.do` from a Node process without the host connector and recorded what
a plain client receives.
The Task and capture operations are implemented in `src/adapters/craft.ts` on
this evidence; every other operation still returns unsupported.
The connector observations below were made through the host's Craft connector;
the 2026-10-10 section records which of them also hold for GPK's own client. The
delivery boundary is recorded in [current support](../../README.md#current-support).

The intended adapter maps GPK's Area, Project, Task, Source, Wiki, and Output
model to Craft's available documents, blocks, tasks, links, and other native
capabilities. Areas carry continuing direction and responsibilities; Projects
contain their own Objective and Key Results. This document records integration
evidence and proposed mappings; native rendering of the bundled entity templates
and write procedures are not implemented.

Access is through an MCP or API connection created and authorized by the user;
GPK does not proxy Craft or store connection secrets.

## Requirements

- A Craft connection that includes the target space or target documents.
- Read access for inspection and review tasks.
- Future write workflows will require appropriate access; this foundation does
  not implement create, update, move, link, or migration operations.
- Claude Code or Codex with the GPK 0.1 package installed.

Craft connections can be scoped. An agent must verify the current connection
scope before treating search results as a complete workspace inventory.

## Selected mapping approach

Decision of **2026-10-10**, based on the dated checks recorded below. The
[KnowledgeBackendPort](../../src/domain/knowledge-backend-port.ts) owns operation
signatures; the [behavior guide](../storage-contracts.md) owns their guarantees.
This document owns Craft representation and evidence. Every choice here is a
representation choice and is independent of the transport that carries it.

- **Transport:** GPK's own MCP client to `https://mcp.craft.do/my/mcp` with a
  dynamically registered public OAuth client (see the 2026-10-10 check). Craft
  authorizes GPK as its own connection, independent of any host connector. One
  registration and token set per GPK instance, kept in the host-neutral secret
  store (macOS keychain) under the instance key so both desktop harnesses share
  it; a failed refresh re-reads the store before re-authorizing, because the
  other process may have rotated the pair. REST is not implemented; it becomes a
  second adapter only if a remote deployment needs it.
- **Authorization inside the space:** the connection's read/write setting is the
  outer limit. Each mutation then needs a GPK grant whose root is the Projects or
  Areas Collection, a layout folder, a document or a capture surface and whose
  operation list names the port method; the adapter checks Collection membership
  or block containment before writing.
- **Projects and Areas are Collection items.** Setup creates or adopts two
  Collections: one for Projects with a single-select `Status` column holding
  `planned`, `active`, `paused`, `completed`, `canceled` and a relation column to
  the Areas Collection for the primary Area; one for Areas with a single-select
  `Status` column holding `active`, `inactive`. Lifecycle state and primary Area
  are read from `properties`, never from prose. State queries enumerate the
  Collection with `blocks get --id <collection> --format json --depth 1` (rows
  with typed `properties`) and filter in memory; coverage is complete once every
  page is read. Rows are created with `collections items-add --<TitleColumn>
  --Status [--Area]` and changed with `items-update`; the title column's display
  name comes from `collections schema`. The row's page holds the entity body
  under the ordinary block rules; process material is a nested page there
  (`materials.list` returns nested non-task pages; inline material is a heading
  plus paragraphs in the body). Closing a Project is refused while any Task in
  its row is open; transitions and Area changes append a dated reason block.
- **Layout establishment (Setup):** the default assumes a workspace dedicated
  to GPK and creates everything at the top level (decision of 2026-10-11, after
  the fresh-space run showed a lone `GPK` folder adds a level without
  separating anything). In a workspace that also holds other material, a
  namespace folder (`{"folder": "GPK"}`, reused if present) holds everything GPK
  creates. One host document (default title `GPK`) holds the Areas Collection
  (`Status: active, inactive`) and the Projects Collection (`Status: planned,
  active, paused, completed, canceled`; `Area` relation to the Areas
  Collection), and Sources, Wikis and Outputs are folders beside it. Created
  Collections get people-facing views (Projects: Board by Status, By Area,
  Active; Areas: Board); the bundled entity templates are installed once by
  title (`GPK Project` and so on) into Craft's Templates area, with Collection
  columns stripped from the body. Existing Collections are adopted only when
  their Status column matches; existing folders are adopted by ID and never
  moved or edited; a sibling name clash is refused. Setup preflights every
  adoption before creating anything, and the user's tree outside the
  configured locations is read-only for GPK.
- **Entity kind** is Collection membership for Projects and Areas. Sources, Wikis
  and Outputs are ordinary documents whose kind is the Settings layout location
  that contains them (`documents list --folder` lists it recursively); a document
  moved out of its location is unrecognized, not reclassified. The root block ID
  is the entity ID, its markdown is the title (renamed with `blocks update` on
  the root), and `documents create --title --folder` plus a body `blocks add`
  creates one. Archive, restore and remove are not implemented: Craft's trash
  purges after 30 days, which is not archiving.
- **Links** are one bullet per relation in the linking record's body:
  `- [title](block://<id>) — context` under a `## Links` heading (appended once;
  later links follow the last bullet), or a child block of a Task. The block
  link round-trips through markdown unchanged. Outgoing links are read from that
  body; incoming links are found by scanning every GPK record body (rows at
  depth 2 so their Tasks count, documents at depth 1) in batched reads, because
  `search` indexes with a delay and does not match link targets. `relatedTo`
  predicates reuse that discovery. Link targets must be GPK records; a target
  that is none of them but is a task block is a Task.
- **Checkpoints** are nested pages of a `GPK System` page nested in the host
  document, titled by key; the page's blocks are the content. The system page
  is created on the first save, never on read. Saving replaces the page's
  blocks (`blocks delete --ids` then `blocks add`), authorized on the `system`
  root. Craft answers an occasional 500 on writes; the connection retries a
  read once and leaves a write to the caller's read-back.
- **Tasks are native task blocks**, which are pages: the action line is the title
  and child blocks hold description, materials and result. A Project-owned Task
  is a task block inside the Project's Collection row; the row is the primary
  Project and the block order is the plan order (`projects.orderTasks` moves
  blocks with `blocks move --targetSiblingId`). A standalone Task lives in the
  Daily Note of the day it was accepted; the Inbox is a capture surface read
  through `tasks list --scope inbox`. Task blocks in any other document are
  outside GPK's locations: queries skip them (counted in limits) and
  `assignProject` refuses to move them. Completion does not move the block, so
  plan order survives; `tasks add` prepends, so Project-owned Tasks are added
  with `blocks add --siblingId <last task> --position after` (after the Plan
  heading when the row has no Task yet). Ownership changes are `blocks move`
  into the row or into today's Daily Note, authorized on the destination root.
  Craft's listing attributes a row's Tasks to the host document (`in: GPK
  <hostRoot>`), so the adapter maps host-document Tasks to rows by reading the
  rows' children in one batched call.
- **Task state:** native todo/done/canceled map to domain states; `doing` and
  `waiting` are a line-end tag `#gpk/task/doing` or `#gpk/task/waiting` on the
  action line, visible in `tasks list` without reading children. The adapter
  re-emits the tag on every title change because `tasks update --markdown`
  replaces the whole line. Moving to `done` or `canceled` drops the tag in the
  same `tasks update` (`--state` and `--markdown` together, verified
  2026-10-12). A native terminal checkbox still takes precedence over a stale
  tag written by hand; report the mismatch and repair only with authorization.
- **Task time:** the adjustable time is `taskInfo.scheduleDate`, written with the
  JSON update and cleared with `null`. The native deadline is a fixed constraint
  that GPK reads but never reschedules.
- **Body content** is Craft's markdown dialect passed through unchanged. A
  `TextEdit` locates the block whose body contains the match, strips the rendered
  list prefix, rewrites that block's body with `--markdown` and reads back.
- **Revision guard:** no conditional update exists and stamps are invisible to a
  plain client. `expected` is emulated from the read-time `lastModifiedAt` and
  body text, re-read immediately before writing; declare the window as a limit.
- Keep Task actions concise; accompanying descriptions link actual review or
  execution materials through resolved native block links or verified external
  document/PR URLs. Do not show non-clickable local paths as review entry points
  or copy authoritative repository drafts into Craft merely to make them readable.
- Resolve actual root/block references, preserve order and unrelated native
  content, and verify each scoped write by direct readback.

### Control boundary

Craft is the initial Knowledge Backend, not the User Control store. Settings,
grants and personal Markdown templates use the selected local `.gpk` root under
the [local control mapping](local-control.md). Do not create configuration/template
documents in Craft as an onboarding requirement. Personal background can remain an
ordinary Wiki referenced from Settings; actual Project/Area constraints belong here.

The selected Settings backend configuration supplies safe connection references and
layout locations. Resolve actual Craft folder/document IDs, not titles or a presumed
fixed tree; native Inbox/Daily Notes remain capture surfaces. Secrets are host-owned.
Render selected Markdown templates into domain content while preserving role/state
meaning; Task templates produce inline Tasks, not a Task directory. Local configuration
readiness and live Craft access/write validation remain separate requirements.

## Connection model

Facts documented by Craft:

| Item | Documented fact |
|---|---|
| MCP endpoint | `https://mcp.craft.do/my/mcp` over HTTP transport. Claude Code registers it with `claude mcp add --transport http craft https://mcp.craft.do/my/mcp`, then `/mcp` starts the browser authorization flow |
| Authorization | Browser OAuth; the user selects one space and approves. The user configures no client ID or secret |
| Connection types | All daily notes; selected documents; the whole space. Whole-space access requires Craft 3.3.5 or later |
| Scope | One connection is bound to one space. Another space needs another connection |
| Permissions | A connection can be limited to read-only or write-only operations in Craft's connection settings |
| Credentials | An unguessable URL, optionally combined with a password. Changing the password rotates embedded file and image links |
| Tool inventory | Craft publishes no MCP tool list. Verified in Claude Code: the connector exposes three tools, `craft_read`, `craft_write`, and `blocks_revert`. The first two are command multiplexers (`<entity> <action> [flags]`, batchable with semicolons, each with `--help`) rather than one tool per endpoint. This is the "MCP v2" surface from Craft 3.4.4 (June 2026), which cut the interface token count by a stated 85.9%. The Claude connector directory listing, added March 2026, still describes 32 granular tools such as `blocks_get`, `blocks_add`, `tasks_update`, and `collectionItems_add`; Craft says legacy connections keep working, and an existing connector must be disconnected and reconnected to move to v2. Record which surface a client actually presents |

Implication for GPK: the read-only or write-only connection setting is a
host-enforced boundary. The authorization layer in the technical design should
rely on it as the hard limit rather than on Skill instructions alone.

## Documented API surface

Endpoints relevant to GPK. Whole-space connections expose all of them;
selected-document and daily-note connections expose subsets.

| Area | Endpoints | Notes |
|---|---|---|
| Blocks | `GET /blocks` (`id`, `date`, `maxDepth`, `fetchMetadata`), `POST /blocks`, `PUT /blocks`, `PUT /blocks/move`, `DELETE /blocks`, `GET /blocks/search` | Accepts `application/json` or `text/markdown`. Insert position is `pageId` with `start`/`end`, or `siblingId` with `before`/`after`. Block search is single-document RE2 regex with context blocks |
| Documents | `GET /documents` (`location`, `folderId`, date filters, `fetchMetadata`), `POST /documents`, `PUT /documents/move`, `DELETE /documents`, `GET /documents/search` | A document ID equals its root block ID. Delete is a soft delete to trash. Cross-document search returns the top 20 results with no pagination |
| Folders | `GET /folders`, `POST /folders`, `PUT /folders/move`, `DELETE /folders` | Built-in locations are `unsorted`, `templates`, `trash`, and `daily_notes`; they cannot be deleted. Only empty folders can be deleted; daily notes cannot be moved |
| Tasks | `GET /tasks` (`scope`: `inbox` / `active` / `upcoming` / `logbook` / `document`), `POST /tasks`, `PUT /tasks`, `DELETE /tasks` | Fields: `id`, `content`, `state` (`active` / `done` / `cancelled`), `scheduledDate`, `deadline`, `completedAt`, `location` (`inbox` / `dailyNote` / `document`). `DELETE /tasks` covers Inbox, Logbook, and daily-note tasks; tasks inside documents are deleted through `DELETE /blocks` |
| Collections | `GET /collections`, `GET /collections/{id}/schema`, `GET`/`POST`/`PUT`/`DELETE /collections/{id}/items` | Property types include text, select, relation, date, checkbox, number, and url. Two-way relations sync automatically; set one side only |
| Connection | `GET /connection` | Space ID, timezone, current UTC time, and deep-link URL templates. Marked experimental together with `POST /upload` and `POST /comments`; breaking changes are possible |

Block model facts:

- `type` includes `text`, `page`, `collectionItem`, `table`, `collection`,
  `code`, `richUrl`, `line`, and media types.
- `listStyle: task` carries `taskInfo` with `state`, `scheduledDate`, `deadline`,
  and `completedAt`.
- `textStyle: page` or `card` makes a nested page with its own block ID; the
  markdown form is `<page><pageTitle>…</pageTitle><content>…</content></page>`.
- Metadata, when requested, is `createdAt`, `lastModifiedAt`, `createdBy`,
  `lastModifiedBy`, and comments.
- Internal links are `[text](block://<id>)` and `[text](date://YYYY-MM-DD)`.
- No `revision`, `version`, or ETag field is documented on documents or blocks.
- No tag parameter, tag field, or tags endpoint appears in the embedded OpenAPI
  specification of either reference, although the MCP and API help pages both
  say search supports "tag and date filtering". See Tags below.

Tags are a documented product feature, separate from the API reference:

- Tags are inline. Typing `#` followed by a name inside any paragraph, heading,
  or list item creates a tag chip. The tag belongs to that block, not to a
  document-level property.
- One level of hierarchy is supported with `#parent/child`. Verified: a name
  with two slashes, such as `#gpk/status/test`, still renders as a single chip;
  the Tags view groups it under the first segment `gpk` and shows `status/test`
  as one child label with its own count. Craft 3.5.2 (July 2026) documents the
  same rule: the first slash marks the subtag and further slashes are part of
  the subtag's name. The same release stopped treating `##`-prefixed text and
  `#`-prefixed Collection select values as tags, and the Space Settings Tags
  section has an ignore list for hashtags that must not become tags.
- Roadmap, not capability: Craft 3.6.0 (September 2026) says tag integration
  with Collections and Tasks will deepen and that block-based tag results are
  "coming to Search later, too". A product roadmap is not proof that the current
  MCP connection exposes a tag filter; the dated help check below found none.
- Tags are enabled per space and per member in Space Settings → Tags. In shared
  spaces they are off by default for members.
- The Tags view lists every occurrence across documents, narrows results by
  combining tags, and renames or deletes all occurrences of a tag at once.
- Tags created inside Inbox items do not appear in the Tags view until the item
  is moved into a document.
- Verified through the connector: a committed tag, including a hierarchical
  `#parent/child` tag, is plain `#name` text inside the block's markdown in both
  markdown and JSON output. No tag field or attribute exists on the block, and
  search matches tags as text.
- Verified by the scoped tag-write check: updating a block's markdown to contain `#name` text
  through `craft_write` produces a real tag chip in the editor, including a
  hierarchical `#gpk/test`, and an existing chip survives a whole-block text
  replacement. Tags are therefore readable and writable through the connector
  as plain text. See the live check below.

## Live check (2026-09-11)

Observed through the Craft MCP connector in Claude Code on one personal space.
Read commands plus two authorized updates to the same block; identifiers, titles, and
content are deliberately omitted.

| Item | Observed |
|---|---|
| Read commands | `folders list`, `documents list`, `documents resolve-link`, `tasks list`, `blocks get`, `collections list/schema/items-get/views-list`, `connection info`, `search`, plus theme, image, and whiteboard helpers |
| Tags | Committed inline tags render as plain `#name` text in block markdown; hierarchical tags render as `#parent/child`. JSON output adds no tag field. `search --include "#name"` and `search --regexp` both match tag text. The full `search` flag list has no tag filter: `--include`, `--regexp`, `--document`, `--location`, `--folder`, created/modified/daily-note date bounds, `--cursor`, `--fetch-blocks` |
| Tag false positives | A `#`-anchored regex also matched `#` text in code output and headings typed as text. A reserved namespace needs an anchored, distinctive pattern |
| Tag vocabulary | No command lists existing tags, their counts, or the documents carrying them. Retrieval works only by searching for a known tag string, so the Tags view's enumeration has no API equivalent |
| Pagination | `search`, `documents list`, and `blocks get` accept `--cursor`. `blocks get` pages 50 direct children at a time. A `CURSOR_INVALID` response means the data changed; retry without the cursor. One search returned more than 20 matches in a single response, so the REST reference's 20-result statement does not describe this connector |
| Identity | A Craft app or web link carries a raw documentId that differs from the rootBlockId; `documents resolve-link <url>` converts it. `--fetchMetadata` adds `createdAt`, `lastModifiedAt`, `createdBy`, `lastModifiedBy`, and a `clickableLink` in `craftdocs://open?spaceId=…&blockId=…` form. `connection info` returns the space id, space timezone, requester timezone, current time, and `urlTemplates.app` |
| Tasks | `tasks list` scopes are `active`, `upcoming`, `inbox`, `logbook`, `document`, `all`. `active` and `upcoming` compare "task date (schedule, otherwise deadline)" with today; `all` lists every task block and is full-space only. Output shows a checkbox, block id, text, schedule, and location. The write help uses `--state todo|done|canceled`, while the REST reference names states `active`, `done`, `cancelled` |
| Revert and stamps | `blocks_revert` takes per-block `expectedStamps` and reverts only if the blocks are unchanged since the mutation. Verified: every `craft_write` update returns `revertInfo` carrying the original block and a new `expectedStamps` value, and the second update's `before.stamp` equaled the first update's returned stamp, so the stamp is a continuous per-block version rather than a one-time token. The 2026-10-09 check settled the open question: there is no conditional update on this surface (see below) |
| Tag write | `blocks update --id <blockId> --markdown "#tag #gpk/test"` succeeded. Read-back returned the same markdown, and the editor rendered both `#tag` and `#gpk/test` as tag chips. A second update appending `#gpk/status/test` rendered as a third chip, listed in the Tags view under `gpk` as child `status/test`. The write response listed the block with `text.attributes: []`, so tag identity is derived from the text, not stored as a span |
| Write response | The response exposes the raw stored block (`content`, `stamp`, `rawProperties`, `style` with `listStyle`, `textStyle`, `indentationLevel`, `decorations`, epoch `created`/`updated`), the normalized result (`text.value`, `text.attributes`, `markdown`), neighboring blocks for context with typed spans such as `bold` and `blockLink` (`start`, `end`, `blockId`), and a web link of the form `https://docs.craft.do/editor/d/<spaceId>/<documentId>/x/<blockId>` |
| Search latency | Immediately after the write, a global `search --regexp` for the new text returned nothing; the same query matched about ten seconds later. `blocks get` reflected the write at once |
| Block model | Matches the REST reference: `type`, `textStyle`, `listStyle`, `markdown`, nested `content`; `block://` and `date://` links inside markdown |

## Inline formatting and field preservation (2026-10-09)

Observed through the Craft MCP connector in Claude Code on one personal space.
Part one was read-only: one existing text block carrying a gradient highlight
applied from the editor's color toolbar was located with `search` and read with
`blocks get --depth 0` in both output modes. Part two used a scratch document
created for the test, two blocks added with `--json`, five `blocks update`
calls and `documents delete` to trash it afterwards. Identifiers and content of
the user's own material are deliberately omitted.

| Item | Observed |
|---|---|
| Markdown output | A highlighted block reads as `<highlight color="gradient-red">…</highlight>`. The tag is Craft's own extension, not CommonMark; `==…==` is documented only as the yellow shorthand and is normalized to the tag form on write |
| JSON output | `blocks get --format json` returns `id`, `type`, `markdown` plus block-level fields when present (`listStyle`, `indentationLevel`, `color`, `taskInfo`). No separate inline attribute array accompanies a read; the markdown string is the only carrier of inline formatting on the read surface. Write responses additionally expose `text.attributes` spans and the raw stored `style` |
| Color vocabulary | The editor's solid and gradient swatches map to the documented `color` names (`yellow`, `green`, `mint`, `cyan`, `blue`, `purple`, `pink`, `red`, `gray`, `gradient-*`). Text color and background highlight are not distinguished by the tag; rendering is client-side |
| Markdown-only update preserves block fields | `blocks update --id <blockId> --markdown "<body text>"` on a task block with `indentationLevel: 1`, `color` and `taskInfo.state: todo`, and on a bullet block with `indentationLevel: 2` and `color`, changed only the text. `listStyle`, `indentationLevel`, `color`, `taskInfo` and the inline `highlight`/`bold` spans outside the edited range were unchanged in the response and on read-back. Updates are merge-style, as the help text states for styling flags |
| Read form is not a safe write form | `blocks get` renders list blocks with their marker and indentation (`  - [ ] …`, `    - …`). Feeding that rendered string back through `--markdown` reparsed the leading spaces and marker: the bullet block kept `listStyle` but lost `indentationLevel` (2 → 0). Updating with the body text alone, without marker or indentation, preserved everything. Strip the marker and indentation prefix before writing, or update structure through JSON fields |
| JSON partial update | `blocks update --json '{"id": …, "indentationLevel": 2}'` restored the indentation without touching text, color or inline spans. Field-only updates and markdown-only updates compose |
| No conditional update | A JSON update carrying an extra `expectedStamp` field was rejected by schema validation (`Invalid JSON update payload at "root"`). Every update returns a new per-block `stamp` in `revertInfo.expectedStamps`, but no field makes an update conditional on the previous stamp. The available guard remains read, write, read back and compare, plus `blocks_revert` with `expectedStamps` for rollback |
| Input normalization | `color` hex values are snapped to Craft's palette (`#FF8800` stored as `#E27300`, `#0066CC` as `#0762C2`). A `taskInfo.scheduledDate` supplied on `blocks add --json` did not appear in the stored block; task dates need the `tasks` commands or a separate check |
| Round-trip scope | A block's body markdown read and written back verbatim preserves inline formatting, and the block's structural fields survive because the markdown update does not touch them. This is a per-block claim: rewriting a page from its rendered markdown regenerates block IDs and drops stamps, comments, collections and whiteboards |

Implications for the adapter:

- Treat `content` as Craft's markdown dialect and pass it through unchanged. Any
  CommonMark normalization or HTML sanitizing step strips `<highlight>` and the
  `block://` link form; the adapter must not apply one.
- Implement `TextEdit` as: read the block JSON, locate the block whose body
  contains the match, rewrite that block's body text with `--markdown`, read
  back. Never send the rendered list prefix. A match that crosses block
  boundaries is a `conflict` on this surface unless a contiguous-range update
  is implemented separately.
- A `TextEdit` whose match lies inside a highlighted span leaves the surrounding
  tag in place. A match that crosses a tag boundary includes the tag text in
  `before`, so the caller sees and decides about the formatting it touches.
- Revision checking is read-back comparison, not compare-and-swap. Report
  `expected` support as emulated with that limit. Stamps and `blocks_revert`
  are visible only through the host widget surface (see the 2026-10-10 check),
  so GPK's own client cannot use them at all.
- Cross-backend migration remains lossy by design: `gradient-red` has no
  equivalent in Obsidian's `==…==` or Notion's color set. Report it through
  `Result.limits` on the migration operation, not as a read/write limitation.

## Command surface as verified (2026-10-12)

Sources: the `--help` of every `craft_read`/`craft_write` subcommand, the REST
references at `connect.craft.do/api-docs`, and probes in a scratch folder of a
test workspace. Where the documentation and the service disagree, the service
wins and the row says so.

| Behavior | Documented | Observed |
|---|---|---|
| `documents list --folder` | MCP help and REST: "includes subfolders recursively" | **Not recursive.** A parent folder whose documents all sit in a subfolder lists none (checked twice). Enumerate the folder tree and list each folder |
| `blocks get` children | 50 direct children per page; cursor in a `Next page:` line (markdown) or `nextCursor` (JSON) | Holds. In JSON the cursor is a **top-level** `nextCursor` beside `data`, not on the block. Without following it, a page with more than 50 top-level blocks is silently cut at 50 |
| Collection items through `blocks get --id <collection> --depth 1` | not stated | All items in one response (2,001 rows, no cursor) |
| `collections items-get` | `--page-size` up to 200 | Returns 100 per page even with `--page-size 200` |
| `search` | REST `/documents/search`: top 20 by relevance; MCP: `--cursor` | MCP returned all 25 matches in one response, no cursor. New content is indexed with a delay: 5 of 25 fresh documents after a few seconds, 25 after about five minutes. Link targets are not indexed |
| `search --folder` | includes subfolders | Holds (unlike `documents list --folder`) |
| `search --document` with `--folder`/`--location` | mutually exclusive | Not combined by GPK |
| `documents create --documents '<array>'` | batch create | Works; the receipt is a count ("Created 25 documents") with no IDs, so IDs come from a listing |
| `tasks list` scopes | `active` = open with date up to today, `upcoming` = open from tomorrow, `inbox`, `logbook`, `document`, `all` (every task block, all states) | `all` pages 1,000 per call and includes every completed task |
| Batched commands (`a; b; c` in one call) | not stated | Count as one request: 40 calls carrying 200 commands in 36 s drew no 429 |
| Rate limits | REST: 50 requests / 10 s per IP (shared with MCP), 100 requests / 60 s per space, 20,000 blocks / 60 s per space; 429 with `Retry-After` | Bursts of single calls hit 429 earlier (2026-10-10); batching keeps well inside |
| Conditional writes, change feeds | none (no ETag, no webhooks, no modified-since on blocks) | Confirms `expected` must stay a read-back comparison |
| `blocks update --json` | object or array, each with its own `id`; one call for many updates | Not yet used by GPK for text edits |
| `blocks move --ids` | bulk move | Not yet used by GPK for reordering |
| Rows and moves | items "must remain within their collection" | A row cannot be moved out; its children can (IDs kept) |
| Templates | MCP "cannot currently instantiate a new document from an existing template" | No item templates for Collections either |
| Task extras | `--deadline`, `--repeat` (daily, weekly:mon,…, flexible) | Not used; the domain keeps fixed deadlines in content and treats recurrence as optional |

## Task, capture and Collection mechanics (2026-10-09)

Observed through the Craft MCP connector in Claude Code on one personal space,
in a scratch document created for the test and trashed afterwards. The user's
Inbox was read, not written. Identifiers of user material are omitted.

| Question | Observed |
|---|---|
| Task identity | `tasks list` IDs are block IDs. `blocks get --id <taskId>` works directly. A task block reads as `type: "page"`, `textStyle: "page"`, `listStyle: "task"` with `taskInfo` |
| Task children | `blocks add --id <taskId> --markdown …` appends child blocks under the task; `blocks get --depth ≥ 1` on the Project root returns tasks with their children. A task is a nested page, so descriptions and results live under the action line |
| Completion keeps the block in place | `tasks update --task <id> --state done` set `taskInfo.state: done` with `completedAt`; the block stayed at its position in the document with its children. "Auto-moves to logbook" is a view, not a block move. `tasks list --scope logbook` listed only Inbox-origin tasks and not the just-completed document task; do not rely on logbook for document Task inventory |
| Insert position | `tasks add --location document` inserted each new task at the **start** of the document, ahead of earlier tasks and existing blocks. Plan order must be set explicitly after creation; creation order is not plan order |
| Rename replaces the whole line | `tasks update --markdown "new text"` replaced the action line and dropped the inline `#gpk/task/waiting` tag that was on it; children were preserved. A line-end state tag must be re-emitted on every title change |
| Tag visibility in task listing | An inline tag on the action line appears verbatim in `tasks list` output, so a line-end state marker is recoverable from one listing call without reading children |
| Planned time: key name | The stored field is `taskInfo.scheduleDate` (not `scheduledDate`). `blocks update --json '{"id": …, "taskInfo": {"scheduleDate": "YYYY-MM-DD"}}'` sets it; `tasks update --schedule YYYY-MM-DD` also works and changes only provided fields |
| Planned time: clearing | `tasks update --schedule ""` returned success but left the date unchanged. `blocks update --json '{"id": …, "taskInfo": {"scheduleDate": null}}'` cleared it. Use the JSON form for `tasks.schedule(ref, null)` |
| Multi-paragraph update | `blocks update --id … --markdown` with a blank line updated the target block with the first paragraph and inserted the second as a new sibling block with a new ID. A `TextEdit.after` containing paragraph breaks therefore creates blocks; the receipt must list every affected ID |
| Moving blocks under a task | `blocks move --id <block> --targetId <taskId>` moved a text block from the document body into the task's child content. The same path can attach a captured attachment to the Task that clarifies it |
| Inbox surface | `documents list` has no `inbox` location; the Inbox is a tasks-only surface reached through `tasks list --scope inbox`. Inbox entries are task blocks (pages) addressable by ID. Non-task captures are not an Inbox concept on this surface; Daily Notes and Unsorted hold them |
| Connection metadata | `connection info` returned space ID, space timezone, current time and the app URL template on MCP v2. `Ref.scope` can use the space ID; `Ref.id` is the rootBlockId or block ID, never the URL documentId |
| Collection schema creation | `collections create --name … --title … --Status "select:planned,active,paused,completed,canceled" --document <root>` created a Collection with a typed single-select column and returned its block ID. `collections schema` reports keys, types and option names/colors |
| Collection item as Project page | `collections items-add --Project "…" --Status active` created an item. `blocks add --id <itemId>` added body blocks (heading and paragraph); `blocks get --id <itemId> --depth 1` returned `type: "collectionItem"`, typed `properties`, and the body `content`; `blocks update --id <bodyBlock> --markdown` edited the body. `collections items-update --Status paused` changed the property without touching the body. `collections items-get --format markdown` returns `properties` plus `contentMarkdown` per item |
| Collection enumeration | `collections items-get` pages 50 to 200 items and has no property filter. A state query over a Collection is an in-memory filter over one bounded enumeration, declared emulated with complete coverage once every page is read |

Implications for the mapping:

- A Task is a page block whose action line is the title and whose children are
  the description and result. `TaskRef.id` is the task's block ID in both
  `tasks` and `blocks` commands.
- The Task's primary Project is the document that contains it; a standalone
  Task lives in a Daily Note; the Inbox is a capture surface read through
  `tasks list --scope inbox` and cleared by moving entries with
  `tasks update --location`.
- Completing a Task does not move it, so plan order survives completion.
  Creation prepends, so `orderTasks` or an explicit `--siblingId` insert is
  needed to place a new Task in plan order.
- `tasks.schedule` writes `taskInfo.scheduleDate` through the JSON update and
  clears with `null`; the `tasks update --schedule` flag cannot clear.
- Project and Area state can be a Collection single-select column read from
  `properties`, with primary Area as a relation column. Body content of an item
  is ordinary block content under the same read and edit rules as a document.

## Headless OAuth and plain-client response shapes (2026-10-10)

A Node script using `@modelcontextprotocol/client` 2.3.1 with an
`OAuthClientProvider` connected to `https://mcp.craft.do/my/mcp` from outside
any Agent host. Tokens and client registration were kept in a session scratch
file and deleted afterwards; the dynamically registered client remains listed
on Craft's side until removed there.

| Item | Observed |
|---|---|
| Discovery | An unauthenticated `POST /my/mcp` returns 401 with `WWW-Authenticate: Bearer … resource_metadata="https://mcp.craft.do/.well-known/oauth-protected-resource/my/mcp"`. That document names the authorization server `https://mcp.craft.do/my/auth`, whose metadata is served at both `…/my/auth/.well-known/oauth-authorization-server` and `…/.well-known/oauth-authorization-server/my/auth` |
| Authorization server | `authorization_code` and `refresh_token` grants, PKCE `S256`, `response_mode: query`, token endpoint auth `client_secret_post`, `client_secret_basic` and `none`, a `registration_endpoint` and a `revocation_endpoint` |
| Dynamic client registration | The SDK registered a public client (`token_endpoint_auth_method: none`, loopback redirect `http://127.0.0.1:<port>/callback`) and received a `client_id`; later runs reused it without re-registering |
| Authorization | The SDK produced the authorization URL with PKCE and `resource=https://mcp.craft.do/my/mcp`; the user approved in a browser; the loopback callback delivered the code; `transport.finishAuth(params)` exchanged it. The SDK warned that the provider did not implement `discoveryState()` (SEP-2352); a real adapter must persist it alongside the code verifier |
| Tokens | `token_type: bearer`, `expires_in: 3600`, a JWT access token and a refresh token. A second process start reused the stored tokens and connected without any browser interaction |
| Refresh | `refreshAuthorization(issuer, { metadata, clientInformation, refreshToken, resource })` returned a new access token **and a new refresh token**; the previous refresh token is replaced. Persist the new pair atomically before discarding the old one. Passing the issuer without `metadata` posts to the wrong path |
| Revocation | `POST /my/auth/revoke` with `token_type_hint=refresh_token` returned 200; with the access token it returned 400. The already-issued access token kept working after the refresh token was revoked, so revocation takes effect within the access token lifetime (up to one hour), not immediately |
| Tool surface | Same three tools as the host connector: `craft_read`, `craft_write`, `blocks_revert`. `craft_write` carries `_meta.ui.resourceUri: ui://craft/edit-review` and `openai/outputTemplate`; `blocks_revert` carries `ui/visibility: ["app"]` |
| Write responses to a plain client | `craft_write` returns one `text` content item with a summary such as `Added 1 block.\nIDs: <blockId>` or `Updated block <blockId>.` No JSON diff, no `revertInfo`, no stamps, no `structuredContent`, no `_meta`. The JSON seen through the host connector is the widget resource rendered by the host. Declaring UI extension capabilities on the client (`extensions["io.modelcontextprotocol/ui"]`, legacy `ui`, `openai/widget`) did not change the response |
| Stamps on read | `blocks get --format json --fetchMetadata` returns `id`, `type`, `markdown` and `metadata` with `lastModifiedAt`, `createdAt`, `lastModifiedBy`, `createdBy`, `clickableLink`. No stamp field is exposed on any read |
| Write behavior is unchanged | The headless round trip reproduced the 2026-10-09 result: a task block added with `--json` carrying `listStyle`, `indentationLevel`, `color`, `taskInfo.scheduleDate` and a gradient highlight, then updated with `--markdown` body text only, read back with every field and the highlight intact |
| Transient failures | One `documents delete` call received a Cloudflare 502; the retry succeeded. Treat 5xx as `unavailable` with the write's effect unknown until read back |

Implications for the adapter:

- A GPK subprocess can authenticate to Craft on its own: discovery, dynamic
  registration, PKCE, loopback callback, token persistence and refresh all work
  with the pinned SDK. Setup needs one browser approval per instance; later
  starts are non-interactive. The same client code serves a remote deployment
  with an HTTPS redirect URI, since the server accepts dynamic registration.
- Stale-write detection through stamps is **not available** to GPK's own client.
  `WriteGuard.expected` on Craft is emulated from the read-time `lastModifiedAt`
  plus the block's read-time markdown: re-read immediately before the write,
  compare, write, read back. Declare the second-granularity window as a limit.
  `blocks_revert` is a widget facility; do not design recovery around it.
- Refresh-token rotation and delayed revocation shape the credential store:
  write the new token pair before acknowledging a refresh, and treat a
  revoked instance as live for up to one hour unless the access token is also
  rejected by the server.
- Write responses must be parsed from the text summary for the new block IDs
  (`IDs: <…>`); every effect is then verified by `blocks get`, which is already
  the contract's rule.

## First slice live run (2026-10-10)

The packaged runtime (`dist/marketplace/claude/gpk/mcp/stdio.mjs`) was driven by a
standalone MCP client over stdio against the user's real space, with a hand-written
`~/.gpk/settings.json` and `grants.json`. Tokens were obtained through the runtime's
own `gpk_connection_authorize` flow and stored in the macOS keychain; a second
process reused them without a browser. The probe Tasks were deleted afterwards.

| Step | Observed |
|---|---|
| `tasks list --scope all` pagination | Pages of 1000 tasks with a trailing `Next page: tasks list --scope all --cursor <token>` line. A space with more than 1000 tasks hides new Tasks from the first page; the adapter now follows the cursor (capped at 25 pages) and reports partial coverage past the cap |
| Container lookup | A Task created in a Daily Note is confirmed cheaply by `blocks get --date` plus `tasks list --scope document --document <root>`; the full-space scan is the fallback only |
| A1 flow | `gpk_tasks_create` in today's Daily Note with body and planned date; `gpk_tasks_read`; `gpk_tasks_schedule` with the read version; a stale `expected` returned `conflict`; `gpk_tasks_update` body edit; `gpk_tasks_transition` to `waiting` then `done` with reasons appended as child blocks; final read showed state `done`, the edited body and both reasons; `gpk_tasks_query` by state and date found the Task across two listing pages |
| Inbox | `gpk_captures_resolve` and `gpk_captures_list` returned the user's Inbox entry as an action line |
| Installed Claude Code run | With `claude --plugin-dir`, the user asked to organize the Inbox. The Agent routed to `gpk-ingest`, read the invocation guide, called runtime status, connection status, capabilities, `gpk_captures_resolve`, `gpk_captures_list` and `gpk_captures_read`, then asked the user to clarify the reminder before creating a Task. Routing, tool discovery, keychain token reuse and the read path work inside the host |
| Rate limit | The Agent's duplicate check paged `gpk_tasks_query` with `text` at `limit: 100`; the first implementation filtered text after reading every candidate block, so one page cost 100 block reads and Craft answered **429**. Fixed the same day: `text` now filters the listing's action lines before any block read (declared `degraded`, bodies not searched), unreadable items are omitted with partial coverage instead of failing the query, and the connection backs off 1s/2s/4s on 429 |
| Batched reads | Several `blocks get` commands joined with `; ` in one `craft_read` call return their JSON results separated by a blank line. The query now reads one page of Tasks in one call; a text query over a space with more than 1000 tasks dropped from about 22 s to 16 s and a state query from 20 s to 11 s. The remaining cost is the paginated full-space listing itself |
| Setup live run (2026-10-11) | `gpk_setup_establish` with the default plan created the `GPK` namespace folder and host document, the Areas Collection, then failed `partial` on the Projects Collection because the schema parser did not recognize the relation line `area → "Area" (relation) — target collection: <id>` (the first run through a fake connection had no such line). After the fix, a rerun adopting the four created structures by ID finished: three subfolders under `GPK`, Projects views Board / By Area / Active, Areas view Board, five `GPK …` templates in the Templates area, Settings layout updated. A further rerun with every structure adopted created nothing. `gpk_setup_propose_grants` returned seven grants with the real Collection and folder IDs; `gpk_grants_grant` persisted them and `gpk_grants_revoke` removed the earlier hand-written duplicate |
| Listing formats learned | `collections views-list` rows are `  <Name> <viewId> - <type>[, active]`; `documents list --location templates` rows are `  <rootBlockId> Title`; `folders list` indents children two spaces per level and later pages repeat ancestor rows |
| Not covered | Codex has not run the slice; Project-owned Tasks and every entity other than Tasks remain unimplemented |

## Project slice live run (2026-10-11)

The packaged runtime was driven over stdio against the real `GPK` namespace
(the Setup of the same day), through the MCP tools with the persisted grants.
Every probe row and Task was deleted afterwards (`collections items-delete`,
`blocks delete`); the Collections are empty again.

| Step | Observed |
|---|---|
| Rows | `gpk_areas_create` and `gpk_projects_create` (Status, Area relation, body) verified on read-back; `collections items-add` answers with the new row ID, which the adapter takes as the first block ID in the receipt that is not the Collection's. The row block type is `collectionItem`; `blocks get` on the row returns `properties` plus `content` |
| Project-owned Tasks | Two `gpk_tasks_create` calls with `project` inserted after the Plan heading and then after the previous Task; `gpk_tasks_read` reported the Project; `gpk_tasks_query` with `project` returned them in block order without a space-wide listing (about 1.2 s); `gpk_projects_order_tasks` reversed them and the next create followed the new last Task |
| Materials | A `child-document` material became a nested page listed by `gpk_materials_list`, read with its body, and edited with `expected`; an `inline` material became a heading plus paragraph in the row body |
| Ownership moves | A Daily Note Task moved into the row with `blocks move --targetId <row> --position end` and back out with `--targetDate <today>`; both verified through container re-resolution. The second move needed `tasks.assignProject` on the `daily-notes` grant, which the default set now includes |
| Closure | `gpk_projects_transition` to `completed` returned `conflict` naming the two open Tasks; after both were `done`, rename plus body edit and the closure succeeded, and the final read showed state, title, primary Area and the dated reason |
| Timing | Row and Task writes 1–3 s each including read-back; `assignProject` 4–6 s (move, reason, re-resolution); a `project: null` query still pays the paginated full-space listing (about 17 s in a space with more than 1000 tasks) |
| Secret keys per control root | Two control roots on one machine shared the keychain entry `gpk:craft:craft`, so authorizing a second space would have replaced the first space's tokens. Before Settings exist, a non-default root now derives its key from the root path digest; Settings record the key Setup used |
| Fresh space (2026-10-11) | A newly created, empty workspace was onboarded with `GPK_CONTROL_ROOT=~/.gpk-fresh`: `gpk_connection_authorize` (the first browser approval ended without tokens and the failure was swallowed; `gpk_connection_status` now reports `authorizationError`, and the second approval verified), `gpk_setup_establish` with the default plan created the namespace folder, host document, both Collections, three subfolders, four views and five templates in one run, seven grants were proposed and persisted, and the A1 and Project flows above passed unchanged against it. The default plan therefore works on an empty space without any adoption |
| Knowledge slice (2026-10-11) | In the fresh space: `gpk_sources_create` (origin line, Summary heading, body) verified on read-back and `documents list --folder` listed it; `gpk_sources_update` edited one paragraph with `expected`; `gpk_wikis_create` and `gpk_outputs_create` likewise. Four `gpk_links_add` calls (Wiki→Source, Wiki→Output, Project→Wiki, Task→Output) wrote `- [title](block://id) — context` bullets; the Wiki got one `## Links` heading with both bullets under it, the Task got a child block; a repeated link returned `conflict`. `gpk_links_query` on the Source found the incoming Wiki link, on the Output the Task and Wiki links; `relatedTo` on Sources and Projects filtered by those links. `gpk_checkpoints_read` returned null, the first save created the `GPK System` page and the key page, the read returned the two-paragraph content, and a save with `expected` replaced it. Timings: document writes 3–7 s, link adds 7–12 s (record inventory plus read-back), link discovery and `relatedTo` queries 5–8 s on a space with a dozen records; the inventory listings dominate |
| Craft 500s | During this run `craft_write` answered 500 once on a body append and four times in a row on `documents delete`; each call succeeded when repeated a few seconds later. The adapter reported the append as `partial` naming the bodiless document, which is the intended shape. The connection now repeats a read once after a 500; writes are left to the caller because their effect is unknown |
| Review (2026-10-11) | `gpk_review_inventory` (weekly) over the fresh space took about 12 s, dominated by the space-wide task listing for standalone Tasks; it reported one overdue Project-owned Task, one `no-next-action` Project, one `overdue` Project, the Area's Project counts, complete coverage and the gap that eight task blocks in Craft's sample documents were outside GPK's locations. A weekly conclusion was appended under the Project's Results & Review with a multi-paragraph `gpk_projects_update` edit (a paragraph break inserts a sibling block in a row body too), the overdue Task was rescheduled, the stalled Project paused with a reason, and the second inventory showed no overdue Task and no signal |
| Review fixes (2026-10-11) | Three defects from the code review, each verified in the fresh space after the fix. (1) The connection repeated any failed call once after reconnecting, so a write answered with 500 ran twice whenever Craft had in fact applied it; writes are now repeated only after 401/403/404, when the server provably did not run them. (2) Row operations accepted any `collectionItem`, so the Projects grant could edit Areas rows or rows of the user's own Collections, and material updates accepted any page; rows are now checked against the configured Collection's items and materials against their Project row's children (an Areas row passed as a Project and a Wiki page passed as a material both returned `not-found`). (3) JSON arguments stripped apostrophes; they are now escaped as `\u0027`, which Craft decodes (a material titled "Owner's notes" read back intact). Semicolons inside quoted arguments are stored literally, so body text cannot split into a second command |
| Top-level layout (2026-10-11) | The fresh workspace was moved from the `GPK` namespace folder to the top level with `folders move --parent root` and `documents move --destination unsorted`; block IDs did not change, so Settings and grants stayed valid and Setup inspect reported every location `ok` |
| Collection scale, search and item templates (2026-10-12) | A probe Collection in the GPK workspace took 2001 rows (`collections items-add --items` with 100 rows per call, about 5 s per call). Over one persistent connection: a plain call costs 0.4 to 0.7 s; one row with its children 0.5 to 0.8 s; the whole Collection with `blocks get --id <collection> --format json --depth 1` 1.6 to 4.1 s for 2001 rows and 320 KB in a single response, with no cursor; `collections items-get` pages at 100 items regardless of `--page-size 200`, so paging is slower than the single read. No server-side filter exists. `search` (0.4 to 1.5 s) found row titles and row body text immediately, attributed to the host document with the matching block ID; it matched a link line by the link's visible title but never by the target's block ID (plain or `--regexp`), so link targets are not indexed. `--document`/`--folder` scope a search and `--fetch-blocks` returns the matching blocks. Neither the API nor Craft's Collections help documents an item template: a new row page is empty until something writes its body. Craft's help recommends keeping a Collection under about 1,000 rows for app performance |
| Not covered | Codex has not run the slices; archive, restore and remove remain unimplemented |

## State representation and query mapping (2026-09-22)

The current MCP `--help` surface was inspected read-only. These observations are
about exposed commands, not a claim that GPK's query implementation exists.

| Command | Exposed query controls | Not established |
|---|---|---|
| `search` | Raw-text `--include`, RE2 `--regexp`, document/location/folder/date scope, cursor and fetched blocks | No native tag filter or tag vocabulary enumeration; no exhaustive domain inventory guarantee |
| `documents list` | Folder (including subfolders), location/date bounds, metadata and cursor | No Project-state or tag predicate; nested entity-page coverage still requires the placement convention and block traversal |
| `tasks list` | Native scopes such as active/upcoming/document/all | `active` means open and due by task date, not active Project; `all` is full-space only, not an extra permission grant |

Superseded for Projects and Areas by the Collection decision above; the
following tag observations now apply only to the Task `doing`/`waiting` marker.
Use `#gpk/task/<state>` and preserve the whole spelling across backends. Craft's
documented hierarchy splits only at the first slash: `gpk` is the parent and
`task/waiting` the child label, **not three-level hierarchy**. Do not assume
recursive prefix or parent-tag filtering.
See [Craft Tags](https://support.craft.do/en/organize-and-find/tags).

Read state from the selected owned property/marker location, not any mention of
its tag in prose, code, research or examples. Validate the kind and exact state;
conflicting/multiple values are ambiguous, not permission to guess. Existing plain
Status conventions can remain readable under an explicit legacy mapping until
authorized migration; do not silently add another representation. Native Task
terminal state takes precedence over a stale doing/waiting marker for read-only
interpretation; report the mismatch, and repair only with authorization. Other
contradictory encodings need clarification. Setup must verify tag rendering/settings
before promising tag-chip navigation; literal text alone is not evidence of it.

The domain query remains `projects.query({ states: ["active"] })`. With the
Collection decision, the first route below is the selected one and its
population is the Collection itself; the other two rows are retained as the
evidence that ruled out tag-based state for Projects and Areas:

| Route | Intended composition | Capability and coverage |
|---|---|---|
| Collection enumeration (selected) | Page `collections items-get` for the Projects Collection; read `properties.status` and the Area relation; filter in request memory | Emulated, complete once every page is read; typed values, no prose parsing. Verified read/write on 2026-10-09 |
| Scoped enumeration of documents | Resolve the authorized entity population; page document listings and relevant nested blocks; read current owned state; filter in request memory | Not selected for Projects/Areas; remains the model for Source/Wiki/Output discovery by layout location |
| Text-search candidates | Search the known state spelling, page candidates, resolve owning entities, deduplicate and read current state before filtering | Degraded without additional completeness evidence. Fresh reads reject false positives but do not recover unindexed/missed documents; report partial/unknown coverage |
| Native tag filtering | No matching parameter in this observed MCP surface | Unsupported; a clickable tag in the editor does not change this |

The enumeration route must account for entities outside a presumed folder and
native child pages according to the selected placement convention. Never broaden
access without authorization. If the requested population cannot be bounded or
fully reached, disclose that rather than treating the visible subset as complete.
Budget exhaustion, unreadable content, invalid cursors and concurrent changes also
limit coverage. Restart an invalid cursor only within the operation's bounds; no
atomic scan guarantee is established. Neither route persists an adapter-owned
index or state cache, changes status, or repairs user content as a side effect.

Both composed routes are **designs awaiting implementation and acceptance**.
A limited shortlist may help Focus; exhaustive reviews, absence claims and Project
closure need sufficient coverage. An empty search result cannot prove that no
active Projects exist. The [storage contract](../storage-contracts.md#state-representation-and-query-guarantees)
defines predicate handling and result envelopes.

## Operation requirements to validate

This table describes intended requirements, the documented primitive that could
satisfy each, and what a live check still has to establish. It is not a record
of completed capability tests.

| Operation | Required behavior | Documented primitive | Still to verify |
|---|---|---|---|
| Read and search | Inspect current backend records and actual connection scope | `GET /blocks`, `GET /documents`, `GET /documents/search`, `GET /connection` | Observed MCP: raw-text search for tag spelling, not tag filtering; cursor pagination. Remaining: composed state queries, population coverage and separately configured REST behavior |
| Create | Represent the applicable 0.4 entity and its meaningful relationships | `POST /documents`, `POST /blocks` with markdown or JSON, `POST /tasks` | Checkbox, heading, nested page, and link fidelity when rendered from a personalized template |
| Update | Preserve document identity and unrelated user content | `PUT /blocks` updates only the supplied fields; `PUT /tasks` | The path for updating a document title through its root block; that a partial update leaves sibling blocks untouched |
| Move | Prefer native moves that retain links and backlinks | `PUT /blocks/move`, `PUT /documents/move`, `PUT /folders/move` | That block and document IDs and `block://` references survive move and rename |
| Project process documents | Use native child pages/cards when exposed; declare unsupported operations or fallbacks | Page and card blocks with nested `content`, addressable by block ID | Nesting depth limits and reading nested pages through `maxDepth` |
| Plan and Focus | Preserve planned versus active semantics; do not assume native task lists implement GPK Focus | `GET /tasks?scope=active` means due before now and not done, regardless of the owning document | Reading the owning Project's state and filtering before recommending; nothing native encodes Project state |
| Bulk migration | Record a mapping, use reversible steps, and verify counts and samples | Soft delete to trash for documents; `GET /folders` document counts | Reversibility of `DELETE /blocks`; no batch or transaction endpoint is documented |
| Delete | Explicitly selected content, current child/reference inspection and effect/recovery verification; migration cleanup additionally requires migration verification | `DELETE /documents` to trash; `DELETE /tasks` for Inbox, Logbook, and daily notes; `DELETE /blocks` elsewhere | Whether deleted blocks are recoverable; inbound references must be found by searching for the `block://<id>` string because backlinks are not exposed |

## Evidence against the technical design's open decisions

The [storage contract](../storage-contracts.md) defines the capability
boundaries that require evidence before the affected operation is enabled. The
documentation review settles which primitives exist; no row is closed until a
read-write round trip is recorded.

| Decision | Documented basis | Assessment |
|---|---|---|
| Identity encoding | Document ID equals root block ID; every block has an ID; `block://` links; `GET /connection` deep-link templates. Verified: app and web link documentIds differ from rootBlockIds and must be resolved; the write response shows the block's internal `documentId` alongside its id; per-block `clickableLink` metadata is available | Stable references are available. Persistence across rename and move is undocumented and untested |
| State encoding | Task state is only `active`, `done`, `cancelled` in the REST reference. Inline tags have no dedicated API parameter or field; Collections have select properties | **Settled 2026-10-10:** Project and Area state are Collection single-select columns and the primary Area is a relation column (creation, typed read, property update and body editing verified 2026-10-09). Task state is the native checkbox plus a line-end `#gpk/task/doing` or `#gpk/task/waiting` tag. Migration of pre-existing plain documents into the Collections is a Setup/Ingest task with user authorization |
| One Task time | `scheduledDate` plus a separate `deadline` and `completedAt` | Good fit: GPK's adjustable time maps to `scheduledDate`; a fixed external constraint can use `deadline` |
| Native configuration/template discovery (historical alternative, not selected) | `GET /documents/search` with `include`, `regexps`, `folderIds`, `location`; native `templates` location | Historical feasibility observation: markers and native template IDs can be searched, with connection-specific coverage limits. GPK now selects local-file User Control instead; these primitives do not establish a Craft control adapter |
| Concurrency and recovery | No revision, version, or ETag in the REST reference. `fetchMetadata` exposes `lastModifiedAt`. Through the host connector, every write returns a per-block `stamp` in `revertInfo.expectedStamps`; through GPK's own client (2026-10-10) neither stamps nor `revertInfo` are returned | **Settled:** no conditional update and no stamps for a plain client. `expected` is emulated from read-time `lastModifiedAt` plus body text, re-read immediately before writing, then read back; this is the weaker path described in [Mutation, verification and recovery](../workflow-design.md#6-mutation-verification-and-recovery). `blocks_revert` is a widget facility and is not part of the adapter |
| Template rendering | `POST /blocks` accepts markdown with page markup and JSON blocks with `listStyle: task`; positional insert and `PUT /blocks/move` | Checkbox, order, link, and child-document primitives all exist; rendering fidelity is unverified |
| Periodic runner | Craft exposes no scheduler or webhook for this purpose | Remains a harness-side decision, as the design already states |

## Constraints to carry into the design

- REST search documents a 20-result cap without pagination; the MCP connector
  paginates by cursor and returned more than 20 matches in one call. Focus
  candidate sets should still combine task scopes with block traversal, and
  every search-based check must declare its actual coverage.
- Native `active` ignores the owning document. GPK's parent-state rule has to be
  applied by reading the Project document after retrieving tasks.
- Deletion splits by location: documents soft-delete to trash; Inbox, Logbook,
  and daily-note tasks go through `DELETE /tasks`; tasks inside documents go
  through `DELETE /blocks`. Declare reversibility per path.
- Backlinks are not exposed. The pre-deletion inbound-link check can search for
  the `block://<id>` string. The REST `GET /documents/search` fallback has the
  documented 20-result cap; the observed MCP search supports cursors. Neither
  route proves complete inbound-reference coverage merely by exhausting results.
- Inline tags are enabled per space and per member. Through the connector they
  are plain text, so a reserved-namespace regex must be anchored to avoid `#`
  in code, hex colors, or headings typed as text. Setup must check the space
  setting before relying on tags for state.
- Retrieval by tag is full-text search for the tag string, space-wide by
  default and combinable with folder, location, document, and date bounds.
  It is not a tag index: there is no tag enumeration, matches are text, the
  index can lag writes, and exhausting its cursors proves only that the candidate
  search ended. Fresh reads validate matches, not omissions; complete state-query
  coverage requires the scoped enumeration evidence described above.
- Tag hierarchy is one level, split at the first `/`. A deeper string such as
  `#gpk/project/active` is still one valid chip, grouped under `gpk` with
  `project/active` as the child label. Prefer this kind/state spelling, but match
  exact owned state content rather than assuming three-level tag queries.
- Task state vocabulary differs by surface: `todo` / `done` / `canceled` in the
  connector's write commands, `active` / `done` / `cancelled` in the REST
  reference. The adapter must normalize to GPK's Task states.
- Craft app and web link documentIds are not rootBlockIds. Resolve links before
  reading or writing by ID.
- Search indexing lags writes by seconds. Verify a write by reading the block
  back, never by searching for it.
- Recurring tasks exist in the UI, but no repeat field is documented on the Task
  object. Recurrence stays `unsupported`, as the specification already allows.
- `GET /connection`, `POST /upload`, and `POST /comments` are experimental.
  Setup must not hard-depend on `GET /connection` for the timezone.
- `craftdocs://open?spaceId=…&blockId=…` deep links work only on macOS, iOS, and
  iPadOS and only for space editors. Keep `block://` as the primary in-space
  reference and the app URL as a fallback.
- The MCP tool inventory is unpublished. The Claude Code connector's inventory
  is recorded above; re-check it after connector updates and before relying on
  it from another client.

The [domain model](../../plugin/knowledge/domain-model.md) defines current domain
requirements. This capability investigation does not itself implement current
0.4 creation, migration or other write workflows.

## Connection guidance

Create and permission the connection in Craft, then configure it in each execution
environment that needs access. Do not commit the generated Craft URL, password,
OAuth material or API token to this repository.

The [GPK Setup design](../architecture.md#setup-and-connection-lifecycle) first
checks for an explicitly supported and authorized host bridge. Otherwise GPK
configures its own MCP Client against the user-selected Craft endpoint, completing
authentication as needed. The endpoint may be shared with an existing client;
its authenticated host session is not implicitly shared. The Setup Skill uses
GPK tools and host interaction without requiring a dedicated CLI. Runtime bindings
reuse selected bootstrap configuration, separate from personal resources in User
Control. This is a runtime integration requirement, not evidence
that the previously observed host connector is callable from a GPK process.

Craft's official documentation describes both
[MCP connections](https://support.craft.do/en/integrate/mcp) and the
[Craft API](https://support.craft.do/en/integrate/api), including scoped access,
Daily Notes, tasks, search, and write operations.

## Known boundary

Current repository checks validate packaging, links, and selected document
structure, not live Craft semantics. The
[20 domain acceptance scenarios](../conformance-scenarios.md)
are specified, not executed. The documentation review and the live check above
are not a substitute for those executions: the live check used one connector,
in one client, on three dates, with two updates to one existing block, one read
of another, and several scratch documents that were trashed after their tests,
plus one headless OAuth session from a standalone Node process. It verified nothing
about the REST API. GPK does not ship a
background sync service, duplicate Craft's MCP server, or synchronize multiple
Craft spaces. Each space remains an independently authorized store boundary.

## Sources

Public Craft documentation consulted for the review above:

- [Craft MCP](https://support.craft.do/en/integrate/mcp)
- [MCP security](https://support.craft.do/en/integrate/mcp/security)
- [Craft API](https://support.craft.do/en/integrate/api)
- [Space API reference](https://connect.craft.do/api-docs/space)
- [Selected documents API reference](https://connect.craft.do/api-docs/documents/)
- [Daily notes and tasks API reference](https://connect.craft.do/api-docs/daily-notes/)
- [Craft MCP for Claude Code](https://www.craft.do/imagine/guide/mcp/claude_code)
- [Tags](https://support.craft.do/en/organize-and-find/tags)
- [Craft Update 3.4.4: MCP v2](https://www.craft.do/blog/craft-update-3-4-4)
- [Craft Update 3.5.2: tag rules](https://www.craft.do/blog/craft-update-3-5-2)
- [Craft Update 3.6.0: tags roadmap](https://www.craft.do/blog/craft-update-3-6-0)
- [Craft connector listing for Claude](https://claude.com/connectors/craft)
- [Deeplinks](https://support.craft.do/en/organize-and-find/linking/deeplinks)
- [Task dates, deadlines, and reminders](https://support.craft.do/en/plan-and-do/tasks/dates-deadlines-and-reminders)
- [Links and backlinks](https://support.craft.do/en/organize-and-find/linking)
