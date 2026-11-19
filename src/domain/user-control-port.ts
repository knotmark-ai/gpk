import type { Ref, WikiRef } from "./entities.js";
import type {
  Capabilities, ControlGrant, CreateReceipt, GrantList, Result, Snapshot,
  WriteGuard, WriteReceipt,
} from "./operation-types.js";

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
 * never reused. Local vaults (for example Obsidian or plain Markdown directories)
 * use an explicit local path rather than a fabricated network endpoint.
 */
export type KnowledgeConnection =
  | { kind: "mcp"; transport: "http"; endpoint: ConnectionEndpoint; credentialsRef?: string }
  /** Approved host profile owns the stdio command/arguments/environment, not Settings. */
  | { kind: "mcp"; transport: "stdio"; profileRef: string }
  | { kind: "api"; endpoint: ConnectionEndpoint; credentialsRef?: string }
  /** Local filesystem vault/directory; must be an absolute path. */
  | { kind: "local"; path: string };

export type KnowledgeLayout = {
  /** Provider-issued locations, not necessarily folders; they may share one root.
   * Resolve scope and placement before use. Locations aid creation/discovery, never
   * determine domain ownership or prove inventory coverage. Core five roles are
   * always bound; backends with dedicated task tables (Notion, Feishu, Obsidian),
   * explicit capture surfaces or system containers bind the optional slots as needed.
   */
  locations: {
    area: Ref;
    project: Ref;
    source: Ref;
    wiki: Ref;
    output: Ref;
    task?: Ref;
    inbox?: Ref;
    daily?: Ref;
    system?: Ref;
  };
};

export type KnowledgeBackendConfiguration = {
  /** Unique nonempty configuration ID, independent of adapter or provider identity. */
  id: string;
  /** Registered implementation ID (e.g. craft, notion, feishu, obsidian). A string is not proof of support. */
  adapter: string;
  /** Verified provider instance/workspace identity. */
  instance: string;
  connection: KnowledgeConnection;
  layout: KnowledgeLayout;
  /** Optional separate route that takes file bytes, for providers whose main
   * connection can only reference media by URL. Its secret entry holds the route's
   * capability URL and key. It must address the same instance; it adds no grants.
   */
  uploads?: { kind: "api"; endpoint: { kind: "secret-reference"; ref: string } };
};

export type KnowledgeBackendSelection = {
  /** Must select exactly one configured ID. No implicit first-entry or failure fallback. */
  activeId: string;
  /** Explicit configurations, not a dynamic adapter registry. IDs must be unique;
   * the active configuration needs verified access/layout.
   */
  configurations: KnowledgeBackendConfiguration[];
};

/** Current operating preferences, not another personal facts or Project database. */
export type UserPreferences = {
  /** Language of structural names: folders, Collections, views and template headings;
   * default en. Schema keys, state values and GPK tags stay English regardless.
   */
  metadataLanguage: string;
  /** Optional language for newly authored record bodies (e.g. "en", "zh-CN");
   * null (default) follows the conversation and the language of the record being edited.
   */
  contentLanguage: string | null;
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
  /** Explicit unattended workflow depth. Missing on older origins until the user chooses. */
  depth?: "save" | "wiki" | "research";
  /** Agent-readable preparation/use choices within current grants. */
  instructions: string;
};

/** Template use, not a domain entity type or permission. Every listed role has a
 * bundled default. Templates live as native or managed documents in the active
 * Knowledge Backend so people and Agents share one editable source.
 */
export type TemplateRole = "area" | "project" | "task" | "source" | "wiki" | "output";

/** Current backend template bindings. Null selects that role's bundled default; it is
 * not an inaccessible configured reference. Setup populates bindings when installing
 * or adopting templates in the backend's native Templates area or fallback container.
 */
export type TemplateBindings = {
  area: Ref | null;
  project: Ref | null;
  task: Ref | null;
  source: Ref | null;
  wiki: Ref | null;
  output: Ref | null;
};

/** Omission preserves on update; null removes only that role's personal binding. */
export type TemplateBindingChanges = {
  area?: Ref | null;
  project?: Ref | null;
  task?: Ref | null;
  source?: Ref | null;
  wiki?: Ref | null;
  output?: Ref | null;
};

