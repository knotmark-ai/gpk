/** Shared knowledge/control operation types. These types do not perform authorization or I/O.
 *
 * Limits are reported in two places with different scope:
 * - `Capability.limits`: standing limits of one operation or predicate in the bound scope.
 * - `Result.limits`: limits that applied to this call, such as budget or coverage.
 * `Failure.next` and `WriteReceipt.recovery` describe what to do, not a limit.
 */
import type { Ref } from "./entities.js";
/** Opaque revision of one addressed resource. Compare only for equality and only
 * against that resource; it is not an ordering, timestamp or necessarily a CAS token.
 * The adapter composes it from whatever its provider exposes, for example a native
 * revision, a modification time plus content digest, or a document version token.
 * Whether a mismatch is prevented or only detected is declared per capability.
 */
export type Version = string;
/** Describe capabilities of the actual bound scope, with evidence for emulation or limits. */
export type Capability = {
  /** Native: direct support; emulated: equivalent composition; degraded: limited
   * retrieval/coverage; unsupported: no usable implementation in this binding.
   */
  mode: "native" | "emulated" | "degraded" | "unsupported";
  /** Standing restrictions, including supported locator forms and read budget units/defaults. */
  limits: string[];
  /** Bound scope and dated observation/test references supporting the reported mode. */
  evidence: string[];
};
/** Partial or uncertain failures may follow real effects. Inspect affected records
 * and follow the recovery guidance before retrying a potentially successful write.
 */
export type Failure = {
  /** not-found: confirmed absence; ambiguous: multiple plausible targets/meanings;
   * unauthorized: outside current permission/scope; unavailable: access interrupted;
   * unsupported: no implementation of requested semantics; invalid: malformed input;
   * conflict: stale revision or violated current preconditions; partial: some effects
   * occurred; uncertain: effects cannot yet be established.
   */
  code: "not-found" | "ambiguous" | "unauthorized" | "unavailable"
      | "unsupported" | "invalid" | "conflict" | "partial" | "uncertain";
  /** Human-readable explanation, without credentials or unnecessary private content. */
  message: string;
  /** Known affected resources; an empty list on an uncertain failure proves no absence of effects. */
  affected: Ref[];
  /** Safe next action, including inspection before retrying an uncertain write. */
  next: string;
};
/** Success can still have limited coverage or unverified effects; inspect the value too. */
export type Result<T> = { ok: true; value: T; limits: string[] }
               | { ok: false; error: Failure };
/** Coverage concerns the requested scope, not just the last provider page.
 * Complete: requested scope established; partial: known omissions; unknown: coverage unestablished.
 * A continuation excludes completeness; its absence alone does not prove completeness.
 * Narrow coverage to partial/unknown before reading next. A returned next is an opaque
 * continuation for this operation and scope; omit it when no continuation is available.
 * Implementations validate this relationship at runtime; types alone do not establish coverage.
 */
export type ReadCoverage =
  | { coverage: "complete" }
  | { coverage: "partial" | "unknown"; next?: string };
/** Items observed on this page, not a complete inventory unless coverage establishes it.
 * No sort order or transactionally stable traversal is implied.
 */
export type Page<T> = { items: T[] } & ReadCoverage;
export type ReadOptions = {
  /** Omit to start a read. Otherwise pass an opaque `next` from the same operation,
   * bound scope, target and predicates. Page.next resumes discovery; Snapshot.next
   * resumes that record's read. Never exchange them. Malformed or mismatched tokens
   * are invalid; an expired traversal is a conflict, not a restart at page one.
   */
  cursor?: string;
  /** Positive integer response budget, not a promise of complete coverage. On
   * query/list it is the maximum returned item count; on a record read the adapter
   * declares its content unit. Omission uses the adapter's documented finite
   * default. Report a lower effective cap in Result.limits; never truncate silently.
   */
  limit?: number;
};
/** Snapshot coverage describes this record's content. In Page<Snapshot<T>>, page
 * coverage separately describes discovery of records; callers must check both.
 */
export type Snapshot<T, Reference extends Ref = Ref> = {
  /** Canonical identity of the record read, within the selected scope.
   * For entity reads, the concrete reference carries kind; value holds entity data.
   */
  ref: Reference;
  /** Projection of observed content; check coverage before reasoning from missing fields. */
  value: T;
  /** Revision of this record for a later WriteGuard.expected, if available. */
  version?: Version;
} & ReadCoverage;
/** A persisted GPK approval for one knowledge backend, written only by Setup after
 * explicit user confirmation and read fresh from the selected control store before
 * every knowledge mutation. It narrows, never widens, what the provider connection
 * and the host's tool approval already allow. Validate operation IDs against
 * implemented operations; reject unknown IDs and wildcards. Root bounds the target
 * or its verified containing scope, including creation placement; containment is
 * checked against provider structure, never inferred from a text search.
 */
export type ControlGrant = {
  /** The Settings backend configuration this approval applies to. */
  backendId: string;
  /** Provider-resolved scope the approval covers: a Collection, folder, document or
   * capture surface in that backend. Targets outside it are unauthorized.
   */
  root: Ref;
  /** Port operation IDs such as `tasks.create` or `projects.transition`. Destructive
   * operations (`remove`, `archive`, `restore`) are never part of a default set and
   * appear here only when the user granted them explicitly.
   */
  operations: string[];
  /** True only when the user enabled an automated feature for this scope. Runs with
   * no interactive session require it; interactive runs accept either value.
   */
  unattended: boolean;
};
/** Revision precondition for a mutation. Authorization is not caller input: the
 * runtime resolves it (see GrantedWriteGuard) and the adapter enforces it.
 */
export type WriteGuard = {
  /** Revision last read from the target named by the operation. Omit for no caller
   * revision assertion, not to skip fresh reads, authorization or domain checks.
   * Mismatch is conflict. If revision checking is unsupported, fail unsupported;
   * never silently ignore a supplied value. Atomicity requires declared capability.
   * For creation with no existing target, omit this field (supplying it is invalid);
   * it is not a deduplication key.
   */
  expected?: Version;
};
/** Guard for knowledge-backend mutations. The runtime looks up the grant in the
 * selected control store for this backend, root and operation before calling the
 * port; it never accepts a grant or authority from tool arguments. The adapter
 * re-checks that the target lies within grant.root and that the operation ID is
 * listed, failing unauthorized otherwise, so a direct port call cannot bypass it.
 * Control-store mutations use the plain WriteGuard: they are authorized by the
 * interactive Setup session and the host's tool approval, because grants cannot
 * exist before Setup writes them.
 */
export type GrantedWriteGuard = WriteGuard & { grant: ControlGrant };
/** A successful transport response alone is insufficient to set verified to true. */
export type WriteReceipt = {
  /** Actual affected resource identities, including supporting records when applicable. */
  affected: Ref[];
  /** True only after the requested effect is checked against current backend facts. */
  verified: boolean;
  /** Post-write revision of the operation's primary target, when available; not a batch token. */
  version?: Version;
  /** Recovery/inspection guidance and native recovery references when relevant. */
  recovery?: string;
};
/** `created` is the canonical new identity, not inferred from affected-array order. */
export type CreateReceipt<Reference extends Ref> = WriteReceipt & { created: Reference };
/** Keys name a domain operation or predicate: `projects.query.states`, `tasks.schedule`,
 * `control.settings.read`. Report what the bound scope supports, not what the interface declares.
 * A missing entry is undeclared support, never implicit permission or native support.
 */
export type Capabilities = Record<string, Capability>;
