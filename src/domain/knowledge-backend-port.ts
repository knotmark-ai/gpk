import type {
  Area, AreaRef, AreaState, Output, OutputRef, Project, ProjectRef,
  ProjectState, Ref, Source, SourceRef, Task, TaskRef, TaskState, Wiki, WikiRef,
} from "./entities.js";
import type {
  Capabilities, CreateReceipt, GrantedWriteGuard, Page, ReadOptions, Result, Snapshot,
  WriteReceipt,
} from "./operation-types.js";

/**
 * Domain-facing operations required from one bound knowledge store.
 *
 * A concrete provider implementation (for example CraftKnowledgeBackendAdapter)
 * owns provider APIs and physical placement. The GPK entrypoint constructs it and
 * calls it through this interface. Entity operations are declared independently.
 * Read operations are stable; write operations are draft until the first provider
 * caller is implemented behind the GPK entrypoint.
 *
 * Resolution validates kind and scope; queries apply all predicates and report
 * coverage independently of cursor exhaustion. Creation follows the selected
 * provider binding and the input's domain ownership.
 * Updates edit selected prose only, matching against fresh content; ambiguous or
 * missing matches require conflict handling. State, time and primary ownership
 * use dedicated methods. Archiving/restoring changes presentation only, preserving
 * identity, lifecycle and ownership; restoring deleted content needs separate
 * provider support. Removal never cascades implicitly: inspect child/reference
 * impact and report recovery limits.
 *
 * Every mutation receives a GrantedWriteGuard whose grant the runtime resolved from
 * the selected control store. The implementation verifies that the operation ID is
 * listed and the target lies within grant.root before touching the provider, and
 * returns unauthorized otherwise; the provider connection's own scope remains the
 * outer limit. Authorization is never read from caller-supplied strings.
 *
 * Every reference is bound to this adapter's scope; callers obtain it through
 * resolution or a prior result. Revalidate kind, existence and current permission.
 * Malformed inputs/wrong kinds return invalid; out-of-scope access is unauthorized;
 * confirmed absence is not-found; multiple possible targets are ambiguous.
 * Unsupported operations/predicates return unsupported, never silently ignore input.
 * Normal validation, access and provider failures use Result, not rejected promises.
 * Omitted query predicates impose no restriction; supplied predicates combine with
 * AND. Queries include archived entities in scope; a retrieval strategy that cannot
 * discover them must disclose limited coverage. No default lifecycle filter applies.
 *
 * @see docs/storage-contracts.md for preservation, coverage and effect guarantees.
 */
