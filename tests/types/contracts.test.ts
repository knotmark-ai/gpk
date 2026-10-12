import type {
  AreaRef, Capabilities, CreateReceipt, KnowledgeBackendPort, Page, Project,
  KnowledgeBackendSelection, KnowledgeConnection, ProjectRef, Ref, Result, Snapshot,
  ControlGrant, GrantedWriteGuard, Source, Task, TaskRef, Template, TemplateRole, UserControlPort,
  UserSettings, Wiki, WikiRef, WriteGuard,
} from "../../src/index.js";
import type { KnowledgeBackendPort as BuiltKnowledgePort } from "../../dist/types/index.js";
import type { UserControlPort as BuiltControlPort } from "../../dist/types/index.js";

// Realistic consumers of both source and emitted API; no I/O is executed here.
declare const knowledge: KnowledgeBackendPort;
declare const control: UserControlPort;
const builtConsumer: BuiltKnowledgePort = knowledge;
const sourceConsumer: KnowledgeBackendPort = builtConsumer;
const builtControl: BuiltControlPort = control;
const sourceControl: UserControlPort = builtControl;
// Synthetic resolved references; real callers obtain them from providers, not casts.
const area: AreaRef = { kind: "Area", scope: "test-space", id: "area-1" };
const project: ProjectRef = { kind: "Project", scope: "test-space", id: "project-1" };
const task: TaskRef = { kind: "Task", scope: "test-space", id: "task-1" };
// Control mutations are authorized by the Setup session; knowledge mutations carry
// the grant the runtime resolved from the control store, never a caller string.
const guard: WriteGuard = { expected: "version-1" };
const createGuard: WriteGuard = {};
const grant: ControlGrant = {
  backendId: "primary", root: { scope: "test-space", id: "knowledge-root" },
  operations: ["projects.create", "tasks.create", "tasks.transition", "tasks.schedule", "tasks.assignProject",
    "sources.create", "outputs.create", "links.add", "checkpoints.save", "projects.assignArea",
    "projects.orderTasks", "projects.materials.append"],
  unattended: false,
};
const granted: GrantedWriteGuard = { grant, expected: "version-1" };
const createGranted: GrantedWriteGuard = { grant };
const controlRoot: Ref = { scope: "test-control", id: "control-root" };
const knowledgeRoot: Ref = { scope: "test-space", id: "knowledge-root" };
const profileWiki: WikiRef = { kind: "Wiki", scope: "test-space", id: "profile-wiki" };
const selectedBackend: KnowledgeBackendSelection = {
  activeId: "primary",
  configurations: [{
    id: "primary", adapter: "craft", instance: "test-space",
    connection: { kind: "mcp", transport: "http", endpoint: { kind: "secret-reference", ref: "craft-main-endpoint" } },
    layout: { locations: { area: knowledgeRoot, project: knowledgeRoot, source: knowledgeRoot, wiki: knowledgeRoot, output: knowledgeRoot } },
  }],
};

async function readCurrentTask() {
  const result = await sourceConsumer.tasks.read(task);
  if (!result.ok) return result.error.next;
  if (result.value.coverage !== "complete") return result.value.next;
  // A Task read already has Task data and a Task reference.
  const ref: TaskRef = result.value.ref;
  const state: "todo" | "doing" | "waiting" | "done" | "canceled" | undefined = result.value.value.state;
  return { ref, state, project: result.value.value.project };
}

async function planProject() {
  const result = await knowledge.projects.create({ title: "Example", content: "Objective and KRs", state: "planned", primaryArea: area }, createGranted);
  if (!result.ok) return result.error.next;
  const createdProject: ProjectRef = result.value.created;
  await knowledge.tasks.create({ title: "Investigate", content: "", state: "todo", project: createdProject }, createGranted);
  const tasks = await knowledge.tasks.query({ project: createdProject, states: ["todo", "waiting"], time: { includeUnset: true } });
  if (tasks.ok && tasks.value.coverage === "complete") return tasks.value.items;
}

