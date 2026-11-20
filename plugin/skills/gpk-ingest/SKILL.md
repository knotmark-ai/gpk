---
name: gpk-ingest
description: Use for retaining or integrating external material, imported note collections and Agent conversations into GPK (Capture, Study or Deep Research), managing Sources, Wikis and Outputs, and resuming verified ingestion progress.
---

# GPK Ingest

Follow the [MCP invocation guide](../../guides/mcp.md), [GPK templates](../../guides/templates.md) and [domain model](../../knowledge/domain-model.md): a Source retains traceable origin, actual access scope and prepared evidence; a Wiki maintains one subject by revising explanations in place with claim-level citations; an Output retains a delivered artifact.

## 1. Confirm depth

Use the depth stated by the user (or configured for automatic session retention). If unspecified in interactive chat, ask first using these three English names with a brief explanation in the conversation language:

1. **Capture** — Save the Source link or file, record provenance and summarize its main point.
2. **Study** — Work through the material, extract reusable understanding and integrate it into relevant Wikis.
3. **Deep Research** — Investigate a question across independent sources, compare evidence/disagreements and synthesize findings into Sources and Wikis.

## 2. Register or update the Source

- **Live Agent conversations** (manual last-N-days backfill or automatic Hook continuation): follow the [session ingestion guide](../../guides/session-ingestion.md) using `gpk_sessions_next` and `gpk_sessions_apply` (never `gpk_sources_create`).
- **Existing note vaults / workspaces:** follow the [import guide](../../guides/import.md).
- **Documents, URLs, excerpts and files:**
  1. Search existing Sources via `gpk_sources_get` (`text`) to check for an existing entry or faithful variant, and inspect `customTemplates.source` if customized in the backend.
  2. Prepare the body following `customTemplates.source` or the [bundled Source template](../../assets/templates/source.md) (respecting `preferences.contentLanguage`, while keeping original titles and quotations verbatim). State actual reading coverage honestly.
  3. Create the Source in one call with `gpk_sources_create` (`title`, `content`, optional `originalFile: "file:///..."` when Craft's upload API is connected, `links`; `recordInDaily` defaults to `true`, automatically logging `"Saved"` in the Daily Note).
  4. To update an existing Source, recover an interrupted empty body (`replaceContent` + `expected`), or attach an `originalFile` to an existing Source, use `gpk_sources_update`.

Capture finishes once the Source is verified.

## 3. Study & Deep Research: Integrate into Wikis and connect to work

- **Deep Research:** Use available host search/fetch tools to examine independent primary sources, retaining materially useful sources via `gpk_sources_create` before synthesizing.
- **Wiki integration:**
  1. Query candidate entries and aliases via `gpk_wikis_get` (`text`) and read matches (`targets`) before deciding whether to revise an existing Wiki or create a new subject under the [Wiki entry criteria](../../knowledge/domain-model.md#wiki).
  2. Revise existing explanations with `gpk_wikis_update` (`edits` or `append`, `linksAdd` citing the Source, `expected`) or create a qualifying new entry with `gpk_wikis_create` (`links` citing the Source, following `customTemplates.wiki` when present). Cite Sources next to claims and preserve uncertainty or disagreement.
- **Connect to active work & Outputs:**
  - Read relevant Projects (`gpk_projects_get` with `states: ["active", "planned"]`) and explain which Objective, KR or open Task the evidence affects.
  - When the user confirms an action, Project adjustment or retained artifact from the material, apply it directly (`gpk_tasks_create`, `gpk_projects_update`, `gpk_outputs_create`, `gpk_links`) without forcing a separate Skill handoff.
- **Long-running checkpoints:** Use `gpk_checkpoints` (`read` / `save` with `expected`) for multi-pass imports or research (`import/<origin>` or `ingest/<origin>`).

## Boundaries

Every write requires a persisted grant; on `unauthorized`, direct the user to `gpk_setup_open`. On `partial` or `conflict`, inspect `affected`, `completedSteps` and current records before retrying. Never fabricate URLs, access scope or citations.
