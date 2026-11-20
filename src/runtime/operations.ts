import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Area, AreaRef, AreaState, Output, OutputRef, Project, ProjectRef, ProjectState,
  Ref, Source, SourceRef, Task, TaskRef, TaskState, Wiki, WikiRef,
} from "../domain/entities.js";
import type {
  AreaInput, AreaQuery, Capture, CaptureRef, CaptureSurface, CaptureSurfaceRef,
  ContentUpdate, KnowledgeBackendPort, KnowledgeLink, OutputInput, OutputQuery,
  ProjectInput, ProjectMaterial, ProjectMaterialRef, ProjectQuery, SourceInput,
  SourceQuery, SourceUpdate, TaskInput, TaskQuery, TextEdit, WikiInput, WikiQuery,
  WorkspaceInspection, WorkspacePlan, WorkspaceSpace,
} from "../domain/knowledge-backend-port.js";
import type {
  Capabilities, ControlGrant, CreateReceipt, Failure, GrantList, GrantedWriteGuard,
  Page, ReadOptions, Result, Snapshot, Version, WriteReceipt,
} from "../domain/operation-types.js";
import type {
  IngestOriginPolicy, KnowledgeBackendConfiguration, PreferenceChanges,
  SettingsChanges, TemplateBindingChanges, TemplateRole, UserControlPort, UserPreferences,
} from "../domain/user-control-port.js";
import { debug } from "./debug-log.js";
import { reviewInventory, todayIn, type ReviewCadence } from "./review.js";
import {
  createSessionIngestion, type SessionApplyInput, type SessionEntityRef, type SessionNextInput,
} from "./session-ingestion.js";
import { resolveDefaultSessionOrigins, validateSessionOrigins } from "./session-reader.js";
import { bundledTemplateMarkdown, isCustomizedTemplate } from "./templates.js";

export type EntityRef = SessionEntityRef;

export type ProviderConnectionStatus = {
  endpoint: string;
  secretStore?: string;
  registered: boolean;
  tokens: "none" | "stored" | "verified";
  pendingAuthorizationUrl?: string;
  authorizationError?: string;
  space?: WorkspaceSpace;
};

export type ProviderConnection = {
  status(): Promise<ProviderConnectionStatus>;
  peekStatus?(): Promise<ProviderConnectionStatus>;
  authorize(returnTo?: string): Promise<Result<{ state: "authorized" | "pending"; authorizationUrl?: string; space?: WorkspaceSpace }>>;
};

/** The active knowledge binding, resolved by bootstrap from current Settings. */
export type KnowledgeBinding = {
  backendId: string;
  adapter: string;
  endpoint: string;
  secretKey: string;
  connection: ProviderConnection;
  knowledge: KnowledgeBackendPort;
};

export type OperationsOptions = {
  controlRoot: string;
  homeDir?: string | undefined;
  control: UserControlPort;
  /** Active backend from Settings; fails until Setup initialized them. */
  binding: () => Promise<Result<KnowledgeBinding>>;
  /** Same when Settings exist, else the default diagnostic binding; for Setup and diagnostics. */
  setupBinding: () => Promise<Result<KnowledgeBinding>>;
  media: MediaSupport;
};

