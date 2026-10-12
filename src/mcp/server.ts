import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Result } from "../domain/operation-types.js";
import type { Operations } from "../runtime/operations.js";
import type { OnboardingHandle } from "../onboarding/server.js";

const readOptions = {
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
};
const reference = z.strictObject({
  scope: z.string().min(1), id: z.string().min(1),
  kind: z.enum(["Area", "Project", "Task", "Source", "Wiki", "Output"]),
});
const query = {
  ...readOptions,
  text: z.string().optional(),
  relatedTo: reference.optional(),
};
const areaRef = reference.extend({ kind: z.literal("Area") });
const projectRef = reference.extend({ kind: z.literal("Project") });
const taskRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), kind: z.literal("Task") });
const date = z.iso.date();
const taskState = z.enum(["todo", "doing", "waiting", "done", "canceled"]);
const expected = z.string().min(1).optional();
const textEdit = z.strictObject({ before: z.string().min(1), after: z.string() });
const captureSurface = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("inbox") }),
  z.strictObject({ name: z.literal("daily-notes"), date }),
]);
const captureSurfaceRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), role: z.literal("capture-surface") });
const plainRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1) });
const wikiRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), kind: z.literal("Wiki") });
const settingsChanges = z.strictObject({
  preferences: z.strictObject({
    workingLanguage: z.string().min(1).optional(), timezone: z.string().min(1).nullable().optional(),
    profileWiki: wikiRef.nullable().optional(), instructions: z.string().optional(),
  }).optional(),
  templates: z.strictObject({
    area: plainRef.nullable().optional(), project: plainRef.nullable().optional(), task: plainRef.nullable().optional(),
    source: plainRef.nullable().optional(), wiki: plainRef.nullable().optional(), output: plainRef.nullable().optional(),
  }).optional(),
  ingestion: z.strictObject({ automatic: z.strictObject({
    enabled: z.boolean().optional(), dailyNotes: z.boolean().optional(),
    origins: z.array(z.strictObject({
      id: z.string().min(1), reader: z.string().min(1), location: z.string().min(1), exclusions: z.array(z.string()),
      retention: z.enum(["summary", "excerpts", "full"]), instructions: z.string(),
    })).optional(),
  }) }).optional(),
});
const captureRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), role: z.literal("capture"), surface: captureSurfaceRef });

// JSON inputs cannot contain undefined. Preserve exact optional-property semantics
// at the Zod/Port boundary even for direct in-process calls.
function withoutUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>
  };
}
const taskTime = z.strictObject({
  from: date.optional(), to: date.optional(), includeUnset: z.boolean().optional(),
}).refine(value => !value.from || !value.to || value.from <= value.to, "from must not be after to")
  .transform(withoutUndefined);

function response(result: Result<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  };
}

