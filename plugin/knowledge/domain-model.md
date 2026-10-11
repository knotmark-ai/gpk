# GPK Domain Model

Domain model **0.4** · **Design baseline; runtime conformance has not been demonstrated.**

GPK (Goals · Projects · Knowledge) connects continuing direction, bounded work
and reusable knowledge through existing Agent harnesses. This is the authoritative
English definition of its entities, relationships, operations and invariants.
The [Chinese companion](domain-model.zh-CN.md) summarizes it; the source
repository's `docs/conformance-scenarios.md` specifies observable acceptance.

The initial integration scope is Codex and Claude Code with Craft through a
user-managed MCP or API connection. Other clients and stores remain candidates.
GPK requires no editor, harness, scheduler or synchronization service of its own.
The shared references define the v0.4 methodology, including
[six entity templates](../guides/templates.md) for in-conversation drafts;
the Task template is an inline fragment, not a required document.
The current Skill entrypoints are engineering-skeleton MCP call instructions,
not implemented business workflows; see [MCP invocation](../guides/mcp.md).

## Representation and relationships

Use natural language for Vision, Responsibility, strategy, Objective, KR evidence,
Task descriptions, explanations and judgment. Structure serves an actual
deterministic consumer: identity recovery, state interpretation or transitions,
Task-time queries, capability checks, operation inputs/results or verification.
Required meaning is not a universal schema. Properties, reserved tags, checkboxes,
links or readable sections are valid when an adapter reliably recovers meaning.
Do not impose lifecycle fields, timestamps, scores or relation arrays on every entity.

| Entity | Meaning | Lifecycle |
| --- | --- | --- |
| Area | Continuing Vision and/or Responsibility, circumstances and direction | active / inactive |
| Project | Bounded intended change with Objective, initial KRs, plan and review | planned / active / paused / completed / canceled |
| Task | Concrete accepted action with completion meaning and useful results | todo / doing / waiting / done / canceled |
| Source | Retained work or evidence with traceable origin and actual access | None |
| Wiki | Maintained explanation of an independently useful subject | None |
| Output | Artifact intentionally retained for use, delivery, communication, decisions or operation | No universal lifecycle |

Objective and Key Results are Project content; direction is Area content; Actions
are Projects or Tasks. No separate Goal, Strategy Stage, Long-term Project, Area
Operating Policy, Index, Review, Ingest, Completion, Context or Recurrence entity
is required. People, companies, products and organizations are ordinary Wiki
subjects; entity notes, overviews, surveys and maps of content add no entity or
required subtype. Inbox and Daily Notes are capture/working surfaces; Focus and
Full Plan are views. Archive changes presentation; Backup supports recovery.

A Project states one primary Area and may relate to others. A Task has at most
one primary Project. Source–Wiki, Wiki–Wiki and Project–Source/Wiki relationships
are many-to-many. Sources may cite other Sources or record variants of one work;
prepared material identifies its Source and actual input. Outputs identify their
relevant producers. Inactive Areas remain valid link targets.

Use prose and links for Agent-consumed relationships; a structured relation needs
a deterministic query or integrity operation. No `primary_area`,
`previous_project`, phase number, position field or dependency DAG is required.
Project links imply neither shared ownership nor prerequisites. Physical containers
do not determine domain ownership: do not copy Projects into each related Area.

User Tags provide customizable classification and retrieval. System Metadata
encodes domain meaning such as type and status. A tag encoding Project state is
System Metadata; adapters distinguish representations or namespaces without
requiring a universal user taxonomy.

State meaning, storage representation and query capability are separate. Each
adapter selects one authoritative representation per state; do not maintain a
plain Status and a system tag as competing values. When system tags are selected,
prefer names such as `#gpk/project/active`, distinct from User Tags. This naming
does not require a backend to support arbitrary tag depth or tag filtering.
Native fields and checkboxes remain valid representations. Domain callers ask
for entity states, not a particular tag API; adapters disclose how that query
is actually fulfilled and what it covers.

## Area

