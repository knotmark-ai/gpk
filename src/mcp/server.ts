import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Result } from "../domain/operation-types.js";
import type { OnboardingHandle } from "../onboarding/server.js";
import { debug, debugEnabled, since } from "../runtime/debug-log.js";
import type {
  AreaCreateInput, AreaUpdateInput, CapturesGetInput, CheckpointsManageInput,
  LinksManageInput, Operations, OutputCompoundUpdateInput, OutputCreateInput,
  PreferencesUpdateInput, ProjectCreateInput, ProjectsGetInput, ProjectUpdateInput,
  SourceCompoundUpdateInput, SourceCreateInput, StatusInclude, TaskCreateInput,
  TaskUpdateInput, WikiCompoundUpdateInput, WikiCreateInput,
} from "../runtime/operations.js";
import type { serialQueue } from "../runtime/serial.js";
import type { SessionApplyInput, SessionNextInput } from "../runtime/session-ingestion.js";

const readOptions = {
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
};

const plainRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1) });
const reference = z.strictObject({
  scope: z.string().min(1),
  id: z.string().min(1),
  kind: z.enum(["Area", "Project", "Task", "Source", "Wiki", "Output"]),
});
const areaRef = reference.extend({ kind: z.literal("Area") });
const projectRef = reference.extend({ kind: z.literal("Project") });
const taskRef = reference.extend({ kind: z.literal("Task") });
const sourceRef = reference.extend({ kind: z.literal("Source") });
const wikiRef = reference.extend({ kind: z.literal("Wiki") });
const outputRef = reference.extend({ kind: z.literal("Output") });
const materialRef = z.strictObject({
  scope: z.string().min(1),
  id: z.string().min(1),
  role: z.literal("project-material"),
  project: projectRef,
});

const date = z.iso.date();
const expected = z.string().min(1).optional();
const history = z.strictObject({ origin: z.string().min(1), date: date.optional() });
const textEdit = z.strictObject({ before: z.string().min(1), after: z.string() });
const inlineLink = z.strictObject({ to: reference, context: z.string().min(1) });
const linkInput = z.strictObject({ from: reference, to: reference, context: z.string().min(1) });

const areaState = z.enum(["active", "inactive"]);
const projectState = z.enum(["planned", "active", "paused", "completed", "canceled"]);
const taskState = z.enum(["todo", "doing", "waiting", "done", "canceled"]);

const captureSurface = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("inbox") }),
  z.strictObject({ name: z.literal("daily-notes"), date: date.optional() }),
]);
const captureSurfaceRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), role: z.literal("capture-surface") });
const captureRef = z.strictObject({ scope: z.string().min(1), id: z.string().min(1), role: z.literal("capture"), surface: captureSurfaceRef });

const queryCommon = {
  ...readOptions,
  text: z.string().optional(),
  relatedTo: reference.optional(),
};

const contentUpdateFields = {
  title: z.string().min(1).optional(),
  edits: z.array(textEdit).min(1).optional(),
  append: z.string().min(1).optional(),
  replaceContent: z.string().min(1).optional(),
};

function validContentCombo(v: { edits?: unknown; append?: unknown; replaceContent?: unknown; expected?: unknown }): boolean {
  if (v.replaceContent !== undefined) {
    return Boolean(v.expected) && v.edits === undefined && v.append === undefined;
  }
  return true;
}

type DeepStripUndefined<T> = T extends readonly (infer U)[]
  ? DeepStripUndefined<U>[]
  : T extends object
  ? { [K in keyof T]: Exclude<DeepStripUndefined<T[K]>, undefined> }
  : T;

// JSON inputs cannot contain undefined. Recursively strip undefined fields produced by
// Zod optional properties so exactOptionalPropertyTypes contracts hold across nested inputs.
function stripUndefined<T>(value: T): DeepStripUndefined<T> {
  if (Array.isArray(value)) return value.map(stripUndefined) as DeepStripUndefined<T>;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined)
        .map(([key, field]) => [key, stripUndefined(field)]),
    ) as DeepStripUndefined<T>;
  }
  return value as DeepStripUndefined<T>;
}

