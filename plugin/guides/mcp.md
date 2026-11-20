# Calling GPK MCP

The host launches the installed Node stdio program from the plugin's `.mcp.json`,
which connects to GPK's shared local service. Call the exposed MCP tools directly
through the host; never execute internal scripts, invoke CLIs to bypass grants,
configure credentials by hand, or write GPK records through another connector.

## Optimistic invocation and readiness

1. Discover tools from the server named `gpk` (preserving any host prefix).
2. **Call the target workflow tool directly** when the user asks for knowledge,
   planning, daily work or review. Do not run ceremonial preflight checks on
   every turn.
   - If onboarding is incomplete (`onboarding: "required"`), any knowledge call
     returns a structured failure naming `gpk_setup_open`: route to `gpk-setup`.
   - Call `gpk_status` explicitly when checking readiness, preferences
     (`contentLanguage`, `timezone`, `instructions`), customized backend
     templates (`customTemplates`), or optional `include` views (`grants`,
     `capabilities`, `templates`, `setup`).
3. **Human console boundary:** Connecting a knowledge backend, creating or
   adopting workspace structures (which automatically persists full
   non-destructive grants across GPK's 8 bound containers), and connecting
   Craft's optional attachment upload API happen exclusively in the user's
   browser via `gpk_setup_open`. Never fetch or submit the one-time setup URL
   yourself; if `opened` is `false`, show the URL to the user and wait.
4. **Read before updating:** Pass `version` from the latest read as `expected`
   on `*_update`, `gpk_links`, and `gpk_checkpoints`.
   - Use `edits` for targeted literal replacements within one block, `append` to
     add new trailing prose without matching existing text, and `replaceContent`
     (with `expected`) only to recover an interrupted empty record body.
5. **Inspect the full `Result`:**
   - Check `ok`, `limits`, record `coverage`, page `coverage`, and `verified`.
   - `unauthorized`: the target lies outside GPK's bound containers, uses an
     ungranted operation (`links.remove`), or workspace grants need syncing via
     `gpk_setup_open`.
   - `conflict`: the record changed since read, or a domain precondition failed
     (such as closing a Project with open Tasks) — re-read and confirm with the
     user before retrying.
   - `partial` / `uncertain`: real effects may already exist. Inspect
     `affected`, `completedSteps`, `failedStep` and `next` before retrying;
     retry only the remaining steps, never recreating records already in
     `affected`.

Use Task tools (`gpk_tasks_*` or `initialTasks` on `gpk_projects_create`) for
accepted actions and state changes. Other record bodies and prose edits must not
insert native task checkboxes; use `☐` / `☑` when quoting checklists.

## Language and live templates

- Reply in the conversation language unless asked otherwise.
- Check `preferences.contentLanguage` (returned by `gpk_status`): when set (for
  example `"en"` or `"zh-CN"`), author new record bodies in that language; when
  `null` (default), follow the conversation language and the language of the
  record being edited. Preserve original titles, quotations, code, and user
  edits verbatim. Structural container names follow `metadataLanguage` chosen
  during Setup; schema keys, state values and `#gpk/...` tags stay English.
- Entity `*_get` tools and `gpk_status` automatically piggyback
  `customTemplates` whenever the user has customized a template in the backend's
  native Templates area. Follow [GPK templates](templates.md): prefer the live
  backend template in `customTemplates` (preserving user-added sections and
  provider callouts), falling back to the bundled role template when unchanged.

## Daily activity across workflows

Record substantive GPK outcomes in the Daily Note by default (completed work,
Project milestones, Task outcomes, planning decisions, reviews, research, or
standalone activities reported by the user). Respect any explicit request to
skip logging.

- Compound `*_create` and `*_update` tools accept an optional `activitySummary`
  (and `activityDate`) so the mutation and its Daily Note entry happen in a
  single tool call.
- `gpk_sources_create` automatically records `"Saved"` with the Source link in
  the Daily Note (`recordInDaily` defaults to `true`), and `gpk_sessions_apply`
  records retained session Sources on completion.
- Use `gpk_daily_record` for standalone activities or outcomes without a write
  on another entity. Keep the summary to one plain factual sentence (no
  newlines, brackets or list markers) and pass `related` when linking a record.

## The 28 MCP tools

- **System & Preferences (3):** `gpk_status`, `gpk_setup_open`,
  `gpk_preferences_update`
- **Captures & Daily Notes (2):** `gpk_captures_get` (resolves and lists Inbox
  or a dated Daily Note, or reads capture `refs`), `gpk_daily_record`
- **Areas (3):** `gpk_areas_get`, `gpk_areas_create`, `gpk_areas_update`
- **Projects & Materials (3):** `gpk_projects_get` (supports `targets`,
  `material`, query filters, and `include: ["area", "tasks", "materials", "links"]`),
  `gpk_projects_create` (supports `initialTasks`, `materials`, `links`),
  `gpk_projects_update` (title/edits/append/replaceContent, `primaryArea`,
  `taskOrder`, `transition`, `materialAppend`, `materialUpdate`, `linksAdd`)
- **Tasks (3):** `gpk_tasks_get`, `gpk_tasks_create` (single Task or batch
  `items[]`), `gpk_tasks_update` (title/edits/append, `time`, `project`,
  `transition`, `linksAdd`)
- **Sources (3):** `gpk_sources_get`, `gpk_sources_create` (supports
  `originalFile`, `links`, auto Daily Note log), `gpk_sources_update`
- **Wikis (3):** `gpk_wikis_get`, `gpk_wikis_create`, `gpk_wikis_update`
- **Outputs (3):** `gpk_outputs_get`, `gpk_outputs_create`, `gpk_outputs_update`
- **Links & Review (2):** `gpk_links` (`query` | `add` | `remove`),
  `gpk_review_inventory`
- **Sessions & Checkpoints (3):** `gpk_sessions_next`, `gpk_sessions_apply`
  (see [session ingestion](session-ingestion.md)), `gpk_checkpoints`
  (`read` | `save`)

Entity deletion, archiving and restoration are intentionally omitted from the
MCP surface so records are never destroyed or hidden by an Agent call.
