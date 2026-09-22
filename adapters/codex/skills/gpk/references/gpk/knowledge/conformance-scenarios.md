# Conformance Scenarios

Domain baseline: **0.4**. Package version: **0.1.0**.

Status: **20 domain scenarios and 31 implementation cases specified, not executed;
13 behavior coverage rows designed, not runtime-verified.**

This is the sole acceptance inventory for the [domain model](domain-model.md),
[workflow contracts](../runtime/contracts/workflows.md) and
[adapter contracts](../runtime/contracts/adapters.md). It specifies observable
behavior, not executable tests or implementation success. Stable IDs A1–A9 cover
actions/review, K1–K6 knowledge and S1–S5 integration integrity; T/I/P/O/W/C identify
additional implementation cases. All people, Areas and Projects are synthetic.
Only the shared read-only `gpk` bootstrap is implemented; the five business Skill
stubs remain inactive.

The initial implementation targets Codex and Claude Code with Craft. Run
representative scenarios through both harnesses after implementation. For later
portability checks, vary one harness or backend at a time; a second production
backend is not required for the initial scope. Compare facts, relationships,
evidence, and authorization—not identical Agent wording.

## Actions and review

### A1 — A reimbursement reminder stays small

- **Scope:** Capture, clarification, standalone Task, and result retention.
- **Input:** Inbox contains “Submit the dinner reimbursement by Friday,” a
  receipt, and no Area or Project relationship.
- **Action:** The user asks to organize the reminder, then later to complete it.
- **Expected:** Clarification creates a standalone `todo` Task with one planned
  time and a useful receipt reference. The fixed Friday commitment is clear in
  its text. Actual submission information can remain in the Task result. No
  Goal, Project, Wiki, or Output is required. An unclarified capture is not a
  Task with a `captured` state.
- **Failure:** The reminder requires an artificial Project or Area, gains extra
  lifecycle states, loses its fixed constraint, or is completed without evidence.

### A2 — Initialize a bounded Project

- **Scope:** Project initialization, primary Area, planning, and activation.
- **Input:** An active Area describes a Vision, Responsibility, present
  circumstances, and possible changes or stages in prose.
- **Action:** The user selects a next Objective.
- **Expected:** Ask for relevant information the user already knows and search
  existing evidence where useful. Choose a primary Area from the Project's
  purpose and link other relevant Areas as context. A bounded candidate can be
  created as `planned` with a tentative Objective, initial KRs, an expected
  horizon, and known Tasks with adjustable times. Before activation, clarify
  the Objective, calibrate initial KRs and known Tasks, and check effort against
  shared capacity. Discuss sizing in prose; do not require size enums or a
  separate Discovery Project. Put the plan near the front and process material
  in child documents where supported. Later candidates may remain prose or be
  ordinary planned Projects. Creation and scheduled dates do not activate them.
  A successor explains its transition and links useful prior results without
  automatically inheriting its predecessor's primary Area.
- **Failure:** Creation silently means `active`; unknown user facts are invented;
  a mandatory Goal, Stage, Discovery Project, or Long-term Project is inserted;
  or execution begins without the relevant readiness and authorization checks.

### A3 — Delay triggers Review and replanning

- **Scope:** Review, Task scheduling, KR calibration, and execution history.
- **Input:** An active Project has unfinished scheduled Tasks, one immovable
  external deadline, and new evidence weakening a KR assumption. Other active
  Projects share the user's available capacity; future planned Projects exist.
- **Action:** The user requests a weekly review.
- **Expected:** Read current results and shared capacity. Revise remaining Task
  order and time, and where justified the scope or KRs, explaining tradeoffs.
  Preserve completed evidence and the fixed constraint. Review can also change
  an unexecuted planned Project's Objective, KRs, primary Area, expected time,
  or Tasks, or cancel it. Revising a plan is not rewriting execution history:
  retain actual actions, results, and meaningful decisions. A materially
  different Objective for already-executed work requires an explicit decision
  to continue or replace that Project.
- **Failure:** Replanning invents `deferred`, `defer_until`, or extra universal
  time fields; marks unfinished work complete; erases actual results; silently
  moves a fixed constraint; or ignores commitments in other active Projects.

