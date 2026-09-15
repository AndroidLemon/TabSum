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
open by a theme switcher. `checkIsDirty` in the same file had already learned
this lesson (it excludes checkboxes/radios, naming Wikipedia in its comment);
the two functions had inverted assumptions since day one.

A ten-step plan (`CLOSURE_POLICY_PLAN.md`, now deleted; see below) fixed rule
1 step by step, gated on two measurements that had to move together: close
recall over a labelled corpus (`tests/fixtures/corpus.txt`), and a hard zero
on must-suspend pages classified `safe_to_close` ("leaks"). The leak gate had
no tolerance; the recall gate did, because 8 of the corpus's 50 URLs are
bot-blocked headless and the reachable set shifts between runs.

## Decision

Rewrite rule 1 from "does the page contain any control" to "does the page
contain a control a user could still be acting on":

- Merge frames (`chrome.scripting.executeScript({ allFrames: true })`) so an
  iframe-hosted editor is counted at all; OR dirtiness across every frame
  regardless of size, sum control counts, take identity from the top frame.
- Filter every counted control through `checkVisibility()` plus a box test
  (viewport- and document-space, since a scrolled or `position: fixed`
  element can report a false position either way) — a hidden or off-screen
  control isn't one a user can reach.
- Count a `<select>` or checkbox/radio only when it sits in a form with a
  submit button, or alongside another visible data-entry control in the same
  form. A lone picker with neither (a docs version switcher, a CSS-hack menu
  toggle) doesn't count; a checkbox-and-button login form does.
- Split editor detection into `TEXT_EDITOR_SELECTOR` (semantic roles plus a
  vendor-class list for virtualized editors that break semantic DOM on
  purpose — Monaco, CodeMirror, Ace, ProseMirror, Quill, Draft) and
  `APP_SURFACE_SELECTOR` (`canvas`, `[role="application"]`,
  `[role="dialog"]` — marks a tool but holds no typed text).
- Resolve `hash.length > 3` against the page's own anchors before treating
  it as client-side routing, so deep links into documentation stop being
  held as if they were app routes.
- Gate closing on visible prose density: `wordCount < READING_FLOOR_WORDS`
  (120) normally, or `< MEDIA_READING_FLOOR_WORDS` (500) when the page also
  carries a visible media surface (see Tradeoff below).

Corpus close recall moved 45.7% -> 88.6% across the nine steps, leaks stayed
0 throughout. Post-merge review then dropped it to 82.9%: round 4 found the
ratio harness was scoring `tier`, not what ships. `processTabArchival` aborts
on `isDirty` long before the tier is consulted, so a dirty page tiered
`safe_to_close` (`pkg.go.dev`, held open by a script-filled clipboard-shim
textarea on every load) was being scored as a close it never actually made.
This is the metric learning to tell the truth, not a regression. Both the
recall and leak gates now require `tier === 'safe_to_close' && !isDirty`. The
close-rate floor in `tests/telemetry_ratio.js` moved with the stricter
metric, 0.82 then 0.77, to keep the same two-pages-of-drift tolerance (it has
since moved again, to 0.80, in EXTRACTION_PLAN.md's Step 4 — a change this
plan predates).

The original question is answered yes: the auto-close thesis is viable. But
the prediction that got there was wrong in both directions — the coarse
path/hash rules the debate suspected caught nothing; rule 1 was the entire
policy, and it was counting site chrome.

## Two data-loss bugs

Neither would have been found by tuning recall; both surfaced as bugs in
their own right, orthogonal to the ratio:

1. **Iframe-hosted editors were invisible to the zero-loss guard.**
   `executeScript` originally targeted `{ tabId }` with no `allFrames`, and
   shadow-DOM piercing does not reach into iframes. TinyMCE, CKEditor, the
   WordPress classic editor and most CMS compose views run inside an iframe,
   so an unsaved draft in any of them read as `isDirty: false`. Fixed by
   `allFrames: true` plus `mergeFrameExtractions`, which OR-s dirtiness
   across every frame. Post-merge review found two follow-on bugs in the
   merge itself, also fixed here: a missing frame 0 (the tab's own injection
   failing) was silently backed by a subframe's url/title/prose instead of
   returning null, and a missing `frameId` was coerced to 0, which could let
   an unidentified frame win the top-frame slot. Both now require an
   explicit frame 0 or return null, which callers already treat as "try
   again later". Cross-origin frames the extension cannot script remain
   invisible to this guard outside an `<all_urls>` grant — a design change,
   not a patch, and out of scope here.

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
comment-box controls counted as `appContainers`. Once that stopped, YouTube
(291 words of visible prose) closed. "Visible media -> suspend" was measured
and rejected: `simonwillison.net`, a 7,974-word article carrying two visible
`<audio>` embeds, would suspend on presence alone. Shipped instead a density
floor that applies only when a media surface is present
(`MEDIA_READING_FLOOR_WORDS = 500`, ten times `READING_FLOOR_WORDS`):
YouTube's 291 words stay under it and suspend; the article's 7,974 clear it
and close. The floor is a single number calibrated on these two pages
(`docs/FOLLOWUPS.md` item 12); the upgrade path if it misfires is comparing
the player's rendered area to the viewport instead of leaning on word count.

## Reverted: formless-select detection

Tried, to catch SPA pickers with no `<form>` (a docs version switcher built
as a bare `<select>` driving `location.href` on `change`): count a `<select>`
when its current value differs from its page-load default, even outside a
form. Reverted on measurement — `docs.python.org` sets its version pickers by
script at load, so the test fired before the user touched anything and
recall fell on exactly the two pages it was meant to leave alone. A second,
independent problem found on review: React sets a controlled select's value
via `.value`, never the `selected` attribute, so `defaultSelected` is false
on every option and the baseline collapses to index 0 regardless — the fix
would not have held even for its own target case. Recorded as a known gap
rather than reattempted.

## Consequences

- Rule 1 now tracks user-actionable state, not page complexity. Reading
  pages close; forms, editors and stateful routes suspend.
- The recall floor in `tests/telemetry_ratio.js` is a regression gate, not
  an aspiration, but it tolerates noise: 8 of the corpus's 50 URLs are
  bot-blocked headless, so the reachable set shifts between runs.
- Cross-origin iframes the extension cannot script are still invisible to
  the zero-loss guard outside `<all_urls>` grants; the base rate measured on
  the corpus (one page, one run of two) is too low to calibrate a fail-closed
  rule against. Tracked in `docs/FOLLOWUPS.md` item 10.
- The vendor editor class list rots on a schedule: every editor that falls
  out of fashion or renames its root class becomes a silently closed tool.
  Tracked in `docs/FOLLOWUPS.md` item 6.
- `petstore.swagger.io` is caught only by the word floor; a fuller Swagger UI
  instance would leak, since its "Try it out" controls produce
  `appContainers=0`. Not solved here.
- `pkg.go.dev` is held open forever by a script-filled clipboard-shim
  textarea that makes every page load report unsaved work, because
  `checkIsDirty` is deliberately not visibility-gated (a hidden textarea
  with real content is real content). That reasoning still stands; a shim
  that ships pre-filled on every load is not the case it was written for.
  Not solved here.
