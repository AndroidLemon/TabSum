# Closure policy v2 — execution plan

## Why

`npm run test:ratio` measured the question the architecture debate parked
(`logs/debate-closure-policy-20260911.md:215`): **38.1% close / 61.9% suspend**
across 42 live URLs. The debate predicted failure from the coarse path/hash
rules. Those caught **zero**. Rule 1 (`classifyClosureSafety`, interactive
controls) caught 21 of 26 — and it is catching *site chrome*, not user state.
A 33,000-word Node.js API reference is held open by a theme switcher.

Root cause, confirmed by enumerating the DOM: `inputCounts` counts every
control on the page. `checkIsDirty` in the same file already learned this
lesson and excludes checkboxes/radios, naming Wikipedia in its comment. The
two functions have had inverted assumptions since day one.

Cross-model debate (`logs/debate-rule1-20260912.md`) settled the mechanism.
Verified empirically at each step; see that transcript for what each side
conceded.

## Loop protocol

Each iteration: take the first unchecked step, implement it, run its Verify
command, then check it off **with the measured number inline**. Stop and report
if a Verify fails twice — do not proceed to the next step past a red gate.
Steps are ordered by dependency; do not reorder.

Full verification (any step may run a subset):
```
npm run test:unit && npm run test:policy && npm run test:storage   # fast, always
npm run test:ratio                                                  # ~3 min, live network, needs sandbox off
```

---

## Step 1 — Give the corpus a control set  ⚠️ DO THIS FIRST

**The harness as built rewards closing everything.** A close-rate floor with no
counter-weight is optimized by deleting rule 1 entirely. Before any policy
change, the corpus needs pages that *must never* close, or every later step is
measured against a metric that cannot detect data loss.

- Annotate `tests/fixtures/corpus.txt` with an expected tier per URL
  (`# expect: close` / `# expect: suspend` section markers are enough — keep the
  parser to a running-label variable, not a new format).
- Add must-suspend controls: `news.ycombinator.com/login`, `jsonformatter.org`,
  `regex101.com`, `petstore.swagger.io`, `excalidraw.com`, `app.diagrams.net`.
- Add must-close controls that are currently **untested blind spots**:
  deep-linked docs with anchors — `nodejs.org/docs/latest/api/fs.html#fspromisesreadfile`,
  `developer.mozilla.org/en-US/docs/Web/API/fetch#syntax`. Rule 2's
  `hash.length > 3` suspends these today and the corpus never noticed.
- `tests/telemetry_ratio.js` reports **wrong-way misses** alongside the ratio.
- Gate becomes two conditions: close rate ≥ floor **AND zero must-suspend pages
  classified `safe_to_close`**. The second is the one that matters.

**Verify:** `npm run test:ratio` — report both numbers. Expect red on close rate,
and record how many must-suspend pages leak today as the safety baseline.

- [x] Done — close recall **45.7%** (16/35), must-suspend leaks **0** of 14 reachable.
      Metric changed from raw ratio to recall over `expect: close`, so adding docs
      can no longer inflate it. Safety baseline is 0 leaks: today's policy is
      over-conservative but loses nothing. No later step may raise this number.

---

## Step 2 — Iframe blindness in the zero-loss guard  ⚠️ SAFETY, NOT RATIO

Found by probing the QA practice sites. `chrome.scripting.executeScript` at
`src/background/service-worker.js:425` and `:557` targets `{ tabId }` with no
`allFrames`, and `queryAllDeep` pierces shadow DOM but **not iframes**. So
everything inside an iframe is invisible to `checkIsDirty`.

Measured on `the-internet.herokuapp.com/tinymce`: a live rich-text editor sits in
the iframe, and the extractor reports `editors deep=0, isDirty=false`. Every
iframe-hosted editor — TinyMCE, CKEditor, the WordPress classic editor,
Confluence, most CMS compose views — can hold an unsaved draft that the
zero-loss guard cannot see. This is the "false zero-loss promise" the Phase 1
red team flagged, still open.

