# Roadmap

Milestones describe usable product outcomes. Current capabilities are maintained
in [README](../README.md#current-support); target user needs belong to the
[scenario catalogue](requirements.md). Implementation details belong to
[architecture](architecture.md), [workflow design](workflow-design.md) and
[storage contracts](storage-contracts.md); the
[conformance scenarios](conformance-scenarios.md) own the acceptance inventory.

The delivery priority is M1 → M2 → M3. Mobile entrypoint exploration can run
alongside M2, using the shared core established by M1; M3 still requires its own
validated user outcome.

## Milestone 1: End-to-end Craft version

A person can use GPK for real knowledge and project work through **Claude Code
and Codex with Craft**: establish the system, bring in useful material, plan work,
advance Tasks, retain results and review outcomes. Records and user configuration
remain available when the conversation or Agent client changes, using current
Craft facts and one selected local `.gpk` control root accessible to both authorized
desktop clients. The GPK-facing tool runtime is **MCP stdio only**: the host
launches a packaged local program; Skills call tools rather than shelling out to a
GPK CLI. HTTP listener/deployment, remote authentication and control migration are
not M1 requirements. Craft's downstream transport is a separate selection.
Mobile/remote access to that local root is not an M1 claim. The
[architecture extension](architecture.md#future-extension-streamable-http) records
how a later HTTP binding reuses the same tools, handlers and ports.

The first version covers three core scenarios:

| Scenario | Usable outcome | Acceptance references |
|---|---|---|
| Small everyday action | Capture an accepted reminder as a standalone Task, choose the next action, manage waiting and retain its actual result. | A1, A4, A5, I4, K6 |
| Knowledge-only work | Retain and prepare reference material, retrieve it later and maintain useful explanations with evidence, without requiring a Project or action. | K1–K5, I4 |
| Full Project loop | Use relevant material to establish a bounded Objective and KRs, explicitly activate accepted work, retain Task results, revise the plan, review outcomes and close the Project with remaining Tasks resolved. | A2, A3, A6, K6, T5, W1; “Direction becomes a revisable plan” |

These scenarios use declared, validated reader coverage. Additional input formats,
assisted migration and optional recurring Tasks/habits can be delivered separately.

Complete when:

- Both clients can load the plugin, start its isolated packaged stdio runtime,
  select the appropriate Skill and perform its implemented operations against the
  selected Craft workspace. Validate launch, protocol output, shutdown, current
  reads and independent client processes against R1/R2/R6/R11; package tests alone
  do not satisfy installed-host execution.
- Setup/onboarding initializes valid typed Settings in the local `.gpk` root with verified active backend,
  layout and template choice, declared safe defaults and complete readback, not a
  separate completed flag. Setup establishes the resources needed for all three scenarios, and Ingest,
  Plan, Work and Review complete them in both clients. Writes have verified,
  persistent effects; information and next-action queries remain read-only.
- Enabled automatic retention of selected Agent conversations works in both
  initial integrations, satisfying COM-07/COM-08 and P1–P3. Validate actual
  capture/processing, incremental updates, restart/catch-up, overlap and revoked
  grants through the shared [source processing design](workflow-design.md#5-generic-source-processing-and-periodic-execution).
  Internal Hook/timer choice is not a user-maintained recurring business task;
  explicitly requested cadences use validated native harness scheduling.
- A user can resume the same work in a fresh session or the other client using
  current Craft records and local control files, preserving direct user edits.
  Validate both clients' access to the same root; Craft being offline does not
  reset configuration or prevent reading local preferences/templates.
- Installation, ordinary use and recovery from representative failures are
  validated in both clients. The release documents its supported scope and limits.

## Milestone 2: Extensibility and common platform coverage

Prove that the shared GPK core supports independent Agent and backend extensions,
and make GPK usable across common platforms as a foundation for wider adoption.
Users can choose additional tool combinations, reusing the domain model, routing
policy, Skills and workflow rules established by the first end-to-end version.

The initial expansion targets are **WorkBuddy and OpenClaw** for Agent clients,
and **Obsidian, Feishu / Lark and Notion** for knowledge backends. Deliver each
target in a documented, validated Agent/backend combination. Representative
combinations also exercise the host and storage boundaries to establish a
repeatable extension path.

Complete when:

- The three core scenarios from M1 run with a new Agent on an existing backend,
  an existing Agent on a new backend, and the new Agent/backend pairing. Record
  actual workflow evidence against R8 in the
  [acceptance inventory](conformance-scenarios.md#implementation-acceptance).
- Each initial expansion target supports these core scenarios through
  its validated combinations. Published packages, setup instructions and usage
  guides let a new user install, connect and complete them in each
  claimed environment; verify this against R9 in the acceptance inventory.
- These combinations reuse shared domain and workflow rules, routing instructions,
  Skills and operation contracts. Integration-specific behavior belongs to host
  bindings and concrete adapters. Necessary refinements to the shared core apply
  across integrations and preserve the first milestone's validated behavior.
- Evidence shows preserved domain meaning, current facts, relationships, results
  and authorization behavior. Publish the validated combinations, capability
  limits and which core components were reused or refined versus which integration
  components were added. Verify preservation and recovery for any offered
  backend-transfer path.

Further integrations follow the extension path established by this evidence and
extend the usable platform coverage.

## Milestone 3: Mobile coverage

A person can use GPK from a phone for everyday capture, next-action selection,
result recording and short reviews, then continue the same work on desktop.

Identify and validate a practical mobile entrypoint: an existing mobile Agent
client, a share/capture entry or a lightweight web interface. Select the approach
by whether it provides usable access to the shared Skills and selected stores.
For an HTTP-based entrypoint, deploy the thin Streamable HTTP binding around the
same operations and use one durable server-accessible control authority. A
single-user server can reuse the local-file adapter on a persistent volume; choose
a service-backed UserControlPort only when that deployment needs it. If control
must move, verify an explicit migration/cutover and renewed secret/grant bindings.
Do not assume a phone can read the desktop `.gpk` directory, inherit desktop
conversation readers or introduce a second configuration authority. Validate the
HTTP boundary separately against R12; it does not by itself establish mobile
Skill/workflow support. Exploration can precede M3 without expanding M1.

Complete when:

- At least one mobile entrypoint works on real devices, with documented supported
  platforms, authentication and where Agent execution takes place.
- On a phone, a user captures material, asks for next actions through Focus,
  records an actual Task result through Work and completes a short Review.
  Validate all four operations against R10 in the
  [acceptance inventory](conformance-scenarios.md#implementation-acceptance).
- Mobile captures and results are available on desktop; desktop plans and edits
  inform mobile Focus and Review through the same current authoritative records
  and selected user configuration.
- Routine mobile use and recovery from interrupted requests are validated, with
  clear confirmation of retained results and no second authoritative data copy.

For every milestone, completion requires observed user workflows in the claimed
environments and recorded acceptance evidence. Packaging and type checks support
delivery; live workflow checks establish the product outcome. Features such as
assisted migration, optional recurring Tasks/habits and additional control-store
providers belong to the milestone whose user outcome needs them.
