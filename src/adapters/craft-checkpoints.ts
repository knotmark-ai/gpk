import { createHash } from "node:crypto";
import type { ProcessingCheckpoints } from "../domain/knowledge-backend-port.js";
import type { Ref } from "../domain/entities.js";
import type { Failure, Result, Snapshot } from "../domain/operation-types.js";
import { jsonArgument, type CraftBlock, type CraftContext } from "./craft-collections.js";

export const SYSTEM_TITLE = "GPK System";
const PREFIX = "GPK checkpoint v1:";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const failure = (code: Failure["code"], message: string, next: string, affected: Ref[] = []): Result<never> =>
  ({ ok: false, error: { code, message, next, affected } });

/** One inert text block per revision. Encoding prevents Markdown from interpreting
 * arbitrary checkpoint content. A checksum rejects truncated or changed revisions.
 * Never remove the previous readable revision before verifying its successor.
 */
function revision(block: CraftBlock): string | null {
  const text = block.markdown ?? "";
  if (block.type !== "text" || !text.startsWith(PREFIX)) return null;
  const match = text.slice(PREFIX.length).match(/^([a-f0-9]{64}):([A-Za-z0-9_-]*)$/);
  if (!match) return null;
  const value = Buffer.from(match[2]!, "base64url").toString("utf8");
  return digest(value) === match[1] ? value : null;
}

