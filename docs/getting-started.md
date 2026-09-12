# Getting started

GPK's package version is **0.1.0**; its domain model is **0.4**. This foundation
provides one shared, read-only bootstrap for Claude Code and Codex. It can explain
the model and assess scoped material, but does not yet execute knowledge-base
creation, updates, migrations, or scheduling.

Five workflow directories now reserve Setup, Ingest, Plan, Work and Review as
`SKILL.md.stub` files. They have names and intent metadata but no procedures, are
not host-discoverable, and are excluded from the generated Codex package. Do not
try to invoke them as available commands; `gpk` is still the only active Skill.

## 1. Build and check the packages

Use Node.js and npm from the repository root:

```bash
npm run build:adapters
npm test
npm run test:clients
```

The build generates `adapters/codex/` from `plugin/`; do not edit the generated
directory. `npm test` checks generated consistency, manifests, relative references,
and isolated package contents. `npm run test:clients` additionally uses supported
read-only CLI validation commands when those clients are installed. A skipped
client check is not a pass for that client.

These commands do not install plugins, change client configuration, start an
authenticated Agent session, or access Craft. Loading in a real client and
checking its behavior remain separate tests.

## 2. Load the Claude Code plugin

With Claude Code installed, run from the repository root:

```bash
claude --plugin-dir ./plugin
```

This loads the local plugin for that session without a persistent marketplace
installation. In that session, invoke:

```text
/gpk:gpk Explain GPK's six entities and the current limits of this plugin.
```

The expected response explains Area, Project, Task, Source, Wiki, and Output,
including that Objective and KRs belong inside a Project. It should identify the
read-only boundary without requiring a Craft connection for this explanation.
The flag and session-loading behavior are documented in the
[official Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).

## 3. Load the Codex package

The generated package is `adapters/codex/`, containing its
`.codex-plugin/plugin.json`, Skill, and vendored references. The repository-local
development catalog is `.agents/plugins/marketplace.json` and points at that
package. Central marketplace registration and distribution remain pending;
do not assume GPK is already available from a public marketplace.

Building does not install it. Use the desktop plugin directory's local/repository
marketplace flow to install this repository's GPK entry, following the current
[official OpenAI packaging and local-testing guide](https://developers.openai.com/plugins/build/plugins).
Local-source availability can vary by surface. If the repository source is not
visible, follow that guide's marketplace registration steps; do not assume a
catalog file alone proves installation succeeded.

After installing or reloading the current package, start a fresh session and ask:

```text
$gpk Explain GPK's six entities and the current limits of this plugin.
```

Confirm that the GPK Skill is actually available and that its referenced files
can be read. A successful manifest check alone does not prove the installed
package is current. This repository does not install or update your personal
plugin configuration automatically.

## 4. Try the read-only bootstrap

No connection is needed when you supply the material yourself. For example, use
the appropriate entrypoint above followed by:

```text
Assess only this synthetic snapshot using GPK 0.4. Do not write anything.

Area: Research Practice, active. Direction: make evidence-based decisions.
Project: Evaluate a search tool, planned.
Objective: decide whether the tool fits a small research workflow.
KR: a comparison on representative queries supports an explicit adopt/reject decision.
Task: Run the first comparison, todo, planned for today.
```

Expected observations include the planned Project state and that its dated Task
does not automatically become executable Focus work. The response should
distinguish supplied snapshot evidence from live backend facts, identify material
gaps, and offer a bounded next step. It should not activate the Project or create
documents.

For live Craft reads, configure a Craft connection in your chosen client and
grant the required access separately. GPK supplies no connector credentials or
bundled MCP server. Ask it to assess a specific document or narrowly described
working set, read-only. It should inspect available tools, read current relevant
content, and report actual coverage. An enabled plugin toggle does not prove that
Craft tools or permissions are available.

If access is missing, the bootstrap can explain the limitation or work from
provided material; it must not claim it inspected the space. For a write request,
it should explain that the corresponding workflow is not implemented and may
offer an in-conversation proposal, without performing the mutation.

## 5. Extend the foundation

The shared entrypoint is
[plugin/skills/gpk/SKILL.md](../plugin/skills/gpk/SKILL.md), with its procedure in
[runtime/references/bootstrap.md](../plugin/runtime/references/bootstrap.md). Edit
canonical files, rebuild, then rerun the checks. Both clients must receive the
same methodology; client-specific packaging does not fork the model.

The [runtime layout](plugin-runtime.md) separates current Markdown contracts and
mappings from empty `*.stub`/`.gitkeep` implementation slots. Fill the applicable
workflow and shared procedure bodies, implement and test needed mappings/helpers,
then deliberately promote its `SKILL.md.stub` to `SKILL.md` with supported metadata.
Renaming an empty stub is not an implementation. The build vendors real shared
resources for active Skills; no placeholders become commands or default templates.

Before adding an operational workflow, follow the [architecture review map](architecture.md)
through the domain model, workflow and adapter contracts, actual provider mappings
and applicable [conformance scenarios](../plugin/knowledge/conformance-scenarios.md).
The scenarios are specified, not executed. Current default templates and verified
Craft mutation mappings remain implementation work. Complete the relevant operation
contract, actual capability mapping, authorization, fresh-read and verification
behavior before enabling writes. See the [delivery roadmap](roadmap.md).
