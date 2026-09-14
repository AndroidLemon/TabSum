# Measurement: cross-origin frame gap (M1) and discard() unsaved-state loss (M2)

Measurement only. No changes to `src/`. Scratch scripts live in `tests/measure/`
(`frame_gap.js`, `discard_state.js`) and are not wired into any npm script.

---

## M1 — cross-origin frame gap in the zero-loss guard

### Permission mode used

`manifest.json` declares no static `host_permissions` at all, only
`optional_host_permissions: ["<all_urls>"]`. The shared test helper
(`tests/helpers/test-extension.js`) adds static `host_permissions` for exactly
three test-only origins (`localhost`, `127.0.0.1`, `*.wikipedia.org`) — i.e.
the shared harness is **already per-origin mode**, never `<all_urls>`, which
matches production's default un-elevated state.

To measure the corpus (which touches ~36 distinct external origins, only one
of which is Wikipedia), `tests/measure/frame_gap.js` builds its own throwaway
extension copy and grants one static `host_permissions` pattern per corpus
URL's **top-level origin only** (via `originPatternFor`, imported read-only
from `src/shared/closure-policy.js`) — 36 patterns, no `<all_urls>`. This
simulates a user who has granted TabSum access to each site they're reading,
which is the realistic steady state, and deliberately grants nothing for any
cross-origin child frame's own origin — that's the gap under test. Confirmed
per-origin, not all_urls.

### Method

Per corpus URL: navigate with Playwright, settle 1.5s, then (a) scan the MAIN
frame's DOM for `<iframe>` elements via `getBoundingClientRect()`, count ones
with area `>= MIN_COUNTABLE_FRAME_AREA` (100×100 = 10,000, read from
`src/shared/closure-policy.js`) as "substantial", and classify each as
cross-origin using the same protocol+hostname rule as `originPatternFor`
against the `src` attribute; (b) from the real background service worker, run
`chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files:
['src/content/in-tab-extractor.js'] })` exactly as `processTabArchival` does,
and count how many frame results came back (each result also carries the
frame's own `url`/`frameArea`, which let us cross-check which frames actually
got injected, not just how many).

Two full runs were made (see "noise" below).

### Run 2 (used as primary — see noise note)

