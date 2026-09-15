# Cross-model review of extraction-v1, 2026-09-14

Two reviewers, neither wrote the code (Sonnet implemented, Fable orchestrated).
Gemini via agy, four turns; Copilot CLI, one headless pass on the inlined diff.

## Gemini, consolidated (its own words, final turn)

### (b) Consolidated Review Findings

1. **Double-counting via non-transitive ancestor check (`p > span > span`):** The ancestor check halted at the first block ancestor, treating an unharvestable intermediary as an unharvested boundary and causing duplicate extraction of identical text.  
   **Status:** **FIXED** (Transitive walk across all block ancestors; only a fully harvested ancestor suppresses descendants).

2. **Global `designMode` extension poisoning:** `document.designMode === 'on'` checked the top-level document without diffing against a baseline, causing "Enable Copy" extensions to mark all open tabs permanently uncloseable.  
   **Status:** **FIXED** (Restricted strictly to subframes: `window !== window.top`).

3. **Missing semantic tags (`<summary>`, `<figcaption>`):** Standard HTML5 explanatory prose and collapsible documentation headers were omitted from `BLOCK_SELECTOR`.  
   **Status:** **FIXED** (Added to `SEMANTIC_BLOCK_SELECTOR` and included in `NO_FLOOR_TAGS`).

4. **Safety net blind spot on DOM-only interactive tools (Rule 4 inversion):** Widening extraction to `div`/`span`/`td` risked pushing zero-control, zero-canvas web tools (e.g. DOM games, DOM terminals) past the 120-word floor without triggering Rule 1.  
   **Status:** **FIXED** (Corpus expanded with `play2048.co` as a permanent non-canvas leak gate).

5. **Noise-child and hidden-descendant poisoning:** An ancestor block containing a hidden element (`display:none`) or a noise element (`aside > div`) is marked unharvestable by `querySelector` despite the descendant being discarded later.  
   **Status:** **CEILING** (Recorded as known limitation; requires tri-state subtree coverage architecture).

6. **Nested-block preamble dropping (The "ponytail" bug):** Semantic blocks containing nested block children (`li > ul`, `div > p`) lose their direct text nodes and inline preambles.  
   **Status:** **CEILING** (Recorded as known limitation; inline-run splitting rejected due to whitespace smashing and floor fragmentation).

7. **Exclusion of `<pre>` and `<code>` blocks:** Code snippets, terminal commands, and configuration blocks are completely omitted from the prose harvest.  
   **Status:** **REJECTED** (Author policy decision: code blocks degrade natural language summary generation).

8. **Metric distortion in `body.innerText` denominator:** Denominator contains unstripped boilerplate (nav, header, footer), artificially penalizing clean extraction and masking word inflation.  
   **Status:** **REJECTED** (Retained as a rough 25% diagnostic indicator rather than an enforced gating invariant).

9. **Shadow DOM invisibility:** `querySelectorAll` fails to penetrate Web Component shadow roots, causing modern component-based reading tabs to report near-zero harvest.  
   **Status:** **REJECTED** (Parity with legacy clone behavior; deferred to future Web Component audit).

10. **Main-thread layout and serialization cost of live DOM walk:** Querying visibility, selectors, and `innerText` across 10,000+ elements risks UI jank during background archival sweeps.  
    **Status:** **REJECTED** (Benchmark confirmed ~50ms ceiling on 13.4k elements in headless Chromium; cost deemed acceptable).

## Gemini, points it still disagrees with

### (a) Disagreements with What Ships

1. **Noise-child & hidden-child poisoning as a ceiling:** Conflating structural containers with prose blocks leaves large prose sections vulnerable to silent erasure by a single hidden tooltip, tracking pixel, or nested `<aside><div>` ad.
2. **The recall metric denominator:** Retaining raw `body.innerText` as the recall denominator continues to reward code that fails to strip boilerplate and penalizes strict noise pruning.
3. **Total exclusion of `<pre>`/`<code>`:** Stripping code blocks degrades summaries on technical documentation, RFCs, and bug tracker threads where code samples constitute the core substance of the reading tab.


## Copilot CLI

# PR Review: in-tab-extractor.js changes

## Findings

**1. 🔴 Data-loss leak: `designMode` dirty-check reads a different frame than the one word-counted, and `appContainers` inflates for the wrong reason**
`document.designMode === 'on'` and `document.body?.innerText` are evaluated per-injected-frame (allFrames:true), so this is correct *per frame* for dirtiness. But `extractCleanText`'s prose harvest deliberately only runs meaningfully in the top frame (per the stated design — "only the top frame harvests prose"). If a same-origin editable iframe (e.g. embedded CKEditor) is present, that sub-frame returns `isDirty:true` — good — but nothing here changes; this is fine. The real issue: `document.body?.innerText.trim().length > 5` will throw if `document.body.innerText` is `undefined`-safe but `body` exists with empty innerText — not a bug. Retract; no confident finding here. Skipping.

**2. 🟠 Quadratic-to-cubic cost: `isHarvestable` calls `el.querySelector(...)` per candidate element, and the ancestor walk re-queries `closest()` up the tree for every node**
For each of N candidate elements (`h*, p, blockquote, li, td, th, dd, dt, div, span` — i.e. nearly every element on the page), `isHarvestable` runs a `querySelector` scan of that element's *entire subtree* to check for a blocking descendant. On a deeply nested page (e.g. a `<div>`-soup React app with N nested divs), this is O(N²) in the worst case (each ancestor div re-scans its full subtree). The `harvestableCache` memoizes results but does **not** memoize/avoid the `querySelector` subtree scan itself — that scan is not cached, only the boolean outcome is. On large real pages (GitHub timeline with hundreds of nested `div`/`td`), this can be seconds of main-thread work injected into every tab being summarized.
**Fix:** replace the `querySelector` blocking-descendant check with a single top-down tree walk (or `TreeWalker`) that marks descendants as "covered" once, instead of re-scanning subtrees per candidate.

