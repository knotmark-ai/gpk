import http from "node:http";
import {
  Client, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError,
  type OAuthClientMetadata, type OAuthClientProvider, type OAuthDiscoveryState,
  type StoredOAuthClientInformation, type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { Failure, Result } from "../domain/operation-types.js";
import type { SecretStore } from "./secret-store.js";

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
  /** Start or complete authorization. Pending results carry the URL the user must open. */
  authorize(): Promise<Result<{ state: "authorized" | "pending"; authorizationUrl?: string; space?: CraftSpace }>>;
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
/** Craft rate-limits bursts of reads; back off before surfacing 429 as unavailable. */
const RATE_LIMIT_DELAYS_MS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
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
  let authorizationError: string | null = null;
  const currentPending = (): { url: string; done: Promise<void> } | null => pending;

  async function load(): Promise<StoredRecord> {
    const raw = await options.secrets.read(options.secretKey);
    record = raw ? (JSON.parse(raw) as StoredRecord) : {};
    return record;
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
    async clientInformation() { return (record ?? await load()).client; },
    async saveClientInformation(info) { (record ?? await load()).client = info; await save(); },
    async tokens() {
      const current = record ?? await load();
      // Expired or missing: re-read the store first, another process may have rotated the pair.
      if (!tokensFresh(current.tokens)) await load();
      return record?.tokens;
    },
    async saveTokens(tokens) {
      (record ?? await load()).tokens = { ...tokens, obtainedAt: now() };
      await save();
    },
    async redirectToAuthorization(url) {
      pending = { url: url.toString(), done: pending?.done ?? Promise.resolve() };
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

  async function connect(): Promise<void> {
    if (client) return;
    const nextTransport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });
    const nextClient = new Client({ name: "gpk", version: "0.1.0" });
    try {
      await nextClient.connect(nextTransport);
    } catch (error) {
      await nextTransport.close().catch(() => undefined);
      // Keep the transport that holds the PKCE verifier so the callback can finish it.
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
    if (error instanceof UnauthorizedError) return failure("unauthorized", `Craft has not authorized GPK (${context}).`, "Run the connection authorization and approve GPK in the browser.");
    if (error instanceof SdkHttpError) {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 401 || status === 403) return failure("unauthorized", `Craft rejected GPK's credentials (${context}).`, "Re-run the connection authorization; the stored tokens may be revoked.");
      return failure("unavailable", `Craft endpoint error ${status} (${context}).`, "Retry after reading the affected records back; the effect of an interrupted write is unknown.");
    }
    return failure("unavailable", `Craft connection failed (${context}).`, "Check network access to the endpoint and retry after reading affected records back.");
  }

  function waitForCallback(): Promise<URLSearchParams> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirectUrl);
        if (url.pathname !== "/callback") { response.writeHead(404).end(); return; }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
          .end("GPK: authorization received. You can close this tab.");
        server.close();
        if (url.searchParams.get("error")) reject(new Error(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "authorization error"));
        else resolve(url.searchParams);
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1");
      setTimeout(() => { server.close(); reject(new Error("authorization timed out")); }, 15 * 60 * 1000).unref();
    });
  }

  async function callTool(tool: "craft_read" | "craft_write", command: string): Promise<Result<string>> {
    let attempt = 0;
    let rateLimited = 0;
    let serverRetried = false;
    for (;;) {
      attempt++;
      try {
        await connect();
        const result = await client!.callTool({ name: tool, arguments: { command } }, { timeout: 60_000 });
        const text = (result.content as Array<{ type: string; text?: string }> | undefined)
          ?.filter(item => item.type === "text").map(item => item.text ?? "").join("\n") ?? "";
        if (result.isError || /^(Failed|Error|Invalid)\b/.test(text)) {
          const code: Failure["code"] = /not found|no such|does not exist/i.test(text) ? "not-found" : "invalid";
          return failure(code, text.slice(0, 500), "Correct the request against the current record; nothing is known to have changed.");
        }
        return { ok: true, value: text, limits: [] };
      } catch (error) {
        if (error instanceof SdkHttpError && (error as { status?: number }).status === 429 && rateLimited < RATE_LIMIT_DELAYS_MS.length) {
          await sleep(RATE_LIMIT_DELAYS_MS[rateLimited++]!);
          attempt--;
          continue;
        }
        // Craft answers an occasional 500; a read is safe to repeat once, a write is not.
        if (error instanceof SdkHttpError && ((error as { status?: number }).status ?? 0) >= 500 && tool === "craft_read" && !serverRetried) {
          serverRetried = true;
          await sleep(1000);
          attempt--;
          continue;
        }
        const mapped = mapError(error, tool);
        // One reconnect covers a stale session or a token rotated by another process.
        // A write is repeated only when the server provably did not run it (auth or an
        // expired session); after a 5xx or a network failure its effect is unknown, and
        // repeating it could create a second document, row or block.
        const status = error instanceof SdkHttpError ? (error as { status?: number }).status ?? 0 : 0;
        const notExecuted = error instanceof UnauthorizedError || status === 401 || status === 403 || status === 404;
        if (attempt === 1 && mapped.ok === false && mapped.error.code !== "invalid" && (tool === "craft_read" || notExecuted)) {
          await disconnect();
          record = null;
          continue;
        }
        return mapped;
      }
    }
  }

  const connection: CraftConnection = {
    async status() {
      const current = record ?? await load();
      let tokens: ConnectionStatus["tokens"] = current.tokens?.access_token ? "stored" : "none";
      let currentSpace = space ?? undefined;
      if (tokens === "stored" && !currentSpace) {
        const probe = await connection.space();
        if (probe.ok) { currentSpace = probe.value; tokens = "verified"; }
      } else if (currentSpace) {
        tokens = "verified";
      }
      return {
        endpoint: endpoint.toString(), secretStore: options.secrets.description,
        registered: Boolean(current.client), tokens,
        ...(pending ? { pendingAuthorizationUrl: pending.url } : {}),
        ...(authorizationError ? { authorizationError } : {}),
        ...(currentSpace ? { space: currentSpace } : {}),
      };
    },
    async authorize() {
      if (pending) return { ok: true, value: { state: "pending", authorizationUrl: pending.url }, limits: ["An authorization is already waiting for the browser callback."] };
      await load();
      try {
        await connect();
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) return mapError(error, "authorize");
        const started = currentPending();
        const waiting = transport;
        if (!started || !waiting) return failure("unavailable", "Craft did not provide an authorization URL.", "Retry; if it persists, check the endpoint configuration.");
        const authorizationUrl = started.url;
        authorizationError = null;
        const done = (async () => {
          try {
            const params = await waitForCallback();
            await waiting.finishAuth(params);
            await waiting.close().catch(() => undefined);
            transport = null;
            await connect();
          } catch (error) {
            // The browser flow fails out of band; keep the reason for the next status call.
            authorizationError = error instanceof Error ? error.message : String(error);
            throw error;
          } finally {
            pending = null;
          }
        })();
        done.catch(() => undefined);
        pending = { url: authorizationUrl, done };
        return { ok: true, value: { state: "pending", authorizationUrl }, limits: ["Open the URL, approve the space, and call the status operation afterwards."] };
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
        const parsed = JSON.parse(result.value) as { space: CraftSpace };
        space = { id: parsed.space.id, name: parsed.space.name, timezone: parsed.space.timezone };
        return { ok: true, value: space, limits: [] };
      } catch {
        return failure("unavailable", "connection info returned an unexpected payload.", "Retry; if it persists the connector surface changed.");
      }
    },
    async close() { await disconnect(); },
  };
  return connection;
}