async function readProjectMaterial() {
  const result = await knowledge.projects.materials.list(project);
  if (!result.ok) return result.error.next;
  const item = result.value.items[0];
  if (!item) return result.value.coverage;
  // Discovery and individual-content continuation are separate operations.
  return knowledge.projects.materials.read(item.ref, { limit: 100 });
}

async function readCapture() {
  const surface = await knowledge.captures.resolve({ name: "inbox" });
  if (!surface.ok) return surface.error.next;
  const result = await knowledge.captures.list(surface.value);
  if (!result.ok) return result.error.next;
  const item = result.value.items[0];
  if (item) return knowledge.captures.read(item.ref);
  return result.value.coverage;
}

async function readLinkedProject() {
  const result = await knowledge.links.query(task);
  if (!result.ok) return result.error.next;
  const link = result.value.items[0];
  // Cross-entity links narrow to the concrete reference needed by the next operation.
  if (link?.to.kind === "Project") return knowledge.projects.read(link.to);
}

async function useControl() {
  const resources = await control.discover({ provider: "local-files", instance: "test", location: "/test/.gpk" });
  if (!resources.ok) return resources.error.next;
  if (resources.value.coverage !== "complete") return resources.value.next;
  const settings = await sourceControl.settings.read();
  if (!settings.ok) return settings.error.next;
  if (settings.value === null) {
    // Setup provides real placement/connection selection; other fields have declared defaults.
    return control.settings.initialize({ knowledgeBackend: selectedBackend }, createGuard);
  }
  if (settings.value.coverage !== "complete") return settings.value.coverage;
  const current = settings.value.value;
  const active = current.knowledgeBackend.configurations.find(
    backend => backend.id === current.knowledgeBackend.activeId,
  );
  const templateRef = current.templates.project;
  if (!templateRef) return { active, bundledLanguage: current.preferences.metadataLanguage };
  const template = await control.templates.read(templateRef);
  if (template.ok && template.value.coverage === "complete" && template.value.value.role === "project") {
    return template.value.value.content;
  }
}

async function adoptTemplate() {
  const created = await control.templates.create({ role: "project", content: "# Project\n\n## Plan & Actions" }, createGuard);
  if (!created.ok || !created.value.verified) return created;
  // Creation and binding are separately verified effects, not one assumed transaction.
  return control.settings.update({ templates: { project: created.value.created } }, guard);
}

control.settings.update({ preferences: { workingLanguage: "zh-CN", metadataLanguage: "en", timezone: null, profileWiki, instructions: "Prefer concise explanations." } }, guard);
control.settings.update({ preferences: { profileWiki: null }, ingestion: { automatic: { enabled: false } } }, guard);
control.settings.read({ cursor: "settings-page", limit: 100 });
control.templates.read(controlRoot, { cursor: "template-page", limit: 100 });
control.templates.resolve("template-locator");
control.templates.update(controlRoot, { content: "Updated template body" }, guard);
control.settings.initialize({ knowledgeBackend: selectedBackend, templates: { area: controlRoot, wiki: null } }, createGuard);
control.settings.update({ templates: { area: null, task: controlRoot, source: controlRoot, wiki: controlRoot, output: controlRoot } }, guard);
const templateRoles: TemplateRole[] = ["area", "project", "task", "source", "wiki", "output"];
for (const role of templateRoles) control.templates.create({ role, content: "Role-appropriate content" }, createGuard);
const areaTemplate: Snapshot<Template> = {
  ref: controlRoot, coverage: "complete", value: { role: "area", content: "Direction and responsibilities" },
};
control.grants.list({ limit: 10 });
control.grants.grant({ backendId: "primary", root: knowledgeRoot, operations: ["tasks.create", "tasks.update"], unattended: false }, createGuard);
control.grants.revoke(controlRoot, guard);
const settingsRead: Snapshot<UserSettings> = {
  ref: controlRoot, coverage: "complete",
  value: {
    schemaVersion: 1,
    knowledgeBackend: selectedBackend,
    preferences: { workingLanguage: "en", metadataLanguage: "en", timezone: null, profileWiki: null, instructions: "" },
    templates: { area: null, project: null, task: null, source: null, wiki: null, output: null },
    ingestion: { automatic: { enabled: false, origins: [], dailyNotes: false } },
  },
};
const alternateConnection: KnowledgeConnection = { kind: "mcp", transport: "stdio", profileRef: "approved-local-profile" };
const apiConnection: KnowledgeConnection = { kind: "api", endpoint: { kind: "public-url", url: "https://example.invalid/api" }, credentialsRef: "api-login" };