**3. 🟠 `isVisibleControl` gate drops visible prose behind CSS `content:` or zero-size-but-scrollable containers, and reintroduces cost via `getBoundingClientRect` per node**
Reusing `isVisibleControl` (checkVisibility + bounding-box test) for prose blocks means text inside `overflow:hidden` "read more" clamps, `display:contents` wrappers (zero-size own box but visible children), or elements with `height:0` + `overflow-y:auto` (common in card layouts) gets excluded even though it's real, readable prose. This is a different failure mode than the intentional "skip hidden nav" behavior — legitimate long-form article text using CSS truncation patterns will be silently dropped, shrinking word count and potentially tripping Rule 4 (under-120-words hold) or worse, artificially deflating a genuinely long article's count enough to misclassify it as safe_to_close via whatever count threshold gates that policy.
**Fix:** use `checkVisibility()` alone (skip the bounding-box/off-screen test) for prose blocks, since off-screen-but-rendered prose (common in virtualized/lazy layouts) is still real content, unlike a decoy control.

**4. ⚪ `floor = 0` for `p`/`td`/`th`/`dd`/`dt` lets single-character/whitespace-only prose slip past the length filter**
`text.length > 0` admits things like a lone `"·"` bullet `<td>` or an empty-but-non-empty-after-trim `<p>&nbsp;</p>` (non-breaking space survives `trim()` inconsistently across engines) as a "block," inflating block count and, via `blocks.join('\n\n')`, adding noise paragraphs. Low severity since it doesn't affect `wordCount` much, but pollutes the summarized text shown to the user.
**Fix:** floor at a small positive value (e.g. `> 1`) even for no-floor tags.

**5. ⚪ Test threshold change is a metric-following adjustment, not a policy regression indicator — verify the 0.80 floor isn't masking the new leaks above**
`CLOSE_RATE_FLOOR` moved 0.77→0.80 alongside the extractor rewrite. Given finding #3 (prose dropped by `isVisibleControl`) could lower `wordCount` and legitimately move pages across the Rule-4 boundary, the recall/close-rate numbers backing this floor bump should be re-validated after fixing #3, since a currently-"passing" 85.7% could partly reflect under-counted articles being *correctly* suspended for the wrong reason (masking the real recall bug as a policy success).




## Disposition

| # | Finding | Source | Status |
| :-- | :--- | :--- | :--- |
| 1 | p>span>span double-counts: ancestor check stops at nearest block | Gemini | fixed: coverage walks every block ancestor, covers only if that ancestor is itself harvested |
| 2 | visibility:hidden parent with visible child drops the child | Gemini | fixed, same change |
| 3 | designMode on the top document: copy-enabler extensions set it everywhere | Gemini | fixed: subframe only |
| 4 | figcaption and summary missing | Gemini | fixed, no floor |
| 5 | Rule 4 inversion on DOM-only tools with no input or canvas | Gemini | corpus gains play2048.co as a must-suspend gate |
| 6 | Zero-length floor admits a lone glyph as a word | Copilot | fixed: floor 1 |
| 7 | Nested-block preamble, hidden-child and noise-child poisoning | Gemini | ceiling: needs tri-state coverage (subtree vs own runs), floor 0 for runs, layout-aware whitespace. Spec recorded in the code comment |
| 8 | Zero-size box veto drops leaf text in display:contents | Copilot | ceiling: prose rarely sits directly in a display:contents element; off-screen parking test must stay |
| 9 | pre/code excluded | Gemini | rejected: code inflates rule 4's count on the pages it must judge; the prose around it is what we harvest |
| 10 | Recall denominator is body.innerText | both | rejected: reporting aid, not a gate; the fixture tests are the double-count proof |
| 11 | Shadow DOM not traversed | Gemini | rejected: parity with the old clone, follow-up |
| 12 | Quadratic cost | both | rejected: measured 50ms on 13,412 elements, 2x the clone |
| 13 | Petstore held by a dirty URL bar | Gemini | rejected: held by rule 1 on an input control, conceded |
| 14 | Canvas tools leak | Gemini | rejected: APP_SURFACE_SELECTOR counts canvas, conceded |
| 15 | Re-validate the 0.80 floor after fixing the visibility veto | Copilot | rejected: the per-page recall table shows every drop's cause |

Measured during review (Playwright Chromium, headless, 3 runs):

| page | elements | old clone | new walk |
| :--- | ---: | ---: | ---: |
| nodejs.org fs.html | 13,412 | 23-26ms | 50-52ms |
| playwright.dev class-page | 9,321 | 18-23ms | 45-47ms |
| github.com/torvalds/linux | 1,173 | 3-4ms | 6-7ms |

Re-measured after round 2 (text-node walk), same harness: 43-45ms, 29-32ms,
3ms. Round 2 is faster than round 1 on every page.

## Claude code-review (Fable, high effort, 8 finder angles, 11 verifier runs)

Ran against 7e0c598 while round 1 was being applied. Its findings, ranked as
reported, and what happened to each:

