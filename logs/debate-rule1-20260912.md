# Cross-model debate: closure-policy rule 1 (Claude Opus 5 vs Gemini via agy 1.2.1)

**Date**: 2026-09-12  **Turns**: 6 (3 each)
**Seeded with**: telemetry baseline 38.1% close / 61.9% suspend over 42 reachable URLs (logs/closure-ratio-2026-09-12.md)

---

## Turn 1 — Claude

You are an adversarial architecture reviewer. I am Claude, working on a Chrome extension called TabSum. Disagree wherever you actually disagree; concede plainly where I'm right. We have 6 turns total (3 each). No recaps, no pleasantries — argument only. At the end I will ask you for the points of remaining disagreement and a consolidated verdict.

CONTEXT

TabSum auto-closes tabs the user has neglected. It first extracts the page content, summarizes it into an IndexedDB "knowledge wiki", and only then closes or suspends the tab. The product thesis is that closing is the point: a tab suspender that merely freezes tabs into favicon slivers has not solved tab overload. Suspending instead of closing is the safe fallback, not the goal.

The decision of close-vs-suspend runs through a pure module, src/shared/closure-policy.js. Here is the exact function under scrutiny. It receives telemetry scraped from the live DOM by an injected extractor:

export function classifyClosureSafety({ inputCounts = {}, urlParts = {}, wordCount = 0 } = {}) {
  const { textareas = 0, selects = 0, passwords = 0, appContainers = 0, otherInputs = 0 } = inputCounts;
  const { pathname = '', hash = '', search = '' } = urlParts;

  // 1. Real interactive controls (forms; lone search/email inputs are exempt upstream)
  if (textareas > 0 || selects > 0 || passwords > 0 || appContainers > 0 || otherInputs >= 3) {
    return { tier: 'suspend_only', reason: 'Contains form or interactive input controls' };
  }
  // 2. Stateful URL path or client-side hash routing
  if (hash.length > 3 || pathname.includes('checkout') || pathname.includes('cart') || pathname.includes('account')) {
    return { tier: 'suspend_only', reason: 'Stateful URL path or client-side hash route' };
  }
  // 3. Multi-param search result listings
  if (search.includes('&') && (search.includes('q=') || search.includes('query=') || search.includes('filter='))) {
    return { tier: 'suspend_only', reason: 'Complex search/filter query state' };
  }
  // 4. Content density / readability confidence
  if (wordCount < 120) {
    return { tier: 'suspend_only', reason: 'Short or low-confidence content' };
  }
  return { tier: 'safe_to_close', reason: 'Pure stateless reading article' };
}

The extractor builds inputCounts like this. Note what it already excludes:
  const candidateInputs = all <input> elements, EXCLUDING type hidden/submit/button/reset, and EXCLUDING inputs that look like search boxes
  otherInputs = candidateInputs, further excluding type="email"
  passwords   = candidateInputs filtered to type="password"   (so passwords are ALSO counted inside otherInputs)
  textareas   = document.querySelectorAll('textarea').length          — raw count, no emptiness or visibility check
  selects     = document.querySelectorAll('select').length            — raw count
  appContainers = count of [role="dialog"], [role="application"], [contenteditable="true"], [role="textbox"], .monaco-editor, .ProseMirror, .ql-editor

Separately, and BEFORE any of this, the extractor computes an `isDirty` boolean (unsaved textarea content, touched form inputs, file uploads, rich-text drafts, playing media). If isDirty is true the service worker aborts entirely — the tab is neither closed nor suspended nor even archived. So dirtiness is already handled upstream by a separate mechanism. classifyClosureSafety is NOT the unsaved-data guard; it runs only on pages already established to be clean.

THE MEASUREMENT I JUST RAN

There was an open empirical question: under normal browsing, what fraction of candidate tabs land in suspend_only? Prior reasoning predicted that if it exceeded ~70%, the auto-close thesis fails in practice, and that the likely culprit would be rules 2 and 3 (the coarse path/hash/search substring matches).

I built a harness that visits 50 real URLs in headless Chromium, runs the REAL extractor via page.evaluate, and feeds the telemetry to the REAL classifier. Results over 42 reachable URLs:

  safe_to_close: 16  (38.1%)
  suspend_only:  26  (61.9%)

Breakdown by the rule that caught each held-back tab:
  Rule 1, interactive controls:        21
  Rule 4, wordCount < 120:              5
  Rule 2, path/hash:                    0
  Rule 3, search query state:           0

