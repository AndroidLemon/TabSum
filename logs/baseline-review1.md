# Closure Ratio Report

**Run**: 2026-09-14T23:47:41.712Z  
**Corpus**: `tests/fixtures/corpus.txt` (53 URLs, 51 reachable, 2 failed)  
**Close-rate floor**: 80%

## Gate

| Metric | Value | Requirement |
| :--- | ---: | :--- |
| **Must-suspend leaks** | **0** | must be 0 — a leak is data loss |
| Close recall (of 35 expect:close) | 85.7% | >= 80% |
| Must-suspend pages measured | 16 of 18 | the leak gate only sees these |

## Tier split (all reachable, for continuity with the baseline)

| Tier | Count | % of reachable |
| :--- | ---: | ---: |
| `safe_to_close` | 31 | 60.8% |
| `suspend_only` | 20 | 39.2% |

> Tier is the policy verdict only. The shipped hybrid path gates closing further
> on an AI summary (`canCloseWith`), so the real-world close rate is this number
> times the AI-summary hit rate.

## Reading pages still held open

| URL | Rule that caught it | Words |
| :--- | :--- | ---: |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | Contains form or interactive input controls | 262 |
| https://pkg.go.dev/net/http | Pure stateless reading article | 18831 |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | Contains form or interactive input controls | 262 |
| https://news.ycombinator.com/item?id=1 | Short or low-confidence content | 72 |
| https://github.com/nodejs/node/pull/50000 | Short or low-confidence content | 114 |

## Extraction recall

25% is a reporting aid to flag rows below for attention, not a gate — see EXTRACTION_PLAN.md Step 1.

| URL | Extracted words | Body words | Recall |
| :--- | ---: | ---: | ---: |
| https://news.ycombinator.com/login ⚠️ | 0 | 10 | 0.0% |
| https://demoqa.com/automation-practice-form ⚠️ | 3 | 52 | 5.8% |
| https://app.diagrams.net/ ⚠️ | 5 | 82 | 6.1% |
| https://www.amazon.com/gp/cart/view.html ⚠️ | 63 | 761 | 8.3% |
| https://www.google.com/search?q=playwright+headless+extension&num=20 ⚠️ | 7 | 40 | 17.5% |
| https://play2048.co/ ⚠️ | 8 | 36 | 22.2% |
| https://github.com/nodejs/node/pull/50000 | 114 | 388 | 29.4% |
| https://codepen.io/pen/ | 19 | 55 | 34.5% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | 262 | 728 | 36.0% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | 262 | 728 | 36.0% |
| https://regex101.com/ | 109 | 285 | 38.2% |
| https://lobste.rs/ | 224 | 567 | 39.5% |
| https://jsonformatter.org/ | 460 | 1131 | 40.7% |
| https://github.com/microsoft/playwright/issues/1234 | 202 | 454 | 44.5% |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | 171 | 328 | 52.1% |
| https://en.wikipedia.org/wiki/IndexedDB | 617 | 1100 | 56.1% |
| https://github.com/microsoft/playwright/blob/main/README.md | 686 | 1101 | 62.3% |
| https://petstore.swagger.io/ | 172 | 270 | 63.7% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | 562 | 880 | 63.9% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | 562 | 880 | 63.9% |
| https://arstechnica.com/gadgets/ | 810 | 1253 | 64.6% |
| https://excalidraw.com/ | 42 | 64 | 65.6% |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | 1643 | 2382 | 69.0% |
| https://news.ycombinator.com/item?id=1 | 72 | 104 | 69.2% |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | 30 | 40 | 75.0% |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | 391 | 521 | 75.0% |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | 3694 | 4889 | 75.6% |
| https://apnews.com/hub/technology | 836 | 1102 | 75.9% |
| https://www.bbc.com/news | 1065 | 1328 | 80.2% |
| https://overreacted.io/a-complete-guide-to-useeffect/ | 8225 | 10242 | 80.3% |
| https://nodejs.org/docs/latest/api/fs.html | 25369 | 31154 | 81.4% |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | 25369 | 31153 | 81.4% |
| https://docs.python.org/3/library/asyncio-task.html | 5391 | 6476 | 83.2% |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | 5391 | 6476 | 83.2% |
| https://github.com/torvalds/linux | 794 | 948 | 83.8% |
| https://pypi.org/search/?q=readability | 11 | 13 | 84.6% |
| https://the-internet.herokuapp.com/tinymce | 47 | 55 | 85.5% |
| https://en.wikipedia.org/wiki/Tab_(interface) | 1569 | 1809 | 86.7% |
| https://the-internet.herokuapp.com/login | 34 | 39 | 87.2% |
| https://gitlab.com/gitlab-org/gitlab | 1186 | 1353 | 87.7% |
| https://playwright.dev/docs/api/class-page | 19167 | 21648 | 88.5% |
| https://pkg.go.dev/net/http | 18831 | 20925 | 90.0% |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | 619 | 686 | 90.2% |
| https://text.npr.org/ | 242 | 262 | 92.4% |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | 2885 | 3072 | 93.9% |
| https://en.wikipedia.org/wiki/Readability | 7733 | 8133 | 95.1% |
| https://danluu.com/deconstruct-files/ | 6344 | 6580 | 96.4% |
| https://lite.cnn.com/ | 1288 | 1321 | 97.5% |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 7019 | 7114 | 98.7% |
| https://www.sqlite.org/lang_select.html | 5841 | 5870 | 99.5% |
| https://news.ycombinator.com/news | 690 | 691 | 99.9% |

