# Changelog

All notable changes to GPK will be documented here.

## Unreleased

- Add `pnpm gpk`, developer commands for local runs: status, auth, setup,
  call, raw Craft commands, reset (token revocation, secret and control-root
  removal, optional Craft cleanup) and launching Claude Code with the package.
- Default Setup layout is now the top level of a workspace dedicated to GPK;
  the `GPK` namespace folder is opt-in for shared workspaces.
- Fix: the Craft connection no longer repeats a write after a 5xx or network
  failure, which could create duplicate documents, rows or blocks.
- Fix: Area and Project operations check that the row belongs to the
  configured Collection, and material operations that the page belongs to its
  Project; previously the Projects grant could edit rows of other Collections
  and any page in the space.
- Fix: apostrophes in JSON arguments are escaped instead of stripped.
- Fix: completing or canceling a `doing`/`waiting` Task removes its state tag
  from the action line.
- Implement the Review slice: a read-only `gpk_review_inventory` that reads
  the reviewed population in one call (Inbox captures; overdue, today,
  upcoming, doing, waiting and unscheduled Tasks; Projects by state with
  `no-next-action`, `all-waiting` and `overdue` signals; Areas with Project
  counts; traversed population and gaps) and a real `gpk-review` workflow
  that writes conclusions back through the entity tools. No Review entity,
  timer or second planning algorithm.
- Implement the knowledge slice: Sources, Wikis and Outputs as documents in the
  folders Setup creates (resolve, read, query by title or link, create, rename,
  body edits); contextual links as bullets with block links and context in the
  linking record's body, discovered in both directions by scanning GPK records;
  processing checkpoints as nested pages of a `GPK System` page in the host
  document; `relatedTo` predicates on every entity query. Seventeen new MCP
  tools, a real `gpk-ingest` workflow, a `system` grant root in the default
  set and `links.add` on the capture-surface grants. The connection retries a
  Craft 500 once for reads only.
- Implement the Project slice: Areas and Projects as rows of the Collections
  Setup creates (typed Status and Area columns, bodies on the row page, dated
  reason blocks on transitions and Area changes, closure refused while Tasks
  are open); Project-owned Tasks as task blocks inside the row in plan order,
  with creation after the last Task, reordering by block moves, ownership moves
  between a Project and today's Daily Note, and Project-scoped queries without a
  space-wide listing; process material as inline sections or nested pages. Task
  blocks outside GPK's locations are reported as unmanaged. Seventeen new MCP
  tools, a real `gpk-plan` workflow and Project awareness in `gpk-work`. Secret
  keys are scoped per control root, and a failed browser authorization is now
  reported by `gpk_connection_status` instead of being swallowed. Verified
  against the existing space and a fresh space onboarded through Setup.
- Implement the Setup slice: Settings initialize/update and grant grant/revoke in
  the local control adapter through atomic file replacement; Craft layout
  inspection and establishment (host document, Areas and Projects Collections with
  a relation column, Sources/Wikis/Outputs folders, adoption by ID with preflight);
  Setup bindings that work before Settings exist; default grant proposal; six new
  MCP tools and a real `gpk-setup` workflow. Hand-written control files are no
  longer required. Everything Setup creates lives under a namespace folder; it
  installs the bundled entity templates into Craft's Templates area and creates
  Board/By Area/Active views, so people and the Agent work through the same
  structures (dual operability).
- Implement the first vertical slice (acceptance scenario A1): GPK's own OAuth
  client to Craft's MCP endpoint with dynamic registration, PKCE, loopback
  callback and refresh-token rotation in a host-neutral secret store; local
  control reads of `settings.json` and `grants.json`; Craft Task and capture
  operations (resolve, read, query, create, update, transition, schedule; Inbox
  and Daily Note captures); grant resolution in the runtime with adapter-side
  containment checks; 12 new MCP tools; a real `gpk-work` workflow. Decide
  Projects and Areas as Craft Collections, Task state tags, the `.gpk` file
  envelope and the three-layer authorization model. Remove the caller-supplied
  authority string from write guards.
- Add the explicitly requested engineering skeleton: six minimal MCP Skill
  entrypoints, a bundled stdio server, protocol-independent handlers and complete
  Craft/local-control Port implementations that return unsupported without I/O.
  Package launch configurations and dependency notices for Claude/Codex; verify
  all 82 stub methods, schema validation, fresh delegation, isolated MCP calls and
  process shutdown. Keep business workflows and HTTP unimplemented.