An Area is an independently readable, user-editable document containing continuing
Vision and/or Responsibility, circumstances, standards, strategy, evidence and
review observations. Skills supply general method; Area prose supplies current
answers. Grain follows independent investment decisions and useful review
questions. A topic alone may belong in Wiki or User Tags; do not require exhaustive
classification, equal hierarchy depth or one Area per product. Creating, splitting
or merging Areas requires scoped authority.

Active Areas participate in proactive review and new action generation. Inactive
Areas remain readable, searchable, linkable and available for explicit requests.
Deactivation neither pauses existing Projects nor removes relationships.

Strategy and possible stages may remain prose or lead to ordinary planned Projects.
Planning reads current results and relevant Sources/Wikis, including unassigned
material, and checks evidence sufficiency. Summaries, tags and existing links aid
discovery without being its only path. Retaining a Source does not require an Area;
a lasting Vision or Responsibility can justify proposing one.

Operations: create, read, update, activate, deactivate, review, link/unlink.

## Project

A Project describes a bounded change, deliverable, decision or useful reduction of
uncertainty. Keep the title short and explain the following in its content:

- Objective: the meaningful change sought and why it matters.
- Initial outcome-oriented KRs and evidence: what will differ, not activity counts.
- Scope, constraints, expected horizon and known ordered Tasks.
- One primary Area chosen for this Objective, with other useful relationships.
- Results, decisions, research, drafts and review observations.

This guide requires no structured record. KRs have no separate lifecycle,
confidence enum or mandatory scoring system. Their precision can improve with
evidence during review; active work needs a clear Objective and credible plan.
Completed checkboxes alone do not establish KR attainment.

Initialization reads available documents and asks for relevant user-known facts.
Research can be a Task or process work; it becomes an ordinary Project when its
own bounded Objective warrants one. No special Discovery Project is required.
Prefer short Projects, often one or two weeks; discuss scope and review beyond
roughly one month. These are planning preferences, not scientific cutoffs or a
ban on longer work. Consider meaningful results, focused effort, available
capacity and evidence latency together. A date alone does not justify a Project;
no size class or sizing record is mandatory.

### Planning, activation and continuity

`planned` records intended work without a current execution commitment; `active`
establishes that commitment. `paused` is started work temporarily stopped;
`completed` and `canceled` preserve useful history. Future work can remain prose
or become planned Projects with provisional Objective, KRs, Area, horizon, known
Tasks and adjustable times. Do not invent exhaustive plans or precise dates.

Activation reviews evidence, Objective, initial KRs, known ordered/dated plan,
prerequisites, priorities, permissions and shared capacity. Direct creation as
active requires the same readiness and explicit commitment. Multiple active
Projects are allowed when combined effort fits capacity; do not allocate the
same capacity repeatedly. Active work has a path through Tasks, an explained wait
or a review decision. Resume checks current readiness and capacity too.

Dates and predecessor completion can prompt review, never automatic activation.
Review can revise, split, reorder or cancel unexecuted plans, including Objective,
KRs, Area, Tasks and times. Preserve actual actions/results and significant
decisions; do not backdate activation or rewrite history. Material changes to
started work retain reasons and evidence; a substantially different Objective
may warrant a new Project. Preserve doing/done work found under a planned parent
and review the mismatch; do not erase it, silently activate the Project or
bulk-convert its Tasks to waiting.

A successor may choose a different primary Area and cite prior results, explaining
continuity without rewriting its predecessor's Area, Objective, KRs or evidence.
Ordinary links suffice; no inherited Area, parent workstream, Stage, structured
predecessor or duplicate plan is required.

Put compact properties first, one property per line or native property, followed
by Plan & Actions. Do not repeat a visible Type label when the document context
already makes it clear; the adapter must still recover entity identity reliably.
Objective, KRs, planning context and supporting material follow the action list.
Presentation order does not change the need to frame Objective and KRs before
planning. Keep field meaning consistent across readable lists, YAML frontmatter
or native properties without requiring every backend to render YAML.
Known Tasks may all be ordered and scheduled; keep one plan without a duplicate
next-action checklist. Milestone headings are optional.
Keep Project-specific research, drafts, tradeoffs and decisions as process material.
Use native child documents where supported, otherwise inline sections or explicitly
linked documents preserving the parent relationship. Linked artifacts may retain
their authoritative body in another workspace.

