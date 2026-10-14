import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Result } from "../domain/operation-types.js";
import type { GrantSelection, Operations, SetupPlan } from "../runtime/operations.js";
import page from "./page.html";
import { debug, since } from "../runtime/debug-log.js";

/**
 * The onboarding page: GPK's Setup surface. It is served from the runtime process on
 * the loopback interface and drives the same operations as every other surface, so
 * its only product is settings.json and grants.json. Grants are written only here,
 * by the user's own clicks; the Agent opens the page but cannot confirm it.
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
  /** Opens a URL in the user's browser; false when it could not. */
  openBrowser: (url: string) => Promise<boolean>;
  /** Close the server after this much inactivity (default 30 minutes). */
  idleMs?: number;
};

export type OnboardingHandle = {
  /** Start (or reuse) the server and open the page; the URL is returned only when no browser opened. */
  open(): Promise<Result<{ opened: boolean; url?: string }>>;
  close(): Promise<void>;
};

type Json = Record<string, unknown>;
const LANGUAGES = ["en", "zh-CN"] as const;
const SESSION_COOKIE = "gpk_session";

/**
 * Knowledge bases the page offers. Only implemented adapters are available; the
 * others are listed so the page does not read as tied to one product, and the
 * server refuses to connect them.
 */
export const KNOWLEDGE_BACKENDS: readonly { id: string; name: string; available: boolean }[] = [
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

/** The plan the page submitted, checked field by field; the page never passes IDs. */
export function planFromForm(body: Json): Result<SetupPlan> {
  const names = body.names as Json | undefined;
  const metadataLanguage = body.metadataLanguage;
  const workingLanguage = body.workingLanguage;
  if (!names || !["host", "areas", "projects", "sources", "wikis", "outputs"].every(key => isName(names[key]))) {
    return failure("invalid", "Every name must be nonblank text of at most 80 characters.", "Correct the names.");
  }
  if (!LANGUAGES.includes(metadataLanguage as never)) return failure("invalid", "Unsupported metadata language.", "Choose en or zh-CN.");
  if (!isName(workingLanguage)) return failure("invalid", "The working language must be a language code.", "Choose a working language.");
  if (body.workspace !== "dedicated" && body.workspace !== "shared") return failure("invalid", "Choose a dedicated or shared workspace.", "Pick one.");
  const timezone = body.timezone;
  if (!(timezone === null || timezone === undefined || isName(timezone))) return failure("invalid", "The timezone must be an IANA name or empty.", "Correct the timezone.");
  return {
    ok: true,
    value: {
      ...(body.workspace === "shared" ? { namespace: { folder: (names.host as string).trim() } } : {}),
      hostDocument: { title: (names.host as string).trim() },
      areas: { name: (names.areas as string).trim() }, projects: { name: (names.projects as string).trim() },
      sources: { name: (names.sources as string).trim() }, wikis: { name: (names.wikis as string).trim() }, outputs: { name: (names.outputs as string).trim() },
      preferences: { workingLanguage: (workingLanguage as string).trim(), metadataLanguage: metadataLanguage as "en" | "zh-CN", timezone: typeof timezone === "string" ? timezone.trim() : null },
    },
    limits: [],
  };
}

export function createOnboarding(options: OnboardingOptions): OnboardingHandle {
  const { operations } = options;
  const idleMs = options.idleMs ?? 30 * 60 * 1000;
  let server: http.Server | null = null;
  let origin = "";
  /** One-time token in the URL handed to the browser; null once spent. */
  let launch: string | null = null;
  /** Session cookies issued by spending a launch token. */
  const sessions = new Set<string>();
  let idle: NodeJS.Timeout | null = null;

  const hasSession = (request: http.IncomingMessage) => {
    const value = (request.headers.cookie ?? "").split(/;\s*/).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return [...sessions].some(session => sameToken(value, session));
  };
  function touch(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { void handle.close(); }, idleMs);
    idle.unref();
  }

  async function state(): Promise<Result<unknown>> {
    const inspection = await operations.setupInspect();
    if (!inspection.ok) return inspection;
    const value: Json = { ...inspection.value, backends: KNOWLEDGE_BACKENDS };
    if (inspection.value.settings === "ready") {
      const proposal = await operations.setupProposeGrants();
      const grants = await operations.grantsList();
      value.proposal = proposal.ok ? proposal.value : null;
      value.granted = grants.ok ? grants.value.items.map(item => item.value) : [];
    }
    return { ok: true, value, limits: inspection.limits };
  }

  async function route(method: string, path: string, body: Json): Promise<Result<unknown>> {
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
      return plan.ok ? operations.setupEstablish(plan.value) : plan;
    }
    if (method === "POST" && path === "/api/grants") {
      const selection = body.grants;
      if (!Array.isArray(selection) || !selection.every(item => item && typeof item.root === "string" && Array.isArray(item.operations) && item.operations.every((op: unknown) => typeof op === "string"))) {
        return failure("invalid", "grants must be a list of { root, operations }.", "Reload the page.");
      }
      return operations.setupGrant(selection as GrantSelection[]);
    }
    if (method === "POST" && path === "/api/preferences") {
      const changes: Json = {};
      if (body.workingLanguage !== undefined) { if (!isName(body.workingLanguage)) return failure("invalid", "The working language must be a language code.", "Correct it."); changes.workingLanguage = (body.workingLanguage as string).trim(); }
      if (body.timezone !== undefined) { if (!(body.timezone === null || isName(body.timezone))) return failure("invalid", "The timezone must be an IANA name or empty.", "Correct it."); changes.timezone = body.timezone; }
      return operations.settingsUpdate({ preferences: changes });
    }
    return failure("invalid", `No route ${method} ${path}.`, "Reload the page.");
  }

  async function serve(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const start = Date.now();
    const reply = (status: number, payload: unknown, type = "application/json; charset=utf-8") => {
      const outcome = payload && typeof payload === "object" && "ok" in payload ? payload as Result<unknown> : null;
      debug("onboarding", "request", {
        method: request.method, path: (request.url ?? "/").split("?")[0], status, took: since(start),
        ...(outcome ? (outcome.ok ? { ok: true } : { ok: false, code: outcome.error.code, message: outcome.error.message }) : status >= 400 ? { refused: typeof payload === "string" ? "page" : payload } : {}),
      });
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    const host = request.headers.host ?? "";
    const port = new URL(origin).port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(403, { error: "host" });
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && url.pathname === "/") {
      const given = url.searchParams.get("t");
      if (given !== null) {
        if (!sameToken(given, launch)) return reply(403, "This onboarding link was already used or has expired. Ask the Agent to open GPK setup again.", "text/plain; charset=utf-8");
        // Spend the launch token: the URL stops working and the browser keeps a cookie.
        launch = null;
        debug("onboarding", "launch-spent", { sessions: sessions.size + 1 });
        const session = randomBytes(24).toString("base64url");
        sessions.add(session);
        touch();
        debug("onboarding", "request", { method: request.method, path: "/", status: 303, took: since(start), note: "launch token traded for a session cookie" });
        response.writeHead(303, { location: "/", "set-cookie": `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
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
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 64 * 1024) return reply(413, { error: "too large" }); }
      try { body = raw ? JSON.parse(raw) as Json : {}; } catch { return reply(400, { error: "invalid json" }); }
      debug("onboarding", "submit", { path: url.pathname, body });
    }
    touch();
    try { reply(200, await route(request.method ?? "GET", url.pathname, body)); }
    catch { reply(500, failure("unavailable", "The onboarding request failed.", "Reload the page and try again.")); }
  }

  const handle: OnboardingHandle = {
    async open() {
      if (!server) {
        const next = http.createServer((request, response) => { void serve(request, response); });
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
      launch = randomBytes(24).toString("base64url");
      const url = `${origin}/?t=${launch}`;
      const opened = await options.openBrowser(url).catch(() => false);
      debug("onboarding", "open", { opened, sessions: sessions.size });
      if (opened) return { ok: true, value: { opened }, limits: [] };
      return { ok: true, value: { opened, url }, limits: ["The browser could not be opened; show the URL to the user. It works once."] };
    },
    async close() {
      if (server) debug("onboarding", "server-stop");
      if (idle) clearTimeout(idle);
      idle = null;
      launch = null;
      sessions.clear();
      const current = server;
      server = null;
      if (current) await new Promise<void>(resolve => current.close(() => resolve()));
    },
  };
  return handle;
}
