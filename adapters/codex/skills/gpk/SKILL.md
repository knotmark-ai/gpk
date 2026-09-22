---
name: gpk
description: Explain GPK's goal- and project-driven knowledge method, assess notes against its model, and check readiness for a Craft workflow. Use for GPK setup questions or read-only reviews of Areas, Projects, Tasks, Sources, Wikis, and Outputs. This foundation does not yet execute knowledge-base changes.
---

# GPK

Use a shared method across Agent clients: continuing direction in Areas,
Objective and Key Results inside bounded Projects, actionable Tasks, traceable
Sources, maintained Wikis, and useful Outputs.

## Current capability

This is the **0.1.0 plugin foundation**, using the **0.4 domain model**. It
supports methodology explanation, connection-readiness checks, and scoped
read-only assessment. It does not yet implement Create, Capture, Prepare, Ingest,
Review/Replan writes, migration, publication, or scheduling.

For a requested change, explain the missing workflow/adapter capability and offer
an in-chat proposal if useful. Do not invent backend operations or treat
available write tools as an implemented GPK
workflow. This boundary applies to this Skill, not to unrelated user work.

## Load and route

Read the [domain model](references/gpk/knowledge/domain-model.md) before applying GPK.
It is the single English authority for entities, relationships, states and
operations; a [Chinese companion](references/gpk/knowledge/domain-model.zh-CN.md) is available.

- **Explain or draft in chat:** answer the requested methodological question from
  these references. No backend connection is needed for a synthetic example or
  discussion of material the user supplied.
- **Check setup or assess existing notes:** follow
  [bootstrap and read-only assessment](references/gpk/runtime/references/bootstrap.md). Limit inspection
  to the relevant authorized material; distinguish current reads from snapshots.
- **Implement or verify an adapter:** consult the
  [acceptance scenarios](references/gpk/knowledge/conformance-scenarios.md) as design
  criteria, not proof of completed tests or permission to mutate a knowledge base.

Adapter contracts and capability investigations are design references, not
implemented write procedures. Workflow and template stubs are inactive.

## Preserve the method

Area is an independent document, not a tag. Goal is not a separate entity;
Objective and KRs are Project content. Standalone Tasks and unassigned Sources
are valid. Planned Projects are not active commitments, and a due Task does not
activate its Project. A read-only Focus suggestion must consider current parent
Project status, not just checkbox dates.

Keep source provenance and actual reading coverage explicit. Source, Wiki, and
Project relationships can be many-to-many. Useful Task results may stay inline;
Output is optional and does not require publication or Project closure.

General rules are bundled here. Domain records and identity/processing mappings
belong in the Knowledge Backend; preferences, configuration, grants and personal
templates belong in the explicitly selected User Control store. Its first planned
provider reuses the Knowledge Backend; local/cloud alternatives are not implemented
by this foundation. Neither adapter caches nor conversation memory are authoritative.
Read relevant current information when it
affects the request; use the user's language unless they ask otherwise.