| # | Finding | Status |
| :-- | :--- | :--- |
| C1 | Prose gate inherits checkOpacity, so scroll-reveal pages (opacity:0 until scrolled; a background tab never scrolls) lose everything below the first screen and are held by rule 4. Regression vs the clone. | fixed, round 2: prose uses isVisibleControl without checkOpacity, box test kept |
| C2 | Container picked from the un-pruned DOM: a decoy `<article>` inside `<aside class="sidebar">` before the real `.entry-content` yields an empty harvest. | fixed, round 2: first container candidate not inside noise |
| C3 | HN comments are `<div class="commtext">first<p>second<p>third</div>`; the div is disqualified by its `<p>` children and its own first paragraph is dropped. Verified live on 549 of 910 comments in one thread. The "preamble ceiling" was biting the plan's headline page. | fixed, round 2: text-node walk, each node counted once by construction |
| C4 | `div` sits in SEMANTIC_BLOCK_SELECTOR against its own comment, so `<td><div>opened this issue</div></td>` loses the cell's no-floor. | fixed, round 2: floor inherited from the nearest no-floor ancestor; the semantic list no longer exists |
| C5 | appContainers gets +1 for designMode with no visibility gate, unlike every other surface. | fixed, round 2: one shared designModeBody() feeds both the dirty check and the visibility-gated count. Note: from inside a hidden iframe the body still reports rendered, so the frame-level gate is the parent's, as before |
| C6 | With div/span leaves harvested in DOM order and the summariser slicing 3000-6000 chars, pre-content chrome not caught by the noise list fills the prompt window ahead of the article. | follow-up: summariser should truncate by block or skip short-fragment runs before the first long paragraph. Not this branch |
| C7 | `p` in NO_FLOOR_TAGS lets micro-copy (`<p>Share</p>`) inflate the count near the 120-word floor. | rejected: the plan chose it for HN comment paragraphs, which are `<p>` and legitimately short; five micro-copy paragraphs add ten words |
| C8 | Layout-forcing visibility runs before the cheap leaf test, wasted on wrappers; no executeScript timeout in the sequential sweep. | moot after round 2: visibility is computed only for elements that own text, cached. The missing timeout is real and a service-worker follow-up |
| C9 | Unfloored cells plus div leaves let control-light data grids cross rule 4 and close with browsing state. | known unknown, ADR 0001. The play2048.co gate turned out weak (caught by an app surface). A density rule is the candidate if it bites |
| C10 | discard_state.js closes the dead handle, prints the typed string as `survived`, and lets TABSUM_CHANNEL override the helper's channel. | fixed, round 2 (first two); channel override kept, it is the point of the flag |
| C11 | Five verbatim copies of the executeScript-and-merge block in the hardening test. | fixed, round 2: extractTab() helper |
| C12 | frame_gap.js duplicates copyDir, readCorpus and argOf; mkdtemp copy never removed. | left: measurement scratch, not shipped code |
| C13 | bodyWords of 0 reports n/a and escapes the low-recall list. | rejected: a page with no body text has no recall to report |
| C14 | A SHOW_TEXT TreeWalker grouped by nearest block would remove the leaf rule, the span carve-out, the cache and the preamble ceiling. | adopted as the round 2 design |
| C15 | Steps 2-3 have no ADR although AGENTS.md asks for one. | fixed: ADR 0002 records the harvest design |

One finding it refuted itself: the display:contents leaf case Copilot raised is
unreachable, checkVisibility already returns false for it.

## Full Gemini transcript

### Claude, turn 1

You are an adversarial code reviewer. I am the author's reviewer, and I want you to attack this diff, not agree with it. Six turns total, three each; this is turn 1. Disagree wherever you disagree, concede plainly when I out-argue you, and never pad with recap.

CONTEXT: TabSum is a Chrome extension that summarises and auto-closes reading tabs. A closure policy classifies each tab: safe_to_close, or suspend_only when the page holds a form, editor, or unsaved work. Rule 4 holds a tab when the extractor recovers under 120 words (READING_FLOOR_WORDS). A "leak" is a must-suspend page classified closeable: data loss. The extractor (below) is injected with allFrames:true; only the top frame extracts prose, subframes contribute dirty/telemetry only, merged by mergeFrameExtractions. isVisibleControl is an existing helper: checkVisibility, then a document-space bounding-box test (zero box or parked past the origin = not visible; position:fixed judged viewport-relative).

The branch replaced a cloneNode-based harvest (clone.innerText === textContent, so hidden text leaked; selector was only h1-h6/p/blockquote/li; 20-char floor) with the live-DOM walk below. Corpus of 50 URLs: leaks 0, close recall 82.9% -> 85.7%, HN front page 0 -> 681 words, github.com/torvalds/linux 19 -> 794, no page over 100% recall (recall = extracted words / main-frame body.innerText words).

[extractor source and metric diff inlined here, omitted]

QUESTIONS, attack in this order:
1. Double-counting: find a DOM shape where isHarvestable lets two elements contribute the same text. Consider td>span (ancestor rule), li>ul>li, p>span>span, blockquote>p, div>span>span, and shadow roots (querySelectorAll here does NOT pierce shadow DOM).
2. Dropped visible prose: find a common page shape where real prose is skipped. Known: a semantic block with a nested block loses its own preamble text. What else? Think <pre>/<code>, <figcaption>, <section> with bare text nodes, <article> whose text is direct text nodes, <label>, <summary>.
3. Performance: N = every h*/p/li/td/div/span on a 30k-word docs page, maybe 20k elements. Each gets closest(NOISE), isVisibleControl (checkVisibility + getBoundingClientRect), querySelector(BLOCK) and a WeakMap-cached ancestor walk. Is this quadratic anywhere? Does reading innerText per element force layout repeatedly?
4. Safety: is there any way this change makes a must-suspend page closeable? The dirty check and telemetry counts are untouched except the designMode addition. Could a wider harvest push a tool page over 120 words that was previously held only by rule 4? (Known: petstore.swagger.io is held by the word floor because its controls yield appContainers=0; it went 102 -> 169 words and still suspends. Why does it still suspend, and is that stable?)
5. designMode: document.designMode === 'on' && body.innerText.length > 5 => dirty. False positives? Any page that sets designMode without being an editor?
6. The recall metric: body.innerText in the main frame as denominator. What does it hide?

Be concrete: name the DOM shape or the line. Budget 6 turns.


### Gemini, turn 1

### 1. Double-Counting: `p > span > span` (and any semantic block with nested spans)

Here is a concrete DOM shape that double-counts:

```html
<p id="p">
  <span id="s1">
    <span id="s2">This is a long sentence of prose exceeding twenty characters.</span>
  </span>
</p>
```

**Step-by-step trace of `isHarvestable`:**

1. **`el = #p`**:
   - `tag === 'p'`, so `hasBlockingDescendant = p.querySelector(SEMANTIC_BLOCK_SELECTOR)`.
   - Neither `#s1` nor `#s2` matches `SEMANTIC_BLOCK_SELECTOR` (which excludes `span`). Result is `null`.
   - Ancestor check passes.
   - **`isHarvestable(#p)` evaluates to `true`**. `#p.innerText` is pushed to `blocks`.
2. **`el = #s1`**:
   - `tag === 'span'`, so `hasBlockingDescendant = s1.querySelector(BLOCK_SELECTOR)`.
   - Finds `#s2` (matches `BLOCK_SELECTOR`).
   - **`isHarvestable(#s1)` evaluates to `false`**.
