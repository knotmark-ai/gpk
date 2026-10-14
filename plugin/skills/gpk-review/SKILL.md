---
name: gpk-review
description: Use for a GPK daily, weekly or monthly review, for reconsidering commitments after new evidence or delay, and for replanning. Compares intentions with current facts through the GPK MCP tools and writes conclusions back to the records they concern.
---

# GPK Review

Follow the [MCP invocation guide](../../guides/mcp.md) to discover the GPK tools
and confirm the connection. Apply the [domain model](../../knowledge/domain-model.md):
a review compares intended results with actual ones and ends in decisions on
existing records; it is not a report for its own sake, and cadence alone
schedules nothing.

## What this entrypoint can do now

`gpk_review_inventory` reads the reviewed population in one call: Inbox
captures, Tasks grouped as overdue / today / upcoming / doing / waiting /
unscheduled, Projects by state with attention signals (`no-next-action`,
`all-waiting`, `overdue`), Areas with their Project counts, and a `population`
block that says how many records were traversed and which gaps remain. Every
conclusion is written with the existing tools: `gpk_tasks_*` for actions,
`gpk_projects_update` / `gpk_projects_transition` / `gpk_projects_order_tasks`
for Projects, `gpk_areas_update` / `gpk_areas_transition` for Areas, and
`gpk-plan` when a plan has to be reframed. Recurrence, timers and a separate
Review record are not implemented; say so when asked.

## Run a review

1. `gpk_review_inventory` with the cadence the user named (`daily`, `weekly`,
   `monthly`; `horizonDays` only when they want a different window). Read
   `population` first: a `partial` coverage or a gap means some records were
   not seen, and the review must say so rather than claim completeness.
2. Daily: go through Inbox captures (clarify or leave them, via `gpk-work`),
   overdue and today's Tasks (do, reschedule with `gpk_tasks_schedule`, or
   drop with a reason), `doing` Tasks that stalled, and `waiting` follow-ups
   whose condition may have resolved. Record results on the Task. Tasks under
   `held` belong to planned or paused Projects and are not due work; raise a
   held Task only to ask whether its Project should be activated or resumed.
   Report every entry in `discrepancies` (work recorded under a non-active
   Project) without changing it.
3. Weekly: for each active Project, `gpk_projects_read` and
   `gpk_tasks_query` with `project`; compare the KR evidence in the body with
   what actually happened, then decide: keep, reorder (`gpk_projects_order_tasks`),
   reschedule, add the missing next action (`gpk_tasks_create` with
   `project`), pause with a reason, or close. A Project with `no-next-action`
   or `all-waiting` needs an explicit decision, not silence. Look at planned
   Projects for activation and paused ones for resumption only when capacity
   allows; completing one Task never activates a successor by itself.
4. Monthly: for each active Area, `gpk_areas_read` and the Projects it owns
   from the inventory; ask whether the direction still holds, whether an
   inactive Area should stay inactive, and which Projects deserve the next
   month. Related knowledge comes from `gpk_links_query` and `gpk_wikis_read`.
5. Ad hoc (new evidence, a delay, a changed date): re-read the affected
   Project and its Tasks, state the discrepancy, and apply only the change the
   user decides. A fixed commitment stays in the Project text even when the
   plan moves.

## Record conclusions

- A Project conclusion goes into its body as one dated line under
  `## Results & Review`: `gpk_projects_update` with an edit whose `before` is
  the last line of that section and `after` is that line plus a blank line
  and the new one. Keep it short: what was observed, what was decided.
- Task outcomes go on the Task through `gpk_tasks_transition` reasons or
  `gpk_tasks_update` edits. Area conclusions go into the Area body the same
  way as Projects.
- Closing a Project is `gpk_projects_transition` with the user's reason after
  every Task has an explicit disposition; `conflict` names the open ones.
- Pass the `version` from each read as `expected`; a `conflict` means the
  record changed during the review.

## Boundaries

Every write needs a grant in the control root; `unauthorized` names the missing
operation and root and the fix is Setup. Never mark a KR met without the
evidence in the body, never close a Project on the assumption that unseen
Tasks do not exist, and never treat an Agent suggestion from an earlier review
as a commitment. Report `unsupported` and `partial` results exactly as
returned, and state the reviewed population and its gaps in the summary.
