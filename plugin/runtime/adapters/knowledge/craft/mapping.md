# Craft adapter

Status: initial package 0.1.0 mapping; domain 0.4 alignment and validation pending.
Documentation review: **2026-09-11**, against Craft's public MCP, API, and help
pages. Live check: **2026-09-11**, through the Craft MCP connector
available in Claude Code. Items marked *verified* were observed on a real space.
One authorized single-block update was executed to test tag creation; every
other observation is read-only. Nothing here enables a write workflow.

The intended adapter maps GPK's Area, Project, Task, Source, Wiki, and Output
model to Craft's available documents, blocks, tasks, links, and other native
capabilities. Areas carry continuing direction and responsibilities; Projects
contain their own Objective and Key Results. This document records integration
evidence and proposed mappings; current templates and write procedures are not
implemented.

Access is through an MCP or API connection created and authorized by the user;
GPK does not proxy Craft or store connection secrets.

## Requirements

- A Craft connection that includes the target space or target documents.
- Read access for inspection and review tasks.
- Future write workflows will require appropriate access; this foundation does
  not implement create, update, move, link, or migration operations.
- A client with the GPK plugin installed: Claude Code or Codex in version 0.1.

Craft connections can be scoped. An agent must verify the current connection
scope before treating search results as a complete workspace inventory.

## Selected mapping approach

These choices consolidate the implementation proposal, not completed round-trip
tests. The [adapter contract](../../../contracts/adapters.md) owns provider-neutral
operations; this document owns their Craft representation and evidence.

- Area, Project, Source, Wiki and Output use ordinary documents. Project process
  material uses native child pages where supported; validate rendering and links.
- Use a compact property list, one field per block, before Project Plan & Actions:
  for example Status, Repository, Area and optional Related Areas. Do not repeat
  visible Type when context is clear. The adapter still needs a tested kind/state
  convention independent of User Tags; no reliable kind-recovery implementation
  is established by this layout alone. Do not depend solely on a tag index.
- Keep Task actions concise; accompanying descriptions link actual review or
  execution materials through resolved native block links or verified external
  document/PR URLs. Do not show non-clickable local paths as review entry points
  or copy authoritative repository drafts into Craft merely to make them readable.
- Tasks use native task blocks. Native todo/done/canceled map to domain states;
  doing/waiting use a reserved description marker. Surface and reconcile a native
  terminal checkbox with stale metadata rather than resetting user edits.
- The adjustable Task time maps to `scheduledDate`. Preserve an existing fixed
  deadline separately as a constraint; never reschedule it implicitly.
- Resolve actual root/block references, preserve order and unrelated native
  content, and verify each scoped write by direct readback. No conditional normal
  update or transaction guarantee has yet been demonstrated.

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
  "coming to Search later, too". Until that ships, search has no tag filter.
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
- Verified by one write: updating a block's markdown to contain `#name` text
  through `craft_write` produces a real tag chip in the editor, including a
  hierarchical `#gpk/test`, and an existing chip survives a whole-block text
  replacement. Tags are therefore readable and writable through the connector
  as plain text. See the live check below.

## Live check (2026-09-11)

Observed through the Craft MCP connector in Claude Code on one personal space.
Read commands plus one authorized single-block update; identifiers, titles, and
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
| Revert and stamps | `blocks_revert` takes per-block `expectedStamps` and reverts only if the blocks are unchanged since the mutation. Verified: every `craft_write` update returns `revertInfo` carrying the original block and a new `expectedStamps` value, and the second update's `before.stamp` equaled the first update's returned stamp, so the stamp is a continuous per-block version rather than a one-time token. Whether an update can be conditioned on an expected stamp is still unverified; `blocks update --help` returned no usage text |
| Tag write | `blocks update --id <blockId> --markdown "#tag #gpk/test"` succeeded. Read-back returned the same markdown, and the editor rendered both `#tag` and `#gpk/test` as tag chips. A second update appending `#gpk/status/test` rendered as a third chip, listed in the Tags view under `gpk` as child `status/test`. The write response listed the block with `text.attributes: []`, so tag identity is derived from the text, not stored as a span |
| Write response | The response exposes the raw stored block (`content`, `stamp`, `rawProperties`, `style` with `listStyle`, `textStyle`, `indentationLevel`, `decorations`, epoch `created`/`updated`), the normalized result (`text.value`, `text.attributes`, `markdown`), neighboring blocks for context with typed spans such as `bold` and `blockLink` (`start`, `end`, `blockId`), and a web link of the form `https://docs.craft.do/editor/d/<spaceId>/<documentId>/x/<blockId>` |
| Search latency | Immediately after the write, a global `search --regexp` for the new text returned nothing; the same query matched about ten seconds later. `blocks get` reflected the write at once |
| Block model | Matches the REST reference: `type`, `textStyle`, `listStyle`, `markdown`, nested `content`; `block://` and `date://` links inside markdown |

## Operation requirements to validate

This table describes intended requirements, the documented primitive that could
satisfy each, and what a live check still has to establish. It is not a record
of completed capability tests.