3. **`el = #s2`**:
   - `tag === 'span'`, `hasBlockingDescendant = null`.
   - `ancestorBlock = s2.parentElement.closest(BLOCK_SELECTOR)` resolves to **`#s1`** (since `#s1` is a `span`).
   - Look at line 91: `result = !ancestorBlock || !isHarvestable(ancestorBlock)`.
   - `isHarvestable(#s1)` was evaluated as **`false`**.
   - Therefore, `!isHarvestable(#s1)` is **`true`**!
   - **`isHarvestable(#s2)` evaluates to `true`**. `#s2.innerText` is pushed to `blocks`.

**Result:** The exact same text is pushed twice—once by `<p>` and once by `#s2`.

**Why the algorithm fails:**
The ancestor check in `isHarvestable` is non-transitive. It halts at the *immediate* nearest ancestor block (`#s1`). Because `#s1` was disqualified by having a child, `!isHarvestable(ancestorBlock)` naively assumes `#s2` is orphaned and must step up to harvest. It never continues up the ancestor tree to check if an ancestor higher up (`<p>`, `<td>`, `<li>`, `<blockquote>`) is already harvesting that exact subtree under the semantic tag's ignore-spans rule.

The same bug triggers on `td > span > span`, `li > span > span`, and `blockquote > span > span`.

---

### 2. Dropped Visible Prose

Beyond the acknowledged preamble loss on semantic tags containing nested blocks, this diff drops vast categories of visible prose:

1. **`<pre>` and `<code>` blocks:**
   Neither `<pre>` nor `<code>` exists in `BLOCK_SELECTOR`. In documentation (MDN, GitHub, technical blogs), standalone `<pre><code>...</code></pre>` blocks not wrapped in a `<p>` or `<div>` are completely ignored by `article.querySelectorAll(BLOCK_SELECTOR)`. If the code block contains syntax-highlighted `<span>` tags, each token is discarded because `text.length > 20` rejects short tokens.
2. **`<figcaption>` and `<summary>`:**
   Neither is in `BLOCK_SELECTOR`. Image captions in `<figure><figcaption>...</figcaption></figure>` and accordion titles/FAQ questions in `<details><summary>...</summary></details>` are skipped unless wrapped in redundant `<div>` or `<p>` tags.
3. **Bare text nodes under `<section>`, `<article>`, `<main>`:**
   Sites using modern HTML5 sectioning without wrapping text in `<p>` (e.g. `<article>Breaking News: ...</article>`) yield 0 blocks because none of those container tags are in `BLOCK_SELECTOR`.
4. **Hidden-descendant poisoning (The False Disqualification Bug):**
   ```html
   <p>Here is 50 words of perfectly valid prose.<span style="display:none"><span>badge</span></span></p>
   ```
   `p.querySelector(SEMANTIC_BLOCK_SELECTOR)` is `null`, but what if it's a `div`?
   ```html
   <div>Here is real prose.<div style="display:none">hidden modal</div></div>
   ```
   In `isHarvestable`, `div.querySelector(BLOCK_SELECTOR)` does **not** check visibility; it returns the hidden `<div>`. The parent `<div>` is marked `isHarvestable = false`. Later, when the loop reaches the hidden child, `isVisibleControl` skips it. **Neither the parent nor the child is harvested.** A hidden tooltip or tracking tag completely erases its parent block.
5. **Short `<li>` elements:**
   `NO_FLOOR_TAGS` covers `td, th, dd, dt, p`, but **not** `li`. Any bulleted list with concise points (`<= 20` chars, e.g., features, changelog entries, ingredients) is discarded by `text.length > 20`.

---

### 3. Performance: Layout Costs and Non-Linear DOM Traversal

1. **Quadratic Subtree Traversal via `querySelector`:**
   For every element matching `BLOCK_SELECTOR`, you execute `el.querySelector(BLOCK_SELECTOR)`. If a document has deeply nested wrappers or long non-block trees (e.g. `<div><a><span>...</span></a></div>`), `querySelector` must scan down through all descendants to verify no block exists. Across 20k elements, this is $O(N \cdot D)$ selector matching in the live DOM.
2. **`closest(NOISE_SELECTOR)` on 20k elements:**
   `NOISE_SELECTOR` has 18 compound selectors. Running `el.closest(...)` with this selector list up the tree for 20,000 nodes is heavy main-thread work.
3. **`innerText` Serialization Bottleneck:**
   Even if the DOM is not mutated, reading `el.innerText` forces Chromium to compute layout-dependent text representations (handling CSS text-transform, collapsed whitespace, visibility). Calling `innerText` on thousands of elements in a content script will cause noticeable main-thread jank.
4. **`isVisibleControl` on all blocks:**
   Calling `getBoundingClientRect()` on 20k elements to check document coordinates forces geometry computations across the entire page.

---

### 4. Safety: Rule 4 Inversion Leaking Tool Pages

**The Mechanism:**
Rule 4 acts as a coarse heuristic safety net: if a tab has `< 120` words, it assumes the page is a web application/dashboard/empty form rather than a readable article, holding it as `suspend_only`.
By expanding the harvest to `div`, `span`, `td`, and `th`, you harvest navigation labels, button text, table cell headers, and inline instructions. A tool page that previously produced 40 words of prose can now easily produce 130 words of UI fragment noise.

**The `petstore.swagger.io` case:**
Why does Swagger Petstore still suspend despite jumping from 102 to 169 words?
It suspends because `checkIsDirty()` detects `input.value !== input.defaultValue` on the top "Explore" URL bar (`https://petstore.swagger.io/v2/swagger.json`). When Swagger UI's client-side bundle initializes, it populates `input.value` via script without updating the HTML `value` attribute, creating an artificial dirty state.

**Why this is unstable:**
If an API console, calculator, or dashboard initializes inputs via standard HTML attributes (where `value === defaultValue`) or uses non-input UI (canvas, custom div controls, unedited forms), it has `isDirty === false`. Under the old selector, Rule 4 protected it from closure by seeing `< 120` words. Under this diff, the UI chrome in `div`/`span`/`td` pushes it over 120 words, **classifying it as `safe_to_close` and killing the tab.**

---

### 5. `designMode`: False Positives & Cross-Frame Pollution

```javascript
if (document.designMode === 'on' && document.body?.innerText.trim().length > 5) {
  return { isDirty: true, reason: 'Unsaved rich-text editor draft detected' };
}
```

