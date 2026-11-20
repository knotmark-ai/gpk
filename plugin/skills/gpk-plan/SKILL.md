---
name: gpk-plan
description: Use for framing new bounded work as GPK Projects with Objectives, KRs and initial Tasks, creating or updating Areas, ordering a Project's plan, attaching process material, or moving Tasks between Projects and standalone.
---

# GPK Plan

Follow the [MCP invocation guide](../../guides/mcp.md) and [GPK templates](../../guides/templates.md). Apply the [domain model](../../knowledge/domain-model.md): an Area is a standing responsibility, a Project is bounded work with one Objective, outcome-oriented KRs and one primary Area, and a Task is an accepted action belonging to at most one Project.

## Frame a Project

1. Call `gpk_areas_get` (`{}`) and `gpk_projects_get` (`{ "states": ["active", "planned"] }`) to find the responsible Area, check active capacity, and pick up any customized backend `project`/`task` templates (`customTemplates`). Create a new Area with `gpk_areas_create` only after user confirmation.
2. Agree with the user on:
   - **Objective:** one sentence stating the intended change and why it matters.
   - **Key Results & Evidence:** 2–4 observable outcomes (not activity counts) with baselines or evidence gaps.
   - **Scope, constraints & horizon:** inclusions/exclusions and any fixed external dates.
   - **Initial accepted Tasks:** concrete actions with completion criteria (`todo`), keeping unaccepted ideas as prose proposals.
3. Call `gpk_projects_create` in a single compound call with:
   - `title`, `state` (`planned` until the user commits to active execution; `paused`/`completed`/`canceled` only when recording historical work with `history`), `primaryArea`, and `content` following `customTemplates.project` (if present) or the [bundled Project template](../../assets/templates/project.md);
   - `initialTasks` in plan order, optional `materials` (`inline` or `child-document`), optional `links`, and `activitySummary` for the Daily Note.
4. Report the created Project reference, ordered Task references, and any open decisions. If `gpk_projects_create` returns `partial`, inspect `completedSteps` and `affected` and retry only the remaining items (`gpk_tasks_create` or `gpk_projects_update`) rather than creating a duplicate Project.

## Revise a plan or Area

- Read current state and `version` with `gpk_projects_get` (`targets`, `include: ["area", "tasks", "materials", "links"]`) or `gpk_areas_get`.
- Apply Project changes in one `gpk_projects_update` call (`expected` set to `version`): `title`, `edits` (unique literal fragment per block), `append`, `primaryArea`, `taskOrder`, `transition` (with `reason`; closing requires zero open Tasks), `materialAppend`, `materialUpdate`, `linksAdd`, and `activitySummary`.
- Move an existing Task into a Project or back to standalone (`target: null`) with `gpk_tasks_update` (`project: { target, reason }`).
- Update Areas with `gpk_areas_update` (`title`, `edits`, `append`, `transition`, `linksAdd`, `activitySummary`).
- When planning surfaces a new Source, Wiki or Output that the user confirms keeping, you may create and link it directly (`gpk_sources_create`, `gpk_wikis_create`, `gpk_outputs_create`) without forcing a separate workflow turn.

## Boundaries

Every write requires a persisted grant; on `unauthorized`, direct the user to `gpk_setup_open`. On `conflict`, re-read, show what changed, and confirm before retrying. Never mark KRs met without evidence or close a Project with unresolved open Tasks.
