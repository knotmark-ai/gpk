import type { CraftKnowledgeAdapter, LayoutInspection, LayoutPlan } from "../adapters/craft.js";
import type { ConnectionStatus, CraftConnection } from "../adapters/craft-connection.js";
import type { AreaRef, AreaState, OutputRef, ProjectRef, ProjectState, Ref, SourceRef, TaskRef, TaskState, WikiRef } from "../domain/entities.js";
import type {
  AreaInput, CaptureRef, CaptureSurface, CaptureSurfaceRef, KnowledgeLink, OutputInput, ProjectInput, ProjectMaterial, ProjectMaterialRef,
  SourceInput, TaskInput, TaskQuery, TextEdit, WikiInput,
} from "../domain/knowledge-backend-port.js";
import type { ControlGrant, CreateReceipt, Failure, GrantedWriteGuard, Result, Version, WriteReceipt } from "../domain/operation-types.js";
import type { KnowledgeBackendConfiguration, KnowledgeLayout, SettingsChanges, UserControlPort } from "../domain/user-control-port.js";
import { reviewInventory, todayIn, type ReviewCadence } from "./review.js";

/** The active knowledge binding, resolved by bootstrap from current Settings. */
export type KnowledgeBinding = {
  backendId: string; endpoint: string; secretKey: string;
  connection: CraftConnection; knowledge: CraftKnowledgeAdapter;
  /** Layout locations from current Settings; null before Setup. */
  layout: () => Promise<Result<KnowledgeLayout["locations"] | null>>;
};

export type OperationsOptions = {
  controlRoot: string;
  control: UserControlPort;
  /** Active backend from Settings; fails until Setup initialized them. */
  binding: () => Promise<Result<KnowledgeBinding>>;
  /** Same when Settings exist, else the default Craft endpoint; for Setup and diagnostics. */
  setupBinding: () => Promise<Result<KnowledgeBinding>>;
};

export type SetupInspection = {
  controlRoot: string;
  settings: RuntimeStatus["settings"];
  onboarding: OnboardingState;
  preferences?: { workingLanguage: string; metadataLanguage: string; timezone: string | null };
  backend?: { id: string; endpoint: string };
  connection: ConnectionStatus;
  layout?: LayoutInspection;
  grants: number;
};

export type SetupPlan = Omit<LayoutPlan, "metadataLanguage"> & {
  preferences?: { workingLanguage?: string; metadataLanguage?: "en" | "zh-CN"; timezone?: string | null };
};

/** One grant the user ticked on the onboarding page: a root from the proposal and a subset of its operations. */
export type GrantSelection = { root: string; operations: string[] };

/**
 * Onboarding is complete once Settings exist and at least one grant is persisted.
 * Until then knowledge work is refused and the Agent is sent to `gpk_setup_open`.
 */
export type OnboardingState = "required" | "complete";

export type RuntimeStatus = {
  stage: "review-slice";
  controlRoot: string;
  settings: "uninitialized" | "ready" | "invalid" | "unavailable";
  onboarding: OnboardingState;
  backend?: { id: string; endpoint: string };
  connection?: ConnectionStatus;
  implemented: string[];
};

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

/**
 * Protocol-independent handlers. Each knowledge mutation resolves its grant from
 * the control store here and hands the record to the adapter, which re-checks
 * containment. Tool arguments never carry authorization.
 */
