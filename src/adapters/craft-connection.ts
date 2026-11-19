import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { serialQueue } from "../runtime/serial.js";
import {
  Client, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError,
  type OAuthClientMetadata, type OAuthClientProvider, type OAuthDiscoveryState,
  type StoredOAuthClientInformation, type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { Failure, Result } from "../domain/operation-types.js";
import type { SecretStore } from "./secret-store.js";
import { debug, since } from "../runtime/debug-log.js";

/**
 * GPK's own authorized client to one Craft MCP endpoint.
 *
 * Craft authorizes this client independently of any host connector. Registration,
 * tokens, PKCE verifier and discovery state are persisted as one JSON record in the
 * secret store under `secretKey`, so every GPK process for the same instance shares
 * one authorization. Refresh tokens rotate: before any refresh the record is
 * re-read, because another process may already have saved the new pair.
 */
export type CraftConnectionOptions = {
  endpoint: string;
  secretKey: string;
  secrets: SecretStore;
  /** Fixed loopback port for the OAuth redirect; it is part of the registered client. */
  callbackPort?: number;
  clientName?: string;
  now?: () => number;
};

export type CraftSpace = { id: string; name: string; timezone: string };

export type ConnectionStatus = {
  endpoint: string;
  secretStore: string;
  registered: boolean;
  tokens: "none" | "stored" | "verified";
  pendingAuthorizationUrl?: string;
  /** Why the last browser authorization did not end in stored tokens; cleared when a new one starts. */
  authorizationError?: string;
  space?: CraftSpace;
};

export interface CraftConnection {
  status(): Promise<ConnectionStatus>;
  /** Non-blocking local snapshot of stored credentials and any already-cached space metadata (no network probe). */
  peekStatus?(): Promise<ConnectionStatus>;
  /** Start or complete authorization. Pending results carry the URL the user must open;
   * `returnTo` is where the browser goes after Craft redirects back (the onboarding page).
   */
  authorize(returnTo?: string): Promise<Result<{ state: "authorized" | "pending"; authorizationUrl?: string; space?: CraftSpace }>>;
  /** Run one craft_read command and return its text. */
  read(command: string): Promise<Result<string>>;
  /** Run one craft_write command and return its text. */
  write(command: string): Promise<Result<string>>;
  /** Cached connection metadata for the authorized space. */
  space(): Promise<Result<CraftSpace>>;
  close(): Promise<void>;
}

type StoredRecord = {
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens & { obtainedAt?: number };
  verifier?: string;
  discovery?: OAuthDiscoveryState;
};

const DEFAULT_CALLBACK_PORT = 46017;
const REFRESH_SKEW_MS = 60_000;
const RATE_LIMIT_DELAYS_MS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

function safeReturnUrl(returnTo: string | undefined): string | null {
  if (!returnTo || /[\r\n]/.test(returnTo)) return null;
  try {
    const parsed = new URL(returnTo);
    if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") || !parsed.port) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sameState(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCraftConnection(options: CraftConnectionOptions): CraftConnection {
  const endpoint = new URL(options.endpoint);
  const port = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const redirectUrl = `http://127.0.0.1:${port}/callback`;
  const now = options.now ?? Date.now;
  let record: StoredRecord | null = null;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let space: CraftSpace | null = null;
  let pending: { url: string; done: Promise<void> } | null = null;
  let authorizationUrl: string | null = null;
  let pendingState: string | null = null;
  let cancelCallback: (() => void) | null = null;
  let authorizationError: string | null = null;

  async function load(): Promise<StoredRecord> {
    try {
      const raw = await options.secrets.read(options.secretKey);
      if (!raw) { record = {}; return record; }
      const parsed: unknown = JSON.parse(raw);
      record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredRecord) : {};
      return record;
    } catch {
      record = {};
      return record;
    }
  }
  async function save(): Promise<void> {
    await options.secrets.write(options.secretKey, JSON.stringify(record ?? {}));
  }
  function tokensFresh(tokens: StoredRecord["tokens"]): boolean {
    if (!tokens?.access_token) return false;
    if (!tokens.expires_in || !tokens.obtainedAt) return true;
    return now() < tokens.obtainedAt + tokens.expires_in * 1000 - REFRESH_SKEW_MS;
  }

  const provider: OAuthClientProvider = {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: options.clientName ?? "GPK",
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    async state() {
      pendingState = randomBytes(24).toString("base64url");
      return pendingState;
    },
    async clientInformation() { return (record ?? await load()).client; },
    async saveClientInformation(info) { (record ?? await load()).client = info; await save(); },
    async tokens() {
      const current = record ?? await load();
      if (!tokensFresh(current.tokens)) await load();
      return record?.tokens;
    },
    async saveTokens(tokens) {
      debug("craft", "tokens-saved", { expiresIn: tokens.expires_in, refreshToken: Boolean(tokens.refresh_token) });
      (record ?? await load()).tokens = { ...tokens, obtainedAt: now() };
      await save();
    },
    async invalidateCredentials(scope) {
      if (scope === "all") {
        await options.secrets.remove(options.secretKey);
        record = {};
        space = null;
        return;
      }
      const previous = record;
      const current = await load();
      if (scope === "tokens") {
        space = null;
        if (previous?.tokens?.refresh_token !== current.tokens?.refresh_token ||
            previous?.tokens?.access_token !== current.tokens?.access_token) return;
      }
      if (current[scope] === undefined) return;
      delete current[scope];
      await save();
    },
    async redirectToAuthorization(url) {
      debug("craft", "oauth-redirect", { url: url.toString() });
      authorizationUrl = url.toString();
    },
    async saveCodeVerifier(verifier) { (record ?? await load()).verifier = verifier; await save(); },
    async codeVerifier() {
      const verifier = (record ?? await load()).verifier;
      if (!verifier) throw new Error("No pending authorization.");
      return verifier;
    },
    async saveDiscoveryState(state) { (record ?? await load()).discovery = state; await save(); },
    async discoveryState() { return (record ?? await load()).discovery; },
  };

  async function connect(finishingAuthorization = false): Promise<void> {
    if (client) return;
    if (pending && !finishingAuthorization) throw new UnauthorizedError();
    const nextTransport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });
    const nextClient = new Client({ name: "gpk", version: "0.1.0" });
    try {
      await nextClient.connect(nextTransport);
    } catch (error) {
      await nextTransport.close().catch(() => undefined);
      if (error instanceof UnauthorizedError) transport = nextTransport;
      throw error;
    }
    client = nextClient;
    transport = nextTransport;
  }

  async function disconnect(): Promise<void> {
    const current = client;
    client = null;
    transport = null;
    await current?.close().catch(() => undefined);
  }

  function mapError(error: unknown, context: string): Result<never> {
    if (error instanceof UnauthorizedError) return failure("unauthorized", `Craft has not authorized GPK (${context}).`, "Call gpk_setup_open; the user connects Craft on the onboarding page.");
    const retryAuthorization = "Try Connect Craft again. If it still fails, check access to Craft's authorization service.";
    if (error instanceof SdkHttpError) {
      const status = error.status ?? 0;
      if (status === 401 || status === 403) return failure("unauthorized", `Craft rejected GPK's credentials (${context}).`, "Call gpk_setup_open and reconnect Craft there; the stored tokens may be revoked.");
      return failure("unavailable", `Craft endpoint error ${status} (${context}).`, context === "authorize" ? retryAuthorization : "Retry after reading the affected records back; the effect of an interrupted write is unknown.");
    }
    if (context === "authorize") return failure("unavailable", "GPK could not start Craft authorization.", retryAuthorization);
    return failure("unavailable", `Craft connection failed (${context}).`, "Check network access to the endpoint and retry after reading affected records back.");
  }

  async function startCallbackListener(expectedState: string | null, returnTo?: string): Promise<Result<Promise<URLSearchParams>>> {
    let settle!: (error?: Error, params?: URLSearchParams) => void;
    let timer: NodeJS.Timeout | null = null;
    const validReturnTo = safeReturnUrl(returnTo);
    const server = http.createServer((request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? "/", redirectUrl); }
      catch { response.writeHead(400).end(); return; }
      if (url.pathname !== "/callback") { response.writeHead(404).end(); return; }
      if (expectedState && !sameState(url.searchParams.get("state"), expectedState)) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("GPK: invalid or expired authorization state.");
        return;
      }
      if (!url.searchParams.get("code") && !url.searchParams.get("error")) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("GPK: missing authorization parameters.");
        return;
      }
      debug("craft", "oauth-callback", { error: url.searchParams.get("error") ?? undefined, returnTo: validReturnTo ?? undefined });
      if (validReturnTo) response.writeHead(302, { location: validReturnTo }).end();
      else response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("GPK: authorization received. You can close this tab.");
      response.once("finish", () => {
        if (url.searchParams.get("error")) settle(new Error(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "authorization error"));
        else settle(undefined, url.searchParams);
      });
    });

    const bound = await new Promise<Error | null>(resolve => {
      server.once("error", err => resolve(err));
      server.listen(port, "127.0.0.1", () => resolve(null));
    });
    if (bound) {
      server.close();
      return failure("unavailable", `Could not bind the OAuth callback listener on 127.0.0.1:${port}.`, "Close any conflicting process using that port and retry.");
    }
    debug("craft", "oauth-callback-listening", { port });

    const promise = new Promise<URLSearchParams>((resolve, reject) => {
      let done = false;
      settle = (error?: Error, params?: URLSearchParams) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        cancelCallback = null;
        server.close();
        server.closeAllConnections();
        if (error) reject(error); else resolve(params!);
      };
      server.on("error", err => settle(err));
      cancelCallback = () => settle(new Error("authorization canceled"));
      timer = setTimeout(() => settle(new Error("authorization timed out")), 15 * 60 * 1000);
      timer.unref();
    });
    return { ok: true, value: promise, limits: [] };
  }

  async function callTool(tool: "craft_read" | "craft_write", command: string): Promise<Result<string>> {
    if (pending) return failure("unauthorized", "Craft authorization is pending.", "Finish the authorization in the browser.");
    let attempt = 0;
    let rateLimited = 0;
    let serverRetried = false;
    const start = Date.now();
    for (;;) {
      attempt++;
      try {
        await connect();
        const result = await client!.callTool({ name: tool, arguments: { command } }, { timeout: 60_000 });
        const text = (result.content as Array<{ type: string; text?: string }> | undefined)
          ?.filter(item => item.type === "text").map(item => item.text ?? "").join("\n") ?? "";
        if (result.isError || /^(Failed|Error|Invalid)\b/.test(text)) {
          const code: Failure["code"] = /not found|no such|does not exist/i.test(text) ? "not-found" : "invalid";
          debug("craft", tool === "craft_read" ? "read-failed" : "write-failed", { command, took: since(start), code, answer: text });
          return failure(code, text.slice(0, 500), "Correct the request against the current record; nothing is known to have changed.");
        }
        debug("craft", tool === "craft_read" ? "read" : "write", { command, took: since(start), bytes: text.length, ...(attempt > 1 ? { attempt } : {}) });
        return { ok: true, value: text, limits: [] };
      } catch (error) {
        const httpStatus = error instanceof SdkHttpError ? error.status : undefined;
        if (error instanceof SdkHttpError && error.status === 429 && rateLimited < RATE_LIMIT_DELAYS_MS.length) {
          debug("craft", "rate-limited", { command, waitMs: RATE_LIMIT_DELAYS_MS[rateLimited] });
          await sleep(RATE_LIMIT_DELAYS_MS[rateLimited++]!);
          attempt--;
          continue;
        }
        if (error instanceof SdkHttpError && (error.status ?? 0) >= 500 && tool === "craft_read" && !serverRetried) {
          serverRetried = true;
          debug("craft", "server-error-retry", { command, status: httpStatus });
          await sleep(1000);
          attempt--;
          continue;
        }
        const mapped = mapError(error, tool);
        const status = error instanceof SdkHttpError ? error.status ?? 0 : 0;
        const notExecuted = error instanceof UnauthorizedError || status === 401 || status === 403 || status === 404;
        if (attempt === 1 && mapped.ok === false && mapped.error.code !== "invalid" && (tool === "craft_read" || notExecuted)) {
          debug("craft", "reconnect-retry", { command, status: httpStatus, reason: mapped.error.message });
          await disconnect();
          record = null;
          continue;
        }
        debug("craft", "call-failed", { tool, command, took: since(start), status: httpStatus, code: mapped.ok ? undefined : mapped.error.code, error: error instanceof Error ? error.message : String(error) });
        return mapped;
      }
    }
  }

  const run = serialQueue();
  const connection: CraftConnection = {
    async status() {
      const current = record ?? await load();
      let tokens: ConnectionStatus["tokens"] = current.tokens?.access_token ? "stored" : "none";
      let currentSpace = space ?? undefined;
      if (!pending && tokens === "stored" && !currentSpace) {
        const probe = await connection.space();
        if (probe.ok) { currentSpace = probe.value; tokens = "verified"; }
        else if (!record?.tokens?.access_token) tokens = "none";
      } else if (currentSpace) {
        tokens = "verified";
      }
      return {
        endpoint: endpoint.toString(), secretStore: options.secrets.description,
        registered: Boolean(record?.client), tokens,
        ...(pending ? { pendingAuthorizationUrl: pending.url } : {}),
        ...(authorizationError ? { authorizationError } : {}),
        ...(currentSpace ? { space: currentSpace } : {}),
      };
    },
    async authorize(returnTo) {
      debug("craft", "authorize", { pending: Boolean(pending), returnTo });
      if (pending) return { ok: true, value: { state: "pending", authorizationUrl: pending.url }, limits: ["An authorization is already waiting for the browser callback."] };
      authorizationUrl = null;
      pendingState = null;
      await load();
      try {
        await connect();
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) return mapError(error, "authorize");
        const waiting = transport;
        const url = authorizationUrl;
        const expectedState = pendingState;
        if (!url || !waiting) return failure("unavailable", "Craft did not provide an authorization URL.", "Retry; if it persists, check the endpoint configuration.");
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
          if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && (parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost"))) {
            throw new Error("Unsupported authorization URL scheme");
          }
        } catch {
          return failure("unavailable", "Craft returned an invalid authorization URL.", "Check the configured Craft endpoint.");
        }
        const listener = await startCallbackListener(expectedState, returnTo);
        if (!listener.ok) {
          await waiting.close().catch(() => undefined);
          transport = null;
          return listener;
        }
        authorizationError = null;
        const done = (async () => {
          try {
            const params = await listener.value;
            await run(async () => {
              await waiting.finishAuth(params);
              await waiting.close().catch(() => undefined);
              transport = null;
              await connect(true);
            });
            debug("craft", "oauth-complete");
          } catch (err) {
            authorizationError = err instanceof Error ? err.message : String(err);
            debug("craft", "oauth-failed", { error: authorizationError });
            throw err;
          } finally {
            pending = null;
          }
        })();
        done.catch(() => undefined);
        pending = { url: parsedUrl.toString(), done };
        return { ok: true, value: { state: "pending", authorizationUrl: parsedUrl.toString() }, limits: ["Open the URL, approve the space, and call the status operation afterwards."] };
      }
      const probe = await connection.space();
      return probe.ok
        ? { ok: true, value: { state: "authorized", space: probe.value }, limits: [] }
        : probe;
    },
    read: command => callTool("craft_read", command),
    write: command => callTool("craft_write", command),
    async space() {
      if (space) return { ok: true, value: space, limits: [] };
      const result = await callTool("craft_read", "connection info");
      if (!result.ok) return result;
      try {
        const parsed = JSON.parse(result.value) as { space?: Partial<CraftSpace> };
        const candidate = parsed?.space;
        if (!candidate || typeof candidate.id !== "string" || !candidate.id ||
            typeof candidate.name !== "string" || typeof candidate.timezone !== "string" || !candidate.timezone) {
          throw new Error("Missing space fields");
        }
        new Intl.DateTimeFormat("en", { timeZone: candidate.timezone }).format();
        space = { id: candidate.id, name: candidate.name, timezone: candidate.timezone };
        debug("craft", "space", { name: space.name, timezone: space.timezone });
        return { ok: true, value: space, limits: [] };
      } catch {
        return failure("unavailable", "connection info returned an unexpected payload.", "Retry; if it persists the connector surface changed.");
      }
    },
    async close() {
      const waiting = pending?.done;
      cancelCallback?.();
      await waiting?.catch(() => undefined);
      await disconnect();
    },
  };
  async function peekStatus(): Promise<ConnectionStatus> {
    const current = record ?? await load();
    const currentSpace = space ?? undefined;
    const tokens: ConnectionStatus["tokens"] = currentSpace ? "verified" : current.tokens?.access_token ? "stored" : "none";
    return {
      endpoint: endpoint.toString(), secretStore: options.secrets.description,
      registered: Boolean(current.client), tokens,
      ...(pending ? { pendingAuthorizationUrl: pending.url } : {}),
      ...(authorizationError ? { authorizationError } : {}),
      ...(currentSpace ? { space: currentSpace } : {}),
    };
  }

  return {
    status: () => run(() => connection.status()),
    peekStatus,
    space: () => run(() => connection.space()),
    authorize: returnTo => run(() => connection.authorize(returnTo)),
    read: command => run(() => connection.read(command)),
    write: command => run(() => connection.write(command)),
    close: () => run(() => connection.close()),
  };
}
