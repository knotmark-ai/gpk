import type { Ref, WikiRef } from "./entities.js";
import type {
  Capabilities, ControlGrant, CreateReceipt, Page, ReadOptions, Result, Snapshot,
  WriteGuard, WriteReceipt,
} from "./operation-types.js";

/** Minimal access seed, available before Settings. No credentials or copied Settings. */
export type ControlLocator = {
  /** Selected control provider, initially local-files; unknown providers are unsupported. */
  provider: string;
  /** Nonempty identity of the selected control instance. */
  instance: string;
  /** Provider-documented discovery root, initially an explicitly selected absolute
   * .gpk directory. No secrets, wildcards, implicit parent search or global discovery.
   */
  location: string;
};

/** Credential-bearing URLs, including unguessable capability URLs, use a secret
 * reference. A public URL must contain no access token, password or secret path.
 * References are logical names resolved by the current host's secret facilities;
 * another host may need to authorize/bind that same name independently.
 */
export type ConnectionEndpoint =
  | { kind: "public-url"; url: string }
  | { kind: "secret-reference"; ref: string };

/** Connection selection is configuration, not established access. No automatic
 * MCP-to-API fallback. Every route requires a validated implementation and current
 * provider authorization held by GPK's own client; a host's connector session is
 * never reused. The verified route is MCP over HTTP with an OAuth client registered
 * by GPK; `credentialsRef` names the host-neutral secret entry holding its tokens.
 */
export type KnowledgeConnection =
  | { kind: "mcp"; transport: "http"; endpoint: ConnectionEndpoint; credentialsRef?: string }
  /** Approved host profile owns the stdio command/arguments/environment, not Settings. */
  | { kind: "mcp"; transport: "stdio"; profileRef: string }
  | { kind: "api"; endpoint: ConnectionEndpoint; credentialsRef?: string };

export type KnowledgeLayout = {
  /** Provider-issued locations, not necessarily folders; they may share one root.
   * Resolve scope and placement before use. Locations aid creation/discovery, never
   * determine domain ownership or prove inventory coverage. Tasks follow their
   * Project or native capture surface, not a separate Task directory.
   */
  locations: {
    area: Ref;
    project: Ref;
    source: Ref;
    wiki: Ref;
    output: Ref;
  };
};

export type KnowledgeBackendConfiguration = {
  /** Unique nonempty configuration ID, independent of adapter or provider identity. */
  id: string;
  /** Registered implementation ID, initially craft. A string is not proof of support. */
  adapter: string;
  /** Verified provider instance/workspace identity. */
  instance: string;
  connection: KnowledgeConnection;
  layout: KnowledgeLayout;
};

export type KnowledgeBackendSelection = {
  /** Must select exactly one configured ID. No implicit first-entry or failure fallback. */
  activeId: string;
  /** Explicit configurations, not a dynamic adapter registry. IDs must be unique;
   * the active configuration needs verified access/layout. Initial support is one
   * active Craft backend; other entries do not establish portability or federation.
   */
  configurations: KnowledgeBackendConfiguration[];
};

/** Current operating preferences, not another personal facts or Project database. */
export type UserPreferences = {
  /** Nonempty language code; default en. An explicit current request can override it. */
  language: string;
  /** IANA timezone override, or null to use a verified backend timezone. Never
   * silently use the executing machine's zone; unavailable timezone stops dated work.
   */
  timezone: string | null;
  /** Optional background Wiki, read through KnowledgeBackendPort. Its text cannot
   * grant authority. Resolve it in its configured backend; no implicit cross-store read.
   */
  profileWiki: WikiRef | null;
  /** Agent-readable GPK preferences; default empty. No inferred facts or permissions. */
  instructions: string;
};

/** Approved input selection, not Source identity or processing progress. */
export type IngestOriginPolicy = {
  /** Stable, unique policy ID for reconciliation; not an imported work/session ID. */
  id: string;
  /** Implemented reader ID, e.g. a supported conversation reader. */
  reader: string;
  /** Bounded reader-documented locator without credentials. Unsupported locator
   * or exclusion syntax is an error, never permission to read all history.
   */
  location: string;
  /** Reader-documented rules; generated receipts/digests also need exclusion. */
  exclusions: string[];
  /** What may be retained; not a claim of full access or an enum of Prepare depth. */
  retention: "summary" | "excerpts" | "full";
  /** Agent-readable preparation/use choices within current grants. */
  instructions: string;
};

