# Text extraction — scope

## Why

Three corpus pages are held open by rule 4 (`Short or low-confidence content`)
while visibly full of prose. Measured with the real extractor:

| page | extractor says | body holds | in `h*/p/li/blockquote` | in `<td>/<th>` |
| :--- | ---: | ---: | ---: | ---: |
| `news.ycombinator.com/news` | **0** | 674 | **0** | 1330 |
| `news.ycombinator.com/item?id=1` | **0** | 104 | **0** | 241 |
| `github.com/torvalds/linux` | **19** | 957 | 85 | 336 |

Single cause, `src/content/in-tab-extractor.js:272`: the harvest reads only
`h1-h6, p, blockquote, li`, then `:277` drops any block under 20 characters. HN
lays its prose out in `<td>` and `<span class="titleline">` — **zero** matching
elements on `/news`, so the page yields nothing however much text it holds.
GitHub finds 37 matching blocks but nearly all are sub-20-char file-list entries.

The noise strip is **not** the problem and should not be touched: 581 / 98 / 940
words survive it intact on those three pages. The content is right there; only
the block selector cannot see it.

## The thing that makes this harder than it looks

Rule 4 is not a quality heuristic, it is a **safety guard**: it refuses to close
a page TabSum could not summarise. Raising `wordCount` without improving what the
summariser actually receives converts a real guard into a false green — HN and the
GitHub landing page would start closing on nav junk. Any fix has to keep the
guard's meaning, which means the gate belongs on summary quality, not word count.

**Verified gotcha:** `extractCleanText` clones the body, and on a detached clone
`innerText === textContent` (measured — `clone.innerText === clone.textContent`
is `true`). So the existing harvest already runs on textContent semantics: hidden
text is included, and line breaks are not normalised ("Line oneLine two" runs
together). Only the 20-char filter is holding nav junk back today. Anything built
on `clone.innerText` inherits all of that.

---

## Step 1 — Make extraction measurable before changing it

There is no extraction metric today; `telemetry_ratio.js` measures closure only.
Without one, every later step is guesswork, and this is the same trap Step 1 of
the closure plan had to fix.

- Report, per corpus URL: extracted words, `document.body.innerText` words, and
  the ratio between them.
- Flag pages where extraction recovers < 25% of what the body holds.
- No threshold gate yet — just the number, so the later steps have a baseline.

**Verify:** the three pages above show near-zero recovery; most docs pages show
high recovery. If a docs page scores low, the diagnosis above is incomplete.

## Step 2 — Harvest from the live DOM, not a detached clone

The clone exists to strip noise without mutating the page, but it costs layout,
which is what tells prose from chrome. Walk the live DOM instead and filter
during the walk: skip any node inside the existing noise selector list, and skip
anything `isVisibleControl`'s lessons already cover (`checkVisibility`, zero box).

This also deletes the hidden-text leak the clone silently introduced.

**Verify:** extraction recall from Step 1 does not fall on any page; hidden nav
text stops appearing in extracted output.

## Step 3 — Widen the block selector, with a containment rule

Add `td, dd, dt` and `div`/`span` that contain text but **no** element child that
would itself be harvested (a leaf-text rule). The leaf rule is what stops nested
`<div>`s counting their children's text N times — `div[class]/span[class]` on the
GitHub page sums to 18,637 words against a real body of 957, which is exactly
that double-counting.

Keep the 20-char floor for `li` and `span`, drop it for `td` and `p`: HN's
comments and titles are legitimately short.

**Verify:** HN `/news` and `/item` recover most of their body text; no docs page
regresses; `npm run test:ratio` leaks stay 0.

## Step 4 — Decide what rule 4 is actually asking

Only now is the closure question answerable. Options, in the order they should be
tried:

1. Leave rule 4 on `wordCount` and accept that HN and GitHub landings become
   closeable, **if** Step 3's text is good enough to summarise. Cheapest.
2. If it is not, split the signal: keep `wordCount` for density, and add a
   separate "summarisable" flag the extractor sets when the harvest came from
   structured prose rather than the widened fallback. Rule 4 then consults both.

Do not build (2) speculatively. Step 3's measured output decides it.

**Verify:** `npm run test:ratio` — leaks 0, and the held-open list shrinks by the
three pages above without any must-suspend page moving.

---

## Out of scope

- The closure policy itself. If a page becomes closeable because extraction got
  better, that is the intended outcome, not a policy change.
- `petstore.swagger.io`, which is held by the word floor for a different reason
  (its "Try it out" controls produce `appContainers=0`).

## Known unknowns

- **HN may not be worth summarising at all.** A link index is not an article, and
  a wiki entry summarising "30 story titles" may be near-useless even when
  extraction succeeds. Step 1's numbers should be read with that in mind — the
  right answer for HN might be a corpus label change, not an extractor change.
- The 25% recovery threshold in Step 1 is a guess, chosen to be obviously
  exceeded by the three known-bad pages. It is a reporting aid, not a gate.

---

## Outcome (2026-09-14, branch extraction-v1)

| | Close recall | Leaks | HN /news | torvalds/linux |
| :--- | ---: | ---: | ---: | ---: |
| Baseline (Step 1 metric) | 82.9% | 0 | 0 words | 19 words |
| Step 2, live DOM | 80.0% | 0 | 0 | 10 |
| Step 3, wide selector | **85.7%** | **0** | **681** | **794** |

- **Step 1** confirmed the diagnosis and exposed a second one: a dozen pages
  scored over 100% recall, up to 2153% on codepen, because the detached
  clone's innerText was textContent and counted hidden text.
- **Step 2** removed that. The one page it flipped, nodejs/node pull 50000,
  had been closing on a collapsed commit list; its visible prose lives in
  timeline divs, which is Step 3's job.
- **Step 3** brought HN and the repo landing page to 100% and 84% recall and
  both now close. No page is over 100% any more. Known ceiling: a semantic
  block that contains a nested block loses its own preamble text (nodejs.org
  fs.html 92.7% -> 81.1%, still closes). lobste.rs fell to 35% because its
  stories are short fragments under a floored li; it still closes.
- **Step 4**: option 1, rule 4 stays on word count. See ADR 0001. Floor
  0.77 -> 0.80. The two pages still held (HN item?id=1 at 72 words, the PR at
  107) are held correctly: neither has an article in it.
