# Storage Port Contracts and Data Ownership

Status: **Contract map and behavior requirements for the storage ports.**
Updated: **2026-10-10**. Domain baseline: **0.4**.

A **port** defines the operations GPK needs from an external store; an **adapter**
implements them using a provider's documents, blocks, files or API. Use `Port` for
interfaces and `Adapter` for concrete implementations. The
[domain model](../plugin/knowledge/domain-model.md) owns meaning and invariants;
shared domain/workflow logic owns business decisions and reusable checks. Adapters
map operations to native storage without redefining those rules. The
[GPK runtime](architecture.md#where-the-adapter-runs) constructs adapters and calls
them through their ports. No extra wrapper or dedicated CLI is required.

## Public contracts

| Responsibility | Authoritative source |
|---|---|
| Entity projections, concrete references and states | [Domain types](../src/domain/entities.ts) |
| Knowledge operations and their inputs/queries | [KnowledgeBackendPort](../src/domain/knowledge-backend-port.ts) |
| Selected user settings, grants and templates | [UserControlPort](../src/domain/user-control-port.ts) |
| Shared results, coverage, capabilities, read options, guards and receipts | [Operation types](../src/domain/operation-types.ts) |
| Public type exports | [Entrypoint](../src/index.ts) |

Domain data and operation contracts live together in `src/domain/`. `entities.ts`
contains entity data, references and states; each port file contains its complete
contract and specific input/query types. `operation-types.ts` holds the types used
by both ports. `src/index.ts` exports the public contracts. Knowledge operations
stay grouped in one port file, with no file per entity.

`Port` describes the interface's dependency role, not a separate layer outside the
domain. These contracts express required knowledge/control capabilities; concrete
adapters implement them. Semantic workflow decisions remain with the Agent/user,
and reusable deterministic rules belong in shared domain/workflow code as needed.

Entities, references and creation inputs are declared independently. A change to
a read projection must not silently change creation requirements. Fields use their
applicable concrete references; cross-entity parameters list their allowed kinds
locally. Similar shapes alone do not justify a base entity or generic operation
interface. Declare only applicable fields, without listing unrelated fields as
forbidden properties. TypeScript uses structural compatibility and does not validate
external data at runtime; implementations must validate operation inputs at their
boundary. Snapshots and create receipts retain the concrete reference type.

Entity data does not repeat `kind`: the operation and the snapshot's concrete
reference identify its type. References retain `kind` to distinguish operation
targets and narrow contextual link endpoints. Data shapes may coincide, such as
Source and Wiki content; identity and routing use references. Adapters still
validate the actual backend entity kind when resolving and reading a record.

TypeScript JSDoc owns parameter meaning, formats, omission/null/empty behavior,
cursor scope and revision targets; this guide owns cross-operation guarantees.
Read the method comments and referenced types when implementing an operation.
Provider mappings document locator forms, content encoding, read budget
units/defaults and capability limits; they preserve parameter semantics or report
a limitation/failure. Public signatures remain in TypeScript.

Knowledge read operations (`capabilities`, `resolve`, `read`, `query`) are stable.
User Control has named Settings, template and grant contracts instead
of a generic key/value API. Task writes have their first provider caller (the Craft
adapter); other writes remain draft until theirs exists.
`pnpm build:types` emits declarations with JSDoc into ignored `dist/types/`;
`pnpm test:types` checks source and emitted consumers. Declarations do not register
Agent tools. Concrete provider code belongs in `src/adapters/` when implemented;
see [adapter development](adapters/README.md).

## 1. Two storage ports and the host boundary

| Port | Required operations | Initial adapter target |
|---|---|---|
| KnowledgeBackendPort | Persisting and retrieving domain facts and processing evidence | Craft through the actual authorized MCP surface; API only when separately configured and verified |
| UserControlPort | Discovering control and maintaining typed Settings, role-declared templates and scoped grants | Local files in one explicitly selected `.gpk` directory; JSON configuration/grants and Markdown personal templates |

Later providers are tracked in the [roadmap](roadmap.md#milestone-2-extensibility-and-common-platform-coverage).

A **store owns persistent data; an adapter owns no persistent truth**. A local
configuration directory explicitly selected by the user is a legitimate control
store, not an adapter cache. Likewise a future service can own control records
without turning the adapter into a stateful service. The two contracts do not
require separate packages, processes or physical stores. Hosts load Skills and
provide conversation/tools independently of storage ports.

| Data | Authority | Reason |
|---|---|---|
| Area, Project, Task, Source, Wiki, Output and their links | Knowledge Backend | Latest domain facts must survive harness changes |
| Origin-to-Source identity and verified acquisition/integration checkpoints | Knowledge Backend | Describe actual retained material and completed/pending domain effects |
| Personal background, skills and actual capacity/commitments | Knowledge Backend | Reusable personal Wiki or scoped Area/Project content; no duplicate Profile database |
| Operating preferences, backend/connection selection, layout, template bindings/bodies and scoped grants | Selected User Control store | Configure how GPK runs and where it reads/writes |
| Which origins to ingest, retention choices, requested cadence, runner registration reference | Selected User Control store | Configuration of what is allowed and intended, not proof that processing occurred |
| Actual scheduler registration and execution status | Selected host/runner | External execution infrastructure; registration is not copied as a second job engine |
| Secrets and minimal connection/control locator | Executing host/runtime bootstrap and selected secret mechanism | Reach control before Settings. Backend tokens live in a host-neutral secret store on the machine (the OS keychain on macOS), keyed by GPK instance, so every desktop harness that launches this instance reuses one provider authorization; Settings names only the logical reference. A remote deployment uses its service-side store. Settings may name safe endpoints and logical secret/connection references, never secret values |

Each instance selects one control authority. The initial authority is a stable local
`.gpk` root shared by authorized desktop clients, not a directory for every Project
or harness. No implicit directory/provider fallback, automatic merging of competing
Profiles or multi-master sync. Keep this private root outside public repositories
or explicitly excluded from version control; it is not knowledge content or a plugin cache.
Derived caches may be discarded; they cannot override a current authoritative read.

[Connection Setup](architecture.md#setup-and-connection-lifecycle) establishes
authorized local-file access separately from knowledge transport. Bootstrap stores
the access seed and locator, not a second Settings, template or grants database. Settings owns the
configured backend selections and safe connection descriptions. Sensitive endpoints
and credentials stay in secret facilities and are referenced by logical name. Reuse
of a host-held connection requires an explicit supported bridge; a direct GPK MCP
Client authenticates independently when required. Connection access does not
replace current operation grants, and reconnecting does not select a new authority.

## 2. Common contract vocabulary

Operations return a discriminated success/failure result. Reads carry scope,
coverage and optional continuation; complete results cannot have a next page.
Snapshots may include a provider version. Mutation requests carry a write guard;
receipts identify affected references, verification and recovery information.
Creation receipts additionally identify the canonical created reference.

These are operation envelopes, not properties added to all six entities.
`expected` is an atomic precondition **only when the selected capability says so**;
a content fingerprint can detect divergence without preventing a concurrent edit.
Authorization never travels in operation input. A knowledge mutation carries the
grant that the runtime resolved from the selected control store for this backend,
root and operation; the adapter re-checks containment against provider structure
and fails `unauthorized` when the grant is missing or does not cover the target.
Control mutations carry no grant: Setup's interactive session and the host's tool
approval authorize them, since grants cannot exist before Setup writes them.
Unknown state, incomplete search and inaccessible content must not be returned as
an empty, complete result that asserts absence. Report partial effects even if the final tool call failed.
Creation returns the canonical created reference explicitly; `affected` is not an
ordered return-value convention. Reads and discovery carry coverage/continuation;
an incomplete Project read cannot establish that no unfinished child Tasks remain.

Each port implementation operates in an explicitly bound instance/provider scope.
The binding is recovered from selected stores, not a private adapter database.

## 3. Knowledge Backend Port

Each entity interface declares its operations, query predicates and inputs
independently. The [KnowledgeBackendPort](../src/domain/knowledge-backend-port.ts)
groups them as follows:

| Entry | Responsibility |
|---|---|
| `areas` | Direction documents and active/inactive state |
| `projects` | Primary Area, lifecycle, Task order and process material |
| `tasks` | Optional primary Project, lifecycle and one planned time |
| `sources`, `wikis`, `outputs` | Evidence, synthesis and artifacts, without a universal lifecycle |
| `captures`, `links`, `checkpoints` | Capture surfaces, contextual links and verified progress |

Each entity entry has typed references, reads, queries and guarded edits. Queries
accept that entity's states and predicates. There is no root generic entity CRUD
or block/file API. Provider-native placement and editing primitives belong inside
the implementation.

Project creation requires a primary Area; Task creation can be standalone. Primary
ownership is explicit and independent of physical containers and contextual links.
Project queries can select a primary Area; Task queries can select a Project or
standalone ownership. Resolve referenced kind, scope and existence before writes;
a well-typed ID does not prove them. Inactive Areas remain valid targets. Assignment
must preserve unrelated links and significant history; no implicit cascade.

Entity values are working projections, not required database rows. Prose and links
can encode their typed meaning without adding universal metadata. The physical
form of a Task is a provider decision: in Craft it is a native task block inside
its Project page or Daily Note, in Notion it will be a record in a tasks
database with a relation to its Project, in Obsidian whatever the selected task
plugin indexes. The port's `TaskRef`, projection and operations do not change
across these forms; only placement, recognition and query cost do. A partial read
must state its coverage. Complete lifecycle reads must resolve state; complete
Project reads must resolve the primary Area. On a partial Task read, an omitted
Project/time is unknown, not proof of standalone/unscheduled status.
Preserve native children, formatting and unknown content. Prose edits match exact,
unique current text and change only that fragment; ambiguous or stale matches fail.
They cannot bypass state, time or ownership operations, even when those values are
encoded as readable text. Never replace an entire document from a thin projection.

### Content pass-through and structured recovery

An adapter divides every record into two parts with different owners.

| Part | What it is | Who interprets it | Adapter obligation |
|---|---|---|---|
| Body content | The record's readable text in the provider's own dialect: Craft block markdown with `<highlight>` and `block://` extensions, Notion-flavored Markdown, Lark XML, an Obsidian file | The Agent, after reading it | Pass it through unchanged in both directions. No CommonMark normalization, HTML sanitizing, re-rendering or section recognition. Edits are narrow literal replacements applied at the provider's native edit granularity |
| Structured facts | Entity kind, identity, lifecycle state, the single Task time, primary ownership, plan order and link endpoints | The adapter, deterministically, with no model in the loop | Recover each fact from one selected authoritative encoding, expose it through the typed projection and predicates, and fail `ambiguous` rather than guess |

The split follows from who calls each operation. Queries, transitions and
verification run inside the GPK process without an Agent, so the facts they
depend on must be machine-recoverable. Objectives, Key Results, descriptions
and results are read by the Agent, so the adapter neither parses nor
understands them. The domain model's rule that structure serves an actual
deterministic consumer names exactly the facts in the second row; everything
else stays prose.

Consequences for implementation:

- `content` is opaque to the adapter. The adapter knows block or line
  boundaries, the provider's edit unit and any rendering prefix the read form
  adds (for example a list marker and indentation that must be stripped before a
  block-level write); it does not know which paragraph is the Objective.
- Markdown-to-native conversion belongs to the provider where it offers one
  (Craft, Notion and Lark parse and render markdown server-side) and to the
  adapter only where the provider stores text directly (Obsidian). Neither case
  introduces an intermediate document model into the port.
- A structured fact may be stored in a native field, a native property or one
  reserved readable row. Whichever encoding is selected, the adapter reads only
  that location, never any mention of the same value elsewhere in prose, and a
  `TextEdit` cannot change it even when it is readable text.
- The Agent preserves inline formatting it did not intend to change. A literal
  `before` that includes dialect markup makes that markup visible to the caller;
  the adapter does not repair formatting on the caller's behalf.
- Cross-provider migration is the only operation that converts dialects, and it
  reports what each conversion drops through `Result.limits`.

### State representation and query guarantees

`projects.query({ states: ["active"] })` requests domain meaning, not
`filterByTag`. A provider can represent that state with a native field, a reserved
system tag or a documented content convention. Representation/read/write support
does not establish native filtering, indexing or tag-hierarchy support. Select one
authoritative encoding; templates cannot introduce a competing state value.

- Enforce the entity kind implied by the selected entry and every supplied
  predicate, including primary ownership, contextual links, state and Task time.
  Multiple values within `states` are alternatives; different supplied predicates
  are combined. Query scope stays within the bound authorized store. Reject invalid
  combinations. Never silently drop a filter or substitute a provider's differently defined `active` scope.
- Declare capability per supported predicate, scope and retrieval strategy, not
  merely `query: supported`. Name the domain operation/predicate, such as
  `projects.query.states` or `tasks.schedule`. Native means the exposed tool fulfills
  the required semantics; emulated means composition over current backend facts preserves them.
  A limited candidate strategy is degraded; an unavailable strategy is unsupported.
  Use existing `Capability`, `Result.limits` and coverage/error envelopes, not a
  second query model or adapter-owned state database.
- An exhaustive scoped route enumerates the relevant population, follows required
  document/child pages, reads authoritative state and filters in request memory.
  Declare the scope, traversal and concurrency limits. A folder alone establishes
  completeness only if the selected placement convention covers the requested
  population there; it does not establish logical ownership.
- A search-candidate route reads current candidate content before applying all
  predicates. This removes false positives but cannot recover index omissions.
  Exhausting search cursors does not prove exhaustive domain coverage, especially
  after recent writes. Declare partial/unknown coverage unless additional evidence
  proves completeness for the requested scope.
- `Page.coverage` describes discovery coverage for the requested scope, not merely
  correctness of returned rows. With `next`, the result set is still partial;
  exhausting continuation is necessary, not sufficient, for a complete inventory.
  `Snapshot.coverage` describes that record's read coverage. Unreadable records,
  scan budgets, invalid cursors and changes during traversal must remain explicit;
  do not promise an atomic snapshot without backend support.
- A verified exhaustive query may return an empty complete result. No matches in
  limited search return partial/unknown coverage with limits, not proof of absence.
  If the predicate cannot be evaluated at all, return a relevant failure rather
  than unfiltered rows. Include unresolved records/conflicts in limits or failure
  details, never silently exclude them while claiming complete coverage.

Query emulation does not authorize writes, state migration or conflict repair.
Read current facts each time; preserve native user edits and apply the documented
encoding conflict rule or report ambiguity. UI filtering is not MCP/API evidence.

### Content and effect boundaries

Capture operations support Inbox and Daily Notes, and Project material operations
support research, drafts and decisions under the owning Project. These are support
records, not additional entities. Surface resolution is read-only; an absent or
unsupported surface is reported, not created implicitly. A daily date uses the
configured instance timezone. Appends preserve existing material and native nested
content. Requested child-document presentation is capability-gated; do not silently
flatten it or fabricate another Wiki. An agreed inline/link fallback can be a
separate operation. Read coverage includes the material needed by the consumer;
a list of first-level blocks is not a complete read of nested content. Listing and
individual-record reads have separate continuation and coverage; follow each
record's continuation through its read operation before relying on full content.

Capture and process-material edits cannot mutate recognized entities through a
raw-content shortcut. Accepted actions use Task operations, not arbitrary checkbox
insertion. Native document/block/file operations remain provider internals.
Archiving/restoring changes presentation only, not lifecycle or primary ownership.
Reordering a Project plan verifies current membership and complete plan coverage;
it never implicitly reparents Tasks. Contextual link removal cannot unlink the
required primary Area or bypass the Task assignment operation.

Workflows compose these operations. Project completion requires an outcome
assessment and explicit disposition of remaining Tasks before persisting the
transition. Shared domain/workflow logic checks current state and preconditions
and rejects absent or ambiguous evidence; an adapter persists the accepted effects
without independently deciding that an Objective was achieved. Port implementations
must enforce those shared preconditions, including on direct calls.
The same checks apply to direct creation in active or terminal states. Creating
a Project and its Tasks is a verified sequence, not an assumed atomic call.
Removal does not cascade; unresolved child/reference impact prevents claiming a
safe deletion. An inbound-link scan reports its actual coverage.

Checkpoint documents or sections are operational support content, not another
domain entity or a User Control preference. Store progress after its corresponding
effect is verified. A failed checkpoint write requires inspecting actual entities
before replay. Initial checkpoint payloads may be readable text; only fields
consumed by implemented retry helpers need structured schemas.

The [Craft mapping](adapters/craft.md) records concrete encoding
choices, tool mappings, dated observations and outstanding read/write checks.
Evidence from one connection does not establish another connection's capabilities.
Enable mutations only after the relevant mapping and templates are implemented
and validated; interface signatures alone do not provide write support.

## 4. User Control Port

The public contract has three named operation groups: Settings, templates
and grants. There is no arbitrary resource key, media-type payload, prefix listing
or generic deletion API. TypeScript owns their fields, defaults and parameter
semantics. A provider may use files, native sections or KV internally; that
representation does not become the domain-facing interface.

Settings has nested preferences, backend selection/configurations, per-backend
layout locations, six named template bindings and automatic-ingestion policy. One
active configuration is explicitly selected from unique IDs; no first-item
selection, federation or failure fallback. Backend changes require verified
selection/cutover, not automatic fact/grant migration. Configuring an adapter or
transport does not establish that it is implemented or connected.

Safe MCP/API descriptions belong in Settings. Capability URLs and credentials use
host-resolved secret references; stdio uses an approved host profile. Bootstrap
still needs a minimal route to control before it can read Settings. Another host
may need to authorize the logical secret/profile reference independently.

Setup is the primary Settings writer. Onboarding succeeds when complete valid
Settings, actual active backend/layout and selected resources have been verified,
initialized and read back. A completed flag, draft, empty file or login is not enough.
Defaults materialize safe preferences and disabled automation, never invented
placement or permissions. Bundled templates are valid; missing configured personal
templates are not. A Profile or enabled automatic ingestion is not required. Later
connection failure requires reconnection, not recreation of the initialized instance.

Null Settings means confirmed never initialized. Missing known targets, denied access,
invalid/unsupported schemas and partial records are not unset/default configurations.
Discovery needs adequate coverage to infer absence/uniqueness. Reads remain read-only.
Named updates preserve omitted fields and unknown native content; defaults do not
reset existing choices. Initialization may complete a recognized interrupted record
after explicit inspection, reusing its identity and preserving current choices unless
the user authorizes changes. Revision guards address that existing record; already
initialized or unrecognized records cannot be reset by initialization. Unknown effects
require inspection before retry, not blind duplicate creation. Settings/template reads
accept their own continuation and budget through the shared read options.

Personal background/skills belong in an optional Wiki; Settings only references it.
Project capacity/constraints stay with that Project, shared responsibilities with
the relevant Area, and historical statements with their Source. Operating instructions
are Agent-readable preferences, not facts or authority.

Template creation/update and Settings binding have independent verified effects.
The shared template group serves Area, Project, Task, Source, Wiki and Output;
it is not six copies of the same API or arbitrary template keys. Creation declares
the role, read returns it with the body, and content updates do not change it.
Binding checks actual resource scope, declared role and suitable meaning rather
than accepting a matching title. A role change requires explicit creation/adoption.
All six bundled defaults are available in English and Chinese. Null bindings use
them without creating personal resources; supplied personal references must be
verified. Omitted binding updates preserve choices, while null clears only the
named override. Recognized omitted bindings normalize to null without resetting
existing bindings or repairing storage on read. Task content remains an inline
description/result fragment, not a mandatory knowledge document.
[Template resolution](workflow-design.md#3-templates) remains shared workflow logic.
Read complete current content; inaccessible references never silently choose a default.
Grants have separate list/grant/revoke operations. Ordinary Settings edits cannot add
them; require explicit current human/host approval. Validate implemented operation IDs,
backend/root scope, containment and unattended permission against current host/provider
enforcement. No wildcard or boolean write grant.

Three layers authorize a knowledge write, each enforced by its owner and none
readable from tool arguments:

| Layer | Who grants it | Who enforces it | Scope |
|---|---|---|---|
| Provider connection | The user approves GPK's own OAuth client in the provider; read-only or write access is set there | The provider | The whole space; GPK cannot exceed it |
| Host tool approval | The user allows each GPK tool call, or an allow list | The host, per call in interactive sessions | One tool invocation; invisible to the GPK process |
| GPK grant | The user confirms Setup's proposed grant set in the conversation | The GPK runtime and the adapter, per operation | One backend, root and operation list |

The runtime reads the grant store fresh before every knowledge mutation, selects
the grant covering the backend, root and operation, and passes that record to the
port; the adapter re-checks containment with provider structure. No covering grant
is `unauthorized` with Setup as the next step. Setup proposes one default set:
non-destructive operations on the configured Collections, layout locations and
capture surfaces, `unattended: false`. `remove`, `archive` and `restore` are
excluded from the default and granted only on explicit request. Cancellation is
a `transition` and cannot be separated by operation ID; its tool carries
`destructiveHint` so hosts prompt separately. `unattended: true`
is written only when the user enables an automated feature, and unattended runs
accept nothing else. Deleting or editing the store takes effect on the next call;
provider-side revocation follows the provider's token lifetime.

The [local control adapter mapping](adapters/local-control.md) maps these records to
JSON Settings/grants and role-declared Markdown templates in the selected `.gpk`
root. Reading control does not require Craft access. Backend facts and progress
still belong in Craft, not in these files. A service-backed provider is deferred
until mobile access needs it; migration must preserve these contracts and explicitly
select one authority. Note-backed control is not an MVP target; reconsider it only
with suitable native/plugin-private configuration storage rather than user-visible
knowledge documents. Internal registration references remain control support
data with a concrete host consumer; actual job state stays host-owned. Define its named
implementation contract with that runner, not a generic KV escape.
[Discovery and cutover](workflow-design.md#2-current-user-resources-and-context)
remain shared orchestration; independent control/domain writes retain separate outcomes.

## 5. Host execution boundary

Plugin manifests and Skills are loaded by the host. The Agent asks questions and
selects available tools through that host; no TypeScript Harness interface is
registered or instantiated. GPK code needs a concrete entrypoint and an authorized
transport before it can call a backend. The first GPK-facing binding is MCP stdio
and invokes shared handlers; a future Streamable HTTP binding and optional CLI
reuse those handlers, ports and result semantics. Transport authentication is
separate from current operation grants and backend access. An outbound MCP Client can connect to
Craft independently of the incoming binding. A Node helper
does not automatically inherit the current conversation's MCP tools, credentials
or permissions. Pass bounded input for mechanical work, use a validated explicit
host bridge, or implement the required authorized transport. See the
[runtime architecture](architecture.md#where-the-adapter-runs).
A conversation answer is not itself a hard permission gate; host controls and the
current operation grant remain the actual boundary.

[Plugin runtime](plugin-runtime.md) describes package/resource loading
and host limits. Do not extrapolate support across CLI, desktop, cloud or other
product surfaces. Readers and triggers need separate integration evidence.
[Source and periodic-execution contracts](workflow-design.md#5-generic-source-processing-and-periodic-execution)
define how available host facilities compose shared Ingest; neither package
currently implements a reader or timer.

## 6. Contract verification

The [conformance scenarios](conformance-scenarios.md) are the sole
acceptance inventory for domain behavior, workflow coverage and implementation
cases, including interface checks and evidence requirements. Packaging or mock
checks do not establish live integration conformance.
