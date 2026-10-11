---
name: gpk-ingest
description: Use for interpreting, retaining or integrating new material into GPK: register a Source with its origin and access evidence, revise or create the Wikis it affects, link records, retain an Output, and record resumable progress. Works on the Sources/Wikis/Outputs folders through the GPK MCP tools.
---

# GPK Ingest

Follow the [MCP invocation guide](../../guides/mcp.md) to discover the GPK tools
and confirm the connection. Apply the [domain model](../../knowledge/domain-model.md):
a Source retains evidence with its origin and what was actually accessed; a Wiki
maintains one subject and is revised, not appended to; an Output retains an
artifact; links carry an explanation and never change ownership.

## What this entrypoint can do now

Sources, Wikis and Outputs: resolve, read, query (by title text or by link),
create, rename and edit the body. Links: discover in both directions, add,
remove (needs a separate grant). Checkpoints: read and save progress under a
logical key. Fetching, translating or summarizing happens in the conversation;
the tools store what you and the user prepared. Archive, restore and remove
return `unsupported`. Reminders and actions go to `gpk-work`; framing new
work goes to `gpk-plan`.

## Register a Source

1. Resolve identity first: `gpk_sources_query` with `text` from the title or
   author. A repost, translation or retelling of a known work is a variant of
   that Source; add its locator to the existing body with `gpk_sources_update`
   rather than creating a duplicate.
2. For new material, `gpk_sources_create` with a body that states the origin
   (URL, file or event), the version and date actually accessed, the coverage
   (full read, partial, summary only) and the prepared material the user asked
   for. Disclose what could not be accessed.
3. Report the reference and version; the Source stays available for later
   preparation.

## Integrate into Wikis

1. `gpk_wikis_query` with `text` for the subjects the material touches; read
   each candidate with `gpk_wikis_read` and keep its `version`.
2. Revise affected explanations with `gpk_wikis_update` edits that target a
   unique fragment of one block: change the claim, add the qualification, note
   the disagreement. Put the citation next to the claim as a link to the Source
   (`gpk_links_add` from the Wiki with the context "supports", "contradicts" or
   "qualifies" plus the point). Do not append a Source summary as a new section.
3. Create a Wiki with `gpk_wikis_create` only for a subject worth maintaining
   on its own: Summary, then the sections the subject needs (Mechanisms,
   Comparisons, Evidence, Limitations, Open questions).
4. When the material changes a Project's plan or raises an action, say so and
   hand the decision to `gpk-plan` or `gpk-work`; do not change those records
   from here.

## Retain an Output and link records

- `gpk_outputs_create` for an artifact the user wants kept or referenced; keep
  one authoritative body, so an external artifact gets a reference and a
  summary, not a copy.
- `gpk_links_add` records why two records relate, from the record whose body
  should carry the explanation: a Project links the Wiki it relies on, a Task
  links the Output it produced, a Wiki links the Sources it cites.
  `gpk_links_query` shows both directions; incoming links come from a body
  scan and the result states that.

## Resume long work

For a material that spans several sessions or an origin checked repeatedly,
`gpk_checkpoints_read` with a key such as `ingest/<origin>` before starting and
`gpk_checkpoints_save` after the Source or Wiki write has been verified. The
checkpoint records what was processed, not a promise about what will be.

## Boundaries

Every write needs a grant in the control root; `unauthorized` names the missing
operation and root and the fix is Setup. A `conflict` means the record changed
since the read: read again, show the difference, ask before reapplying.
Distinguish facts, the speaker's claims, your proposals and the user's
decisions in what you write. Never invent origins, access dates or citations,
never mark coverage as full when it was partial, and never write to Craft
through another connector to bypass GPK. Report `unsupported` and `partial`
results exactly as returned.