Fix: `target: { tabId, allFrames: true }`, which returns one result per frame.
Merge them: `isDirty` true if **any** frame is dirty; sum `inputCounts` across
frames; take title/text/meta/url from the top frame only (`frameId === 0`).
Cross-origin ad frames will also be injected and return junk — `demoqa.com`
carries 6 of them — so discard frames with no extractable content rather than
letting them inflate counts or overwrite metadata.

**Verify:** `npm run test:hardening`; add a fixture page with a same-origin
iframe containing a dirty textarea and assert `isDirty === true`.

- [x] Done — framed draft now detected: top-frame-only injection reports
      `isDirty=false`, merged reports `true` ("Unsaved textarea content detected").
      Asserted both halves in `tests/test_tab_hardening.js` so the bug can't
      silently return. Close recall **45.7% -> 42.9%**, leaks still **0**.
      The recall drop is the honest price: subframe controls now count, so the
      policy got more conservative. Steps 3-7 are what buy it back.
      Two things the plan did not anticipate:
      - Service workers forbid dynamic `import()`, so the browser test hands the
        raw per-frame results back to Node and merges there. Better anyway — the
        merge is pure and now gets tested against real browser frame data.
      - `tests/telemetry_ratio.js` had to learn frames too (`page.frames()` +
        merge), or the harness would stop measuring what actually ships.

---

## Step 3 — Visibility gate in the extractor

In `src/content/in-tab-extractor.js`, filter every counted control through
`el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` with an
`offsetParent !== null` fallback in the `catch`.

Measured effect: kills `pkg.go.dev`'s 17 clipboard textareas and `nodejs.org`'s
22 inline checkboxes on its own. No `value.trim()` string-guessing — the layout
engine already knows.

**Verify:** `npm run test:policy` green; `npm run test:ratio` close rate up, zero
new must-suspend leaks.

- [x] Done — close recall **42.9% -> 68.6%**, leaks **0**. Gate green for the
      first time (floor is 60%). Reading pages held open: 20 -> 11 of 35.
      The visibility gate alone took recall past the floor, but it first
      exposed a leak the plan did not predict: **youtube.com/watch** closed.
      YouTube was never deliberately protected — it only ever tripped rule 1 via
      hidden comment boxes counted as `appContainers`, and making counting honest
      removed that accident. A video page's state is playback position, which the
      URL does not carry, so suspending is right; the corpus label stands.
      The obvious fix ("visible media -> suspend") was measured and rejected:
      `simonwillison.net` is a 7,974-word article with two visible `<audio>`
      elements, so presence alone suspends long-form articles. Shipped instead a
      media-aware density floor (`MEDIA_READING_FLOOR_WORDS = 500`): a page with a
      player needs real prose to count as readable. YouTube at 291 words suspends;
      the article at 7,974 still closes.
      Note `checkIsDirty` is deliberately NOT visibility-gated — a hidden textarea
      with unsaved content is still unsaved content.

---

## Step 4 — Submit-bearing form owner for selects and toggles

A `<select>` or checkbox/radio counts only when `el.form` exists **and** that
form contains `button[type="submit"], input[type="submit"], button:not([type])`.
A checkbox driving a CSS accordion has no submit button; a login form does.

Apply to selects and toggles **only**. Do *not* apply it to text/number inputs —
React tools submit via `fetch()` with no `<form>`, and requiring one there
reopens the empty-tool-closing bug.

Measured: clears `docs.python.org`'s 9 version selects and `sqlite.org`'s picker
while `news.ycombinator.com/login` still suspends.

**Verify:** `npm run test:ratio` — HN login must remain `suspend_only`.

- [x] Done — close recall **68.6% -> 77.1%**, leaks **0**. Reading pages held
      open: 11 -> 8 of 35. All 8 suites green.
      The submit-button test alone was too narrow and `test_hybrid_mode.js`
      caught it: its `/untouched-form` fixture is a registration form with **no
      submit button**, so gating on submit left it with zero counted controls and
      it became closeable. That is exactly the SPA-form hole predicted in
      `logs/debate-rule1-20260912.md` — React flows bind onChange and POST via
      `fetch()`.
      "Real form" is therefore two tests, not one: a submit button, **or** another
      visible data-entry control in the same form. What stays excluded is the lone
      picker — one control, no submit, no siblings — which is all a docs version
      switcher or a CSS-hack menu toggle ever is.
      Added `/orphan-picker` to `test_tab_hardening.js` for the other half: a
      280-word article whose only controls are a formless `<select>` and menu
      checkbox must stay closeable. Nothing covered that before.

