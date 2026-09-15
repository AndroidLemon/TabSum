# Follow-ups

Everything deferred on purpose, in one place. Each entry says where it came
from, what would make it worth doing, and roughly how big it is. Nothing here
is a bug that ships broken; the leak gate is 0 of 16 and close recall is 88.6%
(`logs/baseline-review2.md`). Ordered within each section by how likely the
trigger is to fire during dogfooding.

Last updated 2026-09-15, after PR #4 (extraction-v1) merged.

## Summariser

1. **Slice the prompt window by block, not by character.**
   `summarizer.js` sends `cleanText.slice(0, 3000)` (Prompt API) or
   `slice(0, 6000)` (Gemini, OpenAI-compatible). The harvest now walks every
   block in DOM order, so any pre-article chrome the noise list does not catch
   fills the front of that window ahead of the article. Fix: skip runs of
   short fragments before the first long paragraph, or take the first N blocks
   over a length floor. From the round-2 review (finding C6). Small.
   *Trigger:* a summary that describes the site's menu instead of the page.

3. **Is Hacker News worth summarising at all?**
   The front page now extracts at 99.9% recall and closes, but a summary of
   thirty story titles may be useless. Answer is a corpus label change
   (`expect: suspend` or a new `expect: skip`), not an extractor change.
   From EXTRACTION_PLAN.md known unknowns and ADR 0001. Tiny.
   *Trigger:* dogfooding; look at the HN entry the first time it appears.

## Extractor

4. **Shadow DOM traversal.**
   The harvest does not enter shadow roots (parity with the old clone), and
   closed roots are invisible even for the unslotted-light-DOM rule
   (`shadowRoot === null`). Component-heavy reading pages could report near
   zero words and be held by rule 4, which is safe but wrong. Upgrade path is
   recorded in the harvest comment: `Range.getClientRects()` per text node, or
   a walker that descends open roots. Needs a corpus page that actually
   exhibits it first. From reviews round 1 (Gemini) and round 4 (Copilot).
   Medium.
   *Trigger:* a reading page held by rule 4 whose text is inside web
   components.

5. **Density rule for control-free tool pages (ADR 0001 option 2).**
   A DOM-only tool with no input, canvas, dialog or application role and more
   than 120 words of chrome would close with its state. The `/dom-tool`
   hardening fixture guards the current under-floor case; nothing guards the
   over-floor one because no such page has been found. Candidate: words per
   block, or ratio of short groups to long. From ADR 0001 and review finding
   C9. Medium.
   *Trigger:* a page that closes on nav junk with a word count over 120.

6. **Vendor editor list rots.**
   `TEXT_EDITOR_SELECTOR` names Monaco, CodeMirror, Ace, ProseMirror, Quill
   and Draft by class. Every editor that falls out of fashion, or renames its
   root class, becomes a silently closed tool. Upgrade path in the comment at
   `in-tab-extractor.js:109`: score a tool by off-screen capture textarea plus
   tall scroll container instead of by class name. Medium.
   *Trigger:* a draft lost in an editor not on the list.

7. **Consent banners as app surfaces.**
   `[role="dialog"]` counts as an app surface, and an undismissed cookie
   banner is visible by definition. Inert on the corpus today. Upgrade path at
   `in-tab-extractor.js:130`: require the dialog to contain a control. Small.
   *Trigger:* close recall drops on banner-heavy publisher pages.

8. **Right-parked prose.**
   The visibility box test vetoes only parking past the top or left origin.
   Text parked at `left: 9999px` is harvested. Rejected in review round 3
   because a right-edge veto would drop wide-table cells and horizontally
   scrolled layouts, and right-parking causes a scrollbar so nothing uses it.
   Recorded here so it is not re-litigated without a real page. No work.

## Closure policy

