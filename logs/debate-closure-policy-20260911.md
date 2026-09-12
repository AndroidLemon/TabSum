# Cross-model debate: TabSum closure-policy refactor

Date: 2026-09-11 · Opponent: Gemini via `agy` 1.2.0 · 3 turns each

> Turn 1 was sent WITHOUT the inlined code context (a TMPDIR mismatch made the
> `cat` fail silently). Its turn-1 factual claims are therefore unverified echoes,
> not independent confirmation. Code was inlined from turn 2 onward.

## Turn 1 — Claude

```
(turn 1 prompt: opening + proposed interface + 3 questions)
```

## Turn 1 — Gemini


## Turn 2 — Claude

```
Conceding 1 and 2 outright — both of your fixes are better than my design.

On 1: `{ action: 'capture', requiredOrigin: pattern | null }` is right. The pattern derivation is pure string work, it belongs in the policy module, and the worker does the one await only for tabs that survived gates 1-7. My "false dichotomy" was exactly that.

On 2: you found a real bug. `closeDiscardedTab` does this:

```js
const record = await getTabById(recordId);
if (!record || record.status !== 'discarded' || record.deletedAt) return;
if (!canCloseWith(record.summarySource, settings)) return; // stays suspended
```

So the closure decision for a discarded tab needs `record.summarySource`, which is only reachable after an async db read. `decideSweepAction` returning `'close-suspended'` was promising something it cannot know. `{ action: 're-evaluate-discarded', recordId }` → worker fetches the record → `decideClosure` as sole closure authority is correct. Adopted.

Now two fronts where I think you are wrong.

**A. You refused candidate 3 for the right outcome but the wrong reason, and I have now checked the code you did not see.** Here is the actual lock:

```js
let storageLock = Promise.resolve();
function withStorageLock(fn) {
  storageLock = storageLock.then(fn).catch(err => console.error(err));
  return storageLock;
}
async function getTimestamps() {                       // <-- takes NO lock
  const data = await chrome.storage.session.get('tabTimestamps');
  return data.tabTimestamps || {};
}
async function setTimestamp(tabId, timestamp = Date.now()) {
  return withStorageLock(async () => { /* read, mutate, write */ });
}
```

The documented rule is "functions called inside withStorageLock must not call withStorageLock themselves" — a re-entrancy rule. `getTimestamps` is a bare read that takes no lock, so it complies. The claim I was given — that the rule is "already bent" by reading `getTimestamps()` outside the lock in the sweep — is simply false: an unlocked *read* is not a violation of a re-entrancy rule. The only genuine unlocked read-modify-write is `fadeHourly` on `lastFadeAt`, and that is already serialised by the `isSweeping` guard on its only caller.

So your "fix the lock directly" prescription has almost nothing to fix. That makes candidate 3's *premise* collapse, not just its cost/benefit — which is a stronger refusal than the one you gave. Do you accept that, or do you still see a concurrency defect worth fixing here?

**B. You dismissed candidate 4's cheap path in one clause and I think you were too quick.** You wrote off "injecting multiple files using shared window globals". But `chrome.scripting.executeScript({ target, files: ['a.js', 'b.js'] })` injects both files into the *same isolated world*, in order, sharing one scope. So:

- `closure-classifier.js` — plain script, no imports/exports, assigns one object to a var in that shared scope. Also a valid ESM module for Node, because a bare `var X = {...}` at top level plus a trailing `export` line... no, that breaks. Concretely: the classifier file is written as a plain script assigning `globalThis.__tabsumClassify`, and a three-line `closure-classifier.mjs` re-exports it for Node tests by reading nothing — or the Node test simply `eval`s the one file, which is what tests already do today but against *one small pure file* instead of a 260-line IIFE.

Cost: one extra entry in a `files: []` array. No bundler, no build step. In exchange, `classifyClosureSafety`'s 4 branches and the 120-word threshold become table-driven Node assertions, and `test_core.js` stops carrying a hand-copied duplicate of `applyTitleSeparator` that can silently drift from production.

You said "don't fight the platform". I am not fighting it — `files: []` taking an array is the platform handing me exactly this. What specifically breaks?

**C. One thing you conceded too easily.** You endorsed candidate 2 enthusiastically. But `db.js` already has a private `updateRecord(id, mutate)` doing read-modify-write. If I add a `transition(id, name)` on top of it, what stops that being a shallow module — an interface nearly as wide as its implementation, six names each mapping to a two-line mutator? Give me the test that tells the deep version from the shallow one.
```

