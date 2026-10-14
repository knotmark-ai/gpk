import type { Capabilities, Result } from "../domain/operation-types.js";

/** Deliberately no I/O and no fake data/receipts in the engineering skeleton. */
export function unsupported(operation: string): Result<never> {
  return {
    ok: false,
    error: {
      code: "unsupported",
      message: `${operation} is not implemented in the engineering skeleton.`,
      affected: [],
      next: "No I/O was performed. Implement and validate this adapter operation before retrying.",
    },
  };
}

/** Describe the concrete methods, not storage facts or a provider registry. */
export function skeletonCapabilities(adapter: object): Result<Capabilities> {
  const capabilities: Capabilities = {};
  function visit(group: object, prefix: string): void {
    for (const [key, value] of Object.entries(group)) {
      if (!prefix && key === "capabilities") continue;
      const operation = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "function") {
        capabilities[operation] = {
          mode: "unsupported",
          limits: ["Interface skeleton only; no storage access."],
          evidence: ["This method returns unsupported without performing I/O."],
        };
      } else if (value && typeof value === "object") {
        visit(value, operation);
      }
    }
  }
  visit(adapter, "");
  return { ok: true, value: capabilities, limits: ["Method inventory only; no live backend verification."] };
}