---

## Step 5 — Restrict `otherInputs` to data-entry types

Count only `text, number, date, datetime-local, tel, url, email, password`.
Keep the existing search-box and `hidden/submit/button/reset` exclusions.
Checkbox/radio reach the count only via Step 3's toggle path.

**Verify:** `npm run test:policy`, `npm run test:ratio`.

- [x] **Skipped — measured inert.** A census of every visible, non-search input
      across the whole corpus found exactly five types:

      | type | count |
      | :--- | ---: |
      | checkbox | 54 |
      | text | 20 |
      | password | 3 |
      | radio | 3 |
      | file | 2 |

      No `color`, `range`, `date`, `url`, `tel`, `number`, `image` anywhere. The
      checkboxes and radios are already gated by Step 4's meaningful-form test,
      and `file` is genuine data entry that should count. An allowlist would
      change zero verdicts.
      It would also be actively wrong on the case it was meant to catch: a page
      with three range sliders or colour pickers is a settings panel — a tool —
      and suspending it is the correct answer, not a false positive.
      Shipping it would mean maintaining a second rotting list (see Step 6's
      vendor classes) to buy nothing. Revisit only if a census on a wider corpus
      turns up junk types actually reaching the `otherInputs >= 3` threshold.

---

## Step 6 — Editor detection: semantic first, vendor fallback

`appContainers` is about to carry the whole tool-detection load, so split it:

1. **Semantic** (durable): `canvas`, `[role="application"]`, `[role="textbox"]`,
   `[contenteditable]:not([contenteditable="false"])`.
2. **Vendor engines** (rots): `.monaco-editor, .cm-editor, .CodeMirror,
   .ace_editor, .ProseMirror, .ql-editor`.

Virtualized editors deliberately break semantic DOM — they render visible lines
only and park an off-screen capture textarea — so the vendor list is not
laziness, it is the only thing that sees them. `jsonformatter.org` (Ace, 1,137
words) is closed by every other variant and is the reason `.ace_editor` is here.

Mark the vendor list with a `ponytail:` comment naming the ceiling: it is a
maintenance-scheduled signal, and every rotted entry is a silently closed tool.
Upgrade path if it bites: score a tool by off-screen-textarea + tall scroll
container instead of class names.

**Verify:** `npm run test:ratio` — `jsonformatter.org` and `regex101.com` both
`suspend_only`.

- [x] Done — close recall **77.1%**, leaks **0** (both unchanged). All 8 suites green.
      The totals held steady but the composition improved: `jsonformatter.org` is
      now caught structurally via `appContainers=2` at 456 words instead of
      incidentally, and `canvas` / `.ace_editor` / `.cm-editor` / `.CodeMirror`
      cost no recall at all — no corpus article was held open by a chart canvas.
      **Dropping `[role="dialog"]` was tried and reverted.** The reasoning was
      sound — cookie-consent modals use it far more than editors, and the
      visibility gate can't help since an undismissed banner is visible by
      definition — but the corpus measured it *inert*: identical recall, identical
      leaks either way. An inert signal is not evidence for a behaviour change,
      and `test_hybrid_mode.js` asserts an open modal marks an app. Restored, with
      the upgrade path recorded in the code: require the dialog to contain a
      control rather than drop the signal.

**Known gap, not solved here:** `petstore.swagger.io` is caught only by rule 4
(102 words) — its "Try it out" controls produce `appContainers=0`. That is
exactly the Swagger-UI-at-5,000-words case the debate raised. This instance is
incidentally short; a fuller one would leak.

---

## Step 7 — Rule 2: stop suspending deep-linked docs

`hash.length > 3` currently suspends **every anchored documentation link**. It
scored 0 in the baseline only because the corpus had no anchors — a corpus gap,
not a clean bill of health.

