# Adapters

Adapters map the canonical GPK model to actual client and store capabilities.
The [three interface contracts](../plugin/runtime/contracts/adapters.md) own
Knowledge Backend, Agent Harness and User Control boundaries and public data
types. This page is the directory entry for packages and provider mappings.

## Package and provider locations

| Role | Source | Status |
|---|---|---|
| Claude Code package | [`plugin/`](../plugin/) | Canonical package; only shared read-only `gpk` entry |
| Codex package | [`adapters/codex/`](codex/) | Generated from canonical source; same active entry |
| Craft Knowledge Backend | [Mapping](../plugin/runtime/adapters/knowledge/craft/mapping.md) | Dated investigation and support limits; mutation implementation pending |
| Claude Code Harness | [Mapping](../plugin/runtime/adapters/harness/claude-code/mapping.md) | Loading, resources, interaction and execution boundary |
| Codex Harness | [Mapping](../plugin/runtime/adapters/harness/codex/mapping.md) | Same contract, with Codex-specific host facilities |
| Knowledge-backed User Control | `plugin/runtime/adapters/control/knowledge-backend/mapping.md.stub` | Empty implementation slot; first provider planned to reuse Craft |

The domain baseline is 0.4 and the package is 0.1.0. Current support is limited to
Claude Code, Codex and scoped Craft reads through an existing user-configured
connection. Actual available tools and permissions determine access. Contract or
mapping Markdown does not make a write workflow executable.

Other knowledge stores, harnesses, and local/cloud User Control providers remain
future extensions. A selected control directory would be a store in its own right,
not an adapter-owned mirror or proof of local knowledge-backend support.

## Development boundary

Change canonical `plugin/` sources and rebuild; never edit `adapters/codex/` by
hand. The [runtime layout](../docs/plugin-runtime.md) owns generation, resource
isolation and the exclusion of inactive placeholders. [Getting started](../docs/getting-started.md)
owns build, local loading and assessment instructions. Building does not install
either package or configure a Craft connection.

Provider mappings contain provider-specific representation and observed capability
evidence. Shared operation types stay in the interface contract; workflow decisions
stay in the [workflow contract](../plugin/runtime/contracts/workflows.md).
Do not copy those bodies into a second adapter manual.

A new adapter must preserve the [domain model](../plugin/knowledge/domain-model.md),
declare limitations, and demonstrate the applicable
[conformance scenarios](../plugin/knowledge/conformance-scenarios.md) before support
is claimed. Packaging checks alone do not establish live behavior.
