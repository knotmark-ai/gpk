---
name: gpk-review
description: Use for GPK daily, weekly, monthly or ad-hoc reviews, comparing commitments against actual outcomes, resolving discrepancies, reordering or pausing Projects, and recording review conclusions.
---

# GPK Review

Follow the [MCP invocation guide](../../guides/mcp.md) and [domain model](../../knowledge/domain-model.md): a review compares intended outcomes against current facts and records explicit user decisions on existing Areas, Projects and Tasks.

## Run a review

1. Call `gpk_review_inventory` with `{ "cadence": "daily" | "weekly" | "monthly" }` (and optional `horizonDays`). Check `population.coverage` and `population.gaps` first and disclose any partial coverage in your summary.
2. **Daily:**
   - Walk through Inbox `captures` (clarify accepted ones with `gpk_tasks_create`), `overdue` and `today` Tasks, stalled `doing` Tasks, and `waiting` follow-ups (`gpk_tasks_update` to schedule, transition or record outcomes).
   - Surface `held` Tasks only to ask whether their `planned`/`paused` Project should change state; report every item in `discrepancies` without silently mutating it.
3. **Weekly:**
   - Expand active Projects with `gpk_projects_get` (`targets`, `include: ["area", "tasks", "materials"]`). Compare KR evidence against actual outcomes.
   - Resolve `no-next-action`, `all-waiting`, and `overdue` Project signals with explicit user decisions: add next actions (`gpk_tasks_create`), reorder (`taskOrder`), reschedule, pause (`transition`), or close after disposing of open Tasks. Check `planned` and `paused` Projects against real capacity.
4. **Monthly:**
   - Read Areas (`gpk_areas_get`) alongside their Project counts and linked Wikis (`gpk_links` with `action: "query"`, `gpk_wikis_get`). Reassess direction, active/inactive participation, and next-month Project priorities.
5. **Ad hoc (new evidence, delay or scope shift):**
   - Read affected Projects and Tasks (`gpk_projects_get` with `include: ["tasks"]`), state the discrepancy while keeping fixed external commitments visible, and apply only user-confirmed adjustments.

## Record conclusions

- Apply Project review notes, task order, primary-Area changes or state transitions together via `gpk_projects_update` (`edits` or `append` under `## Results & Review`, `taskOrder`, `transition`, `activitySummary`, `expected`).
- Apply Task dispositions via `gpk_tasks_update` and Area observations/transitions via `gpk_areas_update`.
- Record an overall review summary in the Daily Note via `activitySummary` on the concluding update or `gpk_daily_record`.

## Boundaries

Every write requires a persisted grant; on `unauthorized`, direct the user to `gpk_setup_open`. Never mark a KR met without evidence, never close a Project while open Tasks remain or when Task coverage is partial, and never treat an earlier Agent suggestion as a user commitment.
