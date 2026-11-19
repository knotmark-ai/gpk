import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Result } from "../domain/operation-types.js";
import type { GrantSelection, Operations, SetupPlan } from "../runtime/operations.js";
import { serialQueue } from "../runtime/serial.js";
import page from "./page.html";
import { debug, since } from "../runtime/debug-log.js";
import type { IngestOriginPolicy, PreferenceChanges } from "../domain/user-control-port.js";

/**
 * The local browser console: GPK's Setup, Configuration, Status and MCP & Skills surface.
 * It is served from the runtime process on the loopback interface and drives the same
 * operations as every other surface, writing only `settings.json` and `grants.json`.
 * Workspace grants are persisted exclusively here when establishing, resuming or syncing
 * a workspace; the Agent opens the page but holds no credential that submits it.
 *
 * Any web page in the user's browser can send requests to 127.0.0.1, so every request
 * must name this server in Host (against DNS rebinding) and carry the session cookie;
 * writes must also come from this origin (Origin and Sec-Fetch-Site) with a JSON body.
 *
 * The Agent must not hold a credential that confirms the page. `open()` mints a
 * one-time launch token and hands the URL to the browser; the first page load trades
 * it for an HttpOnly session cookie, so the URL is dead once used. The URL reaches the
 * Agent only when no browser could be opened, and then an Agent that spends it leaves
 * the user's link visibly expired. This keeps the credential out of tool output; it
 * cannot prove a human clicked, since a process with the user's local shell can do
 * anything the user can, including editing grants.json directly.
 */
export type OnboardingOptions = {
  operations: Operations;
  serviceInfo?: () => Promise<unknown>;
  exclusive?: ReturnType<typeof serialQueue>;
  /** Opens a URL in the user's browser; false when it could not. */
  openBrowser: (url: string) => Promise<boolean>;
  /** Close the server after this much inactivity (default 30 minutes). */
  idleMs?: number;
};

export type OnboardingHandle = {
  /** Start (or reuse) the server and open the page; the URL is returned only when no browser opened. */
  open(view?: "setup" | "console"): Promise<Result<{ opened: boolean; url?: string }>>;
  close(): Promise<void>;
};

type Json = Record<string, unknown>;
const LANGUAGES = ["en", "zh-CN"] as const;


/**
 * Knowledge bases the page offers. Only implemented adapters are available; the
 * others are listed so the page does not read as tied to one product, and the
 * server refuses to connect them.
 */
const KNOWLEDGE_BACKENDS: readonly { id: string; name: string; available: boolean }[] = [
  { id: "craft", name: "Craft", available: true },
  { id: "notion", name: "Notion", available: false },
  { id: "obsidian", name: "Obsidian", available: false },
  { id: "lark", name: "Lark", available: false },
];

