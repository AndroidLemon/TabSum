# ADR 0001: Rule 4 stays on word count

Date: 2026-09-14
Status: accepted

## Context

Rule 4 of the closure policy (`READING_FLOOR_WORDS = 120` in
`src/shared/closure-policy.js`) holds a tab open when the extractor recovers
too little prose to summarise. It is a safety guard, not a quality heuristic.
Before EXTRACTION_PLAN.md Steps 1-3 it fired on HN and the GitHub repo landing
page because the block selector could not see `<td>`/`<span>`/`<div>` prose,
not because the pages were thin. The plan asked whether, once extraction was
fixed, rule 4 should keep consulting `wordCount` alone (option 1) or gain a
separate "summarisable" flag set only when the harvest came from structured
prose (option 2), with the instruction not to build option 2 speculatively.

Measured after Step 3 (`logs/baseline-step3.md`):

| page | extracted / visible words | tier |
| :--- | ---: | :--- |
| news.ycombinator.com/news | 681 / 681 | safe_to_close |
| github.com/torvalds/linux | 794 / 948 | safe_to_close |
| news.ycombinator.com/item?id=1 | 72 / 104 | held, rule 4 |
| github.com/nodejs/node/pull/50000 | 107 / 388 | held, rule 4 |

Leaks 0 of 15 measured. Close recall 85.7%, up from 80.0% after Step 2 and
82.9% for the closure policy as shipped. (ADR 0003's outcome has Step 10 at
88.6% as first measured, 85.7% after its review rounds 1-3, and 82.9% after
round 4, when the metric started counting a close only if the page is also
not dirty and pkg.go.dev's unsaved-textarea load stopped counting. The 82.9%
is the baseline this branch started from, `logs/baseline-step1.md`.)

## Decision

Option 1. Rule 4 keeps reading `wordCount` and nothing else. No summarisable
flag.

The two pages still held are held correctly. The HN thread has 104 visible
words in total; it is a bookmark, not an article, and the guard refusing to
summarise it is the guard working. The dependabot PR has 107 words of prose
in 388 visible; the remainder is sidebar metadata, labels and commit rows that
no summary should be built from. Neither is evidence that word count is the
wrong signal.

The close-rate floor in `tests/telemetry_ratio.js` moves from 0.77 to 0.80,
keeping the same two-pages-of-drift tolerance against the new 85.7%.

## Consequences

- HN front pages and repo landing pages now close. Whether a summary of thirty
  story titles is useful is the summariser's problem, not the guard's; the
  plan's known unknown stands and is left to dogfooding.
- `lobste.rs` recovers only 35% of its visible words because each story is a
  set of short fragments under a floored `<li>`. It still closes. If link
  indexes turn out to matter, the fix is the extractor's per-tag floor, not
  rule 4.
- Option 2 is not ruled out for ever. The trigger for reopening it is a page
  that closes on nav junk with a word count over 120, which Steps 2 and 3 have
  made hard to produce: hidden text is excluded and nested containers no
  longer sum.
