import type {
  Area, AreaRef, AreaState, Output, OutputRef, Project, ProjectRef,
  ProjectState, Ref, Source, SourceRef, Task, TaskRef, TaskState, Wiki, WikiRef,
} from "./entities.js";
import type {
  Capabilities, ControlGrant, CreateReceipt, GrantedWriteGuard, Page, ReadOptions, Result, Snapshot,
  WriteReceipt,
} from "./operation-types.js";
import type { KnowledgeLayout, TemplateBindingChanges, TemplateRole } from "./user-control-port.js";

/**
 * Domain-facing operations required from one bound knowledge store.
 *
 * Concrete provider implementations (Craft, Notion, Feishu, Obsidian) own provider
 * APIs, native schemas and physical placement. Runtime operations construct and call
 * the active provider exclusively through this interface. Entity operations are
 * declared independently without a generic Entity/EntityRef super-abstraction.
 *
 * Resolution validates kind and scope; queries apply all predicates and report
 * coverage independently of cursor exhaustion. Creation follows the selected
 * provider binding and the input's domain ownership.
 * Updates edit selected prose (`edits`), append prose (`append`), or replace the
 * full body under an explicit `expected` revision (`replaceContent`), preserving
 * unrelated native properties and structures. State, time and primary ownership
 * use dedicated methods.
 *
 * Every mutation receives a `GrantedWriteGuard` carrying the active backend's
 * current `grants` from User Control. The adapter resolves the target's actual
 * native container(s) (including both source and destination on moves) and verifies
 * that a supplied grant covers each required root and operation ID before writing,
 * returning `unauthorized` otherwise. Authorization is never read from tool strings.
 *
 * Templates live in the backend (native Templates area where supported, such as
 * Craft's `templates` location or Obsidian's `Templates/` folder, or a managed
 * template container otherwise) so people and Agents share one editable source.
 * System fields (status, primary Area, Project owner, planned time) live in native
 * structured properties rather than parsed body text, so user edits to body templates
 * never corrupt domain state.
 *
 * @see docs/storage-contracts.md for preservation, coverage and effect guarantees.
 */
export interface KnowledgeBackendPort {
  /** Report per-domain operation/predicate, e.g. projects.query.states or tasks.schedule. */
  capabilities(): Promise<Result<Capabilities>>;
  readonly workspace: WorkspaceOperations;
  readonly templates: KnowledgeTemplateOperations;
  readonly areas: AreaOperations;
  readonly projects: ProjectOperations;
  readonly tasks: TaskOperations;
  readonly sources: SourceOperations;
  readonly wikis: WikiOperations;
  readonly outputs: OutputOperations;
  readonly captures: CaptureOperations;
  readonly links: KnowledgeLinks;
  readonly checkpoints: ProcessingCheckpoints;
}

// Workspace setup, discovery and templates

export type WorkspaceSpace = {
  /** Canonical provider scope ID (e.g. Craft space ID, Notion workspace ID, Vault ID). */
  id: string;
  /** Human-readable workspace name. */
  name: string;
  /** Effective IANA timezone for calendar-dated operations in this workspace. */
  timezone: string;
};

export type WorkspaceLocationCheck = {
  role: keyof KnowledgeLayout["locations"];
  ref: Ref;
  status: "ok" | "unset" | "missing" | "wrong-kind";
  detail: string;
};

export type DiscoveredWorkspace = {
  home: { id: string; title: string };
  areas: { id: string; name: string; items: number };
  projects: { id: string; name: string; items: number };
  folders: {
    source: { id: string; name: string; documents: number };
    wiki: { id: string; name: string; documents: number };
    output: { id: string; name: string; documents: number };
  } | null;
  templates?: TemplateBindingChanges;
  namespace: string | null;
  metadataLanguage: "en" | "zh-CN" | null;
};

export type WorkspaceInspection = {
  locations: WorkspaceLocationCheck[];
  candidates: {
    collections: { id: string; name: string; items: number; documentId: string }[];
    folders: { id: string; name: string; documents: number; parentId: string | null }[];
  };
  /** Present when inspected without a configured layout. */
  existing?: DiscoveredWorkspace[];
};

