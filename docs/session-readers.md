# Agent conversation readers and trigger evidence

The [current support inventory](../README.md#current-support) owns availability.
The [session ingestion guide](../plugin/guides/session-ingestion.md) owns the
shared manual/automatic procedure. These readers supply input to Ingest; they
are not Knowledge Backend adapters and add no Session entity.

## Identity and input coverage

`src/runtime/session-reader.ts` reads JSONL inside real directories. When
`settings.ingestion.automatic.origins` is empty (the default), it automatically
discovers installed Claude Code (`~/.claude/projects`), Codex (`~/.codex/sessions`)
and Antigravity (`~/.gemini/antigravity-cli/brain`) transcript roots, applying the
retention granularity (`summary`, `excerpts`, `full`), automatic ingest depth and
instructions configured in **Configuration**; explicit `origins` with literal
relative path exclusions (files or directory prefixes ending in `/`, no globs) remain
supported in `settings.json`. Directory/file symlinks are excluded, each file has
a 16 MiB budget and one scan has a 10,000-entry budget. Inaccessible, malformed,
oversized and unsupported material is reported as a gap.

| Reader | Native identity | Supported text projection |
|---|---|---|
| Claude Code | Main-thread `sessionId` | Dated `user`/`assistant` records, message string or `text` content blocks; user `uuid` identifies a turn. Sidechains, meta records, thinking and tool blocks are excluded. |
| Codex | `session_meta.payload.id` | Dated `response_item` message records with user/assistant `input_text`, `output_text` or `text` blocks. Older `event_msg` user/agent messages are read only if the message projection is absent, avoiding a second copy. |
| Antigravity | `<conversation-id>` UUID under `<brain>/<conversation-id>/.system_generated/logs/transcript.jsonl` (or explicit `conversationId`) | Dated `USER_INPUT` (`<USER_REQUEST>` body without clock/settings wrappers, keyed by `step-<step_index>`) and `PLANNER_RESPONSE` text; hydrates truncated conversation steps from sibling `transcript_full.jsonl` when within the 16 MiB budget and excludes `thinking`, `GENERIC` tool outputs, internal step/chunk folders and subagent transcripts lacking `USER_INPUT`. |

Reader + native ID supplies the session identity. A missing message ID uses its
original timestamp and ordinal, which is stable on append but may change under
history rewriting. Each user turn groups its subsequent assistant text; its
fingerprint detects both append and edits. The requested date window uses the
user-turn timestamp and includes that turn's available reply context. File mtime,
import date, origin-policy ID and path do not establish identity or activity time.
Same-ID exports with different supported content fail for reconciliation.

Generated GPK continuation prompts and explicitly automatic session processing
establish a boundary after the user's work; subsequent automatic receipts are
excluded to prevent feedback. Manual session-tool calls do not suppress later
assistant text, including text beside a tool call or later repair results.
Source content identifies the native
origin and actual accessible projection. A preparation is retained under the
chosen summary/excerpts/full policy; full means all available conversation text,
not tool output, reasoning, attachments or a claim to every host record.

Codex explicitly warns that `transcript_path` is convenient rather than a stable
transcript-format API. Unknown layouts must be reported and supported with new
reader fixtures before widening claims. Host interfaces and exact payloads:
[Codex Hooks](https://learn.chatgpt.com/docs/hooks),
[Claude Code Hooks](https://code.claude.com/docs/en/hooks).

## Durable progress and concurrency

`src/runtime/session-ingestion.ts` uses the existing checkpoint and entity
operations. A session checkpoint stores the Source mapping, processed turn
fingerprints and any pending batch's original times, preparation and effect
ledger. Source and batch markers let retries locate a write whose response was
lost. A marker alone is insufficient: the retained preparation is compared too.
Unknown creation effects are not blindly retried. Each downstream intent precedes
its ordinary Skill-controlled write; actual destination read-back precedes a
verified effect. Semantic meaning and overlapping knowledge remain Agent judgments.

One local process claims a session across all client runtimes sharing the
explicit control root. Separate sessions also serialize checkpoint saves, so
concurrent first saves cannot create competing native System containers through
this path. These lock files contain only process ownership. A dead process is
reclaimed; an active owner is not stolen because an arbitrary timer expired.
Source facts, prepared evidence and processing progress remain in Craft. Runtime
shutdown releases owned locks without erasing backend progress. Different control
roots are different GPK instances and do not share local coordination.

Completion advances the claimed input boundary only. Input arriving during the
run, revised turns and older material selected by a later backfill remain
discoverable. An unfinished batch outside a requested date window is reported
instead of silently widening that request. Multi-record effects are not atomic;
uncertain or partial effects can require inspection before continuing.

## Active-host automatic execution

All three platform bindings register a command `Stop` Hook. Claude Code and Codex check local feature
policy, a bounded event envelope, the approved transcript path and the host's
`stop_hook_active` loop guard; Antigravity checks its camelCase `Stop` payload (`continuationActive: false`, `terminationReason: "NO_TOOL_CALL"`, `fullyIdle`, `transcriptPath`) and emits `{"decision":"continue"}` or `{"decision":"allow"}`. Each requests a single continuation of the existing
Agent. That continuation loads **gpk-ingest**, not a second semantic pipeline.
It processes at most three sessions. SessionStart supplies a catch-up intent;
each operation rechecks current origins, enablement and ordinary write grants.
Manual date-range requests use the same implementation with automatic off.

The execution window is an active local desktop host with GPK tools and trusted
Hooks. Closing all active hosts stops execution; reopening supplies catch-up. A process
or network failure leaves backend progress for a later active run. This is not a
promise of clock-time processing or automatic Daily Note digests.

## Dated local evidence — 2026-11-04

- `tests/sessions/run-test.mjs`: shared manual/automatic identity, overlapping date
  windows, moved files/policy IDs, append and edits, input arriving mid-run,
  pagination, uncertain Source responses, pending/verified downstream effects,
  origin/grant revocation, disabled automatic mode with manual access, explicit
  reader shapes, conflicting exports, generated input exclusions and dead-owner
  recovery. All data is synthetic; no personal conversation is read.
- `tests/runtime/run-test.mjs`: Setup's browser route, real operation guards and
  Craft adapter against the observed-command fake retain a Source, verify a Wiki
  effect, finish, skip an overlapping request and update the same Source later.
- `tests/hooks/run-test.mjs`: isolated registered commands across Claude Code, Codex
  and Antigravity packages produce a bounded continuation only for an enabled,
  matching transcript event, respect loop guards/exclusions/disablement and load
  next-session catch-up context.
- Package/runtime tests inspect the declared tool schemas and launch isolated
  stdio packages. This is not proof of model Skill selection in installed hosts.

The [current support inventory](../README.md#current-support) records installed-host
and live-Craft acceptance status. P1–P3 in the
[acceptance inventory](conformance-scenarios.md) define semantic execution and
real restart/offline catch-up under the declared window. Existing live evidence
for generic entity/checkpoint writes does not establish this integrated feature.
