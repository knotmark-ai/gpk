---
name: gpk
description: Use for GPK method questions, record lookup or a general GPK request. Explains the method and routes requests. Routes to the five workflows; until onboarding is complete every request goes to gpk-setup first.
---

# GPK

Follow the [MCP invocation guide](../../guides/mcp.md).
Read the [routing policy](../../rules/routing.md) to select an entrypoint. For method questions, consult the [domain model](../../knowledge/domain-model.md).

Discover the host's GPK MCP tools, call `gpk_runtime_status` with `{}`,
then inspect the capabilities needed for this request.
Relevant tool names: `gpk_runtime_status`, `gpk_knowledge_capabilities`, `gpk_control_capabilities`.
Use the discovered names/namespace and tool schemas; query arguments may be `{}`.

Report `unsupported` and the remaining implementation gap without claiming an
operation completed; route accepted reminders and Task progress to `gpk-work`.
Do not bypass GPK with direct provider writes or manufacture records, Settings or receipts.
