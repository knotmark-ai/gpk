/**
 * Public domain and storage contract types.
 * `Port` names a storage interface; `Adapter` names a concrete provider implementation.
 * Read and write contracts declare meaning independently of provider support.
 * README's current-support inventory owns implemented scope and evidence. See
 * docs/architecture.md#where-the-adapter-runs.
 */
export type * from "./domain/entities.js";
export type * from "./domain/operation-types.js";
export type * from "./domain/knowledge-backend-port.js";
export type * from "./domain/user-control-port.js";