1. **Subframe Contamination:**
   The extractor runs with `allFrames: true`, and subframes contribute dirty flags via `mergeFrameExtractions`. If a third-party ad creative, payment iframe, or embedded widget initializes with `designMode = 'on'` (common in legacy rich-media ad containers or sandboxed HTML preview frames), `checkIsDirty()` in that frame returns `isDirty: true`. The parent tab becomes permanently uncloseable.
2. **Zero-Edit Dirtiness:**
   `input` and `textarea` check for user modification (`value !== defaultValue`). The `designMode` check has no dirty delta—it only checks if `innerText.trim().length > 5`. Any read-only CMS template preview, design mode playground, or document viewer that loads with pre-existing text is marked dirty instantly on page load without any user input.

---

### 6. The Recall Metric: Distortions in `bodyWords`

Using `document.body.innerText` in the main frame as the denominator introduces fundamental flaws:

1. **It rewards scraping noise and penalizes cleaning it:**
   `document.body.innerText` includes headers, footers, navbars, sidebars, cookie banners, and copyright notices. If `extractCleanText` correctly eliminates 500 words of boilerplate from an 800-word page, the reported recall is $300 / 800 = 37.5\%$. Conversely, an extractor that fails to prune noise scores closer to 100%. The metric creates perverse incentives.
2. **It masks double-counting:**
   The author celebrates that "no page had over 100% recall." This is an artifact of the bloated denominator. If an article has 400 words of prose and 600 words of site chrome ($1000$ total), an extractor that double-counts the prose (yielding 800 words) reports $80\%$ recall. The bloated denominator conceals massive duplication.
3. **Shadow DOM Blindness:**
   `document.body.innerText` renders text inside open and closed shadow roots in Chromium. `extractCleanText`, however, relies on `article.querySelectorAll`, which cannot penetrate shadow roots. Modern web components appear in the denominator but can never be retrieved by the numerator, artificially suppressing recall on modern web apps.


### Claude, turn 2

Turn 2 of 6.

1. Conceded: p>span>span double-counts. Your trace is right; the ancestor check stops at the first block ancestor and treats "disqualified" as "nobody covers me". Fix I intend: an element is covered if ANY ancestor block is harvestable, i.e. walk up through every BLOCK ancestor and return false the moment one is harvestable; the WeakMap keeps that linear. Attack the fix: name a shape where "any harvestable ancestor" is wrong.

2. Hidden-descendant poisoning: conceded as real, and it is the same loss class as the nested-list preamble I already marked. Proposed fix for both: when an element is disqualified BY A DESCENDANT (not by an ancestor), harvest its own text, meaning its direct text nodes plus any inline child that is not a block and holds no block, as one fragment under the element's floor. Give me the failure mode of that.

3. Rejected: your petstore explanation is wrong on the evidence. The report row is tier suspend_only, reason "Contains form or interactive input controls", inputCounts 0/0/0/1/1, isDirty false. It is held by rule 1 on an input control, not by a dirty URL bar. Rule 1 does not move with word count, so it is stable. The general risk you describe, a tool with no forms, no editor, and no dirty state that was held only by rule 4, is real and is exactly the known unknown ADR 0001 records; the leak gate over 14 must-suspend pages is the check, and it shows zero. If you have a concrete site shape that has zero visible data-entry controls, zero editor surfaces, and over 120 words of UI chrome under div/span/td, name it.

4. pre/code: not a bug. Code blocks are not summarisable prose, the old selector excluded them too, and this branch is about seeing prose the closer was blind to, not about capturing everything. figcaption and summary: cheap to add as semantic tags. Worth it, or is that scope creep for a summariser?

5. Performance: it is not quadratic. querySelector per element and innerText per element are each O(subtree), so the whole pass is O(N x depth), and with no DOM mutation layout is computed once and reused by both innerText and getBoundingClientRect. I will measure wall time on nodejs.org fs.html (33k words) and report it next turn rather than argue it.

6. designMode: the "no delta" objection applies equally to the existing contenteditable rule (innerText > 5 chars, no baseline), which shipped and held on the corpus. The extractor runs once at archival time, so a load-time baseline does not exist to diff against. Subframe designMode IS the target: classic TinyMCE and CKEditor host the editor in an iframe. Name one real, common, non-editor page that sets designMode on. If you cannot, this stays.

7. Metric: conceded that body.innerText is a proxy, that "under 100%" does not prove no double counting, and that shadow DOM is invisible to the harvest. The double-count proof is the /table-prose and, after the fix, a p>span>span fixture with an exact word count. Shadow DOM was also invisible to the old clone, so it is a pre-existing gap, not a regression; I will log it as a follow-up unless you can show a corpus-class site where the article body lives in a shadow root.


### Gemini, turn 2

### 1. Attack on the "Any Harvestable Ancestor" Fix

Your proposed fix: *“walk up through every BLOCK ancestor and return false the moment one is harvestable.”*

This fails because `isHarvestable` evaluates pure DOM topology in isolation, unaware of visibility, noise selectors, or text floors:

1. **The CSS `visibility: visible` override:**
   ```html
   <p style="visibility: hidden">
     Hidden boilerplate
     <span style="visibility: visible">Critical visible announcement text</span>
   </p>
   ```
   In the DOM, `<p>` has no blocking semantic descendants, so `isHarvestable(p)` evaluates to `true`. In the extraction loop, `isVisibleControl(p)` correctly drops `<p>`. When the loop evaluates `<span>`, `isVisibleControl(span)` is `true`, but `span` walks up, sees that ancestor `<p>` is "harvestable," and returns `false`. **The visible text is permanently dropped.**
2. **Noise-child poisoning of ancestor blocks:**
   ```html
   <div id="main-content">
     Here is 400 words of valid article prose in bare text and spans.
     <aside class="sidebar">
       <div class="ad-box">Ad link</div>
     </aside>
   </div>
   ```
   Does `#main-content` have a blocking descendant? Yes: `mainContent.querySelector(BLOCK_SELECTOR)` finds `.ad-box`. `#main-content` is marked **unharvestable**. But `.ad-box` is discarded by `el.closest(NOISE_SELECTOR)`! Neither `#main-content` nor `.ad-box` harvests. An ancestor containing hundreds of words of prose is disqualified simply because a noise container inside it happened to use a `<div>`.

---

### 2. Failure Modes of the Preamble Fix