export function createOperations(options: OperationsOptions) {
  const { control, controlRoot, binding, setupBinding } = options;

  function defaultGrants(backendId: string, scope: string, layout: KnowledgeBackendConfiguration["layout"]["locations"]): ControlGrant[] {
    const taskOps = ["tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject"];
    return [
      { backendId, root: { scope, id: "daily-notes" }, operations: ["tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject", "links.add"], unattended: false },
      { backendId, root: { scope, id: "inbox" }, operations: ["tasks.update", "tasks.transition", "tasks.schedule", "captures.append", "links.add"], unattended: false },
      // Checkpoints live in the GPK System page of the host document; `system` names that root.
      { backendId, root: { scope, id: "system" }, operations: ["checkpoints.save"], unattended: false },
      { backendId, root: layout.project, operations: ["projects.create", "projects.update", "projects.transition", "projects.assignArea", "projects.orderTasks", "projects.materials.append", "projects.materials.update", ...taskOps, "links.add"], unattended: false },
      { backendId, root: layout.area, operations: ["areas.create", "areas.update", "areas.transition", "links.add"], unattended: false },
      { backendId, root: layout.source, operations: ["sources.create", "sources.update", "links.add"], unattended: false },
      { backendId, root: layout.wiki, operations: ["wikis.create", "wikis.update", "links.add"], unattended: false },
      { backendId, root: layout.output, operations: ["outputs.create", "outputs.update", "links.add"], unattended: false },
    ];
  }

  async function grantFor(backendId: string, operation: string, rootKeys: string[], scope: string): Promise<Result<ControlGrant>> {
    const grants = await control.grants.list();
    if (!grants.ok) return grants;
    if (grants.value.coverage !== "complete") return failure("unavailable", "The grant store could not be read completely.", "Repair the grant store before writing.");
    const match = grants.value.items.map(item => item.value).find(grant =>
      grant.backendId === backendId && grant.operations.includes(operation) &&
      grant.root.scope === scope && rootKeys.includes(grant.root.id));
    if (!match) return failure("unauthorized", `No grant in ${controlRoot} covers ${operation} on ${rootKeys.join(" or ")}.`, "Call gpk_setup_open; the user grants operations on the onboarding page, then retry.");
    return { ok: true, value: match, limits: [] };
  }

  async function guardForTask(bound: KnowledgeBinding, operation: string, ref: TaskRef, expected?: Version): Promise<Result<GrantedWriteGuard>> {
    const container = await bound.knowledge.containerOf(ref);
    if (!container.ok) return container;
    const keys = container.value.kind === "daily-note" ? [container.value.key, "daily-notes"] : [container.value.key];
    const grant = await grantFor(bound.backendId, operation, keys, ref.scope);
    if (!grant.ok) return grant;
    return { ok: true, value: expected === undefined ? { grant: grant.value } : { grant: grant.value, expected }, limits: [] };
  }

  const roleOf: Record<Exclude<KnowledgeLink["from"]["kind"], "Task">, keyof KnowledgeLayout["locations"]> = { Area: "area", Project: "project", Source: "source", Wiki: "wiki", Output: "output" };
  async function guardForLink(bound: KnowledgeBinding, operation: string, from: KnowledgeLink["from"], expected?: Version): Promise<Result<GrantedWriteGuard>> {
    if (from.kind === "Task") return guardForTask(bound, operation, from, expected);
    return guardForLocation(bound, roleOf[from.kind], operation, from.scope, expected);
  }

  async function onboardingState(): Promise<OnboardingState> {
    const settings = await control.settings.read();
    if (!settings.ok || settings.value === null) return "required";
    const grants = await control.grants.list();
    return grants.ok && grants.value.items.length > 0 ? "complete" : "required";
  }

  async function withBinding<T>(run: (bound: KnowledgeBinding) => Promise<Result<T>>): Promise<Result<T>> {
    const bound = await binding();
    return bound.ok ? run(bound.value) : bound;
  }

  /** Grant for an operation on one layout location (a Collection or a folder). */
  type LocationRole = keyof KnowledgeLayout["locations"];
  async function guardForLocation(bound: KnowledgeBinding, role: LocationRole, operation: string, scope: string, expected?: Version): Promise<Result<GrantedWriteGuard>> {
    const layout = await bound.layout();
    if (!layout.ok) return layout;
    if (!layout.value || layout.value[role].id === "unset") return failure("unavailable", `The ${role} location is not configured.`, "Call gpk_setup_open and let the user finish onboarding in the browser.");
    const grant = await grantFor(bound.backendId, operation, [layout.value[role].id], scope);
    if (!grant.ok) return grant;
    return { ok: true, value: expected === undefined ? { grant: grant.value } : { grant: grant.value, expected }, limits: [] };
  }
  const guardedByLocation = <T>(role: LocationRole, operation: string, scope: string, expected: Version | undefined, run: (bound: KnowledgeBinding, guard: GrantedWriteGuard) => Promise<Result<T>>) =>
    withBinding(async bound => {
      const guard = await guardForLocation(bound, role, operation, scope, expected);
      return guard.ok ? run(bound, guard.value) : guard;
    });

  return {
    async runtimeStatus(): Promise<Result<RuntimeStatus>> {
      const implemented = [
        "connection.status", "connection.authorize", "setup.inspect", "setup.establish", "setup.proposeGrants",
        "control.settings.read", "control.settings.initialize", "control.settings.update", "control.grants.list", "control.grants.grant", "control.grants.revoke",
        "captures.resolve", "captures.list", "captures.read",
        "tasks.resolve", "tasks.read", "tasks.query", "tasks.create", "tasks.update", "tasks.transition", "tasks.schedule", "tasks.assignProject",
        "areas.resolve", "areas.read", "areas.query", "areas.create", "areas.update", "areas.transition",
        "projects.resolve", "projects.read", "projects.query", "projects.create", "projects.update", "projects.transition", "projects.assignArea", "projects.orderTasks",
        "projects.materials.list", "projects.materials.read", "projects.materials.append", "projects.materials.update",
        "sources.resolve", "sources.read", "sources.query", "sources.create", "sources.update",
        "wikis.resolve", "wikis.read", "wikis.query", "wikis.create", "wikis.update",
        "outputs.resolve", "outputs.read", "outputs.query", "outputs.create", "outputs.update",
        "links.query", "links.add", "links.remove", "checkpoints.read", "checkpoints.save",
        "review.inventory",
      ];
      const settings = await control.settings.read();
      const status: RuntimeStatus = {
        stage: "review-slice", controlRoot,
        settings: !settings.ok ? (settings.error.code === "invalid" ? "invalid" : "unavailable") : settings.value === null ? "uninitialized" : "ready",
        onboarding: await onboardingState(),
        implemented,
      };
      const bound = await setupBinding();
      if (bound.ok) {
        if (status.settings === "ready") status.backend = { id: bound.value.backendId, endpoint: bound.value.endpoint };
        status.connection = await bound.value.connection.status();
      }
      const limits = ["Settings and secret presence only; no Craft request is made by this diagnostic."];
      if (status.onboarding === "required") limits.unshift("Onboarding is not complete: call gpk_setup_open and let the user finish it in the browser before any other GPK work.");
      return { ok: true, value: status, limits };
    },
    connectionStatus: async (): Promise<Result<ConnectionStatus>> => {
      const bound = await setupBinding();
      return bound.ok ? { ok: true, value: await bound.value.connection.status(), limits: bound.limits } : bound;
    },
    connectionAuthorize: async (returnTo?: string) => {
      const bound = await setupBinding();
      return bound.ok ? bound.value.connection.authorize(returnTo) : bound;
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
        const { workingLanguage, metadataLanguage, timezone } = settings.value.value.preferences;
        inspection.preferences = { workingLanguage, metadataLanguage, timezone };
      }
      if (settings.ok && settings.value) inspection.backend = { id: bound.value.backendId, endpoint: bound.value.endpoint };
      const limits = [...bound.limits];
      if (connection.tokens === "verified") {
        const active = settings.ok && settings.value ? settings.value.value.knowledgeBackend.configurations.find(c => c.id === settings.value!.value.knowledgeBackend.activeId) : undefined;
        const layout = await bound.value.knowledge.layout.inspect(active?.layout.locations);
        if (layout.ok) { inspection.layout = layout.value; limits.push(...layout.limits); }
        else limits.push(`Layout inspection failed: ${layout.error.message}`);
      } else {
        limits.push("Layout was not inspected because Craft is not authorized yet.");
      }
      return { ok: true, value: inspection, limits };
    },
    async setupEstablish(plan: SetupPlan): Promise<Result<{ locations: KnowledgeBackendConfiguration["layout"]["locations"]; created: Ref[]; adopted: Ref[]; settings: WriteReceipt }>> {
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const scoped = await bound.value.connection.space();
      if (!scoped.ok) return scoped;
      const { preferences, ...layoutPlan } = plan;
      const settingsForDefaults = await control.settings.read();
      const configured = settingsForDefaults.ok && settingsForDefaults.value ? settingsForDefaults.value.value.preferences.metadataLanguage : "en";
      const metadataLanguage = preferences?.metadataLanguage ?? (configured === "zh-CN" ? "zh-CN" : "en");
      const established = await bound.value.knowledge.layout.establish({ ...layoutPlan, metadataLanguage });
      if (!established.ok) return established;
      const current = await control.settings.read();
      if (!current.ok) return current;
      const configuration: KnowledgeBackendConfiguration = {
        id: bound.value.backendId, adapter: "craft", instance: scoped.value.id,
        connection: { kind: "mcp", transport: "http", endpoint: { kind: "public-url", url: bound.value.endpoint }, credentialsRef: bound.value.secretKey },
        layout: { locations: established.value.locations },
      };
      let settings: Result<WriteReceipt>;
      const limits = [...established.limits];
      if (current.value === null) {
        settings = await control.settings.initialize({ knowledgeBackend: { activeId: configuration.id, configurations: [configuration] }, ...(preferences ? { preferences } : {}) }, {});
      } else {
        const existing = current.value.value.knowledgeBackend;
        const selection = { activeId: configuration.id, configurations: [configuration, ...existing.configurations.filter(c => c.id !== configuration.id)] };
        const changes: SettingsChanges = {};
        if (JSON.stringify(selection) !== JSON.stringify(existing)) changes.knowledgeBackend = selection;
        if (preferences) changes.preferences = preferences;
        if (Object.keys(changes).length === 0) {
          limits.push("Settings already described this layout; nothing was written.");
          settings = { ok: true, value: { affected: [current.value.ref], verified: true, version: current.value.version! }, limits: [] };
        } else {
          settings = await control.settings.update(changes, { expected: current.value.version! });
        }
      }
      if (!settings.ok) return { ok: false, error: { ...settings.error, code: "partial", affected: [...established.value.created, ...settings.error.affected], next: `Craft structures exist but Settings were not written: ${settings.error.next}` } };
      return { ok: true, value: { ...established.value, settings: settings.value }, limits };
    },
    async setupProposeGrants(): Promise<Result<ControlGrant[]>> {
      const bound = await binding();
      if (!bound.ok) return bound;
      const settings = await control.settings.read();
      if (!settings.ok || settings.value === null) return failure("unavailable", "Settings are not initialized.", "Call gpk_setup_open and let the user finish onboarding in the browser.");
      const active = settings.value.value.knowledgeBackend.configurations.find(c => c.id === settings.value!.value.knowledgeBackend.activeId)!;
      return { ok: true, value: defaultGrants(active.id, active.instance, active.layout.locations), limits: ["Default set: non-destructive operations only; remove, archive and restore are never proposed."] };
    },
    async grantsGrant(grants: ControlGrant[]): Promise<Result<CreateReceipt<Ref>[]>> {
      // Validate the whole batch against the port inventory before writing any of it.
      const bound = await setupBinding();
      if (!bound.ok) return bound;
      const inventory = await bound.value.knowledge.capabilities();
      if (!inventory.ok) return inventory;
      const known = new Set(Object.keys(inventory.value).filter(key => !key.includes(".query.")));
      const unknown = grants.flatMap(grant => grant.operations.filter(op => !known.has(op)));
      if (unknown.length) return failure("invalid", `Unknown operation IDs: ${[...new Set(unknown)].join(", ")}.`, "Grant only port operations; see gpk_knowledge_capabilities for the inventory.");
      const receipts: CreateReceipt<Ref>[] = [];
      for (const grant of grants) {
        const receipt = await control.grants.grant(grant, {});
        if (!receipt.ok) return receipts.length ? { ok: false, error: { ...receipt.error, code: "partial", affected: receipts.map(r => r.created), next: `${receipts.length} grants were written before this failure; list grants before retrying.` } } : receipt;
        receipts.push(receipt.value);
      }
      return { ok: true, value: receipts, limits: [] };
    },
    /**
     * Persist grants the user ticked on the onboarding page. Each selection must name a
     * root of the current proposal and a subset of its operations, so the page cannot
     * widen authority; grants already present with the same operations are skipped.
     */
    async setupGrant(selection: GrantSelection[]): Promise<Result<{ written: number; skipped: number }>> {
      const proposal = await this.setupProposeGrants();
      if (!proposal.ok) return proposal;
      const chosen: ControlGrant[] = [];
      for (const item of selection) {
        const proposed = proposal.value.find(grant => grant.root.id === item.root);
        if (!proposed) return failure("invalid", `Root ${item.root} is not in the proposal.`, "Reload the onboarding page and choose from the proposed grants.");
        const extra = item.operations.filter(op => !proposed.operations.includes(op));
        if (extra.length) return failure("invalid", `Operations outside the proposal for ${item.root}: ${extra.join(", ")}.`, "Choose only proposed operations.");
        if (item.operations.length) chosen.push({ ...proposed, operations: proposed.operations.filter(op => item.operations.includes(op)) });
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
      return { ok: true, value: { written: missing.length, skipped: chosen.length - missing.length }, limits: [] };
    },
    grantsRevoke: (ref: Ref, expected?: Version) => control.grants.revoke(ref, expected === undefined ? {} : { expected }),
    settingsUpdate: (changes: SettingsChanges, expected?: Version) => control.settings.update(changes, expected === undefined ? {} : { expected }),
    knowledgeCapabilities: () => withBinding(bound => bound.knowledge.capabilities()),
    controlCapabilities: () => control.capabilities(),
    settingsRead: (readOptions: Parameters<UserControlPort["settings"]["read"]>[0]) => control.settings.read(readOptions),
    grantsList: () => control.grants.list(),
    capturesResolve: (surface: CaptureSurface) => withBinding(bound => bound.knowledge.captures.resolve(surface)),
    capturesList: (surface: CaptureSurfaceRef) => withBinding(bound => bound.knowledge.captures.list(surface)),
    capturesRead: (ref: CaptureRef) => withBinding(bound => bound.knowledge.captures.read(ref)),
    tasksResolve: (locator: string) => withBinding(bound => bound.knowledge.tasks.resolve(locator)),
    tasksRead: (ref: TaskRef) => withBinding(bound => bound.knowledge.tasks.read(ref)),
    tasksQuery: (query: TaskQuery) => withBinding(bound => bound.knowledge.tasks.query(query)),
    tasksCreate: (input: TaskInput) => withBinding(async bound => {
      const scoped = await bound.connection.space();
      if (!scoped.ok) return scoped;
      if (input.project) {
        const guard = await guardForLocation(bound, "project", "tasks.create", scoped.value.id);
        return guard.ok ? bound.knowledge.tasks.create(input, guard.value) : guard;
      }
      const grant = await grantFor(bound.backendId, "tasks.create", ["daily-notes"], scoped.value.id);
      if (!grant.ok) return grant;
      return bound.knowledge.tasks.create(input, { grant: grant.value });
    }),
    // Ownership moves are authorized on the destination root; the adapter rejects sources outside GPK's locations.
    tasksAssignProject: (ref: TaskRef, project: ProjectRef | null, reason: string, expected?: Version) => withBinding(async bound => {
      if (project) {
        const guard = await guardForLocation(bound, "project", "tasks.assignProject", ref.scope, expected);
        return guard.ok ? bound.knowledge.tasks.assignProject(ref, project, reason, guard.value) : guard;
      }
      const grant = await grantFor(bound.backendId, "tasks.assignProject", ["daily-notes"], ref.scope);
      if (!grant.ok) return grant;
      return bound.knowledge.tasks.assignProject(ref, null, reason, expected === undefined ? { grant: grant.value } : { grant: grant.value, expected });
    }),
    areasResolve: (locator: string) => withBinding(bound => bound.knowledge.areas.resolve(locator)),
    areasRead: (ref: AreaRef) => withBinding(bound => bound.knowledge.areas.read(ref)),
    areasCreate: (input: AreaInput) => withBinding(async bound => {
      const scoped = await bound.connection.space();
      if (!scoped.ok) return scoped;
      const guard = await guardForLocation(bound, "area", "areas.create", scoped.value.id);
      return guard.ok ? bound.knowledge.areas.create(input, guard.value) : guard;
    }),
    areasUpdate: (ref: AreaRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("area", "areas.update", ref.scope, expected, (bound, guard) => bound.knowledge.areas.update(ref, update, guard)),
    areasTransition: (ref: AreaRef, state: AreaState, reason: string, expected?: Version) =>
      guardedByLocation("area", "areas.transition", ref.scope, expected, (bound, guard) => bound.knowledge.areas.transition(ref, state, reason, guard)),
    projectsResolve: (locator: string) => withBinding(bound => bound.knowledge.projects.resolve(locator)),
    projectsRead: (ref: ProjectRef) => withBinding(bound => bound.knowledge.projects.read(ref)),
    projectsCreate: (input: ProjectInput) => withBinding(async bound => {
      const scoped = await bound.connection.space();
      if (!scoped.ok) return scoped;
      const guard = await guardForLocation(bound, "project", "projects.create", scoped.value.id);
      return guard.ok ? bound.knowledge.projects.create(input, guard.value) : guard;
    }),
    projectsUpdate: (ref: ProjectRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("project", "projects.update", ref.scope, expected, (bound, guard) => bound.knowledge.projects.update(ref, update, guard)),
    projectsTransition: (ref: ProjectRef, state: ProjectState, reason: string, expected?: Version) =>
      guardedByLocation("project", "projects.transition", ref.scope, expected, (bound, guard) => bound.knowledge.projects.transition(ref, state, reason, guard)),
    projectsAssignArea: (ref: ProjectRef, area: AreaRef, reason: string, expected?: Version) =>
      guardedByLocation("project", "projects.assignArea", ref.scope, expected, (bound, guard) => bound.knowledge.projects.assignArea(ref, area, reason, guard)),
    projectsOrderTasks: (ref: ProjectRef, tasks: TaskRef[], expected?: Version) =>
      guardedByLocation("project", "projects.orderTasks", ref.scope, expected, (bound, guard) => bound.knowledge.projects.orderTasks(ref, tasks, guard)),
    materialsList: (project: ProjectRef) => withBinding(bound => bound.knowledge.projects.materials.list(project)),
    materialsRead: (ref: ProjectMaterialRef) => withBinding(bound => bound.knowledge.projects.materials.read(ref)),
    materialsAppend: (project: ProjectRef, material: ProjectMaterial, expected?: Version) =>
      guardedByLocation("project", "projects.materials.append", project.scope, expected, (bound, guard) => bound.knowledge.projects.materials.append(project, material, guard)),
    materialsUpdate: (ref: ProjectMaterialRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("project", "projects.materials.update", ref.scope, expected, (bound, guard) => bound.knowledge.projects.materials.update(ref, update, guard)),
    sourcesResolve: (locator: string) => withBinding(bound => bound.knowledge.sources.resolve(locator)),
    sourcesRead: (ref: SourceRef) => withBinding(bound => bound.knowledge.sources.read(ref)),
    sourcesCreate: (input: SourceInput) => withBinding(async bound => {
      const scoped = await bound.connection.space(); if (!scoped.ok) return scoped;
      const guard = await guardForLocation(bound, "source", "sources.create", scoped.value.id);
      return guard.ok ? bound.knowledge.sources.create(input, guard.value) : guard;
    }),
    sourcesUpdate: (ref: SourceRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("source", "sources.update", ref.scope, expected, (bound, guard) => bound.knowledge.sources.update(ref, update, guard)),
    wikisResolve: (locator: string) => withBinding(bound => bound.knowledge.wikis.resolve(locator)),
    wikisRead: (ref: WikiRef) => withBinding(bound => bound.knowledge.wikis.read(ref)),
    wikisCreate: (input: WikiInput) => withBinding(async bound => {
      const scoped = await bound.connection.space(); if (!scoped.ok) return scoped;
      const guard = await guardForLocation(bound, "wiki", "wikis.create", scoped.value.id);
      return guard.ok ? bound.knowledge.wikis.create(input, guard.value) : guard;
    }),
    wikisUpdate: (ref: WikiRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("wiki", "wikis.update", ref.scope, expected, (bound, guard) => bound.knowledge.wikis.update(ref, update, guard)),
    outputsResolve: (locator: string) => withBinding(bound => bound.knowledge.outputs.resolve(locator)),
    outputsRead: (ref: OutputRef) => withBinding(bound => bound.knowledge.outputs.read(ref)),
    outputsCreate: (input: OutputInput) => withBinding(async bound => {
      const scoped = await bound.connection.space(); if (!scoped.ok) return scoped;
      const guard = await guardForLocation(bound, "output", "outputs.create", scoped.value.id);
      return guard.ok ? bound.knowledge.outputs.create(input, guard.value) : guard;
    }),
    outputsUpdate: (ref: OutputRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) =>
      guardedByLocation("output", "outputs.update", ref.scope, expected, (bound, guard) => bound.knowledge.outputs.update(ref, update, guard)),
    linksQuery: (ref: KnowledgeLink["from"]) => withBinding(bound => bound.knowledge.links.query(ref)),
    // The grant follows the linking record: its Collection, folder, or the Task's container.
    linksAdd: (link: KnowledgeLink, expected?: Version) => withBinding(async bound => {
      const guard = await guardForLink(bound, "links.add", link.from, expected);
      return guard.ok ? bound.knowledge.links.add(link, guard.value) : guard;
    }),
    linksRemove: (link: KnowledgeLink, expected?: Version) => withBinding(async bound => {
      const guard = await guardForLink(bound, "links.remove", link.from, expected);
      return guard.ok ? bound.knowledge.links.remove(link, guard.value) : guard;
    }),
    reviewInventory: (cadence: ReviewCadence, horizonDays?: number) => withBinding(async bound => {
      const scoped = await bound.connection.space();
      if (!scoped.ok) return scoped;
      return reviewInventory(bound.knowledge, cadence, todayIn(scoped.value.timezone), horizonDays);
    }),
    checkpointsRead: (key: string) => withBinding(bound => bound.knowledge.checkpoints.read(key)),
    checkpointsSave: (key: string, content: string, expected?: Version) => withBinding(async bound => {
      const grant = await grantFor(bound.backendId, "checkpoints.save", ["system"], (await bound.connection.space()).ok ? ((await bound.connection.space()) as { value: { id: string } }).value.id : "");
      if (!grant.ok) return grant;
      return bound.knowledge.checkpoints.save(key, content, expected === undefined ? { grant: grant.value } : { grant: grant.value, expected });
    }),
    tasksUpdate: (ref: TaskRef, update: { title?: string; edits?: TextEdit[] }, expected?: Version) => withBinding(async bound => {
      const guard = await guardForTask(bound, "tasks.update", ref, expected);
      return guard.ok ? bound.knowledge.tasks.update(ref, update, guard.value) : guard;
    }),
    tasksTransition: (ref: TaskRef, state: TaskState, reason: string, expected?: Version) => withBinding(async bound => {
      const guard = await guardForTask(bound, "tasks.transition", ref, expected);
      return guard.ok ? bound.knowledge.tasks.transition(ref, state, reason, guard.value) : guard;
    }),
    tasksSchedule: (ref: TaskRef, time: string | null, expected?: Version) => withBinding(async bound => {
      const guard = await guardForTask(bound, "tasks.schedule", ref, expected);
      return guard.ok ? bound.knowledge.tasks.schedule(ref, time, guard.value) : guard;
    }),
    areasQuery: (query: Parameters<CraftKnowledgeAdapter["areas"]["query"]>[0]) => withBinding(bound => bound.knowledge.areas.query(query)),
    projectsQuery: (query: Parameters<CraftKnowledgeAdapter["projects"]["query"]>[0]) => withBinding(bound => bound.knowledge.projects.query(query)),
    sourcesQuery: (query: Parameters<CraftKnowledgeAdapter["sources"]["query"]>[0]) => withBinding(bound => bound.knowledge.sources.query(query)),
    wikisQuery: (query: Parameters<CraftKnowledgeAdapter["wikis"]["query"]>[0]) => withBinding(bound => bound.knowledge.wikis.query(query)),
    outputsQuery: (query: Parameters<CraftKnowledgeAdapter["outputs"]["query"]>[0]) => withBinding(bound => bound.knowledge.outputs.query(query)),
  };
}

export type Operations = ReturnType<typeof createOperations>;