### A4 — Waiting and postponement are different

- **Scope:** Task `waiting`, follow-up, and the single planned time.
- **Input:** A Task is `waiting` for access approval, described in its text,
  with Friday as the planned follow-up time.
- **Action:** A Friday query or review runs, or the user postpones the follow-up
  until Monday.
- **Expected:** The Task remains `waiting` until the actual blocking condition
  is resolved. Postponement changes its one planned time, not its status.
  Focus may suggest checking the approval without presenting the blocked work
  itself as ready. A `waiting_for` property is not required.
- **Failure:** A date automatically resolves the blocker, postponement becomes a
  new lifecycle state, or blocked execution is recommended as immediately ready.

### A5 — A next move without a Context questionnaire

- **Scope:** Focus, broad retrieval, parent Project state, and user choice.
- **Input:** Current backend data includes `doing`, overdue `todo`, future
  `todo`, undated standalone, and `waiting` Tasks. Paused and planned Projects
  also have Tasks, including planned-parent Tasks whose dates have arrived.
- **Action:** The user asks “What should I do next?” without specifying device,
  location, energy, or available time.
- **Expected:** Retrieve a sufficiently broad current candidate set. Read Project
  state, Task order, descriptions, and known constraints, then offer a small
  useful choice without assuming unseen Context or requiring a questionnaire.
  Do not lose overdue, doing, or undated Tasks through an overly narrow query.
  Paused and waiting work is not automatically ready. Exclude Tasks in planned
  Projects from current executable recommendations by default, even when due;
  a review prompt may be appropriate. Full Plan can show all Project states
  without making their Tasks executable. Preserve actual doing/done evidence
  under a planned parent and surface it for Review. Task order is the default
  guide, not a required dependency DAG.
- **Failure:** Focus is the full backlog, assumes unknown Context, treats date
  arrival as activation, erases inconsistent actual work, or automatically
  activates a Project to hide that inconsistency.

### A6 — Area inactivity and Project closure

- **Scope:** Area activity, Project completion, and later decisions.
- **Input:** An inactive Area has linked Sources and an active Project. Another
  Project has reached its Objective. Its Area describes a broad trial-then-adopt
  strategy with a later candidate in prose or as a planned Project.
- **Action:** A review or query runs.
- **Expected:** Area inactivity suppresses proactive new action generation from
  that Area, not search, links, explicit user requests, or the linked Project's
  own state. Closing a Project evaluates KRs and explicitly resolves leftover
  Tasks. Results inform relevant Area review and the next decision. The next
  candidate can change, be postponed, be replaced, or be canceled; several short
  Projects may contribute to one broader stage described in prose. A successor
  can select another primary Area and cite the prior Project without rewriting
  that Project's historical Area, Objective, KRs, evidence, or identity.
- **Failure:** Area inactivity cascades to Project state, closure hides leftover
  Tasks, the strategy becomes a mandatory route, or a Goal/Stage object or an
  automatically activated successor chain is manufactured.

### A7 — Area granularity follows continuing decisions

- **Scope:** Area creation and refinement versus topic classification.
- **Input:** A fictional user's broad “Learning” Area combines language study,
  music practice, and occasional interest in sound synthesis. Investment and
  review decisions have become indistinct.
- **Action:** The Agent helps the user reconsider their Areas.
- **Expected:** Discuss which directions have independent continuing Vision or
  Responsibility, investment decisions, and meaningful review questions.
  Language Study or Music Practice may warrant separate Areas if those tests
  fit the user's circumstances. A supporting topic can remain Wiki knowledge,
  Source relationships, or User Tags. Create, split, or merge only within the
  user's scoped authorization.
- **Failure:** An exhaustive universal taxonomy, equal hierarchy depth, one Area
  per topic, or an Area for every product is imposed. Classification convenience
  alone is treated as sufficient reason to create an Area.

### A8 — Successive Projects can change primary Area

- **Scope:** Cross-Project continuity, primary Area, and historical identity.
- **Input:** A fictional user's completed “Tool Trial” Project belongs primarily
  to Research Practice and has retained results. A possible “Team Pilot” under
  Team Enablement exists in prose or as a planned Project. Trial results suggest
  that sharing the technique could be useful.
