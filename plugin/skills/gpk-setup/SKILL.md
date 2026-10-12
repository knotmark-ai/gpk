---
name: gpk-setup
description: Use for GPK onboarding, readiness checks, reconnecting the knowledge base, changing languages or permissions, and whenever runtime status reports onboarding required. Opens GPK's local onboarding page, where the user connects a knowledge base, creates the workspace structure and chooses permissions.
---

# GPK Setup

Follow the [MCP invocation guide](../../guides/mcp.md) for tool discovery and
result handling. Setup happens on GPK's onboarding page in the user's browser,
not in the conversation: the user connects a knowledge base, chooses a dedicated or
shared workspace, the working and metadata languages and the names, and ticks
the permissions GPK gets. The page writes `settings.json` and `grants.json`;
no tool lets you write them, and you must not claim the user's consent for them.

## 1. Check readiness

Call `gpk_runtime_status`. `onboarding: "complete"` means Settings exist and
permissions were granted; go back to the user's request. Otherwise continue.
An `invalid` Settings file is a repair conversation: say which file and what
is wrong, and do not open the page over it.

## 2. Open the onboarding page

Call `gpk_setup_open`. It opens the page in the user's browser and returns its
URL. If `opened` is false, show the URL and ask the user to open it. Tell the
user in one or two sentences what the page asks for:

- connect a knowledge base (Craft today; others are listed as coming soon)
  and pick the workspace for GPK (a new, dedicated workspace is recommended);
- working language (conversation and what GPK writes into records) and
  metadata language (folder, Collection and view names, template headings);
- which operations GPK may perform where. Deleting, archiving and restoring
  are never offered.

Then wait for the user to say they are done. Do not poll in a tight loop.

## 3. Read back and report

Call `gpk_setup_inspect` and report, each on its own line: Settings written
(control root), knowledge base connected (workspace name) with every layout location
`ok`, and the number of grants. If anything is missing, say what and offer to
open the page again. Do not report onboarding as complete while
`gpk_runtime_status` still says `required`.

## Later changes

- Working language, timezone and instructions: `gpk_settings_update` with the
  `version` from `gpk_settings_read` as `expected`, or the page.
- Permissions: the user adds them on the page; you may revoke one with
  `gpk_grants_revoke` when asked.
- Reconnecting the knowledge base after an `unauthorized` failure: open the page again.
- Layout and metadata language are fixed after the structure exists; changing
  them means resetting GPK. Personal templates and automatic ingestion are not
  implemented; say so when asked.
