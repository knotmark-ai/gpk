---
name: gpk-setup
description: Use for GPK onboarding, readiness checks, reconnecting the knowledge base, updating preferences or template bindings, and whenever a GPK call reports onboarding required. Opens GPK's local browser console for Craft OAuth, workspace setup, optional upload API and automatic session retention.
---

# GPK Setup

Follow the [MCP invocation guide](../../guides/mcp.md) for tool discovery and result handling.

Connecting Craft, creating or adopting workspace structures (which automatically enables full non-destructive read/write grants across GPK's 8 bound containers), and connecting Craft's optional attachment upload API happen exclusively in the user's browser (`gpk_setup_open`). For processing Claude Code, Codex and Antigravity conversations after Setup, see the [session guide](../../guides/session-ingestion.md).

## 1. Check readiness

Call `gpk_status` with `{ "include": ["setup", "grants"] }`.
- If `onboarding` is `"complete"`, `settings` is `"ready"`, and the user's request is already satisfied, report readiness (or return to their original request).
- If `settings` is `"invalid"`, explain which file in `controlRoot` failed validation so it can be repaired rather than overwritten blindly.

## 2. Open the onboarding / configuration console

Call `gpk_setup_open` (`{}` for first-time setup, or `{ "view": "console" }` when inspecting an existing setup).
- If `opened` is `false`, display the returned one-time URL to the user and ask them to open it in their browser. **Never fetch, open or submit that URL yourself.**
- Briefly tell the user what to confirm in the browser:
  1. Connect Craft and create or resume the GPK workspace (Collections, folders, views, native Craft Templates, and full workspace container grants in one step).
  2. Choose structural metadata language and optional timezone.
  3. Optionally in **Configuration**, enable **Automatic session retention** (granularity + ingest depth) or connect the **Local image & PDF upload API** (`Craft API URL` + optional key).
- Wait for the user to confirm they have finished; do not poll in a loop.

## 3. Verify and report

Call `gpk_status` with `{ "include": ["setup", "grants"] }` and report concisely:
- `controlRoot` and Settings state (`ready`)
- Connected workspace name and whether every layout location is `ok`
- Persisted workspace grants count and template bindings installed/adopted

Do not declare onboarding complete while `onboarding` remains `"required"`.

## Later preference updates

- **Preferences, templates & session toggle:** Call `gpk_preferences_update` (passing `settingsVersion` from `gpk_status` as `expected`) to update `contentLanguage`, `timezone`, `profileWiki`, `instructions`, `templates`, or `automaticIngestionEnabled`.
- **Craft reconnects, workspace inspection & upload API:** Open `gpk_setup_open` so the user manages Craft OAuth, container layout or the optional upload API link directly in the browser console.
