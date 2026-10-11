# Plugin Organization and Loading

This page owns directory organization, discovery and resource loading.
[Architecture](architecture.md) explains responsibilities; [distribution](distribution.md)
owns build commands, release archives and publication.

## Source and generated layout

```text
gpk/
├── src/                           TypeScript domain and executable implementations
│   ├── domain/                   Data model and operation contracts
│   │   ├── entities.ts           Entity data, concrete references and states
│   │   ├── knowledge-backend-port.ts  Complete knowledge operation contract
│   │   ├── user-control-port.ts      Complete user-control contract
│   │   └── operation-types.ts       Shared operation inputs/results
│   ├── hooks/entry.mts           Shared context-only Hook loader
│   ├── adapters/                Craft adapter, Craft OAuth connection, local control, secret store
│   ├── runtime/                 Bootstrap (control root, binding) and handlers with grant resolution
│   ├── mcp/server.ts            Tool schemas and registration
│   ├── mcp/stdio.mts            Node stdio entrypoint
│   └── index.ts                  Public type exports
├── plugin/                        Agent content; everything here is packaged
│   ├── skills/                   Shared Skill entrypoints
│   │   ├── gpk/SKILL.md          General entrypoint
│   │   ├── gpk-setup/SKILL.md
│   │   ├── gpk-ingest/SKILL.md
│   │   ├── gpk-plan/SKILL.md
│   │   ├── gpk-work/SKILL.md
│   │   └── gpk-review/SKILL.md
│   ├── knowledge/                Domain model and its Chinese companion
│   ├── rules/                    Entry routing policy and message checkpoint
│   ├── guides/                   MCP invocation, bootstrap and template guidance
│   └── assets/templates/         Six role defaults, each in English and Chinese
├── platforms/                    Platform metadata and loading configuration
│   ├── claude/plugin.json
│   ├── claude/hooks.json
│   ├── claude/mcp.json           stdio launch template
│   ├── codex/plugin.json
│   ├── codex/hooks.json
│   ├── codex/mcp.json            stdio launch template
│   ├── codex/openai.yaml
│   ├── codex/gpk-*.yaml           Workflow-specific Codex presentation
│   └── workbuddy/skill.json
├── docs/                         Developer documentation; never packaged
│   ├── adapters/                 Provider evidence and implementation guidance
│   ├── workflow-design.md        Design of the five planned workflows
│   ├── storage-contracts.md      Port contract map and behavior guarantees
│   ├── conformance-scenarios.md  Acceptance inventory
│   └── *.md                      Architecture, loading, distribution and roadmap
├── scripts/                      Build, release and validation tools
├── tests/                        Type, packaging and publication checks
├── .github/workflows/            CI validation and release
├── package.json                  Package identity, commands and dependency versions
├── pnpm-lock.yaml
├── tsconfig*.json
└── dist/                         All generated output; ignored by Git
    ├── types/                    TypeScript declarations
    ├── marketplace/              Installable directories and marketplace catalogs
    │   ├── claude/gpk/
    │   ├── codex/gpk/
    │   ├── openclaw/gpk/         Preview; only with --previews
    │   ├── workbuddy/gpk/        Preview; only with --previews
    │   ├── skills/*/             Hermes Skill tap preview; only with --previews
    │   ├── .claude-plugin/marketplace.json
    │   ├── .agents/plugins/marketplace.json
    │   └── release.json / README.md / LICENSE
    └── archives/                 Versioned ZIPs and SHA256SUMS
```

`plugin/` is the canonical source of Agent content; `platforms/` adds host metadata
and loading configuration.
`package.json` supplies package identity and version. The domain model version is
independent; the Codex marketplace catalog has no version field.

`plugin/` holds only what the shipped Skills read at runtime. Design documents for
planned work, including the [workflow design](workflow-design.md), stay in `docs/`
and move into `plugin/` only when a Skill implements them. The
[entity templates](../plugin/guides/templates.md) support in-conversation drafts;
their Markdown assets are copied with each Skill's shared references. Task stays
an inline fragment; assets do not execute a rendering engine or backend writes.

