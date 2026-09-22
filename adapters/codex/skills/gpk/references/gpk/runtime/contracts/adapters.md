# Adapter Contracts

Status: **Target design, not executable interfaces or implemented workflows.**
Updated: **2026-09-22**. This packaged reference defines the adapter contracts; signatures below remain design contracts unless explicitly marked implemented.
The [domain model](../../knowledge/domain-model.md) defines domain meaning;
[workflow contracts](workflows.md) define shared execution and recovery.
The signatures below describe a provider-neutral contract using TypeScript
notation. They do not select a TypeScript runtime or claim that these methods
already exist as MCP tools. Markdown procedures and tested JavaScript helpers
can jointly implement a contract; each method needs observable conformance tests.

## 1. Three interfaces, three responsibilities

| Interface | What it abstracts | Initial implementation | Later implementations |
|---|---|---|---|
| Knowledge Backend | Persisting and retrieving domain facts and processing evidence | Craft through the actual authorized MCP surface; API only when separately configured and verified | Local knowledge files, Notion, Obsidian, other stores |
| Agent Harness | Loading the plugin and providing interaction, tools, source access and execution | Claude Code and Codex | Other harnesses, one tested integration at a time |
| User Control | Finding and maintaining the current user's settings and resources | Knowledge-backed control, using Craft documents and the same connection | Explicit local `.gpk` directory; a future cloud control service |

A **store owns persistent data; an adapter owns no persistent truth**. A local
configuration directory explicitly selected by the user is a legitimate control
store, not an adapter cache. Likewise a future service can own control records
without turning the adapter into a stateful service. The three contracts do not
require three packages, three processes, or three physical stores.

| Data | Authority | Reason |
|---|---|---|
| Area, Project, Task, Source, Wiki, Output and their links | Knowledge Backend | Latest domain facts must survive harness changes |
| Origin-to-Source identity and verified acquisition/integration checkpoints | Knowledge Backend | Describe actual retained material and completed/pending domain effects |
| Profile, preferences, adapter bindings, personal templates, scoped grants | Selected User Control store | User-specific execution context, independent of the domain store |
| Which origins to ingest, retention choices, requested cadence, runner registration reference | Selected User Control store | Configuration of what is allowed and intended, not proof that processing occurred |
| Actual scheduler registration and execution status | Selected host/runner | External execution infrastructure; registration is not copied as a second job engine |
| Credentials and minimal connection/control locator | Existing host secret/bootstrap mechanism | Access must be possible before reading control; no credentials in Markdown templates |

Each instance selects one control authority. No implicit `.gpk` → Craft → cloud
fallback, no automatic merging of competing Profiles, and no multi-master sync.
Derived caches may be discarded; they cannot override a current authoritative read.

## 2. Common contract vocabulary

```ts
type Ref = { scope: string; id: string }; // opaque within a selected provider
type Version = string;                   // opaque; not necessarily a CAS token
type Capability = {
  mode: "native" | "emulated" | "degraded" | "unsupported";
  limits: string[];
  evidence: string[];                    // scope + observation/test reference
};
type Failure = {
  code: "not-found" | "ambiguous" | "unauthorized" | "unavailable"
      | "unsupported" | "invalid" | "conflict" | "partial" | "uncertain";
  message: string;
  affected: Ref[];
  next: string;                          // safe recovery, not blind retry
};
type Result<T> = { ok: true; value: T; limits: string[] }
               | { ok: false; error: Failure };
type Page<T> = {
  items: T[];
  next?: string;
  coverage: "complete" | "partial" | "unknown";
};
type ReadOptions = { cursor?: string; limit?: number };
type Snapshot<T> = {
  ref: Ref;
  value: T;
  version?: Version;
  coverage: "complete" | "partial" | "unknown";
  next?: string;
};
type WriteGuard = {
  expected?: Version;
  authority: string;                     // reference to approved scope, not a secret
};
type WriteReceipt = {
  affected: Ref[];
  verified: boolean;
  version?: Version;
  recovery?: string;
};
type CreateReceipt = WriteReceipt & { created: Ref };
```

These are operation envelopes, not properties added to all six entities.
`expected` is an atomic precondition **only when the selected capability says so**;
a content fingerprint can detect divergence without preventing a concurrent edit.
An authority reference is not itself authorization: check current control and
host permissions. An adapter cannot manufacture a grant by accepting a string.
Unknown state, incomplete search and inaccessible content must not be returned as
an empty successful result. Report partial effects even if the final tool call failed.
Creation returns the canonical created reference explicitly; `affected` is not an
ordered return-value convention. Reads and discovery carry coverage/continuation;
an incomplete Project read cannot establish that no unfinished child Tasks remain.

All methods run with an explicitly bound instance/provider scope. This binding
is request context recovered from the selected stores, not a private adapter DB.

## 3. Knowledge Backend Adapter