| URL | expect | substantial iframes | of which cross-origin | frame results returned | injected subframes |
| :--- | :--- | ---: | ---: | ---: | ---: |
| developer.mozilla.org/.../fetch | close | 0 | 0 | 1 | 0 |
| developer.mozilla.org/.../Promise | close | 0 | 0 | 1 | 0 |
| developer.mozilla.org/.../grid-template-areas | close | 0 | 0 | 1 | 0 |
| nodejs.org/docs/latest/api/fs.html | close | 0 | 0 | 1 | 0 |
| playwright.dev/docs/api/class-page | close | 0 | 0 | 1 | 0 |
| developer.chrome.com/.../scripting | close | 0 | 0 | 1 | 0 |
| developer.chrome.com/.../tabs | close | 0 | 0 | 1 | 0 |
| sqlite.org/lang_select.html | close | 0 | 0 | 1 | 0 |
| pkg.go.dev/net/http | close | 0 | 0 | 1 | 0 |
| docs.python.org/.../asyncio-task.html | close | 0 | 0 | 1 | 0 |
| nodejs.org/.../fs.html#fspromisesreadfilepath-options | close | 0 | 0 | 1 | 0 |
| developer.mozilla.org/.../fetch#syntax | close | 0 | 0 | 1 | 0 |
| docs.python.org/.../asyncio-task.html#creating-tasks | close | 0 | 0 | 1 | 0 |
| developer.mozilla.org/.../grid-template-areas#examples | close | 0 | 0 | 1 | 0 |
| en.wikipedia.org/wiki/Tab_(interface) | close | 0 | 0 | 1 | 0 |
| en.wikipedia.org/wiki/Readability | close | 0 | 0 | 1 | 0 |
| en.wikipedia.org/wiki/IndexedDB | close | 0 | 0 | 1 | 0 |
| danluu.com/deconstruct-files/ | close | 0 | 0 | 1 | 0 |
| jvns.ca/.../a-list-of-new-ish--command-line-tools/ | close | 0 | 0 | 1 | 0 |
| martinfowler.com/.../patterns-of-distributed-systems/ | close | 0 | 0 | 1 | 0 |
| overreacted.io/a-complete-guide-to-useeffect/ | close | 0 | 0 | 1 | 0 |
| simonwillison.net/2024/Dec/31/llms-in-2024/ | close | 0 | 0 | 1 | 0 |
| text.npr.org/ | close | 0 | 0 | 1 | 0 |
| lite.cnn.com/ | close | 0 | 0 | 1 | 0 |
| **bbc.com/news** | close | **0** | **0** | 4 | 3 |
| arstechnica.com/gadgets/ | close | 0 | 0 | 5 | 4 |
| apnews.com/hub/technology | close | — | — | — | **HTTP 403, unreachable** |
| news.ycombinator.com/item?id=1 | close | 0 | 0 | 1 | 0 |
| news.ycombinator.com/news | close | 0 | 0 | 1 | 0 |
| lobste.rs/ | close | 0 | 0 | 1 | 0 |
| github.com/microsoft/playwright/issues/1234 | close | 0 | 0 | 1 | 0 |
| github.com/nodejs/node/pull/50000 | close | 0 | 0 | 1 | 0 |
| github.com/microsoft/playwright/blob/main/README.md | close | 0 | 0 | 1 | 0 |
| github.com/torvalds/linux | close | 0 | 0 | 1 | 0 |
| gitlab.com/gitlab-org/gitlab | close | 0 | 0 | 1 | 0 |
| excalidraw.com/ | suspend | 0 | 0 | 1 | 0 |
| app.diagrams.net/ | suspend | 0 | 0 | 1 | 0 |
| jsonformatter.org/ | suspend | 0 | 0 | 9 | 8 |
| regex101.com/ | suspend | 0 | 0 | 1 | 0 |
| petstore.swagger.io/ | suspend | 0 | 0 | 2 | 1 |
| codepen.io/pen/ | suspend | — | — | — | **HTTP 403, unreachable** |
| news.ycombinator.com/login | suspend | 0 | 0 | 1 | 0 |
| the-internet.herokuapp.com/login | suspend | 0 | 0 | 1 | 0 |
| demoqa.com/automation-practice-form | suspend | 0 | 0 | 2 | 1 |
| the-internet.herokuapp.com/tinymce | suspend | 1 | 0 | 2 | 1 |
| amazon.com/gp/cart/view.html | suspend | 0 | 0 | 1 | 0 |
| etsy.com/cart | suspend | — | — | — | **HTTP 403, unreachable** |
| duckduckgo.com/?q=... | suspend | 0 | 0 | 2 | 1 |
| google.com/search?q=... | suspend | 2 | 0 | 5 | 4 |
| github.com/search?q=... | suspend | — | — | — | **HTTP 429, unreachable** |
| pypi.org/search/?q=readability | suspend | 0 | 0 | 1 | 0 |
| youtube.com/watch?v=... | suspend | 0 | 0 | 2 | 1 |

4 URLs bot-blocked (403/429), as noted elsewhere in the plan as an expected
corpus property, not a bug in this script.

Two rows need a caveat:
- **google.com/search**: `frame 0`'s own URL came back as
  `google.com/sorry/index?continue=...` — this run got soft bot-blocked into a
  reCAPTCHA "unusual traffic" wall, not the real SERP. `substantial=2` here are
  the reCAPTCHA iframes on that wall, not real ad iframes on a genuine results
  page. Discount this row.