/** Transport-neutral registration seam; a later HTTP entrypoint can reuse it. */
export function createGpkServer(operations: Operations, version: string, onboarding: OnboardingHandle) {
  const server = new McpServer({ name: "gpk", version });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const destructive = { ...mutating, destructiveHint: true };

  server.registerTool("gpk_runtime_status", {
    description: "Report the control root, Settings state, active backend and stored-credential state. Makes no Craft request.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.runtimeStatus()));
  server.registerTool("gpk_connection_status", {
    description: "Report GPK's own Craft authorization: registration, stored tokens, pending browser approval and the space once verified.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.connectionStatus()));
  server.registerTool("gpk_knowledge_capabilities", {
    description: "Report knowledge adapter capabilities per operation and predicate for the active backend.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.knowledgeCapabilities()));
  server.registerTool("gpk_control_capabilities", {
    description: "Report local User Control adapter capabilities.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.controlCapabilities()));
  server.registerTool("gpk_settings_read", {
    description: "Read current Settings from the control root. Null means never initialized; invalid files fail explicitly.",
    inputSchema: z.strictObject(readOptions), annotations: readOnly,
  }, async args => response(await operations.settingsRead(withoutUndefined(args))));
  server.registerTool("gpk_grants_list", {
    description: "List the persisted GPK grants in the control root. Writes are authorized only through these records.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.grantsList()));

  // Setup has one entry: the onboarding page. Connecting Craft, creating the layout and
  // granting permissions happen there by the user's own clicks; no tool writes them.
  server.registerTool("gpk_setup_open", {
    description: "Open GPK's onboarding page in the user's browser (connect a knowledge base, create the workspace structure, choose permissions, set languages). Required before any other GPK work when runtime status reports onboarding: required, and to reconnect Craft. Returns the page URL; show it if the browser did not open, then wait for the user and check gpk_setup_inspect.",
    inputSchema: z.strictObject({}), annotations: { ...mutating, openWorldHint: true },
  }, async () => response(await onboarding.open()));
  server.registerTool("gpk_setup_inspect", {
    description: "Setup diagnostics: control root, Settings state, Craft authorization, the configured layout's validity and adoptable Collections/folders. Works before Settings exist.",
    inputSchema: z.strictObject({}), annotations: readOnly,
  }, async () => response(await operations.setupInspect()));
  server.registerTool("gpk_grants_revoke", {
    description: "Revoke one grant by its reference from gpk_grants_list.",
    inputSchema: z.strictObject({ ref: plainRef, expected }), annotations: destructive,
  }, async args => response(await operations.grantsRevoke(args.ref, args.expected)));
  server.registerTool("gpk_settings_update", {
    description: "Apply named Settings changes (working language, timezone, instructions, template bindings, automatic ingestion). Layout, metadata language and grants change only on the onboarding page (gpk_setup_open).",
    inputSchema: z.strictObject({ changes: settingsChanges, expected }), annotations: mutating,
  }, async args => response(await operations.settingsUpdate(args.changes as Parameters<typeof operations.settingsUpdate>[0], args.expected)));

  server.registerTool("gpk_captures_resolve", {
    description: "Resolve a capture surface: the Craft Inbox or one Daily Note by date.",
    inputSchema: z.strictObject({ surface: captureSurface }), annotations: readOnly,
  }, async args => response(await operations.capturesResolve(args.surface)));
  server.registerTool("gpk_captures_list", {
    description: "List raw captures on a resolved surface. Inbox items are task action lines; Daily Note items are top-level blocks.",
    inputSchema: z.strictObject({ surface: captureSurfaceRef }), annotations: readOnly,
  }, async args => response(await operations.capturesList(args.surface)));
  server.registerTool("gpk_captures_read", {
    description: "Read one capture with its nested content.",
    inputSchema: z.strictObject({ ref: captureRef }), annotations: readOnly,
  }, async args => response(await operations.capturesRead(args.ref)));

  server.registerTool("gpk_tasks_resolve", {
    description: "Resolve a Task from a Craft block ID or link; fails unless the block is a task.",
    inputSchema: z.strictObject({ locator: z.string().min(1) }), annotations: readOnly,
  }, async args => response(await operations.tasksResolve(args.locator)));
  server.registerTool("gpk_tasks_read", {
    description: "Read one Task: title, body, state, planned time and the version to pass as expected on a later write.",
    inputSchema: z.strictObject({ ref: taskRef }), annotations: readOnly,
  }, async args => response(await operations.tasksRead(args.ref)));
  server.registerTool("gpk_tasks_query", {
    description: "Query Tasks through the knowledge adapter. The Agent, not this query, selects Focus. Needs a whole-space Craft connection.",
    inputSchema: z.strictObject({
      ...query, states: z.array(taskState).optional(),
      project: projectRef.nullable().optional(), time: taskTime.optional(),
    }), annotations: readOnly,
  }, async args => response(await operations.tasksQuery(withoutUndefined(args))));
  server.registerTool("gpk_tasks_create", {
    description: "Create a Task: standalone in today's Daily Note, or inside a Project row when project is given. Requires a tasks.create grant on that root.",
    inputSchema: z.strictObject({
      title: z.string().min(1), content: z.string().default(""), state: taskState.default("todo"), time: date.optional(),
      project: projectRef.optional(),
    }), annotations: mutating,
  }, async args => response(await operations.tasksCreate(withoutUndefined(args))));
  server.registerTool("gpk_tasks_update", {
    description: "Rename a Task or apply literal body edits. Pass expected from the last read to detect concurrent changes.",
    inputSchema: z.strictObject({
      ref: taskRef, title: z.string().min(1).optional(), edits: z.array(textEdit).min(1).optional(), expected,
    }).refine(value => value.title !== undefined || value.edits !== undefined, "supply title or edits"), annotations: mutating,
  }, async args => response(await operations.tasksUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_tasks_transition", {
    description: "Move a Task to todo, doing, waiting, done or canceled with a recorded reason. Does not complete the Project.",
    inputSchema: z.strictObject({ ref: taskRef, state: taskState, reason: z.string().min(1), expected }), annotations: destructive,
  }, async args => response(await operations.tasksTransition(args.ref, args.state, args.reason, args.expected)));
  server.registerTool("gpk_tasks_schedule", {
    description: "Set or clear a Task's single planned date. Null clears it; the state is unchanged.",
    inputSchema: z.strictObject({ ref: taskRef, time: date.nullable(), expected }), annotations: mutating,
  }, async args => response(await operations.tasksSchedule(args.ref, args.time, args.expected)));

  server.registerTool("gpk_tasks_assign_project", {
    description: "Move a Task into a Project (its row in the Projects Collection) or make it standalone in today's Daily Note (project: null), with a recorded reason.",
    inputSchema: z.strictObject({ ref: taskRef, project: projectRef.nullable(), reason: z.string().min(1), expected }), annotations: mutating,
  }, async args => response(await operations.tasksAssignProject(args.ref, args.project, args.reason, args.expected)));

  const areaState = z.enum(["active", "inactive"]);
  const projectState = z.enum(["planned", "active", "paused", "completed", "canceled"]);
  server.registerTool("gpk_areas_resolve", {
    description: "Resolve an Area row ID or Craft link to an Area reference.",
    inputSchema: z.strictObject({ locator: z.string().min(1) }), annotations: readOnly,
  }, async args => response(await operations.areasResolve(args.locator)));
  server.registerTool("gpk_areas_read", {
    description: "Read one Area: title, body, state and version.",
    inputSchema: z.strictObject({ ref: areaRef }), annotations: readOnly,
  }, async args => response(await operations.areasRead(args.ref)));
  server.registerTool("gpk_areas_create", {
    description: "Create an Area row in the Areas Collection with its initial body. Requires a grant on the Areas location.",
    inputSchema: z.strictObject({ title: z.string().min(1), content: z.string(), state: areaState }), annotations: mutating,
  }, async args => response(await operations.areasCreate(args)));
  server.registerTool("gpk_areas_update", {
    description: "Rename an Area or apply literal body edits.",
    inputSchema: z.strictObject({ ref: areaRef, title: z.string().min(1).optional(), edits: z.array(textEdit).min(1).optional(), expected })
      .refine(value => value.title !== undefined || value.edits !== undefined, "supply title or edits"), annotations: mutating,
  }, async args => response(await operations.areasUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_areas_transition", {
    description: "Move an Area between active and inactive with a recorded reason.",
    inputSchema: z.strictObject({ ref: areaRef, state: areaState, reason: z.string().min(1), expected }), annotations: destructive,
  }, async args => response(await operations.areasTransition(args.ref, args.state, args.reason, args.expected)));
  server.registerTool("gpk_projects_resolve", {
    description: "Resolve a Project row ID or Craft link to a Project reference.",
    inputSchema: z.strictObject({ locator: z.string().min(1) }), annotations: readOnly,
  }, async args => response(await operations.projectsResolve(args.locator)));
  server.registerTool("gpk_projects_read", {
    description: "Read one Project: title, body, state, primary Area and version. Its Tasks come from gpk_tasks_query with project.",
    inputSchema: z.strictObject({ ref: projectRef }), annotations: readOnly,
  }, async args => response(await operations.projectsRead(args.ref)));
  server.registerTool("gpk_projects_create", {
    description: "Create a Project row with state, primary Area and initial body (Objective, KRs, scope). Requires a grant on the Projects location.",
    inputSchema: z.strictObject({ title: z.string().min(1), content: z.string(), state: projectState, primaryArea: areaRef }), annotations: mutating,
  }, async args => response(await operations.projectsCreate(args)));
  server.registerTool("gpk_projects_update", {
    description: "Rename a Project or apply literal body edits.",
    inputSchema: z.strictObject({ ref: projectRef, title: z.string().min(1).optional(), edits: z.array(textEdit).min(1).optional(), expected })
      .refine(value => value.title !== undefined || value.edits !== undefined, "supply title or edits"), annotations: mutating,
  }, async args => response(await operations.projectsUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_projects_transition", {
    description: "Move a Project between planned, active, paused, completed and canceled with a recorded reason. Closing fails while Tasks are open.",
    inputSchema: z.strictObject({ ref: projectRef, state: projectState, reason: z.string().min(1), expected }), annotations: destructive,
  }, async args => response(await operations.projectsTransition(args.ref, args.state, args.reason, args.expected)));
  server.registerTool("gpk_projects_assign_area", {
    description: "Change a Project's primary Area with a recorded reason.",
    inputSchema: z.strictObject({ ref: projectRef, area: areaRef, reason: z.string().min(1), expected }), annotations: mutating,
  }, async args => response(await operations.projectsAssignArea(args.ref, args.area, args.reason, args.expected)));
  server.registerTool("gpk_projects_order_tasks", {
    description: "Reorder a Project's Tasks; the list must contain every current Task exactly once.",
    inputSchema: z.strictObject({ ref: projectRef, tasks: z.array(taskRef).min(1), expected }), annotations: mutating,
  }, async args => response(await operations.projectsOrderTasks(args.ref, args.tasks, args.expected)));
  const materialRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), role: z.literal("project-material"), project: projectRef });
  server.registerTool("gpk_materials_list", {
    description: "List a Project's process material (nested pages that are not Tasks).",
    inputSchema: z.strictObject({ project: projectRef }), annotations: readOnly,
  }, async args => response(await operations.materialsList(args.project)));
  server.registerTool("gpk_materials_read", {
    description: "Read one material page of a Project.",
    inputSchema: z.strictObject({ ref: materialRef }), annotations: readOnly,
  }, async args => response(await operations.materialsRead(args.ref)));
  server.registerTool("gpk_materials_append", {
    description: "Append material to a Project: an inline heading plus body, or a nested page.",
    inputSchema: z.strictObject({ project: projectRef, title: z.string().min(1), content: z.string(), presentation: z.enum(["inline", "child-document"]), expected }), annotations: mutating,
  }, async args => response(await operations.materialsAppend(args.project, { title: args.title, content: args.content, presentation: args.presentation }, args.expected)));
  server.registerTool("gpk_materials_update", {
    description: "Rename a material page or apply literal body edits.",
    inputSchema: z.strictObject({ ref: materialRef, title: z.string().min(1).optional(), edits: z.array(textEdit).min(1).optional(), expected })
      .refine(value => value.title !== undefined || value.edits !== undefined, "supply title or edits"), annotations: mutating,
  }, async args => response(await operations.materialsUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));

  const anyRef = reference;
  const linkInput = z.strictObject({ from: anyRef, to: anyRef, context: z.string().min(1) });
  const sourceRef = reference.extend({ kind: z.literal("Source") });
  const outputRef = reference.extend({ kind: z.literal("Output") });
  const documentUpdate = <R extends z.ZodType>(ref: R) => z.strictObject({ ref, title: z.string().min(1).optional(), edits: z.array(textEdit).min(1).optional(), expected })
    .refine(value => value.title !== undefined || value.edits !== undefined, "supply title or edits");
  const locator = z.strictObject({ locator: z.string().min(1) });
  const documentInput = z.strictObject({ title: z.string().min(1), content: z.string() });
  server.registerTool("gpk_sources_resolve", { description: "Resolve a Source document root ID or Craft link; the document must be in the Sources location.", inputSchema: locator, annotations: readOnly },
    async args => response(await operations.sourcesResolve(args.locator)));
  server.registerTool("gpk_sources_read", { description: "Read one Source: title, body (origin, access evidence, prepared material) and version.", inputSchema: z.strictObject({ ref: sourceRef }), annotations: readOnly },
    async args => response(await operations.sourcesRead(args.ref)));
  server.registerTool("gpk_sources_create", { description: "Create a Source document in the Sources folder with origin, access evidence and prepared material. Requires a grant on the source location.", inputSchema: documentInput, annotations: mutating },
    async args => response(await operations.sourcesCreate(args)));
  server.registerTool("gpk_sources_update", { description: "Rename a Source or apply literal body edits.", inputSchema: documentUpdate(sourceRef), annotations: mutating },
    async args => response(await operations.sourcesUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_wikis_resolve", { description: "Resolve a Wiki document root ID or Craft link; the document must be in the Wikis location.", inputSchema: locator, annotations: readOnly },
    async args => response(await operations.wikisResolve(args.locator)));
  server.registerTool("gpk_wikis_read", { description: "Read one Wiki: title, body and version.", inputSchema: z.strictObject({ ref: wikiRef }), annotations: readOnly },
    async args => response(await operations.wikisRead(args.ref)));
  server.registerTool("gpk_wikis_create", { description: "Create a Wiki document in the Wikis folder with its explanation. Requires a grant on the wiki location.", inputSchema: documentInput, annotations: mutating },
    async args => response(await operations.wikisCreate(args)));
  server.registerTool("gpk_wikis_update", { description: "Rename a Wiki or revise it with literal body edits; citations stay next to claims.", inputSchema: documentUpdate(wikiRef), annotations: mutating },
    async args => response(await operations.wikisUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_outputs_resolve", { description: "Resolve an Output document root ID or Craft link; the document must be in the Outputs location.", inputSchema: locator, annotations: readOnly },
    async args => response(await operations.outputsResolve(args.locator)));
  server.registerTool("gpk_outputs_read", { description: "Read one Output: title, body (artifact or its authoritative reference, producers) and version.", inputSchema: z.strictObject({ ref: outputRef }), annotations: readOnly },
    async args => response(await operations.outputsRead(args.ref)));
  server.registerTool("gpk_outputs_create", { description: "Create an Output document in the Outputs folder. Requires a grant on the output location.", inputSchema: documentInput, annotations: mutating },
    async args => response(await operations.outputsCreate(args)));
  server.registerTool("gpk_outputs_update", { description: "Rename an Output or apply literal body edits.", inputSchema: documentUpdate(outputRef), annotations: mutating },
    async args => response(await operations.outputsUpdate(args.ref, withoutUndefined({ title: args.title, edits: args.edits }), args.expected)));
  server.registerTool("gpk_links_query", {
    description: "Discover contextual links touching a record in both directions. Incoming links come from scanning every GPK record body.",
    inputSchema: z.strictObject({ ref: anyRef }), annotations: readOnly,
  }, async args => response(await operations.linksQuery(args.ref)));
  server.registerTool("gpk_links_add", {
    description: "Write a directed contextual link with its explanation into the linking record's body (under its Links heading, or as a Task child block). Does not change ownership.",
    inputSchema: z.strictObject({ link: linkInput, expected }), annotations: mutating,
  }, async args => response(await operations.linksAdd(args.link, args.expected)));
  server.registerTool("gpk_links_remove", {
    description: "Remove one contextual link line matching from, to and context. Needs a links.remove grant, which is never in the default set.",
    inputSchema: z.strictObject({ link: linkInput, expected }), annotations: destructive,
  }, async args => response(await operations.linksRemove(args.link, args.expected)));
  server.registerTool("gpk_review_inventory", {
    description: "Read the population for a daily, weekly or monthly review in one call: Inbox captures, overdue/today/upcoming/doing/waiting/unscheduled Tasks, Projects by state with attention signals, Areas with their Project counts, and what was not traversed. Read-only; decisions stay with the Agent.",
    inputSchema: z.strictObject({ cadence: z.enum(["daily", "weekly", "monthly"]), horizonDays: z.number().int().min(0).max(366).optional() }), annotations: readOnly,
  }, async args => response(await operations.reviewInventory(args.cadence, args.horizonDays)));
  server.registerTool("gpk_checkpoints_read", {
    description: "Read a workflow's processing checkpoint by logical key (for example ingest/<origin>); null when none exists.",
    inputSchema: z.strictObject({ key: z.string().min(1) }), annotations: readOnly,
  }, async args => response(await operations.checkpointsRead(args.key)));
  server.registerTool("gpk_checkpoints_save", {
    description: "Save a checkpoint after verifying the effect it records. Pass expected from the last read when replacing one.",
    inputSchema: z.strictObject({ key: z.string().min(1), content: z.string(), expected }), annotations: mutating,
  }, async args => response(await operations.checkpointsSave(args.key, args.content, args.expected)));

  server.registerTool("gpk_areas_query", {
    description: "Query Areas through the knowledge adapter; no default lifecycle filter.",
    inputSchema: z.strictObject({ ...query, states: z.array(z.enum(["active", "inactive"])).optional() }), annotations: readOnly,
  }, async args => response(await operations.areasQuery(withoutUndefined(args))));
  server.registerTool("gpk_projects_query", {
    description: "Query Projects through the knowledge adapter; no default lifecycle filter.",
    inputSchema: z.strictObject({
      ...query, states: z.array(z.enum(["planned", "active", "paused", "completed", "canceled"])).optional(),
      area: areaRef.optional(),
    }), annotations: readOnly,
  }, async args => response(await operations.projectsQuery(withoutUndefined(args))));
  server.registerTool("gpk_sources_query", {
    description: "Query Sources through the knowledge adapter.",
    inputSchema: z.strictObject(query), annotations: readOnly,
  }, async args => response(await operations.sourcesQuery(withoutUndefined(args))));
  server.registerTool("gpk_wikis_query", {
    description: "Query Wikis through the knowledge adapter.",
    inputSchema: z.strictObject(query), annotations: readOnly,
  }, async args => response(await operations.wikisQuery(withoutUndefined(args))));
  server.registerTool("gpk_outputs_query", {
    description: "Query Outputs through the knowledge adapter.",
    inputSchema: z.strictObject(query), annotations: readOnly,
  }, async args => response(await operations.outputsQuery(withoutUndefined(args))));
  return server;
}
