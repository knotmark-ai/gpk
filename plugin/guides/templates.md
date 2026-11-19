# GPK templates

Each of the six domain roles has a bundled default blueprint for domain **0.4**.
Templates live as editable native documents in the active Knowledge Backend
where supported (such as Craft's native `Templates` area or Obsidian's
`Templates/` folder, or managed template pages otherwise) so people and Agents
share one live blueprint. `{{slots}}` are authoring prompts for the Agent or
person, not a rigid parser grammar.

| Role | Bundled fallback | Intended use |
|---|---|---|
| Area | [Area](../assets/templates/area.md) | Continuing direction, responsibility, strategy and review guidance |
| Project | [Project](../assets/templates/project.md) | Bounded Objective/KRs, scope, ordered actions and process/results |
| Task | [Task](../assets/templates/task.md) | Optional inline action/description fragment, not a standalone document |
| Source | [Source](../assets/templates/source.md) | Origin, actual reading coverage, preparation and useful relationships |
| Wiki | [Wiki](../assets/templates/wiki.md) | Independently useful explanation with evidence and uncertainty |
| Output | [Output](../assets/templates/output.md) | Retained artifact body or reference, intended use and actual producers |

## Live backend templates and fallback order

System metadata (lifecycle state, primary Area, Project owner, planned Task
date) lives in native structured backend fields rather than body text. Because
GPK never parses body headings to recover state, users can freely add, rename,
translate or remove sections in their backend templates without breaking domain
operations.

Resolve the template for a new entity in this order:

1. **Explicitly requested structure** in the current conversation.
2. **Live backend template** bound in `settings.templates`:
   - Setup automatically binds installed or adopted templates in the backend
     (for Craft, `GPK Area`, `GPK Project`, `GPK Source`, `GPK Wiki`,
     `GPK Output` in Craft's native Templates gallery).
   - Whenever a user edits a bound template in the backend, `gpk_<entity>_get`
     and `gpk_status` automatically include it under `customTemplates.<role>`
     (or inspect all roles via `gpk_status` with `include: ["templates"]`).
   - Preserve user-authored headings, custom sections and provider dialect
     blocks (such as user `<callout>` blocks or dividers).
3. **Bundled default asset** (`../assets/templates/<role>.md`):
   - Used when `settings.templates.<role>` is `null`, when the backend template
     is unmodified, or when a bound template was deleted or emptied in the
     backend (disclosed in `Result.limits`). Load only the role being drafted.

Check `preferences.contentLanguage` for prose language: when set, write new
headings/prose in that language unless the custom template already specifies
headings in another language; when `null`, follow the conversation language and
custom template headings.

## Role-specific drafting

- **Area:** keep Vision, Responsibility or both. Do not infer active commitment
  from a template alone. Operating and review guidance is user-specific prose;
  candidate stages stay prose proposals until framed as Projects.
- **Source:** summarize only actual accessible input and disclose coverage.
  Attribute retellings accurately; retain variants and citations without
  recursively importing every cited link.
- **Wiki:** apply the [Wiki entry criteria](../knowledge/domain-model.md#wiki)
  when choosing a title and headings. Cite Sources near claims and retain
  disagreement, inference and uncertainty.
- **Output:** identify intended use and actual producers when known. Keep one
  authoritative artifact body, or link its external location with a concise
  summary.
- **Task:** keep a concise action title and only useful completion criteria,
  materials and outcomes in the body, with at most one planned date. Proposals
  stay ordinary text (`☐`), never native task blocks.

## Project drafting

Frame the Objective and outcome-oriented KRs before finalizing actions:

| Content | How to draft it |
|---|---|
| Status | Pass `planned` until the user commits to execution (`active`). Closed initial states (`paused`, `completed`, `canceled`) record past history only and require `history`. |
| Primary Area | Pass a resolved `AreaRef` in `primaryArea`. Confirm with the user before creating a new Area. |
| Objective | State the intended outcome change and why it matters; distinguish a proposal from a confirmed objective. |
| Key Results & Evidence | Describe observable outcome evidence and baseline or evidence gaps, not activity counts. |
| Scope & Constraints | Retain inclusions/exclusions, capacity, prerequisites and fixed external dates. Omit unused optional rows rather than writing "none" for unknown facts. |
| Plan & Actions | Pass accepted Tasks in `initialTasks` on `gpk_projects_create` (or `gpk_tasks_create` with `project`). Keep unaccepted suggestions as ordinary prose without checkboxes. |
| Process & Results | Omit `Results & Review` on a brand-new plan with no outcomes yet; use `materials` / `materialAppend` for research and drafts. |

## Finish any draft

For a blank template request, keep `{{slots}}` visible. For a real record or
draft, replace every slot with supported content, a labeled proposal or an
explicit unknown, and remove HTML comments and unused optional sections. Do not
turn slot names or unverified titles into clickable URLs, and do not re-render
an existing record from a creation template when making a targeted update
(`edits` or `append`).
