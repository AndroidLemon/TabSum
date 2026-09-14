# Closure Ratio Report

**Run**: 2026-09-14T22:54:11.181Z  
**Corpus**: `tests/fixtures/corpus.txt` (52 URLs, 49 reachable, 3 failed)  
**Close-rate floor**: 77%

## Gate

| Metric | Value | Requirement |
| :--- | ---: | :--- |
| **Must-suspend leaks** | **0** | must be 0 — a leak is data loss |
| Close recall (of 35 expect:close) | 82.9% | >= 77% |
| Must-suspend pages measured | 14 of 17 | the leak gate only sees these |

## Tier split (all reachable, for continuity with the baseline)

| Tier | Count | % of reachable |
| :--- | ---: | ---: |
| `safe_to_close` | 30 | 61.2% |
| `suspend_only` | 19 | 38.8% |

> Tier is the policy verdict only. The shipped hybrid path gates closing further
> on an AI summary (`canCloseWith`), so the real-world close rate is this number
> times the AI-summary hit rate.

## Reading pages still held open

| URL | Rule that caught it | Words |
| :--- | :--- | ---: |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | Contains form or interactive input controls | 245 |
| https://pkg.go.dev/net/http | Pure stateless reading article | 12269 |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | Contains form or interactive input controls | 245 |
| https://news.ycombinator.com/item?id=1 | Short or low-confidence content | 0 |
| https://news.ycombinator.com/news | Short or low-confidence content | 0 |
| https://github.com/torvalds/linux | Short or low-confidence content | 19 |

## Extraction recall

25% is a reporting aid to flag rows below for attention, not a gate — see EXTRACTION_PLAN.md Step 1.

| URL | Extracted words | Body words | Recall |
| :--- | ---: | ---: | ---: |
| https://news.ycombinator.com/item?id=1 ⚠️ | 0 | 104 | 0.0% |
| https://news.ycombinator.com/news ⚠️ | 0 | 676 | 0.0% |
| https://excalidraw.com/ ⚠️ | 0 | 64 | 0.0% |
| https://app.diagrams.net/ ⚠️ | 0 | 82 | 0.0% |
| https://news.ycombinator.com/login ⚠️ | 0 | 10 | 0.0% |
| https://www.google.com/search?q=playwright+headless+extension&num=20 ⚠️ | 0 | 40 | 0.0% |
| https://github.com/torvalds/linux ⚠️ | 19 | 948 | 2.0% |
| https://demoqa.com/automation-practice-form ⚠️ | 7 | 52 | 13.5% |
| https://regex101.com/ ⚠️ | 68 | 285 | 23.9% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | 245 | 728 | 33.7% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | 245 | 728 | 33.7% |
| https://petstore.swagger.io/ | 102 | 270 | 37.8% |
| https://github.com/microsoft/playwright/issues/1234 | 183 | 454 | 40.3% |
| https://jsonformatter.org/ | 456 | 1127 | 40.5% |
| https://github.com/microsoft/playwright/blob/main/README.md | 602 | 1101 | 54.7% |
| https://apnews.com/hub/technology | 639 | 1108 | 57.7% |
| https://pkg.go.dev/net/http | 12269 | 20925 | 58.6% |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | 262 | 425 | 61.6% |
| https://gitlab.com/gitlab-org/gitlab | 760 | 1187 | 64.0% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | 572 | 880 | 65.0% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | 572 | 880 | 65.0% |
| https://arstechnica.com/gadgets/ | 860 | 1253 | 68.6% |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | 389 | 521 | 74.7% |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | 30 | 40 | 75.0% |
| https://overreacted.io/a-complete-guide-to-useeffect/ | 7688 | 10242 | 75.1% |
| https://the-internet.herokuapp.com/login | 30 | 39 | 76.9% |
| https://docs.python.org/3/library/asyncio-task.html | 5054 | 6476 | 78.0% |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | 5054 | 6476 | 78.0% |
| https://the-internet.herokuapp.com/tinymce | 43 | 55 | 78.2% |
| https://www.bbc.com/news | 1084 | 1345 | 80.6% |
| https://en.wikipedia.org/wiki/IndexedDB | 641 | 789 | 81.2% |
| https://en.wikipedia.org/wiki/Tab_(interface) | 1557 | 1809 | 86.1% |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | 616 | 686 | 89.8% |
| https://en.wikipedia.org/wiki/Readability | 7480 | 8133 | 92.0% |
| https://text.npr.org/ | 241 | 261 | 92.3% |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | 2881 | 3072 | 93.8% |
| https://lite.cnn.com/ | 1300 | 1335 | 97.4% |
| https://github.com/nodejs/node/pull/50000 | 385 | 388 | 99.2% |
| https://danluu.com/deconstruct-files/ | 6726 | 6580 | 102.2% |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | 2534 | 2382 | 106.4% |
| https://nodejs.org/docs/latest/api/fs.html | 33142 | 31154 | 106.4% |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | 33142 | 31153 | 106.4% |
| https://lobste.rs/ | 624 | 566 | 110.2% |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 7974 | 7114 | 112.1% |
| https://pypi.org/search/?q=readability | 16 | 13 | 123.1% |
| https://www.sqlite.org/lang_select.html | 7446 | 5870 | 126.8% |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | 7127 | 4889 | 145.8% |
| https://playwright.dev/docs/api/class-page | 40527 | 21648 | 187.2% |
| https://codepen.io/pen/ | 1120 | 52 | 2153.8% |