| Operation | Required behavior | Documented primitive | Still to verify |
|---|---|---|---|
| Read and search | Inspect current backend records and actual connection scope | `GET /blocks`, `GET /documents`, `GET /documents/search`, `GET /connection` | Verified: the connector's tag filtering is plain-text matching and search paginates by cursor. Remaining: behavior of REST connections, which document a 20-result cap without pagination |
| Create | Represent the applicable 0.4 entity and its meaningful relationships | `POST /documents`, `POST /blocks` with markdown or JSON, `POST /tasks` | Checkbox, heading, nested page, and link fidelity when rendered from a personalized template |
| Update | Preserve document identity and unrelated user content | `PUT /blocks` updates only the supplied fields; `PUT /tasks` | The path for updating a document title through its root block; that a partial update leaves sibling blocks untouched |
| Move | Prefer native moves that retain links and backlinks | `PUT /blocks/move`, `PUT /documents/move`, `PUT /folders/move` | That block and document IDs and `block://` references survive move and rename |
| Project process documents | Use native child pages/cards when exposed; declare unsupported operations or fallbacks | Page and card blocks with nested `content`, addressable by block ID | Nesting depth limits and reading nested pages through `maxDepth` |
| Plan and Focus | Preserve planned versus active semantics; do not assume native task lists implement GPK Focus | `GET /tasks?scope=active` means due before now and not done, regardless of the owning document | Reading the owning Project's state and filtering before recommending; nothing native encodes Project state |
| Bulk migration | Record a mapping, use reversible steps, and verify counts and samples | Soft delete to trash for documents; `GET /folders` document counts | Reversibility of `DELETE /blocks`; no batch or transaction endpoint is documented |
| Delete | Never assumed; requires explicit user scope and post-migration verification | `DELETE /documents` to trash; `DELETE /tasks` for Inbox, Logbook, and daily notes; `DELETE /blocks` elsewhere | Whether deleted blocks are recoverable; inbound references must be found by searching for the `block://<id>` string because backlinks are not exposed |

## Evidence against the technical design's open decisions

The [adapter contract](../../../contracts/adapters.md) defines the capability
boundaries that require evidence before the affected operation is enabled. The
documentation review settles which primitives exist; no row is closed until a
read-write round trip is recorded.

| Decision | Documented basis | Assessment |
|---|---|---|
| Identity encoding | Document ID equals root block ID; every block has an ID; `block://` links; `GET /connection` deep-link templates. Verified: app and web link documentIds differ from rootBlockIds and must be resolved; the write response shows the block's internal `documentId` alongside its id; per-block `clickableLink` metadata is available | Stable references are available. Persistence across rename and move is undocumented and untested |
| State encoding | Task state is only `active`, `done`, `cancelled`. Inline block-level tags exist as a product feature with no dedicated API parameter or field. Collections have select properties | Project states and Task `doing` / `waiting` must be emulated. Candidates are a reserved inline tag namespace such as `#gpk/...`, which is user-visible plain text and separable from User Tags by prefix; a Collection select property; or a documented in-document convention. Verified: tags are plain `#name` text in block markdown and searchable as text, so a reserved namespace is readable and retrievable through the connector. Verified by one write: `#name` text written through the connector becomes a real tag chip, hierarchical names included, and an existing chip survives a whole-block replacement. The route still depends on tags being enabled in the space, and its markdown representation carries no structure beyond the text |
| One Task time | `scheduledDate` plus a separate `deadline` and `completedAt` | Good fit: GPK's adjustable time maps to `scheduledDate`; a fixed external constraint can use `deadline` |
| Control-entry discovery | `GET /documents/search` with `include`, `regexps`, `folderIds`, `location`; native `templates` location | Marker plus regex search is feasible. Personal templates can live in Templates and get a stable ID. Keep the marker distinctive: the connector paginates search by cursor, but REST connections document a 20-result cap |
| Concurrency and recovery | No revision, version, or ETag in the REST reference. `fetchMetadata` exposes `lastModifiedAt`. Verified: every write returns a new per-block `stamp` in `revertInfo.expectedStamps`, and `blocks_revert` refuses to revert a block changed since | No documented conditional update. The available guard is read `lastModifiedAt`, write, read back and compare, which is the weaker path described in [Mutation, verification and recovery](../../../contracts/workflows.md#6-mutation-verification-and-recovery). Whether an update can be conditioned on the stamp is the remaining test before settling this row |
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
- Backlinks are not exposed. The pre-deletion inbound-link check must be
  emulated with `GET /documents/search` for the `block://<id>` string and is
  bounded by the same 20-result cap.
- Inline tags are enabled per space and per member. Through the connector they
  are plain text, so a reserved-namespace regex must be anchored to avoid `#`
  in code, hex colors, or headings typed as text. Setup must check the space
  setting before relying on tags for state.
- Retrieval by tag is full-text search for the tag string, space-wide by
  default and combinable with folder, location, document, and date bounds.
  It is not a tag index: there is no tag enumeration, matches are text, the
  index lags writes by seconds, and complete enumeration means paging through
  every cursor. Declare that coverage.
- Tag hierarchy is one level, split at the first `/`. A deeper string such as
  `#gpk/status/active` is still one valid chip, grouped under `gpk` with
  `status/active` as the child label. Either `#gpk/project-active` or
  `#gpk/project/active` works as a reserved name; choose one convention and
  match it with an anchored regex.
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

The [domain model](../../../../knowledge/domain-model.md) defines current domain
requirements. This capability investigation does not itself implement current
0.4 creation, migration or other write workflows.

## Connection guidance

Create and permission the connection in Craft, then configure it independently in
each AI client. Do not commit the generated Craft URL, password, OAuth material,
or API token to this repository.

Craft's official documentation describes both
[MCP connections](https://support.craft.do/en/integrate/mcp) and the
[Craft API](https://support.craft.do/en/integrate/api), including scoped access,
Daily Notes, tasks, search, and write operations.

## Known boundary

Current repository checks validate packaging, links, and selected document
structure, not live Craft semantics. The
[20 domain acceptance scenarios](../../../../knowledge/conformance-scenarios.md)
are specified, not executed. The documentation review and the live check above
are not a substitute for those executions: the live check used one connector,
in one client, on one date, with one single-block write. It verified nothing
about the REST API or a directly registered MCP server. GPK does not ship a
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
