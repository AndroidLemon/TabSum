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

- [ ] Done — close rate ____%, must-suspend leaks ____

---

## Step 2 — Visibility gate in the extractor

In `src/content/in-tab-extractor.js`, filter every counted control through
`el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` with an
`offsetParent !== null` fallback in the `catch`.

Measured effect: kills `pkg.go.dev`'s 17 clipboard textareas and `nodejs.org`'s
22 inline checkboxes on its own. No `value.trim()` string-guessing — the layout
engine already knows.

**Verify:** `npm run test:policy` green; `npm run test:ratio` close rate up, zero
new must-suspend leaks.

- [ ] Done — close rate ____%, leaks ____

---

## Step 3 — Submit-bearing form owner for selects and toggles

A `<select>` or checkbox/radio counts only when `el.form` exists **and** that
form contains `button[type="submit"], input[type="submit"], button:not([type])`.
A checkbox driving a CSS accordion has no submit button; a login form does.

Apply to selects and toggles **only**. Do *not* apply it to text/number inputs —
React tools submit via `fetch()` with no `<form>`, and requiring one there
reopens the empty-tool-closing bug.

Measured: clears `docs.python.org`'s 9 version selects and `sqlite.org`'s picker
while `news.ycombinator.com/login` still suspends.

**Verify:** `npm run test:ratio` — HN login must remain `suspend_only`.

- [ ] Done — close rate ____%, leaks ____

---

## Step 4 — Restrict `otherInputs` to data-entry types

Count only `text, number, date, datetime-local, tel, url, email, password`.
Keep the existing search-box and `hidden/submit/button/reset` exclusions.
Checkbox/radio reach the count only via Step 3's toggle path.

**Verify:** `npm run test:policy`, `npm run test:ratio`.

- [ ] Done — close rate ____%, leaks ____

---

## Step 5 — Editor detection: semantic first, vendor fallback

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

- [ ] Done — close rate ____%, leaks ____

---

## Step 6 — Rule 2: stop suspending deep-linked docs

`hash.length > 3` currently suspends **every anchored documentation link**. It
scored 0 in the baseline only because the corpus had no anchors — a corpus gap,
not a clean bill of health.

A hash is a client-side route only when it does *not* resolve to an element in
the page. The extractor can answer that (`document.getElementById(hash.slice(1))`)
and the policy cannot, so this is a new telemetry field (`hashResolvesToAnchor`),
not a policy-local fix. Keep the `checkout|cart|account` path tokens unchanged.

**Verify:** the anchored URLs added in Step 1 classify `safe_to_close`.

- [ ] Done — close rate ____%, leaks ____

---

## Step 7 — Unit tests for every new branch

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

- [ ] Done

---

## Step 8 — Reconcile the two inverted functions

`checkIsDirty` and the `inputCounts` builder now share concepts (visibility,
what counts as a control, search-box exclusion) but re-derive them separately in
the same file. Extract the shared predicates once. This is cleanup, not
behaviour: the ratio must not move.

**Verify:** `npm run test:ratio` close rate identical to Step 6's number.

- [ ] Done — close rate ____% (must equal Step 6)

---

## Step 9 — Re-baseline and record

Re-run everything, commit the final report, and update the floor in
`tests/telemetry_ratio.js` to just under the achieved rate so it becomes a
regression gate instead of an aspiration.

**Verify:** `npm run test:all && npm run test:ratio`.

- [ ] Done — final close rate ____%, leaks ____

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
- **The real close rate is this number × the AI-summary hit rate**, because
  `canCloseWith` gates closing on an AI summary independently of tier.