So the prediction was right about the outcome and wrong about the mechanism. Rules 2 and 3 caught nothing. Rule 1 is essentially the whole policy.

Representative rows (inputCounts shown as textareas/selects/passwords/appContainers/otherInputs):

  en.wikipedia.org/wiki/IndexedDB          641 words    0/0/0/0/16   suspend_only
  nodejs.org/docs/latest/api/fs.html     33142 words    0/0/0/0/22   suspend_only
  docs.python.org/3/library/asyncio-task  5054 words    0/9/0/0/1    suspend_only
  pkg.go.dev/net/http                    12269 words   17/3/0/0/2    suspend_only
  developer.chrome.com/docs/.../tabs      7127 words    0/0/0/1/3    suspend_only
  developer.mozilla.org/.../fetch          572 words    0/0/0/0/2    safe_to_close
  playwright.dev/docs/api/class-page     40527 words    0/0/0/0/0    safe_to_close

I then enumerated Wikipedia's 16 inputs individually. Every one is site chrome: eight `vector-*-dropdown-checkbox` CSS-only disclosure toggles that drive hamburger/TOC/language menus via the checkbox hack, and eight radio buttons for theme, font size and content width preferences. Zero user-authored state. A 33,000-word Node.js API reference is being held open by a theme switcher.

MY PROPOSED FIX

Rule 1 is asking "does this page contain controls?" when it should ask "has the user invested state here?" Concretely:
  (a) Exclude checkbox and radio from otherInputs unless `el.checked !== el.defaultChecked` — i.e. count them only if the user actually toggled one away from the page's default.
  (b) Stop counting empty textareas: require `el.value.trim().length > 0`, since pkg.go.dev's 17 textareas are offscreen copy-to-clipboard buffers.
  (c) Stop counting `select` elements whose selectedIndex still equals the default, for the same reason docs.python.org's 9 version pickers shouldn't matter.

Is my fix right, wrong, or insufficient? Attack the reasoning, not the formatting.

## Turn 1 — Gemini

You are right on the empirical diagnosis, but your proposed fix is architecturally incoherent and breaks your own domain model.

### Where you are right
You correctly identified that Rule 1 is currently the entire policy and that it is failing because of site chrome, not user forms. A 33,000-word Node reference or Wikipedia article held open by theme radios and CSS-hack menu toggles directly violates TabSum's core product thesis.

### Where you are wrong

#### 1. You are turning `classifyClosureSafety` into a redundant shadow of `isDirty`
You explicitly established that `isDirty` already runs upstream and aborts the entire pipeline if the user touched inputs or entered unsaved data. 

If `isDirty` works, then by definition, **no page reaching `classifyClosureSafety` has user-modified inputs**. 
- If a user toggled a radio or changed a `<select>`, `isDirty` should have aborted. If it didn't, why would TabSum *suspend* rather than abort? 
- If `isDirty` *did* catch it, then on every single tab reaching this function, `checked !== defaultChecked` and `selectedIndex !== defaultIndex` will **always be false**.

Your proposed fix effectively zeroes out Rule 1 across the board. You aren't refining the rule; you are quietly deleting it while pretending it's still filtering.

#### 2. The "Clean Application" blind spot
Rule 1's actual architectural purpose in a close-vs-suspend classifier is not to detect *dirtiness* (loss of user keystrokes), but to detect **tool vs. document semantics**. 

TabSum's thesis is:
* **Reading articles** can be closed because their knowledge was extracted into IndexedDB and the raw URL reconstitutes the document.
* **Interactive applications / utilities** (an empty mortgage calculator, a flight search form, a blank Jira ticket modal, a SQL console) cannot be summarized into a meaningful wiki entry and are opened to be *used*, not *read*. 

If you say "ignore all controls that are still in their default state," you classify every untouched web tool, blank form, and search console as `safe_to_close`. TabSum will close them, write a 130-word garbage wiki summary of an empty form, and destroy the user's workspace.

#### 3. Your DOM heuristics are technically brittle
* **Copy-to-clipboard textareas (`pkg.go.dev`):** You assume copy buffers are empty. In practice, many clipboard fallbacks and syntax highlighters initialize the `<textarea>` with the snippet text itself. `el.value.trim().length > 0` will evaluate to `true` on documentation containing code snippets, leaving them stuck in `suspend_only`.
* **SPA Hydration:** `defaultChecked` and `defaultValue` reflect HTML initial attributes. Modern component libraries (React, Vue, Lit) frequently hydrate or re-render elements dynamically such that DOM properties and `default*` attributes diverge without any user interaction, or match even after synthetic events.
* **Global DOM vs. Article Scoping:** Your fundamental problem is not whether a checkbox is toggled; it is that your extractor is querying the raw `document` root. Wikipedia's toggles live in `<nav>` and `#mw-navigation`. Node's live in `<header>`. 

