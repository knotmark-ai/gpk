---
name: gpk-setup
description: Use for GPK onboarding, readiness checks, Craft authorization, layout setup (Collections and folders), grants and Settings preferences. Establishes the control root and the Craft structures through the GPK MCP tools after the user confirms the plan.
---

# GPK Setup

Follow the [MCP invocation guide](../../guides/mcp.md) for tool discovery and
result handling. Setup is the only workflow that writes Settings and grants;
it never writes knowledge records.

## 1. Inspect before proposing

Call `gpk_setup_inspect`. It reports the control root, whether Settings are
`uninitialized`, `ready`, `invalid` or `unavailable`, the Craft authorization
state, the configured layout's validity, the number of grants, and (once Craft
is authorized) the Collections and folders that already exist. Read it fully:
an `invalid` Settings file is a repair conversation, not a reinitialization.

## 2. Authorize Craft once

If `connection.tokens` is `none`, call `gpk_connection_authorize`. Show the
returned URL, ask the user to open it, pick the space and approve "GPK", then
poll `gpk_connection_status` until `tokens` is `verified` and `space` is set.
GPK is its own Craft connection; the host's Craft connector is irrelevant.

## 3. Propose the layout and get one confirmation

GPK works best in a Craft workspace dedicated to it. Ask whether this one is;
the inspection helps: a new workspace shows only Craft's own sample folder
(`How to use Craft`) and no Collections.

- **Dedicated workspace (default):** everything at the top level. A host
  document `GPK` holds the Areas and Projects Collections, and the Sources,
  Wikis and Outputs folders sit at the root. Omit `namespace` (or pass
  `"root"`).
- **Shared workspace:** pass `namespace: {"folder": "GPK"}` so one folder holds
  the host document and the three folders and nothing the user already has is
  touched.

In both cases the bundled entity templates are installed into Craft's
Templates area and the Collections get Board, By Area and Active views.
Propose exactly that unless the user asks for something else.

Adoption of existing structures happens only when the user names them. The
inspection lists existing folders (with document counts and parents) and
Collections so the user can point at one; do not recommend adoption yourself.
When the user does adopt:

- A Collection qualifies only if the inspection shows the expected `Status`
  column (Projects also need a relation column); otherwise create by name.
- A folder is adopted by ID; its contents become that role's recognized
  material without being moved or edited. Everything outside the configured
  locations stays read-only for GPK.
- A name clash among siblings is refused, not merged.
- Preferences: language (also selects the template language) and timezone if
  the user states them.

Present the plan in one message and wait for the user's confirmation. Then call
`gpk_setup_establish` with exactly that plan. It creates or adopts the
structures, verifies them, and initializes Settings (or updates the layout when
Settings exist). A `partial` result lists created references: keep them and
rerun with those IDs adopted rather than creating duplicates.

## 4. Propose grants and get one confirmation

Call `gpk_setup_propose_grants`. It returns the default non-destructive set:
Task operations on Daily Notes and Inbox, Project and Area operations on their
Collections, create/update on the three folders, plus link additions. Show the
list in plain words, ask for one confirmation, then pass the confirmed list to
`gpk_grants_grant`. Add destructive operations (`remove`, `archive`, `restore`)
or `unattended: true` only when the user asks for them explicitly.

## 5. Read back and report separately

Call `gpk_setup_inspect` again and report three things on their own lines:
control root readiness (Settings written and read back), Craft readiness
(authorized space, layout verified), and grants (count and roots). Say what
was created versus adopted, which views exist, and that the `GPK …` templates
are available in Craft's Templates area for creating entities by hand. Do not
claim onboarding is complete while any of the three is missing.

## Later changes

Preferences change through `gpk_settings_update` with the `version` from
`gpk_settings_read` as `expected`. Grants are revoked with `gpk_grants_revoke`.
Layout changes rerun `gpk_setup_establish` with the new plan. Templates and
automatic ingestion are not implemented; say so when asked.
