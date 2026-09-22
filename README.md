# GPK

**Goals set direction. Projects drive progress. Knowledge compounds.**

GPK (Goals · Projects · Knowledge) is a goal- and project-driven personal
knowledge system. It gives people and AI agents a shared, portable way to turn
captured information into deliberate progress and durable knowledge.

[简体中文](README.zh-CN.md)

## Why GPK

Goals, tasks, reading material and notes often live apart. Information accumulates
without a clear relationship to decisions or work, and each AI client sees a
different slice of context. Changing tools can mean rebuilding the whole system.

GPK connects continuing direction, finite work and learning through one model:

| Entity | Purpose |
|---|---|
| Area | Continuing direction and responsibilities in an independent document |
| Project | A bounded intended change with its own Objective and Key Results |
| Task | An accepted action and useful results, within a Project or standing alone |
| Source | Retained material and evidence with traceable origin |
| Wiki | An independently useful, maintained explanation or synthesis |
| Output | An artifact intentionally retained for use, delivery, decisions or operation |

There is no separate Goal entity. Objective and KRs belong inside a Project;
topics remain metadata. Inbox and Daily Notes provide capture and working
surfaces. The [domain model](plugin/knowledge/domain-model.md) defines the exact
meaning, relationships, states and operations.

## Product approach

- Direction and responsibilities guide attention; collecting information is
  useful when it supports decisions, action or learning.
- Outcome evidence matters more than activity counts. Finishing Tasks does not
  by itself establish that a Project achieved its KRs.
- Planning can include future possibilities without committing to execute them.
  Review decides what to activate or revise; Full Plan and Focus serve different
  needs, and a date alone does not activate a Project.
- Everyday work stays lightweight. A Task can stand alone, retain its result in
  place, and link useful knowledge without producing a compulsory artifact.
- Research has distinct homes: original evidence in Source, reusable synthesis
  in Wiki, and Project-specific research and decisions in the Project. Output
  retention does not depend on publication or Project closure.
- Agents use current facts, preserve user content and work within granted scope.
  Ambiguous new material can remain in Inbox; migration uncertainty belongs in
  `Backup/Unsorted`, which is recovery material rather than an active category.
- Portable meaning is implemented through native tool capabilities. Supporting
  nested Project material or another client must preserve the same relationships.

The product consists of a canonical domain model, shared Agent Skills, thin
adapters and default templates. It is intended first for one person using Claude
Code or Codex with Craft. It does not require a new editor, task application,
universal knowledge taxonomy, central mirror database or synchronization service.
It is not a provider subscription wrapper or a requirement to turn every Source
into a Task. Team governance and collaboration remain future scope.

Success means captured material becomes easier to use and learn from, while
changing a supported client preserves the relationship between direction, work
and knowledge. Further backend portability must be demonstrated by each adapter.

## Current support

The domain baseline is **0.4**; the plugin package is **0.1.0**.

| Component | Available now |
|---|---|
| Shared `gpk` Skill | Explain the method and assess scoped material read-only |
| Claude Code | Canonical `plugin/` package; `/gpk:gpk` after loading |
| Codex | Generated `adapters/codex/` package; `$gpk` after loading |
| Craft | Scoped reads through an existing user-configured, authorized connection |

The bootstrap can assess supplied material without a connection. Live access
depends on the tools and permissions in the chosen client. GPK provides no Craft
credentials, connector or data proxy; API access requires separate configuration
and verification.

Setup, Ingest, Plan, Work and Review have inactive `SKILL.md.stub` placeholders.
Their procedures, usable default templates, persistent User Control setup, writes,
migration and periodic execution remain unimplemented. Other clients and stores
are future candidates, not supported integrations.

The [acceptance inventory](plugin/knowledge/conformance-scenarios.md) records
specified behavior awaiting execution. Package and document checks do not prove
installed Agent behavior or live Craft conformance.

## Start here

- [Getting started](docs/getting-started.md): build, locally load and assess the
  current foundation. Repository catalogs support local development; distribution
  through a central marketplace remains pending.
- [Architecture](docs/architecture.md): responsibility boundaries, document
  ownership and the review path into domain, workflow and adapter contracts.
- [Roadmap](docs/roadmap.md): feature delivery and the evidence needed to ship it.

Reusable product documents, including drafts, live in this repository and can be
reviewed without private notes. Personal Project context remains in the selected
knowledge backend, recording result summaries and links to external artifacts.

## License

[MIT](LICENSE)
