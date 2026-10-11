import type { AreaRef, ProjectRef, ProjectState, TaskRef, TaskState } from "../domain/entities.js";
import type { CaptureRef, KnowledgeBackendPort } from "../domain/knowledge-backend-port.js";
import type { Failure, Page, Result } from "../domain/operation-types.js";

/**
 * The reviewed population for one sitting, read through the port in one call so
 * the Agent compares intentions with facts instead of paging through queries.
 * This is an observation, not a planning algorithm: it names candidates and
 * the signals behind them (overdue, waiting, no next action) and states what
 * was and was not traversed. Decisions and writes stay with the Agent and the
 * entity operations.
 */
export type ReviewCadence = "daily" | "weekly" | "monthly";

export type ReviewTask = { ref: TaskRef; title: string; state: TaskState; time?: string; project?: ProjectRef };
export type ReviewProject = {
  ref: ProjectRef; title: string; state: ProjectState; primaryArea?: AreaRef;
  tasks: { open: number; waiting: number; done: number; canceled: number; overdue: number; next?: string };
  /** Why an active Project needs attention; empty when it has a live next action. */
  signals: ("no-next-action" | "all-waiting" | "overdue")[];
};
export type ReviewInventory = {
  cadence: ReviewCadence;
  today: string;
  /** Planned dates up to and including this day count as upcoming. */
  horizon: string;
  captures: { inbox: { ref: CaptureRef; content: string }[] };
  actions: { overdue: ReviewTask[]; today: ReviewTask[]; upcoming: ReviewTask[]; doing: ReviewTask[]; waiting: ReviewTask[]; unscheduled: ReviewTask[] };
  projects: Record<ProjectState, ReviewProject[]>;
  areas: { ref: AreaRef; title: string; state?: "active" | "inactive"; projects: Record<ProjectState, number> }[];
  /** What was traversed; a partial coverage means some records were not seen. */
  population: { areas: number; projects: number; tasks: number; captures: number; coverage: "complete" | "partial"; gaps: string[] };
};

const HORIZON_DAYS: Record<ReviewCadence, number> = { daily: 1, weekly: 7, monthly: 30 };
const PROJECT_STATES: ProjectState[] = ["planned", "active", "paused", "completed", "canceled"];
const PAGE = 100;

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