export type WorkspacePlan = {
  /** Where created structures go: `root` (dedicated workspace), or a namespace container by name or ID. */
  namespace?: { folder: string } | { folderId: string } | "root";
  hostDocument: { title: string } | { rootId: string };
  areas: { name: string } | { id: string };
  projects: { name: string } | { id: string };
  tasks?: { name: string } | { id: string };
  sources: { name: string } | { id: string };
  wikis: { name: string } | { id: string };
  outputs: { name: string } | { id: string };
  metadataLanguage?: "en" | "zh-CN";
  views?: boolean;
  templates?: boolean;
};

export type WorkspaceEstablishment = {
  locations: KnowledgeLayout["locations"];
  /** Role-keyed bindings for installed or adopted backend templates. */
  templateBindings: TemplateBindingChanges;
  created: Ref[];
  adopted: Ref[];
  namespace: Ref | null;
  views: string[];
  templates: Ref[];
};

export interface WorkspaceOperations {
  /** Resolve verified workspace identity and effective IANA timezone. */
  space(): Promise<Result<WorkspaceSpace>>;
  /** Inspect configured locations or discover reusable GPK workspaces in the backend. */
  inspect(locations?: KnowledgeLayout["locations"]): Promise<Result<WorkspaceInspection>>;
  /** Establish or adopt workspace structures, views and native/managed entity templates. */
  establish(plan: WorkspacePlan): Promise<Result<WorkspaceEstablishment>>;
  /** Propose the provider's default non-destructive grant set for the bound layout. */
  defaultGrants(scope: string, locations: KnowledgeLayout["locations"]): ControlGrant[];
}

export type BackendTemplate = {
  role: TemplateRole;
  /** Sanitized Markdown/provider-dialect blueprint ready for Agent authoring. */
  content: string;
};

export interface KnowledgeTemplateOperations {
  /**
   * Read an entity template from the backend (native Templates area where supported,
   * or managed template document), preserving user-authored dialect blocks (such as
   * callouts, dividers and headings) while stripping GPK's onboarding banner and
   * sanitizing stray native task checkboxes on non-task roles.
   */
  read(ref: Ref, role: TemplateRole): Promise<Result<Snapshot<BackendTemplate>>>;
  /**
   * Optional discovery of canonical GPK role templates in the backend's native template
   * store when Settings has not yet persisted explicit template bindings.
   */
  discover?(): Promise<Result<TemplateBindingChanges>>;
}

// Shared prose edits and updates

/** A narrow body edit in the adapter's readable content representation. For an
 * array, apply edits in order to a working copy of fresh content and validate all
 * matches before writing. This preflight does not promise atomic persistence.
 */
export type TextEdit = {
  /** Nonempty literal text that must occur exactly once at this step; case-sensitive,
   * no regex or normalization. Missing/duplicate matches are conflict, not append.
   */
  before: string;
  /** Literal replacement, with actual newlines; an empty string deletes the match. */
  after: string;
};

/** Shared body/title mutation options across document- and row-backed entities.
 * Supply at least one field. `replaceContent` requires `guard.expected` and is
 * mutually exclusive with `edits` and `append`.
 */
export type ContentUpdate = {
  /** Omitted leaves title unchanged; supplied title must be nonblank. */
  title?: string;
  /** Narrow replacements applied in array order before any `append`. */
  edits?: TextEdit[];
  /** Readable text appended to the end of the body without matching existing lines. */
  append?: string;
  /** Full body replacement guarded by `expected` (for interrupted empty-record recovery or explicit rewrite). */
  replaceContent?: string;
};

// Areas