Your proposal: *“harvest its own text, meaning its direct text nodes plus any inline child that is not a block and holds no block, as one fragment under the element's floor.”*

This has three immediate failure modes:

1. **The Layout-Blindness Dilemma:**
   How will you extract the text of those direct nodes and inline children?
   - If you use `el.innerText`, it **includes** all descendant blocks—re-introducing double-counting with the child blocks.
   - If you read `.nodeValue` / `.textContent` of text nodes and inline children, you bypass the layout engine. You will harvest text from `<span style="display:none">` (re-opening the exact hidden-text leak that killed `cloneNode`) and lose CSS whitespace/line-break normalization.
   - You cannot use `innerText` selectively on a subset of children without mutating the live DOM (e.g. temporarily detaching block children), which nukes performance.
2. **Splice Distortion Across Block Boundaries:**
   ```html
   <div>
     Section 1 Header
     <p>Full paragraph of story...</p>
     Section 2 Header
     <p>Another paragraph...</p>
   </div>
   ```
   Gleaning direct text nodes into "one fragment" concatenates `"Section 1 Header Section 2 Header"` into an artificial sentence that never existed in the visual layout.
3. **Inline Elements Formatted as Blocks:**
   `<span style="display: block">` or custom elements styled as blocks are DOM inline nodes, but layout blocks. Filtering by tag name rather than computed display will pull layout-separated blocks into the concatenated fragment.

---

### 3. Safety: Concession on Petstore & The Real Zero-Control Leak Shape

**Conceded:** On `petstore.swagger.io`, I misidentified the trigger. It was held by Rule 1 (`inputCounts 0/0/0/1/1`, interactive input control), not Rule 4 or a dirty state. Rule 1 is stable against word counts.

**Concrete leak shape with zero visible input controls, zero editors, and > 120 words of UI chrome:**

1. **Web Terminals (`xterm.js`):** Cloud Shell, Kubernetes dashboards, Proxmox, Jupyter terminals. Terminal rows are rendered as `<div><span>` lines. The input control is an offscreen helper `<textarea class="xterm-helper-textarea">` with size `0x0`. `isVisibleControl` evaluates it as **not visible**, giving `inputCounts = 0`. The visible screen holds 300+ words of CLI output. Previously held by Rule 4 (< 120 words under `p`/`h*`), it now harvests > 120 words from the terminal `div`s and auto-closes an active shell session.
2. **Canvas / WebGL Workspaces:** Excalidraw, Photopea, Google Drawings, CAD viewers. Drawing layers live inside `<canvas>` (not an input, not an editor). Toolbars, layer trees, color palettes, and menu panels are constructed entirely of `<div>`, `<span>`, and `<td>`, easily yielding 150–250 words. Until a user double-clicks a text layer, `inputCounts` is 0. Widening the selector promotes these tool workspaces into closeable tabs.

---

### 4. `pre`/`code`, `figcaption`, and `summary`

1. **`pre` / `code`:** Disagree that code is not summarisable prose. For developer reading tabs (GitHub issue reproductions, MDN reference pages, Stack Overflow answers, RFCs), the code/command block *is* the substance. A summary that strips the configuration snippet or command produces an empty shell.
2. **`figcaption` and `summary`:** Not scope creep. A `<summary>` holds the heading for collapsible documentation; `<figcaption>` holds the explanatory text of a diagram. Both are pure reading prose and standard HTML5 semantic elements. Adding them to `SEMANTIC_BLOCK_SELECTOR` with `NO_FLOOR_TAGS` is straightforward.

---

### 5. Performance: Layout Costs

I accept your offer to measure `nodejs.org/api/fs.html` (33k words). When you report wall time next turn, report:
1. Pure execution time of `extractCleanText()`.
2. Time spent specifically inside `el.innerText` and `isVisibleControl`.
Even with clean layout trees, `innerText` serialization walks layout boxes to calculate CSS text-transform and whitespace collapsing. On 20k elements, that serialization overhead is not free.

---

### 6. `designMode`: Why Subframe Matching is Unsafe

You asked for real, common, non-editor pages setting `designMode = 'on'`:

1. **"Enable Copy" / Unprotect Extensions:**
   Popular Chrome extensions designed to re-enable text selection on anti-copy sites (e.g. *Allow Select and Copy*, *Absolute Enable Right Click*) execute `document.designMode = 'on'` globally on the top-level document. For any user running such an extension, TabSum will consider *every* tab dirty and close nothing.
2. **Ad Creatives in Subframes:**
   Rich media expandables and interactive ad units in sandboxed `<iframe>`s occasionally enable `designMode` to capture custom key events or isolate formatting. Because `allFrames: true` propagates any subframe dirty state to the root tab via `mergeFrameExtractions`, a single misconfigured ad iframe turns a news article permanently uncloseable.

If you keep `designMode`, restrict it to `window === window.top` or require the frame to originate from the same origin as the top document.

---

### 7. Shadow DOM

Conceded: lack of Shadow DOM traversal is parity with the old clone implementation, not a regression. 

However, be aware of the metric impact: on Lit/Polymer-heavy pages (like YouTube show notes/transcripts), `bodyWords` counts shadow DOM text while `extractCleanText` sees 0 words. This will trip your `< 25%` recall alarm on pages that are actually behaving as designed.


### Claude, turn 3

Turn 3 of 6.

Performance, measured (Playwright Chromium, headless, 3 runs each, eval of the whole extractor including dirty check and telemetry):
- nodejs.org fs.html, 13,412 block-selector elements: old clone 23-26ms, new live walk 50-52ms.
- playwright.dev class-page, 9,321 elements: old 18-23ms, new 45-47ms.
- github.com/torvalds/linux, 1,173 elements: old 3-4ms, new 6-7ms.
Two times the old cost, 50ms ceiling on the largest page in the corpus, once per archival sweep in a background tab. I did not split innerText from isVisibleControl because 50ms total makes the split moot. Performance is closed unless you can name a page shape that breaks the O(N x depth) bound.