knowledge.areas.query({ states: ["active"] });
knowledge.projects.query({ area, states: ["active"] });
knowledge.projects.assignArea(project, area, "Revised direction", granted);
knowledge.projects.orderTasks(project, [task], granted);
knowledge.projects.materials.append(project, { title: "Research", content: "Evidence", presentation: "child-document" }, granted);
knowledge.tasks.query({ project: null, time: { includeUnset: true }, cursor: "next" });
knowledge.tasks.create({ title: "Standalone", content: "", state: "todo" }, createGranted);
knowledge.tasks.transition(task, "done", "Verified result", granted);
knowledge.tasks.schedule(task, null, granted);
knowledge.tasks.assignProject(task, null, "Retain independently", granted);
knowledge.sources.create({ title: "Article", content: "Origin and actual access" }, createGranted);
knowledge.wikis.query({ relatedTo: project, text: "Topic" });
knowledge.outputs.create({ title: "Report", content: "Artifact reference" }, createGranted);
knowledge.captures.resolve({ name: "daily-notes", date: "2026-09-30" });
knowledge.links.add({ from: project, to: area, context: "Additional context" }, granted);
knowledge.checkpoints.read("ingest/example");
knowledge.checkpoints.save("ingest/example", "Verified progress", granted);
const unsupported: Result<Capabilities> = {
  ok: true, value: { "projects.query.states": { mode: "unsupported", limits: ["No transport"], evidence: [] } }, limits: [],
};
const partial: Page<Snapshot<Task, TaskRef>> = { items: [], coverage: "partial", next: "page-2" };
// An adapter returns identity once on ref; the Project body needs no duplicate kind.
const projectRead: Result<Snapshot<Project, ProjectRef>> = {
  ok: true,
  value: {
    ref: project,
    value: { title: "Example", content: "Objective and KRs", state: "planned", primaryArea: area },
    coverage: "complete",
  },
  limits: [],
};
const uncertain: Result<Snapshot<Task, TaskRef>> = {
  ok: false, error: { code: "uncertain", message: "Read interrupted", affected: [task], next: "Read current state" },
};
const created: CreateReceipt<TaskRef> = { created: task, affected: [task], verified: true };