```ts
type EntityKind = "Area" | "Project" | "Task" | "Source" | "Wiki" | "Output";
type Entity = {
  kind: EntityKind;
  title: string;
  content: string;                       // readable meaning; attachments use refs
  state?: string;                        // only the kind's defined states
  time?: string;                         // Task only; absent means unset
  parent?: Ref;                          // Task's primary Project, when present
};
type Query = {
  kinds?: EntityKind[];
  text?: string;
  within?: Ref;
  states?: string[];
  taskTime?: { from?: string; to?: string; includeUnset?: boolean };
  cursor?: string;
};
type ContentEdit = {
  target: Ref;
  before: string;                        // exact expected fragment, not a regex
  after: string;
};
type Relation = { from: Ref; to: Ref; context: string };
type RelationEdit = Relation & { action: "link" | "unlink" };
type OrganizationEdit =
  | { action: "rename"; title: string }
  | { action: "move"; destination: Ref }
  | { action: "order"; orderedChildren: Ref[] }
  | { action: "archive" | "restore" };
type ContentNode = { ref: Ref; content: string; hasChildren: boolean };
type ContentInput = {
  content: string;
  presentation: "inline" | "child-document";
  title?: string;
};

interface KnowledgeBackendAdapter {
  capabilities(): Promise<Result<Record<string, Capability>>>;
  resolve(locator: string): Promise<Result<Ref>>;
  read(ref: Ref, options?: ReadOptions): Promise<Result<Snapshot<Entity>>>;
  query(query: Query): Promise<Result<Page<Snapshot<Entity>>>>;
  create(entity: Entity, destination: Ref, guard: WriteGuard): Promise<Result<CreateReceipt>>;
  resolveSurface(name: "inbox" | "daily-notes", date?: string): Promise<Result<Ref>>;
  readContent(ref: Ref, options?: ReadOptions): Promise<Result<Page<ContentNode>>>;
  insertContent(parent: Ref, input: ContentInput, after: Ref | null, guard: WriteGuard): Promise<Result<CreateReceipt>>;
  patch(ref: Ref, edits: ContentEdit[], guard: WriteGuard): Promise<Result<WriteReceipt>>;
  relations(ref: Ref, cursor?: string): Promise<Result<Page<Relation>>>;
  relate(edit: RelationEdit, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  setState(ref: Ref, state: string, reason: string, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  setTaskTime(ref: Ref, time: string | null, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  organize(ref: Ref, edit: OrganizationEdit, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  remove(ref: Ref, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  readCheckpoint(key: string): Promise<Result<Snapshot<string> | null>>;
  saveCheckpoint(key: string, content: string, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}
```

The normalized Entity is a working projection, not a required database row.
Preserve provider-native children, formatting and unknown content; do not rewrite
the whole document from this projection. Operations may use richer typed content
when the actual block API requires it. A partial read must state its coverage.
State strings are validated against the kind and the transition table, not treated
as arbitrary custom values. `patch` cannot bypass state/time or ownership invariants.

### State representation and query guarantees

`query({ kinds: ["Project"], states: ["active"] })` requests domain meaning, not
`filterByTag`. A provider can represent that state with a native field, a reserved
system tag or a documented content convention. Representation/read/write support
does not establish native filtering, indexing or tag-hierarchy support. Select one
authoritative encoding; templates cannot introduce a competing state value.

- Enforce every supplied predicate, including scope, kind, state and Task time.
  Multiple values within `kinds` or `states` are alternatives; different supplied
  predicates are combined. Reject invalid combinations. Never silently drop a
  filter or substitute a provider's differently defined `active` scope.
- Declare capability per supported predicate, scope and retrieval strategy, not
  merely `query: supported`. Native means the exposed tool fulfills the required
  semantics; emulated means composition over current backend facts preserves them.
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

Surface/content operations support raw captures and Project process material
without pretending they are domain entities. Surface resolution is read-only;
an absent or unsupported surface is reported, not created implicitly. A null
`after` means insert at the start of the resolved container; a non-null reference
must be a current child of that container. A content node may be a block, section
or page according to the provider; preserve child references and report nesting/
format limits. A daily date is interpreted in the configured instance timezone.
Requested native child-document presentation is capability-gated; do not silently
flatten it or fabricate another Wiki. An agreed inline/link fallback can be a
separate operation. Raw edits affecting recognized entities still apply the same
state, time and ownership checks. Create an
accepted action with `create(Task, ...)`, not raw checkbox text that bypasses Task
semantics. Entity and content operations share preservation and verification rules.

The Domain layer composes these primitives. For example, `Project.complete`
requires an outcome assessment and explicit disposition of remaining Tasks before
the state transition; it is not equivalent to calling `setState` alone. Creating
a Project and its Tasks is a verified sequence, not an assumed atomic call.
`remove` does not cascade; unresolved child/reference impact prevents claiming a
safe deletion. An inbound-link scan reports its actual coverage.

Checkpoint documents or sections are operational support content, not another
domain entity or a User Control preference. Store progress after its corresponding
effect is verified. A failed checkpoint write requires inspecting actual entities
before replay. Initial checkpoint payloads may be readable text; only fields
consumed by implemented retry helpers need structured schemas.