- **Action:** The user chooses to begin a bounded pilot of sharing that technique.
- **Expected:** Create an ordinary successor or revise the planned candidate,
  then explicitly decide whether to activate it. Give it its own Objective,
  KRs, plan, primary Area, and current evidence. Link the trial and explain which
  results support the changed purpose. Other useful Areas are context links,
  not duplicate Projects or plans. Preserve the predecessor's historical
  identity, Area, Objective, KRs, Tasks, and actual results. An unexecuted planned
  successor may change its Area, Objective, KRs, Tasks, or time, or be canceled;
  its existence is not a commitment to the pilot. An authorized useful backlink
  may be added. A fresh Agent can recover the progression through ordinary
  links and current backend reads.
- **Failure:** The predecessor is relabeled to match the new purpose, the plan is
  duplicated across Areas, or continuity requires a Long-term Project, Goal,
  Stage, Product/Program parent, `previous_project` field, or auto-activation.

### A9 — A visible multi-Project plan is not an execution commitment

- **Scope:** Full Plan, planned Projects, activation, and shared capacity.
- **Input:** Four ordinary Projects are pre-created: P1 is `active`; P2–P4 are
  `planned`. P2 has a different primary Area and Tasks whose planned time has
  arrived. The user has stated a current capacity shared across active work.
- **Action:** Show the full plan, recommend a next move, or review it after P1
  finishes, a planned date arrives, or new evidence appears.
- **Expected:** Full Plan shows all four Projects with their current states and
  expected arrangements. Current Focus does not treat planned-parent Tasks as
  executable merely because their dates arrived. Dates and predecessor
  completion do not activate successors. Activation reviews current evidence,
  described prerequisites, priorities, total active workload, shared capacity,
  and applicable authorization. Concurrent active Projects are possible: neither
  a universal one-active rule nor unlimited commitments is imposed. Review may
  revise or cancel an unexecuted planned Project, including its primary Area,
  Objective, KRs, Tasks, and time. Preserve useful links, significant decisions,
  and actual actions and results. Do not bulk-convert planned-parent Tasks to
  `waiting`. If actual doing/done work is recorded under a planned parent, retain
  it and surface the discrepancy for Review without automatic activation.
- **Failure:** Planning becomes a fixed execution promise; Task dates or
  checkbox edits trigger activation; actual work is reset or erased; or showing
  the route requires an extra parent entity or dependency DAG.

## Sources and Wiki

### K1 — An unassigned Source is found later

- **Scope:** Source capture, discovery, and evidence-informed Area planning.
- **Input:** An article is saved with a summary limited to accessible material,
  its origin, and useful tags, but no relevant Area exists.
- **Action:** A later Area review plans its next action.
- **Expected:** Saving succeeds without creating a category-only Area. Planning
  searches relevant Sources and Wikis, including unassigned and imperfectly
  tagged material, checks evidence sufficiency, and adds useful links. Tags aid
  discovery without acting as a mandatory exact-match gate.
- **Failure:** A Source cannot be retained without an Area, an artificial Area
  is forced, or incomplete tagging makes relevant evidence undiscoverable.

### K2 — One Source, several uses

- **Scope:** Preparation depth, access disclosure, and many-to-many reuse.
- **Input:** A paper may support an active Project, extend two Wikis, and benefit
  from deeper reading.
- **Action:** The user requests close reading or translation.
- **Expected:** Honor the request, disclose actual access and coverage, prepare
  to the required depth, then reconsider uses. The same Source can lead to
  reading or experiment Tasks, Project work, and multiple Wiki revisions.
  Prepared summaries and translations retain their Source relationship and
  actual input provenance. Reuse does not consume the Source, and not every
  Source requires deep processing.
- **Failure:** An abstract is represented as full reading, an explicit request
  is replaced by unrelated processing, one Source is limited to one use, or
  every capture automatically incurs exhaustive preparation and ingest.

### K3 — A repost resolves to the original work

- **Scope:** Canonical Source identity, access versions, and preparation provenance.
- **Input:** Video A faithfully retells original interview B. The user supplied
  A; B has not been accessed.