// Domain boundaries: reference kind, ownership, lifecycle, time and guarded writes.
// @ts-expect-error Source has no lifecycle state
const sourceState: Source = { title: "Article", content: "", state: "done" };
// @ts-expect-error Project uses completed, not the Task state done
const projectState: Project = { title: "Example", content: "", state: "done" };
// @ts-expect-error only Tasks have the normalized planned time
const wikiTime: Wiki = { title: "Topic", content: "", time: "2026-09-30" };
// @ts-expect-error there is no Goal entity
knowledge.links.query({ kind: "Goal", scope: "test-space", id: "goal-1" });
// @ts-expect-error a continuation cannot claim complete discovery
const completePage: Page<Snapshot<Task, TaskRef>> = { items: [], coverage: "complete", next: "page-2" };
// @ts-expect-error failures cannot be disguised as successful empty reads
const unclassified: Result<Page<Snapshot<Task, TaskRef>>> = { ok: true, error: uncertain };
// @ts-expect-error creation receipts must identify the created reference
const missingCreated: CreateReceipt<TaskRef> = { affected: [task], verified: true };
// @ts-expect-error a Project create receipt cannot return a Task reference
const wrongCreated: CreateReceipt<ProjectRef> = { created: task, affected: [task], verified: true };
// @ts-expect-error generic unvalidated references are not entity references
knowledge.tasks.read({ scope: "test-space", id: "unknown" } satisfies Ref);
// @ts-expect-error Project references cannot be used to read Tasks
knowledge.tasks.read(project);
// @ts-expect-error Project creation requires one primary Area
knowledge.projects.create({ title: "Example", content: "", state: "planned" }, granted);
// @ts-expect-error primary Area must be an Area reference
knowledge.projects.create({ title: "Example", content: "", state: "planned", primaryArea: task }, granted);
// @ts-expect-error Task ownership is a Project, never a physical folder or Area
knowledge.tasks.assignProject(task, area, "Move", granted);
// @ts-expect-error a Project cannot clear its primary Area
knowledge.projects.assignArea(project, null, "Unassign", granted);
// @ts-expect-error Project state queries do not accept Task states
knowledge.projects.query({ states: ["done"] });
// @ts-expect-error Area state queries do not accept Project states
knowledge.areas.query({ states: ["planned"] });
// @ts-expect-error Project queries cannot filter by Task time
knowledge.projects.query({ time: { from: "2026-09-30" } });
// @ts-expect-error generic content updates cannot alter lifecycle fields
knowledge.projects.update(project, { state: "completed" }, granted);
// @ts-expect-error non-lifecycle entities have no transition operation
knowledge.sources.transition(area, "done", "Read", granted);
// @ts-expect-error Source creation has no lifecycle state parameter
knowledge.sources.create({ title: "Article", content: "", state: "done" }, createGranted);
// @ts-expect-error mutation requires explicit guard context
knowledge.tasks.remove(task);
// @ts-expect-error unsupported lifecycle literals must be rejected
knowledge.tasks.transition(task, "deferred", "Later", granted);
// @ts-expect-error undefined is not a clearing operation; null explicitly clears time
knowledge.tasks.schedule(task, undefined, granted);
// @ts-expect-error scheduling a Project as a Task is invalid
knowledge.tasks.schedule(project, "2026-09-30", granted);
// @ts-expect-error daily-note resolution requires the intended date
knowledge.captures.resolve({ name: "daily-notes" });
// @ts-expect-error control mutations also require explicit guard context
control.settings.update({ preferences: { workingLanguage: "en" } });
// @ts-expect-error no arbitrary key/value control surface remains
control.write("settings", { content: "test", mediaType: "text/plain" }, guard);
// @ts-expect-error resources are named operations, not arbitrary string keys
control.read("templates/project");
// @ts-expect-error onboarding requires a selected backend and explicit layout
control.settings.initialize({ preferences: { workingLanguage: "en" } }, createGuard);
// @ts-expect-error template creation requires explicit approval
control.templates.create({ role: "area", content: "Template" });
// @ts-expect-error all templates use the unified operation group
control.projectTemplates.read(controlRoot);
// @ts-expect-error template creation must declare its intended role
control.templates.create({ content: "Template" }, createGuard);
// @ts-expect-error roles do not create additional domain concepts
control.templates.create({ role: "goal", content: "Template" }, createGuard);
// @ts-expect-error content updates cannot change a template's declared use
control.templates.update(controlRoot, { role: "wiki", content: "Changed role" }, guard);
// @ts-expect-error template binding changes are named, not arbitrary key/value entries
control.settings.update({ templates: { review: controlRoot } }, guard);
// @ts-expect-error initialized reads materialize all six named bindings, including null defaults
const incompleteBindings: UserSettings["templates"] = { project: null };
// @ts-expect-error a template binding is a provider reference or null, not body text
control.settings.update({ templates: { source: "# Source" } }, guard);
// @ts-expect-error grants cannot be changed through ordinary settings
control.settings.update({ grants: [] }, guard);
// @ts-expect-error configuration has no independently mutable completed flag
control.settings.update({ onboardingCompleted: true }, guard);
// @ts-expect-error Settings has named nested preferences, not flattened arbitrary options
control.settings.update({ workingLanguage: "en" }, guard);
// @ts-expect-error language is a textual preference, not a boolean switch
control.settings.update({ preferences: { workingLanguage: true } }, guard);
// @ts-expect-error one language no longer covers both conversation and structural names
control.settings.update({ preferences: { language: "en" } }, guard);
// @ts-expect-error personal background references a Wiki, not a Project
control.settings.update({ preferences: { profileWiki: project } }, guard);
// @ts-expect-error personal facts stay in Knowledge Backend, not an embedded Profile
control.settings.update({ preferences: { profile: { capacity: 10 } } }, guard);
// @ts-expect-error connections carry credential references, not literal tokens
const leakedCredential: KnowledgeConnection = { kind: "api", endpoint: { kind: "public-url", url: "https://example.invalid/api" }, token: "secret" };
// @ts-expect-error secret endpoint references do not contain a literal URL
const wrongEndpoint: KnowledgeConnection = { kind: "mcp", transport: "http", endpoint: { kind: "secret-reference", url: "https://example.invalid" } };
// @ts-expect-error an HTTP MCP connection needs an explicit endpoint, not just an adapter name
const missingEndpoint: KnowledgeConnection = { kind: "mcp", transport: "http" };
// @ts-expect-error grant scopes cannot be widened by a bare allowWrite flag
control.grants.grant({ allowWrite: true }, createGuard);
// @ts-expect-error initialization/defaults are not a promise of automatic ingestion
control.settings.update({ ingestion: { automatic: { enabled: "yes" } } }, guard);
// @ts-expect-error no generic entity/block CRUD surface remains
knowledge.setState(task, "done", "Verified", granted);
// @ts-expect-error no generic cross-kind query remains
knowledge.query({ kinds: ["Project"], states: ["active"] });
// @ts-expect-error plugin hosts do not instantiate a TypeScript harness bridge
import type { AgentHarnessAdapter } from "../../src/index.js";
// @ts-expect-error retired harness types must also disappear from the build
import type { AgentHarnessAdapter as BuiltHarness } from "../../dist/types/index.js";
// @ts-expect-error User Control no longer exports arbitrary resource keys
import type { ControlKey } from "../../src/index.js";
// @ts-expect-error emitted contracts must not retain the generic KV resource payload
import type { ControlResource } from "../../dist/types/index.js";
// @ts-expect-error the Project-only template contract has been replaced
import type { ProjectTemplate } from "../../src/index.js";
// @ts-expect-error emitted contracts must not retain Project-only operations
import type { ProjectTemplateOperations } from "../../dist/types/index.js";

// @ts-expect-error Source queries do not acquire a lifecycle through a shared query shape
knowledge.sources.query({ states: ["active"] });

// Authorization is resolved by the runtime, not supplied by the caller.
// @ts-expect-error knowledge mutations need the runtime-resolved grant, not a bare revision guard
knowledge.tasks.transition(task, "done", "Verified result", guard);
// @ts-expect-error the grant is a resolved control record, never a caller-supplied string
knowledge.tasks.transition(task, "done", "Verified result", { grant: "grant-1" });
// @ts-expect-error no authority string survives in any guard
const legacyGuard: WriteGuard = { authority: "approved-request" };
// @ts-expect-error grants list operation IDs, not boolean write switches
const widened: ControlGrant = { backendId: "primary", root: grant.root, operations: ["*"], unattended: false, allowWrite: true };
