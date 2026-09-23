---
name: eyes-ai-brief
description: Use when a DOM/behavior fact about the live OviPets site is needed but Claude cannot verify it directly (no login) — to draft a new numbered question section in docs/eyes-ai-brief.md following the established template (Mode A). Also use when the user pastes back a completed report from the site-operating AI ("mắt") — to integrate the findings into content.js (replacing guessed selectors with confirmed ones), record them in docs/dom-audit-*.md, and mark the corresponding brief item resolved (Mode B). Triggers: "I don't know this selector, add it to the brief", "ask the site AI about X", "here's what came back from the audit", "the site-operating AI reported this, please integrate it", "mark item N resolved".
---

This skill maintains the `docs/eyes-ai-brief.md` <-> `docs/dom-audit-*.md`
lifecycle: an open question is drafted in the brief, the Game Owner relays it
to a separate site-operating AI that can log into the live game, and the
answer comes back to be integrated. Items 1-5 and 6a/6b/6c in
`docs/eyes-ai-brief.md` already went through this full cycle against
`docs/dom-audit-2026-09-17.md` — read both files once before using this skill
to match their exact tone, numbering, and level of literalness.

There are two modes. Read the user's request to decide which one applies —
if unclear, ask.

## Mode A — Draft a new question (Claude has an unanswered question)

Use when a feature needs DOM/behavior from a page or flow no one has
inspected live, and the alternative would be shipping a guessed selector
(never do that — see CLAUDE.md's "Never guess a selector" rule).

1. Read `docs/eyes-ai-brief.md`. Find the highest existing item number and the
   current **Status** line at the top.
2. Draft a new `## N. <short title>` section (N = next number) modeled on the
   existing items:
   - Ask for concrete, literal artifacts: "paste the raw HTML/onclick of X",
     "open Y and report Z" — never a vague "how does X work?".
   - Cite the exact guessed code/selector in `content.js` (function name and
     what it currently assumes) that this answer would replace or confirm.
   - If the flow involves a sub-sequence of steps (like item 6's
     overview -> tab -> confirm flow), break it into `### Na`, `### Nb`, `### Nc`
     sub-sections rather than one flat block.
   - If any part of the question requires a real/non-undoable game action
     (breeding, removing a friend, submitting a rename, clicking a
     deliberately-wrong answer), call that out explicitly inline (see item 6c
     and item 7 for the exact phrasing pattern) AND add/update the
     **What NOT to do** section at the end of the file so it stays the single
     source of truth for what's off-limits.
3. In `content.js`, at the guessed selector/logic this question is about, add
   or update a comment pointing at the new item number, e.g.
   `// guessed — see docs/eyes-ai-brief.md #N`, so a future reviewer (or the
   oweh-regression-reviewer agent) can find the open question from the code.
4. Update the **Status** line at the top of `docs/eyes-ai-brief.md` to mention
   the new open item.

Do not invent an answer or a plausible-looking selector as a placeholder —
the entire point of this file is to avoid that.

## Mode B — Integrate a completed answer

Use when the user pastes back a report from the site-operating AI (raw HTML,
selectors, described behavior) answering one or more existing brief items.

1. Identify which numbered item(s) in `docs/eyes-ai-brief.md` the pasted
   answer addresses.
2. Record the findings in a dated audit file, `docs/dom-audit-<YYYY-MM-DD>.md`
   (today's date). If a dom-audit file for today already exists (e.g. from
   earlier answers integrated the same day), append a new `## <item title>`
   section to it instead of creating a second dated file. Follow the shape of
   `docs/dom-audit-2026-09-17.md`: a short executive-summary bullet if this is
   the first section of a new file, then per-item confirmed selectors/values
   in the same structure as the corresponding brief question, quoting raw
   HTML/attribute values verbatim rather than paraphrasing them.
3. Edit `content.js`: replace the guessed selector/logic with the confirmed
   one, and change the comment to cite the confirmation, e.g.
   `// confirmed: docs/dom-audit-<date>.md #N` (never leave it saying
   "guessed" once it's been confirmed). If the confirmed behavior reveals the
   current code's assumption was wrong (not just unconfirmed but actually
   incorrect), fix the logic, not just the comment, and note the correction
   explicitly to the user — this is a good moment to also suggest running the
   `oweh-regression-reviewer` agent on the change, since a selector fix can
   interact with the other three bug classes (e.g. a newly-added DOM read
   inside a refresh()-reachable function needs the same-value-check
   treatment).
4. Update `docs/eyes-ai-brief.md`'s **Status** line to mark the item(s)
   resolved and point at the new/updated audit file, matching the existing
   phrasing style ("items 1-5 and 6a/6b/6c below were answered — see
   docs/dom-audit-2026-09-17.md ... Still open: ..."). Do not delete or
   renumber the resolved question sections — the file is kept as a record and
   a template, per its own stated purpose at the top.
5. If the answer indicates the requested action was a real/non-undoable one
   (e.g. item 6c's live breeding test), make sure the audit doc explicitly
   says so and names what was actually done (pet IDs, resulting egg ID, etc.)
   — don't generalize away the fact that a live action occurred.

## Template quick-reference

`docs/eyes-ai-brief.md` shape: bold **Status** line (dated) -> purpose
paragraph -> numbered `## N. Title` sections (optionally `### Na/Nb/Nc`) ->
closing `## What NOT to do` section.

`docs/dom-audit-<date>.md` shape: header with date/account/method -> optional
`## Executive summary` -> per-item sections with confirmed selectors, quoting
raw markup -> optional `## Implementation corrections applied` list ->
optional `## Remaining authorization needed` note for anything still open.
