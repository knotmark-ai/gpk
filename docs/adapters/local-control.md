# Local User Control mapping

Decision: **2026-10-08**, file envelope settled **2026-10-10** with the first
caller; Settings and grant writes implemented **2026-10-11** for Setup.
Templates are not implemented. See [current support](../../README.md#current-support).
Public fields and operations belong to
[UserControlPort](../../src/domain/user-control-port.ts); common behavior belongs
to the [storage contract](../storage-contracts.md#4-user-control-port).

## Selected store and representation

Use one user-selected, stable local `.gpk` root per GPK instance. Authorized Codex
and Claude Code clients on the same machine share that root, rather than copies
per client or Project. Bootstrap identifies provider `local-files`, instance and
the explicit absolute root. Do not infer it from the working directory, recursively
search the machine or use a plugin installation/cache as durable storage.

The planned layout is:

```text
.gpk/
  settings.json
  grants.json
  templates/
    <template-id>.md
```

Settings is a typed, nested JSON document, not an arbitrary KV interface:
`settings.json` holds the `UserSettings` object itself with `schemaVersion` inside.
Grants are separately authorized records, not Settings booleans: `grants.json`
holds `{ "schemaVersion": 1, "grants": [ { "id", ...ControlGrant } ] }`, and the
grant reference is `grant:<id>`. Versions are `sha256:` digests of the file
bytes, compared for equality only. The root comes from `GPK_CONTROL_ROOT` or
`~/.gpk`; the ref scope is `local-files:<absolute root>`. A missing
`settings.json` reads as never initialized; malformed or structurally invalid
files read as `invalid` and are never rewritten; a grant with a wildcard or
malformed operation invalidates the whole file so no grant applies. Writes go
through a sibling temporary file and `rename`, so readers never see a torn file;
`expected` is compared against the file digest and detected on re-read, which is
not a cross-process lock. `settings.initialize` refuses an existing file;
`settings.update` applies named fields and rejects a change that alters nothing;
`grants.grant` appends an entry with a generated `g-` ID after validating every
operation against the port inventory; `grants.revoke` removes one entry. Grant
roots are the layout locations (Collection or folder IDs), the capture surfaces
`daily-notes` and `inbox`, and `system` for checkpoints. Personal
templates are Markdown with explicit owned role metadata and stable references;
never infer use from a filename/title. Their envelope is settled with the
template slice. Tokens never live in this root except in the non-macOS
`secrets.json` fallback (mode 0600); macOS uses the login keychain. The secret
key is recorded in Settings as `credentialsRef`; before Settings exist it is
`gpk:craft:<backend>` for the default root and carries a digest of the root
path for any other root, so two roots on one machine never share tokens.

Null template bindings use packaged defaults; onboarding need not create six
personal files. The adapter reads current personal files when they are selected.
Keep this private root outside public repositories or explicitly excluded from
version control. Setup must preview any requested file creation; this mapping does
not create a root or modify Git configuration.

## Ownership and access

The local files are the control authority, not an adapter cache. They contain
Settings, template bodies/bindings and scoped grants, not domain records, personal
background facts, retained conversation Sources or ingest progress. Those remain
in the Knowledge Backend. An optional profileWiki reference can point into Craft.
Raw secrets and capability-bearing endpoints remain in supported host secret
facilities; JSON contains safe descriptions and logical references only. Reading
a grant file does not grant authority: validate current human/host approval,
implemented operation scope and effective provider permissions on each operation.

Bind every resource to the selected root/instance and reject path traversal or
symlink escapes. Inspect only that scope, with honest read coverage. Missing known
files, denied access, malformed JSON, unsupported schemas and partial resources
are errors/recovery cases, not permission to initialize another root or use defaults.
Reads do not repair files. Preserve current user edits and unknown native fields
through named updates, without rewriting unrelated resources.

## Setup and verification

Setup inspects this root first, then uses existing Settings or the user's first-use
choice to establish the Craft knowledge connection and verify layout/resources.
Reading local control requires no live Craft connection. Backend failure stops
dependent knowledge operations without resetting initialized Settings. Valid JSON
alone does not complete onboarding: initialization needs actual selected-resource
checks and complete readback under the shared Setup contract.

Settings, templates, bindings, grants and Craft writes have independent effects.
Guard the resource actually being changed, inspect uncertain effects before retry
and preserve intervening edits. Declare demonstrated revision/concurrency guarantees;
an atomic file replacement alone is not a cross-client compare-and-swap or a
multi-file transaction. Test overlapping clients, read-only roots, interrupted
writes, fresh-session recovery and external file edits before claiming support.

## Later providers

A phone/cloud session does not automatically read this desktop root. The
[HTTP extension](../architecture.md#future-extension-streamable-http) selects
durable control accessible to the GPK service. A single-user deployment can reuse
this adapter with a server-side `.gpk` root on persistent storage; ephemeral disk
does not satisfy retention. Choose a service-backed UserControlPort only when the
execution environment needs it. HTTP transport alone does not require a new adapter.
Moving control requires explicit verified migration/cutover to one authority and
re-evaluation of grants/secret bindings, not hidden multi-master synchronization
or local fallback. Manual cloud-drive placement is not proof of safe concurrent access.

Note-backed control is not an MVP target. Reconsider only when a native extension
or plugin-private configuration surface, such as a future Obsidian integration,
offers suitable storage without inserting configuration documents into the user's
ordinary knowledge collection. No additional provider is promised by this decision.