## Turn 2 — Gemini

### A. Candidate 3: The Premise Collapses (Conceded)

I concede this completely. You are right: an unlocked read in `performInactivitySweep` does not violate a re-entrancy rule on a mutex designed for read-modify-write serialization. 

`shiftTimestamps` only executes inside `compensateAwayTime` (which holds the lock), every mutator serializes its read-modify-write through `withStorageLock`, and `fadeHourly` is protected by `isSweeping`. There is no re-entrancy bug, no race condition, and no concurrency defect in `service-worker.js`. 

The "already bent in 3 places" claim in the review notes was chasing ghosts. Candidate 3 has no defect to fix at runtime, and building a module to solve Playwright test boilerplate is backwards. Candidate 3 is dead.

---

### B. Candidate 4: What Specifically Breaks

You are proposing:
1. Split `classifyClosureSafety` into a script assigning `globalThis.__tabsumClassify`.
2. Inject `files: ['closure-classifier.js', 'in-tab-extractor.js']`.
3. Wrap it in a `.mjs` shim or `eval` it in Node for table-driven unit tests.

Here is why this fails:

#### 1. It doesn't test where bugs actually happen (The Mocking Mirage)
Look at `classifyClosureSafety`:
```js
if (textareas.length > 0 || selects.length > 0 || passwordInputs.length > 0 || appContainers.length > 0 || otherInputs.length >= 3) {
  return { tier: 'suspend_only', reason: 'Contains form or interactive input controls' };
}
```
If the classifier is pure, its input is a bag of numbers: `{ textareas, selects, passwords, otherInputs, wordCount, url }`. 

Your table-driven Node tests will assert that `3 >= 3` returns `suspend_only` and `119 < 120` returns `suspend_only`. That arithmetic has never failed. 

The bugs in production happen in the **DOM querying**:
- Did `queryAllDeep` pierce shadow DOM boundaries in complex web components?
- Did `isSearchInput` misclassify a search bar as a user input?
- Did a rich text container miss a CSS selector?

All of that stays in the *untested DOM adapter* inside `in-tab-extractor.js`. You added files and global-scope wiring to unit-test four integer comparisons, leaving 100% of the brittle DOM heuristics to Playwright anyway.

#### 2. It does not solve `applyTitleSeparator`
`TITLE_SEPARATOR_REGEX` is in the title extraction step (line 128), completely outside `classifyClosureSafety` (line 181). Separating the closure classifier does not touch title extraction. To stop `test_core.js` duplicating `applyTitleSeparator`, you would need a *second* shared script (`title-cleaner.js`), ballooning `files: []` to three files.

#### 3. Execution Context Leaks
Chrome isolated worlds persist for the lifetime of a page until navigation. Mutating `globalThis.__tabsumClassify` pollutes the isolated world. If an injection aborts mid-sweep or runs multiple times (the sweep at line 460 vs the manual shortcut at line 603), you are relying on cross-script global mutations without module isolation.

**Verdict:** It won't crash the V8 parser, but it trades away clean architectural boundaries (ESM in background/UI, self-contained IIFEs in content scripts) for a `globalThis` shim that tests trivial arithmetic while leaving the DOM failure modes untouched.

---

### C. Candidate 2: The Test for Deep vs. Shallow

A module is shallow if its interface merely re-names its implementation. If `transition(id, name)` is just a `switch` statement calling `updateRecord` with 2-line mutations, it is shallow.

Here are the **three concrete tests** that separate a deep lifecycle module from a shallow wrapper:

#### 1. The Genesis Test (Can the caller corrupt state at creation?)
Look at `service-worker.js:510`:
```js
const record = await saveArchivedTab({
  // ...
  status: shouldClose ? 'archived' : 'discarded',
  closedAt: shouldClose ? Date.now() : null,
});
```
Today, the caller directly pairs `status` with `closedAt`. 
- **Shallow:** `saveArchivedTab` still accepts arbitrary `status` and `closedAt` fields.
- **Deep:** `saveArchivedTab` is replaced by `createArchive(tabData, initialMode)`. The module derives `status` and timestamps itself. The caller *cannot* supply `closedAt` or `status`.

