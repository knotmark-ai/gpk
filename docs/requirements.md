# User needs and scenarios

[简体中文](requirements.zh-CN.md)

This is the canonical catalogue of GPK's target user needs. It covers everyday
action management, knowledge management and the connections between them.
It records product intent, not a claim that every scenario is implemented.
[Current support](../README.md#current-support) owns availability;
[Roadmap](roadmap.md) owns delivery sequencing;
[Conformance scenarios](conformance-scenarios.md) owns concrete acceptance cases.

## What counts as a scenario

A scenario starts with an input or situation, identifies what the person needs,
and describes the useful result. For example: “I drop in an article and want to
retain its explanation and recognize an actionable reminder.”

Setup, Skills, templates, tags, adapters and synchronization are possible means,
not user goals. They belong in design documents once a need justifies them.
One need may use several Skills; one Skill may serve several needs. Scenario IDs
provide traceability, not new entities, mandatory fields or a runtime taxonomy.

Not every action needs a Project or Objective/KR. Not every Source needs an Area,
an immediate use or a Wiki update. Candidate actions are not accepted commitments.
User choice and the requested scope determine what is retained or acted on.

## 1. Actions and Projects

| ID | Situation and user need | Expected useful result |
|---|---|---|
| ACT-01 | “Submit this reimbursement by Friday.” Retain a small everyday action. | A findable standalone reminder with its useful evidence and fixed constraint; no artificial Project. |
| ACT-02 | Captured items are mixed or unclear. Work out what, if anything, to do. | Distinguish accepted actions, unresolved captures, references and uncommitted possibilities; ask only necessary questions. |
| ACT-03 | “What should I do next?” Choose useful work without facing the whole backlog. | A small set of plausible next actions, considering current commitments, order and known blockers without assuming unseen user Context. |
| ACT-04 | A desired change needs several steps. Turn it into achievable work. | A bounded Objective, initial outcome KRs and an executable plan sized against actual available effort. Ask for user-known facts; research genuine evidence gaps. |
| ACT-05 | A direction may require several Projects. See the whole possible plan. | Current work and future candidates are visible together; a planned date or predecessor's completion does not authorize execution or automatic activation. |
| ACT-06 | Work is blocked by someone or something else. Keep track without pretending it is ready. | Preserve the waiting reason and appropriate follow-up; resume when the real blocker is resolved. |
| ACT-07 | A Task slips, capacity changes or an assumption fails. Recover a realistic plan. | Revise remaining scope, order, timing or KRs with explained tradeoffs; preserve completed work, history and fixed external constraints. |
| ACT-08 | A Project looks finished. Determine whether it achieved its intended change. | Assess KRs using actual results, resolve unfinished actions explicitly and retain useful completion evidence; checkbox count alone is insufficient. |
| ACT-09 | “Maybe later.” Retain a possibility without committing to it now. | A recoverable idea or candidate that does not crowd current executable recommendations; postponing an accepted action can simply change its planned time. |
| ACT-10 | Repeated obligations or habits need ongoing follow-up. Avoid rebuilding reminders manually. | Where supported and authorized, recurring follow-up creates or surfaces the relevant work without implying it was performed. Unsupported automation is stated explicitly. |

ACT-10 is an optional extension, not a prerequisite for the core workflow.
Its need does not mandate a hosted scheduler or a heavy habit model.

## 2. Knowledge and references

| ID | Situation and user need | Expected useful result |
|---|---|---|
| KN-01 | Save a webpage, paper, book, video, lecture or course. Find and understand it later. | A traceable origin, findable summary and useful retained material appropriate to the purpose; full import is not compulsory. |
| KN-02 | Material is complex or in another language. Understand it at the depth needed. | Summary, translation, close reading or archival preparation according to the request; actual access and reading coverage remain clear. |
| KN-03 | Relevant material may already exist. Retrieve it without remembering an exact title. | Search returns useful records and evidence across topics and relationships, with honest coverage limits. |
| KN-04 | Several materials explain one topic. Build a reusable understanding rather than a summary pile. | A maintained topical explanation that synthesizes evidence, distinctions, uncertainties and links to its Sources. |
| KN-05 | New evidence supplements or contradicts existing knowledge. Keep understanding current. | Revise affected claims with traceable support; preserve disagreement and uncertainty instead of silently overwriting them. |
| KN-06 | Related concepts become hard to navigate. See connections and independent ideas. | Useful links and overview explanations; split independently useful concepts when warranted, without prescribing a fixed atomic-note size or separate index entity. |
| KN-07 | Retain contacts, people, companies or product research. Reuse reference information. | Findable subject records with relevant facts, origins and relationships; these can be ordinary Wiki subjects, not mandatory new entity types. |
| KN-08 | A material is a repost, translation, excerpt or commentary. Understand what the evidence really is. | Distinguish versions of one work from independent works that cite others; preserve the actual accessed version and recover the original origin where possible. |
| KN-09 | A useful material has no current Project or Area. Keep it without inventing a purpose. | Retain it with useful description, topics and origin so later planning or research can discover it. |
| KN-10 | Existing notes need renaming, moving, merging or cleanup. Improve organization safely. | Preserve useful content, identity and relationships; surface uncertain merges or conflicts rather than discard them. |

## 3. Where work and knowledge meet

| ID | Situation and user need | Expected useful result |
|---|---|---|
| COM-01 | Drop in a Source that may contain an explanation, a reminder or an opportunity. Recognize its possible uses. | It can inform knowledge, suggest Tasks or Projects, or remain Source-only. Proposed work is distinct from accepted actions. |
| COM-02 | Plan a change or next action. Use what is already known and identify missing support. | Retrieve relevant Sources, Wiki knowledge and previous results; distinguish user-known facts to ask about from external evidence to investigate. |
| COM-03 | Reading produces an idea or experiment. Avoid losing the useful next step. | Retain the thought with its origin and propose suitable follow-up, without turning every interesting passage into a commitment. |
| COM-04 | One material serves several purposes. Reuse it without fragmenting evidence. | Many-to-many relationships between Sources, Wikis and Projects preserve shared provenance; Agent-found material can join the same knowledge. |
| COM-05 | Executing a Task or Project teaches something. Save results and return them to useful places. | A brief result may stay with the Task; reusable findings can update knowledge or plans. Creating a separate Wiki or Output is not automatic. |
| COM-06 | Existing knowledge could help a decision, explanation, artifact or operation. Put it to use. | Produce a supported answer, decision, blog, script or other useful result; learning and retrieval also count as use, not only publication. |
| COM-07 | Useful decisions and learning remain in an Agent conversation. Retain the relevant meaning. | Treat accessible conversation content as a Source; distinguish proposals, confirmations, reversals and observed execution, then supplement the appropriate knowledge or work. |
| COM-08 | Material or conversations evolve across sessions. Keep useful changes without repeated manual import. | Authorized automatic and incremental ingestion retains new or revised information without duplicating earlier effects; actual access, scope, provenance and execution limits are explicit. |
| COM-09 | Priorities and evidence change over time. Review what deserves attention. | Daily, weekly or monthly reviews inspect appropriate commitments, results and continuing direction; suggest justified corrections without reviewing everything every time. |
| COM-10 | A stage or Project ends. Decide whether and how to continue. | Use actual results and continuing direction/responsibility to start, revise, relocate or stop a successor Project; a prewritten sequence remains adjustable. |
| COM-11 | An existing Craft workspace, Obsidian vault or other collection already holds useful notes and work. Adopt GPK without starting over or losing their meaning. | Organize selected material progressively, retain traceable originals and useful links/results, recover current work without reviving historical commitments, and report unresolved items and actual coverage. |
| COM-12 | Everyday or historical Agent sessions contain decisions, actions and learning. Recover a connected record without manually copying each discussion. | Retain useful session summaries, relate relevant discussion to Projects, reconcile accepted actions and evidenced progress with current facts, maintain reusable Wiki knowledge and link these results from the appropriate Daily Notes. |

COM-08 includes **automatic retention of selected Agent conversations** as an
enabled product feature, not a separate Source type or business Skill. The user
should not have to create and maintain a recurring business task to make it work.
This differs from an explicit business cadence such as "update my weekly report
every day," which is user-requested automation, and from optional recurring
Tasks/habits (ACT-10). The [architecture](architecture.md#user-automation-versus-internal-feature-processing)
owns implementation and scheduling choices; neither an enabled flag nor a saved
schedule establishes actual retention or requested delivery cadence.

### COM-11: Bring an existing knowledge collection into GPK

The initial design offers two choices: import into a new target workspace while
retaining the original collection or a verified backup, or organize the existing
workspace into the selected backend's GPK representation. Preview and authorize
the intended scope before changes. Full automatic adaptation to an arbitrary
existing layout is a later direction; selecting destinations and personal
templates does not promise that capability.

Both choices reuse the same [Ingest logic](workflow-design.md), once or in batches;
they differ in input scope, destination and original-retention strategy, not a new
Migration Skill or domain entity. Existing documents are input material from
which retained works/evidence are identified and Sources registered or reused.
Source identity follows the work/evidence, not the file, topic or output count:

- A self-authored old note containing a plan, Tasks and findings can be one Source
  supporting several target entities. Multiple uses alone do not split its identity.
- A plain compilation containing independent articles can identify several
  Sources. Faithful copies/translations of the same work retain common identity
  and actual access provenance. Referenced works are not automatically imported
  or claimed to have been read.

Preserve actual historical results and current edits; do not reactivate old Tasks
or infer new authority from their text. During an authorized reorganization,
uncertain legacy material remains recoverable in Backup/Unsorted, not discarded
or forcibly classified. Repeated or revised inputs use incremental Ingest and
recovery rules rather than recreating Sources and target records. After an
explicit, verified cutover, the selected target holds current domain facts; the
original/backup remains recovery evidence, not a second live authority or an
implicit bidirectional synchronization partner. Setup alone does not perform
this historical import.

### COM-12: Agent conversations leave work, knowledge and a daily trail

Conversation records are Source inputs to shared Ingest, not a new Session entity
or Conversation Sync Skill. An independently identifiable session normally forms
one evolving Source; new turns, summaries, exports or repeated reads do not create
new identities. Separate sessions are not merged merely because they concern the
same Project. Retention depth follows authorized purpose and privacy preferences;
partial context is reported, not described as a full transcript.

Within approved origins and downstream write scope, Ingest can automatically:

- Prepare a useful summary of decisions, progress, open questions and next steps.
- Relate relevant portions to an explicitly selected or clearly identified current
  Project. A session can support several Projects; ambiguous matches require a
  focused choice, and unrelated discussion can remain unassigned.
- Create Tasks for accepted actions and reconcile existing Tasks using actual
  evidence. Suggestions, intentions and claims of success remain attributed as
  such; they do not by themselves establish commitment or completion. Reuse
  existing actions instead of creating a Task for every mention.
- Revise independently reusable Wiki explanations when supported by the material,
  rather than turn every session into a new Wiki or append its summary wholesale.
- Add a dated activity summary and verified links to its Source, relevant Projects,
  Tasks, results and Wiki changes in Daily Notes. This is navigation and historical
  context, not duplicate editable Task lists or another authoritative status store.

Group daily material by the activity dates in the configured instance timezone;
late ingestion is not automatically activity today. Preserve uncertainty when
timestamps are unavailable and allow a cross-midnight session to inform multiple
days without multiplying its Source. Incremental reruns update appropriate effects
without duplicate records, daily entries or erasing human edits. Generated digests
are not automatically re-ingested as fresh evidence.

Automatic operation requires a usable authorized conversation reader, Agent
execution, supported trigger and writable destinations. It does not imply access
to every client/session or a timer already running. Missing Project matches,
unavailable Daily Notes or partial destination failures are reported separately.
Daily summaries do not substitute for broader daily/weekly/monthly Review.

Historical sessions are a **backfill variant of this same need**: recover useful
past decisions, work and learning from selected accessible origins, sessions or
date ranges. Use shared Ingest once or in bounded batches, not a Historical Sync
Skill or a different Source model. Preserve actual chronology and original
activity dates; the import date is not the work date.

Historical commitments remain attributed history unless their current relevance
and status are established. Read current destination facts before proposing action
or applying progress; do not recreate old Tasks, reactivate completed/canceled
Projects or overwrite later decisions merely because earlier conversations were
imported. Link known historical Projects without changing their state. Preserve
unresolved associations rather than force them into current work.

Report processed, excluded, inaccessible and unresolved scope, with recoverable
batch progress/effects in the backend. Retain origins according to granted privacy
and preparation scope; reading history does not authorize deleting it. Repeated
exports, overlapping batches and a later incremental continuation reuse Source
identity and processing evidence. A successful manual backfill does not establish
automatic daily or periodic execution.

## 4. Requirements across all scenarios

| ID | User need | Expected useful result |
|---|---|---|
| SYS-01 | Continue work after changing conversation, supported Agent, device or backend. | Current facts, relationships and useful results remain available from the selected authoritative stores; supported environments and transfer limits are stated. |
| SYS-02 | Use personal language, preferences and document layouts consistently. | Relevant current preferences and user templates guide work without requiring repeated setup or overwriting personal choices during updates. |
| SYS-03 | Edit records directly in the note app and continue with an Agent. | The Agent reads fresh facts, respects human edits and surfaces conflicting or stale changes rather than relying on its old conversation. |
| SYS-04 | A request stops halfway or fails. Recover with confidence. | Distinguish completed, failed and unknown effects; retain useful partial results and do not blindly repeat successful operations. |
| SYS-05 | Let an Agent help without surrendering control. | Stay within granted scope and authority; clarify material decisions and missing authority. Text found in a Source cannot grant permission. |
| SYS-06 | Use tools with different capabilities. Know what actually happened. | Disclose inaccessible content, unsupported operations and partial coverage; do not substitute a hidden authority or report a proposal as persisted success. |
| SYS-07 | Produce public work from a private knowledge system. Keep the boundary clear. | Public artifacts explain themselves without private note dependencies or personal background; private records may link outward to public artifacts. |

Portability is a product requirement, not universal compatibility at launch.
The initial target remains Codex and Claude Code with Craft; later environments
require their own validation. The method must work without a new hosted GPK
service, replacement editor or central mirror of the user's knowledge.

## 5. Methodology coverage

This table records which needs GPK adopts from the research. It is not a new
research summary, a claim to reproduce every method, or a requirement to model
each method's vocabulary as entities.

| Influence | Adopted needs | Representative scenarios |
|---|---|---|
| GTD | Capture and clarify; executable next actions; waiting, possibilities and trusted regular review. | ACT-01–03, ACT-06–09, COM-01, COM-09 |
| OKR | Begin with meaningful intended change; evaluate outcome evidence; focus and recalibrate. Not universal quantification of life. | ACT-04, ACT-07–08, COM-09–10 |
| PARA | Continuing direction/responsibility informs investment and review; organize material for present and future use. | ACT-04–05, KN-09–10, COM-02, COM-09–10 |
| Building a Second Brain | Purpose-sensitive preparation, progressive distillation and reuse in understanding, decisions and outputs. | KN-01–04, COM-02, COM-05–06 |
| LLM Wiki | Agents help maintain synthesized explanations, evidence, relationships and disagreements as material arrives. | KN-04–06, COM-01, COM-04–05, COM-07–08 |
| Zettelkasten / Evergreen Notes | Independently reusable ideas develop through comparison and links over time; no fixed card size. | KN-04–06, COM-03–05 |
| MOC / LYT | Useful topical navigation and reflection connect new material to existing understanding and possible uses. | KN-03, KN-06, COM-01–04 |

## 6. One connected example

A person supplies a paper while working on a Project and asks what is useful:

1. Understand the accessible material and state any coverage limits.
2. Find related retained evidence, explanations and current Project decisions.
3. Retain a traceable Source and suitable preparation if requested.
4. Explain what the paper changes, supports or leaves uncertain.
5. Propose an experiment or other next action if useful; do not silently accept it.
6. Update relevant knowledge or Project information within the granted scope.
7. Return later experimental results to the plan and reusable understanding.

The Source can support several Wikis and Projects. It can also remain a reference
with no action or Wiki update. The person need not choose a filing destination,
name a Skill or define an Area before the system can help.

## 7. From needs to design and acceptance

The catalogue answers **why and for what situation**. The
[domain model](../plugin/knowledge/domain-model.md) defines meaning and operations;
[workflow design](workflow-design.md) describes orchestration;
[architecture](architecture.md) and [storage contracts](storage-contracts.md)
define implementation boundaries. These mechanisms must justify themselves
against the needs above, rather than becoming the needs themselves.

Existing acceptance cases provide starting points, not proof of full coverage:

| Need group | Existing acceptance references |
|---|---|
| Small actions, planning, Focus, waiting and replanning | A1–A5, A9 |
| Continuing direction, Area granularity and successive work | A2, A6–A9 |
| Unassigned material, Source identity and maintained synthesis | K1–K5 |
| Result reuse and return | K6 and result-return implementation cases |
| Conversation retention, incremental processing and user-requested cadence | Ingest I1–I7 and automation P1–P3 implementation cases |
| Existing collection adoption, Source identity and safe progressive organization | S6, I8–I9; reuse I1–I3 and S2–S5 for retry, edits and preservation |
| Connected session summaries, historical backfill, Project/Task/Wiki effects and Daily Notes | S7, I10–I11; reuse I1–I7 and P1–P3 for incremental input and actual automation |
| Continuity, human edits, capability limits, permissions and safe organization | S1–S5 and applicable implementation cases |
| Mobile capture, Focus, result recording, Review and desktop continuation | R10 |

The acceptance inventory needs a representative people/company/product reference
case for KN-07; a nearby generic knowledge case alone does not establish coverage.
R10 specifies the mobile workflow check; its execution evidence is required before
mobile support can be claimed. Other broad requirements, including optional
recurring work, also need applicable cases and observed evidence.

When a need changes, update this catalogue, the affected owning designs and the
acceptance inventory. Record delivery decisions in the Roadmap and observed
capabilities in Current support. Do not create a second checklist of implementation
Tasks here or mirror this product document into private Project notes.