- Select local-file User Control for MVP: one explicit `.gpk` root per instance,
  JSON Settings/grants and role-declared Markdown personal templates shared by
  authorized desktop clients. Keep Craft for knowledge; defer service-backed
  control until mobile needs it and drop visible note-backed control from MVP.
  Align Setup/bootstrap, provider mappings, roadmap and acceptance without
  creating user configuration or claiming an implemented adapter.
- Unify User Control template operations with explicit roles and six named Settings
  bindings. Add Area, Task, Source, Wiki and Output defaults in English and Chinese
  alongside Project; keep Task inline. Update Skill use, onboarding, acceptance and
  isolated-package/type checks without claiming persistent adoption or rendering.
- Replace arbitrary User Control KV operations with typed, nested Settings,
  named template operations and separate scoped grants. Specify backend
  configurations/MCP references, per-backend layout, safe defaults and verified
  Settings initialization as onboarding; keep personal facts in Knowledge Backend.
  Update Setup guidance and source/emitted consumer tests without claiming runtime support.
- Distinguish user-requested recurring work, scheduled by the selected harness,
  from GPK-managed internal feature processing. Automatic session retention may
  use Hooks/timers without a user-maintained recurring task; update requirements,
  workflow/architecture, M1 and P1–P3 acceptance without claiming runtime support.
- Extend COM-12 with historical session backfill through shared Ingest; specify
  scoped batches, current-fact reconciliation, original activity dates and safe
  incremental continuation in I11 without claiming automatic execution.
- Specify connected daily Agent-session summaries through shared Ingest: evolving
  conversation Sources, scoped Project associations, accepted/evidenced Task
  effects, maintained Wiki and dated Daily Notes links; add COM-12, S7 and I10.
- Specify existing-collection adoption through shared Ingest: new-target import
  and in-place organization, Source identity boundaries, preservation and safe
  incremental recovery; add COM-11 with S6 and I8–I9 acceptance cases.
- Add an English user-needs catalogue with a Chinese companion, distinguishing
  action, knowledge and connected scenarios from implementation mechanisms;
  link methodology coverage and existing acceptance cases without claiming support.
- Share entry routing between `gpk` and context-only Claude Code/Codex Hooks.
  Compile the loader from TypeScript, bundle rules and host configuration, and
  verify registered commands and extracted release execution in isolation.
  Keep live Agent routing acceptance separate from loader/package checks.
- Keep entity data and operation contracts together under `src/domain/`; move the
  two port interfaces there and rename shared `types.ts` to `operation-types.ts`.
  Preserve public exports/signatures and update imports, documentation and path checks.
- Remove duplicate `kind` fields from the six entity data projections; retain them
  on concrete references for operation targets and contextual links. Update field
  comments, the contract guide and consumer type checks.
- Remove `?: never` exclusions from entities, creation/query inputs and the complete
  read-result variant. Types declare only applicable fields; runtime input validation
  remains an implementation responsibility. Update the contract guide and type checks.
- Merge the port guide into `docs/storage-contracts.md` and keep Skill resource
  assembly private to the plugin builder; remove the two redundant files.
- Simplify domain contracts: declare entities/references and creation inputs
  independently; remove `EntityKind`, `EntityContent`, `Entity`, `EntityRef` and
  the unused `Coverage` alias. Link/query parameters list allowed concrete references
  directly; create receipts require an explicit reference type.
  Limit build-script exports to actual release callers and defer runtime module,
  callback and provider structure until an implementation needs it.
- Document port parameters and results in TypeScript JSDoc, including query
  defaults, cursor scope, text-edit ordering, write revision targets and failure
  meanings; keep cross-operation guarantees in the storage contract guide.
- Reject linked package source roots and ancestors before reading their resources;
  cover external-resource leaks in isolated Claude and Codex packaging tests.
- Mark prerelease archives explicitly and preserve the stable distribution tree
  when publishing prereleases; test later patches and hyphens in build metadata.
- Compare distribution content checksums so equal-sized files with normalized
  archive timestamps are updated correctly.
- Render default Project properties as separate list items and accepted actions
  as ordered checkboxes in both language templates.

- Define the 0.2 runtime around an initial MCP binding and an optional CLI
  (`docs/architecture.md`); keep the TypeScript ports as runtime contracts with
  read operations stable and write operations marked draft. Document the Task time
  format (`YYYY-MM-DD`) and the control-instance binding.