Closing assesses outcomes and explicitly resolves remaining Tasks. It neither
marks leftover Tasks done nor activates another Project.

Operations: initialize, create, read, update, activate, review/replan, pause,
resume, complete, cancel, split, link/unlink.

## Task

A Task contains an action and status, with optional description, one time, result
and at most one primary Project. Standalone Tasks need neither Project nor Area.

| Status | Meaning |
| --- | --- |
| todo | Accepted action awaiting execution |
| doing | Action currently being worked on |
| waiting | Cannot proceed until the described response or condition resolves |
| done | The action's completion condition has been met |
| canceled | The action is no longer intended |

Raw reminders, ideas, questions and materials can enter Inbox or Daily Notes.
Capture is not a Task state. Clarification may accept a Task, frame Project work,
retain a Source, revise Wiki, keep a possibility or discard within scope. Routes
are non-exclusive and preserve useful origin context; do not invent an Objective,
Area, Task or date merely to retain information or an uncommitted possibility.

The one optional time is planned attention: execution for todo, continuation for
doing, follow-up for waiting. It is adjustable, not inherently an immutable
deadline. Keep fixed external commitments explicit in Task/Project content and
respect them during replanning. Unknown times remain unset; undated accepted work
must remain discoverable. No separate start, due, defer and review times are required.

Waiting describes an actual unresolved condition in prose. A follow-up date does
not resolve it. Postponement changes time, not state; do not add `captured`,
`deferred`, `defer_until` or `waiting_for`. Task status/time alone cannot establish
executability. Preserve Project list order and use it with descriptions to reason
about prerequisites and independent work. No Action Requirements, Context tags or
persistent Execution Context schema is required.

Brief results can stay on the Task. Route useful durable information to existing
Project/Area context, KR evidence, Source, Wiki, Output or further actions. No
Task Completion or separate result record is required for every action.

Keep the action concise and place its review materials or execution references
in the accompanying description. Link to the actual document, pull request or
artifact using verified, accessible URLs or native backend references. A repository
homepage, decision summary or non-clickable local path is not a substitute for the
material under review. If no accessible artifact exists, state the gap and obtain
authorization to publish/share it when needed; never invent a URL. Keep drafts
in their authoritative workspace, including an unmerged review branch, rather
than duplicating their full body into the knowledge backend for convenience.

Operations: create, read, update, start, stop, wait, resume, reschedule, complete,
cancel, reopen, record result, link/unlink.

## Source

A Source retains a work or evidence item, such as a book, paper, video, dataset,
observation, meeting record or receipt. Preserve origin, locator or retained
material, accessed versions, coverage, preparations, an accessible-scope summary
and useful links/tags. Disclose partial or unavailable access. Type is descriptive
content; Source has no lifecycle or preparation-depth enum.

Intake registers and orients accessible material, honors explicit intent, considers
uses, asks useful questions, prepares proportionally and reconsiders uses after
reading. Summary, extraction, highlights, transcript, translation or close reading
of full material can serve the purpose; neither summary-only nor full import is a
universal requirement. A Source can generate Tasks, Project decisions and multiple
Wiki revisions together and remains available afterward. User-supplied and
Agent-discovered materials follow the same provenance and routing rules.

- Identity follows a work, not each URL. A pure repost, translation, edit or
  faithful retelling without independent argument is an access/variant reference
  of the original Source. Preserve the discovery path and accessed version.
- Independent commentary citing other works remains a separate Source. Relevant
  references may become Sources linked through actual citations; do not recursively
  import every bibliography or invent citation-role enums.
- Resolve uncertainty before consolidating; preserve useful material and existing
  references. Do not silently flatten disagreements or version differences.
- Identifying an original does not prove it was read. A summary based on a retelling
  stays attributed to that actual input after identity resolution.