The [Craft mapping](../adapters/knowledge/craft/mapping.md) owns concrete encoding
choices, tool mappings, dated observations and outstanding read/write checks.
Evidence from one connection does not establish another connection's capabilities.
Enable mutations only after the relevant mapping and templates are implemented
and validated; interface signatures alone do not provide write support.

## 4. User Control Adapter

```ts
type ControlLocator = {
  provider: string;                      // e.g. knowledge-backend; not a domain enum
  instance: string;
  location: string;                      // opaque locator, no credentials
};
type ControlKey = string;                // profile, settings, templates/project, ...
type ControlResource = { content: string; mediaType: string };

interface UserControlAdapter {
  capabilities(): Promise<Result<Record<string, Capability>>>;
  discover(locator: ControlLocator, cursor?: string): Promise<Result<Page<Ref>>>;
  read(key: ControlKey): Promise<Result<Snapshot<ControlResource> | null>>;
  list(prefix: string, cursor?: string): Promise<Result<Page<ControlKey>>>;
  write(key: ControlKey, value: ControlResource, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  remove(key: ControlKey, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}
```

The logical key is scoped to the selected instance. It is not a required file
path or a fixed list of Profile fields. `null` means genuinely unconfigured;
missing configured targets, permission denial and an unavailable store are errors.
A schema version is appropriate for settings consumed by resolver code, not a
reason to turn the entire Profile or template into JSON.
Resolve required discovery coverage before deciding that zero candidates means
unset or that one is unique. A configured resource read must return complete
content for its consumer, or a partial/unavailable result that stops dependent
writes; it must not silently use the visible first page as the entire template.

The adapter reads/writes selected resources; [template resolution](workflows.md#3-templates)
belongs to shared workflow logic. It does not decide methodology, silently repair
content, or expand authorization. Template bodies or
explicit external resource references are allowed, but unavailable referenced
resources remain errors. Ordinary Source content cannot masquerade as control.

Initial knowledge-backed control maps logical keys to identifiable Craft
documents/sections and linked resources, reusing transport/codec without a fake
Wiki entity. Its mapping remains an inactive design reservation. Future local
control may use an explicitly selected `.gpk` root with `settings.json`,
`profile.md` and `templates/project.md`: resolve keys only inside that root,
preserve text and apply actual filesystem version/replacement guarantees. Future
cloud control requires an authenticated namespace and separately implemented API
with equivalent permissions and resource semantics. Neither future provider ships.

The host supplies the minimal `ControlLocator` before reading remaining bindings
and preferences. [Discovery, current context and explicit provider cutover](workflows.md#2-current-user-resources-and-context)
define shared orchestration. Missing access cannot trigger another authority,
and independent control/domain writes must retain independent verified outcomes.

## 5. Agent Harness Adapter

```ts
type ResourceText = { content: string; origin: string };
type ToolInfo = { name: string; inputContract: string; limits: string[] };
type SourceRead = {
  origin: string;
  content: string;
  coverage: string;
  version?: string;
  next?: string;
};
type TriggerRequest = { intent: string; scope: string; schedule: string };

interface AgentHarnessAdapter {
  capabilities(): Promise<Result<Record<string, Capability>>>;
  loadResource(packageRelativePath: string): Promise<Result<ResourceText>>;
  discoverTools(purpose: string): Promise<Result<ToolInfo[]>>;
  invokeTool(name: string, input: unknown): Promise<Result<unknown>>;
  ask(question: string): Promise<Result<string>>;
  requestAuthorization(scope: string, proposedEffect: string): Promise<Result<string>>;
  readSource(origin: string, continuation?: string): Promise<Result<SourceRead>>;
  registerTrigger(request: TriggerRequest, authority: string): Promise<Result<Ref>>;
  inspectTrigger(ref: Ref): Promise<Result<string>>;
  removeTrigger(ref: Ref, authority: string): Promise<Result<WriteReceipt>>;
}
```

This is a contract for host facilities, not a second Agent loop. A Markdown
implementation can instruct the current Agent to use an available host tool;
it need not expose a JavaScript object with access to every tool. A Node helper
does not inherit MCP tools from the conversation. Pass it bounded input for
mechanical work; only an explicitly implemented/authorized transport can call
external APIs. `ask` is conversation; a recorded answer is not a hard permission
gate. Host controls and the current operation grant remain the actual boundary.

The [Claude Code](../adapters/harness/claude-code/mapping.md) and
[Codex](../adapters/harness/codex/mapping.md) mappings own package/resource loading
and host-specific limits. Do not extrapolate support across CLI, desktop, cloud
or other product surfaces. Actual tools, readers and triggers need separate
integration evidence. [Source and periodic-execution contracts](workflows.md#5-generic-source-processing-and-periodic-execution)
define how available host facilities compose shared Ingest; neither package
currently implements a reader or timer.

## 6. Contract verification

The [conformance scenarios](../../knowledge/conformance-scenarios.md) are the sole
acceptance inventory for domain behavior, workflow coverage and implementation
cases, including interface checks and evidence requirements. Packaging or mock
checks do not establish live integration conformance.