- Move the workflow design, storage contracts and conformance scenarios from
  `plugin/` to `docs/`. Packages now carry only Agent-facing content; `plugin/`
  loses no behavior the shipped Skill used.
- Make the OpenClaw, WorkBuddy and Hermes previews opt-in through `--previews`
  (`pnpm build:previews`, `pnpm dist:previews`). The default build and release
  produce the Claude Code, Codex and marketplace packages only.
- State current capability once, in the README; remove restated status, scattered
  package-version mentions and the stale `.stub`/`.gitkeep` filtering from other
  documents, scripts and tests.
- Rename the `KnowledgeBackendAdapter` / `UserControlAdapter` interfaces to
  `KnowledgeBackendPort` / `UserControlPort`; `*Adapter` now names concrete
  provider implementations only. No compatibility aliases are exported.

- Add a usable default Project template in English and Chinese, plus Agent guidance
  for template selection and in-conversation drafting. Bundle both assets with all
  platform packages; personal-template adoption and backend writes remain pending.

- Define compiler-checked `KnowledgeBackendPort` and `UserControlPort` under
  `src/domain/`, alongside entity types and separate from concrete provider implementations.
  Knowledge operations are grouped by Area, Project, Task, Source, Wiki and Output;
  host loading remains manifest/Skill behavior.
- Keep each port's complete contract in one file and declare entity operations
  independently. Remove `EntityAccess`, `EntityQuery` and `EntityUpdate`; replace
  `KnowledgeQuery` with `SourceQuery`, `WikiQuery` and `OutputQuery`. Query and
  update inputs can evolve per entity; result envelopes and text edits remain shared.
- Separate `src/domain/` data and contracts, `plugin/guides/` Agent behavior and
  `docs/adapters/` provider evidence; remove Markdown adapter/runtime scaffolding
  and duplicate signatures.
- Add strict type checks, generated declarations and consumer contract tests to
  pnpm/CI; current runtime support is tracked in the README.

- Adopt pnpm and a shared Node build for Claude, Codex and packaging previews for OpenClaw, WorkBuddy and Hermes.
- Consolidate generated output under `dist/`: one `marketplace/` tree for local
  loading and releases, `types/` declarations, and `archives/` ZIPs/checksums.
- Remove ten unused Skill/procedure/template placeholders and merge duplicate
  host-loading notes into the plugin guide; retain future work in the roadmap.
- Add tag-based Release publication and optional CI-managed distribution repository updates.
- Preserve executable resources through builds, ZIPs and CI transport; support
  file/directory replacements and reject resource collisions and manual permission changes.
- Protect distribution publication against version rollback and source-repository
  aliases differing in case; allow tag retries after repository configuration changes.

- Separate authoritative state encoding from query capability; specify scoped
  enumeration versus limited search, Craft's actual MCP/tag-hierarchy boundaries,
  workflow coverage rules and six additional unexecuted query acceptance cases.
- Clarified compact Project properties, action-first presentation and verified
  document/PR references for review Tasks across backend representations.

- Consolidate positioning into README, domain rules into one model, and shared
  workflow design and acceptance coverage into their canonical contracts.
  Architecture is the review map; packaging and provider evidence remain separate.
  This documentation change does not activate workflows or change package versions.
- Establish domain specification 0.4 with six entities and 20 specified acceptance
  scenarios; keep the package version at 0.1.0.
- Replace the legacy Skill entrypoint with a shared read-only bootstrap for
  explaining GPK and assessing scoped supplied or connected Craft material.
- Package that bootstrap for Claude Code and Codex from one canonical source.
- Add isolated-package checks and optional installed-client CLI validation.
- Document local loading, smoke tests, and the boundary between packaging checks
  and future end-to-end workflow conformance.
- Consolidate reusable rules into the current domain and runtime sources; remove
  obsolete templates, migration guidance, Craft mapping and compatibility pointers.
  Verified native template rendering and write workflows remain pending.

## 0.1.0 - 2026-08-30

Historical scaffold notes; superseded model and capability descriptions below
are not the current support contract. See README for current readiness.

- Define GPK as a goal- and project-driven personal knowledge system.
- Add the canonical object model, lifecycle, and filing rules.
- Add a portable GPK Agent Skill.
- Model direction as North Star Goal → OKR Goal → Key Results → Actions, with the
  Objective and Key Results contained in the Goal document.
- Add a canonical Claude Code plugin and generated Codex adapter.
- Add a supported Craft store mapping and integration contract.
- Add generated-drift, skill, and platform compatibility checks.