## Why tabs were held back

| Rule that caught it | Count |
| :--- | ---: |
| Contains form or interactive input controls | 13 |
| Short or low-confidence content | 4 |
| Stateful URL path or client-side hash route | 1 |
| Complex search/filter query state | 1 |
| Media-dominated page with little prose | 1 |

## Per-URL

| URL | Tier | Reason | Words | Inputs (ta/sel/pw/app/other) | Dirty |
| :--- | :--- | :--- | ---: | :--- | :--- |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | `safe_to_close` | Pure stateless reading article | 562 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | `safe_to_close` | Pure stateless reading article | 2885 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas · | `suspend_only` | Contains form or interactive input controls | 262 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://nodejs.org/docs/latest/api/fs.html | `safe_to_close` | Pure stateless reading article | 25369 | 0/0/0/0/0 | — |
| https://playwright.dev/docs/api/class-page | `safe_to_close` | Pure stateless reading article | 19167 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | `safe_to_close` | Pure stateless reading article | 1643 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | `safe_to_close` | Pure stateless reading article | 3694 | 0/0/0/0/0 | — |
| https://www.sqlite.org/lang_select.html | `safe_to_close` | Pure stateless reading article | 5841 | 0/0/0/0/0 | — |
| https://pkg.go.dev/net/http | `safe_to_close` | Pure stateless reading article | 18831 | 0/0/0/0/0 | Unsaved textarea content detected |
| https://docs.python.org/3/library/asyncio-task.html | `safe_to_close` | Pure stateless reading article | 5391 | 0/0/0/0/0 | — |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | `safe_to_close` | Pure stateless reading article | 25369 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | `safe_to_close` | Pure stateless reading article | 562 | 0/0/0/0/1 | — |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | `safe_to_close` | Pure stateless reading article | 5391 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples · | `suspend_only` | Contains form or interactive input controls | 262 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://en.wikipedia.org/wiki/Tab_(interface) | `safe_to_close` | Pure stateless reading article | 1569 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/Readability | `safe_to_close` | Pure stateless reading article | 7733 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/IndexedDB | `safe_to_close` | Pure stateless reading article | 617 | 0/0/0/0/0 | — |
| https://danluu.com/deconstruct-files/ | `safe_to_close` | Pure stateless reading article | 6344 | 0/0/0/0/0 | — |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | `safe_to_close` | Pure stateless reading article | 391 | 0/0/0/0/1 | — |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | `safe_to_close` | Pure stateless reading article | 619 | 0/0/0/0/0 | — |
| https://overreacted.io/a-complete-guide-to-useeffect/ | `safe_to_close` | Pure stateless reading article | 8225 | 0/0/0/0/0 | — |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | `safe_to_close` | Pure stateless reading article | 7019 | 0/0/0/0/0 | — |
| https://text.npr.org/ | `safe_to_close` | Pure stateless reading article | 242 | 0/0/0/0/0 | — |
| https://lite.cnn.com/ | `safe_to_close` | Pure stateless reading article | 1288 | 0/0/0/0/0 | — |
| https://www.bbc.com/news | `safe_to_close` | Pure stateless reading article | 1065 | 0/0/0/0/0 | — |
| https://arstechnica.com/gadgets/ | `safe_to_close` | Pure stateless reading article | 810 | 0/0/0/0/0 | — |
| https://apnews.com/hub/technology | `safe_to_close` | Pure stateless reading article | 836 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/item?id=1 · | `suspend_only` | Short or low-confidence content | 72 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/news | `safe_to_close` | Pure stateless reading article | 690 | 0/0/0/0/0 | — |
| https://lobste.rs/ | `safe_to_close` | Pure stateless reading article | 224 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/issues/1234 | `safe_to_close` | Pure stateless reading article | 202 | 0/0/0/0/0 | — |
| https://github.com/nodejs/node/pull/50000 · | `suspend_only` | Short or low-confidence content | 114 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/blob/main/README.md | `safe_to_close` | Pure stateless reading article | 686 | 0/0/0/0/1 | — |
| https://github.com/torvalds/linux | `safe_to_close` | Pure stateless reading article | 794 | 0/0/0/0/1 | — |
| https://gitlab.com/gitlab-org/gitlab | `safe_to_close` | Pure stateless reading article | 1186 | 0/0/0/0/0 | — |
| https://excalidraw.com/ | `suspend_only` | Contains form or interactive input controls | 42 | 0/0/0/2/0 | — |
| https://app.diagrams.net/ | `suspend_only` | Contains form or interactive input controls | 5 | 0/0/0/0/3 | Unsaved form input detected |
| https://jsonformatter.org/ | `suspend_only` | Contains form or interactive input controls | 460 | 0/0/0/2/1 | Unsaved textarea content detected |
| https://regex101.com/ | `suspend_only` | Contains form or interactive input controls | 109 | 0/0/0/5/1 | Unsaved rich-text editor draft detected |
| https://petstore.swagger.io/ | `suspend_only` | Contains form or interactive input controls | 172 | 0/0/0/1/1 | — |
| https://codepen.io/pen/ | `suspend_only` | Contains form or interactive input controls | 19 | 3/0/0/3/0 | — |
| https://play2048.co/ | `suspend_only` | Contains form or interactive input controls | 8 | 0/0/0/1/0 | — |
| https://news.ycombinator.com/login | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/2/0/4 | — |
| https://the-internet.herokuapp.com/login | `suspend_only` | Contains form or interactive input controls | 34 | 0/0/1/0/2 | — |
| https://demoqa.com/automation-practice-form | `suspend_only` | Contains form or interactive input controls | 3 | 1/0/0/0/14 | — |
| https://the-internet.herokuapp.com/tinymce | `suspend_only` | Contains form or interactive input controls | 47 | 0/0/0/1/0 | — |
| https://www.amazon.com/gp/cart/view.html | `suspend_only` | Stateful URL path or client-side hash route | 63 | 0/0/0/0/0 | — |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | `suspend_only` | Short or low-confidence content | 30 | 0/0/0/0/0 | — |
| https://www.google.com/search?q=playwright+headless+extension&num=20 | `suspend_only` | Complex search/filter query state | 7 | 0/0/0/0/0 | — |
| https://pypi.org/search/?q=readability | `suspend_only` | Short or low-confidence content | 11 | 0/0/0/0/1 | — |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | `suspend_only` | Media-dominated page with little prose | 171 | 0/0/0/0/1 | — |

## Unreachable

| URL | Error |
| :--- | :--- |
| https://www.etsy.com/cart | HTTP 403 |
| https://github.com/search?q=tab+suspender&type=repositories | HTTP 429 |