A hash is a client-side route only when it does *not* resolve to an element in
the page. The extractor can answer that (`document.getElementById(hash.slice(1))`)
and the policy cannot, so this is a new telemetry field (`hashResolvesToAnchor`),
not a policy-local fix. Keep the `checkout|cart|account` path tokens unchanged.

**Verify:** the anchored URLs added in Step 1 classify `safe_to_close`.

- [x] Done — close recall **77.1% -> 85.7%**, leaks **0**. Reading pages held
      open: 8 -> 5 of 35. All 8 suites green.
      Three of the four anchored docs URLs now close. The fourth
      (`.../grid-template-areas#examples`) is still held, but by rule 1, not the
      hash — its unanchored twin is held too, so the hash fix worked and that page
      has a separate cause.
      Anchor resolution runs in the extractor against the **raw** hash, never the
      lowercased copy the policy holds: element ids are case-sensitive. It also
      tries the percent-decoded form and `getElementsByName`, since pre-HTML5 docs
      still anchor with `<a name="...">`.

### What is left, and why

The remaining 5 are two distinct causes, neither of them rule 2:

| page | cause |
| :--- | :--- |
| `mdn/grid-template-areas` (x2, anchored and not) | rule 1 — the interactive CSS playground is a real editor surface, so this is arguably correct |
| `news.ycombinator.com/item`, `/news` | rule 4 — extractor returns **0 words** on HN's table layout |
| `github.com/torvalds/linux` | rule 4 — 19 words extracted from a repo landing page |

The HN and GitHub rows are an **extraction** failure, not a policy failure: the
readability heuristic returns nothing on table-based and app-shell layouts, and
rule 4 then correctly refuses to close a page it cannot summarise. Fixing those
means improving `extractCleanText`, which is a different piece of work from the
closure policy and should not be smuggled into this plan.

---

## Step 8 — Unit tests for every new branch

`tests/test_closure_policy.js` is the fast pure-Node gate and must not depend on
the network. Add a table-driven case per new branch: invisible control ignored,
submit-bearing select counted, orphan select ignored, toggle without form
ignored, semantic editor caught, vendor editor caught, resolving anchor allowed,
non-resolving hash suspended.

Telemetry shape changed, so also update the `{ ...closureTelemetry, wordCount }`
bridge at `src/background/service-worker.js:461` and `:580`, and the
`closureTier` default at `src/storage/db.js:140`. No migration needed — no users
yet.

**Verify:** `npm run test:unit && npm run test:policy && npm run test:storage`.

- [x] Done — close recall **85.7% -> 88.6%**, leaks **0**. Reading pages held
      open: 5 -> 4 of 35. All 8 suites green.
      **The bridges needed no change at all.** Both new fields (`hasMediaSurface`,
      `hashResolvesToAnchor`) live *inside* `closureTelemetry`, so the existing
      `{ ...closureTelemetry, wordCount }` spread at `service-worker.js:464` and
      `:583` already carries them, and `db.js:140` is untouched. The plan assumed
      a shape change that putting the fields in the right place avoided.
      Writing the table-driven cases found a real hole rather than confirming
      known-good behaviour: **`checkVisibility()` does not detect off-screen
      parking.** It reports display / visibility / opacity / content-visibility,
      but an element at `left:-9999px` is visible to it — and off-screen parking
      is the standard clipboard-shim and virtualized-editor trick, the exact thing
      Step 3 claimed to have solved. Step 3's win was real but partial: it caught
      `display:none` shims and missed off-screen ones.
      `isVisibleControl` now also tests the box, treating a control as hidden when
      it is fully past the top or left origin (`rect.right <= 0 || rect.bottom <= 0`)
      or has zero area. Below-the-fold content is deliberately unaffected — it is
      off-viewport but genuinely on the page. That alone moved recall +2.9 points.

---

## Step 9 — Reconcile the two inverted functions

`checkIsDirty` and the `inputCounts` builder now share concepts (visibility,
what counts as a control, search-box exclusion) but re-derive them separately in
the same file. Extract the shared predicates once. This is cleanup, not
behaviour: the ratio must not move.

**Verify:** `npm run test:ratio` close rate identical to Step 7's number.

