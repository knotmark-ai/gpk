# Getting started

This page shows how to build the packages, load them in Claude Code, Codex or Antigravity and
exercise the implemented GPK workflows against Craft. What the current package can and cannot do is
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

The build generates the Claude Code, Codex and Antigravity packages in `dist/marketplace/` from
`plugin/` and `platforms/`; `pnpm build:previews` adds the OpenClaw, WorkBuddy and
Hermes previews. Do not edit or commit generated files. `pnpm test` builds and checks manifests, relative references,
isolated packages and release archives. `pnpm test:clients` additionally uses supported
read-only CLI commands when those clients are installed: Claude validates the
plugin, catalog and Skills; Antigravity (`agy`) runs strict plugin/archive validation;
Codex only checks its version and whether plugin
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

The Agent should discover the GPK tools and call `gpk_status` (`{"include":["capabilities"]}`).
A connected MCP process is not proof of initialized Settings or Craft connectivity.
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
$gpk:gpk Check the GPK MCP runtime status and adapter capabilities.
```

In Codex CLI, `/mcp` lists the tools loaded in the session. Verify that
`gpk_status` returns a result. If it reports `onboarding: "required"`,
invoke `$gpk:gpk-setup` to open the setup page.

### 3b. Load the Antigravity plugin

With the Antigravity CLI (`agy`) installed, validate and install the generated package:

```bash
agy plugin validate --strict ./dist/marketplace/antigravity/gpk
agy plugin install ./dist/marketplace/antigravity/gpk
```

Alternatively, inherit `dist/marketplace/.agents/plugins.json` from a workspace `.agents/plugins.json` during development. Antigravity loads `rules/AGENTS.md` natively, registers the `gpk` MCP server from `mcp_config.json`, and exposes all six GPK Skills (`gpk`, `gpk-setup`, `gpk-plan`, `gpk-work`, `gpk-ingest`, `gpk-review`).

To exercise entry routing, review/trust the installed Hook definitions using the
host's native flow, start a fresh session, then give a GPK request without an
explicit Skill name. Confirm that the Agent loads the intended Skill, continues
it for a refinement and selects again for a different outcome. Also try unrelated
conversation and an explicit Skill request with Hooks disabled. Follow R7 in the
[acceptance inventory](conformance-scenarios.md); the [Hook loading details](plugin-runtime.md#entry-hook-loading)
explain the commands and Codex trust/installation requirements. A successful
context-output test does not establish these Agent decisions.

## Open the local service

All three desktop packages include the same service and a small stdio bridge. Install the optional terminal command once from any extracted plugin. From a repository build:

```sh
node dist/marketplace/codex/gpk/mcp/install.mjs
gpk open
```

The installer copies the bundled package into npm’s global prefix. No registry download is needed. For a one-off launch use `node dist/marketplace/codex/gpk/mcp/cli.mjs open`. The console shows **Status**, **Configuration** (workspace setup, optional Craft attachment upload API, automatic session retention, and writing/time preferences), and **MCP & Skills** (interactive visual mapping between the 6 Skills and 28 MCP tools with structured parameter tables). Start a batch import through the host’s `gpk-ingest` Skill with a source and mapping rules.

`gpk start` starts the shared service or reports its existing PID. `gpk restart` waits for shutdown and starts the service bundled with the installed CLI. It also works when the service is stopped.

`gpk status` reports the active port, PID, root, Settings state and onboarding state. `gpk connection` starts or discovers the service and prints the path to its private URL and bearer-header configuration for a Streamable HTTP client. `gpk stop` stops the service for all local hosts. Hosts discover the port automatically. Select the same `GPK_CONTROL_ROOT` in each host to share a Craft authorization. After rebuilding, rerun the CLI installer, use `gpk restart`, and reconnect any host that reports a closed connection.

## 4. Run Setup

GPK reads `GPK_CONTROL_ROOT` from the launch environment and otherwise uses
`~/.gpk`; the directory is created on the first write. Until Setup is done,
`gpk_status` reports `onboarding: "required"` and every knowledge
operation fails with a `next` step that names `gpk_setup_open`.

Open the local console with `gpk open` (or ask the Agent to run `gpk-setup`).
- **Status** shows the service version, PID, MCP endpoint, instance directory, Craft authorization, workspace permission status and automatic session retention state.
- **Configuration** is the Setup and preferences center: connect Craft and select a space on its authorization page; on return, choose an existing GPK workspace or create one with dedicated or shared storage, review names and metadata language, and establish the workspace. Creating or adopting a workspace automatically persists full non-destructive workspace grants across GPK's 8 bound containers. Reopen **Configuration** anytime to configure **Automatic session retention**, connect the optional **Local image & PDF upload API**, or edit `Content language`, `Timezone` and `Agent instructions`.
- **MCP & Skills** maps GPK's 6 Skills (`gpk`, `gpk-setup`, `gpk-plan`, `gpk-work`, `gpk-ingest`, `gpk-review`) to the 28 registered BFF tools with search, read/write filters and structured parameter schemas.

The browser console is the only surface where `settings.json` layout bindings and `grants.json` are created: no MCP tool writes grants, so the
Agent can open the page but cannot consent for you. Each page session has a
random token, and the server accepts requests only for its own Host and
Origin with JSON bodies; it stops after 30 minutes without activity or with the
runtime.

On macOS they go to the login
keychain under the `gpk` service, elsewhere to `secrets.json` in the root with
mode 0600. Each control root gets its own token entry, so a second root (for
example `GPK_CONTROL_ROOT=~/.gpk-fresh` pointed at another space) never
replaces the first root's tokens. The control files are plain JSON you can read and edit; the
[local control mapping](adapters/local-control.md) documents their envelope.

## 5. Run the Task flow

With Setup complete:

1. `gpk_captures_get({"surface":{"name":"inbox"}})` to list Inbox items in one call.
2. `gpk_tasks_create({"title":"…","content":"…","time":"YYYY-MM-DD"})`, then
   `gpk_tasks_get` and `gpk_tasks_update` (`time`, `transition`, `edits`, `append`,
   `activitySummary`) with the returned reference and `expected` version.

Writes fail `unauthorized` until a grant covers the operation on the Task's
container; `conflict` means the Task changed between read and write.
`pnpm test:runtime` exercises the same path against a fake Craft connection
and isolated package copies without credentials.

## 6. Run the Project loop

1. `gpk_areas_create({"title":"…","content":"…","state":"active"})`, then
   `gpk_projects_create` with `primaryArea`, Objective/KRs/scope body, and optional
   `initialTasks` and `materials` in one call.
2. `gpk_projects_get` with `targets` and `include: ["area", "tasks", "materials", "links"]`
   expands Project context in a single read; `gpk_projects_update` reorders Tasks
   (`taskOrder`), appends or edits process material (`materialAppend`, `materialUpdate`),
   reassigns `primaryArea`, or transitions state; `gpk_tasks_update` moves a Task
   into a Project or back to standalone (`project: {"target": null, "reason": "…"}`).
3. Transitioning a Project to `completed` or `canceled` via `gpk_projects_update`
   fails `conflict` while any Task in the row is open; transition the Tasks first.

Rows and Tasks are visible and editable in Craft's Projects and Areas tables
and their Board / By Area / Active views.

## 7. Ingest material

1. `gpk_sources_get` with `text` to check whether the work is already
   registered (and receive `customTemplates.source` if customized in Craft);
   otherwise `gpk_sources_create` with origin, access evidence, prepared material,
   and optional `originalFile` (`recordInDaily` defaults to `true`).
2. `gpk_wikis_get` for the subjects it touches, then `gpk_wikis_update` (with
   `edits`/`append` and `linksAdd` citing the Source) or `gpk_wikis_create` (with
   `links` citing the Source).
3. `gpk_links` (`action: "query"`) on any record shows links in both directions;
   `gpk_checkpoints` (`read` / `save`) keeps resumable progress under keys such as
   `ingest/<origin>` or `import/<origin>`.

### Conversation retention and recent-day backfill

By default (when `origins` is empty), GPK automatically discovers installed
Claude Code (`~/.claude/projects`), Codex (`~/.codex/sessions`) and Antigravity
(`~/.gemini/antigravity-cli/brain`) transcript roots on the machine. Keep all
supported desktop clients on the same selected control root and backend.

Ask in any supported client: **"Retain useful knowledge from my conversations in
the last 7 days through GPK."** The Agent enters `gpk-ingest` and uses the shared
[session procedure](../plugin/guides/session-ingestion.md). Dates select original
user-turn activity in a rolling N×24-hour window. Report the discovered and
excluded scope. The same conversation reuses its Source, unchanged input is
skipped, and overlapping automatic/manual work shares progress.

For automatic processing, open **Configuration → Automatic session retention**
(`gpk open`), switch on automatic summarization, choose the retain granularity
and automatic ingest depth, and review/trust the installed Hooks in your client.
At turn completion a bounded continuation invokes `gpk-ingest`, processing up to
three sessions; the next active session catches up. When all clients are closed,
no background job runs. Inspect partial/uncertain writes before retrying, and
update the plugin package when testing source changes. See
[current support](../README.md#current-support) for the validation boundary.

## 8. Review

`gpk_review_inventory({"cadence":"weekly"})` returns the population to review
with its coverage. Decide per record and write with the entity tools: a dated
line under a Project's `Results & Review` and optional lifecycle closure
(`transition`) through `gpk_projects_update`, and Task changes through
`gpk_tasks_update` or `gpk_tasks_create`.

## 9. Developer commands

`pnpm gpk <command>` covers what the product flow does not: inspecting a
local run, resetting it and starting Claude Code with the current build.
Authorization and Setup stay in the host through the `gpk-setup` Skill. Every
command takes `--root <dir>` for another control root and `--yes` to skip
confirmations.

| Command | What it does |
|---|---|
| `pnpm gpk status` | Settings, Craft authorization, bound space, grant count and layout checks, through the built runtime |
| `pnpm gpk reset` | Revokes the refresh token, deletes it from the secret store and deletes the control root; Craft content remains available for manual inspection |
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
up. Use `pnpm gpk reset` for a clean local start. The former `--craft` option
is refused before any change: Settings identifies configured locations, not which
resources Setup created or which content the user subsequently added. Select any
Craft cleanup manually in Craft, especially when Setup adopted existing folders.

## 10. Extending GPK

See [current support](../README.md#current-support) for what ships today and the
[roadmap](roadmap.md) for remaining milestones (archive/restore/remove, additional
knowledge backends, recurrence and remote/mobile deployment). Extend
`src/adapters/craft.ts`, `src/adapters/craft-collections.ts` and
`src/adapters/craft-documents.ts` one verified operation at a time; grant
resolution and compound BFF handlers live in `src/runtime/operations.ts`,
bootstrap in `src/runtime/bootstrap.ts`, and MCP schemas in `src/mcp/server.ts`.

All five business Skills have workflow bodies; [workflow design](workflow-design.md)
retains the periodic-execution design until implemented. The [domain model](../plugin/knowledge/domain-model.md),
[storage contracts](storage-contracts.md), [adapter mappings](adapters/README.md)
and [acceptance inventory](conformance-scenarios.md) define implementation criteria.
Rebuild after source changes and run the checks before enabling any new operation.
