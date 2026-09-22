# Plugin Organization and Loading

Status: **Package 0.1.0; only the shared read-only bootstrap is active.**

This page owns file organization, discovery, packaging and resource loading.
The [workflow contract](../plugin/runtime/contracts/workflows.md) owns context,
templates, business procedures and execution/recovery; the
[adapter contracts](../plugin/runtime/contracts/adapters.md) own integration interfaces.

## Source layout

```text
gpk/
├── plugin/                          Canonical installable Claude Code package
│   ├── .claude-plugin/plugin.json   Plugin metadata
│   ├── skills/
│   │   ├── gpk/SKILL.md             Only active Skill
│   │   └── gpk-*/SKILL.md.stub      Five named workflows; no procedure bodies
│   ├── knowledge/
│   │   ├── domain-model.md          Canonical domain rules
│   │   ├── domain-model.zh-CN.md    Chinese companion
│   │   └── conformance-scenarios.md Single acceptance inventory
│   ├── runtime/
│   │   ├── contracts/
│   │   │   ├── adapters.md          Interface and public data contracts
│   │   │   └── workflows.md         Workflow and execution design
│   │   ├── references/
│   │   │   ├── bootstrap.md         Implemented read-only procedure
│   │   │   └── *.md.stub            Empty context/operations/templates/result-return
│   │   ├── adapters/
│   │   │   ├── knowledge/craft/mapping.md
│   │   │   ├── harness/claude-code/mapping.md
│   │   │   ├── harness/codex/mapping.md
│   │   │   └── control/knowledge-backend/mapping.md.stub
│   │   ├── lib/.gitkeep             No runtime helper modules yet
│   │   └── scripts/.gitkeep         No Agent-invoked runtime programs yet
│   └── assets/templates/
│       └── default_project_template.md.stub  Empty; not a usable default
├── adapters/codex/                  Generated installable Codex package
├── .claude-plugin/marketplace.json  Repository-local Claude development catalog
├── .agents/plugins/marketplace.json Repository-local Codex development catalog
├── docs/                           Product explanation and contributor guides
├── scripts/                        Build and validation tools
├── tests/                          Repository checks
└── package.json                    Node development commands
```

The five reserved workflows are Setup, Ingest, Plan, Work and Review.
Their `SKILL.md.stub` files have only name/description frontmatter. Other `*.stub`
files are empty, and `.gitkeep` preserves otherwise empty directories. Only
`SKILL.md` entries participate in Skill discovery; a reserved name is not an
available command. No current runtime program orchestrates writes or timers.

The real contract and mapping Markdown bodies are design/evidence resources;
they are not executable interfaces. Before activating a workflow, implement its
procedure and required resources, validate actual capabilities, add its package
metadata and applicable checks, then deliberately promote the stub. Renaming an
empty file is insufficient.

## What reads or runs each file

| File role | Consumer and effect |
|---|---|
| Plugin manifests / Skill frontmatter | Host discovery and build tools identify available entries |
| `SKILL.md` and relevant reference Markdown | Agent reads instructions for the selected request |
| Domain and contract Markdown | Agent/implementer consults meaning and expected behavior |
| Default template, when implemented | Creation procedure and renderer organize content |
| `runtime/lib/` helpers, when implemented | Explicit entrypoint or test performs deterministic transforms |
| `runtime/scripts/` programs, when implemented | Host tool executes a bounded procedure when called |
| Root `scripts/` and `tests/` | Developer/CI builds and validates the package |
| Root `docs/` | Reviewers and implementers; not a required installed runtime resource |

Reading Markdown does not execute it. A helper does not inherit the conversation's
MCP tools merely because it runs as a Node process. An Agent may pass bounded input
to a helper and invoke an actual tool with the resulting payload; direct API use
requires a separately implemented and authorized transport.

Use the existing Node/ESM toolchain when deterministic helpers are needed.
TypeScript notation in contracts describes interfaces without selecting a compiler,
framework, SDK, server or additional dependency. Shared instructions are reused
through packaged references; no portable cross-Skill invocation API is assumed.

## Packaging and isolation

Claude Code loads canonical `plugin/` directly. The builder
`scripts/build-platform-adapters.mjs` generates `adapters/codex/` from that source
and adds Codex manifest/UI metadata. Never edit the generated package by hand.

For each active Codex Skill, the builder vendors real `knowledge/`, `runtime/`
and asset resources under its install-local `references/gpk/` tree, preserving
internal module paths. Generated copies have no independent authority.

The builder excludes `*.stub` and `.gitkeep`. It rewrites inline Markdown links
for the generated resource locations. Reference-style definitions and autolinks
are not rebased; extend the builder and fixtures before relying on those forms.
Only `gpk` is currently distributed as an active Skill.

Installed instructions resolve resources relative to their own package, without
a developer's repository path or root `docs/` and `scripts/`. They must not
accidentally read another installation or a user's control directory. Personal
templates and configuration stay in the selected User Control store and are
accessed explicitly through its provider, never bundled in the plugin.

Current loading follows `gpk/SKILL.md` → shared `bootstrap.md` → relevant domain
rules and supplied/authorized read-only material → assessment. The five workflow
stubs do not enter that path. Future procedures follow the
[workflow contract](../plugin/runtime/contracts/workflows.md).

Build, check and local loading commands are maintained in
[Getting started](getting-started.md). A build does not install a plugin, change
client configuration, start an authenticated Agent session or register a schedule.
Repository catalogs support development; central marketplace distribution is pending.

Generated-drift, metadata, link and isolated-package checks validate distribution.
Fixture imports do not prove production runtime modules exist; client CLI validation
does not prove an installed session worked. Behavioral and integration evidence
belongs in the [acceptance inventory](../plugin/knowledge/conformance-scenarios.md).