export type AreaInput = {
  /** Nonblank human-readable Area name. */
  title: string;
  /** Prepared direction/responsibility body in the adapter's readable text format. */
  content: string;
  /** Explicit initial participation state; no adapter default. */
  state: AreaState;
};
export type AreaQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body, using
   * provider-supported search or bounded enumeration; actual match mode and coverage
   * are disclosed in `Capabilities` and `Result.limits`.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity. Either direction counts;
   * primary ownership and transitive reachability do not.
   */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: AreaState[];
};
export interface AreaOperations {
  resolve(locator: string): Promise<Result<AreaRef>>;
  read(ref: AreaRef, options?: ReadOptions): Promise<Result<Snapshot<Area, AreaRef>>>;
  query(query: AreaQuery): Promise<Result<Page<Snapshot<Area, AreaRef>>>>;
  create(input: AreaInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<AreaRef>>>;
  update(ref: AreaRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  transition(ref: AreaRef, state: AreaState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Projects and process material

export type ProjectInput = {
  /** Nonblank human-readable Project name. */
  title: string;
  /** Prepared Objective/KRs, plan and context in the adapter's readable text format. */
  content: string;
  /** Requested initial state, subject to the domain's creation rules. */
  state: ProjectState;
  /** Required exactly when state is paused, completed or canceled: records existing
   * history rather than a new commitment. `date` is YYYY-MM-DD when known.
   */
  history?: { origin: string; date?: string };
  /** Exactly one resolved primary Area in this scope; an inactive Area is valid. */
  primaryArea: AreaRef;
};
export type ProjectQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body. */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: ProjectState[];
  /** Exact primary Area, independent of physical placement. Omit for any primary Area. */
  area?: AreaRef;
};

/** Process material belongs to a Project, not a seventh domain entity. */
export type ProjectMaterialRef = Ref & {
  role: "project-material";
  /** Resolved owning Project; material identity and current ownership must agree. */
  project: ProjectRef;
};
export type ProjectMaterial = {
  /** Nonblank material heading/name, independent of the Project title. */
  title: string;
  /** Readable research, draft or decision body; may be empty, no provider JSON. */
  content: string;
  /** Child documents require provider capability; both forms preserve the owning Project. */
  presentation: "inline" | "child-document";
};
export interface ProjectMaterials {
  list(project: ProjectRef, options?: ReadOptions): Promise<Result<Page<Snapshot<ProjectMaterial, ProjectMaterialRef>>>>;
  read(ref: ProjectMaterialRef, options?: ReadOptions): Promise<Result<Snapshot<ProjectMaterial, ProjectMaterialRef>>>;
  append(project: ProjectRef, material: ProjectMaterial, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<ProjectMaterialRef>>>;
  update(ref: ProjectMaterialRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
export interface ProjectOperations {
  resolve(locator: string): Promise<Result<ProjectRef>>;
  read(ref: ProjectRef, options?: ReadOptions): Promise<Result<Snapshot<Project, ProjectRef>>>;
  query(query: ProjectQuery): Promise<Result<Page<Snapshot<Project, ProjectRef>>>>;
  create(input: ProjectInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<ProjectRef>>>;
  update(ref: ProjectRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  transition(ref: ProjectRef, state: ProjectState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  assignArea(ref: ProjectRef, area: AreaRef, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  orderTasks(ref: ProjectRef, tasks: TaskRef[], guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  readonly materials: ProjectMaterials;
}

// Tasks

export type TaskInput = {
  /** Nonblank concise action name. */
  title: string;
  /** Readable description, materials and known results; may be empty. */
  content: string;
  /** Requested initial state, subject to the domain's creation rules. */
  state: TaskState;
  /** Required exactly when state is done or canceled: records existing history,
   * not completed now. Providers that place standalone Tasks in dated surfaces may
   * require `date` when `project` is omitted and return `invalid` if absent.
   */
  history?: { origin: string; date?: string };
  /** Optional planned attention date YYYY-MM-DD in the bound instance timezone. */
  time?: string;
  /** Optional resolved primary Project in this scope; omission means standalone. */
  project?: ProjectRef;
};
export type TaskQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body. */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: TaskState[];
  /** Omitted: any ownership. Null: standalone Tasks only. */
  project?: ProjectRef | null;
  /** Omit to impose no time filter. */
  time?: {
    from?: string;
    to?: string;
    includeUnset?: boolean;
  };
};
export interface TaskOperations {
  resolve(locator: string): Promise<Result<TaskRef>>;
  read(ref: TaskRef, options?: ReadOptions): Promise<Result<Snapshot<Task, TaskRef>>>;
  query(query: TaskQuery): Promise<Result<Page<Snapshot<Task, TaskRef>>>>;
  create(input: TaskInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<TaskRef>>>;
  update(ref: TaskRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  transition(ref: TaskRef, state: TaskState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  assignProject(ref: TaskRef, project: ProjectRef | null, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  schedule(ref: TaskRef, time: string | null, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Sources

export type SourceInput = {
  /** Nonblank source name. */
  title: string;
  /** Prepared readable material, origin and actual access evidence. */
  content: string;
  /** Optional local file URL (`file:///...`) to upload and attach as the original. */
  originalFile?: string;
};
export type SourceUpdate = ContentUpdate & {
  /** Attach a local file URL (`file:///...`) to this Source via the backend upload route. */
  originalFile?: string;
};
export type SourceQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body. */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface SourceOperations {
  resolve(locator: string): Promise<Result<SourceRef>>;
  read(ref: SourceRef, options?: ReadOptions): Promise<Result<Snapshot<Source, SourceRef>>>;
  query(query: SourceQuery): Promise<Result<Page<Snapshot<Source, SourceRef>>>>;
  create(input: SourceInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<SourceRef>>>;
  update(ref: SourceRef, update: SourceUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Wikis

export type WikiInput = {
  /** Nonblank subject name. */
  title: string;
  /** Prepared readable explanation and supporting links. */
  content: string;
};
export type WikiQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body. */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface WikiOperations {
  resolve(locator: string): Promise<Result<WikiRef>>;
  read(ref: WikiRef, options?: ReadOptions): Promise<Result<Snapshot<Wiki, WikiRef>>>;
  query(query: WikiQuery): Promise<Result<Page<Snapshot<Wiki, WikiRef>>>>;
  create(input: WikiInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<WikiRef>>>;
  update(ref: WikiRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Outputs

export type OutputInput = {
  /** Nonblank artifact name. */
  title: string;
  /** Readable artifact content/reference and relevant producers. */
  content: string;
};
export type OutputQuery = ReadOptions & {
  /** Case-insensitive keyword/substring match over title or readable body. */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface OutputOperations {
  resolve(locator: string): Promise<Result<OutputRef>>;
  read(ref: OutputRef, options?: ReadOptions): Promise<Result<Snapshot<Output, OutputRef>>>;
  query(query: OutputQuery): Promise<Result<Page<Snapshot<Output, OutputRef>>>>;
  create(input: OutputInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<OutputRef>>>;
  update(ref: OutputRef, update: ContentUpdate, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Captures, links and checkpoints

export type CaptureSurface = { name: "inbox" } | {
  name: "daily-notes";
  /** Valid YYYY-MM-DD calendar date in the bound instance timezone; no implicit today. */
  date: string;
};
export type CaptureSurfaceRef = Ref & { role: "capture-surface" };
export type CaptureRef = Ref & {
  role: "capture";
  /** Current owning surface in this binding; verify membership, not just the ID. */
  surface: CaptureSurfaceRef;
};
export type Capture = {
  /** Raw readable capture body, possibly empty; not an accepted Task or another recognized entity. */
  content: string;
};
export interface CaptureOperations {
  /** Record a factual, single-line outcome or retained Source link for the local calendar date.
   * Retrying the same date, wording and reference returns the existing entry idempotently.
   */
  recordActivity(date: string, summary: string, related: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef | undefined, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /** Resolve an existing capture surface without creating it. */
  resolve(surface: CaptureSurface): Promise<Result<CaptureSurfaceRef>>;
  /** List raw captures on a resolved capture surface. */
  list(surface: CaptureSurfaceRef, options?: ReadOptions): Promise<Result<Page<Snapshot<Capture, CaptureRef>>>>;
  /** Read one capture after verifying membership on `ref.surface`. */
  read(ref: CaptureRef, options?: ReadOptions): Promise<Result<Snapshot<Capture, CaptureRef>>>;
}

/** One directed contextual relation, including a Project's additional Area associations. */
export type KnowledgeLink = {
  from: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  to: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  context: string;
};
export interface KnowledgeLinks {
  query(
    ref: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef,
    options?: ReadOptions,
  ): Promise<Result<Page<KnowledgeLink>>>;
  add(link: KnowledgeLink, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  remove(link: KnowledgeLink, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

/** Persist verified ingestion progress in the backend, not an adapter cache. */
export interface ProcessingCheckpoints {
  read(key: string): Promise<Result<Snapshot<string> | null>>;
  save(key: string, content: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