- Prepared material identifies its Source, actual input, purpose and coverage in
  prose/links. Several preparations can serve different purposes without a new
  entity; resumable processing mechanics remain design work.

An external work remains Source evidence even when original or a synthesis of
other works. Knowledge supports query, association, decisions, action, learning,
creation and communication; preparation serves such use, not collection size.

Operations: register, read, update metadata, summarize/orient, resolve identity,
prepare, relate Sources, consolidate variants/duplicates, link/unlink, use in ingest.

## Wiki

A Wiki maintains an independently useful topic, question, mechanism, procedure or
entity. Organize for the subject: definition/summary, concepts, mechanisms,
comparisons, evidence, limitations, disagreements, open questions and links.
A subtopic becomes another Wiki when independently meaningful and worth maintaining;
otherwise keep a section. No one-note-per-Source or fixed atomic-card size is required.

Ingest reads current Wiki content and relevant evidence, seeks additional Sources
when useful, then revises affected explanations, claims, comparisons and links.
It is not append-only accumulation of Source summaries. Place citations near claims;
distinguish support, contradiction, qualification, inference and user observations.
Retain uncertainty and actual access/coverage boundaries. Better Wiki content alone
does not prove user learning or mastery.

Operations: create, read/query, revise, ingest, link/unlink, split, merge, rename,
supersede, check knowledge health. Boundary changes preserve inbound references
and provenance; no separate Ingest or Review entity is required.

## Output

An Output intentionally retains an artifact for use, delivery, communication,
decisions or operation: for example, a report, script, presentation or design.
It may come from a Task, Project, both or an independent purpose. Describe use,
producers and context in content and links. Retention depends neither on draft/final
labels, Project closure nor publication; not every completed action needs Output.

Brief results can remain on Tasks; working drafts/research can remain Project
process material. Reusable understanding belongs in Wiki, externally obtained
evidence in Source. Keep one authoritative artifact body, including in an external
workspace, with a useful summary and backend reference instead of a duplicate.
Output has no universal lifecycle or publication enum; type-specific delivery
information may help. Publishing/deploying is a separate explicitly supported
operation under current authorization.

Operations: create, read, update, link/unlink, archive, restore.

## Operations and state effects

Operations describe behavior, not required API methods. Common families cover
scoped create/register, read/query/search, update and deletion; reading, linking
and unlinking relationships; rename/move, ordering, archive/restore; and defined
state/time changes. Each implemented operation must document five parts, without
turning them into mandatory stored entity fields:

| Contract part | Required meaning |
| --- | --- |
| Input | Operation, target or creation scope, intended content/change and relevant current facts |
| Preconditions | Required identity/state, capability, authorization and supported revision expectation |
| Effect | Exactly which content, state, order/time or links change, and what remains unchanged |
| Result | Actual affected references, verified effect and material capability/coverage limits |
| Failure and recovery | Whether an effect occurred, uncertainty/incompleteness and the safe next action |

Skills judge appropriateness; deterministic checks verify only facts they can
establish. Headings cannot prove a meaningful Objective or KR attainment. A valid
transition is not user authorization; narrow tool permissions remain necessary
because instructions alone cannot prevent every direct-tool bypass.

Splitting, merging, restructuring, initialization and Wiki integration can compose
several verified operations without an atomic backend call. Project closure takes
an outcome assessment and explicit disposition of remaining Tasks; report any
incomplete effect without claiming unsupported atomic closure. Task rescheduling
preserves state, results and fixed constraints; Task completion preserves useful
results and does not complete its Project. Content updates cannot bypass state rules.

