# Claude Code instructions

Read and follow `AGENTS.md`. It is the canonical maintainer contract for this
repository.

Entity types and operation contracts live together in `src/domain/`.
Concrete providers implement those ports under `src/adapters/`, while
`src/runtime/operations.ts` and the 28-tool MCP facade in `src/mcp/server.ts`
depend only on the domain contracts. Shared Skill content lives in `plugin/`;
`pnpm build:claude` generates the installable package at `dist/marketplace/claude/gpk/`.
This file governs repository development rather than the behavior of the installed GPK skill.
