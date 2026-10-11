/** Domain projections shared across providers. Native documents need not store
 * these exact fields; adapters recover their meaning from the selected backend.
 * Projections contain entity data; the operation and its concrete reference identify
 * the entity type. The data does not repeat the reference's kind discriminator.
 */
/** Opaque identity within an explicitly selected provider scope. */
export type Ref = {
  /** Adapter-issued provider/workspace namespace; must match the selected binding. */
  scope: string;
  /** Stable provider identity within scope, not a title or a credential. */
  id: string;
};
/** Concrete references retain kind to distinguish otherwise identical scope/id shapes
 * in operation arguments and contextual links. Adapters resolve the provider locator
 * and validate kind/scope; setting this literal alone does not validate backend data.
 */
export type AreaRef = Ref & { kind: "Area" };
export type ProjectRef = Ref & { kind: "Project" };
export type TaskRef = Ref & { kind: "Task" };
export type SourceRef = Ref & { kind: "Source" };
export type WikiRef = Ref & { kind: "Wiki" };
export type OutputRef = Ref & { kind: "Output" };

export type AreaState = "active" | "inactive";
export type ProjectState = "planned" | "active" | "paused" | "completed" | "canceled";
export type TaskState = "todo" | "doing" | "waiting" | "done" | "canceled";

/** Readable Area projection; never replace an entire native document from it. */
export type Area = {
  /** Human-readable name; creation/rename requires a nonblank title. */
  title: string;
  /** Readable direction/responsibility body, possibly empty.
   * The adapter documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
  /** Participation in proactive review/planning; inactive Areas remain readable and linkable.
   * Omission means unknown on an incomplete read; a complete read must resolve the state.
   */
  state?: AreaState;
};
/** Readable Project projection; never replace an entire native document from it. */
export type Project = {
  /** Human-readable name; creation/rename requires a nonblank title. */
  title: string;
  /** Readable Objective/KRs, plan and evidence; may be empty.
   * The adapter documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
  /** Current execution lifecycle; planned records intent without an execution commitment.
   * Omission means unknown on an incomplete read; a complete read must resolve the state.
   */
  state?: ProjectState;
  /** Exactly one logical Area owner, chosen for this Project's Objective independently
   * of native folders. Additional Area associations are contextual links.
   * Omission means unknown on an incomplete read; a complete read must resolve this Area.
   * An inactive Area remains a valid owner.
   */
  primaryArea?: AreaRef;
};
/** Readable Task projection; never replace an entire native record from it. */
export type Task = {
  /** Concise action name; creation/rename requires a nonblank title. */
  title: string;
  /** Readable description, materials and results; may be empty. The adapter
   * documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
  /** Current action state, independent of its planned date and its Project's state.
   * Omission means unknown on an incomplete read; a complete read must resolve the state.
   */
  state?: TaskState;
  /** Planned attention date (`YYYY-MM-DD`) in the bound instance timezone:
   * execution for todo, continuation for doing, follow-up for waiting.
   * On a complete read, omission means no recorded planned date; on an incomplete
   * read, it may be unknown. Keep fixed deadlines and time-of-day details in content.
   */
  time?: string;
  /** At most one logical Project owner, independent of native placement or other links.
   * On a complete read, omission means standalone; on an incomplete read, ownership
   * may be unknown. Contextual links to other Projects do not add primary owners.
   */
  project?: ProjectRef;
};
/** Readable Source projection; never replace an entire native document from it. */
export type Source = {
  /** Human-readable source name; creation/rename requires a nonblank title. */
  title: string;
  /** Retained material, origin and actual access evidence; may be empty.
   * The adapter documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
};
/** Readable Wiki projection; never replace an entire native document from it. */
export type Wiki = {
  /** Human-readable subject name; creation/rename requires a nonblank title. */
  title: string;
  /** Readable explanation and supporting links; may be empty.
   * The adapter documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
};
/** Readable Output projection; never replace an entire native document from it. */
export type Output = {
  /** Human-readable artifact name; creation/rename requires a nonblank title. */
  title: string;
  /** Readable artifact content/reference and producers; may be empty.
   * The adapter documents text/Markdown encoding and preserves unknown native content.
   */
  content: string;
};
