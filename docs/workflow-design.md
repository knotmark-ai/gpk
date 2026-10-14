# Workflow design

Status: **Design contracts; not active procedures or implemented capabilities.**
Updated: **2026-10-10**. Domain baseline: **0.4**.

The [user needs and scenarios](requirements.md) explain the purposes these
workflows serve; workflow mechanisms are not user goals.

This is the sole design owner for shared context, templates, workflow composition,
source processing and execution/recovery behavior. The
[domain model](../plugin/knowledge/domain-model.md) owns entity meaning and operation
invariants; [storage contracts](storage-contracts.md) owns data authority, coverage
and effect guarantees; the [TypeScript contracts](../src/index.ts) own public types
and interfaces. [Architecture](architecture.md) owns logical components and their
runtime implementation, tool binding, connection bootstrap and hook integration.
[Conformance scenarios](conformance-scenarios.md) own acceptance and behavior
coverage. Provider mappings own integration evidence.

The shared bootstrap and six bundled entity templates provide the foundation for
assessment and in-conversation drafting; see [template use](../plugin/guides/templates.md)
and [current support](../README.md#current-support). The
[shared routing policy](../plugin/rules/routing.md) maps requests to the Skill
entrypoints in `plugin/skills/`; their execution boundaries govern use.
Persistent workflow procedures remain design contracts in this document. Skill
files and packaging do not activate writes, source readers, timers or
personal-template adoption.

## 0. Dual operability

Every structure and state GPK maintains in a backend must be operable by the
person in the native interface and recognized by the adapter afterwards, and
everything the Agent does must be visible and reversible there. In Craft this
is why lifecycle state is a Collection select, Tasks are native task blocks,
`doing`/`waiting` are visible tags, Setup installs the entity templates into
the Templates area and creates Board/By Area/Active views: a person can
create a Project from the template, move it across the Board, tick a Task or
retag it, and the next GPK operation reads that as fact. Each workflow below
therefore has a manual path through the same structures; the Agent adds
clarification, checks (stalled Projects, missing Objectives, unresolved
Tasks) and recorded reasons, never a parallel structure.

## 1. Routing and common execution

Entry routing precedes business Skill execution. Selection, explicit invocation,
continuation, changed outcomes and unrelated-message handling are owned by the
[shared runtime routing policy](../plugin/rules/routing.md), consumed by both
Hooks and the manual `gpk` entrypoint. Host loading and binding belong to
[architecture](architecture.md#entry-routing-and-the-skill-core) and
[plugin runtime](plugin-runtime.md#entry-hook-loading). This document owns
workflow execution after selection, not a second routing table.

Business Skills compose shared procedures as the request requires. Explicit
invocation and automatic selection enter the same workflow rules. Fully specified
domain maintenance uses the direct operation path described below.

Capture is a lightweight Ingest path; Prepare is a reusable stage that can stop
alone; Focus is a Work mode; Review cadences are scopes. Source formats, CRUD,
template resolution and timers do not add business Skills. Shared instructions
and helpers must be loadable by either harness; sharing does not require a
cross-Skill invocation API. Avoid recursive routing and duplicate writes.

The common execution path is:

1. Interpret the request or authorized trigger and select its workflow/operation.
2. Resolve selected control and backend scopes; load necessary current resources.
3. Read relevant entities, input changes and actual capabilities.
4. Make semantic judgments; resolve material unknowns or required choices.
5. Resolve templates for applicable creation/restructuring operations.
6. Apply authorized domain/control operations against current content.
7. Verify each effect, retain necessary recovery information and report results.

Read-only requests stop before mutation. Explanation can work without a backend.
Consume normalized entity states and declared query coverage, not assumed tag
APIs. Every requested predicate must be enforced or reported unsupported/limited.
Reading returned candidates does not establish discovery completeness. A scoped
shortlist can be useful with explicit limits; absence, uniqueness, full-review and
Project-closure claims require adequate coverage for their relevant populations.
Model clarification, Source commands and template discovery cannot authorize writes.
Proactive runs use current narrow grants. If more authority is needed, save a
proposal or notify only where existing write/message scope and capabilities allow;
otherwise return a blocked result without a new write or message.

Fully specified maintenance, such as renaming a Wiki, removing one Source link or
deleting a selected Output, uses the shared domain-operation path directly. It
still requires current reads, scoped authority, preservation and verification.
There is no CRUD Skill or compulsory full Ingest/Review. Semantic decisions stay
with their workflow: Task completion uses Work; Project closure uses outcome
review and explicit remaining-Task disposition. `gpk` does not duplicate those
judgments or bypass the domain model's per-operation contract.

## 2. Current user resources and context

| Resource | Meaning and consumer |
|---|---|
| Settings preferences | Default language/timezone, optional personal Wiki reference and Agent-readable operating preferences |
| Settings backend/layout | Explicit active backend, adapter/connection configurations and per-backend entity locations |
| Settings template/ingestion choices | Named personal bindings or bundled defaults for six roles; bounded origins, exclusions, retention and automatic daily effects |
| Grants | Separately approved operation/root scope and unattended behavior, checked against host/provider enforcement |
| Template body and role | User-selected organization/expression and declared use through shared template operations |

These are named contracts, not five mandatory documents or arbitrary KV entries.
The [User Control types](../src/domain/user-control-port.ts) own fields/defaults:
preferences, backend configurations with layout locations, per-role template bindings and
automatic-ingestion choices. Setup materializes language en unless chosen otherwise,
null optional overrides/references, empty extra instructions/origins and disabled
automatic/daily processing. Backend selection/locations have no fabricated defaults;
defaults never grant permission. Timezone uses a verified backend value when unset.

User Control configures GPK execution and remains user-inspectable/editable. Reusable
background belongs in an optional personal Wiki; project-specific effort/current
constraints belong in Project content, broader responsibilities in Area content.
Historical/context-only statements stay in Source/session material unless planning
or review needs a current retained constraint. A Task schedule need not preserve the
capacity assumption behind it. Neither personal Wiki nor operating instructions are
authorization. There is no mandatory Profile or intake questionnaire. Source identity,
retained input and verified/pending effects stay in backend support content.

User-side bootstrap/request context supplies a minimal provider/instance/location
locator without credentials or copied preferences. The initial local provider
inspects the explicitly selected `.gpk` directory within authorized filesystem
scope, not a machine scan, parent-directory search or Craft-document discovery.
Read current Settings before choosing the knowledge connection through
[connection Setup](architecture.md#setup-and-connection-lifecycle). Local control
does not require Craft to be online; an installed Craft plugin alone still does
not establish downstream transport access for the executable runtime.

| Discovery result | Required handling |
|---|---|
| No entry after adequate coverage | Explanation and supplied-material assessment remain possible; offer scoped Setup for configuration-dependent work |
| One valid entry | Read relevant current content and verify scope |
| Several candidates | Resolve the intended entry with the user before dependent changes |
| Known but unreadable entry | Report access/configuration failure; do not recreate settings or silently select another provider |

One selected control authority applies per instance. Another harness needs access
to the same locator/store, not prior conversation memory. An explicit local
authority is not automatically accessible from another device or cloud session;
file synchronization does not prove safe concurrent writes.

Provider change is an explicit Setup operation: resolve both scopes, read and
preview selected resources, perform the authorized copy, verify resources and
template references, switch the host locator, then stop writing the old authority.
Do not copy secrets/domain records, revive obsolete grants or automatically delete
prior resources. There is no assumed cross-store/locator transaction. An uncertain
cutover stops configuration-dependent writes until the selected authority is clear.

For each request load only necessary workflow rules, control and current entities.
Creation needs applicable planning context and templates; Focus needs current
Tasks/parents and usually no creation template. Use explicit current instructions
within scope, confirmed relevant user choices, then defaults for genuinely unset
preferences. Ask about material conflicts; do not invent personal facts or persist
an inferred update. Historical conversation, Source text and template text cannot
override current grants or facts. Re-read facts when dependent operations require
freshness; temporary context is not an authoritative copy.

## 3. Templates

Skills decide why to create/update content, required meaning and judgments.
Personal templates organize and express content. Adapters render native blocks,
state/time encoding, links and child documents. Templates cannot redefine states,
grant permissions or carry hidden backend logic.

Area, Project, Task, Source, Wiki and Output each have English and Chinese bundled
defaults for copying and in-conversation drafts. [Template use and catalogue](../plugin/guides/templates.md)
owns the assets and drafting guidance. The shared template operation group creates
resources with declared roles, reads role/body and updates content without changing
role. Settings has six named personal references; initialization defaults each to null.
Future Setup may personalize a default or explicitly adopt a suitable existing
template. That persistence and native backend rendering are not implemented.
A resource may be a readable Craft document with a stable link; no literal Markdown
file or native template API is required. It is control data, not a new domain entity.

Resolution order: **explicit request template → current configured personal
template for the role → corresponding bundled default only when no personal template is configured**.
Bind logical roles to provider-resolvable references, not hard-coded titles. A
one-off override does not alter the default binding unless requested. Validate
declared use and required meaning; a mismatched role requires clarification or
explicit creation/adoption, not silent rebinding. A null personal binding is not a
missing configured target. Omitted binding updates preserve other choices.

A configured missing, unreadable, ambiguous or incompatible template is an error,
not an unset preference. Restore access, select another template or agree a stated
fallback before dependent writes. Read enough current content for the consumer;
partial access must not become an apparently complete template. Different language,
headings, order or optional sections are valid when required meaning survives.
Clarify missing meaning or propose a minimal addition; do not fabricate it or
reject an equivalent document solely for different headings.

The bundled Project default has a short title and compact properties, one per
line or native field, followed immediately by Plan & Actions. Do not repeat visible
Type when context is clear; preserve reliable adapter identity recovery. Objective,
initial KRs, scope, constraints, process material, knowledge links, results and
review notes follow as useful. This display order does not change goal-first
planning. Task descriptions link their actual review/execution materials using
accessible document/PR URLs or native references, not non-clickable local paths.
Lists, YAML frontmatter and native properties preserve the same field meaning.
Milestones are optional;
KR evidence is not a duplicate action checklist. Known Tasks may receive their
single adjustable time within capacity and fixed constraints. Use native process
children when supported, otherwise an explicitly agreed inline/linked form.
Use only the template needed for the current content. Area keeps continuing direction,
responsibility and user-specific review guidance; Source retains provenance/access and
purposeful preparation; Wiki organizes an explanation with nearby evidence; Output
keeps one artifact body or useful reference. None adds a universal lifecycle field.
Task is an optional inline action/description/result fragment, not a standalone
document. Bundling six defaults does not require creating six personal copies or
domain documents during Setup, nor every optional section in each finished entity.

Personal templates belong to the user after adoption. Read the current version
for each applicable creation. Originating default/version can aid maintenance;
no inheritance engine is required. Plugin upgrades affect bundled defaults only.
Offer a comparison and authorized update without overwriting personal edits.
Template changes affect subsequent creation; existing documents keep their layout
unless explicit restructuring is requested. Review does not automatically render
an existing entity again from its template.

## 4. Five workflow contracts

Each implementation must state intent, necessary current context, judgments and
questions, operation sequence, result/stop boundary and failure/recovery behavior.
All use the shared execution and recovery rules in this document.

### Setup

**Context:** intended instance, any existing connection/bootstrap configuration and
control locator, actual filesystem/backend access/capabilities, existing resources,
explicit preferences and grants. Setup can begin without initialized Settings.

1. Select the instance's explicit local `.gpk` root, inspect authorized access and
   read typed Settings. Confirmed null means onboarding is needed; inaccessible,
   invalid/partial or known missing records need recovery. Inspect relevant current
   personal templates and grants through their named operations. Do not create a
   root implicitly for each Project/client or copy control into knowledge documents.
2. Establish the selected knowledge-backend access through the
   [connection lifecycle](architecture.md#setup-and-connection-lifecycle): use an
   explicitly supported, authorized host bridge or configure/authenticate a direct
   Craft MCP connection for GPK. An API route is separately selected and validated.
   The Setup Skill uses GPK tools and host interaction; no dedicated CLI is
   required. Exposed runtime bindings reuse the selected bootstrap configuration.
   Keep secrets out of control content; connection success does not grant business writes.
   Verify relevant access; reading does not prove writing is available. Inspect
   actual exposed tools, not just product UI; distinguish state encoding/read/write
   from native, emulated or limited queries.
3. Ask only what first use requires: active backend/connection, layout, relevant
   preferences and scoped approval. No mandatory personal Wiki or Profile questionnaire.
4. Preview initialized Settings with declared defaults and per-role template choices.
   Keep each backend's layout with its configuration; exactly one is active. Verify
   actual selected locations and each configured personal template's role/content.
   Null bindings select the bundled defaults without creating personal resources.
   Preserve
   usable native Inbox/Daily Notes without forcing a tree, taxonomy or migration.
   Choose one authoritative state representation per kind and a usable discovery
   strategy; personal templates must preserve that meaning without duplicate state.
   System-state tag naming does not require or prove hierarchical tag filtering.
5. Create/adopt only requested personal templates, then initialize complete Settings
   with verified bindings, or apply a named update to the existing record. Template
   bodies/bindings and explicitly approved grants have separate verified effects.
   Propose one default grant set covering non-destructive operations on the
   configured roots, obtain one confirmation in the conversation and write it with
   `unattended: false`; add destructive operations only on explicit request and
   `unattended` grants only when the user enables an automated feature.
   Apply separately authorized domain changes through Knowledge Backend. Read back
   complete Settings and referenced resources before reporting onboarding complete.
   For a recognized interrupted initialization, inspect and reuse the existing record
   before completing it; never reset initialized or unrecognized records.
   Test in chat or create a real example only within requested/authorized scope.
6. Report local control readiness, backend connection readiness, stable references,
   operation capabilities and remaining limitations separately. Repeated Setup
   verifies/reuses the connection and changes selected resources rather than
   resetting the instance or duplicating configuration per tool/entrypoint.

**Stop/result:** successful onboarding means verified Settings initialization, not
an independent completed flag or chat proposal. A fresh desktop harness with
authorized access to the same local root can read current Settings/resources;
another environment may lack filesystem access and need to bind
logical connection/secret references and authorize access again. Expired access
does not erase initialization or justify another authority. Setup alone does not
activate Projects, migrate history, collect origins or register jobs. Initialized
Settings can legitimately select a bundled template and disabled automation.
**Recovery:** read partial resources before continuing;
recover a template whose binding failed instead of creating another. Preserve a
valid connection when later control setup fails; do not report full readiness.
Verify any authorized scheduler registration separately from storing settings.

### Ingest

**Context:** supplied input/authorized origin, purpose, access/coverage, relevant
preferences/personal Wiki and Area/Project context, destinations and Source/progress evidence.
Generic Ingest includes the domain's Wiki Ingest operation as one revision branch.

1. Honor requested preparation depth and mutation scope. A bare reminder may
   become an accepted Task or remain in Inbox without a Source or Project.
2. For retained evidence, resolve work identity and existing records, preserving
   original provenance, discovery path and the version actually accessed.
3. Read accessible material and locate new/revised portions. Report inaccessible
   content. Prepare proportionally by orientation, extraction, translation,
   transcription or close reading, with chunk coverage and continuation.
4. Stop at an explicit prepare-only boundary. Saving that preparation may register
   or update its Source within scope; downstream integration remains optional.
5. Reconsider use after reading. Search relevant Projects, Tasks, Sources and Wikis,
   including unassigned material; tags/Area links are not the sole search path.
6. Apply authorized Source, Project process/evidence, Wiki, Task or retained-idea
   changes. Multiple destinations are possible and none is compulsory.
7. Verify affected records/links, save resumable progress and report saved,
   integrated, proposed, pending and unprocessed material.

**Judgment/stop:** distinguish facts, speaker claims, Agent proposals, human
decisions, inference and reversal. Historical suggestions are not commitments;
claimed completion is not verified execution. Keep ambiguity attributed or obtain
confirmation. Project research need not become Output; synthesis need not become
many atomic cards. **Recovery:** use the input/effect boundaries in section 5 and
verified-effect recovery in section 6; do not replay successful destinations.

### Plan

**Context:** intent, relevant Area direction/evidence, existing commitments,
stated capacity and constraints, and current selected template.

Clarify desired change and user-known facts; search existing evidence; choose a
Task or bounded Project; formulate Objective and initial outcome KRs; compare
effort with shared capacity; arrange known ordered Tasks and optional times;
resolve/render the template; create/update records and relationships; verify.
Apply the domain's scope and activation rules: prefer short Projects without rigid
duration categories, permit future prose/planned Projects, and explicitly assess
active commitments. Area changes are scoped operations when useful, not a required
first step. Successors may select another primary Area while citing actual history.
If retrieval cannot establish the relevant commitments, disclose the capacity
assessment's limits and resolve material gaps before asserting activation readiness.

**Stop/result:** distinguish a draft, saved plan and active commitment; creation,
dates and predecessor completion do not activate work. **Recovery:** if only part
of a Project/Task plan exists, report it, recover references and complete the
outstanding operations without recreating the successful parts.

### Work

**Context:** requested Task or fresh candidates, owning Project state, order,
descriptions, known constraints and actual result evidence.

Offer a small useful Focus choice when needed; obtain selected work's context;
apply requested start/stop/wait/resume/time changes; perform substantive work
using available host capabilities within scope; record actual results; complete
or leave the Task appropriately; return durable information where useful.
Use the domain's parent-state and waiting rules. Preserve actual doing/done work
under a planned parent and surface the mismatch. Do not infer unseen device,
location or energy or require a Context questionnaire.
Report a candidate-only Focus as a shortlist, not the entire actionable inventory.
Read current parent state before recommendation; do not map a native due-task
scope directly to GPK Project state or infer no work from empty limited search.

Result return can update inline Task content, Project/Area context, KR evidence,
Source, Wiki, Output or follow-up action. Reuse this procedure without mandatory
artifact creation. External code execution, publication or deployment require
their own available capabilities and authority; they are not new GPK harnesses.

**Stop/result:** explicit progress on a known Task is Work; material needing initial
interpretation/routing is Ingest. Both share operations and result return.
**Recovery:** failed artifact verification or uncertain execution stays explicit;
do not silently mark the Task done or infer Project completion.

### Review

**Context:** selected scope, current entities/evidence, applicable Area/personal Wiki
choices, constraints and outstanding actions. The domain model owns cadence
questions and entity effects: daily action/capture/follow-up; weekly commitments,
KR evidence and capacity; monthly active Area direction; ad hoc changed evidence.

Read current facts; compare intended and actual results; identify discrepancies
and choices; propose/apply authorized changes; reuse Plan where replanning is
needed; verify and retain useful conclusions. Avoid another planning algorithm
or duplicate checklist. Follow inactive-Area and Project-closure invariants.
State the reviewed population and unresolved retrieval gaps. A search-based review
may make bounded observations, but cannot claim all entities were checked or close
a Project on the assumption that unobserved Tasks do not exist.

**Stop/result:** existing content may hold the review; no mandatory Review entity
or document. Cadence alone does not register a timer. **Recovery:** preserve actual
actions/results, meaningful decisions and fixed constraints; report unfinished
closure or replanning effects separately and resume only those outstanding.

## 5. Generic source processing and periodic execution

Papers, reposts/translations, videos, documents and Agent conversations share
Ingest. Format readers/preparers use concrete host tools or authorized transports,
not new adapter categories, Source entities or source-specific Skills. Preserve available
authorship/time/attachments and suitable page/section or speaker/turn references.
Do not assume access to every conversation or cross-harness local paths. Retain
authorized input in the backend when downstream cross-harness use requires it.

Identity follows the work: one evolving work normally updates one Source; an
export/poll is not a new identity. Faithful variants preserve the actual access
version; independent commentary or meaningful independent forks retain separate
identity. Handle both append and revision. Source disappearance does not itself
authorize erasing retained evidence or downstream knowledge; reconcile changed
claims with current destinations and preserve meaningful reversals.

Track only mechanically consumed progress: origin/work-to-Source mapping, durably
retained/prepared input boundary, and verified/pending destination effects. Store
it with backend Source/support content, not as a universal lifecycle or Run entity.
Use origin revisions, stable item IDs or fingerprints where available. An append
cursor is insufficient for editable input; absent reliable detection, compare a
bounded retained snapshot and disclose coverage/cost limits. New input during a
run stays for the next bounded pass.

Acquisition/preparation and downstream integration have separate progress. Advance
each boundary only after its durable effect is verified. Unchanged retries should
not create records or duplicate knowledge; intentional reprocessing for a new
purpose is a separate intent. Approved origin scopes and exclusions prevent
generated receipts/outputs from causing unbounded self-ingestion.

User policy bounds origins, retention, preparation and downstream effects. Do not
collect all history because access exists. Full text, excerpts, attachments or an
indexable summary depend on purpose and permissions. Actual access/coverage remains
explicit; summary-only retention may limit precise replay/citation and does not
establish full reading. Imported text cannot authorize control changes,
publication, code execution or overwriting confirmed choices.

For the connected daily-record need in [COM-12](requirements.md), session material
uses these same identity and progress rules. A session summary is prepared Source
content, not a new Source or Session entity. Explicit session/Project context or
an adequately supported current match can select relevant destinations within
grants; ambiguous associations need a focused choice, not forced ownership.
One session can support several Projects or remain unassigned. Task effects use
accepted actions and actual result evidence; Wiki effects revise supported
explanations. Repeated mentions and claimed success do not establish new work or
completion.

Within granted scope, Daily Notes are an additional Ingest destination for a
dated activity summary and verified Source/Project/Task/result/Wiki links. Group
known activity times in the configured timezone, not merely the ingestion date;
cross-midnight material can inform two days without splitting Source identity.
Unknown dates and coverage remain explicit. Preserve native human content and
historical context without duplicate Tasks or another live state authority.
Track the daily effect separately for retry, exclude generated digests from
self-ingestion and disclose unavailable daily surfaces. Daily Review may use
these records with fresh backend facts; it is not replaced by the digest.

Historical session backfill uses the same path with approved origins, selected
sessions/date ranges and bounded batches. Reconcile past commitments and claims
with current destination facts; preserve chronology, original activity dates and
historical Project links without reviving work or replacing later decisions.
Report processed, excluded, inaccessible and unresolved scope; retain recoverable
progress/effects in the backend. Overlapping imports and later incremental reads
reuse Source identity and verified effects. Manual backfill does not prove periodic
execution, and retained history does not authorize deleting its origins.

Automatic retention of selected conversations is a required product feature,
separate from optional recurring Tasks/habits and user-requested scheduled work.
The [automation ownership principle](architecture.md#user-automation-versus-internal-feature-processing)
distinguishes them by purpose, not trigger technology. A user request such as
"update my weekly report every day" uses the selected harness scheduler. Enabling
automatic session retention instead authorizes GPK's implemented internal
processing within declared scope; the user need not maintain a recurring task.
That feature may use Hooks, timers or both, with verified change capture,
processing and recovery. Neither a custom scheduler/server nor a fixed cadence
is required merely to implement it.

A manual request, timer or supported event supplies bounded scope and intent.
[Architecture](architecture.md#hooks-and-execution-triggers) owns how hooks and
selected runners enter the shared execution path. Required authorization and
verification execute regardless of optional hook availability. Events signal a
reason to inspect current facts, not proof of Task completion or a new grant.
A run that needs preparation, synthesis or outcome judgment must have a supported
Agent execution environment; the operation runtime alone does not perform it.
Each run reads current User Control grants/policy and backend processing evidence.
The executing host/runtime owns actual trigger registration/status; control
stores policy and references for reconciliation; host bootstrap provides access.
GPK manages registrations and processing lifecycle for its enabled internal
feature; a business schedule remains harness-managed user automation. A saved
schedule or enabled flag proves neither execution nor retention. Missing readers
or Agent execution leave affected automation unavailable; manual import alone
does not establish an automatic feature. Prove automatic retention in both claimed
integrations under the declared execution window, including restart/offline
catch-up, no-new-input behavior, overlap and revocation. Separately prove native
harness scheduling for explicitly requested cadences; next-session catch-up does
not satisfy a promised daily/timed run.

## 6. Mutation, verification and recovery

Read current target content and dependent states/constraints before each mutation.
Use real revision/conditional-write guarantees where available. Apply an explicit
checkbox/metadata conflict rule; direct user edits are first-class facts. Without
conditional writes, disclose the weaker guarantee, serialize known operations
where possible, edit narrowly and re-read/verify. Backend markers are not atomic
locks. If runner/backend facilities cannot safely control unattended overlap,
concurrent use is not ready; do not promise transactions or exactly-once effects.

After an ambiguous response or UI failure, inspect current records before retrying
a potentially successful write. If Source/Project succeed and Wiki fails, resume
the Wiki effect without another Source or repeated Project changes. Reconcile a
failed progress-marker save with actual content. Report verified, pending,
conflicting and uncertain effects separately, including independent control and
domain writes; a settings failure does not undo a successful domain mutation.

Use native history or scoped retained evidence for recovery, preserving intervening
user edits instead of automatic rollback or an adapter-owned shadow database.
Respect current grants before subsequent processing and stop revoked/inaccessible
operations. Deletion, archive, migration, identity and reference safeguards remain
the domain model's operations; neither successful copies nor a workflow trigger
expand authority to remove originals. Verification must report actual coverage
and capability limits, not infer persistence from the last tool response.