export interface KnowledgeBackendPort {
  /** Report per-domain operation/predicate, e.g. projects.query.states or tasks.schedule. */
  capabilities(): Promise<Result<Capabilities>>;
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

/** A narrow body edit in the adapter's readable content representation. For an
 * array, apply edits in order to a working copy of fresh content and validate all
 * matches before writing. This preflight does not promise atomic persistence.
 *
 * Content is the provider's own dialect passed through unchanged; the adapter never
 * normalizes it. On a block-structured provider the edit is applied to the single
 * block whose body contains the match, after stripping any list marker or
 * indentation the read form renders; the block's structural fields are untouched.
 * A match that spans two blocks is a conflict, not a multi-block rewrite. Blocks
 * without body text (images, cards, collections) never match. An `after` that
 * contains a paragraph break may create additional blocks; the receipt lists every
 * created identity in `affected`.
 */
export type TextEdit = {
  /** Nonempty literal text that must occur exactly once at this step; case-sensitive,
   * no regex or normalization. Missing/duplicate matches are conflict, not append.
   * Include any inline formatting markup exactly as read when the match touches it.
   */
  before: string;
  /** Literal replacement, with actual newlines; an empty string deletes the match. */
  after: string;
};

// Areas

/** Initial title/body follow Area's content contract. State must explicitly be
 * active or inactive; do not infer it from placement or use a missing read state.
 */
export type AreaInput = {
  /** Nonblank human-readable Area name. */
  title: string;
  /** Prepared direction/responsibility body in the adapter's readable text format. */
  content: string;
  /** Explicit initial participation state; no adapter default. */
  state: AreaState;
};
export type AreaQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity. Either direction counts;
   * primary ownership and transitive reachability do not. Omit for no link filter.
   */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: AreaState[];
};
export interface AreaOperations {
  /**
   * Resolve one existing Area without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Area reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<AreaRef>>;
  /**
   * Read the current Area projection, preserving content-coverage evidence.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: AreaRef, options?: ReadOptions): Promise<Result<Snapshot<Area, AreaRef>>>;
  /**
   * Discover Area records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: AreaQuery): Promise<Result<Page<Snapshot<Area, AreaRef>>>>;
  /**
   * Create one Area using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: AreaInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<AreaRef>>>;
  /**
   * Edit only the selected Area title/body; preserve all unrelated native content.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Area revision.
   */
  update(ref: AreaRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Area revision.
   */
  archive(ref: AreaRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Area revision.
   */
  restore(ref: AreaRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Area revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: AreaRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Change proactive participation only; leave existing Projects and contextual links intact.
   * @param ref Resolved Area in this binding; validate current kind, scope and existence.
   * @param state Requested destination state, not the current state or an unchecked assignment.
   * @param reason Nonblank rationale retained with the change; not authorization or sufficient
   * evidence of readiness/completion. Required facts must be checked against current records.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Area revision.
   */
  transition(ref: AreaRef, state: AreaState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Projects and process material

/** Initial title/body follow Project's content contract, including Objective/KRs.
 * The caller supplies planned for ordinary creation; this required field has no
 * adapter default. Active needs the domain readiness/commitment checks. Other state
 * literals do not authorize historical import or bypass the domain creation rules.
 */
export type ProjectInput = {
  /** Nonblank human-readable Project name. */
  title: string;
  /** Prepared Objective/KRs, plan and context in the adapter's readable text format. */
  content: string;
  /** Requested initial state, subject to the domain's creation rules. */
  state: ProjectState;
  /** Exactly one resolved primary Area in this scope; an inactive Area is valid.
   * Additional Area associations use contextual links and do not change this owner.
   */
  primaryArea: AreaRef;
};
export type ProjectQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: ProjectState[];
  /** Exact primary Area, independent of physical placement. Omit for any primary Area.
   * Use relatedTo for contextual links, including associations with additional Areas.
   */
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
  /**
   * List process material belonging to exactly one Project.
   * @param project Resolved owning Project in this scope; no implicit descendant Project traversal.
   * @param options Discovery cursor/budget; omit to start. Read each incomplete item separately.
   */
  list(project: ProjectRef, options?: ReadOptions): Promise<Result<Page<Snapshot<ProjectMaterial, ProjectMaterialRef>>>>;
  /**
   * @param ref Resolved material identity and owning Project; verify both before reading.
   * @param options This material's content cursor/budget, not the list cursor.
   */
  read(ref: ProjectMaterialRef, options?: ReadOptions): Promise<Result<Snapshot<ProjectMaterial, ProjectMaterialRef>>>;
  /**
   * Append material while preserving the Project and existing material.
   * @param project Resolved owner in this scope.
   * @param material Initial heading/body and requested presentation; unsupported child-document
   * presentation fails unsupported rather than silently flattening or creating a Wiki.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the owning Project's revision.
   * @returns Canonical material ref; the receipt version, if present, belongs to the new material.
   */
  append(project: ProjectRef, material: ProjectMaterial, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<ProjectMaterialRef>>>;
  /**
   * Edit process material without changing the Project or recognized nested entities.
   * @param ref Resolved material and current owner in this scope.
   * @param update Optional nonblank title and ordered TextEdits; omitted fields stay unchanged.
   * At least a title or one edit is required. Presentation and ownership cannot change here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is this material's revision.
   */
  update(ref: ProjectMaterialRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove this material only; assess references and preserve the owning Project/other material.
   * @param ref Resolved material and current owner in this scope.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is this material's revision.
   */
  remove(ref: ProjectMaterialRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
export interface ProjectOperations {
  /**
   * Resolve one existing Project without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Project reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<ProjectRef>>;
  /**
   * Read the current Project projection, preserving content-coverage evidence.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: ProjectRef, options?: ReadOptions): Promise<Result<Snapshot<Project, ProjectRef>>>;
  /**
   * Discover Project records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: ProjectQuery): Promise<Result<Page<Snapshot<Project, ProjectRef>>>>;
  /**
   * Create one Project using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: ProjectInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<ProjectRef>>>;
  /**
   * Edit only the selected Project title/body; preserve all unrelated native content.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   */
  update(ref: ProjectRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   */
  archive(ref: ProjectRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   */
  restore(ref: ProjectRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: ProjectRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Persist a reviewed transition. Check domain readiness/outcomes and resolve remaining Tasks
   * before closure; neither this nor creation silently changes child Task states.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param state Requested destination state, not the current state or an unchecked assignment.
   * @param reason Nonblank rationale retained with the change; not authorization or sufficient
   * evidence of readiness/completion. Required facts must be checked against current records.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   */
  transition(ref: ProjectRef, state: ProjectState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Change primary Area without altering lifecycle, Tasks or independent contextual links.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param area Resolved replacement primary Area in this scope; cannot be null. Inactive is valid.
   * @param reason Nonblank rationale to retain with the ownership change.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Project revision.
   */
  assignArea(ref: ProjectRef, area: AreaRef, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Replace the order of the complete current Task plan; do not assign, delete or change Tasks.
   * @param ref Resolved Project in this binding; validate current kind, scope and existence.
   * @param tasks Full ordered list of current primary child Task refs, each exactly once.
   * Include terminal Tasks still in the plan; [] is valid only for a confirmed empty plan.
   * Duplicates/foreign Tasks are invalid; stale or incomplete membership is a conflict.
   * @param guard Runtime-resolved grant for this target; expected is the Project/plan revision, not a child revision.
   * Recheck current plan membership even when the provider version covers only Project content.
   */
  orderTasks(ref: ProjectRef, tasks: TaskRef[], guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  readonly materials: ProjectMaterials;
}

// Tasks

/** Initial title/body follow Task's content contract. Ordinary creation explicitly
 * supplies todo; other literals do not bypass domain creation/transition rules.
 * Omitted project creates a standalone Task; omitted time leaves it unscheduled.
 * A supplied project is a resolved primary Project, not a folder or contextual link.
 */
export type TaskInput = {
  /** Nonblank concise action name. */
  title: string;
  /** Readable description, materials and known results; may be empty. */
  content: string;
  /** Requested initial state, subject to the domain's creation rules. */
  state: TaskState;
  /** Optional planned attention date YYYY-MM-DD in the bound instance timezone. */
  time?: string;
  /** Optional resolved primary Project in this scope; omission means standalone. */
  project?: ProjectRef;
};
export type TaskQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Allowed states (OR). Omitted means any state; [] matches none. */
  states?: TaskState[];
  /** Omitted: any ownership. Null: standalone Tasks only. */
  project?: ProjectRef | null;
  /** Omit to impose no time filter. When supplied, select dated Tasks in the
   * inclusive range plus known unscheduled Tasks only if includeUnset is true.
   * This does not determine executable Focus; parent state still matters.
   */
  time?: {
    /** Inclusive calendar date YYYY-MM-DD in the instance timezone; omitted = no lower bound. */
    from?: string;
    /** Inclusive date in the same format; omitted = no upper bound. Invalid dates or from > to are invalid. */
    to?: string;
    /** Default false. Include confirmed absence of planned time, never an unknown partial-read field. */
    includeUnset?: boolean;
  };
};
export interface TaskOperations {
  /**
   * Resolve one existing Task without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Task reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<TaskRef>>;
  /**
   * Read the current Task projection, preserving content-coverage evidence.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: TaskRef, options?: ReadOptions): Promise<Result<Snapshot<Task, TaskRef>>>;
  /**
   * Discover Task records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: TaskQuery): Promise<Result<Page<Snapshot<Task, TaskRef>>>>;
  /**
   * Create one Task using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: TaskInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<TaskRef>>>;
  /**
   * Edit only the selected Task title/body; preserve all unrelated native content.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  update(ref: TaskRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  archive(ref: TaskRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  restore(ref: TaskRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: TaskRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Persist a justified transition; validate parent execution eligibility separately.
   * Completing a Task does not complete its Project.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param state Requested destination state, not the current state or an unchecked assignment.
   * @param reason Nonblank rationale retained with the change; not authorization or sufficient
   * evidence of readiness/completion. Required facts must be checked against current records.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  transition(ref: TaskRef, state: TaskState, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Change primary ownership while preserving state, planned time and useful context.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param project Resolved replacement Project in this scope, or null to make the Task standalone.
   * @param reason Nonblank rationale to retain with the ownership change.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  assignProject(ref: TaskRef, project: ProjectRef | null, reason: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Set or clear the single planned attention date; preserve lifecycle, results and fixed constraints.
   * @param ref Resolved Task in this binding; validate current kind, scope and existence.
   * @param time Valid calendar date YYYY-MM-DD in the bound instance timezone; null clears it.
   * A timestamp, impossible date, empty string or undefined is invalid. No implicit state transition.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Task revision.
   */
  schedule(ref: TaskRef, time: string | null, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Sources: origin/access evidence is readable content; preparation belongs to workflows.

/** Initial title/body with traceable origin and actual access evidence in the body.
 * No fetching, translation or synthesis is implied; the workflow prepares content.
 */
export type SourceInput = {
  /** Nonblank source name. */
  title: string;
  /** Prepared readable material, origin and actual access evidence. */
  content: string;
};
export type SourceQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface SourceOperations {
  /**
   * Resolve one existing Source without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Source reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<SourceRef>>;
  /**
   * Read the current Source projection, preserving content-coverage evidence.
   * @param ref Resolved Source in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: SourceRef, options?: ReadOptions): Promise<Result<Snapshot<Source, SourceRef>>>;
  /**
   * Discover Source records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: SourceQuery): Promise<Result<Page<Snapshot<Source, SourceRef>>>>;
  /**
   * Create one Source using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: SourceInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<SourceRef>>>;
  /**
   * Edit only the selected Source title/body; preserve all unrelated native content.
   * @param ref Resolved Source in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Source revision.
   */
  update(ref: SourceRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Source in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Source revision.
   */
  archive(ref: SourceRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Source in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Source revision.
   */
  restore(ref: SourceRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Source in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Source revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: SourceRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Wikis: synthesis belongs to workflows.

/** Initial title/body of a prepared explanation; creation does not perform synthesis. */
export type WikiInput = {
  /** Nonblank subject name. */
  title: string;
  /** Prepared readable explanation and supporting links. */
  content: string;
};
export type WikiQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface WikiOperations {
  /**
   * Resolve one existing Wiki without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Wiki reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<WikiRef>>;
  /**
   * Read the current Wiki projection, preserving content-coverage evidence.
   * @param ref Resolved Wiki in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: WikiRef, options?: ReadOptions): Promise<Result<Snapshot<Wiki, WikiRef>>>;
  /**
   * Discover Wiki records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: WikiQuery): Promise<Result<Page<Snapshot<Wiki, WikiRef>>>>;
  /**
   * Create one Wiki using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: WikiInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<WikiRef>>>;
  /**
   * Edit only the selected Wiki title/body; preserve all unrelated native content.
   * @param ref Resolved Wiki in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Wiki revision.
   */
  update(ref: WikiRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Wiki in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Wiki revision.
   */
  archive(ref: WikiRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Wiki in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Wiki revision.
   */
  restore(ref: WikiRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Wiki in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Wiki revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: WikiRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Outputs: artifact references are readable content.

/** Initial title/body identifying the retained artifact and relevant producers.
 * Saving the record does not publish, deploy or verify an external artifact.
 */
export type OutputInput = {
  /** Nonblank artifact name. */
  title: string;
  /** Readable artifact content/reference and relevant producers. */
  content: string;
};
export type OutputQuery = ReadOptions & {
  /** Case-sensitive literal substring of title or readable body; no provider query
   * syntax or normalization. Omitted/empty means no text restriction.
   */
  text?: string;
  /** Direct contextual link to/from this resolved entity, not ownership or transitive links. */
  relatedTo?: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
};
export interface OutputOperations {
  /**
   * Resolve one existing Output without creating or repairing it.
   * @param locator Exact provider locator (ID, URL or path) in an adapter-documented form;
   * not a title search, wildcard or credential. Ambiguity must not select a candidate.
   * @returns Canonical, scope-validated Output reference or an explicit failure.
   */
  resolve(locator: string): Promise<Result<OutputRef>>;
  /**
   * Read the current Output projection, preserving content-coverage evidence.
   * @param ref Resolved Output in this binding; validate current kind, scope and existence.
   * @param options Omit to start with the declared read budget; a cursor resumes this record.
   * @returns Snapshot with this record’s coverage and revision when available; absence is not-found.
   */
  read(ref: OutputRef, options?: ReadOptions): Promise<Result<Snapshot<Output, OutputRef>>>;
  /**
   * Discover Output records matching every supplied predicate.
   * @param query Entity-specific predicates and discovery pagination; {} adds no filters.
   * @returns A page with discovery coverage plus independent coverage for each snapshot.
   */
  query(query: OutputQuery): Promise<Result<Page<Snapshot<Output, OutputRef>>>>;
  /**
   * Create one Output using the selected provider placement convention.
   * @param input Initial domain content/fields; no provider ID or physical destination.
   * @param guard Runtime-resolved grant for this target; expected must be omitted because the target is new.
   * @returns Receipt naming the created canonical reference; creation is not implicitly idempotent.
   */
  create(input: OutputInput, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<OutputRef>>>;
  /**
   * Edit only the selected Output title/body; preserve all unrelated native content.
   * @param ref Resolved Output in this binding; validate current kind, scope and existence.
   * @param update Omitted title leaves it unchanged; supplied title must be nonblank.
   * Omitted/empty edits leaves the body unchanged. Nonempty edits follow TextEdit array order.
   * At least a title or one edit is required; lifecycle, time and ownership are not editable here.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Output revision.
   */
  update(ref: OutputRef, update: { title?: string; edits?: TextEdit[] }, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Archive presentation while preserving identity, lifecycle, ownership and useful links.
   * @param ref Resolved Output in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Output revision.
   */
  archive(ref: OutputRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Restore archived presentation; this does not recover deleted content.
   * @param ref Resolved Output in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Output revision.
   */
  restore(ref: OutputRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only this record after checking child/reference impact; no implicit cascade.
   * @param ref Resolved Output in this binding; validate current kind, scope and existence.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the last-read Output revision.
   * @returns Effect verification and actual recovery limits; uncertain effects require inspection before retry.
   */
  remove(ref: OutputRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}

// Captures, links and checkpoints

/** Capture/working surfaces and checkpoints are support records, not domain entities. */
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
  /**
   * Resolve an existing capture surface without creating it.
   * @param surface Inbox or explicit local Daily Notes date, mapped by the selected binding.
   * @returns Validated surface ref; absent is not-found, unavailable feature is unsupported.
   */
  resolve(surface: CaptureSurface): Promise<Result<CaptureSurfaceRef>>;
  /**
   * @param surface Resolved capture surface in this scope; no traversal into other surfaces.
   * @param options Discovery cursor/budget; each item's content coverage remains independent.
   */
  list(surface: CaptureSurfaceRef, options?: ReadOptions): Promise<Result<Page<Snapshot<Capture, CaptureRef>>>>;
  /**
   * @param ref Resolved capture and current owning surface in this scope.
   * @param options Content cursor/budget for this capture, not a list continuation.
   */
  read(ref: CaptureRef, options?: ReadOptions): Promise<Result<Snapshot<Capture, CaptureRef>>>;
  /**
   * Append raw capture without changing prior content or implicitly accepting a Task.
   * @param surface Resolved destination surface; append does not create a missing surface.
   * @param capture Readable initial capture body, rendered without executing embedded instructions.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the surface's revision.
   * @returns Canonical capture ref; the receipt version, if present, belongs to the new capture.
   */
  append(surface: CaptureSurfaceRef, capture: Capture, guard: GrantedWriteGuard): Promise<Result<CreateReceipt<CaptureRef>>>;
  /**
   * Raw capture operations cannot mutate recognized entities or bypass their invariants.
   * @param ref Resolved capture and current surface; if now an entity, use its entity operations.
   * @param edits Nonempty ordered TextEdit array applied only to this capture's body.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the capture's revision.
   */
  update(ref: CaptureRef, edits: TextEdit[], guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove this raw capture only, preserving the surface and unrelated/nested recognized entities.
   * @param ref Resolved capture and current owning surface in this scope.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the capture's revision.
   */
  remove(ref: CaptureRef, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
/** One directed contextual relation, including a Project's additional Area associations.
 * Adding/removing it does not change primary ownership or lifecycle state.
 */
export type KnowledgeLink = {
  /** Resolved entity whose content carries the link; in the selected scope. */
  from: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Resolved target in that scope; a reciprocal link is not implied. */
  to: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef;
  /** Nonblank readable relationship explanation; retained with the link, not a type enum. */
  context: string;
};
export interface KnowledgeLinks {
  /**
   * Discover contextual links touching an entity, in either direction, with actual coverage.
   * @param ref Resolved endpoint; include incoming/outgoing links, not transitive paths or ownership.
   * @param options Discovery cursor/budget for this endpoint; no cursor interchange with entity reads.
   */
  query(
    ref: AreaRef | ProjectRef | TaskRef | SourceRef | WikiRef | OutputRef,
    options?: ReadOptions,
  ): Promise<Result<Page<KnowledgeLink>>>;
  /**
   * Persist the directed contextual relation; preserve primary ownership and other links.
   * @param link Exact source/target and explanatory context. Do not create a reciprocal link.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is link.from's revision.
   */
  add(link: KnowledgeLink, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
  /**
   * Remove only the selected contextual relation; never clear primary ownership.
   * @param link Match from, to and context from current discovery; multiple indistinguishable
   * occurrences are ambiguous. Confirmed absence is not-found, not a broader unlink.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is link.from's revision.
   */
  remove(link: KnowledgeLink, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
/** Persist verified ingestion progress in the backend, not an adapter cache.
 * A checkpoint is recovery evidence, not a scheduler registration or an atomic lock.
 */
export interface ProcessingCheckpoints {
  /**
   * @param key Nonempty workflow-owned logical progress key within the bound instance,
   * e.g. ingest/example. Stable across retries; not a provider path, secret or scheduler ID.
   * @returns Stored progress/revision, or null only for confirmed absence. No implicit creation.
   */
  read(key: string): Promise<Result<Snapshot<string> | null>>;
  /**
   * Save progress only after verifying the corresponding retained input or destination effect.
   * @param key Same logical key used by read; create if absent or replace this checkpoint only.
   * @param content Complete readable checkpoint payload, interpreted by the owning workflow;
   * empty is stored content, not deletion. This call does not verify domain effects itself.
   * @param guard Runtime-resolved grant for this target; expected, if supplied, is the existing checkpoint revision.
   * Omit for first creation; concurrent creation is not made atomic by this interface.
   */
  save(key: string, content: string, guard: GrantedWriteGuard): Promise<Result<WriteReceipt>>;
}
