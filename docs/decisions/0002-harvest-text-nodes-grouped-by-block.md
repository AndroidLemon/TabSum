# ADR 0002: Harvest text nodes grouped by nearest block

Date: 2026-09-15
Status: accepted

## Context

EXTRACTION_PLAN.md Steps 2-3 replaced a `cloneNode` harvest with a live-DOM
walk over a widened block selector (`h*`, `p`, `blockquote`, `li`, `td`, `th`,
`dd`, `dt`, `div`, `span`, `figcaption`, `summary`). Harvesting *elements*
forced a containment rule: a block holding a nested block had to be skipped,
or its `innerText` would sum the nested block's words a second time. Review
round 1 patched the rule twice (walk every ancestor, not the nearest; cover
only when the ancestor itself harvests) and still left three shapes wrong:

- `p > span > span` and `td > span > span` double-counted until the ancestor
  walk was made transitive (Gemini, round 1).
- A block disqualified by a nested block lost its OWN direct text. Hacker News
  writes a comment as `<div class="commtext">first<p>second<p>third</div>`,
  so the first paragraph of 549 of 910 comments in one thread was dropped.
  nodejs.org lost the word "options" from every `<li>options <ul>...</ul></li>`
  group (fs.html recall 92.7% to 81.1%). Recorded as a "ceiling" in round 1;
  it was the plan's headline page regressing.
- `div` sat in the no-floor list against its own comment, so
  `<td><div class="d-flex">opened this issue</div></td>` lost the cell's
  short-content allowance.

Two reviewers (Gemini via agy, Copilot CLI) and a Claude code-review pass
(`logs/review-extraction-v1-2026-09-14.md`) converged on the same diagnosis:
the double-count and the preamble loss are the same bug, and every patch to
the containment rule moves it rather than removing it.

## Decision

The harvest walks **text nodes**, not elements. A `TreeWalker` over the
container with `SHOW_ELEMENT | SHOW_TEXT` rejects noise subtrees whole
(`NOISE_SELECTOR`), accepts `<br>` as a word separator, and skips every other
element into its children. Each accepted text node is appended to the group of
its nearest `GROUP_SELECTOR` ancestor (`closest()`, clamped to the container).
Every text node is claimed by exactly one group, so there is no containment
rule, no leaf rule, no ancestor-coverage walk and no cache of any of them.

Consequences that fall out of the construction rather than needing code:

- `p > span > span` counts once: all three text nodes group under the `<p>`.
- The HN comment keeps "first" under its `<div>` and "second"/"third" under
  their own `<p>`s. The nodejs.org preamble is back.
- Inline tags (`span`, `a`, `b`, `em`, `code`) are absent from
  `GROUP_SELECTOR` on purpose: their text joins the enclosing block instead of
  splitting a sentence.
- The rendered test is asked of each text node's parent element and cached, so
  a visible `<span>` inside a `visibility:hidden` `<p>` still contributes while
  the hidden text around it does not.

Four further rules travel with the rewrite:

1. **Prose does not check opacity.** `isVisibleControl` gains an
   `options.checkOpacity` flag, defaulting to true so every control path is
   unchanged. The harvest passes false: scroll-reveal pages animate paragraphs
   from `opacity:0` and a background tab never scrolls, so an opacity gate
   dropped everything below the first screen (Claude C1). The zero-box and
   off-screen-parking tests stay; they are what keep a clipboard shim's
   textarea and a paragraph at `left:-9999px` out.
2. **The container is picked from the pruned set.** The first
   `CONTAINER_SELECTOR` match that is not inside `NOISE_SELECTOR` wins.
   `<aside class="sidebar"><article>teaser</article></aside>` above the real
   `.entry-content` no longer yields a harvest of the teaser alone (Claude C2).
3. **The no-floor allowance is inherited.** A group's floor is 1 when
   `closest('td, th, dd, dt, p, figcaption, summary')` matches, 20 otherwise.
   A wrapper `<div>` inside a `<td>` is still a cell (Claude C4).
4. **Light-DOM text directly under a shadow host is skipped unless slotted.**
   GitHub's `<relative-time>Sep 14, 2026</relative-time>` renders "2 days ago"
   from its shadow root; the light-DOM date is laid out nowhere, and the host
   itself is rendered, so asking the parent is not enough.

`designMode` telemetry and the dirty check now read one shared
`designModeBody()` so the count is visibility-gated like every other surface
(Claude C5).

## Consequences

Measured after the rewrite (`logs/baseline-review2.md`, 51 of 53 reachable):

| metric | round 1 | round 2 |
| :--- | ---: | ---: |
| must-suspend leaks | 0 of 16 | 0 of 16 |
| close recall | 85.7% | 88.6% |
| nodejs.org fs.html recall | 81.1% | 91.6% |
| github.com/torvalds/linux words | 794 | 838 |
| github.com/nodejs/node/pull/50000 | held, 107 words | closes, 242 words |

No page reports over 100% recall, which is the double-count tell.

- Recall is measured, not inferred: hardening fixtures `/nested-spans` and
  `/text-nodes` assert exact word counts for the double-count, preamble,
  opacity, decoy-container, `<br>` and inherited-floor cases.
- Shadow DOM contents are still not traversed (parity with the clone; a Web
  Component audit is a follow-up). Only the slotted-vs-unslotted light-DOM
  case above is handled.
- `<pre>`/`<code>` text is harvested as part of whatever block holds it. Code
  inflating rule 4's count on tool pages is a known unknown under ADR 0001;
  the density-rule candidate there is unchanged.
- Cost fell below round 1 (Playwright Chromium, headless, 3 runs, ms):

  | page | elements | old clone | round 1 walk | round 2 walk |
  | :--- | ---: | ---: | ---: | ---: |
  | nodejs.org fs.html | 13,412 | 21-34 | 50-52 | 43-45 |
  | playwright.dev class-page | 9,321 | 16-30 | 45-47 | 29-32 |
  | github.com/torvalds/linux | 1,173 | 2-3 | 6-7 | 3 |

  Visibility is computed only for elements that own text, so the wrapper-heavy
  pages that worried Copilot (finding 2) do less work, not more.
- Summariser prompt-window ordering (Claude C6: pre-content chrome not caught
  by the noise list arrives before the article) is not addressed here. It is
  the summariser's slice to fix, by block rather than by character.