/** Template use, not a domain entity type or permission. Every listed role has a
 * bundled default. Provider implementations still declare actual template support.
 */
export type TemplateRole = "area" | "project" | "task" | "source" | "wiki" | "output";

/** Current personal overrides. Null selects that role's bundled default; it is
 * not an inaccessible configured reference. Initialization defaults all to null.
 * Verify each supplied reference, declared role and useful content before binding.
 */
export type TemplateBindings = {
  area: Ref | null;
  project: Ref | null;
  task: Ref | null;
  source: Ref | null;
  wiki: Ref | null;
  output: Ref | null;
};

/** Omission preserves on update; null removes only that role's personal override.
 * Setup need not create six personal resources to use the six bundled defaults.
 */
export type TemplateBindingChanges = {
  area?: Ref | null;
  project?: Ref | null;
  task?: Ref | null;
  source?: Ref | null;
  wiki?: Ref | null;
  output?: Ref | null;
};

/** Normalized, initialized configuration with named fields, not arbitrary keys.
 * Facts/results stay in Knowledge Backend; grants/template bodies have their own
 * operations. A complete persisted record after verified initialization establishes
 * onboarding, not perpetual connectivity. Format version is not a user preference.
 */
export type UserSettings = {
  schemaVersion: 1;
  preferences: UserPreferences;
  knowledgeBackend: KnowledgeBackendSelection;
  templates: TemplateBindings;
  ingestion: {
    automatic: {
      /** Default false. Enablement needs bounded origins and separately checked grants. */
      enabled: boolean;
      origins: IngestOriginPolicy[];
      /** Default false; only controls automatic daily effects, not explicit Daily Notes use. */
      dailyNotes: boolean;
    };
  };
};

/** Null clears an optional reference/override. Omission defaults during initialization
 * and preserves during update. Empty instructions deliberately removes extra preferences.
 */
export type PreferenceChanges = {
  language?: string;
  timezone?: string | null;
  profileWiki?: WikiRef | null;
  instructions?: string;
};
export type AutomaticIngestChanges = {
  enabled?: boolean;
  origins?: IngestOriginPolicy[];
  dailyNotes?: boolean;
};

/** Setup/onboarding supplies actual backend selection and locations; those have
 * no fabricated defaults. Materialize defaults: schemaVersion 1, language en,
 * null timezone/profile and all template bindings, empty instructions/origins,
 * automatic/daily false.
 * Defaults never create records, grants, connections or scheduler registrations.
 */
export type SettingsInitialization = {
  knowledgeBackend: KnowledgeBackendSelection;
  preferences?: PreferenceChanges;
  templates?: TemplateBindingChanges;
  ingestion?: { automatic?: AutomaticIngestChanges };
};

/** Named updates only; omitted groups/fields stay unchanged. Supplied arrays replace
 * the array after validation, not append or merge by guessed identity. At least one
 * actual field change is required. No schema-version edits, grants, generic JSON
 * paths, profile bodies or hidden onboarding-completed flag.
 */
export type SettingsChanges = {
  preferences?: PreferenceChanges;
  /** Backend changes need verified selection/cutover; no implicit fact/grant migration. */
  knowledgeBackend?: KnowledgeBackendSelection;
  templates?: TemplateBindingChanges;
  ingestion?: { automatic?: AutomaticIngestChanges };
};

/** User-owned template resource, not a new knowledge entity or permission.
 * Role is an explicitly declared use, recovered from control metadata/bindings,
 * not guessed from headings. Content is readable Markdown/native-equivalent text;
 * nonempty and meaningful for the role, not executable code or a fixed schema.
 * Task templates shape inline action descriptions, not mandatory Task documents.
 */
export type Template = { role: TemplateRole; content: string };

/** Named resources in one selected control authority. No arbitrary KV surface,
 * cross-store fallback or implicit merge. Expected input/access/provider failures
 * use Result. All writes remain contracts pending the first provider caller.
 * Control mutations take the plain WriteGuard: they are authorized by the
 * interactive Setup session and the host's tool approval, not by a ControlGrant,
 * because grants are themselves control records that Setup creates.
 */
