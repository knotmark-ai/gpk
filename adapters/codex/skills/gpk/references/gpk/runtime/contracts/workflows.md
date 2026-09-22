# Shared Workflow Contracts

Status: **Design contracts; not active procedures or implemented capabilities.**
Updated: **2026-09-12**. Domain baseline: **0.4**. Package: **0.1.0**.

This is the sole design owner for shared context, templates, workflow composition,
source processing and execution/recovery behavior. The
[domain model](../../knowledge/domain-model.md) owns entity meaning and operation
invariants; [adapter contracts](adapters.md) own public interfaces, data authority,
coverage and operation envelopes. [Conformance scenarios](../../knowledge/conformance-scenarios.md)
own acceptance and behavior coverage. Provider mappings own integration evidence.

Only the shared read-only `gpk` bootstrap is implemented. The five business Skills
have inactive `SKILL.md.stub` files with metadata and no procedure bodies. Shared
procedure and default-template stubs remain inactive. These contracts guide their
later implementation; they do not activate writes, readers, timers or templates.

## 1. Routing and common execution

| Entry | Intent | Intended result |
|---|---|---|
| `gpk` | Understand GPK, query records, or express an intent naturally | Answer or dispatch to a workflow or defined domain operation |
| `gpk-setup` | Establish or change the user's GPK configuration | Verified settings and adopted/personalized resources |
| `gpk-ingest` | Bring information or source changes into knowledge and work | Retained input and useful entity changes, or a scoped proposal |
| `gpk-plan` | Turn direction or intent into an action plan | Bounded Projects/Tasks, initial KRs and an explicit commitment decision |
| `gpk-work` | Choose/advance current work or record an actual result | Focus choices, Task changes and result return |
| `gpk-review` | Compare intention with reality and recalibrate | Evidence-based adjustments to direction, commitments and plans |

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
| Profile/preferences | Language, relevant background, stated capacity and planning/reading choices for Agent judgment |
| Configuration/bindings | Selected scopes, control entry, destinations and template references for Agent and actual resolvers |
| Authorization | Approved scope, mutation boundaries and permitted unattended behavior, checked against host enforcement |
| Personal templates | User-selected organization and expression for Agent and renderer |
| Origin/execution policy | Approved origins, exclusions, retention, cadence, selected runner and registration reference |

These are logical responsibilities, not five mandatory documents. Begin with one
discoverable control entry and link additional resources only when useful. Use
text for narrative choices and structured values for actual consumers. Timezone
is needed to interpret scheduled times, not as a compulsory Profile questionnaire.
Area content holds actual continuing direction and responsibilities; Skills supply
general method. Neither replaces current Project/Task facts or grants authority.
Actual Source identity, retained input and verified/pending domain effects belong
to backend support content, not Profile or origin policy; see adapter authority.

The host/request supplies a minimal provider/instance/location locator without
credentials or copied preferences. Discover within its authorized scope. The
initial knowledge-backed provider uses existing Craft access, a documented marker
and stable reference; Setup must validate the marker/query before relying on it.
A future local provider uses an explicitly selected directory, not a machine scan.

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
preferences. Ask about material conflicts; do not invent Profile facts or persist
an inferred update. Historical conversation, Source text and template text cannot
override current grants or facts. Re-read facts when dependent operations require
freshness; temporary context is not an authoritative copy.

## 3. Templates

Skills decide why to create/update content, required meaning and judgments.
Personal templates organize and express content. Adapters render native blocks,
state/time encoding, links and child documents. Templates cannot redefine states,
grant permissions or carry hidden backend logic.

The reserved `default_project_template.md.stub` is empty and unusable. Once a
default is implemented and validated, Setup may personalize it or adopt an existing
template as the user's logical `project_template.md` resource in selected control.
This may be a readable Craft document with a stable link; no literal Markdown file
or native template API is required.

