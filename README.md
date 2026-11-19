# GPK

**Goals set direction. Projects drive progress. Knowledge compounds.**

GPK (Goals · Projects · Knowledge) is an open-source methodology plugin for
goal- and project-driven personal knowledge work. Its aim is to connect what you
want to achieve, what you do and what you learn—with help from the AI agents and
knowledge tools you choose.

[简体中文](README.zh-CN.md)

GPK is in early development. The principles below describe the intended product;
see [Current support](#current-support) for what is available today.

## Why GPK

Saving information is easy. Putting it to work—and retaining what the work
teaches you—is harder. Reading lists grow, task lists get checked off, and useful
decisions disappear into old notes or AI conversations. More activity does not
necessarily mean progress toward something that matters.

GPK is designed for people whose work mixes building, research and self-directed
learning. It connects two directions of progress: goals lead to projects, actions
and research; new information and experience can reshape understanding, change a
plan or suggest a new goal. Results then feed back into knowledge and future work.

For example, a paper might support a project decision, suggest an experiment and
update an existing explanation. The experiment's result can revise both the plan
and the explanation. The paper remains traceable evidence throughout; it need
not become a separate project or a stack of disconnected summaries.

The point is not a larger collection or a more elaborate filing system. It is
to make the next useful action easier to choose and past learning easier to reuse.

## Product approach

1. **Give action a direction.** Start with what matters and the change you want
   to make. Define meaningful outcomes, choose bounded projects and review the
   evidence as you go. A useful next step matters more than an overwhelming
   backlog; finishing a checklist is not proof that the goal was achieved.
2. **Put knowledge to use.** Prepare material according to its purpose: a summary
   may be enough, or the work may need translation, close reading or comparison
   with other sources. Maintain explanations that connect evidence, disagreements
   and open questions. Use includes learning, retrieval and better decisions—not
   only publishing an article or shipping a product.
3. **Let work leave something behind.** Retain useful findings, decisions and
   results from tasks, projects and AI conversations. Feed them into the relevant
   knowledge and plans so the next effort can build on them. A brief result can
   stay with its task; not every action needs a new document.
4. **Reduce the work of maintaining the system.** Use agents to help prepare
   sources, connect ideas, maintain knowledge and review plans. People retain
   control over intent, priorities and important decisions. Agents work from
   current records, preserve user edits and act within granted permissions.

Everyday reminders, curiosity and material with no immediate use still belong.
Not everything needs an Objective or KR, and not every source must become a task.
The method should support the work, not turn maintaining the system into the work.

## Why a plugin

Your knowledge and progress should outlast a particular AI conversation, client
or note-taking app. GPK's core is a shared method, expressed through Agent Skills,
templates and explicit operations—not a new editor or a replacement Agent client.

The design separates domain meaning from storage ports and concrete adapters.
The aim is to continue the same work in another supported client, and eventually
another knowledge backend, without rebuilding its meaning and relationships.
Knowledge and progress live in the selected backend, not solely in an agent's
conversation memory or a hidden GPK copy.

The first integration targets are Codex, Claude Code and Antigravity with Craft for knowledge
and a user-selected local `.gpk` directory for Settings and grants (with editable
entity templates stored natively in Craft's Templates area and bundled fallbacks).
Authorized desktop clients share one control root per GPK instance
and connect to one per-user local service over Streamable HTTP. Command-based hosts
launch a stdio bridge. See the [installation and console guide](docs/getting-started.md#open-the-local-service).
Remote deployment and mobile access are future work. Additional
clients and stores are an extension path, not a claim of universal compatibility.
Each integration must demonstrate what it preserves and disclose its limits.
The approach requires no new editor, hosted GPK service or central mirror database;
team governance and collaboration remain outside the initial personal scope.

## A shared model

GPK uses a small set of concepts to connect direction, work and knowledge:

| Entity | Purpose |
|---|---|
| Area | Continuing direction and responsibilities in an independent document |
| Project | A bounded intended change with its own Objective and Key Results |
| Task | An accepted action and useful results, within a Project or standing alone |
| Source | Retained material and evidence with traceable origin |
| Wiki | An independently useful, maintained explanation or synthesis |
| Output | An artifact intentionally retained for use, delivery, decisions or operation |

There is no separate Goal entity. Objective and KRs belong inside a Project;
topics remain metadata. Inbox and Daily Notes provide capture and working
surfaces. The [domain model](plugin/knowledge/domain-model.md) defines the exact
meaning, relationships, states and operations.

Success means clearer next actions, meaningful results and knowledge that helps
future work—with less maintenance, and continuity across supported tools.

## Current support

The domain baseline is **0.4**; the plugin package is **0.1.0**. This section is
the one place that states what works now; other documents link here.

| Component | Available now |
|---|---|
| `gpk-setup` Skill | Opens GPK's local browser console, required before any other work: connect Craft, choose a dedicated or shared workspace, the metadata language and the names, and create or adopt the structure (host document, Areas and Projects Collections with views, Sources/Wikis/Outputs folders, templates), automatically persisting full non-destructive workspace grants across GPK's 8 bound containers. Writes only `settings.json` and `grants.json`. |
| `gpk-plan` Skill | Create Areas and Projects (Objective, KRs, scope, primary Area) as rows of the Collections, add Project-owned Tasks in plan order, reorder them, attach process material, change a Project's primary Area, and move a Task between a Project and standalone |
| `gpk-work` Skill | Clarify an Inbox or Daily Note capture into a Task (standalone or under a Project), advance or reschedule it, record its result, offer a next-action choice across standalone and Project-owned Tasks, and close a Project once its Tasks are resolved |
| `gpk-ingest` Skill | Select Capture, Study or Deep Research before retaining material. File inputs keep a native original attachment, and URL inputs keep their locator. Higher depths connect cited findings to current work. Research uses the host’s available search tools; import an existing collection (Markdown or Obsidian, Notion, another Craft space) by its structure through the import guide, images and attachments included |
| `gpk-review` Skill | Daily, weekly, monthly and ad hoc reviews from one inventory read (captures, overdue/today/upcoming/doing/waiting Tasks, Projects by state with attention signals, Areas with Project counts, traversed population and gaps), with conclusions written back to the records through the entity tools |
| `gpk` Skill | Explains the method, handles general lookups and standalone Daily Note logging, and routes to the five workflows |
| Local service and CLI | `gpk open` opens the local browser console with **Status**, **Configuration** and **MCP & Skills** (6 Skills ↔ 28 MCP tools visual orchestration explorer and structured parameter tables). Configuration handles first-time Setup, optional Craft attachment upload API connection, automatic session retention and writing/time preferences. Use `gpk start`, `gpk stop` and `gpk restart` to manage the service, `gpk status` to report its PID, endpoint and onboarding readiness, and `gpk connection` to locate the private HTTP client configuration. |
| Daily activity | Each GPK workflow records substantive outcomes in the Daily Note by default (inline via `activitySummary` on compound writes, automatically on `gpk_sources_create` and `gpk_sessions_apply`, or standalone via `gpk_daily_record`). |
| MCP runtime | 28 coarse-grained Agent BFF tools: `gpk_status` (readiness, preferences, customized templates, optional grants/capabilities/templates/setup diagnostics), `gpk_setup_open`, `gpk_preferences_update`, `gpk_captures_get`, `gpk_daily_record`, six entity triplets (`gpk_<areas|projects|tasks|sources|wikis|outputs>_<get|create|update>` with URL/ID target resolution, `include` expansion on Projects, batch Task creation, `append`/`replaceContent` prose updates, compound transitions/links/materials and structured `partial` progress receipts), `gpk_links`, `gpk_review_inventory`, `gpk_sessions_next`, `gpk_sessions_apply` and `gpk_checkpoints` |
| Craft adapter | GPK's own OAuth client to Craft's MCP endpoint (dynamic registration, PKCE, CSRF state verification, loopback callback, token refresh in the host-neutral secret store, one token set per control root); workspace Setup, native Craft `Templates` installation/adoption and live read-back (`templates.read`), every entity's read/write operations and links; checkpoint revision preservation and recovery are fake-tested, with live validation pending; images and files in a created body copied in place, by URL through MCP (verified live) or from local files governed by the active Agent harness through Craft's optional REST upload API (fake-tested; live run pending) |
| Local control adapter | Reads and writes `settings.json` (including `metadataLanguage`, `contentLanguage`, `timezone`, backend layout, template bindings and automatic session retention policy) and `grants.json` in the selected `.gpk` root through atomic file replacement with `fsync`, owner-token file locks and digest-based conflict detection |
| Authorization | Every knowledge write passes the active backend's current `ControlGrant[]` from `grants.json` into `GrantedWriteGuard`; the adapter resolves the target's actual container(s) and verifies root, scope and operation coverage (`daily-notes`, `inbox`, `system`, Collections and folders); ownership moves authorize on the destination root while rejecting non-GPK document sources; establishing or adopting a workspace in the browser console automatically persists full non-destructive container grants; tool arguments carry no authority |
| Hooks | Claude Code and Codex `SessionStart` routing-policy loading and `UserPromptSubmit` checkpoint; Antigravity native `rules/AGENTS.md` routing rule plus `SessionStart` catch-up notice; opt-in `Stop` continuation across all three hosts asks the active Agent to run `gpk-ingest` (`gpk_sessions_next` / `gpk_sessions_apply`) when automatic session retention is enabled |
| Conversation retention | Manual last-N-days backfill and automatic retention share Claude Code, Codex and Antigravity JSONL readers (auto-discovering `~/.claude/projects`, `~/.codex/sessions` and `~/.gemini/antigravity-cli/brain` when no custom origins are set), native session identity, per-turn fingerprints, TTL-leased local locks and backend checkpoints/effect tracking via `gpk_sessions_next` and `gpk_sessions_apply`. One evolving session reuses one Source. Fake-Craft operation tests and isolated Hook commands pass; installed-host semantic execution and live-Craft session acceptance remain pending |
| Native-first entity templates | Setup installs or adopts `GPK Area`, `GPK Project`, `GPK Source`, `GPK Wiki` and `GPK Output` in Craft's native `Templates` area and binds their IDs in `settings.templates` and `gpk/layout` (and discovers unambiguous `GPK <Role>` templates on previously initialized spaces). Runtime reads back user edits (preserving Craft callouts/dividers and sanitizing stray checkboxes), piggybacks customized templates onto `gpk_status` and `gpk_*_get`, and falls back to bundled defaults if a template is deleted or emptied |
| Claude Code / Codex / Antigravity packages | Each includes Skills, routing/Hooks, a stdio bridge and shared HTTP service with bundled dependencies, launch registration and dependency notices; Node 22.13+ only |
| TypeScript [storage ports](docs/storage-contracts.md#public-contracts) | Portable `KnowledgeBackendPort` (workspace, templates, six entities, captures, links, checkpoints) and streamlined `UserControlPort` (named Settings and grants, supporting `mcp`, `api` and `local` vault connections) in `src/domain/`, with zero concrete-adapter coupling in `src/runtime/operations.ts` |

Four vertical slices are in: Setup (onboarding through the tools, no
hand-written files), the reimbursement-reminder scenario (A1) from capture to
recorded result, the Project loop on the Collections Setup creates (Areas and
Projects as rows with typed Status and Area columns, Tasks as task blocks inside
the Project row in plan order, process material as nested pages, closure refused
while Tasks are open), and the knowledge entities in the folders Setup creates
(Sources, Wikis and Outputs as documents, contextual links as bullets in the
linking record's body, processing checkpoints in a `GPK System` page). Review
runs on a one-call inventory of that population and writes its conclusions
into the records. Task blocks in documents outside GPK's locations are not
managed. Every failure is a normalized `Result` with MCP `isError: true`; no
tool fabricates records or receipts.

Text queries apply case-insensitive title/body substring matching to current scoped
records (with exact literal markers preserved for session Source identity recovery). Nested page reads follow child pagination with finite traversal budgets;
native Collections inside a body leave that record partial. Incoming-link discovery
still uses title search and omits standalone Task bodies, so link and `relatedTo`
results report partial coverage. Creation verifies appended body text and copied
local media; provider rendering that cannot be compared returns an uncertain effect
for inspection. Setup syncs full default workspace grants automatically, applies the configured
timezone and `contentLanguage`, binds native Craft templates for live round-tripping, and records interrupted structure creation in Craft for verified retry.
These safeguards have local regression coverage; they are not new live-Craft evidence.

Tests cover the control-file envelope, the Craft command mapping against a fake
connection that reproduces the observed command surface, native template editing and fallback, grant resolution,
bootstrap binding, isolated Claude/Codex/Antigravity package launches over stdio, both
protocol eras, schema validation and process shutdown. Live Craft behavior is
recorded as dated evidence in the [Craft mapping](docs/adapters/craft.md); Codex + live Craft end-to-end verification has exercised Areas, Projects, Tasks, child process pages, Sources, Wikis, Outputs, native template customization and Daily Note logging.

Still to implement: entity archive/restore/remove, additional knowledge backends (Notion, Feishu, Obsidian), recurrence
and user-requested timed execution ([workflow design](docs/workflow-design.md) section 5). Automatic conversation processing requires an active desktop Agent; closed-client execution and automatic Daily Note digests are not implemented. Remote hosting and mobile access remain future work. OpenClaw, WorkBuddy and Hermes packages remain opt-in previews with
no GPK MCP runtime or installed-client validation.

The [acceptance inventory](docs/conformance-scenarios.md) records target behavior.

## Start here

- [User needs and scenarios](docs/requirements.md): action management, knowledge
  management and their connections; the requirements behind the design.
- [Getting started](docs/getting-started.md): build, locally load and assess the
  current foundation. `pnpm build` creates ignored local packages and catalogs.
- [Architecture](docs/architecture.md): responsibility boundaries, document
  ownership and the review path into domain, workflow and storage contracts.
- [Distribution](docs/distribution.md): pnpm commands, release archives and the
  CI-managed distribution repository. Remote publication requires CI configuration.
- [Roadmap](docs/roadmap.md): product milestones and their completion criteria.

Reusable product documents, including drafts, live in this repository and can be
reviewed without private notes. Personal Project context remains in the selected
knowledge backend, recording result summaries and links to external artifacts.

## License

[MIT](LICENSE)
