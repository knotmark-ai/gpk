# Claude Code instructions

Read and follow `AGENTS.md`. It is the canonical maintainer contract for this
repository.

Entity types and operation contracts live together in `src/domain/`.
Concrete providers will implement those ports under `src/adapters/`.
Shared Skill content lives in `plugin/`; `pnpm build:claude` generates the
installable package at `dist/marketplace/claude/gpk/`. This file governs repository development
rather than the behavior of the installed GPK skill.