The [shared routing policy](../plugin/rules/routing.md) maps requests to all
six entrypoints. Each `plugin/skills/*/SKILL.md` participates in discovery and
packaging, with self-contained runtime references and an explicit execution
boundary. The [README](../README.md#current-support) defines current capabilities.
Creating a Skill does not register tools or enable writes; extend its boundary
only with implemented operations and workflow acceptance evidence.

## What reads or runs each file

| File | Consumer and effect |
|---|---|
| Marketplace catalog | Host locates the installable plugin directory |
| Plugin manifest | Host discovers the plugin and its declared components |
| Skill frontmatter | Host indexes the Skill name and description |
| `SKILL.md` and referenced content | Agent reads instructions for the selected request |
| `assets/templates/*.md` | Agent or person adapts the document; no template engine or backend mutation runs |
| `agents/openai.yaml` | Codex Skill presentation and invocation metadata |
| `src/domain/*.ts` and their emitted declarations | Compiler checks domain/port types; declarations alone do not register tools |
| `src/hooks/entry.mts` → packaged `hooks/entry.mjs` | Node loads bundled rules and emits host context JSON |
| `platforms/*/hooks.json` → packaged `hooks/entry.json` | Host registers session and user-message command hooks |
| `src/mcp/server.ts` | Defines input schemas, tool registration and Result-to-MCP encoding; calls shared handlers |
| `src/mcp/stdio.mts` → packaged `mcp/stdio.mjs` | Host launches the independent Node bundle; stdout is protocol only |
| `platforms/*/mcp.json` → packaged `.mcp.json` | Host expands its plugin-root variable and registers the stdio server |
| `docs/` | Developer reads architecture, evidence and delivery guidance |
| `scripts/` and `tests/` | Developer/CI builds and validates artifacts |

Claude Code and Codex packages each carry self-contained Skills and their resources.
OpenClaw reuses the Claude manifest template. Hermes uses the standard Skill format;
WorkBuddy gets additional publication metadata. These three are opt-in previews
(`pnpm build:previews`). See [getting started](getting-started.md) for Claude/Codex
loading and invocation.

Host tools and permissions must be checked in the actual session. Asking questions,
reading external sources and running timers are host facilities, not capabilities
created by a storage interface. A Node helper does not automatically inherit the
conversation's MCP connections or credentials; it needs bounded inputs, a validated
explicit host bridge or its own authorized transport.

## Executable and hook integration

The [architecture](architecture.md#code-and-packaging-boundaries) separates
shared handlers in `src/runtime/` from MCP schemas/registration in `src/mcp/`.
`bootstrap.ts` resolves the control root from the launch environment, reads the
active backend from Settings and builds the Craft connection lazily with the
host-neutral secret store. See
[current support](../README.md#current-support) for the execution boundary.
The first runtime ships **stdio only**; the HTTP extension is defined in
[architecture](architecture.md#future-extension-streamable-http), not shipped as
an empty listener or second workflow implementation.
Delivery must package runnable code and required dependencies, configure tool
loading explicitly and verify the exposed binding from an isolated installation.
Setup and Skill execution must work without a dedicated GPK CLI. Add CLI packaging
and parity checks only when a concrete use case warrants that optional surface.
Type declarations are not executable tool registrations. The build typechecks
the source and uses esbuild to produce one self-contained ESM Node bundle per
default plugin, including runtime dependencies and their license notices.
The installed package requires Node 22.13+, not pnpm, a checkout or node_modules.

Each default package contains:

```text
gpk/
  .claude-plugin/plugin.json   or .codex-plugin/plugin.json
  .mcp.json                   Server gpk; node + plugin-root/mcp/stdio.mjs
  mcp/stdio.mjs               Bundled executable
  mcp/THIRD-PARTY-NOTICES.txt
  hooks/                      Context-only entry loader
  rules/
  skills/                     Six minimal entrypoints and their reference closure
```

The Claude launch template uses `${CLAUDE_PLUGIN_ROOT}`; Codex uses `${PLUGIN_ROOT}`.
The manifests explicitly point to `./.mcp.json`. Tools are loaded by the host,
not executed by Markdown. Only the shared MCP invocation guide is a new runtime
procedure; business workflow designs remain in `docs/`. Preview/Skill-only packages
do not include this server or its launch configuration.

The source-to-install boundaries are:

| Responsibility | Source ownership | Installed consumer |
|---|---|---|
| Shared tool schemas/registration and operation handlers | Executable modules under `src/`; handlers depend on domain contracts | One compiled runtime per host plugin, not a copy under every Skill's `references/` |
| stdio entrypoint and bootstrap | `src/mcp/stdio.mts` and `src/runtime/bootstrap.ts` | Host launches installed Node program from MCP configuration |
| Local-control and Craft adapters | `src/adapters/`, complete unsupported skeleton implementations pending real I/O | Shared runtime invokes them; no independent adapter service |
| MCP launch registration | `platforms/claude/` and `platforms/codex/`, using verified host formats | Host discovers tools separately from Skill instructions |
| Future HTTP entrypoint and trusted request scope | Add under `src/` only when that deployment is implemented | Independently deployed service calls the same tool registration/handlers |

The future HTTP entrypoint remains a responsibility boundary, not an empty
listener. Ship executable code
and pinned runtime dependencies together; a host command is not a user-facing
CLI. Stdout is reserved for protocol messages, and diagnostics go to stderr.
Private `.gpk` resources, endpoint credentials and user data stay outside packages.
Setup may operate before a Craft connection exists; a missing tool runtime must
produce an explicit limitation, not a Skill silently substituting unguarded writes.
Standalone Skill-only distribution does not imply executable tool support.

For HTTP deployment, clients load the same Agent instructions and an authenticated
endpoint registration instead of a local launch command. The server artifact owns
its executable dependencies, durable control locator and supported secret bindings;
client packages do not contain server credentials. No HTTP deployment artifact or
remote-control migration is required for the first stdio release.

Platform integration owns actual supported hook events, payload decoding,
registration/unregistration and process invocation. It maps events into the
[shared execution path](architecture.md#hooks-and-execution-triggers), not a
second implementation of Ingest, Work or Review. Enable each integration only
after installed-client evidence; a package file cannot prove a hook runs. Hook
and schedule registration require explicit authorization and verification of the
actual host/runner state.

### Entry Hook loading

The [routing loader](../src/hooks/entry.mts) is compiled by `tsconfig.hooks.json`
into temporary staging, then included as `gpk/hooks/entry.mjs` in the Claude Code
and Codex packages. It uses only Node built-ins; the installed Hook requires
Node on the execution environment's PATH, with the repository's minimum version.
Compilation finishes before generated output is replaced. No checkout path,
TypeScript installation or npm runtime dependencies are needed after installation.

Both manifests explicitly reference `./hooks/entry.json`, copied from their
respective `platforms/*/hooks.json`. The default `hooks/hooks.json` is absent to
avoid duplicate registration. Claude uses `CLAUDE_PLUGIN_ROOT`; Codex uses
`PLUGIN_ROOT`. Each command quotes its installed path. These mechanisms follow
the [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)
and [Codex plugin build guide](https://developers.openai.com/plugins/build/plugins).

`SessionStart` loads packaged `rules/routing.md` on startup, resume, clear and
compaction; Claude also binds fork. `UserPromptSubmit` loads the small
`rules/checkpoint.md` reminder. The Agent selects and loads a Skill. Commands
discard stdin without interpreting the prompt, reading transcripts or scanning
the workspace. Both emit `hookSpecificOutput` with `hookEventName` and
`additionalContext`, following the [Claude Hook protocol](https://code.claude.com/docs/en/hooks)
and [Codex Hook protocol](https://learn.chatgpt.com/docs/hooks). A missing/empty
resource or unsupported event emits a short fallback message to stderr and exits
with non-blocking code 1; it emits no context or permission decision.

Codex plugin Hook execution requires native review/trust in addition to plugin
installation or enabling. The [Codex build guide](https://developers.openai.com/plugins/build/plugins)
documents manual desktop installation for Hook-bearing plugins and excludes them
from the public plugin directory; installing from the web does not deploy local
scripts into an execution environment. GPK packaging does not change user trust
settings. Register and verify bindings through the chosen host's supported flow.
Current validation scope is maintained in [current support](../README.md#current-support).

The manual `gpk` entry reads a vendored copy of the same canonical routing file;
each Skill remains usable without a sibling router or startup Hook. OpenClaw,
WorkBuddy and Hermes previews carry Skill references without these Hook bindings.

## Packaging and isolation

`pnpm build` emits `dist/types/` and builds the Claude Code and Codex packages in
`dist/marketplace/`. `pnpm dist` refreshes that same marketplace and creates
`dist/archives/` from the same planned contents. The `--previews` flag on either
command (`pnpm build:previews`, `pnpm dist:previews`) adds the three preview packages.
There is one installable tree for local loading and release packaging. ZIP staging
uses disposable temporary directories, not another persistent package copy.

Targeted builds update one platform while preserving other platforms and existing
catalogs. A full build refreshes catalogs and release metadata. The plugin builder's
`--output PATH` selects an external marketplace root; the release command's
`--output PATH` selects an external root containing `marketplace/` and `archives/`.
Paths inside the source repository are restricted to each command's designated output.

For each active Skill, the builder copies shared `knowledge/`, `guides/`, `rules/` and any
existing `assets/` into `references/gpk/`, preserves local helper paths and executable
bits, rebases inline Markdown links, and includes a license. Every Skill can be
copied independently of the checkout or sibling Skills. Developer docs, source types,
type declarations and inactive resources are excluded from plugin ZIPs.
Colliding resources or links to unavailable/out-of-package files fail the build.
Reference-style Markdown links and autolinks are not rebased; add support and
fixtures before introducing them into packaged content.

Each of `types/`, `marketplace/` and `archives/` has its own `.generated-from-gpk`
ownership inventory. A rebuild replaces or prunes only unchanged owned files;
unknown files, manual content/permission changes and symlinks cause rejection.
Unknown empty directories are preserved and prevent conflicting replacement.
Type compilation finishes before replacing declarations. Release packaging validates
both marketplace and archive output before writing either; it preserves type output.
Generated files are never committed; change source files and rebuild.

## Validation boundary

Checks cover type contracts, metadata, isolated resources, registered Hook
commands/context output and extracted runtime execution, executable permissions,
output protection, reproducible ZIPs and publication/retry scripts. They do not
install plugins, configure clients, access Craft or establish live conformance.
Record those results against the [acceptance inventory](conformance-scenarios.md).