export function todayIn(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Follow a paged query to the end, keeping the weakest coverage and every limit. */
async function drain<T>(run: (cursor?: string) => Promise<Result<Page<T>>>, gaps: string[], label: string): Promise<Result<{ items: T[]; complete: boolean }>> {
  const items: T[] = [];
  let cursor: string | undefined;
  let complete = true;
  for (let page = 0; page < 50; page++) {
    const result = await run(cursor);
    if (!result.ok) return result;
    items.push(...result.value.items);
    for (const limit of result.limits) if (!gaps.includes(`${label}: ${limit}`)) gaps.push(`${label}: ${limit}`);
    if (result.value.coverage === "partial" && !result.value.next) complete = false;
    if (result.value.coverage === "complete" || !result.value.next) return { ok: true, value: { items, complete }, limits: [] };
    cursor = result.value.next;
  }
  gaps.push(`${label}: stopped after 50 pages.`);
  return { ok: true, value: { items, complete: false }, limits: [] };
}

export async function reviewInventory(knowledge: KnowledgeBackendPort, cadence: ReviewCadence, today: string, horizonDays?: number): Promise<Result<ReviewInventory>> {
  const days = horizonDays ?? HORIZON_DAYS[cadence];
  if (!Number.isInteger(days) || days < 0 || days > 366) return failure("invalid", "horizonDays must be an integer from 0 to 366.", "Adjust the horizon.");
  const horizon = addDays(today, days);
  const gaps: string[] = [];
  let complete = true;

  const areas = await drain(cursor => knowledge.areas.query(cursor ? { limit: PAGE, cursor } : { limit: PAGE }), gaps, "areas");
  if (!areas.ok) return areas;
  complete &&= areas.value.complete;
  const projects = await drain(cursor => knowledge.projects.query(cursor ? { limit: PAGE, cursor } : { limit: PAGE }), gaps, "projects");
  if (!projects.ok) return projects;
  complete &&= projects.value.complete;

  const toTask = (snapshot: { ref: TaskRef; value: { title: string; state?: TaskState; time?: string; project?: ProjectRef } }): ReviewTask | null => {
    if (!snapshot.value.state) return null;
    const task: ReviewTask = { ref: snapshot.ref, title: snapshot.value.title, state: snapshot.value.state };
    if (snapshot.value.time) task.time = snapshot.value.time;
    if (snapshot.value.project) task.project = snapshot.value.project;
    return task;
  };

  const byState: Record<ProjectState, ReviewProject[]> = { planned: [], active: [], paused: [], completed: [], canceled: [] };
  const allTasks: ReviewTask[] = [];
  let taskCount = 0;
  for (const snapshot of projects.value.items) {
    const state = snapshot.value.state;
    if (!state) { gaps.push(`projects: ${snapshot.ref.id} has no readable state.`); complete = false; continue; }
    const entry: ReviewProject = { ref: snapshot.ref, title: snapshot.value.title, state, tasks: { open: 0, waiting: 0, done: 0, canceled: 0, overdue: 0 }, signals: [] };
    if (snapshot.value.primaryArea) entry.primaryArea = snapshot.value.primaryArea;
    if (state === "active" || state === "paused" || state === "planned") {
      const tasks = await drain(cursor => knowledge.tasks.query(cursor ? { project: snapshot.ref, limit: PAGE, cursor } : { project: snapshot.ref, limit: PAGE }), gaps, `tasks of ${snapshot.ref.id}`);
      if (!tasks.ok) return tasks;
      complete &&= tasks.value.complete;
      for (const item of tasks.value.items) {
        const task = toTask(item);
        if (!task) { gaps.push(`tasks: ${item.ref.id} has no readable state.`); complete = false; continue; }
        taskCount++;
        allTasks.push(task);
        if (task.state === "todo" || task.state === "doing") {
          entry.tasks.open++;
          if (task.time && task.time < today) entry.tasks.overdue++;
          if (task.time && (!entry.tasks.next || task.time < entry.tasks.next)) entry.tasks.next = task.time;
        } else if (task.state === "waiting") entry.tasks.waiting++;
        else if (task.state === "done") entry.tasks.done++;
        else entry.tasks.canceled++;
      }
      if (state === "active") {
        if (entry.tasks.open === 0 && entry.tasks.waiting === 0) entry.signals.push("no-next-action");
        else if (entry.tasks.open === 0) entry.signals.push("all-waiting");
        if (entry.tasks.overdue > 0) entry.signals.push("overdue");
      }
    }
    byState[state].push(entry);
  }

  // Standalone actions need the space-wide listing; its cost and coverage are disclosed by the adapter.
  const standalone = await drain(cursor => knowledge.tasks.query(cursor ? { project: null, states: ["todo", "doing", "waiting"], limit: PAGE, cursor } : { project: null, states: ["todo", "doing", "waiting"], limit: PAGE }), gaps, "standalone tasks");
  if (!standalone.ok) return standalone;
  complete &&= standalone.value.complete;
  for (const item of standalone.value.items) {
    const task = toTask(item);
    if (!task) continue;
    taskCount++;
    allTasks.push(task);
  }

  const actions: ReviewInventory["actions"] = { overdue: [], today: [], upcoming: [], doing: [], waiting: [], unscheduled: [] };
  const byTime = (a: ReviewTask, b: ReviewTask) => (a.time ?? "9999").localeCompare(b.time ?? "9999") || a.title.localeCompare(b.title);
  for (const task of allTasks) {
    if (task.state === "waiting") { actions.waiting.push(task); continue; }
    if (task.state !== "todo" && task.state !== "doing") continue;
    if (task.state === "doing") actions.doing.push(task);
    if (!task.time) actions.unscheduled.push(task);
    else if (task.time < today) actions.overdue.push(task);
    else if (task.time === today) actions.today.push(task);
    else if (task.time <= horizon) actions.upcoming.push(task);
  }
  for (const list of Object.values(actions)) list.sort(byTime);

  const captures: ReviewInventory["captures"] = { inbox: [] };
  const surface = await knowledge.captures.resolve({ name: "inbox" });
  if (!surface.ok) { gaps.push(`captures: ${surface.error.message}`); complete = false; }
  else {
    const listed = await knowledge.captures.list(surface.value);
    if (!listed.ok) { gaps.push(`captures: ${listed.error.message}`); complete = false; }
    else {
      for (const item of listed.value.items) captures.inbox.push({ ref: item.ref, content: item.value.content });
      if (listed.value.coverage === "partial") complete = false;
    }
  }

  const areaRows: ReviewInventory["areas"] = areas.value.items.map(snapshot => {
    const counts: Record<ProjectState, number> = { planned: 0, active: 0, paused: 0, completed: 0, canceled: 0 };
    for (const state of PROJECT_STATES) counts[state] = byState[state].filter(project => project.primaryArea?.id.toLowerCase() === snapshot.ref.id.toLowerCase()).length;
    const row: ReviewInventory["areas"][number] = { ref: snapshot.ref, title: snapshot.value.title, projects: counts };
    if (snapshot.value.state) row.state = snapshot.value.state;
    return row;
  });

  return {
    ok: true,
    value: {
      cadence, today, horizon, captures, actions, projects: byState, areas: areaRows,
      population: { areas: areas.value.items.length, projects: projects.value.items.length, tasks: taskCount, captures: captures.inbox.length, coverage: complete ? "complete" : "partial", gaps },
    },
    limits: ["Tasks of completed and canceled Projects were not read; Task bodies and Project KR evidence need the entity reads."],
  };
}