| Target | Operation | Effect |
| --- | --- | --- |
| Area | create | Establish explicit active or inactive state |
| Area | activate / deactivate | Change proactive review/action participation only |
| Project | initialize | Frame Objective, KRs, Area, horizon, conditions and known Tasks; no execution commitment |
| Project | create | New → planned; new → active requires explicit commitment and readiness/capacity review |
| Project | activate | planned → active after evidence, prerequisites, priorities, capacity and authorization checks |
| Project | update / review/replan | Revise plans/evidence with reasons; no automatic activation or fabricated history |
| Project | pause / resume | active ↔ paused; resume checks current readiness/capacity |
| Project | complete | active or paused → completed; assess outcomes and explicitly resolve remaining Tasks |
| Project | cancel | planned, active or paused → canceled; retain evidence and explicitly resolve remaining Tasks |
| Task | create | New → todo, including accepted Tasks in planned Projects |
| Task | start / stop | todo ↔ doing; parent execution eligibility is a separate check |
| Task | wait | todo or doing → waiting for a described unresolved condition |
| Task | resume | waiting → todo after the condition actually resolves |
| Task | complete / cancel | todo, doing or waiting → done or canceled when justified; retain results |
| Task | reopen | done or canceled → todo, preserving useful earlier context |
| Task | reschedule | Change the single time without implicitly changing Task/Project state |
| Source / Wiki / Output / KR | Content operations | Update content, links or evidence; no universal lifecycle transition |
| Applicable content | Read/query, link/unlink, rename/move | Preserve meaning, identity and useful relationships; no inferred lifecycle transition |
| Applicable content | Archive / restore | Change presentation while preserving canonical identity and meaningful state |

## Focus, review and recurrence

Focus is an Agent-produced useful selection from broad, fresh Task candidates,
current parent Project states, order, descriptions and known constraints. Default
executable choices exclude Tasks in planned, paused, completed or canceled Projects,
regardless of date. Standalone Tasks remain eligible by their own state and meaning.
Waiting follow-up or a readiness review does not make blocked/unactivated work
executable. Offer a small useful choice; do not guess unseen device, location,
energy or available time, or require a Context questionnaire. Ask when a missing
constraint materially changes the decision.

Full Plan may show every Project state, tentative timing, order and continuity
without making all work executable. Upcoming, Waiting and Unscheduled are views.
Preserve overdue, doing and undated work in retrieval. Native task views may not
enforce parent-state rules; read current Project state and disclose limitations.
A deterministic Focus engine must document precise inclusion rules.

Freshly reading search candidates verifies those candidates, not the completeness
of discovery. A limited result can support a labeled Focus shortlist; it cannot
establish that all commitments were reviewed or no unfinished Tasks remain.
Queries must disclose scope and coverage; complete inventories require evidence
that the relevant population and its current state were adequately traversed.

| Review | Coverage |
| --- | --- |
| Daily | Captures, current actions, waiting follow-up and results |
| Weekly | Objective/KR evidence, active/planned/paused work, capacity, delays and next commitments |
| Monthly | Active Area direction/responsibilities, priorities, Projects and relevant knowledge |
| Ad hoc | New evidence, constraints, delays, dates, predecessor results/completion or user requests |

Replan can revise order/time, scope, KRs, future plans and activation choices while
preserving fixed constraints, actual work and material decisions. Reviews can
update existing content; a standalone record is optional. Cadence does not imply
automation. Recurrence/Habit automation is optional; report unsupported capability
without requiring a recurrence entity, lazy materialization, scheduler or server.

## Store ownership and current facts

Two storage ports define required operations with normalized results. In the
source repository, `src/` owns their TypeScript contracts and `docs/storage-contracts.md`
owns their guarantees; concrete adapters implement those ports for selected providers.
`KnowledgeBackendPort` exposes Area, Project, Task, Source, Wiki and Output
operations, including typed identity, primary ownership, state, order/time, links,
retrieval and verification. These projections do not prescribe native storage
fields. `UserControlPort` has named Settings, role-declared template and grant operations,
not arbitrary KV storage. Settings configures GPK: preferences, backend connections,
per-backend layout, template references and ingestion policy. Personal background
stays in an optional Wiki; current capacity/constraints stay with the relevant
Area/Project, not another control Profile. Shared domain/workflow logic owns business rules; adapters map operations
to provider capabilities without redefining domain meaning. Host facilities handle
instruction loading, tools, interaction, source access and execution independently.