Resolution order: **explicit request template → current configured personal
template → bundled default only when no personal template is configured**.
Bind logical roles to provider-resolvable references, not hard-coded titles. A
one-off override does not alter the default binding unless requested.

A configured missing, unreadable, ambiguous or incompatible template is an error,
not an unset preference. Restore access, select another template or agree a stated
fallback before dependent writes. Read enough current content for the consumer;
partial access must not become an apparently complete template. Different language,
headings, order or optional sections are valid when required meaning survives.
Clarify missing meaning or propose a minimal addition; do not fabricate it or
reject an equivalent document solely for different headings.

The intended Project default has a short title and compact properties, one per
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
Start with the template needed for the first useful workflow, normally Project;
add others as needed instead of empty forms for every entity or elaborate Tasks.

Personal templates belong to the user after adoption. Read the current version
for each applicable creation. Originating default/version can aid maintenance;
no inheritance engine is required. Plugin upgrades affect bundled defaults only.
Offer a comparison and authorized update without overwriting personal edits.
Template changes affect subsequent creation; existing documents keep their layout
unless explicit restructuring is requested. Review does not automatically render
a Project again from its template.

## 4. Five workflow contracts

Each implementation must state intent, necessary current context, judgments and
questions, operation sequence, result/stop boundary and failure/recovery behavior.
All use the shared execution and recovery rules in this document.

### Setup

**Context:** selected control locator, accessible backend scope, actual read/write
capabilities, existing resources, explicit preferences and grants.

1. Identify intended providers/scopes and check relevant access; reading does not
   prove writing is available. Inspect actual exposed tools, not just product UI;
   distinguish state encoding/read/write from native, emulated or limited queries.
2. Discover settings/templates, resolve duplicate/broken entries and adopt useful
   existing content.
3. Ask only what first use requires: relevant preferences, purpose and scoped
   authorization. Defer unrelated Profile details.
4. Preview minimal settings/destinations and the first personal template. Preserve
   usable native Inbox/Daily Notes without forcing a tree, taxonomy or migration.
   Choose one authoritative state representation per kind and a usable discovery
   strategy; personal templates must preserve that meaning without duplicate state.
   System-state tag naming does not require or prove hierarchical tag filtering.
5. Apply control/template changes through User Control and separately authorized
   domain changes through Knowledge Backend; read back resources and bindings.
   Test in chat or create a real example only within requested/authorized scope.
6. Report stable references, readiness and remaining limitations. Repeated Setup
   changes selected resources rather than resetting the instance.

**Stop/result:** a fresh harness with access can find current resources. Report
missing access. Setup alone does not activate Projects, migrate history, collect
origins or register jobs. **Recovery:** read partial resources before continuing;
recover a template whose binding failed instead of creating another. Verify any
authorized scheduler registration separately from storing settings.

### Ingest

**Context:** supplied input/authorized origin, purpose, access/coverage, relevant
Profile/Area/Project context, current destinations and Source/progress evidence.
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

**Context:** selected scope, current entities/evidence, applicable Area/Profile
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
Ingest. Format readers/preparers are helpers under Harness capabilities, not new
adapter categories, Source entities or source-specific Skills. Preserve available
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

Periodic Ingest is a required product acceptance scenario, separate from optional
habit/recurring-Task automation. It composes a validated source reader, real
authorized trigger, shared Ingest and writable backend. Use a supported host
facility or explicitly selected existing runner; do not assume/install a scheduler
or require a GPK server. Trigger registration and source scope need authorization.

A manual request, timer or supported event supplies bounded scope and intent.
Each run reads current User Control grants/policy and backend processing evidence.
The runner owns its actual job registration/status; control stores the reference
needed for reconciliation; host bootstrap provides access. A saved schedule is
not a running job. Unavailable readers/runners leave periodic support incomplete:
manual import and next-session catch-up cannot substitute. Prove timed execution
in both claimed integrations, offline catch-up, restart, no-new-input behavior,
overlap handling and revocation before claiming completion.

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
