# Closure Ratio Report

**Run**: 2026-09-14T22:59:36.153Z  
**Corpus**: `tests/fixtures/corpus.txt` (52 URLs, 50 reachable, 2 failed)  
**Close-rate floor**: 77%

## Gate

| Metric | Value | Requirement |
| :--- | ---: | :--- |
| **Must-suspend leaks** | **0** | must be 0 — a leak is data loss |
| Close recall (of 35 expect:close) | 80.0% | >= 77% |
| Must-suspend pages measured | 15 of 17 | the leak gate only sees these |

## Tier split (all reachable, for continuity with the baseline)

| Tier | Count | % of reachable |
| :--- | ---: | ---: |
| `safe_to_close` | 29 | 58.0% |
| `suspend_only` | 21 | 42.0% |

> Tier is the policy verdict only. The shipped hybrid path gates closing further
> on an AI summary (`canCloseWith`), so the real-world close rate is this number
> times the AI-summary hit rate.

## Reading pages still held open

| URL | Rule that caught it | Words |
| :--- | :--- | ---: |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | Contains form or interactive input controls | 221 |
| https://pkg.go.dev/net/http | Pure stateless reading article | 12111 |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | Contains form or interactive input controls | 221 |
| https://news.ycombinator.com/item?id=1 | Short or low-confidence content | 0 |
| https://news.ycombinator.com/news | Short or low-confidence content | 0 |
| https://github.com/nodejs/node/pull/50000 | Short or low-confidence content | 44 |
| https://github.com/torvalds/linux | Short or low-confidence content | 10 |

## Extraction recall

25% is a reporting aid to flag rows below for attention, not a gate — see EXTRACTION_PLAN.md Step 1.

| URL | Extracted words | Body words | Recall |
| :--- | ---: | ---: | ---: |
| https://news.ycombinator.com/item?id=1 ⚠️ | 0 | 104 | 0.0% |
| https://news.ycombinator.com/news ⚠️ | 0 | 676 | 0.0% |
| https://excalidraw.com/ ⚠️ | 0 | 64 | 0.0% |
| https://app.diagrams.net/ ⚠️ | 0 | 82 | 0.0% |
| https://codepen.io/pen/ ⚠️ | 0 | 46 | 0.0% |
| https://news.ycombinator.com/login ⚠️ | 0 | 10 | 0.0% |
| https://www.google.com/search?q=playwright+headless+extension&num=20 ⚠️ | 0 | 40 | 0.0% |
| https://github.com/torvalds/linux ⚠️ | 10 | 948 | 1.1% |
| https://demoqa.com/automation-practice-form ⚠️ | 3 | 52 | 5.8% |
| https://www.amazon.com/gp/cart/view.html ⚠️ | 63 | 761 | 8.3% |
| https://github.com/nodejs/node/pull/50000 ⚠️ | 44 | 388 | 11.3% |
| https://regex101.com/ | 82 | 271 | 30.3% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | 221 | 728 | 30.4% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | 221 | 728 | 30.4% |
| https://github.com/microsoft/playwright/issues/1234 | 159 | 454 | 35.0% |
| https://petstore.swagger.io/ | 105 | 270 | 38.9% |
| https://jsonformatter.org/ | 456 | 1139 | 40.0% |
| https://gitlab.com/gitlab-org/gitlab | 617 | 1353 | 45.6% |
| https://github.com/microsoft/playwright/blob/main/README.md | 582 | 1101 | 52.9% |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | 235 | 415 | 56.6% |
| https://apnews.com/hub/technology | 639 | 1108 | 57.7% |
| https://pkg.go.dev/net/http | 12111 | 20925 | 57.9% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | 536 | 880 | 60.9% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | 536 | 880 | 60.9% |
| https://pypi.org/search/?q=readability | 8 | 13 | 61.5% |
| https://arstechnica.com/gadgets/ | 860 | 1253 | 68.6% |
| https://en.wikipedia.org/wiki/IndexedDB | 570 | 789 | 72.2% |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | 389 | 521 | 74.7% |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | 30 | 40 | 75.0% |
| https://overreacted.io/a-complete-guide-to-useeffect/ | 7707 | 10242 | 75.2% |
| https://the-internet.herokuapp.com/login | 30 | 39 | 76.9% |
| https://docs.python.org/3/library/asyncio-task.html | 5051 | 6476 | 78.0% |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | 5051 | 6476 | 78.0% |
| https://the-internet.herokuapp.com/tinymce | 43 | 55 | 78.2% |
| https://www.bbc.com/news | 1083 | 1344 | 80.6% |
| https://en.wikipedia.org/wiki/Tab_(interface) | 1473 | 1809 | 81.4% |
| https://en.wikipedia.org/wiki/Readability | 7289 | 8133 | 89.6% |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | 616 | 686 | 89.8% |
| https://text.npr.org/ | 241 | 261 | 92.3% |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | 2845 | 3072 | 92.6% |
| https://nodejs.org/docs/latest/api/fs.html | 28865 | 31154 | 92.7% |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | 28865 | 31153 | 92.7% |
| https://lite.cnn.com/ | 1291 | 1326 | 97.4% |
| https://lobste.rs/ | 553 | 566 | 97.7% |
| https://danluu.com/deconstruct-files/ | 6726 | 6580 | 102.2% |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | 2497 | 2382 | 104.8% |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 7966 | 7114 | 112.0% |
| https://www.sqlite.org/lang_select.html | 7386 | 5870 | 125.8% |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | 7035 | 4889 | 143.9% |
| https://playwright.dev/docs/api/class-page | 40689 | 21648 | 188.0% |