- **Action:** Identity resolution establishes that A is a derivative version
  of B rather than independent commentary.
- **Expected:** One Source centered on B retains A as its discovery/access
  version. Material prepared from A remains attributed to A and its actual
  scope. Existing references survive consolidation of duplicate Source records.
  Qualify unresolved identity rather than merging on a guess.
- **Failure:** B is treated as a Wiki, the Agent claims to have watched B,
  prepared material loses its actual input provenance, or consolidation erases
  references or assumes an unverified identity match.

### K4 — Independent commentary retains independent identity

- **Scope:** Source boundaries, citations, and selective reference expansion.
- **Input:** Video A develops its own argument and cites works B, C, and D.
- **Action:** Prepare A.
- **Expected:** A remains a Source. Relevant cited works can become separate
  linked Sources, with actual citation relationships expressed through links
  and prose. Do not recursively import every reference by default. An externally
  authored survey remains a Source; GPK's maintained synthesis is Wiki.
- **Failure:** A is collapsed into a cited work, references are fabricated,
  citation expansion becomes unbounded, or an external survey is classified as
  maintained Wiki solely because it summarizes other work.

### K5 — Ingest revises a topic, not a stack of summaries

- **Scope:** Evidence-grounded Wiki maintenance and concept granularity.
- **Input:** A “Water Filtration” Wiki synthesizes several Sources. New evidence
  contradicts a broad claim and introduces an independently reusable concept.
- **Action:** Ingest the new Source within current authorization.
- **Expected:** Read the latest Wiki and evidence, revise the affected
  explanation, retain disagreement and uncertainty, and cite claims. Link or
  create a separate Wiki only for the independently useful concept. A maintained
  multi-topic overview or survey is an ordinary Wiki. Additional Agent-found
  Sources follow the same evidence rules.
- **Failure:** Ingest merely appends summaries, overwrites disagreement without
  explanation, or forces dozens of atomic notes, a Source-shaped Wiki, a
  duplicate map of content, an Index entity, lifecycle scores, or a mandatory
  Ingest Record.

### K6 — Results return to use without automatic promotion

- **Scope:** Lightweight Task results, Project process material, Output, and Wiki.
- **Input:** A standalone Task produces a useful script and an observation. A
  Project produces a comparison draft and a final report.
- **Action:** The user asks to retain useful results.
- **Expected:** Task-local results remain lightweight. The script or final
  report can be an Output when intentionally retained for use; the comparison
  draft remains Project process material. Reusable understanding can revise Wiki
  with provenance. Outputs may originate from Tasks, Projects, both, or a
  standalone purpose. An intentionally retained artifact may be an Output while
  its Project is still active; neither Project closure nor publication is required.
  Output has no universal lifecycle, not merely no publishing workflow. Improved
  Wiki content alone is not evidence that the user has mastered the subject.
- **Failure:** Every result becomes a separate Output or result entity, a Task
  requires a Project to retain an artifact, an artifact must wait for Project
  closure or publication, a working draft is mislabeled as a completed deliverable,
  or knowledge maintenance is counted as personal mastery.

## Adapters, control, and integrity

### S1 — A fresh harness recovers facts from the selected stores

- **Scope:** Harness portability, canonical state, and stateless adapters.
- **Input:** Codex has updated Task state and Source relationships in the
  Knowledge Backend, and explicit preferences in the selected User Control store.
- **Action:** Claude Code starts without that conversation or local cache.
- **Expected:** Obtain connection bootstrap through the host and read current
  domain facts from the Knowledge Backend and configuration, Profile, grants and
  templates through the selected User Control adapter. Neither depends on adapter
  memory. The first provider may share Craft with domain records. A future local
  provider requires explicit access to that directory; missing remote access is
  reported, not replaced with defaults or another store. Read-only requests cause no writes.
  Changing harness does not silently change the methodology.
- **Failure:** The new harness cannot recover required facts without the old
  conversation, a cache becomes a second canonical database, or merely reading
  triggers normalization or other writes.

### S2 — Direct user edits and stale writes

- **Scope:** Latest-state reads, encoding conflicts, and write verification.
- **Input:** A user checks a native Task checkbox after the Agent's last read,
  or that checkbox conflicts with a reserved `waiting` marker.