/** Normalized, initialized configuration with named fields, not arbitrary keys.
 * Facts, templates and results stay in Knowledge Backend; grants have their own
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
      /** Default false. Enablement uses explicit origins when configured, else auto-discovers installed harness roots. */
      enabled: boolean;
      retention?: "summary" | "excerpts" | "full" | undefined;
      depth?: "save" | "wiki" | "research" | undefined;
      instructions?: string | undefined;
      origins: IngestOriginPolicy[];
    };
  };
  /** Optional explicit local directory overrides (`roots`). When empty (default), local
   * media/attachment file access follows the mounted Agent harness outside protected
   * credential and GPK control/runtime directories.
   */
  files: { roots: string[] };
};

/** Null clears an optional reference/override. Omission defaults during initialization
 * and preserves during update. Empty instructions deliberately removes extra preferences.
 */
export type PreferenceChanges = {
  metadataLanguage?: string;
  contentLanguage?: string | null;
  timezone?: string | null;
  profileWiki?: WikiRef | null;
  instructions?: string;
};
export type AutomaticIngestChanges = {
  enabled?: boolean;
  retention?: "summary" | "excerpts" | "full";
  depth?: "save" | "wiki" | "research";
  instructions?: string;
  origins?: IngestOriginPolicy[];
};

/** Setup/onboarding supplies actual backend selection and locations; those have
 * no fabricated defaults. Materialize defaults: schemaVersion 1, metadataLanguage en,
 * null contentLanguage/timezone/profile and unset template bindings, empty
 * instructions/origins, automatic retention disabled.
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
  /** Replaces explicit local directory overrides when supplied. */
  files?: { roots: string[] };
};

/** Named resources in one selected control authority. No arbitrary KV surface,
 * fake pagination, cross-store fallback or implicit merge. Expected input/access/provider
 * failures use Result. Control mutations take the plain WriteGuard: they are authorized
 * by the interactive Setup session, not by a ControlGrant, because grants are themselves
 * control records that Setup creates.
 */
export interface UserControlPort {
  capabilities(): Promise<Result<Capabilities>>;
  readonly settings: SettingsOperations;
  readonly grants: GrantOperations;
}

export interface SettingsOperations {
  /** Read normalized current Settings. Null means confirmed never initialized;
   * missing configured records are not-found, inaccessible stores unavailable.
   * Incomplete/malformed/unsupported-version records are not initialized defaults:
   * disclose failure and stop dependent business writes; never repair on read.
   */
  read(): Promise<Result<Snapshot<UserSettings> | null>>;
  /** Create first complete Settings after explicit Setup inspection. Verify active
   * binding, layout and timezone availability for dated features. Refuse already
   * initialized Settings and unrecognized existing records; never reset them.
   * Omit expected for creation. Read back before verified=true.
   */
  initialize(input: SettingsInitialization, guard: WriteGuard): Promise<Result<WriteReceipt>>;
  /** Patch named fields against latest initialized Settings; no upsert/default reset.
   * Expected is the Settings revision. Validate new references/connections/feature
   * scope and preserve untouched fields. Does not grant permissions, move facts,
   * execute commands or implicitly register a job.
   */
  update(changes: SettingsChanges, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}

export interface GrantOperations {
  /** Read all current approvals in the control store. The runtime reads this list
   * fresh before each knowledge mutation; deleting or editing the store therefore
   * takes effect on the next call.
   */
  list(): Promise<Result<GrantList>>;
  /** Persist a container grant created through the local browser console,
   * not authorization from Settings, templates or Source text. Revalidate backend/root/operation
   * IDs; no expected revision on creation and no domain mutation or job registration.
   */
  grant(input: ControlGrant, guard: WriteGuard): Promise<Result<CreateReceipt<Ref>>>;
  /** Revoke identified approval; expected is its revision. Subsequent/stale-trigger
   * calls must observe revocation. Preserve facts and unrelated grants.
   */
  revoke(ref: Ref, guard: WriteGuard): Promise<Result<WriteReceipt>>;
}
