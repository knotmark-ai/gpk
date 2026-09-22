# Repository instructions

GPK is a portable methodology plugin for goal- and project-driven knowledge work.
Read `README.md`, `docs/architecture.md` and
`plugin/knowledge/domain-model.md` before changing behavior.

## Authority and scope

- `plugin/knowledge/domain-model.md`: canonical entities, relationships, states
  and domain operations. English is authoritative; Chinese is supporting material.
- `plugin/runtime/contracts/`: adapter interfaces and shared workflow design.
- `plugin/runtime/adapters/`: provider mappings and dated capability evidence.
- `plugin/skills/`: implemented Agent behavior. Only `gpk/SKILL.md` is active;
  five business Skills and default templates remain inactive `.stub` files.
- `plugin/knowledge/conformance-scenarios.md`: acceptance criteria, not test results.
- `docs/`: architecture, packaging, usage and feature-delivery roadmap. Link to
  canonical bodies rather than reproducing them.

Initial targets are Codex and Claude Code with Craft. Other integrations remain
future work until implemented and validated. Preserve the current read-only
foundation boundary unless the requested change explicitly implements a workflow.

## Contribution rules

- Keep domain meaning independent of clients and stores. Add structure or code
  for an actual consumer, not merely to fill a future abstraction.
- Keep product assets self-contained in the repository. Private project records
  remain in the user's knowledge backend; never include private references,
  credentials or personal context in distributable files.
- Keep one authoritative body per topic. Update the Chinese companion when
  positioning, support scope or main workflows change.
- `plugin/` is canonical; `adapters/codex/` is generated. Never edit the generated
  package by hand; rebuild after changing packaged sources.
- Preserve existing user changes and unknown native content. For migrations,
  follow the domain model's preservation rules.
- Keep `package.json`, both plugin manifests and the versioned Claude marketplace
  entry aligned. The Codex marketplace schema has no version field.
- Do not activate empty workflow/template stubs or equate packaging checks with
  installed-session or live backend conformance.

Before finishing a change, run:

```bash
npm run build:adapters
npm test
```