## Why tabs were held back

| Rule that caught it | Count |
| :--- | ---: |
| Contains form or interactive input controls | 12 |
| Short or low-confidence content | 5 |
| Complex search/filter query state | 1 |
| Media-dominated page with little prose | 1 |

## Per-URL

| URL | Tier | Reason | Words | Inputs (ta/sel/pw/app/other) | Dirty |
| :--- | :--- | :--- | ---: | :--- | :--- |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | `safe_to_close` | Pure stateless reading article | 572 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | `safe_to_close` | Pure stateless reading article | 2881 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas · | `suspend_only` | Contains form or interactive input controls | 245 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://nodejs.org/docs/latest/api/fs.html | `safe_to_close` | Pure stateless reading article | 33142 | 0/0/0/0/0 | — |
| https://playwright.dev/docs/api/class-page | `safe_to_close` | Pure stateless reading article | 40527 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | `safe_to_close` | Pure stateless reading article | 2534 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | `safe_to_close` | Pure stateless reading article | 7127 | 0/0/0/0/0 | — |
| https://www.sqlite.org/lang_select.html | `safe_to_close` | Pure stateless reading article | 7446 | 0/0/0/0/0 | — |
| https://pkg.go.dev/net/http | `safe_to_close` | Pure stateless reading article | 12269 | 0/0/0/0/0 | Unsaved textarea content detected |
| https://docs.python.org/3/library/asyncio-task.html | `safe_to_close` | Pure stateless reading article | 5054 | 0/0/0/0/0 | — |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | `safe_to_close` | Pure stateless reading article | 33142 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | `safe_to_close` | Pure stateless reading article | 572 | 0/0/0/0/1 | — |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | `safe_to_close` | Pure stateless reading article | 5054 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples · | `suspend_only` | Contains form or interactive input controls | 245 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://en.wikipedia.org/wiki/Tab_(interface) | `safe_to_close` | Pure stateless reading article | 1557 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/Readability | `safe_to_close` | Pure stateless reading article | 7480 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/IndexedDB | `safe_to_close` | Pure stateless reading article | 641 | 0/0/0/0/0 | — |
| https://danluu.com/deconstruct-files/ | `safe_to_close` | Pure stateless reading article | 6726 | 0/0/0/0/0 | — |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | `safe_to_close` | Pure stateless reading article | 389 | 0/0/0/0/1 | — |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | `safe_to_close` | Pure stateless reading article | 616 | 0/0/0/0/0 | — |
| https://overreacted.io/a-complete-guide-to-useeffect/ | `safe_to_close` | Pure stateless reading article | 7688 | 0/0/0/0/0 | — |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | `safe_to_close` | Pure stateless reading article | 7974 | 0/0/0/0/0 | — |
| https://text.npr.org/ | `safe_to_close` | Pure stateless reading article | 241 | 0/0/0/0/0 | — |
| https://lite.cnn.com/ | `safe_to_close` | Pure stateless reading article | 1300 | 0/0/0/0/0 | — |
| https://www.bbc.com/news | `safe_to_close` | Pure stateless reading article | 1084 | 0/0/0/0/0 | — |
| https://arstechnica.com/gadgets/ | `safe_to_close` | Pure stateless reading article | 860 | 0/0/0/0/0 | — |
| https://apnews.com/hub/technology | `safe_to_close` | Pure stateless reading article | 639 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/item?id=1 · | `suspend_only` | Short or low-confidence content | 0 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/news · | `suspend_only` | Short or low-confidence content | 0 | 0/0/0/0/0 | — |
| https://lobste.rs/ | `safe_to_close` | Pure stateless reading article | 624 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/issues/1234 | `safe_to_close` | Pure stateless reading article | 183 | 0/0/0/0/0 | — |
| https://github.com/nodejs/node/pull/50000 | `safe_to_close` | Pure stateless reading article | 385 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/blob/main/README.md | `safe_to_close` | Pure stateless reading article | 602 | 0/0/0/0/1 | — |
| https://github.com/torvalds/linux · | `suspend_only` | Short or low-confidence content | 19 | 0/0/0/0/1 | — |
| https://gitlab.com/gitlab-org/gitlab | `safe_to_close` | Pure stateless reading article | 760 | 0/0/0/0/0 | — |
| https://excalidraw.com/ | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/0/2/0 | — |
| https://app.diagrams.net/ | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/0/0/3 | Unsaved form input detected |
| https://jsonformatter.org/ | `suspend_only` | Contains form or interactive input controls | 456 | 0/0/0/2/1 | Unsaved textarea content detected |
| https://regex101.com/ | `suspend_only` | Contains form or interactive input controls | 68 | 0/0/0/5/1 | Unsaved rich-text editor draft detected |
| https://petstore.swagger.io/ | `suspend_only` | Contains form or interactive input controls | 102 | 0/0/0/1/1 | — |
| https://codepen.io/pen/ | `suspend_only` | Contains form or interactive input controls | 1120 | 3/0/0/3/0 | — |
| https://news.ycombinator.com/login | `suspend_only` | Contains form or interactive input controls | 0 | 0/0/2/0/4 | — |
| https://the-internet.herokuapp.com/login | `suspend_only` | Contains form or interactive input controls | 30 | 0/0/1/0/2 | — |
| https://demoqa.com/automation-practice-form | `suspend_only` | Contains form or interactive input controls | 7 | 1/0/0/0/14 | — |
| https://the-internet.herokuapp.com/tinymce | `suspend_only` | Contains form or interactive input controls | 43 | 0/0/0/1/0 | — |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | `suspend_only` | Short or low-confidence content | 30 | 0/0/0/0/0 | — |
| https://www.google.com/search?q=playwright+headless+extension&num=20 | `suspend_only` | Complex search/filter query state | 0 | 0/0/0/0/0 | — |
| https://pypi.org/search/?q=readability | `suspend_only` | Short or low-confidence content | 16 | 0/0/0/0/1 | — |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | `suspend_only` | Media-dominated page with little prose | 262 | 0/0/0/0/1 | — |

## Unreachable

| URL | Error |
| :--- | :--- |
| https://www.amazon.com/gp/cart/view.html | HTTP 503 |
| https://www.etsy.com/cart | HTTP 403 |
| https://github.com/search?q=tab+suspender&type=repositories | HTTP 429 |
