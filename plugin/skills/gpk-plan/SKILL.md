---
name: gpk-plan
description: Use for framing new bounded work as GPK Projects with Objectives, KRs and Tasks, creating or changing Areas, ordering a Project's plan, attaching process material, or moving a Task into or out of a Project. Works on the Areas and Projects Collections through the GPK MCP tools.
---

# GPK Plan

Follow the [MCP invocation guide](../../guides/mcp.md) to discover the GPK tools
and confirm the connection. Apply the [domain model](../../knowledge/domain-model.md):
an Area is a standing responsibility, a Project is bounded work with one
Objective, measurable KRs and exactly one primary Area, and a Task is one
accepted action that belongs to at most one Project.

## What this entrypoint can do now

Areas: resolve, read, query, create, rename, edit the body, switch between
active and inactive. Projects: resolve, read, query (by state, primary Area or
title text), create with state and primary Area, rename, edit the body,
transition between planned / active / paused / completed / canceled, change the
primary Area, reorder Tasks, and list, read, append or edit process material.
Tasks: create under a Project in plan order and move a Task between a Project
and standalone. Sources, Wikis, Outputs and links return `unsupported`; say so
and keep the relevant text in the Project body instead.

## Frame a Project

1. `gpk_areas_query` with `{}` to find the responsible Area; create one with
   `gpk_areas_create` only when the user confirms none fits. Ask before creating.
2. Agree the Objective (one sentence of intended outcome), two to four KRs with
   observable evidence, scope and constraints, and the expected horizon. Keep
   fixed deadlines in the text.
3. `gpk_projects_create` with the title, `state` (`planned` until the user
   commits to execution, then `active`), `primaryArea` and a body in the
   template's sections: Objective, Key Results & Evidence, Scope & Constraints,
   Plan & Actions. The row appears in the Projects table and its Board view.
4. Add the first Tasks with `gpk_tasks_create` and `project` set; each needs a
   completion condition in its body. They follow the last Task of the row, so
   add them in plan order or fix the order with `gpk_projects_order_tasks`.
5. Report the Project reference, the Tasks in order and anything the user
   still has to decide.

## Change a plan

- Read first (`gpk_projects_read`, `gpk_tasks_query` with `project`) and pass
  the returned `version` as `expected` on writes.
- Revise Objective, KRs or scope with `gpk_projects_update` edits that target a
  unique fragment of one block; never rewrite the whole body.
- `gpk_projects_transition` records a reason with the state. Pausing keeps the
  Tasks; completing or canceling fails `conflict` while any Task is open, so
  dispose of each Task through `gpk-work` first.
- `gpk_projects_assign_area` changes the owner with a reason; it does not move
  anything in Craft.
- `gpk_tasks_assign_project` moves a Task into the Project's plan or, with
  `project: null`, back to today's Daily Note as standalone. Tasks that live in
  documents outside GPK's locations are not moved; create a new Task instead.
- `gpk_materials_append` keeps research, drafts and decisions with the
  Project: `inline` for a short section, `child-document` for a page.

## Boundaries

Every write needs a grant in the control root; `unauthorized` names the missing
operation and root and the fix is Setup. A `conflict` means the record changed
since the read: read again, show the difference, ask before reapplying. Never
mark KRs met without evidence, never close a Project on the user's behalf, and
never write to Craft through another connector to bypass GPK. Report
`unsupported` and `partial` results exactly as returned.