- [x] Done — close recall **88.6%**, leaks **0**, both unchanged as required.
      All 8 suites green.
      Filed as cleanup; turned out to be the second data-loss bug of the plan.
      The two editor lists had silently diverged:

      | selector | dirty check | telemetry |
      | :--- | :---: | :---: |
      | `.ace_editor`, `.cm-editor`, `.CodeMirror` | missing | present |
      | `[contenteditable]` (bare, valueless) | missing | present |
      | `.DraftEditor-root` | present | missing |

      So an unsaved draft in Ace or CodeMirror 6 read as **clean**. Suspension
      happened to save it — those classes were in the telemetry list, so the tier
      came back `suspend_only` — but unsaved work is meant to abort archival
      entirely, not merely avoid closing. The safety net was a side effect.
      Split into `TEXT_EDITOR_SELECTOR` (shared: holds typed text, so `innerText`
      is meaningful) and `APP_SURFACE_SELECTOR` (telemetry only: `canvas`,
      `[role="application"]`, `[role="dialog"]`). The split is load-bearing —
      running `innerText` over an open cookie banner would mark every page
      carrying one as having unsaved work.
      `/vendor-editor` now asserts `isDirty === true` so the divergence cannot
      quietly return.

---

## Step 10 — Re-baseline and record

Re-run everything, commit the final report, and update the floor in
`tests/telemetry_ratio.js` to just under the achieved rate so it becomes a
regression gate instead of an aspiration.

**Verify:** `npm run test:all && npm run test:ratio`.

- [x] Done — final close recall **88.6%** (31/35), must-suspend leaks **0**.
      `npm run test:all` and `npm run test:ratio` both green.
      Floor set to **0.82**, deliberately not just under the achieved rate: 8
      corpus URLs are bot-blocked headless (403/429) so the reachable set — and
      therefore the denominator — shifts between runs. 0.82 tolerates two pages of
      drift and trips on three, matching the ~3-point noise band below. The leak
      gate is the hard one and has no tolerance.
      Also narrowed `.gitignore` from `logs/` to `logs/closure-ratio-*.md`: the
      plan cites both debate transcripts and neither was tracked, so a fresh clone
      got dangling references. Run output stays ignored since it is regenerated
      every run.

---

## Outcome

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

The original question — is the auto-close thesis viable — is answered yes, but
the prediction that got us here was wrong in both directions. The debate expected
the coarse path/hash rules to be the culprit; they caught **zero**. Rule 1 was
the entire policy, and it was counting site chrome.

**Two data-loss bugs surfaced that had nothing to do with the ratio**, and
neither would have been found by tuning recall:
- iframe-hosted editors were invisible to the zero-loss guard (Step 2);
- the dirty check and the classifier kept separate editor lists, so an unsaved
  Ace or CodeMirror draft read as clean (Step 9).

**Still open, deliberately not done here:**
- `petstore.swagger.io` is caught only by the word floor; a fuller Swagger UI
  would leak. Its "Try it out" controls produce `appContainers=0`.
- HN and `github.com/torvalds/linux` are held open because `extractCleanText`
  returns 0–19 words on table and app-shell layouts. That is an extraction
  problem, not a closure problem, and belongs in its own piece of work.
- The vendor editor class list rots on a schedule. The upgrade path is recorded
  in `in-tab-extractor.js`: score a tool by off-screen-textarea plus tall scroll
  container rather than by class name.

---

## Post-merge review rounds

Two Copilot passes and one Gemini pass over the finished branch, run from the CLI
before the PR. Four findings were real, one was implemented-then-reverted on
measurement, and three were rejected with reasons.

**Fixed:**

- **The box test measured against the viewport, not the document** (Gemini).
  `getBoundingClientRect` is viewport-relative, so on any page the reader had
  scrolled, every control above the fold reported a negative `bottom` and
  `isVisibleControl` called it hidden. A scrolled page reported zero controls and
  was handed to the closer with the editor still on it. This is a bug **Step 8
  introduced**, and it was reproducible on a corpus URL:
  `grid-template-areas#examples` loads scrolled to its anchor, which pushed MDN's
  interactive playground above the viewport, so the page classified
  `safe_to_close` while reporting `Unsaved rich-text editor draft detected`.
  Part of Step 8's +2.9 points was therefore fake recall bought by closing a page
  with a live editor on it. Corrected figure below.
