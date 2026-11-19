# Repository instructions

GPK is a portable methodology plugin for goal- and project-driven knowledge work.
Read `README.md`, `docs/architecture.md` and
`plugin/knowledge/domain-model.md` before changing behavior.

## Authority and scope

- `README.md#current-support`: the only statement of what works now. Other
  documents link to it instead of restating what is pending.
- `docs/requirements.md`: target user needs, scenarios and adopted methodology
  coverage. Separate user outcomes from implementation mechanisms.
- `plugin/knowledge/domain-model.md`: canonical entities, relationships, states
  and domain operations. English is authoritative; Chinese is supporting material.
- `src/domain/`: compiler-checked entities, references, states and the
  KnowledgeBackendPort / UserControlPort contracts with shared operation types.
  `KnowledgeBackendPort` covers workspace setup, backend templates, the six
  entities, captures, links and checkpoints; `UserControlPort` has named Settings
  and grant contracts, not arbitrary KV storage.
- `src/adapters/`: concrete Craft/local-control Port implementations plus the
  Craft OAuth connection, uploads and the secret store. Implemented operations are verified
  against live spaces and fake connections. Implement and verify before changing capability claims.
- `src/runtime/` and `src/mcp/`: adapter-agnostic operation handlers (`operations.ts`
  imports only domain contracts), session ingestion coordinator, review inventory,
  instance bootstrap, and the 28-tool Agent BFF MCP server (`server.ts`).
- `plugin/`: everything the shipped Skill reads at runtime, and nothing else.
  `skills/` holds `gpk` and the five workflow entrypoints (`gpk-setup`, `gpk-plan`,
  `gpk-work`, `gpk-ingest`, `gpk-review`); `rules/` holds the shared entry routing
  policy and checkpoint; `guides/` holds the MCP, template, session-ingestion,
  import and bootstrap procedures; `assets/templates/` holds bundled fallback defaults
  for the six entity roles, with Task represented as an inline fragment.
- `docs/architecture.md`: responsibility boundaries and the decision on where the
  adapter runs.
- `docs/workflow-design.md`, `docs/storage-contracts.md`, `docs/conformance-scenarios.md`:
  design of the five planned workflows, port behavior guarantees and the acceptance
  inventory. They are developer documents; a design moves into `plugin/` only when
  a Skill implements it.
- `docs/adapters/`: provider mappings, implementation guidance and dated evidence.
- `docs/`: architecture, packaging, usage and feature-delivery roadmap. Link to
  canonical bodies rather than reproducing them.

Initial targets are Codex, Claude Code and Antigravity with Craft as Knowledge Backend (owning
both domain records and native editable entity templates) and one explicitly selected
local `.gpk` root as User Control (JSON Settings and grants). Service-backed control
is deferred until mobile needs it; note-backed control is not an MVP target. Other
integrations (Notion, Feishu, Obsidian) remain future work until implemented and validated.

## Contribution rules

- Keep domain meaning independent of clients and stores. Add structure or code
  for an actual consumer, not merely to fill a future abstraction.
  Apply Occam's razor: prefer explicit per-entity contracts and modest repetition
  over abstractions based only on similar shapes or anticipated future consistency.
  Keep read projections and creation inputs independent. Declare only applicable
  fields; do not list absent fields with `?: never`. Export helpers only for real
  callers; tests should exercise product contracts, not justify unused APIs.
  Use concrete references directly; list allowed kinds at each cross-entity parameter
  instead of introducing a shared `Entity` / `EntityRef` layer.
  Architecture responsibilities do not mandate separate modules, classes or registries.
- Keep product assets self-contained in the repository. Private project records
  remain in the user's knowledge backend; never include private references,
  credentials or personal context in distributable files.
- Keep one authoritative body per topic. Update the Chinese companion when
  positioning, support scope or main workflows change.
- Keep domain data and operation contracts together; `Port` names an interface role,
  not a separate architectural layer. Within the domain, contracts use entities and
  shared operation types; concrete adapters implement the contracts. Domain code
  must not depend on adapters or provider SDKs. Shared domain/workflow rules must
  not be redefined per provider. Reserve `Adapter` for concrete implementations.
- `src/` owns domain types, ports and future implementations; `plugin/` owns
  shared Skill content; `platforms/` owns packaging metadata.
  `dist/` is the only generated root: `types/`, `marketplace/` and `archives/` have
  separate ownership inventories. Never edit or commit generated output; rebuild.
- Preserve existing user changes and unknown native content. For migrations,
  follow the domain model's preservation rules.
- `package.json` owns package identity and version. Generate manifests and
  marketplace catalogs from it; the Codex catalog has no version field.
- Public signatures belong only in TypeScript; do not duplicate them in Markdown.
  Document parameter meaning, omission/null/empty behavior, scope, revision targets
  and expected failures beside the declarations; keep shared behavior in its guide.
  Implementations must conform to those interfaces and the behavioral guides.
  Do not infer tool registration from type declarations. Keep unimplemented or
  out-of-scope paths fail-closed and never return fabricated facts or mutation receipts.
- Use pnpm, TypeScript and Node scripts for builds. The default build and release
  cover Claude Code, Codex and Antigravity; OpenClaw, WorkBuddy and Hermes previews are opt-in
  (`--previews`) and do not establish installed-client support. Keep distribution
  credentials in CI secrets.
- Keep planned work in `docs/` and the roadmap, not empty directories or placeholder
  Skills/templates. Do not equate packaging checks with live backend conformance.

Before finishing a change, run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm dist
```