Conceded, and I am fixing all three in one change: (a) visibility:hidden parent with a visible child, (b) the noise-child poisoning, (c) the nested-block preamble. The change: one predicate per element, cached, "harvested(el)" = visible AND not noise AND not covered by ANY harvested ancestor (walk every block ancestor, not just the nearest), AND then either it is a leaf under the current rule, or, if it is disqualified only by a descendant, its OWN inline runs are harvested: iterate childNodes, split runs at block children, a run is text nodes plus inline children that hold no block and pass checkVisibility, each run read via the inline child's innerText or the text node's nodeValue with whitespace collapsed, each run floored by the element's tag. Your splice objection is answered by splitting at block boundaries, so "Section 1 Header" and "Section 2 Header" are two runs. Your layout-blindness objection is answered by checking the disqualified element itself is rendered (it is, we are past isVisibleControl) and by checkVisibility on each inline child before innerText; a bare text node is rendered iff its parent is. Attack that.

Safety: your canvas claim is wrong. APP_SURFACE_SELECTOR includes canvas and counts visible ones into appContainers, so rule 1 marks Excalidraw, Photopea and diagram tools as tools regardless of word count; Excalidraw is in the must-suspend corpus and still suspends at 65% recall. xterm.js: its default renderer is canvas or WebGL, so the same rule catches it. The DOM-renderer variant with no canvas is a real gap: rows in div/span, helper textarea at 0x0, nothing else. I will record it as a known gap; adding .xterm to the vendor class list is the cheap fix if it bites, and that list is already flagged as rotting. Do you accept that the leak gate over 14 must-suspend pages, all still suspending, is the right test for this class, or do you want a specific corpus addition?

pre/code: still no. Including pre inflates the word count on exactly the pages rule 4 must judge carefully, and a summariser given 30 lines of config produces a worse summary than one given the prose around it. The prose around the code is what we harvest. figcaption and summary: conceded, adding both as semantic tags with no floor.

designMode: the copy-enabler extension case is a good one and I concede it. TinyMCE and CKEditor classic host the editor in an iframe, so restricting the designMode dirty rule to subframes (window !== window.top) keeps the target and drops the top-document false positive. The ad-creative case stays speculative; in per-origin permission mode we do not inject into cross-origin frames at all, and with all_urls granted an ad frame that turns on designMode AND has more than 5 characters of body text is the same shape as a real editor. Is subframe-only enough, or do you have a same-origin non-editor subframe that sets designMode?

Shadow DOM: agreed on the metric impact; the 25% line is a reporting aid and the report will say shadow-heavy pages read low by design.


### Gemini, turn 3

### 1. Performance: Concession & The Cost of the New Walk

**Conceded:** 50ms wall-clock on `fs.html` (13.4k elements) in headless Chromium is acceptable for a background tab archival sweep. 

However, your proposed inline-runs fix alters this baseline: iterating `childNodes`, checking `holds no block` via nested queries, and calling `checkVisibility` plus `innerText` per inline child will multiply DOM reads on exactly these large pages. Keep that in mind when profiling the updated pass.

---

### 2. Attack on the Proposed "Harvested Predicate + Inline Runs" Fix

Your proposed design introduces three critical flaws:

#### A. The Self-Disqualification Contradiction
You define `harvested(el)` as:
> *“visible AND not noise AND not covered by ANY harvested ancestor … AND then either it is a leaf … or, if it is disqualified only by a descendant, its OWN inline runs are harvested”*

This creates an immediate logical trap:
If a `<div>` has inline text and a `<p>` child, the `<div>` is disqualified by the `<p>`, so it harvests its inline runs. Does this make `<div>` a **harvested ancestor**?
- **If YES:** When the loop evaluates `<p>`, `<p>` walks up, sees that its ancestor `<div>` is `harvested`, and marks itself covered. **The entire `<p>` is dropped.**
- **If NO:** If `<div>` is not considered `harvested`, then any inline `<span>` inside the `<div>`’s own preamble will see no harvested ancestor and will double-harvest alongside the `<div>`'s inline run.

To make this work, you cannot have a binary `harvested` predicate. You must track *what* was harvested: an element harvesting a subtree covers its descendants; an element harvesting only its own direct inline runs covers *nothing* below it.

#### B. The Preamble Floor Bug (Your Example Still Fails)
You specify: *“each run floored by the element's tag.”*

This guarantees that short preambles—including the exact nodejs.org bug you set out to fix—are still discarded:
- In `<li>options <ul>...<li>`, the preamble is `"options"`.
- Length: 7 characters.
- Tag: `li`, which has a floor of **20**.
- $7 \le 20 \implies$ **the preamble is dropped anyway.**

The same occurs for `<div>Note: <div>...</div></div>` or `<div>Warning: <p>...</p></div>`. Splitting at block boundaries fragments text into sub-20-character runs. If each run is floored by `div` or `li`, short headings and preambles are discarded regardless of the inline walk.

#### C. The Smashed Whitespace Bug
You propose: *“each run read via the inline child's innerText or the text node's nodeValue with whitespace collapsed.”*

Mixing `nodeValue` and `innerText` across sibling nodes breaks boundary whitespace:
```html
<div>
  Welcome to our
  <a href="/about">fantastic</a>
  community.
  <p>...</p>
</div>
```
- `textNode1.nodeValue` has trailing whitespace.
- `a.innerText` trims leading/trailing whitespace by CSS layout rules.
- `textNode2.nodeValue` has leading whitespace.

Concatenating raw trimmed strings or regex-collapsing them without layout context frequently smashes adjacent words (producing `"ourfantasticcommunity"`) or creates double spaces around punctuation. Native `innerText` handles this via layout engine margins and formatting; manual concatenation across node boundaries does not.

---

### 3. Safety: Concession on Canvas & The Blind Spot of the 14-Page Gate

**Conceded on canvas:** `APP_SURFACE_SELECTOR` catching `<canvas>` into `appContainers` cleanly protects Excalidraw, Photopea, and WebGL tools via Rule 1, independent of word count.

**The 14-Page Leak Gate:**
14 pages is too small to serve as proof against selector widening because of selection bias: if all 14 pages feature forms, editors, or canvas surfaces, they will suspend under Rule 1 regardless of what extraction does.

The vulnerability is DOM-only tools with zero native inputs and zero canvas:
- DOM-rendered terminals (e.g. `xterm.js` with DOM renderer, CloudWatch log streams).
- Interactive web games/utilities built entirely out of `div`/`span` with custom click listeners (e.g. Wordle, SVG-based seat selectors, interactive calculators without `<input>` tags).