/** What copying local files needs beyond the primary binding: upload verification and secret storage. */
export type MediaSupport = {
  uploads: {
    verify(credentials: { url: string; key?: string }, expectedSpaceId: string): Promise<Result<unknown>>;
  };
  /** Secret entry for a backend configuration's upload route. */
  secretKey: (configurationId: string) => string;
  secrets: () => {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** Additional GPK-owned directories that must never be added as user content/session roots. */
  disallowedRoots?: readonly string[];
};

/** Local file overrides and whether Craft's attachment upload route is connected. */
export type FilesInspection = { roots: string[]; uploads: "none" | "connected" | "secret-missing" };

export type SetupInspection = {
  controlRoot: string;
  settings: RuntimeStatus["settings"];
  onboarding: OnboardingState;
  preferences?: UserPreferences;
  settingsVersion?: Version;
  backend?: { id: string; adapter: string; endpoint: string };
  connection: ProviderConnectionStatus;
  layout?: WorkspaceInspection;
  grants: number;
  files?: FilesInspection;
  ingestion?: import("../domain/user-control-port.js").UserSettings["ingestion"]["automatic"];
};

export type SetupPlan = Omit<WorkspacePlan, "metadataLanguage"> & {
  preferences?: { metadataLanguage?: "en" | "zh-CN"; contentLanguage?: string | null; timezone?: string | null };
};

/** A container grant selection from the workspace default grant proposal. */
export type GrantSelection = { root: string; operations: string[] };

/**
 * Onboarding is complete once Settings exist and at least one grant is persisted.
 * Until then knowledge work is refused and the Agent is sent to `gpk_setup_open`.
 */
export type OnboardingState = "required" | "complete";

export type RuntimeStatus = {
  controlRoot: string;
  settings: "uninitialized" | "ready" | "invalid" | "unavailable";
  onboarding: OnboardingState;
  backend?: { id: string; adapter: string; instance?: string; endpoint: string };
  connection?: ProviderConnectionStatus;
  preferences?: UserPreferences;
  automaticIngestion?: { enabled: boolean; origins: number };
  settingsVersion?: Version;
  customTemplates?: Partial<Record<TemplateRole, string>>;
};

export type StatusInclude = "grants" | "capabilities" | "templates" | "setup";

export type ResolvedTemplateInfo = {
  role: TemplateRole;
  ref: Ref | null;
  source: "backend" | "bundled";
  customized: boolean;
  content: string;
};

export type GpkStatusView = RuntimeStatus & {
  grants?: GrantList;
  capabilities?: { knowledge?: Capabilities; control?: Capabilities };
  templates?: Record<TemplateRole, ResolvedTemplateInfo>;
  setup?: SetupInspection;
};

export type InlineLinkInput = { to: EntityRef; context: string };

export type PreferencesUpdateInput = {
  preferences?: Omit<PreferenceChanges, "metadataLanguage">;
  templates?: TemplateBindingChanges;
  automaticIngestionEnabled?: boolean;
  expected?: Version;
};

export type CapturesGetInput =
  | ({ surface: { name: "inbox" } | { name: "daily-notes"; date?: string } } & ReadOptions)
  | { refs: CaptureRef[] };

export type CapturesGetResult =
  | { items: Snapshot<Capture, CaptureRef>[]; coverage: "complete" | "partial" }
  | (Page<Snapshot<Capture, CaptureRef>> & { surface: CaptureSurfaceRef; date?: string });

export type BatchTaskCreateResult = {
  created: TaskRef[];
  items: CreateReceipt<TaskRef>[];
  affected: Ref[];
  verified: boolean;
};

export type TaskCreateResult = CreateReceipt<TaskRef> | BatchTaskCreateResult;

export type EntityGetResult<T, R extends Ref> = Page<Snapshot<T, R>> & {
  customTemplates?: Partial<Record<TemplateRole, string>>;
};

export type ProjectInclude = "area" | "tasks" | "materials" | "links";
export type ProjectIncludedContext = {
  area?: Snapshot<Area, AreaRef>;
  tasks?: Page<Snapshot<Task, TaskRef>>;
  materials?: Page<Snapshot<ProjectMaterial, ProjectMaterialRef>>;
  links?: Page<KnowledgeLink>;
};

export type ProjectsGetInput = ProjectQuery & {
  targets?: (string | ProjectRef)[];
  material?: ProjectMaterialRef;
  include?: ProjectInclude[];
};

export type ProjectsGetResult = EntityGetResult<Project, ProjectRef> & {
  material?: Snapshot<ProjectMaterial, ProjectMaterialRef>;
  included?: Record<string, ProjectIncludedContext>;
};

export type AreaCreateInput = AreaInput & {
  links?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
};

export type AreaUpdateInput = ContentUpdate & {
  ref: AreaRef;
  transition?: { state: AreaState; reason: string };
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type InitialProjectTaskInput = {
  title: string;
  content?: string;
  state?: TaskState;
  time?: string;
  history?: { origin: string; date?: string };
};

export type ProjectCreateInput = ProjectInput & {
  initialTasks?: InitialProjectTaskInput[];
  materials?: ProjectMaterial[];
  links?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
};

export type ProjectMaterialUpdateItem = ContentUpdate & {
  ref: ProjectMaterialRef;
  expected?: Version;
};

export type ProjectUpdateInput = ContentUpdate & {
  ref: ProjectRef;
  transition?: { state: ProjectState; reason: string };
  primaryArea?: { area: AreaRef; reason: string };
  taskOrder?: TaskRef[];
  materialAppend?: ProjectMaterial[];
  materialUpdate?: ProjectMaterialUpdateItem[];
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type SingleTaskCreateInput = {
  title: string;
  content?: string;
  state?: TaskState;
  time?: string;
  history?: { origin: string; date?: string };
  project?: ProjectRef;
  links?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
};

export type BatchTaskCreateInput = {
  items: {
    title: string;
    content?: string;
    state?: TaskState;
    time?: string;
    history?: { origin: string; date?: string };
    project?: ProjectRef;
  }[];
  activitySummary?: string;
  activityDate?: string;
};

export type TaskCreateInput = SingleTaskCreateInput | BatchTaskCreateInput;

export type TaskUpdateInput = {
  ref: TaskRef;
  title?: string;
  edits?: TextEdit[];
  append?: string;
  transition?: { state: TaskState; reason: string };
  /** Valid YYYY-MM-DD date sets planned time; null clears it; omitted leaves it unchanged. */
  time?: string | null;
  project?: { target: ProjectRef | null; reason: string };
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type SourceCreateInput = SourceInput & {
  links?: InlineLinkInput[];
  /** Defaults to true on MCP calls: records the Source in the Daily Note when daily-notes is granted. */
  recordInDaily?: boolean;
  /** True only when the caller explicitly requested `recordInDaily: true` (as opposed to omission default). */
  explicitRecordInDaily?: boolean;
  dailyDate?: string;
  activitySummary?: string;
};

export type SourceCompoundUpdateInput = SourceUpdate & {
  ref: SourceRef;
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type WikiCreateInput = WikiInput & {
  links?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
};

export type WikiCompoundUpdateInput = ContentUpdate & {
  ref: WikiRef;
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type OutputCreateInput = OutputInput & {
  links?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
};

export type OutputCompoundUpdateInput = ContentUpdate & {
  ref: OutputRef;
  linksAdd?: InlineLinkInput[];
  activitySummary?: string;
  activityDate?: string;
  expected?: Version;
};

export type LinksManageInput =
  | ({ action: "query"; ref: EntityRef } & ReadOptions)
  | { action: "add"; links: KnowledgeLink[]; expected?: Version }
  | { action: "remove"; link: KnowledgeLink; expected?: Version };

export type CheckpointsManageInput =
  | { action: "read"; key: string }
  | { action: "save"; key: string; content: string; expected?: Version };

const TEMPLATE_ROLES: readonly TemplateRole[] = ["area", "project", "task", "source", "wiki", "output"];
const TEMPLATE_TTL_MS = 60_000;

function failure(code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> {
  return { ok: false, error: { code, message, affected, next } };
}

function dedupeRefs(refs: readonly Ref[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const ref of refs) {
    const key = `${"kind" in ref && typeof ref.kind === "string" ? ref.kind : ""}:${ref.scope}:${ref.id}`;
    if (!seen.has(key)) { seen.add(key); out.push(ref); }
  }
  return out;
}

function partialFailure(error: Failure, completedSteps: string[], failedStep: string, affectedSoFar: Ref[], latestVersion?: Version): Result<never> {
  if (!completedSteps.length) return { ok: false, error };
  const affected = dedupeRefs([...affectedSoFar, ...error.affected]);
  const versionHint = latestVersion ? ` Latest primary revision: ${latestVersion}.` : "";
  return {
    ok: false,
    error: {
      ...error,
      code: "partial",
      affected,
      completedSteps,
      failedStep,
      next: `Completed [${completedSteps.join(", ")}] before ${failedStep} failed (${error.message}).${versionHint} Inspect affected records and retry only the remaining steps; do not recreate already-created records. ${error.next}`,
    },
  };
}

function hasContentChanges(update: ContentUpdate): boolean {
  return update.title !== undefined
    || Boolean(update.edits?.length)
    || (update.append !== undefined && update.append.trim().length > 0)
    || update.replaceContent !== undefined;
}

/**
 * Protocol-independent handlers. Runtime operations speak exclusively to
 * `KnowledgeBackendPort` and `UserControlPort` — never to a concrete provider class.
 * Each knowledge mutation loads current `ControlGrant`s from User Control and hands
 * them to the backend port via `GrantedWriteGuard`, where the adapter enforces
 * container containment and operation authorization.
 */
export function createOperations(options: OperationsOptions) {
  const { control, controlRoot, binding, setupBinding, media } = options;
  const home = options.homeDir || os.homedir();
  const templateCache = new Map<string, { expiresAt: number; info: ResolvedTemplateInfo; limits: string[] }>();
  const discoveredTemplatesCache = new Map<string, { expiresAt: number; bindings: TemplateBindingChanges }>();

  function invalidateTemplates(): void {
    templateCache.clear();
    discoveredTemplatesCache.clear();
  }

  async function effectiveTemplateRef(
    bound: KnowledgeBinding,
    templates: Record<TemplateRole, Ref | null>,
    role: TemplateRole,
  ): Promise<Ref | null> {
    if (templates[role]) return templates[role];
    const anyBound = TEMPLATE_ROLES.some(r => templates[r] !== null);
    if (anyBound || !bound.knowledge.templates.discover) return null;
    const cached = discoveredTemplatesCache.get(bound.backendId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.bindings[role] ?? null;
    }
    const discovered = await bound.knowledge.templates.discover();
    if (!discovered.ok) return null;
    discoveredTemplatesCache.set(bound.backendId, { expiresAt: Date.now() + TEMPLATE_TTL_MS, bindings: discovered.value });
    return discovered.value[role] ?? null;
  }

  async function disallowedPaths(): Promise<string[]> {
    const serviceDefault = path.join(home, ".gpk-runtime");
    const raw = [controlRoot, serviceDefault, ...(media.disallowedRoots ?? [])];
    const resolved: string[] = [];
    for (const candidate of raw) {
      resolved.push(await realpath(candidate).catch(() => path.resolve(candidate)));
    }
    return resolved;
  }

  function overlapsDisallowed(candidateReal: string, forbidden: readonly string[]): boolean {
    return forbidden.some(entry =>
      candidateReal === entry
      || entry.startsWith(`${candidateReal}${path.sep}`)
      || candidateReal.startsWith(`${entry}${path.sep}`));
  }

  /** Current Settings and their active configuration. */
  async function activeSettings() {
    const settings = await control.settings.read();
    if (!settings.ok) return settings;
    if (settings.value === null) return failure("unavailable", "Settings are not initialized.", "Finish onboarding first.");
    const current = settings.value;
    const active = current.value.knowledgeBackend.configurations.find(c => c.id === current.value.knowledgeBackend.activeId);
    if (!active) return failure("invalid", "Settings select a backend configuration that does not exist.", "Repair settings.json or rerun Setup.");
    return { ok: true as const, value: { snapshot: current, active }, limits: [] };
  }

  async function filesInspect(): Promise<Result<FilesInspection>> {
    const current = await activeSettings(); if (!current.ok) return current;
    const ref = current.value.active.uploads?.endpoint.ref;
    const secret = ref ? await media.secrets().read(ref).catch(() => null) : null;
    return { ok: true, value: { roots: current.value.snapshot.value.files.roots, uploads: !ref ? "none" : secret ? "connected" : "secret-missing" }, limits: [] };
  }

  /** Replace the active configuration's upload route in Settings, keeping every other configuration. */
  async function writeUploads(uploads: KnowledgeBackendConfiguration["uploads"] | undefined): Promise<Result<WriteReceipt>> {
    const current = await activeSettings(); if (!current.ok) return current;
    const { snapshot, active } = current.value;
    const next: KnowledgeBackendConfiguration = { ...active };
    if (uploads) next.uploads = uploads; else delete next.uploads;
    const selection = { ...snapshot.value.knowledgeBackend, configurations: snapshot.value.knowledgeBackend.configurations.map(c => c.id === active.id ? next : c) };
    if (JSON.stringify(selection) === JSON.stringify(snapshot.value.knowledgeBackend)) return { ok: true, value: { affected: [snapshot.ref], verified: true, version: snapshot.version! }, limits: [] };
    return control.settings.update({ knowledgeBackend: selection }, { expected: snapshot.version! });
  }

  async function onboardingState(): Promise<OnboardingState> {
    const settings = await control.settings.read();
    if (!settings.ok || settings.value === null) return "required";
    const grants = await control.grants.list();
    return grants.ok && grants.value.items.length > 0 ? "complete" : "required";
  }

  async function withBinding<T>(run: (bound: KnowledgeBinding) => Promise<Result<T>>): Promise<Result<T>> {
    const bound = await binding();
    if (!bound.ok) return bound;
    if (await onboardingState() === "required") {
      debug("operations", "onboarding-gate", { note: "knowledge operation refused until Settings and a grant exist" });
      return failure("unavailable", "GPK onboarding is not complete: workspace setup has not finished.", "Call gpk_setup_open and let the user finish workspace setup in the browser, then retry.");
    }
    return run(bound.value);
  }

  async function writeGuard(bound: KnowledgeBinding, expected?: Version, unattended?: boolean): Promise<Result<GrantedWriteGuard>> {
    const grants = await control.grants.list();
    if (!grants.ok) return grants;
    const matching = grants.value.items
      .map(item => item.value)
      .filter(grant => grant.backendId === bound.backendId && (!unattended || grant.unattended));
    return {
      ok: true,
      value: {
        grants: matching,
        ...(expected !== undefined ? { expected } : {}),
        ...(unattended !== undefined ? { unattended } : {}),
      },
      limits: [],
    };
  }

  async function resolveRoleTemplate(
    bound: KnowledgeBinding,
    templates: Record<TemplateRole, Ref | null>,
    role: TemplateRole,
  ): Promise<{ info: ResolvedTemplateInfo; limits: string[] }> {
    const ref = await effectiveTemplateRef(bound, templates, role);
    if (!ref) {
      return {
        info: { role, ref: null, source: "bundled", customized: false, content: bundledTemplateMarkdown(role) },
        limits: [],
      };
    }
    const cacheKey = `${bound.backendId}:${role}:${ref.scope}:${ref.id}`;
    const cached = templateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { info: cached.info, limits: [...cached.limits] };
    }
    const read = await bound.knowledge.templates.read(ref, role);
    if (!read.ok) {
      const fallback: ResolvedTemplateInfo = {
        role,
        ref,
        source: "bundled",
        customized: false,
        content: bundledTemplateMarkdown(role),
      };
      const limits = [`Bound ${role} template (${ref.id}) could not be read (${read.error.code}: ${read.error.message}); fell back to GPK's bundled default template.`];
      if (read.error.code === "not-found") {
        templateCache.set(cacheKey, { expiresAt: Date.now() + TEMPLATE_TTL_MS, info: fallback, limits });
      }
      return { info: fallback, limits };
    }
    const content = read.value.value.content.trim();
    if (!content) {
      const fallback: ResolvedTemplateInfo = {
        role,
        ref,
        source: "bundled",
        customized: false,
        content: bundledTemplateMarkdown(role),
      };
      const limits = [...read.limits, `Bound ${role} template (${ref.id}) is empty; fell back to GPK's bundled default template.`];
      templateCache.set(cacheKey, { expiresAt: Date.now() + TEMPLATE_TTL_MS, info: fallback, limits });
      return { info: fallback, limits };
    }
    const customized = isCustomizedTemplate(role, content);
    const info: ResolvedTemplateInfo = { role, ref, source: "backend", customized, content };
    templateCache.set(cacheKey, { expiresAt: Date.now() + TEMPLATE_TTL_MS, info, limits: read.limits });
    return { info, limits: [...read.limits] };
  }

  async function piggybackTemplates(
    bound: KnowledgeBinding,
    roles: readonly TemplateRole[],
  ): Promise<{ customTemplates?: Partial<Record<TemplateRole, string>>; limits: string[] }> {
    const settings = await control.settings.read();
    if (!settings.ok || !settings.value) return { limits: [] };
    const bindings = settings.value.value.templates;
    const custom: Partial<Record<TemplateRole, string>> = {};
    const limits: string[] = [];
    for (const role of roles) {
      const resolved = await resolveRoleTemplate(bound, bindings, role);
      limits.push(...resolved.limits);
      if (resolved.info.customized) custom[role] = resolved.info.content;
    }
    return { ...(Object.keys(custom).length ? { customTemplates: custom } : {}), limits };
  }

  async function recordDailyInternal(
    bound: KnowledgeBinding,
    summary: string,
    related?: EntityRef,
    date?: string,
  ): Promise<Result<WriteReceipt>> {
    const scoped = await bound.knowledge.workspace.space();
    if (!scoped.ok) return scoped;
    const guard = await writeGuard(bound);
    if (!guard.ok) return guard;
    return bound.knowledge.captures.recordActivity(date ?? todayIn(scoped.value.timezone), summary, related, guard.value);
  }

  async function resolveAndReadTargets<T, R extends Ref>(
    targets: readonly (string | R)[],
    ops: {
      resolve(locator: string): Promise<Result<R>>;
      read(ref: R, options?: ReadOptions): Promise<Result<Snapshot<T, R>>>;
    },
  ): Promise<Result<{ items: Snapshot<T, R>[]; coverage: "complete" | "partial" }>> {
    const items: Snapshot<T, R>[] = [];
    const limits: string[] = [];
    for (const target of targets) {
      let ref: R;
      if (typeof target === "string") {
        const resolved = await ops.resolve(target);
        if (!resolved.ok) return resolved;
        limits.push(...resolved.limits);
        ref = resolved.value;
      } else {
        ref = target;
      }
      const read = await ops.read(ref);
      if (!read.ok) return read;
      limits.push(...read.limits);
      items.push(read.value);
    }
    const coverage = items.every(item => item.coverage === "complete") ? "complete" : "partial";
    return { ok: true, value: { items, coverage }, limits };
  }

  const operations = {
    async runtimeStatus(): Promise<Result<RuntimeStatus>> {
      const settings = await control.settings.read();
      const status: RuntimeStatus = {
        controlRoot,
        settings: !settings.ok ? (settings.error.code === "invalid" ? "invalid" : "unavailable") : settings.value === null ? "uninitialized" : "ready",
        onboarding: await onboardingState(),
      };
      const bound = await setupBinding();
      if (bound.ok) {
        if (status.settings === "ready" && settings.ok && settings.value) {
          const active = settings.value.value.knowledgeBackend.configurations.find(c => c.id === settings.value!.value.knowledgeBackend.activeId);
          status.backend = { id: bound.value.backendId, adapter: bound.value.adapter, ...(active?.instance ? { instance: active.instance } : {}), endpoint: bound.value.endpoint };
          status.preferences = settings.value.value.preferences;
          const auto = settings.value.value.ingestion.automatic;
          const activeOrigins = auto.origins.length > 0
            ? auto.origins
            : resolveDefaultSessionOrigins({ homeDir: home, retention: auto.retention, depth: auto.depth, instructions: auto.instructions });
          status.automaticIngestion = {
            enabled: auto.enabled,
            origins: activeOrigins.length,
          };
          if (settings.value.version) status.settingsVersion = settings.value.version;
        }
        status.connection = await bound.value.connection.status();
      }
      const limits: string[] = [];
      if (status.onboarding === "required") limits.unshift("Onboarding is not complete: call gpk_setup_open and let the user finish it in the browser before any other GPK work.");
      return { ok: true, value: status, limits };
    },

    async status(include: readonly StatusInclude[] = []): Promise<Result<GpkStatusView>> {
      const base = await operations.runtimeStatus();
      if (!base.ok) return base;
      const view: GpkStatusView = { ...base.value };
      const limits = [...base.limits];
      const includeSet = new Set(include);

      if (view.settings === "ready" && view.connection?.tokens === "verified") {
        const bound = await binding();
        if (bound.ok) {
          if (includeSet.has("templates")) {
            const settings = await control.settings.read();
            if (settings.ok && settings.value) {
              const all = {} as Record<TemplateRole, ResolvedTemplateInfo>;
              const custom: Partial<Record<TemplateRole, string>> = {};
              for (const role of TEMPLATE_ROLES) {
                const resolved = await resolveRoleTemplate(bound.value, settings.value.value.templates, role);
                all[role] = resolved.info;
                if (resolved.info.customized) custom[role] = resolved.info.content;
                limits.push(...resolved.limits);
              }
              view.templates = all;
              if (Object.keys(custom).length) view.customTemplates = custom;
            }
          } else {
            const piggy = await piggybackTemplates(bound.value, TEMPLATE_ROLES);
            if (piggy.customTemplates) view.customTemplates = piggy.customTemplates;
            limits.push(...piggy.limits);
          }
        }
      }
      if (includeSet.has("grants")) {
        const grants = await control.grants.list();
        if (grants.ok) { view.grants = grants.value; limits.push(...grants.limits); }
        else limits.push(`Grants could not be read: ${grants.error.message}`);
      }
      if (includeSet.has("capabilities")) {
        const controlCaps = await control.capabilities();
        const bound = await setupBinding();
        const knowledgeCaps = bound.ok ? await bound.value.knowledge.capabilities() : null;
        view.capabilities = {
          ...(knowledgeCaps?.ok ? { knowledge: knowledgeCaps.value } : {}),
          ...(controlCaps.ok ? { control: controlCaps.value } : {}),
        };
      }
      if (includeSet.has("setup")) {
        const inspected = await operations.setupInspect();
        if (inspected.ok) { view.setup = inspected.value; limits.push(...inspected.limits); }
        else limits.push(`Setup inspection failed: ${inspected.error.message}`);
      }
      return { ok: true, value: view, limits: [...new Set(limits)] };
    },

    connectionStatus: async (): Promise<Result<ProviderConnectionStatus>> => {
      const bound = await setupBinding();
      return bound.ok ? { ok: true, value: await bound.value.connection.status(), limits: bound.limits } : bound;
    },
    connectionAuthorize: async (returnTo?: string) => {
      const bound = await setupBinding();
      return bound.ok ? bound.value.connection.authorize(returnTo) : bound;
    },
    async setupLocal(): Promise<Result<SetupInspection>> {
      const settings = await control.settings.read();
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const connection = bound.value.connection.peekStatus
        ? await bound.value.connection.peekStatus()
        : await bound.value.connection.status();
      const grants = await control.grants.list();
      const inspection: SetupInspection = {
        controlRoot,
        settings: !settings.ok ? (settings.error.code === "invalid" ? "invalid" : "unavailable") : settings.value === null ? "uninitialized" : "ready",
        onboarding: await onboardingState(),
        connection,
        grants: grants.ok ? grants.value.items.length : 0,
      };
      if (settings.ok && settings.value) {
        inspection.preferences = settings.value.value.preferences;
        if (settings.value.version) inspection.settingsVersion = settings.value.version;
        inspection.backend = { id: bound.value.backendId, adapter: bound.value.adapter, endpoint: bound.value.endpoint };
        inspection.ingestion = settings.value.value.ingestion.automatic;
        const files = await filesInspect();
        if (files.ok) inspection.files = files.value;
      }
      return { ok: true, value: inspection, limits: [...bound.limits] };
    },
    async setupInspect(): Promise<Result<SetupInspection>> {
      const settings = await control.settings.read();
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const connection = await bound.value.connection.status();
      const grants = await control.grants.list();
      const inspection: SetupInspection = {
        controlRoot,
        settings: !settings.ok ? (settings.error.code === "invalid" ? "invalid" : "unavailable") : settings.value === null ? "uninitialized" : "ready",
        onboarding: await onboardingState(),
        connection,
        grants: grants.ok ? grants.value.items.length : 0,
      };
      if (settings.ok && settings.value) {
        inspection.preferences = settings.value.value.preferences;
        if (settings.value.version) inspection.settingsVersion = settings.value.version;
        inspection.backend = { id: bound.value.backendId, adapter: bound.value.adapter, endpoint: bound.value.endpoint };
        inspection.ingestion = settings.value.value.ingestion.automatic;
        const files = await filesInspect();
        if (files.ok) inspection.files = files.value;
      }
      const limits = [...bound.limits];
      if (connection.tokens === "verified") {
        const active = settings.ok && settings.value ? settings.value.value.knowledgeBackend.configurations.find(c => c.id === settings.value!.value.knowledgeBackend.activeId) : undefined;
        const layout = await bound.value.knowledge.workspace.inspect(active?.layout.locations);
        if (layout.ok) { inspection.layout = layout.value; limits.push(...layout.limits); }
        else limits.push(`Layout inspection failed: ${layout.error.message}`);
      } else {
        limits.push("Layout was not inspected because the knowledge backend is not authorized yet.");
      }
      return { ok: true, value: inspection, limits };
    },
    async setupEstablish(plan: SetupPlan): Promise<Result<{ locations: KnowledgeBackendConfiguration["layout"]["locations"]; templateBindings: TemplateBindingChanges; created: Ref[]; adopted: Ref[]; settings: WriteReceipt }>> {
      if (plan.preferences?.timezone !== undefined && plan.preferences.timezone !== null) {
        try { new Intl.DateTimeFormat("en", { timeZone: plan.preferences.timezone }).format(); }
        catch { return failure("invalid", "The timezone must be a valid IANA timezone.", "Correct the timezone before creating the structure."); }
      }
      const preflight = await control.settings.read();
      debug("setup", "establish-start", { settings: !preflight.ok ? preflight.error.code : preflight.value === null ? "uninitialized" : "ready", plan });
      if (!preflight.ok) return { ok: false, error: { ...preflight.error, next: `Nothing was created in the knowledge base. ${preflight.error.next}` } };
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const scoped = await bound.value.knowledge.workspace.space();
      if (!scoped.ok) return scoped;
      const { preferences, ...layoutPlan } = plan;
      const configured = preflight.value ? preflight.value.value.preferences.metadataLanguage : "en";
      const metadataLanguage = preferences?.metadataLanguage ?? (configured === "zh-CN" ? "zh-CN" : "en");
      const established = await bound.value.knowledge.workspace.establish({ ...layoutPlan, metadataLanguage });
      debug("setup", "layout", established.ok
        ? { space: scoped.value.name, created: established.value.created.length, adopted: established.value.adopted.length, locations: established.value.locations, limits: established.limits }
        : { code: established.error.code, message: established.error.message });
      if (!established.ok) return established;
      invalidateTemplates();
      const current = await control.settings.read();
      if (!current.ok) return { ok: false, error: { ...current.error, code: "partial", affected: [...established.value.created, ...current.error.affected], next: `Backend structures were created but Settings could not be read: ${current.error.next} Rerun Setup adopting the created structures instead of creating them again.` } };
      const previous = current.value?.value.knowledgeBackend.configurations.find(entry => entry.id === bound.value.backendId);
      const configuration: KnowledgeBackendConfiguration = {
        ...previous,
        id: bound.value.backendId,
        adapter: bound.value.adapter,
        instance: scoped.value.id,
        connection: { kind: "mcp", transport: "http", endpoint: { kind: "public-url", url: bound.value.endpoint }, credentialsRef: bound.value.secretKey },
        layout: { locations: established.value.locations },
      };
      let settings: Result<WriteReceipt>;
      const limits = [...established.limits];
      const templateBindings = established.value.templateBindings;
      if (current.value === null) {
        settings = await control.settings.initialize({
          knowledgeBackend: { activeId: configuration.id, configurations: [configuration] },
          ...(preferences ? { preferences } : {}),
          ...(Object.keys(templateBindings).length ? { templates: templateBindings } : {}),
        }, {});
      } else {
        const existing = current.value.value.knowledgeBackend;
        const selection = { activeId: configuration.id, configurations: [configuration, ...existing.configurations.filter(c => c.id !== configuration.id)] };
        const changes: SettingsChanges = {};
        if (JSON.stringify(selection) !== JSON.stringify(existing)) changes.knowledgeBackend = selection;
        if (preferences) {
          const prevPrefs = current.value.value.preferences;
          const prefDiff: PreferenceChanges = {};
          if (preferences.metadataLanguage !== undefined && preferences.metadataLanguage !== prevPrefs.metadataLanguage) prefDiff.metadataLanguage = preferences.metadataLanguage;
          if (preferences.contentLanguage !== undefined && preferences.contentLanguage !== prevPrefs.contentLanguage) prefDiff.contentLanguage = preferences.contentLanguage;
          if (preferences.timezone !== undefined && preferences.timezone !== prevPrefs.timezone) prefDiff.timezone = preferences.timezone;
          if (Object.keys(prefDiff).length) changes.preferences = prefDiff;
        }
        if (Object.keys(templateBindings).length) {
          const prevTemplates = current.value.value.templates;
          const tmplDiff: TemplateBindingChanges = {};
          for (const role of TEMPLATE_ROLES) {
            const candidate = templateBindings[role];
            if (candidate !== undefined && JSON.stringify(candidate) !== JSON.stringify(prevTemplates[role])) {
              tmplDiff[role] = candidate;
            }
          }
          if (Object.keys(tmplDiff).length) changes.templates = tmplDiff;
        }
        if (Object.keys(changes).length === 0) {
          limits.push("Settings already described this layout; nothing was written.");
          settings = { ok: true, value: { affected: [current.value.ref], verified: true, version: current.value.version! }, limits: [] };
        } else {
          settings = await control.settings.update(changes, { expected: current.value.version! });
        }
      }
      debug("setup", "settings", settings.ok ? { written: current.value === null ? "initialized" : "updated", verified: settings.value.verified } : { code: settings.error.code, message: settings.error.message });
      if (!settings.ok) return { ok: false, error: { ...settings.error, code: "partial", affected: [...established.value.created, ...settings.error.affected], next: `Backend structures exist but Settings were not written: ${settings.error.next}` } };
      return { ok: true, value: { ...established.value, settings: settings.value }, limits };
    },
    async setupProposeGrants(): Promise<Result<ControlGrant[]>> {
      const bound = await binding();
      if (!bound.ok) return bound;
      const settings = await control.settings.read();
      if (!settings.ok || settings.value === null) return failure("unavailable", "Settings are not initialized.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
      const active = settings.value.value.knowledgeBackend.configurations.find(c => c.id === settings.value!.value.knowledgeBackend.activeId);
      if (!active) return failure("invalid", "Settings select a backend configuration that does not exist.", "Repair settings.json or rerun Setup.");
      return {
        ok: true,
        value: bound.value.knowledge.workspace.defaultGrants(active.instance, active.layout.locations),
        limits: ["Default set: non-destructive operations only; links.remove is never proposed automatically."],
      };
    },
    async grantsGrant(grants: ControlGrant[]): Promise<Result<CreateReceipt<Ref>[]>> {
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const inventory = await bound.value.knowledge.capabilities();
      if (!inventory.ok) return inventory;
      const known = new Set(Object.keys(inventory.value).filter(key => !key.includes(".query.")));
      const unknown = grants.flatMap(grant => grant.operations.filter(op => !known.has(op)));
      if (unknown.length) return failure("invalid", `Unknown operation IDs: ${[...new Set(unknown)].join(", ")}.`, "Grant only declared port operations.");
      const receipts: CreateReceipt<Ref>[] = [];
      for (const grant of grants) {
        const receipt = await control.grants.grant(grant, {});
        if (!receipt.ok) return receipts.length ? { ok: false, error: { ...receipt.error, code: "partial", affected: receipts.map(r => r.created), next: `${receipts.length} grants were written before this failure; list grants before retrying.` } } : receipt;
        receipts.push(receipt.value);
      }
      return { ok: true, value: receipts, limits: [] };
    },
    async setupGrant(selection: GrantSelection[]): Promise<Result<{ written: number; skipped: number }>> {
      const proposal = await this.setupProposeGrants();
      if (!proposal.ok) return proposal;
      const mergedByRoot = new Map<string, Set<string>>();
      for (const item of selection) {
        const proposed = proposal.value.find(grant => grant.root.id === item.root);
        if (!proposed) return failure("invalid", `Root ${item.root} is not in the proposal.`, "Reload the GPK console and retry.");
        const extra = item.operations.filter(op => !proposed.operations.includes(op));
        if (extra.length) return failure("invalid", `Operations outside the proposal for ${item.root}: ${extra.join(", ")}.`, "Choose only proposed operations.");
        if (item.operations.length) {
          let ops = mergedByRoot.get(item.root);
          if (!ops) { ops = new Set(); mergedByRoot.set(item.root, ops); }
          for (const op of item.operations) ops.add(op);
        }
      }
      const chosen: ControlGrant[] = [];
      for (const [root, ops] of mergedByRoot) {
        const proposed = proposal.value.find(grant => grant.root.id === root)!;
        chosen.push({ ...proposed, operations: proposed.operations.filter(op => ops.has(op)) });
      }
      const existing = await control.grants.list();
      if (!existing.ok) return existing;
      const key = (grant: ControlGrant) => JSON.stringify([grant.backendId, grant.root.scope, grant.root.id, [...grant.operations].sort()]);
      const present = new Set(existing.value.items.map(item => key(item.value)));
      const missing = chosen.filter(grant => !present.has(key(grant)));
      if (missing.length) {
        const written = await this.grantsGrant(missing);
        if (!written.ok) return written;
      }
      debug("setup", "grants", { selected: chosen.map(grant => `${grant.root.id}:${grant.operations.length}`), written: missing.length, skipped: chosen.length - missing.length });
      return { ok: true, value: { written: missing.length, skipped: chosen.length - missing.length }, limits: [] };
    },
    grantsRevoke: (ref: Ref, expected?: Version) => control.grants.revoke(ref, expected === undefined ? {} : { expected }),

    async settingsUpdate(changes: SettingsChanges, expected?: Version): Promise<Result<WriteReceipt>> {
      if (changes.ingestion?.automatic?.origins) {
        return failure("invalid", "Manage session retention settings in the Configuration console.", "Open the console with gpk open.");
      }
      if (changes.ingestion?.automatic?.enabled === true) {
        const current = await control.settings.read();
        if (!current.ok) return current;
        if (!current.value) return failure("unavailable", "Settings are not initialized.", "Finish onboarding first.");
        const currentOrigins = current.value.value.ingestion.automatic.origins;
        if (currentOrigins.length > 0 && !currentOrigins.some(origin => Boolean(origin.depth))) {
          return failure("invalid", "Configured session origins lack an automatic ingest depth.", "Open the console with gpk open and choose an automatic ingest depth.");
        }
      }
      if (changes.templates) invalidateTemplates();
      return control.settings.update(changes, expected === undefined ? {} : { expected });
    },

    async preferencesUpdate(input: PreferencesUpdateInput): Promise<Result<WriteReceipt>> {
      const changes: SettingsChanges = {};
      if (input.preferences && Object.keys(input.preferences).length) changes.preferences = input.preferences;
      if (input.templates && Object.keys(input.templates).length) changes.templates = input.templates;
      if (input.automaticIngestionEnabled !== undefined) {
        changes.ingestion = { automatic: { enabled: input.automaticIngestionEnabled } };
      }
      return operations.settingsUpdate(changes, input.expected);
    },

    filesInspect,
    async sessionsConfigure(enabled: boolean, origins: IngestOriginPolicy[]) {
      const homeReal = await realpath(home).catch(() => path.resolve(home));
      const forbidden = await disallowedPaths();
      const resolved: IngestOriginPolicy[] = [];
      for (const origin of origins) {
        if (!origin || typeof origin.location !== "string") return failure("invalid", "Every session origin needs a folder path.", "Enter an absolute folder path.");
        const given = origin.location.trim().replace(/^~(?=$|\/)/, home);
        if (!path.isAbsolute(given)) return failure("invalid", `${origin.location} is not an absolute folder path.`, "Enter the full path, for example ~/.claude/projects.");
        let location: string;
        try {
          location = await realpath(given);
          if (!(await stat(location)).isDirectory()) throw new Error();
        } catch { return failure("invalid", "A selected session folder does not exist or is not a directory.", "Choose an existing Claude Code, Codex or Antigravity session folder."); }
        if (location === path.parse(location).root || location === homeReal || overlapsDisallowed(location, forbidden)) {
          return failure("invalid", "Choose a dedicated session folder outside the home root and GPK's own control/runtime files.", "Select the client's session folder or one of its subfolders.");
        }
        const normalized: IngestOriginPolicy = {
          id: origin.id,
          reader: origin.reader,
          location,
          exclusions: origin.exclusions,
          retention: origin.retention,
          ...(origin.depth !== undefined ? { depth: origin.depth } : {}),
          instructions: origin.instructions,
        };
        resolved.push(normalized);
      }
      const checked = validateSessionOrigins(resolved); if (!checked.ok) return checked;
      if (enabled && !resolved.some(origin => Boolean(origin.depth))) {
        return failure("invalid", "Choose at least one session folder with an automatic ingest depth before enabling automatic retention.", "Select a folder and an automatic ingest depth first.");
      }
      const current = await activeSettings(); if (!current.ok) return current;
      const previous = current.value.snapshot.value.ingestion.automatic;
      if (previous.enabled !== enabled || JSON.stringify(previous.origins) !== JSON.stringify(resolved)) {
        const saved = await control.settings.update({ ingestion: { automatic: { enabled, origins: resolved } } }, { expected: current.value.snapshot.version! });
        if (!saved.ok) return saved;
        if (!saved.value.verified) return failure("uncertain", "Session settings were not verified.", "Reload Setup and inspect the saved choices.");
      }
      return { ok: true as const, value: { ...previous, enabled, origins: resolved }, limits: [] };
    },
    async sessionsConfigureSimple(input: {
      enabled: boolean;
      retention?: IngestOriginPolicy["retention"] | undefined;
      depth?: IngestOriginPolicy["depth"] | undefined;
      instructions?: string | undefined;
    }) {
      const current = await activeSettings(); if (!current.ok) return current;
      const previous = current.value.snapshot.value.ingestion.automatic;
      const retention = input.retention ?? previous.retention ?? previous.origins[0]?.retention ?? "summary";
      const depth = input.depth ?? previous.depth ?? previous.origins[0]?.depth ?? "save";
      const instructions = input.instructions ?? previous.instructions ?? previous.origins[0]?.instructions ?? "";
      const nextAutomatic = {
        enabled: input.enabled,
        retention,
        depth,
        instructions,
        origins: [] as IngestOriginPolicy[],
      };
      if (
        previous.enabled !== nextAutomatic.enabled
        || previous.retention !== nextAutomatic.retention
        || previous.depth !== nextAutomatic.depth
        || previous.instructions !== nextAutomatic.instructions
        || previous.origins.length !== 0
      ) {
        const saved = await control.settings.update(
          { ingestion: { automatic: nextAutomatic } },
          { expected: current.value.snapshot.version! },
        );
        if (!saved.ok) return saved;
        if (!saved.value.verified) return failure("uncertain", "Session settings were not verified.", "Reload Configuration and inspect the saved choices.");
      }
      return { ok: true as const, value: nextAutomatic, limits: [] };
    },
    async uploadsConnect(url: string, key?: string): Promise<Result<FilesInspection>> {
      const current = await activeSettings(); if (!current.ok) return current;
      const credentials = key ? { url: url.trim(), key: key.trim() } : { url: url.trim() };
      const verified = await media.uploads.verify(credentials, current.value.active.instance); if (!verified.ok) return verified;
      const ref = media.secretKey(current.value.active.id);
      try { await media.secrets().write(ref, JSON.stringify(credentials)); }
      catch { return failure("unavailable", "The API connection could not be saved in the secret store.", "Check access to the keychain and retry."); }
      const written = await writeUploads({ kind: "api", endpoint: { kind: "secret-reference", ref } }); if (!written.ok) return written;
      debug("setup", "uploads-connected", { ref });
      return filesInspect();
    },
    async uploadsDisconnect(): Promise<Result<FilesInspection>> {
      const current = await activeSettings(); if (!current.ok) return current;
      const ref = current.value.active.uploads?.endpoint.ref;
      const written = await writeUploads(undefined); if (!written.ok) return written;
      if (ref) await media.secrets().remove(ref).catch(() => undefined);
      return filesInspect();
    },
    async filesSetRoots(roots: string[]): Promise<Result<FilesInspection>> {
      const homeReal = await realpath(home).catch(() => path.resolve(home));
      const forbidden = await disallowedPaths();
      const resolved: string[] = [];
      for (const entry of roots) {
        const given = entry.trim().replace(/^~(?=$|\/)/, home);
        if (!path.isAbsolute(given)) return failure("invalid", `${entry} is not an absolute folder path.`, "Enter the full path, for example ~/Documents/Notes.");
        let real: string;
        try { real = await realpath(given); } catch { return failure("not-found", `${entry} does not exist.`, "Check the path."); }
        if (!(await stat(real)).isDirectory()) return failure("invalid", `${entry} is not a folder.`, "Choose a folder.");
        if (real === path.parse(real).root || real === homeReal || overlapsDisallowed(real, forbidden)) {
          return failure("invalid", `${entry} is too broad or holds GPK's own files.`, "Choose the folder of the notes to import.");
        }
        if (!resolved.includes(real)) resolved.push(real);
      }
      const current = await activeSettings(); if (!current.ok) return current;
      if (JSON.stringify(resolved) !== JSON.stringify(current.value.snapshot.value.files.roots)) {
        const written = await control.settings.update({ files: { roots: resolved } }, { expected: current.value.snapshot.version! }); if (!written.ok) return written;
      }
      return filesInspect();
    },

    knowledgeCapabilities: async () => { const bound = await binding(); return bound.ok ? bound.value.knowledge.capabilities() : bound; },
    settingsRead: () => control.settings.read(),
    grantsList: () => control.grants.list(),

    // Captures & Daily Notes
    capturesGet: (input: CapturesGetInput): Promise<Result<CapturesGetResult>> => withBinding<CapturesGetResult>(async bound => {
      if ("refs" in input) {
        const items: Snapshot<Capture, CaptureRef>[] = [];
        const limits: string[] = [];
        for (const ref of input.refs) {
          const read = await bound.knowledge.captures.read(ref);
          if (!read.ok) return read;
          items.push(read.value);
          limits.push(...read.limits);
        }
        return { ok: true, value: { items, coverage: items.every(item => item.coverage === "complete") ? "complete" as const : "partial" as const }, limits: [...new Set(limits)] };
      }
      let targetSurface: CaptureSurface;
      let resolvedDate: string | undefined;
      if (input.surface.name === "inbox") {
        targetSurface = { name: "inbox" };
      } else {
        resolvedDate = input.surface.date;
        if (!resolvedDate) {
          const scoped = await bound.knowledge.workspace.space();
          if (!scoped.ok) return scoped;
          resolvedDate = todayIn(scoped.value.timezone);
        }
        targetSurface = { name: "daily-notes", date: resolvedDate };
      }
      const resolved = await bound.knowledge.captures.resolve(targetSurface);
      if (!resolved.ok) return resolved;
      const options: ReadOptions = {
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      };
      const listed = await bound.knowledge.captures.list(resolved.value, options);
      if (!listed.ok) return listed;
      return {
        ok: true,
        value: {
          surface: resolved.value,
          ...(resolvedDate ? { date: resolvedDate } : {}),
          ...listed.value,
        },
        limits: [...new Set([...resolved.limits, ...listed.limits])],
      };
    }),

    dailyRecord: (summary: string, related?: EntityRef, date?: string) =>
      withBinding(bound => recordDailyInternal(bound, summary, related, date)),

    // Areas
    areasGet: (input: AreaQuery & { targets?: (string | AreaRef)[] } = {}) => withBinding(async bound => {
      const piggy = await piggybackTemplates(bound, ["area"]);
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.areas);
        if (!res.ok) return res;
        return {
          ok: true,
          value: { ...res.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
          limits: [...new Set([...res.limits, ...piggy.limits])],
        };
      }
      const { targets: _ignored, ...query } = input;
      const queried = await bound.knowledge.areas.query(query);
      if (!queried.ok) return queried;
      return {
        ok: true,
        value: { ...queried.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
        limits: [...new Set([...queried.limits, ...piggy.limits])],
      };
    }),

    areasCreate: (input: AreaCreateInput) => withBinding(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      const created = await bound.knowledge.areas.create({ title: input.title, content: input.content, state: input.state }, guard.value);
      if (!created.ok) return created;
      const completedSteps = ["areas.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      const limits = [...created.limits];

      for (const [idx, link] of (input.links ?? []).entries()) {
        const stepGuard = await writeGuard(bound, latestVersion);
        if (!stepGuard.ok) return partialFailure(stepGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: created.value.created, to: link.to, context: link.context }, stepGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, created.value.created, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        limits.push(...logged.limits);
      }
      return {
        ok: true,
        value: {
          ...created.value,
          affected: dedupeRefs(affected),
          ...(latestVersion ? { version: latestVersion } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    areasUpdate: (input: AreaUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];

      const contentUpdate: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
        ...(input.replaceContent !== undefined ? { replaceContent: input.replaceContent } : {}),
      };
      if (hasContentChanges(contentUpdate)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.areas.update(input.ref, contentUpdate, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "areas.update", affected, latestVersion);
        completedSteps.push("areas.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      if (input.transition) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "areas.transition", affected, latestVersion);
        const moved = await bound.knowledge.areas.transition(input.ref, input.transition.state, input.transition.reason, guard.value);
        if (!moved.ok) return partialFailure(moved.error, completedSteps, "areas.transition", affected, latestVersion);
        completedSteps.push("areas.transition");
        affected.push(...moved.value.affected);
        verified &&= moved.value.verified;
        latestVersion = moved.value.version;
        limits.push(...moved.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Area change (title, edits, append, replaceContent, transition, linksAdd or activitySummary).", "Nothing to change.");
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    // Projects & Materials
    projectsGet: (input: ProjectsGetInput = {}): Promise<Result<ProjectsGetResult>> => withBinding<ProjectsGetResult>(async bound => {
      const piggy = await piggybackTemplates(bound, ["project", "task"]);
      const limits = [...piggy.limits];
      if (input.material) {
        const readMat = await bound.knowledge.projects.materials.read(input.material);
        if (!readMat.ok) return readMat;
        limits.push(...readMat.limits);
        return {
          ok: true,
          value: {
            items: [],
            coverage: readMat.value.coverage,
            material: readMat.value,
            ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}),
          },
          limits: [...new Set(limits)],
        };
      }
      let pageData: Page<Snapshot<Project, ProjectRef>>;
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.projects);
        if (!res.ok) return res;
        pageData = res.value;
        limits.push(...res.limits);
      } else {
        const { targets: _t, material: _m, include: _i, ...query } = input;
        const queried = await bound.knowledge.projects.query(query);
        if (!queried.ok) return queried;
        pageData = queried.value;
        limits.push(...queried.limits);
      }
      let included: Record<string, ProjectIncludedContext> | undefined;
      if (input.include?.length && pageData.items.length) {
        const want = new Set(input.include);
        included = {};
        const cap = Math.min(pageData.items.length, 10);
        if (pageData.items.length > cap) {
          limits.push(`Included Project sub-resources were expanded for the first ${cap} Projects only.`);
        }
        for (const item of pageData.items.slice(0, cap)) {
          const entry: ProjectIncludedContext = {};
          if (want.has("area") && item.value.primaryArea) {
            const areaRead = await bound.knowledge.areas.read(item.value.primaryArea);
            if (areaRead.ok) { entry.area = areaRead.value; limits.push(...areaRead.limits); }
            else limits.push(`Primary Area ${item.value.primaryArea.id} could not be read: ${areaRead.error.message}`);
          }
          if (want.has("tasks")) {
            const tasksPage = await bound.knowledge.tasks.query({ project: item.ref, limit: 100 });
            if (tasksPage.ok) { entry.tasks = tasksPage.value; limits.push(...tasksPage.limits); }
            else limits.push(`Tasks for Project ${item.ref.id} could not be read: ${tasksPage.error.message}`);
          }
          if (want.has("materials")) {
            const matsPage = await bound.knowledge.projects.materials.list(item.ref);
            if (matsPage.ok) { entry.materials = matsPage.value; limits.push(...matsPage.limits); }
            else limits.push(`Materials for Project ${item.ref.id} could not be listed: ${matsPage.error.message}`);
          }
          if (want.has("links")) {
            const linksPage = await bound.knowledge.links.query(item.ref);
            if (linksPage.ok) { entry.links = linksPage.value; limits.push(...linksPage.limits); }
            else limits.push(`Links for Project ${item.ref.id} could not be queried: ${linksPage.error.message}`);
          }
          included[item.ref.id] = entry;
        }
      }
      return {
        ok: true,
        value: {
          ...pageData,
          ...(included ? { included } : {}),
          ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    projectsCreate: (input: ProjectCreateInput) => withBinding(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      const projectInput: ProjectInput = {
        title: input.title,
        content: input.content,
        state: input.state,
        primaryArea: input.primaryArea,
        ...(input.history !== undefined ? { history: input.history } : {}),
      };
      const created = await bound.knowledge.projects.create(projectInput, guard.value);
      if (!created.ok) return created;
      const projectRef = created.value.created;
      const completedSteps = ["projects.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      let verified = created.value.verified;
      const limits = [...created.limits];
      const createdTasks: TaskRef[] = [];
      const createdMaterials: ProjectMaterialRef[] = [];

      for (const [idx, task] of (input.initialTasks ?? []).entries()) {
        const taskGuard = await writeGuard(bound);
        if (!taskGuard.ok) return partialFailure(taskGuard.error, completedSteps, `tasks.create[${idx}]`, affected);
        const taskCreated = await bound.knowledge.tasks.create({
          title: task.title,
          content: task.content ?? "",
          state: task.state ?? "todo",
          project: projectRef,
          ...(task.time !== undefined ? { time: task.time } : {}),
          ...(task.history !== undefined ? { history: task.history } : {}),
        }, taskGuard.value);
        if (!taskCreated.ok) return partialFailure(taskCreated.error, completedSteps, `tasks.create[${idx}]`, affected);
        completedSteps.push(`tasks.create[${idx}]`);
        createdTasks.push(taskCreated.value.created);
        affected.push(...taskCreated.value.affected);
        verified &&= taskCreated.value.verified;
        latestVersion = undefined; // Child task blocks advance the Project row digest; refresh below if needed.
        limits.push(...taskCreated.limits);
      }

      for (const [idx, material] of (input.materials ?? []).entries()) {
        const matGuard = await writeGuard(bound, latestVersion);
        if (!matGuard.ok) return partialFailure(matGuard.error, completedSteps, `materials.append[${idx}]`, affected, latestVersion);
        const matCreated = await bound.knowledge.projects.materials.append(projectRef, material, matGuard.value);
        if (!matCreated.ok) return partialFailure(matCreated.error, completedSteps, `materials.append[${idx}]`, affected, latestVersion);
        completedSteps.push(`materials.append[${idx}]`);
        createdMaterials.push(matCreated.value.created);
        affected.push(...matCreated.value.affected);
        verified &&= matCreated.value.verified;
        latestVersion = matCreated.value.version;
        limits.push(...matCreated.limits);
      }

      for (const [idx, link] of (input.links ?? []).entries()) {
        const linkGuard = await writeGuard(bound, latestVersion);
        if (!linkGuard.ok) return partialFailure(linkGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: projectRef, to: link.to, context: link.context }, linkGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }

      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, projectRef, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }

      if (!latestVersion && createdTasks.length) {
        const refreshed = await bound.knowledge.projects.read(projectRef);
        if (refreshed.ok && refreshed.value.version) latestVersion = refreshed.value.version;
      }

      return {
        ok: true,
        value: {
          ...created.value,
          verified,
          affected: dedupeRefs(affected),
          ...(latestVersion ? { version: latestVersion } : {}),
          ...(createdTasks.length ? { tasks: createdTasks } : {}),
          ...(createdMaterials.length ? { materials: createdMaterials } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    projectsUpdate: (input: ProjectUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];
      const createdMaterials: ProjectMaterialRef[] = [];

      const contentUpdate: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
        ...(input.replaceContent !== undefined ? { replaceContent: input.replaceContent } : {}),
      };
      if (hasContentChanges(contentUpdate)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.projects.update(input.ref, contentUpdate, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "projects.update", affected, latestVersion);
        completedSteps.push("projects.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      if (input.primaryArea) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "projects.assignArea", affected, latestVersion);
        const assigned = await bound.knowledge.projects.assignArea(input.ref, input.primaryArea.area, input.primaryArea.reason, guard.value);
        if (!assigned.ok) return partialFailure(assigned.error, completedSteps, "projects.assignArea", affected, latestVersion);
        completedSteps.push("projects.assignArea");
        affected.push(...assigned.value.affected);
        verified &&= assigned.value.verified;
        latestVersion = assigned.value.version;
        limits.push(...assigned.limits);
      }
      if (input.taskOrder) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "projects.orderTasks", affected, latestVersion);
        const ordered = await bound.knowledge.projects.orderTasks(input.ref, input.taskOrder, guard.value);
        if (!ordered.ok) return partialFailure(ordered.error, completedSteps, "projects.orderTasks", affected, latestVersion);
        completedSteps.push("projects.orderTasks");
        affected.push(...ordered.value.affected);
        verified &&= ordered.value.verified;
        latestVersion = ordered.value.version;
        limits.push(...ordered.limits);
      }
      if (input.transition) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "projects.transition", affected, latestVersion);
        const moved = await bound.knowledge.projects.transition(input.ref, input.transition.state, input.transition.reason, guard.value);
        if (!moved.ok) return partialFailure(moved.error, completedSteps, "projects.transition", affected, latestVersion);
        completedSteps.push("projects.transition");
        affected.push(...moved.value.affected);
        verified &&= moved.value.verified;
        latestVersion = moved.value.version;
        limits.push(...moved.limits);
      }
      for (const [idx, material] of (input.materialAppend ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `materials.append[${idx}]`, affected, latestVersion);
        const appended = await bound.knowledge.projects.materials.append(input.ref, material, guard.value);
        if (!appended.ok) return partialFailure(appended.error, completedSteps, `materials.append[${idx}]`, affected, latestVersion);
        completedSteps.push(`materials.append[${idx}]`);
        createdMaterials.push(appended.value.created);
        affected.push(...appended.value.affected);
        verified &&= appended.value.verified;
        latestVersion = appended.value.version;
        limits.push(...appended.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      for (const [idx, item] of (input.materialUpdate ?? []).entries()) {
        const guard = await writeGuard(bound, item.expected);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `materials.update[${idx}]`, affected, latestVersion);
        const matChanges: ContentUpdate = {
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.edits !== undefined ? { edits: item.edits } : {}),
          ...(item.append !== undefined ? { append: item.append } : {}),
          ...(item.replaceContent !== undefined ? { replaceContent: item.replaceContent } : {}),
        };
        const updated = await bound.knowledge.projects.materials.update(item.ref, matChanges, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, `materials.update[${idx}]`, affected, latestVersion);
        completedSteps.push(`materials.update[${idx}]`);
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = undefined;
        limits.push(...updated.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Project change.", "Nothing to change.");
      if (!latestVersion && input.materialUpdate?.length) {
        const refreshed = await bound.knowledge.projects.read(input.ref);
        if (refreshed.ok && refreshed.value.version) latestVersion = refreshed.value.version;
      }
      return {
        ok: true,
        value: {
          affected: dedupeRefs(affected),
          verified,
          ...(latestVersion ? { version: latestVersion } : {}),
          ...(createdMaterials.length ? { materials: createdMaterials } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    // Tasks
    tasksGet: (input: TaskQuery & { targets?: (string | TaskRef)[] } = {}) => withBinding(async bound => {
      const piggy = await piggybackTemplates(bound, ["task"]);
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.tasks);
        if (!res.ok) return res;
        return {
          ok: true,
          value: { ...res.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
          limits: [...new Set([...res.limits, ...piggy.limits])],
        };
      }
      const { targets: _ignored, ...query } = input;
      const queried = await bound.knowledge.tasks.query(query);
      if (!queried.ok) return queried;
      return {
        ok: true,
        value: { ...queried.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
        limits: [...new Set([...queried.limits, ...piggy.limits])],
      };
    }),

    tasksCreate: (input: TaskCreateInput): Promise<Result<TaskCreateResult>> => withBinding<TaskCreateResult>(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      if ("items" in input) {
        const completedSteps: string[] = [];
        const receipts: CreateReceipt<TaskRef>[] = [];
        const affected: Ref[] = [];
        const limits: string[] = [];
        let verified = true;
        for (const [idx, item] of input.items.entries()) {
          const created = await bound.knowledge.tasks.create({
            title: item.title,
            content: item.content ?? "",
            state: item.state ?? "todo",
            ...(item.time !== undefined ? { time: item.time } : {}),
            ...(item.history !== undefined ? { history: item.history } : {}),
            ...(item.project !== undefined ? { project: item.project } : {}),
          }, guard.value);
          if (!created.ok) return partialFailure(created.error, completedSteps, `tasks.create[${idx}]`, affected);
          completedSteps.push(`tasks.create[${idx}]`);
          receipts.push(created.value);
          affected.push(...created.value.affected);
          verified &&= created.value.verified;
          limits.push(...created.limits);
        }
        if (input.activitySummary !== undefined) {
          const logged = await recordDailyInternal(bound, input.activitySummary, receipts[0]?.created, input.activityDate);
          if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected);
          completedSteps.push("captures.recordActivity");
          affected.push(...logged.value.affected);
          verified &&= logged.value.verified;
          limits.push(...logged.limits);
        }
        return {
          ok: true,
          value: {
            created: receipts.map(r => r.created),
            items: receipts,
            affected: dedupeRefs(affected),
            verified,
          },
          limits: [...new Set(limits)],
        };
      }
      const created = await bound.knowledge.tasks.create({
        title: input.title,
        content: input.content ?? "",
        state: input.state ?? "todo",
        ...(input.time !== undefined ? { time: input.time } : {}),
        ...(input.history !== undefined ? { history: input.history } : {}),
        ...(input.project !== undefined ? { project: input.project } : {}),
      }, guard.value);
      if (!created.ok) return created;
      const completedSteps = ["tasks.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      let verified = created.value.verified;
      const limits = [...created.limits];

      for (const [idx, link] of (input.links ?? []).entries()) {
        const linkGuard = await writeGuard(bound, latestVersion);
        if (!linkGuard.ok) return partialFailure(linkGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: created.value.created, to: link.to, context: link.context }, linkGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, created.value.created, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      return {
        ok: true,
        value: {
          ...created.value,
          verified,
          affected: dedupeRefs(affected),
          ...(latestVersion ? { version: latestVersion } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    tasksUpdate: (input: TaskUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];

      const contentUpdate: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
      };
      if (hasContentChanges(contentUpdate)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.tasks.update(input.ref, contentUpdate, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "tasks.update", affected, latestVersion);
        completedSteps.push("tasks.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      if (input.time !== undefined) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "tasks.schedule", affected, latestVersion);
        const scheduled = await bound.knowledge.tasks.schedule(input.ref, input.time, guard.value);
        if (!scheduled.ok) return partialFailure(scheduled.error, completedSteps, "tasks.schedule", affected, latestVersion);
        completedSteps.push("tasks.schedule");
        affected.push(...scheduled.value.affected);
        verified &&= scheduled.value.verified;
        latestVersion = scheduled.value.version;
        limits.push(...scheduled.limits);
      }
      if (input.project !== undefined) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "tasks.assignProject", affected, latestVersion);
        const assigned = await bound.knowledge.tasks.assignProject(input.ref, input.project.target, input.project.reason, guard.value);
        if (!assigned.ok) return partialFailure(assigned.error, completedSteps, "tasks.assignProject", affected, latestVersion);
        completedSteps.push("tasks.assignProject");
        affected.push(...assigned.value.affected);
        verified &&= assigned.value.verified;
        latestVersion = assigned.value.version;
        limits.push(...assigned.limits);
      }
      if (input.transition !== undefined) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "tasks.transition", affected, latestVersion);
        const moved = await bound.knowledge.tasks.transition(input.ref, input.transition.state, input.transition.reason, guard.value);
        if (!moved.ok) return partialFailure(moved.error, completedSteps, "tasks.transition", affected, latestVersion);
        completedSteps.push("tasks.transition");
        affected.push(...moved.value.affected);
        verified &&= moved.value.verified;
        latestVersion = moved.value.version;
        limits.push(...moved.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Task change (title, edits, append, time, project, transition, linksAdd or activitySummary).", "Nothing to change.");
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    // Sources
    sourcesGet: (input: SourceQuery & { targets?: (string | SourceRef)[] } = {}) => withBinding(async bound => {
      const piggy = await piggybackTemplates(bound, ["source"]);
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.sources);
        if (!res.ok) return res;
        return {
          ok: true,
          value: { ...res.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
          limits: [...new Set([...res.limits, ...piggy.limits])],
        };
      }
      const { targets: _ignored, ...query } = input;
      const queried = await bound.knowledge.sources.query(query);
      if (!queried.ok) return queried;
      return {
        ok: true,
        value: { ...queried.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
        limits: [...new Set([...queried.limits, ...piggy.limits])],
      };
    }),

    sourcesCreate: (input: SourceCreateInput) => withBinding(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      const created = await bound.knowledge.sources.create({
        title: input.title,
        content: input.content,
        ...(input.originalFile !== undefined ? { originalFile: input.originalFile } : {}),
      }, guard.value);
      if (!created.ok) return created;
      const completedSteps = ["sources.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      let verified = created.value.verified;
      const limits = [...created.limits];

      for (const [idx, link] of (input.links ?? []).entries()) {
        const linkGuard = await writeGuard(bound, latestVersion);
        if (!linkGuard.ok) return partialFailure(linkGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: created.value.created, to: link.to, context: link.context }, linkGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }

      const shouldLogDaily = input.recordInDaily ?? false;
      if (shouldLogDaily) {
        const summary = input.activitySummary ?? "Saved";
        const logged = await recordDailyInternal(bound, summary, created.value.created, input.dailyDate);
        if (!logged.ok) {
          if (logged.error.code === "unauthorized" && !input.explicitRecordInDaily && input.activitySummary === undefined) {
            limits.push("Source was saved, but Daily Note logging was skipped because captures.recordActivity on daily-notes is not granted.");
          } else {
            return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
          }
        } else {
          completedSteps.push("captures.recordActivity");
          affected.push(...logged.value.affected);
          verified &&= logged.value.verified;
          limits.push(...logged.limits);
        }
      }
      return {
        ok: true,
        value: {
          ...created.value,
          verified,
          affected: dedupeRefs(affected),
          ...(latestVersion ? { version: latestVersion } : {}),
        },
        limits: [...new Set(limits)],
      };
    }),

    sourcesUpdate: (input: SourceCompoundUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];

      const contentChanges: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
        ...(input.replaceContent !== undefined ? { replaceContent: input.replaceContent } : {}),
      };
      if (hasContentChanges(contentChanges)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.sources.update(input.ref, contentChanges, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "sources.update", affected, latestVersion);
        completedSteps.push("sources.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      if (input.originalFile !== undefined) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, "sources.attachOriginal", affected, latestVersion);
        const attached = await bound.knowledge.sources.update(input.ref, { originalFile: input.originalFile }, guard.value);
        if (!attached.ok) return partialFailure(attached.error, completedSteps, "sources.attachOriginal", affected, latestVersion);
        completedSteps.push("sources.attachOriginal");
        affected.push(...attached.value.affected);
        verified &&= attached.value.verified;
        latestVersion = attached.value.version;
        limits.push(...attached.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Source change (title, edits, append, replaceContent, originalFile, linksAdd or activitySummary).", "Nothing to change.");
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    // Wikis
    wikisGet: (input: WikiQuery & { targets?: (string | WikiRef)[] } = {}) => withBinding(async bound => {
      const piggy = await piggybackTemplates(bound, ["wiki"]);
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.wikis);
        if (!res.ok) return res;
        return {
          ok: true,
          value: { ...res.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
          limits: [...new Set([...res.limits, ...piggy.limits])],
        };
      }
      const { targets: _ignored, ...query } = input;
      const queried = await bound.knowledge.wikis.query(query);
      if (!queried.ok) return queried;
      return {
        ok: true,
        value: { ...queried.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
        limits: [...new Set([...queried.limits, ...piggy.limits])],
      };
    }),

    wikisCreate: (input: WikiCreateInput) => withBinding(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      const created = await bound.knowledge.wikis.create({ title: input.title, content: input.content }, guard.value);
      if (!created.ok) return created;
      const completedSteps = ["wikis.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      let verified = created.value.verified;
      const limits = [...created.limits];

      for (const [idx, link] of (input.links ?? []).entries()) {
        const linkGuard = await writeGuard(bound, latestVersion);
        if (!linkGuard.ok) return partialFailure(linkGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: created.value.created, to: link.to, context: link.context }, linkGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, created.value.created, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      return {
        ok: true,
        value: { ...created.value, verified, affected: dedupeRefs(affected), ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    wikisUpdate: (input: WikiCompoundUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];

      const contentChanges: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
        ...(input.replaceContent !== undefined ? { replaceContent: input.replaceContent } : {}),
      };
      if (hasContentChanges(contentChanges)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.wikis.update(input.ref, contentChanges, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "wikis.update", affected, latestVersion);
        completedSteps.push("wikis.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Wiki change (title, edits, append, replaceContent, linksAdd or activitySummary).", "Nothing to change.");
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    // Outputs
    outputsGet: (input: OutputQuery & { targets?: (string | OutputRef)[] } = {}) => withBinding(async bound => {
      const piggy = await piggybackTemplates(bound, ["output"]);
      if (input.targets?.length) {
        const res = await resolveAndReadTargets(input.targets, bound.knowledge.outputs);
        if (!res.ok) return res;
        return {
          ok: true,
          value: { ...res.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
          limits: [...new Set([...res.limits, ...piggy.limits])],
        };
      }
      const { targets: _ignored, ...query } = input;
      const queried = await bound.knowledge.outputs.query(query);
      if (!queried.ok) return queried;
      return {
        ok: true,
        value: { ...queried.value, ...(piggy.customTemplates ? { customTemplates: piggy.customTemplates } : {}) },
        limits: [...new Set([...queried.limits, ...piggy.limits])],
      };
    }),

    outputsCreate: (input: OutputCreateInput) => withBinding(async bound => {
      const guard = await writeGuard(bound);
      if (!guard.ok) return guard;
      const created = await bound.knowledge.outputs.create({ title: input.title, content: input.content }, guard.value);
      if (!created.ok) return created;
      const completedSteps = ["outputs.create"];
      const affected: Ref[] = [...created.value.affected];
      let latestVersion = created.value.version;
      let verified = created.value.verified;
      const limits = [...created.limits];

      for (const [idx, link] of (input.links ?? []).entries()) {
        const linkGuard = await writeGuard(bound, latestVersion);
        if (!linkGuard.ok) return partialFailure(linkGuard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: created.value.created, to: link.to, context: link.context }, linkGuard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, created.value.created, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      return {
        ok: true,
        value: { ...created.value, verified, affected: dedupeRefs(affected), ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    outputsUpdate: (input: OutputCompoundUpdateInput) => withBinding(async bound => {
      const completedSteps: string[] = [];
      const affected: Ref[] = [input.ref];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];

      const contentChanges: ContentUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.edits !== undefined ? { edits: input.edits } : {}),
        ...(input.append !== undefined ? { append: input.append } : {}),
        ...(input.replaceContent !== undefined ? { replaceContent: input.replaceContent } : {}),
      };
      if (hasContentChanges(contentChanges)) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return guard;
        const updated = await bound.knowledge.outputs.update(input.ref, contentChanges, guard.value);
        if (!updated.ok) return partialFailure(updated.error, completedSteps, "outputs.update", affected, latestVersion);
        completedSteps.push("outputs.update");
        affected.push(...updated.value.affected);
        verified &&= updated.value.verified;
        latestVersion = updated.value.version;
        limits.push(...updated.limits);
      }
      for (const [idx, link] of (input.linksAdd ?? []).entries()) {
        const guard = await writeGuard(bound, latestVersion);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add({ from: input.ref, to: link.to, context: link.context }, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        if (added.value.version) latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      if (input.activitySummary !== undefined) {
        const logged = await recordDailyInternal(bound, input.activitySummary, input.ref, input.activityDate);
        if (!logged.ok) return partialFailure(logged.error, completedSteps, "captures.recordActivity", affected, latestVersion);
        completedSteps.push("captures.recordActivity");
        affected.push(...logged.value.affected);
        verified &&= logged.value.verified;
        limits.push(...logged.limits);
      }
      if (!completedSteps.length) return failure("invalid", "Supply at least one Output change (title, edits, append, replaceContent, linksAdd or activitySummary).", "Nothing to change.");
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    // Links, Checkpoints & Review
    linksManage: (input: LinksManageInput): Promise<Result<Page<KnowledgeLink> | WriteReceipt>> => withBinding<Page<KnowledgeLink> | WriteReceipt>(async bound => {
      if (input.action === "query") {
        const options: ReadOptions = {
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        };
        return bound.knowledge.links.query(input.ref, options);
      }
      if (input.action === "remove") {
        const guard = await writeGuard(bound, input.expected);
        if (!guard.ok) return guard;
        return bound.knowledge.links.remove(input.link, guard.value);
      }
      const completedSteps: string[] = [];
      const affected: Ref[] = [];
      let latestVersion = input.expected;
      let verified = true;
      const limits: string[] = [];
      for (const [idx, link] of input.links.entries()) {
        const sameSourceAsPrev = idx > 0 && input.links[idx - 1]!.from.kind === link.from.kind && input.links[idx - 1]!.from.id === link.from.id;
        const expected = idx === 0 ? input.expected : sameSourceAsPrev ? latestVersion : undefined;
        const guard = await writeGuard(bound, expected);
        if (!guard.ok) return partialFailure(guard.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        const added = await bound.knowledge.links.add(link, guard.value);
        if (!added.ok) return partialFailure(added.error, completedSteps, `links.add[${idx}]`, affected, latestVersion);
        completedSteps.push(`links.add[${idx}]`);
        affected.push(...added.value.affected);
        verified &&= added.value.verified;
        latestVersion = added.value.version;
        limits.push(...added.limits);
      }
      return {
        ok: true,
        value: { affected: dedupeRefs(affected), verified, ...(latestVersion ? { version: latestVersion } : {}) },
        limits: [...new Set(limits)],
      };
    }),

    checkpointsManage: (input: CheckpointsManageInput): Promise<Result<Snapshot<string> | null | WriteReceipt>> => withBinding<Snapshot<string> | null | WriteReceipt>(async bound => {
      if (input.action === "read") return bound.knowledge.checkpoints.read(input.key);
      const guard = await writeGuard(bound, input.expected);
      if (!guard.ok) return guard;
      return bound.knowledge.checkpoints.save(input.key, input.content, guard.value);
    }),

    reviewInventory: (cadence: ReviewCadence, horizonDays?: number) => withBinding(async bound => {
      const scoped = await bound.knowledge.workspace.space();
      if (!scoped.ok) return scoped;
      return reviewInventory(bound.knowledge, cadence, todayIn(scoped.value.timezone), horizonDays);
    }),
  };

  const sessions = createSessionIngestion({
    controlRoot,
    homeDir: home,
    async settings() {
      const current = await control.settings.read();
      if (!current.ok) return current;
      if (!current.value || await onboardingState() === "required") return failure("unavailable", "Complete GPK onboarding before reading sessions.", "Call gpk_setup_open and finish onboarding in the browser.");
      return { ok: true, value: current.value.value, limits: current.limits };
    },
    today: () => withBinding(async bound => {
      const scoped = await bound.knowledge.workspace.space();
      return scoped.ok ? { ok: true, value: todayIn(scoped.value.timezone), limits: [] } : scoped;
    }),
    recordSource: (source, date) => operations.dailyRecord("Saved", source, date),
    checkpointRead: key => withBinding(bound => bound.knowledge.checkpoints.read(key)),
    checkpointSave: (key, content, expected) => withBinding(async bound => {
      const guard = await writeGuard(bound, expected);
      return guard.ok ? bound.knowledge.checkpoints.save(key, content, guard.value) : guard;
    }),
    sourcesQuery: query => withBinding(bound => bound.knowledge.sources.query(query)),
    sourcesRead: (ref, options) => withBinding(bound => bound.knowledge.sources.read(ref, options)),
    sourcesCreate: input => operations.sourcesCreate({ ...input, recordInDaily: false }),
    sourcesUpdate: (ref, edits, expected) => operations.sourcesUpdate({ ref, edits, ...(expected !== undefined ? { expected } : {}) }),
    wikisCreate: input => operations.wikisCreate(input),
    wikisUpdate: (ref, update, expected) => operations.wikisUpdate({ ref, ...update, ...(expected !== undefined ? { expected } : {}) }),
    tasksCreate: input => operations.tasksCreate(input) as Promise<Result<CreateReceipt<TaskRef>>>,
    linksAdd: link => operations.linksManage({ action: "add", links: [link] }) as Promise<Result<WriteReceipt>>,
    async inspect(ref) {
      const result = ref.kind === "Area" ? await withBinding(bound => bound.knowledge.areas.read(ref))
        : ref.kind === "Project" ? await withBinding(bound => bound.knowledge.projects.read(ref))
        : ref.kind === "Task" ? await withBinding(bound => bound.knowledge.tasks.read(ref))
        : ref.kind === "Source" ? await withBinding(bound => bound.knowledge.sources.read(ref))
        : ref.kind === "Wiki" ? await withBinding(bound => bound.knowledge.wikis.read(ref))
        : await withBinding(bound => bound.knowledge.outputs.read(ref));
      return result.ok ? { ok: true, value: { coverage: result.value.coverage, ...(result.value.version ? { version: result.value.version } : {}) }, limits: result.limits } : result;
    },
  });

  return {
    ...operations,
    sessionsNext: (input: SessionNextInput) => sessions.next(input),
    sessionsApply: (input: SessionApplyInput) => sessions.apply(input),
    closeSessions: sessions.close,
  };
}

export type Operations = ReturnType<typeof createOperations>;