- **Action:** An adapter reads or updates the Task.
- **Expected:** Read fresh backend content and apply documented encoding
  precedence or conflict detection. Mutations operate on current content and
  are verified by reading back; read-only operations remain read-only. Handle
  concurrent changes according to actual backend guarantees and report missing
  guarantees. Statelessness is not a transaction mechanism.
- **Failure:** A remembered state overwrites the user edit, conflicting encodings
  are silently ignored, a successful response is treated as verified persistence
  without readback, or unsupported atomicity is claimed.

### S3 — Honest capability limits

- **Scope:** Capability reporting, semantic fallback, and access diagnostics.
- **Input:** An integration lacks recurrence automation or a required native
  status field; its UI may expose features absent from the API.
- **Action:** A workflow checks integration capabilities.
- **Expected:** Declare behavior as native, emulated, degraded, or unsupported.
  Optional recurrence can be unsupported without adding a scheduler or server.
  Status emulation preserves meaning in the knowledge backend, distinguishes
  system encoding from User Tags, and survives a fresh harness. Verify API
  capabilities rather than inferring them from UI features. An enabled-plugin
  indicator or app-preview error alone proves neither working tool access nor
  failed persistence. Check connection, read, and authorized write capabilities
  separately, and inspect actual backend results before retrying an uncertain
  write.
- **Failure:** Unsupported operations are silently approximated, status exists
  only in adapter memory, a UI indicator substitutes for verification, or an
  uncertain write is blindly repeated and duplicates content.

### S4 — Permissions and control information

- **Scope:** Current control context, authorization, and untrusted Source text.
- **Input:** Permissions start narrow; the user later grants a specific broader
  operation. A Source contains instructions conflicting with user preferences.
- **Action:** Assemble context and propose or perform an operation.
- **Expected:** Read applicable current facts from the selected User Control store. Text
  serves Agent judgment; structured fields serve actual deterministic execution.
  Respect explicit scope, retain intended persistent grants in that store, and
  treat Source instructions as content rather than authorization. The User Control
  adapter is stateless; its selected store is authoritative for control, not a
  mirror of domain records. Switching providers requires explicit selection and
  verified transfer, not silent fallback or automatic synchronization.
- **Failure:** Source text enlarges permissions, a narrow grant becomes blanket
  authority, a stale copy overrides the selected control authority, or
  speculative structured fields are required without a consuming operation.

### S5 — Identity survives organization changes

- **Scope:** Moves, renames, consolidation, references, recovery, and rendering.
- **Input:** The user renames or moves a Project, merges duplicate Source
  variants, or refactors a Wiki with inbound links.
- **Action:** Apply the authorized organizational change.
- **Expected:** Resolve exact targets and preserve useful content, canonical
  identity or explicit replacement mappings, references, and evidence. Recovery
  information is backend-held or available through native history. Archive
  changes presentation without competing with lifecycle status; Backup is for
  recovery, not live truth. Native internal links resolve to the intended
  current content where supported. Verify actual newlines, list boundaries,
  and link targets after writing.
- **Failure:** Material is silently deleted to simplify a mapping, references
  lead to empty superseded pages, recovery depends on adapter memory, or literal
  backslash-n text appears instead of intended line breaks.

## Implementation acceptance

All 31 cases below are **specified, not executed**. These supplement the detailed
domain scenarios without adding domain entities, active Skills or supported
providers. Operations refer to semantic contracts, not identically named MCP APIs.