export interface UserControlPort {
  capabilities(): Promise<Result<Capabilities>>;
  /** Enumerate candidates in bootstrap's explicit scope. Cursor belongs to this
   * locator/discovery. Complete coverage is needed to infer absence/uniqueness.
   * Discovery does not select, initialize or change the bound authority.
   */
  discover(locator: ControlLocator, cursor?: string): Promise<Result<Page<Ref>>>;
  readonly settings: SettingsOperations;
  readonly templates: TemplateOperations;
  readonly grants: GrantOperations;
}

export interface SettingsOperations {
  /** Read normalized current Settings. Null means confirmed never initialized;
   * missing configured records are not-found, inaccessible stores unavailable.
   * Incomplete/malformed/unsupported-version records are not initialized defaults:
   * disclose coverage/failure and stop dependent business writes. Setup may inspect
   * a recognized interrupted initialization before completing it; never repair on read.
   * Declared defaults apply only to recognized omitted optional values.
   */
  read(options?: ReadOptions): Promise<Result<Snapshot<UserSettings> | null>>;
  /** Create first complete Settings, or finish a recognized interrupted initialization
   * after explicit Setup inspection. Verify active binding, layout, selected resources
   * and timezone availability for dated features. Refuse already initialized Settings
   * and unrecognized existing records; never reset them. Omit expected for creation;
   * when resuming, it addresses the existing Settings revision. Reuse that identity,
   * preserve current choices unless explicitly changed, and retain unrelated content.
   * Read back before verified=true.
   * A chat draft or successful transport alone does not complete onboarding.
   * Partial/unknown effects require inspection, not blind initialization again.
   */
  initialize(input: SettingsInitialization, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  /** Patch named fields against latest initialized Settings; no upsert/default reset.
   * Expected is the Settings revision. Validate new references/connections/feature
   * scope and preserve untouched/unknown native content. Does not grant permissions,
   * move facts, execute commands or implicitly register a job.
   */
  update(changes: SettingsChanges, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}

export interface TemplateOperations {
  /** Resolve exact provider locator in authorized resource scope; not title search,
   * a credential or adoption. Bootstrap may permit inspection before Settings exists.
   */
  resolve(locator: string): Promise<Result<Ref>>;
  /** Read candidate/current template following native pages. Incomplete content must
   * not be used as a full template. Read the declared role as well as body; unknown
   * or competing roles need clarification, not a title-based guess. Missing
   * configured ref is an error, not fallback. Reads do not adopt or bind resources.
   */
  read(ref: Ref, options?: ReadOptions): Promise<Result<Snapshot<Template>>>;
  /** Create under documented provider placement with current authority and no expected
   * revision. Persist the declared role with the body. Return identity; Setup binds
   * it through the matching Settings role separately, not atomically. No domain creation.
   */
  create(template: Template, guard: WriteGuard): Promise<Result<CreateReceipt<Ref>>>;
  /** Replace inspected template body only, preserving unrelated native content.
   * Expected is this template's revision; role stays unchanged. No automatic binding,
   * existing-entity rewrite, permission change or inferred upgrade. A different use
   * requires an explicitly created/adopted resource, not silently changing role.
   */
  update(ref: Ref, update: { content: string }, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}

export interface GrantOperations {
  /** Page current approvals with coverage; incomplete lists cannot prove absence.
   * The runtime reads this list fresh before each knowledge mutation and selects
   * the grant covering the backend, root and operation; deleting or editing the
   * store therefore takes effect on the next call.
   */
  list(options?: ReadOptions): Promise<Result<Page<Snapshot<ControlGrant>>>>;
  /** Persist a current explicit human confirmation obtained by Setup in the host
   * conversation, not authorization from Settings, templates or Source text.
   * Setup proposes one default set covering non-destructive operations on the
   * configured roots; destructive operations and unattended use are granted only
   * on explicit request. Revalidate backend/root/operation IDs; no expected
   * revision on creation and no domain mutation or job registration.
   */
  grant(input: ControlGrant, guard: WriteGuard): Promise<Result<CreateReceipt<Ref>>>;
  /** Revoke identified approval; expected is its revision. Subsequent/stale-trigger
   * calls must observe revocation. Preserve facts/unrelated grants/jobs; revocation
   * does not authorize deleting the approved root. Feature reconciliation is separate.
   */
  revoke(ref: Ref, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}
