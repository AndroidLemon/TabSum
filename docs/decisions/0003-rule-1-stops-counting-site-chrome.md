# ADR 0003: Rule 1 stops counting site chrome

Date: 2026-09-15
Status: accepted

## Context

`tests/telemetry_ratio.js` measured the question the architecture debate
parked (`logs/debate-closure-policy-20260911.md:215`): under normal browsing,
what share of candidate tabs the closure policy actually closes. Baseline:
38.1% close / 61.9% suspend across 42 live URLs. The debate had predicted
failure from the coarse path/hash rules (rule 2, rule 3); those caught
**zero**. Rule 1 (`classifyClosureSafety`, interactive controls) caught 21 of
26 — and it was catching site chrome, not user state: `inputCounts` counted
every control on the page, so a 33,000-word Node.js API reference was held
open by a theme switcher.

A ten-step plan (since deleted; this ADR is its record) fixed rule 1 step by
step, gated on two measurements that had to move together: close recall over
a labelled corpus (`tests/fixtures/corpus.txt`), and a hard zero on
must-suspend pages classified `safe_to_close` ("leaks"). The leak gate had no
tolerance; the recall gate did, because 8 of the corpus's 50 URLs are
bot-blocked headless and the reachable set shifts between runs.

## Decision

Rewrite rule 1 from "does the page contain any control" to "does the page
contain a control a user could still be acting on":

- Merge frames (`allFrames: true`, `mergeFrameExtractions`) so an
  iframe-hosted editor is counted at all, and filter every counted control
  through `checkVisibility()` plus a box test — a hidden or off-screen
  control isn't one a user can reach.
- Count a `<select>` or checkbox/radio only inside a form with a submit
  button, or beside another visible data-entry control; a lone picker (a
  docs version switcher, a CSS-hack menu toggle) doesn't count.
- Split editor detection into `TEXT_EDITOR_SELECTOR` (semantic roles plus a
  vendor-class list, for editors that break semantic DOM on purpose) and
  `APP_SURFACE_SELECTOR` (marks a tool but holds no typed text) — see
  `in-tab-extractor.js` for the current selector lists.
- Resolve `hash.length > 3` against the page's own anchors before treating
  it as client-side routing, and gate closing on visible prose density
  (`wordCount < READING_FLOOR_WORDS`, 120, or `< MEDIA_READING_FLOOR_WORDS`,
  500, with a visible media surface — see Tradeoff below).

Corpus recall — a different metric than the 38.1% raw ratio above; recall is
scored only over the `expect: close` labelled subset, so adding docs pages
can't inflate it — moved from 45.7% (Step 1's baseline) to 88.6% (Step 9),
leaking 0 at every step:

| Step | Close recall | Leaks |
| :--- | ---: | ---: |
| 1 — control set (baseline) | 45.7% | 0 |
| 2 — iframes | 42.9% | 0 |
| 3 — visibility | 68.6% | 0 |
| 4 — real forms | 77.1% | 0 |
| 5 — data-entry allowlist | *skipped, inert* | — |
| 6 — editor surfaces | 77.1% | 0 |
| 7 — anchor resolution | 85.7% | 0 |
| 8 — off-screen controls | 88.6% | 0 |
| 9 — reconcile the two lists | 88.6% | 0 |

Step 2's dip is the iframe-merge fix (bug 1 below) costing recall by making
subframe controls count; Steps 3-9 buy it back. Post-merge review then found
the ratio harness was scoring `tier`, not what ships — `processTabArchival`
aborts on `isDirty` before the tier is consulted, so a dirty page tiered
`safe_to_close` (`pkg.go.dev`) was being scored as a close it never made:

| | Close recall | Leaks |
| :--- | ---: | ---: |
| Step 10, as measured | 88.6% | 0 |
| After review rounds 1-3 | 85.7% | 0 |
| After round 4 (shipped predicate) | 82.9% | 0 |

Both gates now require `tier === 'safe_to_close' && !isDirty`. The
close-rate floor in `tests/telemetry_ratio.js` moved with the stricter
metric, 0.82 then 0.77 (since moved again to 0.80 in EXTRACTION_PLAN.md's
Step 4, which postdates this plan).

