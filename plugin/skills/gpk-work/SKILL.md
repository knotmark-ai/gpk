---
name: gpk-work
description: Use for GPK next actions, clarifying a captured reminder into a Task, Task progress (start, wait, reschedule), returning a Task's actual result, or closing a Project whose Tasks are resolved. Works on standalone and Project-owned Tasks in Craft through the GPK MCP tools.
---

# GPK Work

Follow the [MCP invocation guide](../../guides/mcp.md) to discover the GPK tools
and confirm the connection. Apply the [domain model](../../knowledge/domain-model.md)
for Task meaning: one accepted action, one optional planned time, a state that
only you change deliberately, and brief results kept with the Task.

## What this entrypoint can do now

Tasks standalone or under a Project: read, query, create (in today's Daily
Note, or in a Project's plan with `project`), rename, edit the body, transition
between todo / doing / waiting / done / canceled, set or clear the planned date,
and move between a Project and standalone. Inbox and Daily Note captures can be
listed and read. Projects can be read and closed here once their Tasks are
resolved; framing or revising a plan belongs to `gpk-plan`. Result routing into
Wiki or Output returns `unsupported`; keep the result on the Task.

## Clarify a capture into a Task

1. `gpk_captures_resolve` with `{"surface":{"name":"inbox"}}`, then
   `gpk_captures_list` with the returned surface. Read the item the user means;
   use `gpk_captures_read` when the line alone is not enough.
2. Decide with the user: accepted action, completion condition, planned
   attention date, and any fixed commitment that must stay visible in the text.
   A capture is not a Task until the user accepts it.
3. `gpk_tasks_create` with the agreed title, a body that keeps the useful
   origin context (what the receipt or reference is and where it lives), the
   state (`todo` unless told otherwise) and the planned date. Set `project`
   when the user says which Project the action serves (`gpk_projects_query`
   finds it); otherwise the Task is created standalone in today's Daily Note.
   The Inbox entry is not removed by this tool, so tell the user it remains
   there until they clear it.
4. Report the created reference, the read-back result and the version.

## Advance or reschedule a Task

1. `gpk_tasks_read` with the reference, or `gpk_tasks_query` to find it. Keep
   the returned `version`.
2. For a state change, `gpk_tasks_transition` with `expected` set to that
   version and a reason the user actually gave. `waiting` needs the condition
   in the reason; a date never resolves a wait. `done` needs the user's
   confirmation that the completion condition was met.
3. For a new planned date, `gpk_tasks_schedule`; `null` clears it. Postponing
   changes the date, not the state.
4. A `conflict` means the Task changed since the read: read it again, show the
   difference, and ask before reapplying.

## Return a result

Record what actually happened on the Task body with `gpk_tasks_update` edits
(or by including it in the transition reason when the user completes the Task
in the same breath). Keep it brief and factual: reference numbers, links the
user supplied, outcomes. Do not invent URLs, mark unverified work done, or
treat Task completion as Project completion.

## Choose a next action

When asked what to do next, `gpk_tasks_query` with `states` covering todo,
doing and waiting and a time window around today with `includeUnset: true`;
each item names its Project when it has one, and `gpk_projects_query` with
`states: ["active"]` shows which Projects are committed. Offer a small choice
from the current candidates, prefer Tasks of active Projects over standalone
ones unless a date forces otherwise, and mention waiting follow-ups
separately. Task blocks in documents outside GPK's locations are not listed.
Do not assume device, location, energy or available time.

## Close a Project

When the user says a Project is finished or dropped, `gpk_tasks_query` with
`project` to list its Tasks, dispose of each open one with the user (done with
its result, canceled with a reason, or moved with `gpk_tasks_assign_project`),
then `gpk_projects_transition` to `completed` or `canceled` with the user's
reason and the `expected` version. The transition fails `conflict` while any
Task is open; that is the signal to finish the disposition, not to force it.

## Boundaries

Every write needs a grant in the control root; an `unauthorized` result names
the missing operation and root, and the fix is Setup, not a workaround. Never
write to Craft through another connector to bypass GPK. Report `unsupported`
and `partial` results exactly as returned.