const taskTimeFilter = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  includeUnset: z.boolean().optional(),
}).refine(v => !v.from || !v.to || v.from <= v.to, "from must not be after to");

const projectMaterialInput = z.strictObject({
  title: z.string().min(1),
  content: z.string(),
  presentation: z.enum(["inline", "child-document"]),
});

function response(result: Result<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  };
}

/** Keep the provider operation in the instance queue even if its HTTP caller disconnects. */
function wrapToolCalls(server: McpServer, exclusive?: ReturnType<typeof serialQueue>): void {
  if (!exclusive && !debugEnabled()) return;
  type Handler = (...args: unknown[]) => Promise<{ structuredContent?: Result<unknown> }>;
  const registration = server as unknown as { registerTool: (name: string, config: unknown, handler: Handler) => unknown };
  const register = registration.registerTool.bind(server);
  registration.registerTool = (name, config, handler) => register(name, config, (...args) => {
    const run = async () => {
      const context = args.at(-1) as { mcpReq?: { signal?: AbortSignal } } | undefined;
      context?.mcpReq?.signal?.throwIfAborted();
      if (!debugEnabled()) return handler(...args);
      const start = Date.now();
      debug("tool", "call", { name, args: args[0] && typeof args[0] === "object" && !("signal" in args[0]) ? args[0] : {} });
      try {
        const result = await handler(...args);
        const outcome = result.structuredContent;
        debug("tool", "done", {
          name, took: since(start),
          ...(outcome?.ok ? { ok: true, limits: outcome.limits.length ? outcome.limits : undefined } : { ok: false, code: outcome?.error.code, message: outcome?.error.message, next: outcome?.error.next }),
        });
        return result;
      } catch (error) {
        debug("tool", "threw", { name, took: since(start), error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
    return exclusive ? exclusive(run) : run();
  });
}

/**
 * Register the 28-tool Agent BFF facade over GPK's domain and control operations.
 * Every input schema is a strict top-level JSON object for cross-host MCP compatibility.
 */
export function createGpkServer(
  operations: Operations,
  version: string,
  onboarding: OnboardingHandle,
  exclusive?: ReturnType<typeof serialQueue>,
) {
  const server = new McpServer({ name: "gpk", version });
  wrapToolCalls(server, exclusive);
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  // 1–3. System & Preferences
  server.registerTool("gpk_status", {
    description: "Inspect GPK readiness, active backend connection, user preferences (including contentLanguage and timezone) and customized backend templates. Pass include to inspect grants, adapter capabilities, full resolved templates or Setup layout diagnostics.",
    inputSchema: z.strictObject({
      include: z.array(z.enum(["grants", "capabilities", "templates", "setup"])).max(4).optional(),
    }),
    annotations: readOnly,
  }, async args => response(await operations.status(args.include as StatusInclude[] | undefined)));

  server.registerTool("gpk_setup_open", {
    description: "Open GPK's local browser console to connect a knowledge backend, create/adopt workspace structures (with full non-destructive workspace grants), optionally connect Craft's attachment upload API, or configure automatic session retention and writing preferences. Never fetch or submit the returned one-time URL yourself; show it to the user when opened is false.",
    inputSchema: z.strictObject({
      view: z.enum(["setup", "console"]).optional(),
    }),
    annotations: { ...mutating, openWorldHint: true },
  }, async args => response(await onboarding.open(args.view)));

  server.registerTool("gpk_preferences_update", {
    description: "Update user preferences (contentLanguage, timezone, profileWiki, instructions), backend template bindings or the automatic session retention toggle. Craft OAuth, workspace setup and optional attachment upload API connections are managed in gpk_setup_open.",
    inputSchema: z.strictObject({
      preferences: z.strictObject({
        contentLanguage: z.string().min(1).nullable().optional(),
        timezone: z.string().min(1).nullable().optional(),
        profileWiki: wikiRef.nullable().optional(),
        instructions: z.string().optional(),
      }).optional(),
      templates: z.strictObject({
        area: plainRef.nullable().optional(),
        project: plainRef.nullable().optional(),
        task: plainRef.nullable().optional(),
        source: plainRef.nullable().optional(),
        wiki: plainRef.nullable().optional(),
        output: plainRef.nullable().optional(),
      }).optional(),
      automaticIngestionEnabled: z.boolean().optional(),
      expected,
    }).refine(
      v => v.preferences !== undefined || v.templates !== undefined || v.automaticIngestionEnabled !== undefined,
      "Supply preferences, templates or automaticIngestionEnabled.",
    ),
    annotations: mutating,
  }, async args => response(await operations.preferencesUpdate(stripUndefined(args) as PreferencesUpdateInput)));

  // 4–5. Captures & Daily Notes
  server.registerTool("gpk_captures_get", {
    description: "List raw captures on Inbox or a Daily Note (resolving the surface in one call; date defaults to today in the workspace timezone), or read specific capture refs with nested content.",
    inputSchema: z.strictObject({
      surface: captureSurface.optional(),
      refs: z.array(captureRef).min(1).max(20).optional(),
      ...readOptions,
    }).refine(
      v => (v.surface !== undefined) !== (v.refs !== undefined),
      "Supply either surface or refs.",
    ),
    annotations: readOnly,
  }, async args => response(await operations.capturesGet(stripUndefined(args) as CapturesGetInput)));

  server.registerTool("gpk_daily_record", {
    description: "Record a concise, single-line completed outcome or retained Source link in the Daily Note (defaults to today in the workspace timezone). Idempotent when retried with the same date, summary and related record.",
    inputSchema: z.strictObject({
      summary: z.string().min(1).max(600),
      related: reference.optional(),
      date: date.optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.dailyRecord(args.summary, args.related, args.date)));

  // 6–8. Areas
  server.registerTool("gpk_areas_get", {
    description: "Read specific Areas by native ID, link or AreaRef (targets), or query Areas by case-insensitive text, relatedTo and states. Piggybacks customTemplates.area if modified in the backend.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), areaRef])).min(1).max(20).optional(),
      ...queryCommon,
      states: z.array(areaState).optional(),
    }),
    annotations: readOnly,
  }, async args => response(await operations.areasGet(stripUndefined(args))));

  server.registerTool("gpk_areas_create", {
    description: "Create an Area with its initial state and body, plus optional contextual links and Daily Note activity log.",
    inputSchema: z.strictObject({
      title: z.string().min(1),
      content: z.string(),
      state: areaState,
      links: z.array(inlineLink).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.areasCreate(stripUndefined(args) as AreaCreateInput)));

  server.registerTool("gpk_areas_update", {
    description: "Update an Area in one call: title, narrow body edits, trailing prose append, guarded replaceContent, lifecycle transition (with reason), contextual linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: areaRef,
      ...contentUpdateFields,
      transition: z.strictObject({ state: areaState, reason: z.string().min(1) }).optional(),
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }).refine(validContentCombo, "replaceContent requires expected and cannot be combined with edits or append."),
    annotations: mutating,
  }, async args => response(await operations.areasUpdate(stripUndefined(args) as AreaUpdateInput)));

  // 9–11. Projects & Materials
  server.registerTool("gpk_projects_get", {
    description: "Read specific Projects (targets), read one Project material (material), or query Projects by text/states/area/relatedTo. Pass include (area, tasks, materials, links) to expand Project context in one turn.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), projectRef])).min(1).max(20).optional(),
      material: materialRef.optional(),
      include: z.array(z.enum(["area", "tasks", "materials", "links"])).max(4).optional(),
      ...queryCommon,
      states: z.array(projectState).optional(),
      area: areaRef.optional(),
    }),
    annotations: readOnly,
  }, async args => response(await operations.projectsGet(stripUndefined(args) as ProjectsGetInput)));

  const initialTaskSchema = z.strictObject({
    title: z.string().min(1),
    content: z.string().optional(),
    state: taskState.optional(),
    time: date.optional(),
    history: history.optional(),
  });

  server.registerTool("gpk_projects_create", {
    description: "Create a Project under its primaryArea (paused/completed/canceled requires history), optionally bundling initialTasks, process materials, contextual links and a Daily Note log with structured partial-failure receipts.",
    inputSchema: z.strictObject({
      title: z.string().min(1),
      content: z.string(),
      state: projectState,
      history: history.optional(),
      primaryArea: areaRef,
      initialTasks: z.array(initialTaskSchema).max(30).optional(),
      materials: z.array(projectMaterialInput).max(20).optional(),
      links: z.array(inlineLink).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.projectsCreate(stripUndefined(args) as ProjectCreateInput)));

  const materialUpdateSchema = z.strictObject({
    ref: materialRef,
    ...contentUpdateFields,
    expected,
  }).refine(validContentCombo, "replaceContent on material requires expected and cannot be combined with edits or append.");

  server.registerTool("gpk_projects_update", {
    description: "Update a Project in one call: title/edits/append/replaceContent, primaryArea reassignment, taskOrder, state transition (closing requires no open Tasks), materialAppend, materialUpdate, linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: projectRef,
      ...contentUpdateFields,
      transition: z.strictObject({ state: projectState, reason: z.string().min(1) }).optional(),
      primaryArea: z.strictObject({ area: areaRef, reason: z.string().min(1) }).optional(),
      taskOrder: z.array(taskRef).min(1).optional(),
      materialAppend: z.array(projectMaterialInput).min(1).max(20).optional(),
      materialUpdate: z.array(materialUpdateSchema).min(1).max(20).optional(),
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }).refine(validContentCombo, "replaceContent requires expected and cannot be combined with edits or append."),
    annotations: mutating,
  }, async args => response(await operations.projectsUpdate(stripUndefined(args) as ProjectUpdateInput)));

  // 12–14. Tasks
  server.registerTool("gpk_tasks_get", {
    description: "Read specific Tasks by ID, link or TaskRef (targets), or query Tasks by states, project (null for standalone only), planned time range, text and relatedTo.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), taskRef])).min(1).max(20).optional(),
      ...queryCommon,
      states: z.array(taskState).optional(),
      project: projectRef.nullable().optional(),
      time: taskTimeFilter.optional(),
    }),
    annotations: readOnly,
  }, async args => response(await operations.tasksGet(stripUndefined(args))));

  const batchTaskItem = z.strictObject({
    title: z.string().min(1),
    content: z.string().optional(),
    state: taskState.optional(),
    time: date.optional(),
    history: history.optional(),
    project: projectRef.optional(),
  });

  server.registerTool("gpk_tasks_create", {
    description: "Create one Task (title, optional project/time/state/content/links) or a batch of Tasks (items[]), standalone in the Daily Note or inside a Project. Closed initial states (done/canceled) record past history and require history.",
    inputSchema: z.strictObject({
      title: z.string().min(1).optional(),
      content: z.string().optional(),
      state: taskState.optional(),
      time: date.optional(),
      history: history.optional(),
      project: projectRef.optional(),
      links: z.array(inlineLink).max(20).optional(),
      items: z.array(batchTaskItem).min(1).max(50).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
    }).refine(
      v => (v.title !== undefined) !== (v.items !== undefined)
        && (v.items === undefined || (v.content === undefined && v.state === undefined && v.time === undefined && v.history === undefined && v.project === undefined && v.links === undefined)),
      "Supply either single-task fields (with title) or batch items[].",
    ),
    annotations: mutating,
  }, async args => response(await operations.tasksCreate(stripUndefined(args) as TaskCreateInput)));

  server.registerTool("gpk_tasks_update", {
    description: "Update a Task in one call: title, body edits or append, planned time (YYYY-MM-DD or null to clear), project ownership move (ProjectRef or null for standalone, with reason), state transition (with reason), linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: taskRef,
      title: z.string().min(1).optional(),
      edits: z.array(textEdit).min(1).optional(),
      append: z.string().min(1).optional(),
      transition: z.strictObject({ state: taskState, reason: z.string().min(1) }).optional(),
      time: date.nullable().optional(),
      project: z.strictObject({ target: projectRef.nullable(), reason: z.string().min(1) }).optional(),
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }),
    annotations: mutating,
  }, async args => response(await operations.tasksUpdate(stripUndefined(args) as TaskUpdateInput)));

  // 15–17. Sources
  server.registerTool("gpk_sources_get", {
    description: "Read specific Sources by ID, link or SourceRef (targets), or query Sources by case-insensitive text and relatedTo. Piggybacks customTemplates.source if modified in the backend.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), sourceRef])).min(1).max(20).optional(),
      ...queryCommon,
    }),
    annotations: readOnly,
  }, async args => response(await operations.sourcesGet(stripUndefined(args))));

  server.registerTool("gpk_sources_create", {
    description: "Create a Source document with origin, access evidence and prepared material, optional local originalFile (file:///... when Craft upload API is connected), contextual links and automatic Daily Note recording (recordInDaily defaults to true).",
    inputSchema: z.strictObject({
      title: z.string().min(1),
      content: z.string(),
      originalFile: z.string().startsWith("file:///").optional(),
      links: z.array(inlineLink).max(20).optional(),
      recordInDaily: z.boolean().optional(),
      dailyDate: date.optional(),
      activitySummary: z.string().min(1).max(600).optional(),
    }),
    annotations: mutating,
  }, async args => {
    const clean = stripUndefined(args);
    const input: SourceCreateInput = {
      ...clean,
      recordInDaily: args.recordInDaily ?? true,
      explicitRecordInDaily: args.recordInDaily === true,
    };
    return response(await operations.sourcesCreate(input));
  });

  server.registerTool("gpk_sources_update", {
    description: "Update a Source in one call: title, narrow edits, trailing append, guarded replaceContent (for interrupted empty-body recovery), originalFile attachment (requires expected), linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: sourceRef,
      ...contentUpdateFields,
      originalFile: z.string().startsWith("file:///").optional(),
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }).refine(
      v => validContentCombo(v) && (v.originalFile === undefined || (Boolean(v.expected) && v.replaceContent === undefined)),
      "replaceContent and originalFile each require expected, and replaceContent cannot be combined with edits, append or originalFile.",
    ),
    annotations: mutating,
  }, async args => response(await operations.sourcesUpdate(stripUndefined(args) as SourceCompoundUpdateInput)));

  // 18–20. Wikis
  server.registerTool("gpk_wikis_get", {
    description: "Read specific Wikis by ID, link or WikiRef (targets), or query Wikis by case-insensitive text and relatedTo. Piggybacks customTemplates.wiki if modified in the backend.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), wikiRef])).min(1).max(20).optional(),
      ...queryCommon,
    }),
    annotations: readOnly,
  }, async args => response(await operations.wikisGet(stripUndefined(args))));

  server.registerTool("gpk_wikis_create", {
    description: "Create a Wiki document synthesizing durable understanding with citations, plus optional contextual links and Daily Note log.",
    inputSchema: z.strictObject({
      title: z.string().min(1),
      content: z.string(),
      links: z.array(inlineLink).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.wikisCreate(stripUndefined(args) as WikiCreateInput)));

  server.registerTool("gpk_wikis_update", {
    description: "Update a Wiki in one call: title, narrow edits, trailing append, guarded replaceContent, linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: wikiRef,
      ...contentUpdateFields,
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }).refine(validContentCombo, "replaceContent requires expected and cannot be combined with edits or append."),
    annotations: mutating,
  }, async args => response(await operations.wikisUpdate(stripUndefined(args) as WikiCompoundUpdateInput)));

  // 21–23. Outputs
  server.registerTool("gpk_outputs_get", {
    description: "Read specific Outputs by ID, link or OutputRef (targets), or query Outputs by case-insensitive text and relatedTo. Piggybacks customTemplates.output if modified in the backend.",
    inputSchema: z.strictObject({
      targets: z.array(z.union([z.string().min(1), outputRef])).min(1).max(20).optional(),
      ...queryCommon,
    }),
    annotations: readOnly,
  }, async args => response(await operations.outputsGet(stripUndefined(args))));

  server.registerTool("gpk_outputs_create", {
    description: "Create an Output document recording a delivered artifact and its producers, plus optional contextual links and Daily Note log.",
    inputSchema: z.strictObject({
      title: z.string().min(1),
      content: z.string(),
      links: z.array(inlineLink).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.outputsCreate(stripUndefined(args) as OutputCreateInput)));

  server.registerTool("gpk_outputs_update", {
    description: "Update an Output in one call: title, narrow edits, trailing append, guarded replaceContent, linksAdd and optional Daily Note log.",
    inputSchema: z.strictObject({
      ref: outputRef,
      ...contentUpdateFields,
      linksAdd: z.array(inlineLink).min(1).max(20).optional(),
      activitySummary: z.string().min(1).max(600).optional(),
      activityDate: date.optional(),
      expected,
    }).refine(validContentCombo, "replaceContent requires expected and cannot be combined with edits or append."),
    annotations: mutating,
  }, async args => response(await operations.outputsUpdate(stripUndefined(args) as OutputCompoundUpdateInput)));

  // 24–25. Contextual Links & Review Inventory
  server.registerTool("gpk_links", {
    description: "Query contextual links touching a record in both directions (action: query), add one or more directed contextual links (action: add), or remove a link when explicitly granted links.remove (action: remove).",
    inputSchema: z.strictObject({
      action: z.enum(["query", "add", "remove"]),
      ref: reference.optional(),
      links: z.array(linkInput).min(1).max(20).optional(),
      link: linkInput.optional(),
      expected,
      ...readOptions,
    }).refine(v => {
      if (v.action === "query") return v.ref !== undefined && v.links === undefined && v.link === undefined && v.expected === undefined;
      if (v.action === "add") return (v.links !== undefined || v.link !== undefined) && v.ref === undefined && v.cursor === undefined && v.limit === undefined;
      return v.link !== undefined && v.links === undefined && v.ref === undefined && v.cursor === undefined && v.limit === undefined;
    }, "query needs ref; add needs links (or link); remove needs link."),
    annotations: mutating,
  }, async args => {
    const clean = stripUndefined(args);
    let input: LinksManageInput;
    if (clean.action === "query") {
      input = { action: "query", ref: clean.ref!, ...(clean.cursor !== undefined ? { cursor: clean.cursor } : {}), ...(clean.limit !== undefined ? { limit: clean.limit } : {}) };
    } else if (clean.action === "add") {
      input = { action: "add", links: clean.links ?? [clean.link!], ...(clean.expected !== undefined ? { expected: clean.expected } : {}) };
    } else {
      input = { action: "remove", link: clean.link!, ...(clean.expected !== undefined ? { expected: clean.expected } : {}) };
    }
    return response(await operations.linksManage(input));
  });

  server.registerTool("gpk_review_inventory", {
    description: "Read the population for a daily, weekly or monthly review in one call: Inbox captures, executable Tasks (overdue/today/upcoming/doing/waiting/unscheduled), held Tasks of planned/paused Projects, discrepancies, Projects by state with attention signals, Areas with Project counts, and coverage gaps.",
    inputSchema: z.strictObject({
      cadence: z.enum(["daily", "weekly", "monthly"]),
      horizonDays: z.number().int().min(0).max(366).optional(),
    }),
    annotations: readOnly,
  }, async args => response(await operations.reviewInventory(args.cadence, args.horizonDays)));

  // 26–28. Sessions & Checkpoints
  server.registerTool("gpk_sessions_next", {
    description: "Claim and read the next changed Claude Code, Codex or Antigravity session (or pass key for a specific session), or continue paging an active session by passing token + cursor. Returns done: true when no pending sessions remain. Read every page until next is absent before calling gpk_sessions_apply.",
    inputSchema: z.strictObject({
      mode: z.enum(["manual", "automatic"]),
      days: z.number().int().min(1).max(3650).optional(),
      until: z.string().datetime().optional(),
      origin: z.string().min(1).optional(),
      key: z.string().min(1).optional(),
      token: z.string().uuid().optional(),
      cursor: z.number().int().min(0).optional(),
    }).refine(
      v => v.token === undefined ? v.cursor === undefined : v.cursor !== undefined && v.key === undefined,
      "Pass token with cursor to read the next page, or omit both to claim the next session.",
    ),
    annotations: mutating,
  }, async args => response(await operations.sessionsNext(stripUndefined(args) as SessionNextInput)));

  const sessionWikiCreate = z.strictObject({
    action: z.literal("create"),
    name: z.string().min(1).max(200),
    title: z.string().min(1),
    content: z.string(),
  });
  const sessionWikiUpdate = z.strictObject({
    action: z.literal("update"),
    name: z.string().min(1).max(200),
    ref: wikiRef,
    title: z.string().min(1).optional(),
    edits: z.array(textEdit).min(1).optional(),
    append: z.string().min(1).optional(),
    expected,
  });
  const sessionLinkEnd = z.union([z.literal("source"), reference]);

  server.registerTool("gpk_sessions_apply", {
    description: "Complete or release a claimed session from gpk_sessions_next. outcome: retain deterministically saves/updates the session Source, applies optional Wiki/Task/Link actions with durable checkpoint tracking, logs the Source in the Daily Note and marks the read turns processed; outcome: skip marks read turns processed with no Source when nothing is worth saving; outcome: release drops the lock without advancing progress.",
    inputSchema: z.strictObject({
      token: z.string().uuid(),
      outcome: z.enum(["retain", "skip", "release"]),
      reason: z.string().min(1),
      source: z.strictObject({
        title: z.string().min(1),
        content: z.string().min(1).max(128000),
      }).optional(),
      wikis: z.array(z.discriminatedUnion("action", [sessionWikiCreate, sessionWikiUpdate])).max(20).optional(),
      tasks: z.array(z.strictObject({
        name: z.string().min(1).max(200),
        title: z.string().min(1),
        content: z.string().optional(),
        state: taskState.optional(),
        time: date.optional(),
        project: projectRef.optional(),
      })).max(20).optional(),
      links: z.array(z.strictObject({
        name: z.string().min(1).max(200),
        from: sessionLinkEnd,
        to: sessionLinkEnd,
        context: z.string().min(1),
      })).max(30).optional(),
      reconcile: z.array(z.strictObject({
        name: z.string().min(1).max(200),
        ref: reference,
        expected: z.string().min(1),
      })).max(20).optional(),
    }),
    annotations: mutating,
  }, async args => response(await operations.sessionsApply(stripUndefined(args) as SessionApplyInput)));

  server.registerTool("gpk_checkpoints", {
    description: "Read (action: read) or save (action: save) a durable workflow processing checkpoint by logical key (such as import/<origin>). Pass expected when updating an existing checkpoint.",
    inputSchema: z.strictObject({
      action: z.enum(["read", "save"]),
      key: z.string().min(1),
      content: z.string().optional(),
      expected,
    }).refine(
      v => v.action === "read" ? v.content === undefined && v.expected === undefined : v.content !== undefined,
      "read takes only key; save requires content.",
    ),
    annotations: mutating,
  }, async args => response(await operations.checkpointsManage(stripUndefined(args) as CheckpointsManageInput)));

  return server;
}
