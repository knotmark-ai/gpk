---
name: gpk-work
description: Use for choosing GPK next actions, clarifying captured reminders into Tasks, advancing Task progress (start, wait, reschedule, complete), recording Task results and Outputs, or closing a Project whose Tasks are resolved.
---

# GPK Work

Follow the [MCP invocation guide](../../guides/mcp.md) and [domain model](../../knowledge/domain-model.md): a Task is one accepted action with an optional planned attention date, an explicit state (`todo`, `doing`, `waiting`, `done`, `canceled`), and concise factual results.

## Choose a next action

Call `gpk_review_inventory` with `{ "cadence": "daily" }` to read executable candidates in one call:
- Offer 2–3 focused choices from `actions` (standalone Tasks and Tasks of **active** Projects only, respecting plan order and planned dates).
- Never offer `held` Tasks (belonging to `planned` or `paused` Projects) as ready execution, even if dated; mention them only if asking whether to activate/resume their Project.
- Surface `waiting` Tasks separately as follow-ups to check on, and point out any `discrepancies` without silently mutating them.
- Do not guess device, location, energy or available time; ask only when a missing constraint changes the choice.

## Clarify a capture into a Task

1. Call `gpk_captures_get` with `{ "surface": { "name": "inbox" } }` (and `{ "refs": [...] }` when nested capture blocks are needed).
2. Confirm with the user: action title, completion meaning, optional planned `time`, and whether it belongs to a `project` (`gpk_projects_get` finds active/planned Projects).
3. Call `gpk_tasks_create` (single Task or `items[]` batch; closed historical Tasks require `history`). Note to the user that the raw Inbox item remains in Craft's Inbox until they clear it manually.

## Advance, reschedule or record Task results

1. Read the Task via `gpk_tasks_get` (`targets`) to obtain its current `version` and body.
2. Apply changes in one `gpk_tasks_update` call with `expected`:
   - `transition`: `{ state, reason }` (`waiting` requires the unresolved condition; `done` requires confirmation that the completion criteria were met).
   - `time`: `"YYYY-MM-DD"` to schedule/postpone, or `null` to clear (changing date alone never changes state).
   - `project`: `{ target, reason }` to assign to a Project or `null` for standalone.
   - `edits` or `append`: record factual outcomes, reference numbers or links on the Task body.
   - `linksAdd` and `activitySummary`: attach contextual links and log the completed outcome in the Daily Note in the same call.
3. **Natural follow-through:** When completing work also produces a deliverable Output or reusable Wiki insight that the user wants saved, create and link it directly (`gpk_outputs_create` / `gpk_wikis_update` / `gpk_wikis_create` with `links`) rather than stopping at a workflow boundary.

## Close a Project

Read the Project and its Tasks via `gpk_projects_get` (`targets`, `include: ["tasks"]`). Resolve every open Task with the user first (`gpk_tasks_update`), then transition the Project to `completed` or `canceled` via `gpk_projects_update` (`transition`, `append` under `## Results & Review`, `activitySummary`, `expected`).

## Boundaries

Every write requires a persisted grant; on `unauthorized`, direct the user to `gpk_setup_open`. On `conflict`, re-read and confirm before retrying. Never mark unverified work `done` or treat Task completion as automatic Project completion.
