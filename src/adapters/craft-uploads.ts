import type { Failure, Result } from "../domain/operation-types.js";
import { debug } from "../runtime/debug-log.js";

/**
 * Craft's REST API route for file bytes. The MCP surface inserts media only by URL,
 * so local files go through `POST /upload` of a Craft API connection, which the user
 * creates in Craft (Imagine → API) and pastes on the onboarding page. The connection
 * is an unguessable link `https://connect.craft.do/links/<id>/api/v1`, optionally
 * protected by an API key; both live in the secret store, never in Settings.
 */
export type UploadCredentials = { url: string; key?: string };

export type UploadedAsset = { blockId: string; assetUrl: string };

export type CraftUploadsOptions = {
  fetch?: typeof fetch;
  /** Minimum spacing between uploads; tests pass 0. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const LINK = /^https:\/\/connect\.craft\.do\/links\/[A-Za-z0-9_-]+\/api\/v1\/?$/;
const MAX_RETRIES = 4;
const MAX_RETRY_DELAY_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 120_000;

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

/** Parse the stored secret; null when it is not a usable route. */
export function parseUploadCredentials(raw: string | null): UploadCredentials | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<UploadCredentials>;
    if (typeof value.url !== "string" || !LINK.test(value.url)) return null;
    return typeof value.key === "string" && value.key ? { url: value.url, key: value.key } : { url: value.url };
  } catch { return null; }
}

export function createCraftUploads(options: CraftUploadsOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const intervalMs = options.intervalMs ?? 650;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let nextSlot = 0;

  const base = (credentials: UploadCredentials) => credentials.url.replace(/\/$/, "");
  const headers = (credentials: UploadCredentials, extra: Record<string, string> = {}) =>
    credentials.key ? { ...extra, authorization: `Bearer ${credentials.key}` } : extra;

  async function send(credentials: UploadCredentials, path: string, init: RequestInit): Promise<Result<Response>> {
    if (!LINK.test(credentials.url)) return failure("invalid", "The API link must look like https://connect.craft.do/links/…/api/v1.", "Copy the API URL from the connection in Craft.");
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const scheduled = Math.max(now, nextSlot);
      nextSlot = scheduled + intervalMs;
      if (scheduled > now) await sleep(scheduled - now);
      let response: Response;
      try {
        response = await doFetch(`${base(credentials)}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      } catch {
        return failure("unavailable", "The Craft API connection could not be reached.", "Check network access and retry; nothing is known to have been uploaded.");
      }
      if (response.status !== 429 || attempt >= MAX_RETRIES) return { ok: true, value: response, limits: [] };
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = Number(response.headers.get("retry-after"));
      const rawDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt + Math.random() * 500;
      const delay = Math.min(MAX_RETRY_DELAY_MS, rawDelay);
      debug("craft", "upload-throttled", { attempt, delay });
      await sleep(delay);
    }
  }

  function statusFailure(status: number, action: string): Result<never> {
    if (status === 401 || status === 403) return failure("unauthorized", `Craft refused the API connection while ${action} (HTTP ${status}).`, "Check the API link and key in the GPK Configuration console (gpk open), or create a new API connection in Craft.");
    if (status === 404) return failure("not-found", `Craft did not find the API connection or the target while ${action}.`, "Check the API link in the GPK Configuration console (gpk open); read the record back before retrying.");
    if (status === 429) return failure("unavailable", `Craft kept rate-limiting while ${action}.`, "Wait a minute and continue from the last verified item.");
    return failure("unavailable", `Craft answered HTTP ${status} while ${action}.`, "Read the record back before retrying.");
  }

  return {
    /**
     * Confirm that the route answers and addresses the expected space.
     * @param spaceId The active backend instance; a route to another space is refused.
     */
    async verify(credentials: UploadCredentials, spaceId: string): Promise<Result<void>> {
      if (!spaceId.trim()) return failure("invalid", "A nonblank Craft space ID is required to verify the upload connection.", "Connect Craft first.");
      if (!LINK.test(credentials.url)) return failure("invalid", "The API link must look like https://connect.craft.do/links/…/api/v1.", "Copy the API URL from the connection in Craft.");
      const sent = await send(credentials, "/connection", { headers: headers(credentials, { accept: "application/json" }) });
      if (!sent.ok) return sent;
      if (!sent.value.ok) return statusFailure(sent.value.status, "checking the connection");
      const text = await sent.value.text();
      if (!text.toLowerCase().includes(spaceId.trim().toLowerCase())) {
        return failure("invalid", "This API connection belongs to a different Craft space.", "Create the API connection in the space GPK is connected to.");
      }
      return { ok: true, value: undefined, limits: [] };
    },
    /** Upload one file as the last block of a page (document root or nested page). */
    async upload(credentials: UploadCredentials, file: { bytes: Buffer; contentType: string; fileName: string }, pageId: string): Promise<Result<UploadedAsset>> {
      const query = new URLSearchParams({ position: "end", pageId, fileName: file.fileName });
      const sent = await send(credentials, `/upload?${query}`, {
        method: "POST", body: new Uint8Array(file.bytes),
        headers: headers(credentials, { "content-type": file.contentType, accept: "application/json" }),
      });
      if (!sent.ok) return sent;
      if (!sent.value.ok) return statusFailure(sent.value.status, `uploading ${file.fileName}`);
      let value: Partial<UploadedAsset>;
      try { value = await sent.value.json() as Partial<UploadedAsset>; }
      catch { return failure("uncertain", `Craft accepted ${file.fileName} but its answer was unreadable.`, "Read the record back to see whether the file arrived before retrying."); }
      if (typeof value.blockId !== "string" || typeof value.assetUrl !== "string") return failure("uncertain", `Craft accepted ${file.fileName} without naming the new block.`, "Read the record back before retrying.");
      return { ok: true, value: { blockId: value.blockId, assetUrl: value.assetUrl }, limits: [] };
    },
  };
}

export type CraftUploads = ReturnType<typeof createCraftUploads>;