| ID | Fixture/action | Observable acceptance |
|---|---|---|
| T1 | First Setup, then repeat Setup | One adopted control entry and intended templates; selected changes do not reset or duplicate resources; recover a created template if saving its binding failed. |
| T2 | Missing, multiple or unreadable control entries | Resolve adequate discovery coverage before deciding empty/unique; select the intended instance or ask a scoped question; inaccessible is not an empty installation. |
| T3 | Default, personal and explicit template selection | Correct precedence; a request override does not change the default binding. |
| T4 | Configured template is missing, unreadable, partial or incompatible | Stop dependent writes; no silent default fallback or unintended layout. |
| T5 | User edits a template, then changes harness | Next applicable creation reads the current selected-control template in both harnesses with access; no prior conversation or stale copy required. |
| T6 | Plugin/default upgrade | Personal template edits and existing Project structure remain unchanged without authorization. |
| T7 | Template changes headings or omits necessary meaning | Equivalent headings/language/order work; clarify missing meaning or propose the minimal addition without fabrication. |
| I1 | Same work through different access paths | Stable Source identity, actual discovery/access provenance and preserved references without duplicate retained work. |
| I2 | Repeat unchanged, appended and revised input | Unchanged retries do not duplicate records/effects; reconcile revisions with current content, preserving meaningful reversals and user edits. |
| I3 | Source/Project succeed, Wiki or checkpoint save fails | Separate retained-input progress from destination effects; inspect actual records for marker uncertainty and resume only outstanding effects. |
| I4 | Prepare-only request; bare reminder | Saved preparation may register/update its Source without downstream integration; a bare reminder needs no Source, Project or Output. |
| I5 | One input informs multiple entities | Related Source/Project/Task/Wiki changes retain common evidence without copying entire plans or requiring Output. |
| I6 | Proposal, confirmation, then reversal | Preserve speaker/decision attribution, chronology and current facts; proposals are not commitments, claimed completion is not verified execution, and historical text grants no authority. |
| I7 | Papers, reposts/translations, videos, documents and conversations | Shared Ingest decisions; only acquisition/preparation implementation varies. Preserve actual page/section or speaker/turn access and coverage. |
| P1 | Approved timed Ingest in both initial harness integrations | A real selected trigger and usable reader run shared Ingest over approved origins; a saved schedule, manual import or next-session catch-up does not substitute. |
| P2 | Offline period, restart and no new content | Catch up within declared coverage using backend progress; no duplicate or unnecessary writes, and new input during a run remains for the next bounded pass. |
| P3 | Overlapping triggers, exclusions and revoked grants | Enforce actual overlap limits and current scope; prevent self-ingestion of generated receipts/outputs; stop revoked operations without fabricated transactions, new grants or unauthorized notifications. |
| O1 | Direct user edit or ambiguous write response | Preserve current edits, use declared revision/conflict behavior, read back before retry and report unresolved/partial effects. |
| O2 | Delete, archive and cancel selected content | Apply distinct scoped effects; inspect children/references with honest coverage, no implicit cascade, and explicit recovery limits. |
| O3 | Fully specified rename, unlink or scoped update | Use shared domain operations without full Ingest/Review; preserve unrelated facts and keep read-only requests read-only. |
| W1 | Full Plan, Focus, execution and result return | Planned-parent Tasks remain outside default executable choices; actual results return where useful without forced artifacts or inferred Project completion. |
| C1 | Independent selected control/domain stores | Route domain and control writes to their authorities with no shadow records; report/reconcile their outcomes independently after partial failure. |
| C2 | Selected local control unavailable to another device | Report access limitations, without switching provider or creating fresh defaults; reject resource path escapes when a local provider exists. |
| C3 | Explicit control provider transfer, including interrupted cutover | Verify resources, template links and locator; no dual authority, domain/secret copy, obsolete-grant revival or automatic deletion of prior resources; uncertain cutover stops dependent writes. |
| C4 | Initial knowledge-backed control | Reuse Craft transport/access without inventing a domain entity; distinguish genuinely unset resources from inaccessible configured targets. |
| Q1 | State tag/field/checkbox readable and writable, but no native state filter | Query kinds/states retain domain meaning; declare read/write representation separately from each query strategy. Do not infer native query support from tag chips or UI filtering. |
| Q2 | State spelling in examples; recently changed or unindexed entity absent from search | Fresh reads remove false positives and obsolete matches; search omissions remain explicit. Exhausted search cursors cannot establish completeness, and zero candidates are not proof of absence. |
| Q3 | Scoped inventory spans pages, child documents and unreadable or changing records | Traverse the placement-defined population and current owned states; handle cursors, scan budgets and access gaps. Only adequate coverage permits complete/empty claims; invalid cursors or concurrent edits do not become an atomic-snapshot promise. |
| Q4 | Duplicate/conflicting state markers; native Task completed with stale waiting marker | Preserve direct edits, use one authoritative encoding and the documented conflict rule; report unresolved ambiguity. Read-only queries never repair state, add duplicate tags or reset the user's completed Task. |
| Q5 | Same `#gpk/project/active` spelling on a deep-tag backend and Craft | Preserve domain meaning while declaring actual hierarchy depth. Craft's first-slash grouping does not become three-level or recursive-prefix filtering; no required `filterByTag` domain API. |
| Q6 | Mixed kind/state/time/scope query; one predicate unsupported or retrieval budget exhausted | Enforce all predicates or return an explicit failure/limited result; never silently ignore one or map native due-task `active` to Project `active`. Emulation uses fresh backend facts and request memory, not an adapter-owned authoritative index. |