### The verdict on your fix
Your fix is wrong. You are attempting to fix an element **scoping and visibility** problem by mutating the classifier into a second, degraded state-tracking guard. 

If you want to distinguish chrome from actual interactive applications, the discriminator is not `el.defaultChecked`—it is DOM ancestry (inside `<main>` / `<article>` vs. `<nav>` / `<header>`), computed visibility (`offsetParent !== null`), and form container semantics. 

Defend why you believe user mutation (`!== defaultChecked`) belongs in a post-`isDirty` classifier instead of scoping telemetry to the extracted content body.

---

## Turn 2 — Claude

Your point 2 lands and I concede it: "has the user invested state" is the wrong question, "is this a document or a tool" is the right one. An untouched mortgage calculator must not be closed and my fix would have closed it. I withdraw the framing.

Your point 1 is factually wrong, and the repo says so in a comment I should have shown you. checkIsDirty does NOT check checkboxes, radios, or selects. Here is its actual exclusion list, verbatim:

    // Compare each user-editable control with its page-load default (search bars excluded).
    // Not checked, because page scripts change them without the user and would block every close:
    // checkboxes/radios (Wikipedia's menus and appearance prefs are JS-set checkboxes) and
    // color/range (implicit non-empty defaults look like edits).
    const valueTypes = new Set(['text','email','url','tel','password','number','','date','datetime-local','month','time','week']);

Selects are never examined at all. So `checked !== defaultChecked` is not always-false downstream, and my fix was not a no-op shadow of isDirty. Note what this comment means though: a previous author already hit the Wikipedia problem, diagnosed it correctly, and fixed it in checkIsDirty by excluding toggles — and then the classifier's inputCounts went on counting them anyway. The codebase already knows the answer in one function and ignores it in the other.

Now the part that matters. I did not argue this, I measured it. I implemented both your fix and mine and ran them against the failing pages plus three controls that MUST stay suspend_only. Rule 1 trips when ta>0 || sel>0 || other>=3.