function failure(code: "invalid" | "unavailable", message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

function sameToken(given: string | undefined | null, token: string | null): boolean {
  if (!given || !token) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 80;
}

const FOLDER_KEYS = ["sources", "wikis", "outputs"] as const;
type FolderKey = typeof FOLDER_KEYS[number];

/**
 * The plan the page submitted, checked field by field. The only IDs the page may pass
 * are existing folders the user chose to use instead of creating a same-named one
 * (`adopt`); the route checks each against the inspected folders before this plan runs.
 */
function planFromForm(body: Json): Result<SetupPlan> {
  const names = body.names as Json | undefined;
  const metadataLanguage = body.metadataLanguage;
  if (!names || !["host", "areas", "projects", "sources", "wikis", "outputs"].every(key => isName(names[key]))) {
    return failure("invalid", "Every name must be nonblank text of at most 80 characters.", "Correct the names.");
  }
  if (!LANGUAGES.includes(metadataLanguage as never)) return failure("invalid", "Unsupported metadata language.", "Choose en or zh-CN.");
  if (body.workspace !== "dedicated" && body.workspace !== "shared") return failure("invalid", "Choose a dedicated or shared workspace.", "Pick one.");
  const adopt = (body.adopt ?? {}) as Json;
  if (typeof adopt !== "object" || Array.isArray(adopt) || !Object.entries(adopt).every(([key, value]) => FOLDER_KEYS.includes(key as FolderKey) && typeof value === "string" && value.length > 0 && value.length <= 64)) {
    return failure("invalid", "adopt may name only existing Sources, Wikis or Outputs folders.", "Reload the page.");
  }
  const folder = (key: FolderKey) => typeof adopt[key] === "string" ? { id: adopt[key] as string } : { name: (names[key] as string).trim() };
  const timezone = body.timezone;
  if (!(timezone === null || timezone === undefined || isName(timezone))) return failure("invalid", "The timezone must be an IANA name or empty.", "Correct the timezone.");
  return {
    ok: true,
    value: {
      ...(body.workspace === "shared" ? { namespace: { folder: (names.host as string).trim() } } : {}),
      hostDocument: { title: (names.host as string).trim() },
      areas: { name: (names.areas as string).trim() }, projects: { name: (names.projects as string).trim() },
      sources: folder("sources"), wikis: folder("wikis"), outputs: folder("outputs"),
      preferences: { metadataLanguage: metadataLanguage as "en" | "zh-CN", timezone: typeof timezone === "string" ? timezone.trim() : null },
    },
    limits: [],
  };
}

export function createOnboarding(options: OnboardingOptions): OnboardingHandle {
  const { operations } = options;
  const idleMs = options.idleMs ?? 30 * 60 * 1000;
  let server: http.Server | null = null;
  let origin = "";
  const cookieName = "gpk_session_" + randomBytes(8).toString("hex");
  const launches = new Map<string, string>();
  const opening = serialQueue();
  let fallback: string | null = null;
  /** Session cookies issued by spending a launch token. */
  const sessions = new Set<string>();
  let idle: NodeJS.Timeout | null = null;

  const hasSession = (request: http.IncomingMessage) => {
    const value = (request.headers.cookie ?? "").split(/;\s*/).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return [...sessions].some(session => sameToken(value, session));
  };
  function touch(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { void handle.close(); }, idleMs);
    idle.unref();
  }

  async function access() {
    const grants = await operations.grantsList();
    if (!grants.ok) return grants;
    const proposal = await operations.setupProposeGrants();
    if (!proposal.ok) return proposal;
    return { ok: true as const, value: { proposal: proposal.value, grants: grants.value.items }, limits: [] };
  }

  async function state(): Promise<Result<unknown>> {
    const inspection = await operations.setupInspect();
    if (!inspection.ok) return inspection;
    const value: Json = { ...inspection.value, backends: KNOWLEDGE_BACKENDS };
    if (inspection.value.settings === "ready") {
      const permissions = await access();
      if (permissions.ok) {
        value.proposal = permissions.value.proposal;
        value.grantRecords = permissions.value.grants;
        value.granted = permissions.value.grants.map(item => item.value);
      } else value.accessError = permissions.error.message;
    }
    return { ok: true, value, limits: inspection.limits };
  }

  async function localState(): Promise<Result<unknown>> {
    const inspection = await operations.setupLocal();
    if (!inspection.ok) return inspection;
    const value: Json = { ...inspection.value, backends: KNOWLEDGE_BACKENDS };
    if (inspection.value.settings === "ready") {
      const permissions = await access();
      if (permissions.ok) {
        value.proposal = permissions.value.proposal;
        value.grantRecords = permissions.value.grants;
        value.granted = permissions.value.grants.map(item => item.value);
      } else value.accessError = permissions.error.message;
    }
    return { ok: true, value, limits: inspection.limits };
  }

  async function route(method: string, path: string, body: Json): Promise<Result<unknown>> {
    if (method === "GET" && path === "/api/service" && options.serviceInfo) return { ok: true, value: await options.serviceInfo(), limits: [] };
    if (method === "GET" && path === "/api/local") return localState();
    if (method === "GET" && path === "/api/runtime") return operations.runtimeStatus();
    if (method === "GET" && path === "/api/access") return access();
    if (method === "GET" && path === "/api/state") return state();
    if (method === "POST" && path === "/api/authorize") {
      const backend = KNOWLEDGE_BACKENDS.find(entry => entry.id === body.backend);
      if (!backend) return failure("invalid", "Unknown knowledge base.", "Choose one of the listed knowledge bases.");
      if (!backend.available) return failure("invalid", `${backend.name} is not supported yet.`, "Choose an available knowledge base.");
      // Craft redirects the browser back here; the session cookie (SameSite=Lax) rides along.
      return operations.connectionAuthorize(`${origin}/`);
    }
    if (method === "POST" && path === "/api/establish") {
      const current = await operations.setupInspect();
      if (current.ok && current.value.settings === "ready" && current.value.layout?.locations.every(location => location.status === "ok")) {
        return failure("invalid", "GPK is already set up in this workspace.", "Change preferences instead, or reset GPK to start over.");
      }
      const plan = planFromForm(body);
      if (!plan.ok) return plan;
      // Continue with a workspace already in the space: only one the inspection found,
      // reused whole by ID; nothing is created for the parts it already has.
      if (body.resume !== undefined) {
        const existing = current.ok ? (current.value.layout?.existing ?? []).find(entry => entry.home.id === body.resume) : undefined;
        if (!existing) return failure("invalid", "That GPK workspace was not found in this space.", "Reload the page and choose again.");
        const value = plan.value;
        value.hostDocument = { rootId: existing.home.id };
        value.areas = { id: existing.areas.id };
        value.projects = { id: existing.projects.id };
        if (existing.folders) {
          value.sources = { id: existing.folders.source.id };
          value.wikis = { id: existing.folders.wiki.id };
          value.outputs = { id: existing.folders.output.id };
          if (existing.namespace) value.namespace = { folderId: existing.namespace };
          else delete value.namespace;
        }
        if (existing.metadataLanguage && value.preferences) value.preferences = { ...value.preferences, metadataLanguage: existing.metadataLanguage };
      }
      // An adopted folder must be a folder the inspection found, with the name typed for it,
      // so the page can only reuse the same-named folder it showed, never an arbitrary ID.
      const adopt = (body.adopt ?? {}) as Record<string, string>;
      if (Object.keys(adopt).length) {
        const folders = current.ok ? current.value.layout?.candidates.folders ?? [] : [];
        const names = body.names as Json;
        for (const [key, id] of Object.entries(adopt)) {
          const found = folders.find(entry => entry.id === id);
          if (!found || found.name !== (names[key] as string).trim()) return failure("invalid", `The folder chosen for ${key} is not the existing "${(names[key] as string).trim()}" folder.`, "Reload the page and choose again.");
        }
      }
      return operations.setupEstablish(plan.value);
    }
    if (method === "POST" && path === "/api/grants") {
      const selection = body.grants;
      if (!Array.isArray(selection) || !selection.every(item => item && typeof item.root === "string" && Array.isArray(item.operations) && item.operations.every((op: unknown) => typeof op === "string"))) {
        return failure("invalid", "grants must be a list of { root, operations }.", "Reload the page.");
      }
      return operations.setupGrant(selection as GrantSelection[]);
    }
    if (method === "POST" && path === "/api/revoke") {
      const ref = body.ref as Json | undefined;
      if (!ref || typeof ref.scope !== "string" || typeof ref.id !== "string" || typeof body.expected !== "string" || !body.expected)
        return failure("invalid", "Select a saved grant.", "Refresh Configuration.");
      return operations.grantsRevoke({ scope: ref.scope, id: ref.id }, body.expected);
    }
    if (method === "POST" && path === "/api/preferences") {
      const changes: PreferenceChanges = {};
      if (body.contentLanguage !== undefined) {
        if (!(body.contentLanguage === null || isName(body.contentLanguage))) return failure("invalid", "The content language must be a language tag or empty.", "Correct it.");
        changes.contentLanguage = typeof body.contentLanguage === "string" ? body.contentLanguage.trim() : null;
      }
      if (body.timezone !== undefined) {
        if (!(body.timezone === null || isName(body.timezone))) return failure("invalid", "The timezone must be an IANA name or empty.", "Correct it.");
        changes.timezone = typeof body.timezone === "string" ? body.timezone.trim() : null;
      }
      if (body.instructions !== undefined) {
        if (typeof body.instructions !== "string") return failure("invalid", "Instructions must be text.", "Edit the instructions.");
        changes.instructions = body.instructions;
      }
      if (body.expected !== undefined && typeof body.expected !== "string") return failure("invalid", "Invalid settings revision.", "Reload the page.");
      return operations.settingsUpdate({ preferences: changes }, body.expected);
    }
    // Images & files: available once Settings exist, during onboarding or on any later visit.
    if (method === "POST" && path === "/api/uploads") {
      if (body.disconnect === true) return operations.uploadsDisconnect();
      if (typeof body.url !== "string" || !body.url.trim() || body.url.length > 512) return failure("invalid", "Paste the API URL of the Craft connection.", "Copy it from Craft: Imagine → API.");
      if (!(body.key === undefined || body.key === null || (typeof body.key === "string" && body.key.length <= 512))) return failure("invalid", "The API key must be text.", "Paste the key again.");
      return operations.uploadsConnect(body.url, typeof body.key === "string" && body.key.trim() ? body.key : undefined);
    }
    if (method === "POST" && path === "/api/files") {
      const roots = body.roots;
      if (!Array.isArray(roots) || roots.length > 20 || !roots.every(root => typeof root === "string" && root.trim() && root.length <= 1024)) return failure("invalid", "roots must be a list of folder paths.", "Reload the page.");
      return operations.filesSetRoots(roots as string[]);
    }
    if (method === "POST" && path === "/api/ingestion") {
      if (typeof body.enabled !== "boolean") return failure("invalid", "Specify whether to enable automatic session retention.", "Reload Configuration.");
      if (body.origins === undefined) {
        const retention = body.retention === undefined ? undefined : body.retention;
        const depth = body.depth === undefined ? undefined : body.depth;
        const instructions = body.instructions === undefined ? undefined : body.instructions;
        if (retention !== undefined && !["summary", "excerpts", "full"].includes(String(retention))) return failure("invalid", "Unsupported retention granularity.", "Choose summary, excerpts or full.");
        if (depth !== undefined && !["save", "wiki", "research"].includes(String(depth))) return failure("invalid", "Unsupported ingest depth.", "Choose save, wiki or research.");
        if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > 4000)) return failure("invalid", "Session instructions must be text of at most 4000 characters.", "Shorten the instructions.");
        return operations.sessionsConfigureSimple({
          enabled: body.enabled,
          retention: retention as IngestOriginPolicy["retention"] | undefined,
          depth: depth as IngestOriginPolicy["depth"] | undefined,
          instructions,
        });
      }
      if (!Array.isArray(body.origins) || body.origins.length > 20 || !body.origins.every(origin => origin && typeof origin.id === "string" && typeof origin.reader === "string" && typeof origin.location === "string" && origin.location.length <= 1024 && Array.isArray(origin.exclusions) && typeof origin.retention === "string" && typeof origin.instructions === "string")) return failure("invalid", "Choose session folders and whether to enable automatic retention.", "Reload the session settings.");
      return operations.sessionsConfigure(body.enabled, body.origins as IngestOriginPolicy[]);
    }
    return failure("invalid", `No route ${method} ${path}.`, "Reload the page.");
  }

  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

  async function serve(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const start = Date.now();
    const reply = (status: number, payload: unknown, type = "application/json; charset=utf-8") => {
      const outcome = payload && typeof payload === "object" && "ok" in payload ? payload as Result<unknown> : null;
      debug("onboarding", "request", {
        method: request.method, path: (request.url ?? "/").split("?")[0], status, took: since(start),
        ...(outcome ? (outcome.ok ? { ok: true } : { ok: false, code: outcome.error.code, message: outcome.error.message }) : status >= 400 ? { refused: typeof payload === "string" ? "page" : payload } : {}),
      });
      response.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": CSP,
        "referrer-policy": "no-referrer",
      });
      response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    const host = request.headers.host ?? "";
    const port = new URL(origin).port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(403, { error: "host" });
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && ["/", "/config", "/console", "/tools", "/sources"].includes(url.pathname)) {
      const given = url.searchParams.get("t");
      if (given !== null) {
        const destination = launches.get(given);
        if (!destination) return reply(403, "This onboarding link was already used or has expired. Ask the Agent to open GPK setup again.", "text/plain; charset=utf-8");
        // Spend the launch token: the URL stops working and the browser keeps a cookie.
        launches.delete(given);
        debug("onboarding", "launch-spent", { sessions: sessions.size + 1 });
        const session = randomBytes(24).toString("base64url");
        sessions.add(session);
        touch();
        debug("onboarding", "request", { method: request.method, path: "/", status: 303, took: since(start), note: "launch token traded for a session cookie" });
        response.writeHead(303, { location: destination, "set-cookie": `${cookieName}=${session}; HttpOnly; SameSite=Lax; Path=/`, "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
        return void response.end();
      }
      if (!hasSession(request)) return reply(403, "This onboarding link was already used or has expired. Ask the Agent to open GPK setup again.", "text/plain; charset=utf-8");
      touch();
      return reply(200, page, "text/html; charset=utf-8");
    }
    if (!url.pathname.startsWith("/api/")) return reply(404, { error: "not found" });
    if (!hasSession(request)) return reply(403, { error: "session" });
    const fetchSite = request.headers["sec-fetch-site"];
    if (fetchSite !== undefined && fetchSite !== "same-origin") return reply(403, { error: "site" });
    let body: Json = {};
    if (request.method === "POST") {
      // Writes need the markers a browser adds to a same-origin fetch; their absence is refused.
      const requestOrigin = request.headers.origin;
      if (requestOrigin !== origin && requestOrigin !== origin.replace("127.0.0.1", "localhost")) return reply(403, { error: "origin" });
      if (fetchSite !== "same-origin") return reply(403, { error: "site" });
      if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return reply(415, { error: "json only" });
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buf.length;
        if (length > 64 * 1024) return reply(413, { error: "too large" });
        chunks.push(buf);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { error: "invalid json" });
        body = parsed as Json;
      } catch { return reply(400, { error: "invalid json" }); }
      // The upload route's link and key are credentials; they never reach the debug log.
      debug("onboarding", "submit", { path: url.pathname, body: url.pathname === "/api/uploads" ? { fields: Object.keys(body) } : body });
    }
    touch();
    try {
      const run = () => route(request.method ?? "GET", url.pathname, body);
      reply(200, await (request.method === "POST" && options.exclusive ? options.exclusive(run) : run()));
    }
    catch { reply(500, failure("unavailable", "The onboarding request failed.", "Reload the page and try again.")); }
  }

  const handle: OnboardingHandle = {
    open(view = "setup") { return opening(async () => {
      if (!server) {
        const next = http.createServer((request, response) => {
          void serve(request, response).catch(() => {
            if (!response.headersSent) response.writeHead(500);
            response.end();
          });
        });
        const started = await new Promise<boolean>(resolve => {
          next.once("error", () => resolve(false));
          next.listen(0, "127.0.0.1", () => resolve(true));
        });
        if (!started) return failure("unavailable", "The onboarding page could not start a local server.", "Retry; check that the loopback interface is available.");
        next.unref();
        server = next;
        origin = `http://127.0.0.1:${(next.address() as AddressInfo).port}`;
        debug("onboarding", "server-start", { origin, idleMinutes: Math.round(idleMs / 60000) });
      }
      touch();
      // Each open mints a new launch token; a session already in a browser keeps working.
      const launch = randomBytes(24).toString("base64url");
      launches.set(launch, view === "console" ? "/console" : "/");
      if (launches.size > 64) launches.delete(launches.keys().next().value!);
      const url = `${origin}/?t=${launch}`;
      const opened = await options.openBrowser(url).catch(() => false);
      debug("onboarding", "open", { opened, sessions: sessions.size });
      if (opened) return { ok: true, value: { opened }, limits: [] };
      if (fallback) launches.delete(fallback);
      fallback = launch;
      return { ok: true, value: { opened, url }, limits: ["The browser could not be opened; show the URL to the user. It works once."] };
    }); },
    async close() {
      if (server) debug("onboarding", "server-stop");
      if (idle) clearTimeout(idle);
      idle = null;
      launches.clear();
      fallback = null;
      sessions.clear();
      const current = server;
      server = null;
      if (current) {
        current.closeAllConnections?.();
        await new Promise<void>(resolve => current.close(() => resolve()));
      }
    },
  };
  return handle;
}
