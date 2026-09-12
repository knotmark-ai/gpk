# Architecture

Status: **Domain 0.4 design; package 0.1.0 implements only the read-only bootstrap.**

[中文说明](architecture.zh-CN.md)

GPK keeps domain meaning independent of the Agent client and knowledge store.
The [README](../README.md) owns product positioning and current support scope.
This page explains the responsibility boundaries and where to review each part
of the design; detailed rules live in the documents that own them.

## Responsibility boundaries

| Layer | Responsibility |
|---|---|
| Domain | Entity meaning, relationships, states, operations and invariants |
| Skills | Interpret intent and compose operations using current context |
| Knowledge Backend adapter | Map domain reads and effects to actual store capabilities |
| User Control adapter | Discover and maintain resources in the selected control store |
| Agent Harness adapter | Provide instruction loading, interaction, tools, source access and execution |

The three adapters are independent interfaces even when two reuse one connection.
Their first integration targets are Craft for knowledge, Craft-backed User Control,
and Claude Code/Codex as harnesses. Full control setup and mutation workflows are
design targets. A local control directory and cloud control service are future
provider options, each requiring its own implementation and access checks.

```text
User request / authorized trigger
              |
     Agent + selected Skill
       |       |        |
       |       |        +-- Harness adapter --> actual tools and execution
       |       +----------- Control adapter --> selected user resources
       +------------------- Knowledge adapter --> domain facts and effects
```

This is a division of responsibilities, not a requirement for separate services.
Markdown instructions and existing host tools can implement a workflow together
with small helpers for mechanical work. Intent, relevance, Objective/KR judgment
and synthesis remain Agent work; pagination, encoding and comparison justify code
when an actual consumer needs them.

A store owns its persistent facts; an adapter owns no persistent truth. Domain
records, origin identity and verified processing progress belong in the selected
Knowledge Backend. Profile, configuration, personal templates and grants belong
in the selected User Control store. Host mechanisms retain credentials, minimal
connection information and actual scheduler registrations.

The selected control authority is explicit. Another harness must recover current
facts from the selected stores and report missing access. Temporary context and
generated packages are not competing databases. The
[adapter contracts](../plugin/runtime/contracts/adapters.md) own the exact data
ownership, capability declarations and public input/result types.

## One authoritative body per subject

English documents are authoritative. Chinese companions explain the same model
and review path; they do not introduce independent rules. Summaries and generated
package copies point to or derive from their canonical source.

| Review question | Authoritative source | Owns |
|---|---|---|
| Why does GPK exist, for whom, and what works now? | [README](../README.md) | Product positioning and support boundary |
| What do objects and operations mean? | [Domain model](../plugin/knowledge/domain-model.md) | Six entities, relationships, transitions and domain invariants |
| How does an Agent carry out the intended work? | [Workflow contract](../plugin/runtime/contracts/workflows.md) | Context, templates, five Skills, input processing and execution/recovery |
| What crosses each integration boundary? | [Adapter contracts](../plugin/runtime/contracts/adapters.md) | Three interfaces and public data/operation envelopes |
| What does a concrete integration expose? | [Provider mappings](../adapters/README.md) | Actual provider representation, dated evidence and capability limits |
| What behavior must be demonstrated? | [Conformance scenarios](../plugin/knowledge/conformance-scenarios.md) | The single domain, behavior and implementation acceptance inventory |
| What ships and how is it loaded? | [Plugin runtime](plugin-runtime.md) | File organization, discovery, packaging and resource isolation |
| How can the current foundation be tried? | [Getting started](getting-started.md) | Build, local loading and manual assessment instructions |
| What will be delivered next? | [Roadmap](roadmap.md) | Feature sequence and release readiness |
| What must a contribution preserve? | [Repository instructions](../AGENTS.md) | Authoring, privacy and validation rules |

This architecture page owns the map and high-level boundaries, not another copy
of the entity specification, workflow procedures or acceptance tables.

Review domain operations and public data contracts first, then the three adapter
boundaries, context/templates/material handling, Skills and execution, and the
applicable scenarios. Check a provider's evidence before accepting an
implementation claim. Review source layout only when a change affects loading or
distribution; consult getting started when validating the user entry path.

When a requirement changes, edit its owning document and adjust only affected
summaries, mappings, Skills and checks. Do not preserve an old design as another
current authority. Executable instructions must follow the domain and relevant
contracts. Observed provider limits must be reported honestly; they cannot silently
relax the domain meaning. Generated content is refreshed from canonical source.

## Product artifacts and private knowledge

Reusable product specifications, designs, decisions, Skills, templates, code and
tests live in this repository, including drafts. They explain the product's
problem, users, scope, intended outcomes, design tradeoffs, implementation,
verification and delivery without access to private notes.

Personal Project plans, user context, research history and review notes remain
in the selected knowledge backend. Product documents must not carry the owner's
personal Area membership, goals, responsibilities, finances, private OKRs or time
allocation. The generic Area concept and synthetic examples belong to the product
model; actual personal Area instances do not.

Private knowledge may link to repository artifacts. Repository and other external
deliverables must not depend on private note URLs, IDs, titles, personal workspace
paths or instructions to consult private material. Include authorized product
requirements and necessary reasoning directly, with repository-local or public
references. Removing a private link does not make personal background publishable.

An artifact keeps one authoritative body in its own workspace. Its producing
Project or Task can retain a useful summary and artifact/revision link. Temporary
context is a non-authoritative input, not a second Project/Task or control store.

## Implementation and review evidence

The active `gpk` entry reads the shared bootstrap and domain rules, then explains
or assesses scoped supplied/authorized material. Workflow, procedure and template
stubs remain inactive. Their existence does not implement the contracts.

Packaging checks establish source consistency, metadata and isolated resource
resolution. Operation evidence must establish real backend effects; workflow
evidence must establish Agent decisions and composed outcomes. Portability needs
fresh-harness access to the selected stores and equivalent behavior. These levels
are recorded against the [acceptance inventory](../plugin/knowledge/conformance-scenarios.md),
not inferred from a successful build.

New integrations become supported only after a concrete adapter and applicable
conformance evidence exist. The current build path remains canonical `plugin/`
to generated `adapters/codex/`; complete loading details belong in
[Plugin runtime](plugin-runtime.md).
