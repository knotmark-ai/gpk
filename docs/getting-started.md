# Getting started

This page shows how to build the packages, load them in Claude Code or Codex and
exercise the Task and Project slices against Craft. What the current package can and cannot do is
stated once in the README's [current support](../README.md#current-support).

## 1. Build and check the packages

Use Node.js 22.13+ and the pnpm version pinned in `package.json` from the repository root.
Release packaging/tests also need `zip` and `unzip` (macOS/Linux):

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:clients
pnpm dist
```

The build generates the Claude Code and Codex packages in `dist/marketplace/` from
`plugin/` and `platforms/`; `pnpm build:previews` adds the OpenClaw, WorkBuddy and
Hermes previews. Do not edit or commit generated files. `pnpm test` builds and checks manifests, relative references,
isolated packages and release archives. `pnpm test:clients` additionally uses supported
read-only CLI commands when those clients are installed: Claude validates the
plugin, catalog and Skills; Codex only checks its version and whether plugin
management is available. That Codex CLI check is not manifest validation.
Repository package tests check generated metadata separately. A skipped client
check is not a pass for that client.

These commands do not install plugins, change client configuration, start an
authenticated Agent session, or access Craft. Loading in a real client and
checking its behavior remain separate tests.

## 2. Load the Claude Code plugin

With Claude Code installed, run from the repository root:

```bash
claude --plugin-dir ./dist/marketplace/claude/gpk
```

This loads the local plugin for that session without a persistent marketplace
installation. In that session, invoke:

```text
/gpk:gpk Check the GPK MCP runtime status and adapter capabilities.
```

The Agent should discover the GPK tools, call `gpk_runtime_status` and report the
skeleton boundary. A connected MCP process is not proof of initialized Settings
or Craft connectivity.
The flag and session-loading behavior are documented in the
[official Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

## 3. Load the Codex package

The generated package is `dist/marketplace/codex/gpk/`, containing its
`.codex-plugin/plugin.json`, Skill, and vendored references. The repository-local
development catalog is `dist/marketplace/.agents/plugins/marketplace.json` and points at that
package. Use `dist/marketplace/` as the local marketplace root, not the source repository
root. Remote publication requires the [distribution workflow](distribution.md);
do not assume GPK is already available from a public marketplace.

Building does not install it. Use the desktop plugin directory's local/repository
marketplace flow to install the generated `dist/marketplace/` marketplace's GPK entry, following the current
[official OpenAI packaging and local-testing guide](https://developers.openai.com/plugins/build/plugins).
Local-source availability can vary by surface. If the repository source is not
visible, follow that guide's marketplace registration steps; do not assume a
catalog file alone proves installation succeeded.

After installing or reloading the current package, start a fresh session and ask:

```text
$gpk Check the GPK MCP runtime status and adapter capabilities.
```

Confirm that the GPK Skill is actually available and that its referenced files
can be read. A successful manifest check alone does not prove the installed
package is current. This repository does not install or update your personal
plugin configuration automatically.

To exercise entry routing, review/trust the installed Hook definitions using the
host's native flow, start a fresh session, then give a GPK request without an
explicit Skill name. Confirm that the Agent loads the intended Skill, continues
it for a refinement and selects again for a different outcome. Also try unrelated
conversation and an explicit Skill request with Hooks disabled. Follow R7 in the
[acceptance inventory](conformance-scenarios.md); the [Hook loading details](plugin-runtime.md#entry-hook-loading)
explain the commands and Codex trust/installation requirements. A successful
context-output test does not establish these Agent decisions.

## 4. Run Setup

GPK reads `GPK_CONTROL_ROOT` from the launch environment and otherwise uses
`~/.gpk`; the directory is created on the first write. Until Setup is done,
`gpk_runtime_status` reports `onboarding: "required"` and every knowledge
operation fails with a `next` step that names `gpk_setup_open`.

Ask the Agent to set up GPK. It calls `gpk_setup_open`, which starts a page on
`127.0.0.1` inside the runtime process and opens it in your browser:

1. **Connect a knowledge base.** Craft is available; Notion, Obsidian and Lark
   are listed as coming soon and cannot be selected. Craft asks you to choose a
   workspace and approve "GPK", then sends the browser back to the page. Craft
   lists GPK as its own connection, separate from the host's Craft connector.
2. **Workspace and languages.** Choose a dedicated workspace (everything at the
   top level, recommended) or a shared one (everything in one folder), the
   working language (conversation and record content), the metadata language
   (folder, Collection and view names, template headings) and the names. GPK
   creates the host document with the Areas and Projects Collections and their
   views, the Sources, Wikis and Outputs folders and the `GPK …` templates, and
   writes `settings.json`.
3. **Permissions.** Untick anything GPK should not do; the rest is written to
   `grants.json`. Deleting, archiving and restoring are never offered.

The page is the only way grants are created: no MCP tool writes them, so the
Agent can open the page but cannot consent for you. Each page session has a
random token, and the server accepts requests only for its own Host and
Origin with JSON bodies; it stops after 30 minutes without activity or with the
runtime.

Tokens are never stored in the control root: on macOS they go to the login
keychain under the `gpk` service, elsewhere to `secrets.json` in the root with
mode 0600. Each control root gets its own token entry, so a second root (for
example `GPK_CONTROL_ROOT=~/.gpk-fresh` pointed at another space) never
replaces the first root's tokens. The control files are plain JSON you can read and edit; the
[local control mapping](adapters/local-control.md) documents their envelope.

## 5. Run the Task flow

With Setup complete:

1. `gpk_captures_resolve({"surface":{"name":"inbox"}})` and `gpk_captures_list`
   with the result to see Inbox items.
2. `gpk_tasks_create({"title":"…","content":"…","time":"YYYY-MM-DD"})`, then
   `gpk_tasks_read`, `gpk_tasks_schedule`, `gpk_tasks_update` and
   `gpk_tasks_transition` with the returned reference and `expected` version.

Writes fail `unauthorized` until a grant covers the operation on the Task's
container; `conflict` means the Task changed between read and write.
`pnpm test:runtime` exercises the same path against a fake Craft connection
and isolated package copies without credentials.

## 6. Run the Project loop

1. `gpk_areas_create({"title":"…","content":"…","state":"active"})`, then
   `gpk_projects_create` with `primaryArea` set to the returned reference and a
   body holding the Objective, KRs and scope.
2. `gpk_tasks_create` with `project` adds a Task at the end of the Project's
   plan; `gpk_tasks_query` with `project` lists them in plan order;
   `gpk_projects_order_tasks` reorders them; `gpk_tasks_assign_project` moves a
   Task into a Project or back to today's Daily Note (`project: null`).
3. `gpk_materials_append` adds inline or nested-page material;
   `gpk_materials_list`, `gpk_materials_read` and `gpk_materials_update` work on
   nested pages.
4. `gpk_projects_transition` to `completed` or `canceled` fails `conflict`
   while any Task in the row is open; transition the Tasks first.

Rows and Tasks are visible and editable in Craft's Projects and Areas tables
and their Board / By Area / Active views.

## 7. Ingest material

1. `gpk_sources_query` with `text` to check whether the work is already
   registered; otherwise `gpk_sources_create` with the origin, the version and
   date accessed, the coverage and the prepared material.
2. `gpk_wikis_query` and `gpk_wikis_read` for the subjects it touches, then
   `gpk_wikis_update` edits (or `gpk_wikis_create` for a new subject) and
   `gpk_links_add` from the Wiki to the Source with the citation context.
3. `gpk_links_query` on any record shows links in both directions;
   `gpk_checkpoints_save` and `gpk_checkpoints_read` keep resumable progress
   under a key such as `ingest/<origin>`.

## 8. Review

`gpk_review_inventory({"cadence":"weekly"})` returns the population to review
with its coverage. Decide per record and write with the entity tools: a dated
line under a Project's `Results & Review` through `gpk_projects_update`
(an edit whose `after` adds a paragraph), Task changes through the Task
tools, closure through `gpk_projects_transition`.

## 9. Developer commands

`pnpm gpk <command>` covers what the product flow does not: inspecting a
local run, resetting it and starting Claude Code with the current build.
Authorization and Setup stay in the host through the `gpk-setup` Skill. Every
command takes `--root <dir>` for another control root and `--yes` to skip
confirmations.

| Command | What it does |
|---|---|
| `pnpm gpk status` | Settings, Craft authorization, bound space, grant count and layout checks, through the built runtime |
| `pnpm gpk reset [--craft]` | Revokes the refresh token, deletes it from the secret store and deletes the control root; `--craft` first deletes what Setup created in the space |
| `pnpm gpk claude [--no-debug]` | Builds the Claude Code package and starts `claude --plugin-dir` with it; the runtime writes a debug log unless `--no-debug` |
| `pnpm gpk logs [--clear]` | Follows the runtime debug log; run it in a second terminal. `--clear` empties the log first |

**Debug log.** With `GPK_DEBUG=1` the runtime appends one line per event to
`<control root>/logs/debug.log`; any other value of `GPK_DEBUG` is used as the
log path. `pnpm gpk claude` sets `GPK_DEBUG=1`. Each line reads
`<time> [<area>] <event> key=value …`. The areas are:

| Area | What it logs |
|---|---|
| `runtime` | Start and shutdown, and each Craft binding |
| `tool` | Every MCP call with its arguments, duration and result code |
| `onboarding` | Server start, page open, each request with its status, launch-token exchange, form submissions |
| `setup` | Preflight, layout creation (created and adopted structures), the Settings write, chosen grants |
| `craft` | Every Craft command with its duration; rate-limit, server-error and reconnect retries; each OAuth step |
| `grants` | Which grant allowed a write, or which operation and root were denied |
| `operations` | Calls refused by the onboarding gate |
| `control` | Lock waits and control file writes |

Before a line is written, OAuth codes and tokens, the onboarding launch token and
the session cookie are masked. Each value is cut at 300 characters, but record
titles and the start of record bodies can still appear, so treat the log as
private. `pnpm gpk reset` deletes the log along with the control root.

On macOS the token lives in the keychain, not in the control root, so deleting
the directory alone leaves a token that the next run of the same root picks
up. Use `pnpm gpk reset` for a clean start. `reset --craft` finds structures
through the current Settings; Tasks GPK created in Daily Notes are not removed,
and deleted documents stay in Craft's trash until it is emptied.

## 10. Implement the next slice

The next slice is archive/restore/remove, personal templates and recurrence. Extend `src/adapters/craft.ts` (Tasks, captures, layout),
`src/adapters/craft-collections.ts` (Areas, Projects, materials) and
`src/adapters/craft-documents.ts` (Sources, Wikis, Outputs, links,
checkpoints) one verified operation at a time; grant resolution lives in
`src/runtime/operations.ts`, bootstrap in `src/runtime/bootstrap.ts`, tool
schemas in `src/mcp/server.ts`. A future HTTP binding can reuse registration
and handlers while supplying authenticated scope; no HTTP listener ships now.

All five business Skills have workflow bodies; [workflow design](workflow-design.md)
keeps the periodic-execution design until implemented. The [domain model](../plugin/knowledge/domain-model.md),
[storage contracts](storage-contracts.md), [adapter mappings](adapters/README.md)
and [acceptance inventory](conformance-scenarios.md) define implementation criteria.
Default [templates](../plugin/guides/templates.md) remain available assets;
they do not create personal copies or knowledge records.

Rebuild after source changes and run the checks before enabling any new operation.
No plugin installation, configuration mutation, Craft write or remote publication
is implied by building/testing. Follow the [roadmap](roadmap.md) for the first usable
workflow milestone.