- **`mergeFrameExtractions` substituted a subframe for a failed top frame**
  (Copilot r1). Frame 0 is absent only when its injection threw; the fallback then
  gave the tab an ad frame's url, title and prose and computed `isDirty` from
  whatever survived. Now requires frame 0 and returns null otherwise — which both
  callers already handle as "look again later".
- **A missing `frameId` was coerced to 0** (Copilot r2), which let an
  unidentified entry win the top-frame lookup and reopen the bug one line above
  the fix. No longer defaulted.
- **`hasMediaSurface` skipped the frame-area gate** (Copilot r2) that
  `inputCounts` applies, so a 1x1 autoplay ad pixel raised the reading floor from
  120 to 500 words for the whole tab. Both now share one `countable` filter.
- **A hash resolved against any `name` attribute** (both reviewers), so `#search`
  matched `<input name="search">` on any page with a search box and an SPA route
  read as a deep link into prose. Scoped to `<a name>`.

**Implemented, measured, reverted:** counting a formless `<select>` sitting off
its page-load default, to catch SPA pickers with no `<form>`. docs.python.org sets
its version pickers by script at load, so the test fired before the user touched
anything and recall fell to 82.9% on exactly those two pages. Copilot's second
pass independently found the other half: React sets a controlled select's value
via `.value`, never the `selected` attribute, so `defaultSelected` is false on
every option and the baseline collapses to index 0 — the fix does not even hold
for its own target case. Recorded in the code as a known gap.

**Rejected:**

- *Accept any `<button>` as a form's submit signal, and count checkbox peers*
  (Gemini), to catch checkbox-only surveys. The failure mode is concrete: a cookie
  consent modal is a `<form>` with three toggles and a `<button type="button">`,
  and it is visible by definition. This would suspend every page carrying one. The
  hole is real; this fix costs more than it buys. Still open.
- *Fall back to top-frame-only injection when `allFrames` throws* (Gemini). The
  premise is unverified — `executeScript` with `allFrames` skips frames the
  extension cannot access rather than rejecting — and `processTabArchival` is
  already `try`-wrapped. A fallback that silently drops iframe dirty detection is
  data-loss-shaped, which is the wrong trade for an unconfirmed failure.
- *Require corroboration before trusting an `id` match* on a hash (Copilot r2).
  An SPA whose route fragment collides with an unrelated element id is real but
  speculative; no corpus page exhibits it, and the cheap half of the fix (the
  `name` collision) is shipped.

### Round 4 — the GitHub Copilot reviewer on the PR

- **Fixed: `position:fixed` controls were rescued by the scroll fix.** A fixed
  element's rect is viewport-relative by definition and does not move with scroll,
  so adding the scroll offset gave a toolbar parked at `top:-9999px` a positive
  document-space bottom on any page scrolled far enough. The mirror of the bug it
  fixed, in the over-suspend direction. The box test now short-circuits when the
  rect is already on screen, and only consults `getComputedStyle` on the rare
  off-origin path.
- **Fixed: the ratio harness scored `tier`, not what ships.** `processTabArchival`
  aborts on `isDirty` long before the tier is consulted, so a dirty page tiered
  `safe_to_close` is never actually closed — `pkg.go.dev` is exactly that. Scoring
  it as a close overstated recall and invented leaks production cannot produce.
  Both gates now use `tier === 'safe_to_close' && !isDirty`.
- **Fixed: the leak gate silently ignored unreachable must-suspend pages.** Two of
  the corpus's dangerous URLs are bot-blocked, so "0 leaks" was quietly computed
  over a smaller set than it appeared. The report and the console line now name
  how many must-suspend pages were actually measured.
- **Fixed:** subframes no longer run `extractCleanText` at all — the merge throws
  their prose away, so cloning and walking the body in every ad frame was pure
  cost. Also corrected a stale `--floor 0.60` usage string and the 88.6% rationale.