The original question is answered yes: the auto-close thesis is viable. The
prediction that got there was wrong in both directions — the coarse
path/hash rules the debate suspected caught nothing; rule 1 was the entire
policy, and it was counting site chrome.

## Two data-loss bugs

Neither would have been found by tuning recall; both surfaced as bugs in
their own right, orthogonal to the ratio:

1. **Iframe-hosted editors were invisible to the zero-loss guard.**
   `executeScript` originally targeted `{ tabId }` with no `allFrames`, and
   shadow-DOM piercing does not reach into iframes, so an unsaved draft in
   TinyMCE, CKEditor, the WordPress classic editor or most CMS compose views
   read as `isDirty: false`. Fixed by `allFrames: true` plus
   `mergeFrameExtractions`, which OR-s dirtiness across every frame and
   requires an explicit frame 0 rather than ever substituting a subframe for
   it. Cross-origin frames the extension cannot script remain invisible to
   this guard outside an `<all_urls>` grant — a design change, not a patch
   (`docs/FOLLOWUPS.md` item 10).

2. **The dirty check and the telemetry classifier kept separate editor
   lists, and they had silently diverged.** `.ace_editor`, `.cm-editor` and
   `.CodeMirror` were in the telemetry list but missing from the dirty
   check; bare `[contenteditable]` was the same; `.DraftEditor-root` was the
   reverse. An unsaved draft in Ace or CodeMirror 6 therefore read as clean
   — suspension happened to preserve it, since the classifier still tiered
   it `suspend_only`, but that was a side effect, not the guard working: a
   dirty page is supposed to abort archival entirely, not merely avoid
   closing. Fixed by splitting `TEXT_EDITOR_SELECTOR` (shared: holds typed
   text, so `innerText` is meaningful) from `APP_SURFACE_SELECTOR`
   (telemetry only — running `innerText` over an open cookie banner would
   mark every page carrying one as unsaved work).

## Media-reading-floor tradeoff

Making control-counting honest removed an accident: `youtube.com/watch` had
never been deliberately protected, it only ever tripped rule 1 via hidden
comment-box controls counted as `appContainers`; once that stopped, its 291
words closed. "Visible media -> suspend" was measured and rejected:
`simonwillison.net`, a 7,974-word article with two visible `<audio>` embeds,
would suspend on presence alone. Shipped instead a density floor that
applies only with a visible media surface (`MEDIA_READING_FLOOR_WORDS =
500`, against 120 normally): YouTube's 291 words now stay under it and
suspend; the article's 7,974 clear it and close. Calibrated on just these
two pages (`docs/FOLLOWUPS.md` item 12); the upgrade path if it misfires is
comparing the player's rendered area to the viewport instead of leaning on
word count.

## Reverted: formless-select detection

Tried, to catch SPA pickers with no `<form>` (a docs version switcher built
as a bare `<select>` driving `location.href` on `change`): count a `<select>`
when its value differs from its page-load default, even outside a form.
Reverted on measurement — `docs.python.org` sets its version pickers by
script at load, so the test fired before the user touched anything and
recall fell on exactly the two pages it was meant to leave alone. A second,
independent problem found on review: React sets a controlled select's value
via `.value`, never `selected`, so `defaultSelected` is false on every
option and the baseline collapses to index 0 regardless — the fix would not
have held even for its own target case. Recorded as a known gap.

## Consequences

- Rule 1 now tracks user-actionable state, not page complexity. Reading
  pages close; forms, editors and stateful routes suspend.
- Cross-origin iframes the extension cannot script remain invisible to the
  zero-loss guard outside `<all_urls>` grants. Tracked in
  `docs/FOLLOWUPS.md` item 10.
- The vendor editor class list rots on a schedule. Tracked in
  `docs/FOLLOWUPS.md` item 6.
- `petstore.swagger.io` is caught only by the word floor; a fuller Swagger UI
  instance would leak, since its "Try it out" controls produce
  `appContainers=0`. Not solved here.
- `pkg.go.dev` is held open forever by a script-filled clipboard-shim
  textarea that makes every page load report unsaved work — `checkIsDirty`
  is deliberately not visibility-gated. Not solved here.
