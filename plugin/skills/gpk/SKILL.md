---
name: gpk
description: Use for GPK method questions, record lookup, standalone daily activity logging or a general GPK request. Explains the method, inspects status/records and routes to the five workflow Skills (gpk-setup, gpk-plan, gpk-work, gpk-ingest, gpk-review).
---

# GPK

Follow the [MCP invocation guide](../../guides/mcp.md).
Read the [routing policy](../../rules/routing.md) to select a workflow Skill. For method questions, consult the [domain model](../../knowledge/domain-model.md); for read-only assessments, see [bootstrap assessment](../../guides/bootstrap.md).

- **Lookup or general requests:** Call the matching `gpk_*_get` tool directly (or `gpk_status` to inspect readiness, preferences, grants, capabilities or templates). If onboarding is incomplete, route to `gpk-setup`.
- **Standalone daily activity:** When the user reports something they completed with no Project or Task mutation needed, record it directly with `gpk_daily_record`.
- **Workflow routing:** Route planning to `gpk-plan`, next actions and Task progress to `gpk-work`, material/import/session retention to `gpk-ingest`, and daily/weekly/monthly reviews to `gpk-review`.

Never bypass GPK with unguarded provider/file writes or fabricate records, Settings or receipts.