#### 2. The Invariant Rejection Test (Does it enforce the state graph?)
In a shallow wrapper:
```js
await transition(id, 'close'); // from a record that is already tombstoned (deletedAt != null)
```
A shallow wrapper executes `record.status = 'archived'` blindly.
A deep module validates legal transitions against the state graph:
```
[capturing] ──> [discarded] ──> [archived]
     │              │               │
     └──> [restored] <──────────────┘
            │
            └──> [tombstoned] ──> [purged]
```
If calling `close` on a tombstoned tab, or `reopen` on a live tab, throws or safely no-ops without corrupting timestamps, the module is deep.

#### 3. Domain Events vs. CRUD Verbs
- **Shallow:** The caller passes mutation commands: `transition(id, 'setStatusArchived')`, `transition(id, 'markClosed')`.
- **Deep:** The caller reports lifecycle events:
  - `tabReopened(id)` → sets `restoredAt: Date.now()`, clears `closedAt`
  - `tabSweepClosed(id)` → asserts `status === 'discarded'`, sets `status: 'archived'`, sets `closedAt: Date.now()`
  - `tabReverted(id, reason)` → handles Chrome close/discard refusal without caller manipulating status flags

If the interface expresses **caller intent** rather than **record mutation**, and makes illegal state representations impossible to construct, it is deep. If it's just a string enum over `updateRecord`, don't bother.

## Turn 3 — Claude

```
Your point 2 checks out and I withdraw the bundling. `test_core.js` Test 8 duplicates `applyTitleSeparator`, which lives in title extraction and has nothing to do with `classifyClosureSafety`. The review I was handed welded two unrelated problems into one candidate. The test even admits it in a comment: "honest regex-only test; the extractor stays a self-contained IIFE".

But your point 1 overstates, and it changes the conclusion. The classifier is not only arithmetic. Three of its four checks are *string* heuristics:

```js
if (hash.length > 3 || pathname.includes('checkout') || pathname.includes('cart') || pathname.includes('account'))
  return { tier: 'suspend_only', ... };
if (search.includes('&') && (search.includes('q=') || search.includes('query=') || search.includes('filter=')))
  return { tier: 'suspend_only', ... };
```

`pathname.includes('account')` fires on `/accounting-software` and `/account-of-the-siege-of-troy`. `includes('cart')` fires on `/cartography` and `/descartes`. `hash.length > 3` demotes every SPA route on the web. These are substring heuristics with obvious false positives, they decide whether a tab gets *closed or merely suspended*, and unlike `queryAllDeep` they are pure — no DOM required. "3 >= 3 has never failed" is true; "`includes('cart')` never mismatches" is false, and it is the half that produces wrong verdicts.

So the DOM-versus-verdict split still earns its keep. What I now think is wrong is my *mechanism*, and yours too — because both of us assumed the classifier needs a home in the page.

It doesn't. Candidate 1 is already creating `closure-policy.js`: pure, no imports, Node-testable. The extractor currently returns `closureTier` and `closureReason` as finished verdicts:

```js
const safetyClassification = classifyClosureSafety(wordCount);
return { ..., closureTier: safetyClassification.tier, closureReason: safetyClassification.reason, ... };
```

Change it to return the raw counts and location parts — `{ textareas, selects, passwords, appContainers, otherInputs, pathname, hash, search, wordCount }` — and let `decideClosure` in `closure-policy.js` compute the tier worker-side. Then:

- No second injected file. No `globalThis.__tabsumClassify`. No third file for the title. Your objections 1 and 3 both evaporate because the extra file never exists.
- The DOM counting stays in the page, where it must be, and stays Playwright's job — I concede that entirely.
- The substring rules become table-driven Node assertions in the module candidate 1 is building anyway.
- Marginal cost: changing one return shape. Candidate 4 stops being a candidate and becomes a line item inside candidate 1.

`isDirty` stays in the page — it reads live field values, not counts.

That is my last argument. Now close this out:

(a) Where do we still genuinely disagree? Name it precisely, and if the disagreement rests on something neither of us can settle from the code, say what would have to be measured to settle it.

(b) Give me the consolidated result, superseding both my opening proposal and your turn-1 ranking: the final shape of `closure-policy.js` (signatures and verdict vocabularies), and a do/refuse verdict on 2, 3, 4, 5, 7 with one line of justification each. Include candidate 6 in that list with a single line on whether deprioritizing it was a mistake.

Be terse. No recap of what we agreed.
```

## Turn 3 — Gemini

### (a) Where We Still Genuinely Disagree

