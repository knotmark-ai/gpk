# Adapter development

An adapter implements a [storage port](../storage-contracts.md#public-contracts)
for a concrete provider. Interfaces live in `src/domain/`; provider code belongs in
`src/adapters/`. This directory holds mappings and evidence, not executable adapters.

## Provider mappings

The [Craft mapping](craft.md) records evidence and implementation guidance for
knowledge operations. The [local control mapping](local-control.md) records the
selected `.gpk` file-store design for UserControlPort, not live implementation
evidence. Other providers belong in the
[roadmap](../roadmap.md#milestone-2-extensibility-and-common-platform-coverage) until they have an implementation slice
and evidence to document. Current support is maintained in the
[README](../../README.md#current-support).

The Craft (`src/adapters/craft.ts`) and local-control (`src/adapters/local-control.ts`)
implementations live under `src/adapters/`. No provider registry or base class is
needed: `src/runtime/bootstrap.ts` wires concrete adapters to `src/runtime/operations.ts`,
which speaks exclusively to `KnowledgeBackendPort` and `UserControlPort`. Implement
any future port (Notion, Feishu, Obsidian) with ordinary functions or an object
using the shared domain model, never redefining domain rules per provider.

Adapters own native representation, physical placement, transport, pagination,
external-data validation and error normalization. Shared domain/workflow logic
owns business rules and orchestration. Reuse those rules rather than inventing
provider-specific activation, completion or ownership semantics.

Capabilities must disclose unsupported operations and actual limits. Implement
local control with its Setup caller independently of Craft's scoped domain
reads/queries; full onboarding still verifies the selected knowledge connection
and resources. Validate the [storage contracts](../storage-contracts.md)
and applicable [conformance scenarios](../conformance-scenarios.md)
before claiming support. Evidence from one connection does not validate another.

## Runtime integration

The [GPK runtime](../architecture.md#where-the-adapter-runs) constructs selected
adapters through shared bootstrap and calls them through ports from shared
operation handlers. The initial host binding uses MCP; a CLI is optional.
[Connection Setup](../architecture.md#setup-and-connection-lifecycle)
selects an explicit host bridge or configures GPK's authorized downstream MCP/API
transport. A provider MCP Client is independent of the host binding; an installed
Craft plugin does not automatically expose its host session to GPK. Bootstrap owns
selection/authentication wiring; adapters own provider protocol and representation.
Skills guide choices without managing secrets or redefining transport behavior.
Current access and implementation status are maintained in the
[README](../../README.md#current-support).

Host loading is configured in `platforms/` and described in
[plugin loading](../plugin-runtime.md). Skills and manifests are host inputs,
not storage adapters. Provider documentation and source declarations are excluded
from plugin packages; see [distribution](../distribution.md).
