# GPK templates

Each of the six roles has a bundled default, revision **1** for domain **0.4**.
English is authoritative; Chinese variants preserve the same meaning. These assets
are read and adapted by the Agent or copied by a person. `{{slots}}` are authoring
prompts, not an executable template language.

| Role | English | 简体中文 | Intended use |
|---|---|---|---|
| Area | [Area](../assets/templates/area.md) | [Area 中文](../assets/templates/area.zh-CN.md) | Continuing direction, responsibility, strategy and review guidance |
| Project | [Project](../assets/templates/project.md) | [Project 中文](../assets/templates/project.zh-CN.md) | Bounded Objective/KRs, ordered actions and process/results |
| Task | [Task](../assets/templates/task.md) | [Task 中文](../assets/templates/task.zh-CN.md) | Optional inline action/description fragment, not a standalone document |
| Source | [Source](../assets/templates/source.md) | [Source 中文](../assets/templates/source.zh-CN.md) | Origin, actual reading coverage, preparation and useful relationships |
| Wiki | [Wiki](../assets/templates/wiki.md) | [Wiki 中文](../assets/templates/wiki.zh-CN.md) | Independently useful explanation with evidence and uncertainty |
| Output | [Output](../assets/templates/output.md) | [Output 中文](../assets/templates/output.zh-CN.md) | Retained artifact body or reference, intended use and actual producers |

Use this guide for a requested template, example or new in-conversation entity draft.
Load only the selected role/language asset, not the entire catalogue. Native rendering,
personal-template persistence and domain writes are separate capabilities; follow the
calling Skill's execution boundary. A draft does not establish saved records, accepted
Tasks, an active commitment or completed external work.

## Select and fill

Resolve the template in this order: an explicitly requested template, then the
user's configured personal template for this role, then that role's bundled default
only when no personal template is configured. Settings has a named binding for each
role: null means no personal override; it does not mean a configured target is missing.
A one-off override does not change the configured
default. Use the requested language, then confirmed configured language, then en
when neither is known; the two bundled files are language
variants of the same role's default. Do not replace a configured personal template with
one of them because its content is inaccessible. With no connection, a requested
bundled example is still possible; label it as such rather than claiming the
user's configuration was checked. Read only the selected template and relevant
supplied or authorized context. Check the intended role and required meaning before
use; a template intended for another role needs explicit clarification/adaptation,
not silent rebinding. Templates organize content, not states, permissions or backend
logic. Equivalent headings/layouts are valid; do not force every optional section.

Setup can propose the six bundled choices without creating personal copies or domain
documents. Existing personal bindings/edits remain unchanged unless requested.

## Role-specific drafting

- **Area:** keep Vision, Responsibility or both. State active/inactive only when known;
  do not infer commitment from a template. Operating/review guidance is user-specific
  prose. Candidate actions/stages are proposals; no mandatory KRs or registered timer.
- **Source:** summarize only actual accessible input and disclose coverage. Preparation
  follows purpose and may be omitted or substantial. Attribute retellings correctly;
  retain variants/citations without recursively importing every reference. Area and
  downstream Task/Wiki creation are optional; no Source lifecycle field.
- **Wiki:** organize by subject and revise current explanations, not by appending
  Source summaries. Cite near claims and retain disagreement/inference/uncertainty.
  Independently meaningful subtopics can be linked Wikis; no lifecycle or index entity.
- **Output:** identify intended use and actual producers when known. Keep one
  authoritative artifact body; use an accessible reference when it lives elsewhere.
  Do not claim publication, completion or a universal lifecycle from retention.
- **Task:** use the fragment inline in a Project or native capture surface. Keep a
  concise action and only useful description/result/materials, with at most one time.
  Unchecked means a new accepted todo here; proposals stay ordinary labeled text.
  Do not reset an existing state or add a competing status marker. The adapter owns
  state/time encoding, including waiting and canceled; no separate Task document.

## Project drafting

Frame the Objective and initial outcome KRs before arranging actions, even though
Plan & Actions appears first in the document. Use a short title, a property list
with one field per item, then one ordered checkbox list for accepted actions.
Unchecked actions represent `todo`; proposed actions remain ordinary text without
checkboxes or Task state. The slots indicate meaning, not required field names:

| Content | How to draft it |
|---|---|
| Status | `planned` is the default for new intended work. A date or rendered draft never activates it. Do not use this new-Project template to reset an existing Project's state. |
| Primary Area | Exactly one known primary Area, preferably with a verified accessible reference. In an incomplete draft, mark an unresolved Area as needing clarification; do not invent one or create an Area. |
| Expected horizon | Use a stated estimate or mark it undecided. It is not a compulsory deadline or a start/end schedule. |
| Plan & Actions | Include only known accepted actions as `todo`. Describe completion and any actual review/execution materials. Omit Materials when none are needed and omit unknown planned-attention times. Each Task has at most one such time; keep fixed commitments in constraints. If actions are only suggestions, label them proposed without Task state. If none are known, state that gap instead of inventing an action. |
| Objective | Describe the intended change and why it matters; distinguish a proposed framing from a confirmed objective. |
| Key Results & Evidence | Describe observable outcome evidence and success conditions, with the known baseline or an explicit evidence gap. Use as many KRs as justified, without mandatory scores or confidence fields. Activity counts and completed Tasks alone do not prove success. |
| Scope & Constraints | Retain relevant inclusions/exclusions, capacity, prerequisites, fixed commitments and material questions. Omit unused optional rows; do not infer available capacity or turn unknown constraints into “none.” |
| Process & Knowledge | Keep useful Project-specific research, drafts and decisions inline or linked, with relevant Source/Wiki/Output references. Omit the section when empty. |
| Results & Review | Retain actual results, outcome evidence and meaningful decisions when they exist. Record remaining-Task disposition when reviewing closure; do not invent a review or mark unfinished Tasks done. Omit the section on a new plan with no results. |

## Finish any draft

For a blank template request, keep the slots and explain they need filling. For a
filled draft, replace every slot with supported content, a clearly labeled proposal
or a meaningful unknown; remove comments and unused optional fields/sections.
Ask only for unknowns that prevent a useful draft. Preserve useful partial work
and identify the decisions still needed before it becomes usable or executable.

Use supplied, verified URLs or native references for actual materials. Do not turn
slot text or an unverified title into a clickable URL. A supplied Area name can
remain plain text with its unresolved reference stated. Adapters will map the
meaning to native fields, links and child documents; the template does not select
a provider, register tools or impose a second state representation.

When a personal template is later adopted, preserve its edits and existing entity
layouts. Bundled-default upgrades do not automatically rewrite either one. Updating
an existing Wiki, Source or review result normally edits current content; it does
not rerender the whole entity from a creation template.