I concede absorbing candidate 4 into candidate 1: having the in-tab extractor return raw telemetry (`{ inputCounts, urlParts, wordCount }`) and letting `closure-policy.js` evaluate the safety tier eliminates the multi-file injection problem completely.

Our remaining disagreement is **the operational value of refining those URL heuristics in unit tests versus their failure-mode asymmetry**:

- **Your stance:** Substring false positives (`/cartography`, `/descartes`) cause incorrect tier downgrades (`safe_to_close` → `suspend_only`), making URL rule precision a high-value testing target.
- **My stance:** The failure modes are radically asymmetric. A false positive (`suspend_only`) is completely benign: memory is reclaimed via `chrome.tabs.discard`, zero user state is destroyed, and the tab remains visible in the tab bar. A false negative (`safe_to_close` on a stateful page) is catastrophic data loss. Because path heuristics only ever fail *safe* (demoting to suspension), optimizing string boundaries in Node tests produces diminishing real-world returns.
- **What would settle it:** Real dogfooding telemetry measuring the **suspension-to-close ratio** under normal browsing. If >70% of candidate tabs are falling into `suspend_only` due to coarse path/hash matches, tab-bar clutter remains high and the auto-close thesis fails in practice, proving you right. If the close rate remains healthy (>60%) despite the coarse rules, fine-tuning path substrings is bike-shedding safety margins that are already harmless.

---

### (b) Consolidated Refactor Plan

#### `src/background/closure-policy.js`

```js
export const AI_SUMMARY_SOURCES = new Set(['gemini-api', 'openai-compatible', 'prompt-api']);

/**
 * Stage 1: Tab Triage Ladder (Gates 1-8).
 * Pure synchronous evaluation of open/discarded tabs during sweep.
 */
export function decideSweepAction(tab, ctx)
// ctx: { lastActive, now, settings, hasGlobalPermission, discardedRecordId }
// -> { action: 'skip', reason: string }
//  | { action: 're-evaluate-discarded', recordId: string }
//  | { action: 'capture', requiredOrigin: string | null }

/**
 * Stage 2a: Content Safety Classifier.
 * Evaluates raw telemetry extracted from the page to determine closure safety.
 */
export function classifyClosureSafety({ inputCounts, urlParts, wordCount })
// inputCounts: { textareas, selects, passwords, appContainers, otherInputs }
// urlParts: { pathname, hash, search }
// -> { tier: 'safe_to_close' | 'suspend_only', reason: string }

/**
 * Stage 2b: Terminal Tab Disposition.
 * Determines final action based on safety tier, dirty state, AI summary, and settings.
 */
export function decideClosure({ closureTier, summarySource, isDirty, settings })
// -> { action: 'close' | 'suspend' | 'leave-open', reason: string }
```

**Vocabulary:**
- `SweepAction`: `'skip' | 're-evaluate-discarded' | 'capture'`
- `ClosureTier`: `'safe_to_close' | 'suspend_only'`
- `ClosureAction`: `'close' | 'suspend' | 'leave-open'`

---

#### Final Candidate Dispositions

- **Candidate 2 (Collapse status writers): DO.** Enforces atomic transitions (`createArchive`, `markClosed`, `markRestored`, `revertOpen`) at the storage boundary so callers cannot write desynchronized `status` and `closedAt` combinations.
- **Candidate 3 (Tab-activity clock module): REFUSE.** The session storage mutex has zero concurrency or re-entrancy defects, and runtime modules should not be created to clean up test boilerplate.
- **Candidate 4 (Classifier pure adapter): ABSORBED INTO 1.** Extractor returns raw telemetry counts/strings; `closure-policy.js` evaluates the tier worker-side without extra files or global-scope gymnastics.
- **Candidate 5 (Fade module / decouple html from db): DO.** Severing a 55-line string utility from the entire IndexedDB engine and isolating tombstone-purging is a clean, low-risk modularity win.
- **Candidate 6 (Shrink getArchivedTabs filter bag): NOT A MISTAKE TO DEPRIORITIZE.** A verbose internal query builder with 13 keys is ugly, but it has no concurrency or state-corruption risks; fixing it before stabilizing the write path is wasted motion.
- **Candidate 7 (App view state vs wiring): REFUSE.** Adding 150–200 lines of state boilerplate to an 869-line UI file to save 40 lines of duplication is textbook architecture astronautics for an unreleased app.