10. **Cross-origin frame gap rule.**
    A substantial cross-origin iframe that `executeScript` cannot reach could
    hide an editor. Measured on the corpus: one page (bbc.com/news, ad frames,
    one run of two). A fail-closed rule "suspend when substantial iframes
    exceed injected subframes" would have held no reading page in either run.
    Not adopted because the base rate is too low to calibrate. From
    `logs/measure-frames-discard-2026-09-14.md`. Small once the corpus has a
    page that needs it.
    *Trigger:* a lost draft inside a cross-origin embed (Google Docs in an
    LMS, a CodeSandbox embed).

11. **Single-field newsletter vs single-field login.**
    Both read as one "other" input and are allowed to close. Ceiling noted at
    `closure-policy.js:102`. No signal in the counts separates them without a
    password field. No work until a case appears.

12. **Media floor is one number.**
    `MEDIA_READING_FLOOR_WORDS = 500`, calibrated on one YouTube page and one
    article with two embeds. Upgrade path at `closure-policy.js:108`: compare
    the player's rendered area to the viewport. Small.
    *Trigger:* a podcast page with show notes held, or a video page closed.

13. **Cross-origin frames still count controls.**
    Frames under `MIN_COUNTABLE_FRAME_AREA` are skipped so a tracking pixel
    cannot suspend every page. Larger ad frames still count. Upgrade path at
    `closure-policy.js:184`: the extractor already reports its frame's origin;
    weight cross-origin frames out. Small.
    *Trigger:* ad-supported reading pages held with `otherInputs` from a
    frame.

## Service worker

14. **No timeout on the sequential sweep's `executeScript`.**
    A tab whose renderer hangs blocks the whole archival sweep. Wrap each
    injection in `Promise.race` with a timeout and skip the tab. From review
    finding C8. Small.
    *Trigger:* a sweep that never finishes.

15. **Does `chrome.tabs.discard()` lose contenteditable drafts?**
    The soft-suspend path assumes yes and holds such tabs, but it has never
    been measured: Playwright Chromium segfaults on `discard()` in every
    configuration tried (five, one crash address), and real Chrome will not
    load an unpacked extension from the CLI. The one-minute manual recipe is
    in `logs/measure-frames-discard-2026-09-14.md`. Record the answer there.
    *Trigger:* whenever someone has Chrome open with the extension loaded.

16. **The reopen race cannot be closed.**
    `userReopened` shrinks the window between the dirty check and the
    destructive call to one `tabs.get` round trip. Noted at
    `service-worker.js:386`. No work; here so nobody tries to "fix" it with a
    second check.

## Knowledge hub

17. **Feed is capped at the newest 200 matches.**
    Search and filters still reach older notes, and fading keeps most
    libraries under the cap. Noted at `app.js:177`. Add a "Load more" button
    if a real library outgrows it. Small.
    *Trigger:* a library over 200 unfaded notes.

18. **Card sizes are now uniform whether or not a summary exists.**
    Done 2026-09-15 (grid rows stretch, footer pinned, muted placeholder in
    the TL;DR slot). Listed so the next card-layout change knows the rule.

## Measurement and corpus

19. **The corpus cannot isolate rule 1.**
    QA practice sites are under 120 words, so rule 4 fires first. Isolating
    rule 1 needs pages that are both long and interactive: Swagger UI,
    Grafana, cloud consoles. From CLOSURE_POLICY_PLAN.md known unknowns.
    Small, but each new must-suspend URL needs to be reachable headless.
    *Trigger:* the next rule 1 change.

20. **Eight corpus URLs are bot-blocked headless.**
    The reachable denominator moves run to run, which is why the recall floor
    sits three points under the measured rate. Replace blocked URLs with
    equivalents that serve headless Chromium, or accept the drift. Tiny per
    URL.

21. **Copilot re-review cannot be requested through the API.**
    `POST /pulls/N/requested_reviewers` for the bot returns nothing and the
    request list stays empty; the bot does review on push. Request re-reviews
    from the PR page. No work, documented so it is not retried.

## Storage

22. **No data migrations exist.**
    There are no users yet, so schema changes are made in place. Write the
    first migration when a schema change ships after launch. Noted at
    `db.js:34`.
