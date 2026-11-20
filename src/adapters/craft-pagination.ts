import type { Ref } from "../domain/entities.js";
import type { Page, Result } from "../domain/operation-types.js";

type Cursor = { offset: number; incomplete: boolean };

/** Continuations retain discovery gaps, so a later readable page cannot turn an
 * incomplete traversal into a complete inventory. Accept former offset tokens
 * during an upgrade, but reject malformed suffixes rather than parsing a prefix.
 */
export function readCursor(cursor: string | undefined, query: string): Result<Cursor> {
  if (cursor === undefined) return { ok: true, value: { offset: 0, incomplete: false }, limits: [] };
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const legacy = decoded.startsWith(`${query}:`) ? decoded.slice(query.length + 1) : null;
    const value = legacy !== null && /^\d+$/.test(legacy) ? { query, offset: Number(legacy), incomplete: false } : JSON.parse(decoded);
    if (value.query !== query || !Number.isSafeInteger(value.offset) || value.offset < 0 || typeof value.incomplete !== "boolean") throw new Error();
    return { ok: true, value: { offset: value.offset, incomplete: value.incomplete }, limits: [] };
  } catch {
    return { ok: false, error: { code: "invalid", message: `The cursor does not belong to ${query}.`, next: "Start the query again without a cursor.", affected: [] } };
  }
}

export function queryPage<T>(items: T[], query: string, nextOffset: number | undefined, incomplete: boolean, gaps: Ref[]): Page<T> {
  const partial = incomplete || gaps.length > 0;
  const page: Page<T> = nextOffset !== undefined
    ? { items, coverage: "partial", next: Buffer.from(JSON.stringify({ query, offset: nextOffset, incomplete: partial })).toString("base64url") }
    : { items, coverage: partial ? "partial" : "complete" };
  if (gaps.length) page.gaps = gaps;
  return page;
}
