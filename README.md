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

The first integration targets are Codex and Claude Code with Craft for knowledge
and a user-selected local `.gpk` directory for settings, grants and personal
templates. Authorized desktop clients share one control root per GPK instance,
not one per Project. The first executable tool runtime targets **MCP stdio**;
the [architecture](docs/architecture.md#first-release-local-stdio) defines process
boundaries and a later Streamable HTTP extension using the same operations.
Remote deployment/control access is deferred; configuration does not become
ordinary knowledge notes. Additional
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
| `gpk-setup` Skill | Inspect readiness, authorize Craft once in the browser, establish the layout (host document, Areas and Projects Collections, Sources/Wikis/Outputs folders, adopting existing ones by ID), write Settings, propose and persist the default grant set after the user's confirmation |
| `gpk-plan` Skill | Create Areas and Projects (Objective, KRs, scope, primary Area) as rows of the Collections, add Project-owned Tasks in plan order, reorder them, attach process material, change a Project's primary Area, and move a Task between a Project and standalone |
| `gpk-work` Skill | Clarify an Inbox or Daily Note capture into a Task (standalone or under a Project), advance or reschedule it, record its result, offer a next-action choice across standalone and Project-owned Tasks, and close a Project once its Tasks are resolved |
| `gpk-ingest` Skill | Register a Source with origin and access evidence, revise or create the Wikis it affects with citations as links, retain an Output, link records with an explanation, and keep resumable progress in checkpoints |
| `gpk-review` Skill | Daily, weekly, monthly and ad hoc reviews from one inventory read (captures, overdue/today/upcoming/doing/waiting Tasks, Projects by state with attention signals, Areas with Project counts, traversed population and gaps), with conclusions written back to the records through the entity tools |
| `gpk` Skill | Explains the method and routes to the five workflows |
| stdio MCP runtime | 63 tools: runtime, connection and Setup diagnostics, Craft authorization, layout establishment, grant proposal, Settings read/update, grants list/grant/revoke, capability reports, Inbox/Daily Note captures, Task resolve/read/query/create/update/transition/schedule/assign-project, Area and Project resolve/read/query/create/update/transition, Project assign-area/order-tasks, Project materials list/read/append/update, Source/Wiki/Output resolve/read/query/create/update, links query/add/remove, checkpoints read/save, review inventory |
| Craft adapter | GPK's own OAuth client to Craft's MCP endpoint (dynamic registration, PKCE, loopback callback, token refresh in the host-neutral secret store, one token set per control root); every entity's read and write operations, links and checkpoints verified against two live spaces; archive, restore and remove not implemented |
| Local control adapter | Reads and writes `settings.json` and `grants.json` in the selected `.gpk` root through atomic file replacement with digest-based conflict detection; templates not implemented |
| Authorization | Every write resolves a grant from `grants.json` for the backend, root and operation (a Collection or folder of the layout, `daily-notes`, `inbox` or `system`); the adapter re-checks the record's container; ownership moves are authorized on the destination and links on the linking record; tool arguments carry no authority |
| Entry Hooks | Claude Code and Codex `SessionStart` routing-policy loading and `UserPromptSubmit` checkpoint |
| Default entity templates | Area, Project, Task, Source, Wiki and Output in English/Chinese; retained assets, not an executing template engine |
| Claude Code / Codex packages | Each includes Skills, Hooks, a self-contained `mcp/stdio.mjs` with the bundled MCP client and server, launch registration and dependency notices; Node 22.13+ only |
| TypeScript [storage ports](docs/storage-contracts.md#public-contracts) | Entity-specific knowledge operations and named Settings/template/grant contracts in `src/domain/`; every knowledge write contract except archive/restore/remove has a provider caller |

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

Tests cover the control-file envelope, the Craft command mapping against a fake
connection that reproduces the observed command surface, grant resolution,
bootstrap binding, isolated Claude/Codex package launches over stdio, both
protocol eras, schema validation and process shutdown. Live Craft behavior is
recorded as dated evidence in the [Craft mapping](docs/adapters/craft.md); the
first installed-host run of the A1 flow is the acceptance for this slice.

Still to implement: archive/restore/remove, personal templates, recurrence
and periodic execution ([workflow design](docs/workflow-design.md) section 5). HTTP, remote control and a dedicated CLI are not
implemented. OpenClaw, WorkBuddy and Hermes packages remain opt-in previews with
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