export function createCheckpointOperations(ctx: CraftContext): ProcessingCheckpoints {
  async function systemPage(create: boolean): Promise<Result<CraftBlock | null>> {
    const host = await ctx.hostRoot(); if (!host.ok) return host;
    if (!host.value) return failure("unavailable", "The host document is not configured.", "Complete GPK setup.");
    const root = await ctx.readBlock(host.value, 1); if (!root.ok) return root;
    const existing = (root.value.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === SYSTEM_TITLE);
    if (existing) return ctx.readBlock(existing.id, 1);
    if (!create) return { ok: true, value: null, limits: [] };
    const payload = jsonArgument([{ type: "page", markdown: SYSTEM_TITLE, content: [] }]);
    const added = await ctx.connection.write(`blocks add --id ${host.value} --json '${payload}'`); if (!added.ok) return added;
    const id = added.value.match(/IDs: <([^>]+)>/)?.[1];
    return id ? ctx.readBlock(id, 1) : failure("uncertain", "Craft did not report the system page ID.", "Read the host document before retrying.");
  }

  function snapshot(block: CraftBlock, scope: string): Result<Snapshot<string>> {
    const children = block.content ?? [];
    const revisions = children.filter(child => (child.markdown ?? "").startsWith(PREFIX));
    const values = revisions.map(revision).reverse();
    const current = values.find(value => value !== null);
    // Pre-versioning checkpoints keep working and are never deleted during migration.
    const legacy = { ...block, content: children.filter(child => !(child.markdown ?? "").startsWith(PREFIX)) };
    if (current === undefined && revisions.length && !legacy.content.length) return failure("unavailable", "No intact checkpoint revision is readable.", "Inspect the checkpoint; do not discard its recovery evidence.", [{ scope, id: block.id }]);
    return {
      ok: true,
      value: { ref: { scope, id: block.id }, value: current ?? ctx.bodyOf(legacy), version: ctx.digestOf(block), coverage: ctx.contentCoverage(block) },
      limits: values.includes(null) ? ["An incomplete checkpoint revision was ignored; the previous intact value is retained."] : [],
    };
  }

  return {
    async read(key) {
      if (!key.trim() || /[\r\n]/.test(key)) return failure("invalid", "A checkpoint key must be one nonblank line.", "Use the workflow's logical key.");
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const page = await systemPage(false); if (!page.ok) return page;
      const entry = (page.value?.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === key.trim());
      if (!entry) return { ok: true, value: null, limits: [] };
      const block = await ctx.readBlock(entry.id, 1); if (!block.ok) return block;
      return snapshot(block.value, scoped.value.id);
    },
    async save(key, content, guard) {
      if (!key.trim() || /[\r\n]/.test(key) || key.trim().startsWith("gpk/")) return failure("invalid", "A checkpoint key must be one nonblank line and cannot start with reserved gpk/.", "Use the workflow's own key.");
      const scoped = await ctx.space(); if (!scoped.ok) return scoped;
      const granted = await ctx.authorizeRoot(guard, "checkpoints.save", "system"); if (!granted.ok) return granted;
      const page = await systemPage(true); if (!page.ok) return page;
      if (!page.value) return failure("uncertain", "The system page could not be read.", "Inspect it before retrying.");
      const entry = (page.value.content ?? []).find(child => child.type === "page" && (child.markdown ?? "").trim() === key.trim());
      let previous: CraftBlock | undefined;
      if (entry) {
        const read = await ctx.readBlock(entry.id, 1); if (!read.ok) return read;
        previous = read.value;
        if (ctx.contentCoverage(previous) !== "complete") return failure("unavailable", "The checkpoint is partially readable.", "Complete its read before saving.");
        if (guard.expected !== undefined && guard.expected !== ctx.digestOf(previous)) return failure("conflict", "The checkpoint changed since it was read.", "Read it again before saving.", [{ scope: scoped.value.id, id: entry.id }]);
      } else if (guard.expected !== undefined) return failure("conflict", "No checkpoint exists for this key.", "Omit expected for the first save.");

      const encoded = `${PREFIX}${digest(content)}:${Buffer.from(content).toString("base64url")}`;
      const added = previous
        ? await ctx.connection.write(`blocks add --id ${previous.id} --markdown ${JSON.stringify(encoded)}`)
        : await ctx.connection.write(`blocks add --id ${page.value.id} --json '${jsonArgument([{ type: "page", markdown: key.trim(), content: [{ type: "text", markdown: encoded }] }])}'`);
      if (!added.ok) return { ok: false, error: { ...added.error, next: "Read the checkpoint before retrying; its prior content was preserved and a new revision may exist." } };
      const id = previous?.id ?? added.value.match(/IDs: <([^>]+)>/)?.[1];
      if (!id) return failure("uncertain", "Craft did not report the checkpoint ID.", "Read the system page before retrying.");
      const ref = { scope: scoped.value.id, id };
      const after = await ctx.readBlock(id, 1); if (!after.ok) return { ok: false, error: { ...after.error, code: "uncertain", affected: [ref] } };
      const tail = (after.value.content ?? []).at(-1);
      const observed = snapshot(after.value, scoped.value.id);
      if (!tail || revision(tail) !== content || !observed.ok || observed.value.coverage !== "complete" || observed.value.value !== content) {
        return failure("uncertain", "The new checkpoint revision was not verified; its previous value is preserved.", "Read the checkpoint before retrying.", [ref]);
      }

      // Bound revision growth only after durable verification. Preserve a backup,
      // legacy bodies and unknown native content; interrupted cleanup is harmless.
      const intact = (after.value.content ?? []).filter(child => revision(child) !== null);
      const obsolete = intact.slice(0, -2);
      const limits = [...observed.limits];
      let version = observed.value.version!;
      if (obsolete.length) {
        const removed = await ctx.connection.write(`blocks delete --ids ${obsolete.map(child => child.id).join(",")}`);
        if (!removed.ok) limits.push("Old checkpoint revisions could not be pruned; the verified value and its backup remain.");
        const final = await ctx.readBlock(id, 1); if (!final.ok) return { ok: false, error: { ...final.error, code: "uncertain", affected: [ref] } };
        const verified = snapshot(final.value, scoped.value.id);
        if (!verified.ok || verified.value.coverage !== "complete" || verified.value.value !== content) return failure("uncertain", "The checkpoint changed during verification.", "Read it before retrying.", [ref]);
        version = verified.value.version!;
      }
      return { ok: true, value: { affected: [ref], verified: true, version }, limits };
    },
  };
}
