import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Result } from "../domain/operation-types.js";
import type { GrantSelection, Operations, SetupPlan } from "../runtime/operations.js";
import page from "./page.html";

/**
 * The onboarding page: GPK's Setup surface. It is served from the runtime process on
 * the loopback interface and drives the same operations as every other surface, so
 * its only product is settings.json and grants.json. Grants are written only here,
 * by the user's own clicks; the Agent opens the page but cannot confirm it.
 *
 * Any web page in the user's browser can send requests to 127.0.0.1, so every request
 * must carry the per-session token (query for the page, header for the API), name
 * this server in Host (against DNS rebinding) and, for writes, come from this origin
 * with a JSON body (so no cross-site form can trigger one).
 */
export type OnboardingOptions = {
  operations: Operations;
  /** Opens a URL in the user's browser; false when it could not. */
  openBrowser: (url: string) => Promise<boolean>;
  /** Close the server after this much inactivity (default 30 minutes). */
  idleMs?: number;
};

export type OnboardingHandle = {
  /** Start (or reuse) the server and open the page; returns its URL. */
  open(): Promise<Result<{ url: string; opened: boolean }>>;
  close(): Promise<void>;
};

type Json = Record<string, unknown>;
const LANGUAGES = ["en", "zh-CN"] as const;

function failure(code: "invalid" | "unavailable", message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

function sameToken(given: string | undefined | null, token: string): boolean {
  if (!given) return false;
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
  let token = "";
  let idle: NodeJS.Timeout | null = null;

  const pageUrl = () => `${origin}/?t=${token}`;
  function touch(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { void handle.close(); }, idleMs);
    idle.unref();
  }

  async function state(): Promise<Result<unknown>> {
    const inspection = await operations.setupInspect();
    if (!inspection.ok) return inspection;
    const value: Json = { ...inspection.value };
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
    if (method === "POST" && path === "/api/authorize") return operations.connectionAuthorize(pageUrl());
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
    const reply = (status: number, payload: unknown, type = "application/json; charset=utf-8") => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    const host = request.headers.host ?? "";
    const port = new URL(origin).port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(403, { error: "host" });
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && url.pathname === "/") {
      if (!sameToken(url.searchParams.get("t"), token)) return reply(403, "This onboarding link has expired. Ask the Agent to open GPK setup again.", "text/plain; charset=utf-8");
      touch();
      return reply(200, page, "text/html; charset=utf-8");
    }
    if (!url.pathname.startsWith("/api/")) return reply(404, { error: "not found" });
    if (!sameToken(request.headers["x-gpk-token"] as string | undefined, token)) return reply(403, { error: "token" });
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== origin.replace("127.0.0.1", "localhost")) return reply(403, { error: "origin" });
    let body: Json = {};
    if (request.method === "POST") {
      if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return reply(415, { error: "json only" });
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 64 * 1024) return reply(413, { error: "too large" }); }
      try { body = raw ? JSON.parse(raw) as Json : {}; } catch { return reply(400, { error: "invalid json" }); }
    }
    touch();
    try { reply(200, await route(request.method ?? "GET", url.pathname, body)); }
    catch { reply(500, failure("unavailable", "The onboarding request failed.", "Reload the page and try again.")); }
  }

  const handle: OnboardingHandle = {
    async open() {
      if (!server) {
        token = randomBytes(24).toString("base64url");
        const next = http.createServer((request, response) => { void serve(request, response); });
        const started = await new Promise<boolean>(resolve => {
          next.once("error", () => resolve(false));
          next.listen(0, "127.0.0.1", () => resolve(true));
        });
        if (!started) return failure("unavailable", "The onboarding page could not start a local server.", "Retry; check that the loopback interface is available.");
        next.unref();
        server = next;
        origin = `http://127.0.0.1:${(next.address() as AddressInfo).port}`;
      }
      touch();
      const url = pageUrl();
      const opened = await options.openBrowser(url).catch(() => false);
      return { ok: true, value: { url, opened }, limits: opened ? [] : ["The browser could not be opened; show the URL to the user."] };
    },
    async close() {
      if (idle) clearTimeout(idle);
      idle = null;
      const current = server;
      server = null;
      if (current) await new Promise<void>(resolve => current.close(() => resolve()));
    },
  };
  return handle;
}