- **jsonformatter.org**: 8 injected subframes, mostly `about:blank` or
  `null`-URL placeholders (ad slots that hadn't finished loading creative).
  None were substantial.

### Noise: run 1 vs run 2 disagreed on bbc.com

Run 1, same script, same corpus, ~1 minute apart:

```
bbc.com/news | close | substantial=2 crossOrigin=2 frameResults=5 injected(subframes)=4
```

Run 2 (above):

```
bbc.com/news | close | substantial=0 crossOrigin=0 frameResults=4 injected(subframes)=3
```

Same page, same code, different result: bbc.com's ad iframes are lazy-loaded
and hadn't reached their final size at the 1.5s settle mark in run 2, but had
in run 1. This is exactly the "headless timing noise" the plan's "Known
unknowns" section already calls out for consent banners — it applies to ad
iframe sizing too. Treat single-run substantial-cross-origin counts on
ad-supported news sites as a lower bound, not a stable number.

### Answering the two questions

**How many corpus pages have >= 1 substantial cross-origin iframe?**
Run 2: 1 of 48 reachable pages (bbc.com/news, and only because run 1 counted
it — run 2 itself measured 0). Across both runs combined, exactly one corpus
page ever showed a substantial cross-origin iframe: bbc.com/news. This is a
rare event in the current 50-URL corpus, gated almost entirely by ad-network
loading timing on ad-supported publisher pages, not something this corpus can
put a stable base rate on.

**Would a fail-closed rule "suspend when substantial iframes > injected
subframes" have suspended any expect:close page?**
No, in neither run: 0 of 34 (run 2) / 0 of 35 (run 1) reachable expect:close
pages. But the one case that actually exhibits the gap (bbc.com/news, run 1:
substantial=2, injected subframes=4) shows *why* a raw count comparison is
unsound, not why the gap is small: run 1 had **more** injected subframes (4)
than substantial ones (2), so the naive count check says "everything's fine"
— even though the two specific substantial cross-origin iframes were, by
construction of this per-origin extension, never among those 4 injected
frames (they have no permission grant). The 4 injected frames are other,
smaller, likely-same-origin utility iframes that pad the count and mask the
exact miss. A correct fail-closed rule needs to match specific substantial
frames against the set actually injected (e.g. by comparing counts of
substantial iframes specifically, or reconciling by frame identity/URL), not
compare aggregate totals — confirming the plan's own caution that "the fix is
a design change, not a patch."

### M1 conclusion

1. The shared test harness (`tests/helpers/test-extension.js`) and this
   script's own harness are both per-origin, never `<all_urls>` — the gap
   under investigation is live in the harness used to measure it.
2. Substantial cross-origin iframes are rare in this 50-URL corpus (1 page
   across two runs, bbc.com/news) and highly timing-sensitive: the same page
   measured 0 and then 2 substantial cross-origin iframes a minute apart.
3. No expect:close page would have been wrongly suspended by a naive
   "substantial iframes > injected subframes" count rule, in either run —
   the safety floor holds on this corpus.
4. But the one real occurrence proves the naive count comparison is
   unreliable in the direction that matters: extra small same-origin
   subframes can outnumber and mask a missing substantial cross-origin one,
   so a count-only fail-closed rule can silently pass exactly the page it was
   meant to catch.
5. This corpus is too small and too ad-timing-dependent to bound the real
   base rate of the cross-origin-iframe gap; a wider, more ad-heavy corpus
   (news/publisher sites specifically) and a frame-identity-based (not
   count-based) fail-closed check are both needed before shipping a fix.

---

## M2 — does chrome.tabs.discard() lose unsaved typed state?

### What was attempted

`tests/measure/discard_state.js` serves a local page (own tiny http server,
port 8899) with a `<form>` (text input + textarea) and a bare
`contenteditable` div, types distinct marker strings into all three with
real Playwright keyboard events, then from the real background service
worker: `chrome.tabs.discard(tabId)` -> poll `chrome.tabs.get` for
`discarded: true` -> `chrome.tabs.update(id, { active: true })` -> wait for
reload -> read the three values back. Repeated with `autocomplete="off"` on
the form.

### Result: the browser segfaults, reproducibly, in every configuration tried

This is the exact crash `tests/test_hybrid_mode.js:297` already works around
by mocking `chrome.tabs.discard` ("Mock chrome.tabs.discard in test
environment to avoid SwiftShader compositor segfault") — this measurement
independently reproduced that same crash three times:

**Attempt 1 — headless (default, channel `chromium`):**
```
[default (no autocomplete=off)] chrome.tabs.discard() result:
{"discarded":{"active":true,...,"discarded":true,"status":"unloaded",
"title":"Discard State Test","url":"http://localhost:8899/plain",...}}
FAIL: worker.evaluate: Target page, context or browser has been closed
...
[err] Received signal 11 SEGV_ACCERR 000000000000
```
`discard()` itself succeeded and returned a real discarded tab (not
`undefined` — i.e. Chrome did **not** refuse it), but the browser process
crashed with SIGSEGV moments later, before the tab could be reactivated.

**Attempt 2 — headed, off-screen window (`TABSUM_OFFSCREEN=1`, `TABSUM_HEADLESS`
unset), per the task's "try headed mode once":**
Same result: `discard()` succeeded, then immediately:
```
[err] Received signal 11 SEGV_ACCERR 000000000000
```
Identical crash address in the stack trace as attempt 1.

**Attempt 3 — headless with `--disable-gpu --disable-software-rasterizer
--disable-gpu-compositing` added:**
This time the crash happened even earlier — during/immediately after the
`discard()` call itself, before its result could even be logged. Same
SIGSEGV signature.

All three raw crash logs are saved: `tests/measure/discard_state_output.txt`
(headless), `tests/measure/discard_state_output_headed.txt` (headed
off-screen), `tests/measure/discard_state_output_nogpu.txt` (headless,
GPU disabled).

No configuration reached the reactivation/read-back step, so **no
input/textarea/contenteditable survival data was collected** — for either the
default or the `autocomplete="off"` case. Reporting this plainly rather than
guessing: the task's contingency ("if it refuses in headless, try headed
once") assumed a graceful refusal (`undefined`), not a process crash, and a
crash reproducing identically across headless/headed/GPU-disabled strongly
suggests it's this sandboxed environment's Chromium-for-Testing build plus
its software (SwiftShader) compositor path, not something a fourth retry
would fix — which is exactly why the codebase's own hybrid-mode test already
mocks this call out instead of exercising it for real.

### M2 conclusion

1. Real `chrome.tabs.discard()` could not be measured end-to-end in this
   sandbox: it crashes the browser with SIGSEGV in the compositor path,
   reproducibly, in headless, headed-offscreen, and GPU-disabled
   configurations alike.
2. This is not a new finding — it corroborates the existing workaround at
   `tests/test_hybrid_mode.js:297`, which already mocks `chrome.tabs.discard`
   for exactly this reason; this measurement is independent confirmation the
   mock is load-bearing, not defensive boilerplate.
3. `discard()` itself is not "refused" here (it doesn't return `undefined`
   before crashing) — Chrome accepts the discard request and reports
   `discarded: true` on the returned tab before the process goes down, so the
   crash is downstream of discard succeeding, not a permission/API rejection.
4. No survival data for the input/textarea/contenteditable fields, in either
   the plain or `autocomplete="off"` case, was obtained; any claim about
   which of the three would survive Chrome's own reload-on-reactivate is
   unverified in this environment and should not be treated as measured.
5. Answering this question for real needs either a different Chromium build
   or host environment (real GPU, or a Linux CI runner with a working
   Mesa/llvmpipe stack instead of this sandbox's SwiftShader path) than is
   available here, or a manual/headed run on the user's own machine outside
   this sandbox.
