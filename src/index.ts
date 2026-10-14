/**
 * Public domain and storage contract types.
 * `Port` names a storage interface; `Adapter` names a concrete provider implementation.
 * Read operations are the stable contract. Task write operations have their first
 * provider caller; other writes are draft until theirs exists. See
 * docs/architecture.md#where-the-adapter-runs.
 */
export type * from "./domain/entities.js";
export type * from "./domain/operation-types.js";
export type * from "./domain/knowledge-backend-port.js";
export type * from "./domain/user-control-port.js";