C2/C3 become executable integration requirements when another control provider is
implemented; they do not claim current local/cloud support.

## Behavior coverage

Coverage means a realistic input has a coherent operation path, useful durable
result when appropriate, and explicit capability/authorization limits. It does
not prove runtime support or reproduce every GTD, OKR, PARA or knowledge-system
feature. Method names describe adopted principles, not alternate domain modes.
Arrows indicate intended orchestration, not executable command chains.

| Behavior and input | Workflow / operations | Result and boundary | Acceptance |
|---|---|---|---|
| GTD capture/clarify: reimbursement reminder with receipt | Ingest; capture content or Task.create; Work when selected | Inbox pending clarification or standalone todo with receipt; actual submission result can remain inline, without forced entities | A1, I4, K6 |
| GTD clarify/organize: workshop preparation with unclear outcome | Ingest → Plan; read Area/evidence, initialize Project, create/order/link Tasks | Bounded Objective, initial KRs and one plan; ask user-known facts, no mandatory Discovery Project or implicit activation | A2 |
| GTD engage: “What should I do next?” | Work/Focus; query Tasks and read current parents, order and constraints | Small useful choice including doing, overdue and undated candidates; disclose limited discovery; no inferred Context or full-backlog answer; usually no write | A5, A9, W1, Q1–Q6 |
| Waiting, postponement and uncommitted possibilities | Work/Review; wait, reschedule, resume or update capture/Area prose | Waiting reason and one time; moving time does not resolve a blocker; possibilities need no deferred state or commitment | A4 |
| GTD reflect: weekly commitments drift after delays | Review → shared Plan; review/replan Project, update Task order/time | Preserve actual work/fixed constraints while adjusting shared capacity, scope or KRs; cadence alone creates no timer | A3 |
| OKR: usable workflow instead of twelve articles read | Plan → Work → Review; initialize/activate, update evidence, explicitly close | Objective and outcome KRs inside Project; no Goal/KR entity, score engine, corporate cascade or requirement for every life action to serve KRs | A2, A6 |
| PARA-inspired direction: one Area and several possible Projects | Review → Plan; read/revise Area, search knowledge, create/revise/link Projects | Continuing Vision/Responsibility and ordinary bounded Projects; successors may change primary Area, no Stage or Long-term Project | A6–A9, K1 |
| BASB preparation: orient or fully read a paper | Ingest/Prepare; resolve/register/prepare Source, inspect purpose, optional Task/Wiki effects | Purpose-based preparation and actual coverage; respect prepare-only scope, neither full import nor summary-only is universal | K2–K4, I4 |
| LLM Wiki: new evidence challenges an explanation | Ingest; read current evidence/Wiki, seek authorized evidence, revise/cite/link/split | Revised claims, comparisons, uncertainty and many-to-many evidence; no summary append pile or one-Wiki-per-paper rule | K3–K5 |
| Zettelkasten/evergreen: explanation improves over time | Ingest, or shared maintenance from Work/Review; revise/link/split/merge Wiki | Independently useful explanation with preserved references; no fixed atomic size/card count or claim that Agent notes prove user learning | K5, K6, S5 |
| MOC/LYT: connect a new idea with existing knowledge | Ingest/Work; search knowledge/Projects, revise explanatory links, create Wiki only when useful | Ordinary topic/survey Wiki and addressable uses; no Index entity, compulsory duplicate map or indiscriminate linking | K1, K5 |
| Use and return: a Task produces a script and observation | Work; record/complete, update Project/KR, optionally Source/Wiki/Output | Lightweight inline result, reusable understanding and intentionally retained artifact; publication/execution need their own capability and authority | K6, W1 |
| Evolving origins: selected conversations gain decisions/revisions | Authorized generic trigger → Ingest; resolve identity, prepare changes, apply/verify effects | One evolving Source, attribution and resumable progress; no Conversation Sync Skill, historical authority or assumed timer | I1–I7, P1–P3 |