- **Rejected:** rejecting a control when *either* dimension is zero (today it must
  be both). Stricter visibility means fewer counted controls, which is the
  data-loss direction, and no corpus page shows a gain. Inert-until-measured, per
  the Step 5 and Step 6 precedent.
- **Rejected:** tightening the pre-Chrome-105 `offsetParent` fallback to re-check
  `display`/`visibility`/`opacity`. `checkVisibility` shipped in 2022, so the
  branch is dead on anything MV3 runs on; more code in an unreachable path is the
  wrong trade.

### ⚠️ Confirmed open: cross-origin frames are still invisible to the zero-loss guard

Copilot's critical finding, verified against the code and **not fixed here**.

`manifest.json` declares `optional_host_permissions: ['<all_urls>']` with no
static host grant, and the sweep checks only `verdict.requiredOrigin` — the
*top-level* origin (`service-worker.js:331`). `executeScript({ allFrames: true })`
injects only into frames the extension may script, and **omits the rest without
erroring**. So in per-origin permission mode a cross-origin child frame never
appears in the results, `mergeFrameExtractions` sees a complete-looking set, and
`merged.isDirty` is false for a draft nobody read.

`originPatternFor` is `protocol//hostname/*`, so this bites a different subdomain
too, not just a different site. Step 2's claim must therefore be read narrowly: it
closed the same-origin iframe hole, and the cross-origin one only when the user
has granted `<all_urls>`. The hardening fixture is same-origin, so no test covers
this.

The fix is a design change, not a patch, and a careless version is worse than the
bug: failing closed whenever any frame is missing would suspend every monetized
page on the web. Sketch — have the top frame report how many *substantial* iframes
it can see (area-gated, the way `MIN_COUNTABLE_FRAME_AREA` already gates counts),
compare against the frames actually injected, and downgrade to `suspend_only`
when the two disagree. Needs its own measurement pass.

| | Close recall | Leaks |
| :--- | ---: | ---: |
| Step 10, as measured | 88.6% | 0 |
| After review rounds 1-3 | 85.7% | 0 |
| **After round 4 (shipped predicate)** | **82.9%** | **0** |

The last drop is not a regression — it is the metric learning to tell the truth.
`pkg.go.dev/net/http` tiers `safe_to_close` but reports "Unsaved textarea content
detected" on every load, so `processTabArchival` aborts on it long before the tier
matters. It was being scored as a close it never was. The floor moved 0.82 -> 0.77
to keep the same two-pages-of-drift tolerance against the stricter metric; the
leak gate is unchanged and still has none.

That page is worth a follow-up on its own: `checkIsDirty` is deliberately not
visibility-gated (Step 3), so pkg.go.dev's hidden clipboard-shim textareas mark a
pure documentation page as carrying unsaved work **forever**. It can never be
archived. The Step 3 reasoning still stands — a hidden textarea with real content
is real content — but a shim that ships pre-filled on every page load is not the
case that rule was written for.

The 2.9-point drop is the scroll fix reclaiming recall that Step 8 took by
mistake. The floor stays at 0.82.

---

## Known unknowns — name them, don't paper over them

- **50 URLs is a small, self-selected sample**, and 8 are bot-blocked headless
  (403/429), skewing it toward automation-tolerant sites. The ratio is directional,
  not precise.
- **Headless ≠ the user's Chrome.** Consent banners, logged-in state and
  extensions all change `inputCounts`. `developer.chrome.com` already measured
  `app=1 other=3` in one run and `0/0` in another — cookie-banner timing.
  If a step's number moves by less than ~3 points, suspect noise, re-run before
  believing it.
- **QA practice sites are poor rule-1 controls.** demoqa.com,
  the-internet.herokuapp.com and uitestingplayground.com were probed across 53
  pages: almost every page is under 120 words, so rule 4 fires before rule 1 is
  ever reached and current-vs-proposed agree everywhere. They earn their place in
  the corpus for iframe/shadow-DOM/visibility edge cases (Step 2), not for the
  ratio. Isolating rule 1 needs pages that are **both long and interactive** —
  Swagger UI, Grafana, cloud consoles.
- **The real close rate is this number × the AI-summary hit rate**, because
  `canCloseWith` gates closing on an AI summary independently of tier.
