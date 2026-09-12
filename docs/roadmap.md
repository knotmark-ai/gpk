# Roadmap

Milestones below refer to package delivery. The domain baseline is 0.4; the
package remains 0.1.0. Current support and product scope are maintained in the
[README](../README.md).

The [workflow contract](../plugin/runtime/contracts/workflows.md) and
[adapter contracts](../plugin/runtime/contracts/adapters.md) define implementation
requirements. The [conformance scenarios](../plugin/knowledge/conformance-scenarios.md)
are the sole acceptance inventory; specified cases remain unexecuted until
supporting evidence is recorded.

## 0.1 — Plugin foundation

The foundation provides the canonical domain model, one shared read-only
bootstrap, a Claude Code package and generated Codex package. It includes
repository and isolated-package checks, optional installed-client CLI validation
and manual loading instructions.

Five named business Skill stubs, shared procedure slots, a control mapping slot
and a default Project template slot reserve implementation work. They are inactive;
the foundation does not establish installed-session or full domain conformance.
Repository catalogs support local development. Registration and validation in a
central plugin marketplace remain delivery work.

## 0.2 — Craft workflows

Deliver in four implementation slices, validating each before enabling its Skills:

1. **Domain and adapter minimum.** Implement scoped reads/search, create/update,
   state/time/link operations, concrete Craft representation and independent
   Knowledge Backend/Harness/User Control boundaries. Verify initial Craft-backed
   control discovery, fresh reads, conflicts and effect readback. Enable deletion
   and advanced restructuring only when their preservation/recovery contract works.
2. **Personalized first workflow.** Implement Setup → personal Project template →
   Plan → Work/result return. Provide usable defaults, adopt existing resources,
   preserve personal edits across upgrades, and recover the same configuration
   from a fresh harness with access to the selected stores.
3. **Generic Ingest.** Implement lightweight capture, Prepare, appropriate
   destinations and resumable processing of unchanged, appended and revised
   sources. Verify source readers and authorized real periodic execution for both
   target harness integrations. Conversations are a Source case; manual import
   alone does not satisfy timed ingestion.
4. **Review and resilience.** Implement scoped Review/Replan, outcome evidence,
   recovery and cross-harness workflow acceptance. Include direct user edits,
   partial failures, revoked grants and upgrade behavior in verification.

Complete actual installation/session checks for Claude Code and Codex with Craft,
plus scoped workspace discovery/audit and dry-run report formats. Default template
rendering, state/time/control encoding, source coverage and concurrency guarantees
must be backed by real tool evidence before affected capabilities ship.

## 0.3 — Assisted migration

Deliver inventory and dry-run classification, reversible move plans, identifier
and link verification, recovery information and review of ambiguous legacy content.
Validate actual migrations and rollback limits against the same acceptance inventory.

## 1.0 — Stable personal system

Publish a versioned compatibility contract, adapter conformance evidence, stable
release packaging, and documented upgrade and recovery paths.

## Later integrations

Notion, Obsidian, local knowledge files and additional Agent clients remain
candidates. Add them individually after the Craft workflows are stable and their
adapters pass applicable checks.

An explicitly selected local `.gpk` control directory or cloud control provider
is a separate extension. Implement provider selection, access/error handling and
verified migration before claiming support; neither implies automatic cross-device
synchronization or a local knowledge backend.

Team collaboration, permissions and cross-store synchronization remain outside
the 1.0 scope unless the personal model demonstrates a clear product need.