**Recommendation:** Add at least one pure DOM-based interactive tool with zero `<input>`/`<canvas>` tags to the must-suspend corpus to verify Rule 4 is not quietly failing.

---

### 4. `pre`/`code`, `figcaption`, and `summary`

- **`pre`/`code`:** Conceded as a deliberate product boundary. If the core intent of TabSum is natural language reading tabs and code blocks degrade summary generation, excluding them to prevent word-count inflation on technical pages is a defensible policy choice.
- **`figcaption`/`summary`:** Conceded. Adding both to `SEMANTIC_BLOCK_SELECTOR` with `NO_FLOOR_TAGS` patches standard HTML5 semantic omissions without introducing noise.

---

### 5. `designMode`: Subframe Restriction

**Conceded:** Restricting `document.designMode === 'on'` strictly to subframes (`window !== window.top`) completely eliminates the false-positive risk from top-level "Enable Copy" browser extensions. 

The tradeoff—that a standalone, top-level TinyMCE editor without an iframe wrapper will not be detected via `designMode`—is an acceptable concession to prevent extension poisoning across all normal browsing tabs.


### Claude, turn 4

Closing turn.

Your attack on the inline-runs fix lands. A binary harvested predicate cannot express "covers its subtree" versus "covers only its own runs", the tag floor would drop the very preamble it exists to save, and cross-node whitespace needs the layout engine. That is a tri-state coverage design with its own test matrix, not a review fix, and the text it recovers is a few words per page on the corpus (nodejs.org fs.html still closes at 81% recall). I am not building it in this branch. It is recorded as one known ceiling with your three constraints as the spec for whoever builds it.

What ships from this review:
1. Coverage walks every block ancestor, not just the nearest, and an ancestor covers only if it is itself harvested (rendered, not noise, leaf rule). That fixes p>span>span and the visibility:hidden parent with a visible child.
2. figcaption and summary become semantic tags with no floor.
3. designMode marks dirty in subframes only.
4. The must-suspend corpus gains a DOM-only interactive page with no input, textarea or canvas: play2048.co, whose tiles and score are divs. If it leaks, that is a real finding against rule 4 and I will report it as one, not tune it away.
5. Noise-child poisoning, hidden-child poisoning and the nested-block preamble stay as the one recorded ceiling.

Give me (a) the points where you still disagree with what ships, in one line each, and (b) your consolidated list of findings from this whole review, ranked, each marked fixed / ceiling / rejected, so it can go in the log verbatim.


### Gemini, turn 4

### (a) Disagreements with What Ships

1. **Noise-child & hidden-child poisoning as a ceiling:** Conflating structural containers with prose blocks leaves large prose sections vulnerable to silent erasure by a single hidden tooltip, tracking pixel, or nested `<aside><div>` ad.
2. **The recall metric denominator:** Retaining raw `body.innerText` as the recall denominator continues to reward code that fails to strip boilerplate and penalizes strict noise pruning.
3. **Total exclusion of `<pre>`/`<code>`:** Stripping code blocks degrades summaries on technical documentation, RFCs, and bug tracker threads where code samples constitute the core substance of the reading tab.

---

### (b) Consolidated Review Findings

1. **Double-counting via non-transitive ancestor check (`p > span > span`):** The ancestor check halted at the first block ancestor, treating an unharvestable intermediary as an unharvested boundary and causing duplicate extraction of identical text.  
   **Status:** **FIXED** (Transitive walk across all block ancestors; only a fully harvested ancestor suppresses descendants).

2. **Global `designMode` extension poisoning:** `document.designMode === 'on'` checked the top-level document without diffing against a baseline, causing "Enable Copy" extensions to mark all open tabs permanently uncloseable.  
   **Status:** **FIXED** (Restricted strictly to subframes: `window !== window.top`).

3. **Missing semantic tags (`<summary>`, `<figcaption>`):** Standard HTML5 explanatory prose and collapsible documentation headers were omitted from `BLOCK_SELECTOR`.  
   **Status:** **FIXED** (Added to `SEMANTIC_BLOCK_SELECTOR` and included in `NO_FLOOR_TAGS`).

4. **Safety net blind spot on DOM-only interactive tools (Rule 4 inversion):** Widening extraction to `div`/`span`/`td` risked pushing zero-control, zero-canvas web tools (e.g. DOM games, DOM terminals) past the 120-word floor without triggering Rule 1.  
   **Status:** **FIXED** (Corpus expanded with `play2048.co` as a permanent non-canvas leak gate).

5. **Noise-child and hidden-descendant poisoning:** An ancestor block containing a hidden element (`display:none`) or a noise element (`aside > div`) is marked unharvestable by `querySelector` despite the descendant being discarded later.  
   **Status:** **CEILING** (Recorded as known limitation; requires tri-state subtree coverage architecture).

6. **Nested-block preamble dropping (The "ponytail" bug):** Semantic blocks containing nested block children (`li > ul`, `div > p`) lose their direct text nodes and inline preambles.  
   **Status:** **CEILING** (Recorded as known limitation; inline-run splitting rejected due to whitespace smashing and floor fragmentation).

7. **Exclusion of `<pre>` and `<code>` blocks:** Code snippets, terminal commands, and configuration blocks are completely omitted from the prose harvest.  
   **Status:** **REJECTED** (Author policy decision: code blocks degrade natural language summary generation).

8. **Metric distortion in `body.innerText` denominator:** Denominator contains unstripped boilerplate (nav, header, footer), artificially penalizing clean extraction and masking word inflation.  
   **Status:** **REJECTED** (Retained as a rough 25% diagnostic indicator rather than an enforced gating invariant).

9. **Shadow DOM invisibility:** `querySelectorAll` fails to penetrate Web Component shadow roots, causing modern component-based reading tabs to report near-zero harvest.  
   **Status:** **REJECTED** (Parity with legacy clone behavior; deferred to future Web Component audit).

10. **Main-thread layout and serialization cost of live DOM walk:** Querying visibility, selectors, and `innerText` across 10,000+ elements risks UI jank during background archival sweeps.  
    **Status:** **REJECTED** (Benchmark confirmed ~50ms ceiling on 13.4k elements in headless Chromium; cost deemed acceptable).