## Why tabs were held back

| Rule that caught it | Count |
| :--- | ---: |
| Contains form or interactive input controls | 12 |
| Short or low-confidence content | 6 |
| Stateful URL path or client-side hash route | 1 |
| Complex search/filter query state | 1 |
| Media-dominated page with little prose | 1 |

## Per-URL

| URL | Tier | Reason | Words | Inputs (ta/sel/pw/app/other) | Dirty |
| :--- | :--- | :--- | ---: | :--- | :--- |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | `safe_to_close` | Pure stateless reading article | 536 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | `safe_to_close` | Pure stateless reading article | 2845 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas · | `suspend_only` | Contains form or interactive input controls | 221 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://nodejs.org/docs/latest/api/fs.html | `safe_to_close` | Pure stateless reading article | 28865 | 0/0/0/0/0 | — |
| https://playwright.dev/docs/api/class-page | `safe_to_close` | Pure stateless reading article | 40689 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | `safe_to_close` | Pure stateless reading article | 2497 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | `safe_to_close` | Pure stateless reading article | 7035 | 0/0/0/0/0 | — |
| https://www.sqlite.org/lang_select.html | `safe_to_close` | Pure stateless reading article | 7386 | 0/0/0/0/0 | — |
| https://pkg.go.dev/net/http | `safe_to_close` | Pure stateless reading article | 12111 | 0/0/0/0/0 | Unsaved textarea content detected |
| https://docs.python.org/3/library/asyncio-task.html | `safe_to_close` | Pure stateless reading article | 5051 | 0/0/0/0/0 | — |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | `safe_to_close` | Pure stateless reading article | 28865 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | `safe_to_close` | Pure stateless reading article | 536 | 0/0/0/0/1 | — |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | `safe_to_close` | Pure stateless reading article | 5051 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples · | `suspend_only` | Contains form or interactive input controls | 221 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://en.wikipedia.org/wiki/Tab_(interface) | `safe_to_close` | Pure stateless reading article | 1473 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/Readability | `safe_to_close` | Pure stateless reading article | 7289 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/IndexedDB | `safe_to_close` | Pure stateless reading article | 570 | 0/0/0/0/0 | — |
| https://danluu.com/deconstruct-files/ | `safe_to_close` | Pure stateless reading article | 6726 | 0/0/0/0/0 | — |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | `safe_to_close` | Pure stateless reading article | 389 | 0/0/0/0/1 | — |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | `safe_to_close` | Pure stateless reading article | 616 | 0/0/0/0/0 | — |
| https://overreacted.io/a-complete-guide-to-useeffect/ | `safe_to_close` | Pure stateless reading article | 7707 | 0/0/0/0/0 | — |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | `safe_to_close` | Pure stateless reading article | 7966 | 0/0/0/0/0 | — |
| https://text.npr.org/ | `safe_to_close` | Pure stateless reading article | 241 | 0/0/0/0/0 | — |
| https://lite.cnn.com/ | `safe_to_close` | Pure stateless reading article | 1291 | 0/0/0/0/0 | — |
| https://www.bbc.com/news | `safe_to_close` | Pure stateless reading article | 1083 | 0/0/0/0/0 | — |
| https://arstechnica.com/gadgets/ | `safe_to_close` | Pure stateless reading article | 860 | 0/0/0/0/0 | — |
| https://apnews.com/hub/technology | `safe_to_close` | Pure stateless reading article | 639 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/item?id=1 · | `suspend_only` | Short or low-confidence content | 0 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/news · | `suspend_only` | Short or low-confidence content | 0 | 0/0/0/0/0 | — |
| https://lobste.rs/ | `safe_to_close` | Pure stateless reading article | 553 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/issues/1234 | `safe_to_close` | Pure stateless reading article | 159 | 0/0/0/0/0 | — |
| https://github.com/nodejs/node/pull/50000 · | `suspend_only` | Short or low-confidence content | 44 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/blob/main/README.md | `safe_to_close` | Pure stateless reading article | 582 | 0/0/0/0/1 | — |
| https://github.com/torvalds/linux · | `suspend_only` | Short or low-confidence content | 10 | 0/0/0/0/1 | — |
| https://gitlab.com/gitlab-org/gitlab | `safe_to_close` | Pure stateless reading article | 617 | 0/0/0/0/0 | — |
| https://excalidraw.com/ | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/0/2/0 | — |
| https://app.diagrams.net/ | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/0/0/3 | Unsaved form input detected |
| https://jsonformatter.org/ | `suspend_only` | Contains form or interactive input controls | 456 | 0/0/0/2/1 | Unsaved textarea content detected |
| https://regex101.com/ | `suspend_only` | Contains form or interactive input controls | 82 | 0/0/0/5/1 | Unsaved rich-text editor draft detected |
| https://petstore.swagger.io/ | `suspend_only` | Contains form or interactive input controls | 105 | 0/0/0/1/1 | — |
| https://codepen.io/pen/ | `suspend_only` | Contains form or interactive input controls | 0 | 3/0/0/3/0 | — |
| https://news.ycombinator.com/login | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/2/0/4 | — |
| https://the-internet.herokuapp.com/login | `suspend_only` | Contains form or interactive input controls | 30 | 0/0/1/0/2 | — |
| https://demoqa.com/automation-practice-form | `suspend_only` | Contains form or interactive input controls | 3 | 1/0/0/0/14 | — |
| https://the-internet.herokuapp.com/tinymce | `suspend_only` | Contains form or interactive input controls | 43 | 0/0/0/1/0 | — |
| https://www.amazon.com/gp/cart/view.html | `suspend_only` | Stateful URL path or client-side hash route | 63 | 0/0/0/0/0 | — |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | `suspend_only` | Short or low-confidence content | 30 | 0/0/0/0/0 | — |
| https://www.google.com/search?q=playwright+headless+extension&num=20 | `suspend_only` | Complex search/filter query state | 0 | 0/0/0/0/0 | — |
| https://pypi.org/search/?q=readability | `suspend_only` | Short or low-confidence content | 8 | 0/0/0/0/1 | — |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | `suspend_only` | Media-dominated page with little prose | 235 | 0/0/0/0/1 | — |

## Unreachable

| URL | Error |
| :--- | :--- |
| https://www.etsy.com/cart | HTTP 403 |
| https://github.com/search?q=tab+suspender&type=repositories | HTTP 429 |
