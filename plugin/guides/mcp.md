# Calling GPK MCP

The host launches the installed Node stdio program from the plugin's `.mcp.json`.
The Agent calls exposed tools through the host; it does not execute the program,
invoke a CLI, configure credentials or open a second connection itself.

1. Discover tools from the server named `gpk`. Hosts may prefix or namespace the
   registered names. Match the discovered tools; do not invent a namespace.
2. Call `gpk_runtime_status` with `{}`. It reports the control root, whether
   Settings are initialized, the active backend and whether credentials are
   stored. It makes no Craft request.
3. If `onboarding` is `required`, stop the request and hand over to
   `gpk-setup`: it calls `gpk_setup_open`, and the user connects Craft, creates
   the workspace structure and grants permissions on GPK's local onboarding
   page. No tool writes Settings or grants for the user. Every knowledge
   operation fails with a `next` step naming `gpk_setup_open` until then.
4. Call `gpk_connection_status` when a call fails `unauthorized` at the Craft
   level; reconnecting also happens on the onboarding page. GPK is authorized
   as its own client; the host's Craft connector is unrelated.
5. Call `gpk_knowledge_capabilities` for the operations this request needs.
   Missing or `unsupported` entries never imply support.
6. For a supported operation, use its discovered input schema. Read before
   writing and pass the returned `version` as `expected` on the write.
7. Read the complete `Result`: success includes limits; failure includes code,
   message, affected references and next step. MCP `isError` is true on failure.
   `unauthorized` means no grant in the control root covers the operation;
   `conflict` means the record changed since it was read; `partial` means some
   effects happened and the rest must be inspected before retrying.

Implemented now: connection status, Setup (the onboarding page and inspection),
Settings read/update, grants list/revoke,
Inbox and Daily Note captures, Tasks (read, query, create standalone or under a
Project, update, transition, schedule, assign to a Project), Areas and Projects
(resolve, read, query, create, update, transition; Project assign-area and
order-tasks), Project materials (list, read, append, update), Sources, Wikis
and Outputs (resolve, read, query, create, update), links (query, add, remove)
and checkpoints (read, save), plus the one-call review inventory. Archive,
restore and remove return `unsupported` for every entity. Never replace a
missing GPK operation with unguarded Craft or file writes. Standalone Skill-only
and preview packages do not include the executable runtime.