Variant A = mine (count toggles only if checked!==defaultChecked; textareas only if non-empty; selects only if moved off default).
Variant B = yours (scope to content: drop anything matching extractCleanText's existing noise list — nav, header, footer, aside, form, [role=banner], [role=navigation], .sidebar, cookie/consent selectors — and drop anything not visible).

  page                                    raw           variantA      variantB
  en.wikipedia.org/wiki/IndexedDB         16 -> susp    3 -> susp     0 -> CLOSE
  nodejs.org/docs/latest/api/fs.html      22 -> susp    0 -> CLOSE    22 -> susp
  docs.python.org/.../asyncio-task        9sel -> susp  6sel -> susp  0 -> CLOSE
  www.sqlite.org/lang_select.html         1sel -> susp  1sel -> susp  0 -> CLOSE
  pkg.go.dev/net/http                     17ta -> susp  17ta -> susp  17ta -> susp
  --- controls that MUST NOT close ---
  jsonformatter.org                       susp          susp          0 -> CLOSE
  news.ycombinator.com/login              4 -> susp     4 -> susp     0 -> CLOSE

Read those last two rows. Your scoping fix CLOSES A LOGIN PAGE. It closes it because extractCleanText's noise list contains `form`, and every input on HN's login page lives inside a <form>. Stripping `form` is correct when you are extracting prose and catastrophic when you are counting inputs. The one existing artifact you'd reuse for scoping is precisely the artifact that must not be reused.

Three more things the measurement says that neither of us predicted:

1. Your fix fails Wikipedia's sibling case. nodejs.org's 22 checkboxes are NOT in nav/header — they're inline in the content body (collapsible API sections). Ancestry can't see them. Mine kills them at 0 because none are toggled.
2. My fix fails Wikipedia. 16 drops to 3, and the threshold is `>= 3`, so it still suspends. The three survivors are the theme/font-size/width radios that MediaWiki sets from a stored preference at load — exactly the "page scripts change them without the user" case the comment above warned about. You were right that default* diverges without user action; I was wrong that it wouldn't.
3. regex101.com — a genuine interactive tool — is classified safe_to_close by rule 1 TODAY, raw, before either fix. It survives only because rule 4 catches it at 68 words. The tool-protection you credit to rule 1 is actually being done by the word-count floor.

So: Variant A fixes the inline-content case and fails the JS-set-preference case. Variant B fixes the chrome case and fails catastrophically on forms. Neither is sufficient, and they fail on disjoint sets.

Given that `form` ancestry is the single strongest positive signal for "tool" and the noise list treats it as the strongest negative signal — defend what the discriminator should actually be. And tell me whether rule 1 should survive at all, or whether the honest reading of row 3 is that word count plus form-presence is doing all the real work and rule 1's input-counting is superstition.

## Turn 2 — Gemini

### Concession on `checkIsDirty`
I concede point 1 plainly. Your code excerpt proves `checkIsDirty` deliberately exempts checkboxes, radios, and selects. 

However, that comment reveals the exact architectural failure of the pipeline: `checkIsDirty` bypassed those controls because "page scripts change them without the user," dumping them downstream into `classifyClosureSafety`, which blindly counted them as high-stakes form controls. The two modules have had inverted assumptions from day one.

---

### Why your "Variant B closes login" rebuttal is a strawman
You evaluated Variant B by borrowing `extractCleanText`'s text-scrubbing blacklist. Of course stripping `<form>` drops forms! That list exists to strip non-prose elements when mining sentences for an IndexedDB wiki. Using an article-prose blacklist to scope interactive controls is an implementation self-own, not a refutation of scoping.

Nevertheless, your measurement exposed a critical architectural reality: **`<form>` ancestry is a terrible discriminator in modern web architecture.**
1. **False Positives:** Static documentation and blogs are littered with `<form>` elements (newsletter signups, Algolia docsearch, feedback widgets). If `<form>` ancestry triggers `suspend_only`, you've just moved the threshold from "16 checkboxes" to "1 newsletter form."
2. **False Negatives:** Modern web applications (Linear, Figma, Google Docs, Regex101) rarely use `<form action="...">`. They mount event listeners on `div`s, `contenteditable` trees, or canvases.

---

### Is Rule 1 "superstition"?
No, but **your current bucket definitions are superstition.** You are aggregating apples and plutonium into a single integer threshold (`otherInputs >= 3`).

Let's dissect the components of Rule 1:

1. **`passwords > 0` is ironclad.** A password field is an unambiguous marker of authentication or credential entry. That is why HN login survived Variant A. It should never be grouped with generic inputs.
2. **`selects > 0` is an obsolete signal.** On the modern web, native `<select>` elements are almost exclusively site chrome: language pickers, documentation version switchers (Python, SQLite), and pagination dropdowns. Real application forms use custom ARIA listboxes (`[role="listbox"]`). Counting raw `<select>` elements in 2026 is pure noise.
3. **`textareas > 0` is broken only by dead DOM.** `pkg.go.dev`'s 17 textareas are hidden clipboard shims. Why check `value.trim().length` when the browser has layout engines? If an element has `offsetParent === null` or `el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) === false`, it is non-rendered infrastructure, not an editor. A *visible* textarea is an undeniable data-entry tool.
4. **`otherInputs >= 3` is fundamentally broken because it counts UI toggles.** Checkboxes and radios on the modern web are CSS disclosure hacks (Node, Wikipedia) and theme pickers.

---

### The danger of relying on Word Count for Tools (Row 3 fallacy)
Your claim that "word count is doing all the real work" because of Regex101 is classic survivorship bias. 

Regex101 survived because it happens to be terse (68 words). But consider:
- A Swagger/OpenAPI UI testing console (5,000 words of API descriptions + interactive "Try it out" controls).
- A Grafana or Datadog dashboard (hundreds of words of panel titles and metrics).
- An AWS / GCP console page (dense documentation + resource creation forms).
- An interactive SQL tutorial (Postgres tutorial with embedded runner).

Every single one of these has >120 words. If you eliminate Rule 1 and rely on `wordCount < 120`, TabSum will auto-close every single one of them.

---

### What the Discriminator Must Actually Be

Rule 1 must not be abolished; it must be rebuilt around **interaction capability, not DOM tags**:

1. **Rendered Visibility is Mandatory:** Filter every input/textarea through `el.checkVisibility()`. Non-rendered clipboard textareas (`pkg.go.dev`) and hidden inputs drop to zero instantly without string length guesses.
2. **Decouple Data-Entry from Layout Toggles:**
   - Drop checkboxes and radios from `otherInputs` entirely unless they have an explicit `form` owner that also contains a submit button (`button[type="submit"]` or `input[type="submit"]`). A checkbox driving a CSS accordion has no submit button.
   - Restrict `otherInputs` strictly to data-entry types: `text`, `number`, `date`, `tel`, `url`.
3. **Replace `selects > 0` with Form Association:** A `<select>` outside a submit-bearing `<form>` is site navigation (Python docs, SQLite). A `<select>` alongside a submit button is a form.
4. **Fix the Application Container Gap:** Regex101 slipped past Rule 1 because your `appContainers` regex lists `.monaco-editor` and `.ProseMirror`, but omitted `.cm-editor` (CodeMirror), `canvas`, and `[role="main"] [role="application"]`.

Defend whether you believe a `<select>` without a submit button or a visible layout box should ever hold a tab open.

---

## Turn 3 — Claude

I concede the Regex101 survivorship argument without reservation. Swagger UI at 5,000 words kills my "word count does the real work" claim outright, and I withdraw it. Rule 1 survives.

I implemented your variant C and measured it. Rule 1 becomes:
  textareas>0 || passwords>0 || apps>0 || selects>0 || (dataEntry+toggles)>=3
where every element must pass el.checkVisibility({checkOpacity,checkVisibilityCSS}); selects and toggles additionally require a submit-bearing form owner (el.form containing button[type=submit], input[type=submit], or a bare <button>); dataEntry is restricted to text/number/date/tel/url/email/password; appContainers gained .cm-editor, .CodeMirror and canvas.

  DOCS (want CLOSE)                          result
  en.wikipedia.org/wiki/IndexedDB            CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc789
  nodejs.org/docs/latest/api/fs.html         CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc31154
  docs.python.org/.../asyncio-task           CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc6476
  sqlite.org/lang_select.html                CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc5870
  pkg.go.dev/net/http                        CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc20925
  developer.mozilla.org/.../grid-template    CLOSE  ta0 pw0 app0 sel0 de0 tog0  wc728

  TOOLS (want suspend)
  news.ycombinator.com/login                 suspend  pw2 de4
  regex101.com                               suspend  app5 de1
  petstore.swagger.io                        suspend  app1 de1
  excalidraw.com                             suspend  app2
  amazon.com/gp/cart/view.html               CLOSE    (but rule 2 catches 'cart' — real policy suspends it; my probe ran rule 1 only)
  jsonformatter.org                          CLOSE    ta0 pw0 app0 sel0 de0 tog0 wc1137   <-- GENUINE MISS

6/6 on docs. The visibility gate alone killed pkg.go.dev's 17 clipboard textareas and nodejs's 22 inline checkboxes — no value-length string guessing needed, exactly as you argued. Your submit-bearing-form test cleared docs.python.org's 9 version selects and sqlite's picker while keeping HN login. You were right on every mechanism.

The one genuine miss is instructive and I want your read on it. jsonformatter.org went from ta=3 sel=2 raw to ta=0 sel=0 visible — its editor is an Ace instance whose backing textarea is off-screen. It falls through everything at 1,137 words. Adding .ace_editor to appContainers fixes this specific page, which is my concern: appContainers is now carrying the entire tool-detection load, and it is a hardcoded CSS-class allowlist — monaco, ProseMirror, quill, CodeMirror 5, CodeMirror 6, Ace, and whatever ships next year. That is a signal that rots on a schedule, and every rotted entry is a silently closed tool. Rule 1's other four terms are structural DOM semantics that will still be true in 2030; this one is a list of vendor class names.

Give me:
(a) the points where you still disagree with me, and
(b) the consolidated final verdict superseding both our proposals: the exact shape of rule 1, whether rules 2/3/4 change at all given they caught 0/0/5 of 26, and your answer on whether a class-name allowlist is an acceptable load-bearing signal or whether there is a structural alternative for detecting editor surfaces.

Be concrete and be brief. I am going to implement whatever survives this.

## Turn 3 — Gemini

### (a) Points of Remaining Disagreement

1. **The "vendor class list is rot" purism:** You view an editor class allowlist as an architectural failure. That is a mistake. The web has exactly five dominant virtualized editor engines: Monaco, CodeMirror (5 & 6), Ace, and Slate/Lexical/ProseMirror. Virtualized editors *deliberately* break semantic DOM (rendering only visible lines to off-screen capture textareas). Waiting for W3C semantics to catch up with Ace is how you close user tools. The pragmatic answer is a hybrid: standard semantic primitives first, backed by a tight engine regex.
2. **Rule 2 is a latent false-positive bomb, not dead code:** It caught 0 only because your test URLs lacked anchor tags. In the real world, users deep-link into docs (`#installation`, `#methods`, `#usage`). Under `hash.length > 3`, **every single deep-linked documentation page suspends**. 
3. **Over-coupling `dataEntry` to `el.form`:** You applied the submit-bearing `el.form` restriction to both toggles *and* `dataEntry`. Mortgage calculators, converters, and modern React registration flows rarely use `<form action>` or submit buttons—they bind `onChange` to state and submit via `fetch()`. Requiring `el.form` for checkboxes/selects is correct (they are ubiquitous chrome); requiring it for visible `text`/`number` fields reopens the empty-tool closing bug.

---

### (b) Consolidated Final Verdict

#### 1. The Exact Shape of Rule 1

```javascript
// Extract telemetry (run inside page context)
const isVisible = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

// Standard semantic editors + engine fallback for virtualized non-semantic DOMs
const hasEditorOrCanvas = () => {
  const semantic = document.querySelector(
    'canvas, [role="application"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
  );
  if (semantic && isVisible(semantic)) return true;

  const virtualizedEngine = document.querySelector(
    '.ace_editor, .monaco-editor, .cm-editor, .CodeMirror, .ProseMirror, .ql-editor'
  );
  return virtualizedEngine ? isVisible(virtualizedEngine) : false;
};

// Controls collection
const visibleInputs = Array.from(document.querySelectorAll('input, select, textarea')).filter(isVisible);

const passwords = visibleInputs.filter(el => el.type === 'password').length;
const visibleTextareas = visibleInputs.filter(el => el.tagName === 'TEXTAREA').length;

// Selects and toggles MUST belong to a form that can actually be submitted
const isSubmitForm = (form) => form && form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
const meaningfulSelects = visibleInputs.filter(el => el.tagName === 'SELECT' && isSubmitForm(el.form)).length;
const meaningfulToggles = visibleInputs.filter(
  el => (el.type === 'checkbox' || el.type === 'radio') && isSubmitForm(el.form)
).length;

// Raw data-entry inputs (never need an enclosing form)
const dataEntryTypes = new Set(['text', 'number', 'date', 'datetime-local', 'tel', 'url']);
const visibleDataInputs = visibleInputs.filter(el => dataEntryTypes.has(el.type)).length;
```

**The Evaluator:**
```javascript
if (
  passwords > 0 ||
  visibleTextareas > 0 ||
  hasEditorOrCanvas() ||
  meaningfulSelects > 0 ||
  (visibleDataInputs + meaningfulToggles) >= 3
) {
  return { tier: 'suspend_only', reason: 'Active interactive or editor controls' };
}
```

---

#### 2. Fate of Rules 2, 3, and 4

* **Rule 2 (Paths & Hash) — SURVIVES, BUT FIX HASH:**
  Keep the path tokens (`checkout`, `cart`, `account`). 
  **Patch the hash check:** A hash is only a client-side route if it **does not** match a DOM ID or anchor name.
  ```javascript
  const isDocAnchor = hash.length > 1 && !!document.getElementById(hash.slice(1));
  if ((hash.length > 3 && !isDocAnchor) || /checkout|cart|account/.test(pathname)) {
    return { tier: 'suspend_only', reason: 'Stateful URL path or client-side hash route' };
  }
  ```
* **Rule 3 (Search Params) — KEEP AS-IS:**
  Multi-facet search query state (`?q=...&filter=...`) represents exploratory session work. It costs nothing computationally and acts as a safe stopgap for search engine consoles.
* **Rule 4 (Word Count < 120) — KEEP AS-IS:**
  It caught 5 of 26 because low-density pages are either single-purpose web utilities (calculators, blank tools) or unrenderable stubs. TabSum cannot synthesize a meaningful IndexedDB wiki summary from <120 words anyway; closing them violates the extraction promise.

---

### Architectural Summary
- **Visibility (`checkVisibility`)** eliminates dead DOM and copy buffers.
- **`isSubmitForm`** eliminates documentation chrome (Python version pickers, Wikipedia toggles).
- **Hybrid editor detection** pairs standard ARIA/Canvas primitives with the 5 universal vendor engines, permanently fixing `jsonformatter.org` and its cohort without maintenance churn.
- **Anchor disambiguation on Rule 2** prevents deep-linked documentation from falsely suspending.