Three composed acceptance paths retain the end-to-end checks:

| Path | Fixture and required sequence |
|---|---|
| Small action stays small | Reimbursement with fixed Friday constraint → standalone todo/receipt reference → waiting for approval → Monday follow-up without clearing waiting → actual submission evidence retained inline → completion. Fresh reads must recover the native Task, one time, result and constraint history without unrelated writes. A1, A4, K6. |
| One input, several uses | Evolving discussion contains a proposal and later rejection; a separate paper supports only a limited claim. Preserve actual speaker/turn/revision access, keep the final decision/reversal in Project process material, revise only supported Wiki claims, create Tasks only for accepted actions. After Project success/Wiki failure resume only Wiki; unchanged reruns and renamed exports create no duplicates, revisions preserve current edits. Manual/timed paths share Ingest; timed runs separately need real reader, trigger, grants and offline/overlap recovery. I1–I7, P1–P3. |
| Direction becomes a revisable plan | Synthetic Research Practice Area → Tool Trial Objective/KRs using current personal template and relevant unassigned Sources → planned Tasks → explicit capacity/readiness activation → actual result return → evidence-based replan and closure with remaining Tasks resolved → reconsider a Team Pilot under its own primary Area. Preserve trial history, allow revising/canceling the successor, and never auto-activate it. Full Plan shows candidates; Focus excludes planned parents and surfaces actual doing/done mismatch. A2, A3, A6, A8, A9, K1, T5, W1. |

Native Context filtering, separate hard-calendar semantics, corporate OKR
alignment, automatic habit generation, publication pipelines and full application
replicas are not implied. Unsupported optional capabilities may remain unsupported;
required periodic Ingest remains incomplete until its actual composition is proven.

## Evidence and execution records

Keep evidence levels distinct: packaging/resource loading, actual operations,
composed workflow behavior, and portability. Packaging, link, version, mock codec
and generated-drift checks do not establish live effects or scenario success.
For initial integrations verify Craft identity/state/time/control round trips and
retrieval, personalized checkbox/order/link/child rendering, actual reader scope
and revisions, timed execution and real concurrency/recovery limits before enabling
affected workflows. Run with direct record/template edits and current grants,
including fresh-harness recovery; a happy path alone is insufficient.

Adapter checks include full/partial reads and continuation, valid/invalid state
transitions, unauthorized calls, genuine-unset versus inaccessible control, scoped
deletion/reference coverage, uncertain/partial writes and restart without adapter
memory. Resource loading is checked from an isolated installed package. Vary
backend/control providers separately as their implementations become available.

Create a record only when a scenario is actually run. Record:

- Scenario ID, harness/backend/control providers and actual capability limits.
- Starting fixture, requested/authorized scope and actions performed.
- Observed results and supporting evidence.
- Pass, fail, or unsupported finding, with any follow-up issue.

An execution record is ordinary validation material, not a new domain entity.
Specification review, document updates, package checks, and adapter generation
do not themselves constitute execution of these scenarios.

## 中文摘要

本文统一保存领域模型 v0.4 的 20 条领域场景、31 条模板/摄入/周期执行/操作/
控制/状态查询实现用例，以及 13 行方法与行为覆盖、三个组合验收路径。全部仍是
“已定义，未执行”；五个业务 Skill 仍未启用，与软件包版本 0.1.0 不混用。
验收关注实际状态、关系、证据、权限、控制存储和跨客户端恢复，不要求相同
输出文字。文档、构建、模拟接口检查不等于真实场景通过；未来 Provider 的
用例需待相应实现后执行，不能据此宣称本地/云端或周期运行已支持。