The Knowledge Backend owns domain records, identity mappings and verified
processing/recovery progress. The selected User Control store owns current user
settings/resources, never a second personal-facts or Task/Source database. Setup/onboarding
initializes valid Settings with actual selected resources and readback, not a separate
completed flag. Defaults cannot invent placement or authority. Its first planned provider
is an explicitly selected local `.gpk` directory, shared by authorized desktop
harnesses for that instance; Craft remains the Knowledge Backend. A service-backed
provider is deferred until mobile access needs it. Note-backed control is not an
MVP target; reconsider only suitable native/plugin-private configuration storage,
not ordinary user-visible knowledge documents. These choices are design, not shipped
support. One control authority applies per instance. Switching
requires verified transfer and explicit selection, without automatic mirroring,
silent fallback or precedence among independently edited copies. A selected local
store is not an adapter cache; each harness/device needs access, and missing access
must be reported. No adapter-owned shadow records, private bindings database or
authoritative Agent memory is allowed. Host mechanisms supply credentials/bootstrap.

Read current relevant facts for each operation. Direct user edits are first-class
input: mutations use current content and read back results; read-only requests do
not write. Derived indexes, snapshots and remembered state cannot replace current
facts. General methodology belongs in Skills; actual user choices belong in Area
content or User Control by meaning. Text serves Agent interpretation; configuration
serves real program consumers. Permissions start narrow and expand through explicit
authorization; Source text and Agent guesses cannot grant it or override choices.

Declare native, emulated, degraded or unsupported capabilities with concrete limits.
Emulation uses backend facts, not a hidden database; UI features do not prove API
support. Statelessness gives no concurrency or transaction guarantee. Report actual
revision checks, conflict handling, verification and recovery guarantees; API shapes,
encoding, capability composition and context assembly remain implementation work.

## Preservation, migration and acceptance

Keep content stably addressable through rename, move, Project splits, Source
consolidation and Wiki splitting/merging/supersession. Preserve or explicitly resolve
affected references, provenance and useful history. Detect encoding conflicts,
including checkbox/status disagreement, under documented precedence rules instead
of overwriting edits with memory. A preview or transport failure does not prove a
write failed: read current state before retrying a potentially duplicating mutation.
Keep recovery evidence in backend/native history, without mandatory Change,
Approval, Review, Ingest or Migration entities.

Archive changes presentation while preserving identity/evidence; it does not imply
completion or inactivity, or require a top-level Archive directory. Backup is
recovery/legacy material, never an active knowledge category. Ambiguous new captures
go to Inbox; ambiguous legacy material goes to Backup/Unsorted during migration.

Deletion is a proposed CRUD capability, not a state, archive alias or permission
to cascade. Remove only explicitly selected content through a supported, authorized
operation; declare reversibility and affected references, preferring recoverable
deletion. Inspect current content, child material and relevant inbound links first;
resolve or report consequences. Never silently delete child Tasks or evidence with
a Project. Restoring archived content differs from recovering backend-deleted
content: the latter requires actual backend support.

Before a scoped migration, inspect actual content, not titles/extensions alone.
Inventory authorized scope, counts and relevant link types; record source-to-
destination decisions and exceptions in backend-held recovery material. Prefer
reversible changes preserving native identity. Verify counts, representative content
and affected references, declaring coverage limits. Account for staging leftovers
and ambiguous items before claiming completion. Copies/summaries do not authorize
deleting originals. These safeguards impose no fixed migration schema.

Portability preserves meaning, state, order/time, current content, useful links,
original evidence and capability limits. Validate harness portability, backend
behavior and state migration separately; equivalent facts and safe behavior matter,
not identical client prose. The domain scenarios and implementation cases in the
source repository's `docs/conformance-scenarios.md` remain specified, not executed. Link, version and reproducible-package checks do not establish
domain acceptance, installation success or live backend behavior. Implementation
still needs validated persistent Skill flows and native template rendering; minimal inputs/results and safe
retry/partial-failure handling; Craft encodings; harness/control loading;
authorization/conflict checks; and actual migration/client/backend acceptance.
