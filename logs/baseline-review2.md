# Closure Ratio Report

**Run**: 2026-09-15T05:17:24.212Z  
**Corpus**: `tests/fixtures/corpus.txt` (53 URLs, 51 reachable, 2 failed)  
**Close-rate floor**: 80%

## Gate

| Metric | Value | Requirement |
| :--- | ---: | :--- |
| **Must-suspend leaks** | **0** | must be 0 — a leak is data loss |
| Close recall (of 35 expect:close) | 88.6% | >= 80% |
| Must-suspend pages measured | 16 of 18 | the leak gate only sees these |

## Tier split (all reachable, for continuity with the baseline)

| Tier | Count | % of reachable |
| :--- | ---: | ---: |
| `safe_to_close` | 32 | 62.7% |
| `suspend_only` | 19 | 37.3% |

> Tier is the policy verdict only. The shipped hybrid path gates closing further
> on an AI summary (`canCloseWith`), so the real-world close rate is this number
> times the AI-summary hit rate.

## Reading pages still held open

| URL | Rule that caught it | Words |
| :--- | :--- | ---: |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | Contains form or interactive input controls | 272 |
| https://pkg.go.dev/net/http | Pure stateless reading article | 20412 |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | Contains form or interactive input controls | 272 |
| https://news.ycombinator.com/item?id=1 | Short or low-confidence content | 103 |

## Extraction recall

25% is a reporting aid to flag rows below for attention, not a gate — see EXTRACTION_PLAN.md Step 1.

| URL | Extracted words | Body words | Recall |
| :--- | ---: | ---: | ---: |
| https://www.amazon.com/gp/cart/view.html ⚠️ | 63 | 769 | 8.2% |
| https://app.diagrams.net/ ⚠️ | 8 | 82 | 9.8% |
| https://demoqa.com/automation-practice-form ⚠️ | 10 | 52 | 19.2% |
| https://play2048.co/ ⚠️ | 8 | 36 | 22.2% |
| https://codepen.io/pen/ | 18 | 54 | 33.3% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas | 272 | 728 | 37.4% |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples | 272 | 728 | 37.4% |
| https://regex101.com/ | 113 | 276 | 40.9% |
| https://jsonformatter.org/ | 492 | 1131 | 43.5% |
| https://news.ycombinator.com/login | 6 | 10 | 60.0% |
| https://github.com/nodejs/node/pull/50000 | 242 | 388 | 62.4% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | 572 | 880 | 65.0% |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | 572 | 880 | 65.0% |
| https://excalidraw.com/ | 42 | 64 | 65.6% |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | 277 | 414 | 66.9% |
| https://petstore.swagger.io/ | 181 | 270 | 67.0% |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | 30 | 40 | 75.0% |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | 391 | 521 | 75.0% |
| https://apnews.com/hub/technology | 870 | 1143 | 76.1% |
| https://github.com/microsoft/playwright/issues/1234 | 359 | 454 | 79.1% |
| https://en.wikipedia.org/wiki/IndexedDB | 637 | 789 | 80.7% |
| https://www.bbc.com/news | 1133 | 1388 | 81.6% |
| https://pypi.org/search/?q=readability | 11 | 13 | 84.6% |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | 2020 | 2382 | 84.8% |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | 4161 | 4889 | 85.1% |
| https://the-internet.herokuapp.com/tinymce | 47 | 55 | 85.5% |
| https://lobste.rs/ | 489 | 571 | 85.6% |
| https://arstechnica.com/gadgets/ | 1080 | 1256 | 86.0% |
| https://en.wikipedia.org/wiki/Tab_(interface) | 1559 | 1809 | 86.2% |
| https://the-internet.herokuapp.com/login | 34 | 39 | 87.2% |
| https://github.com/microsoft/playwright/blob/main/README.md | 964 | 1101 | 87.6% |
| https://gitlab.com/gitlab-org/gitlab | 1196 | 1353 | 88.4% |
| https://github.com/torvalds/linux | 838 | 948 | 88.4% |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | 619 | 686 | 90.2% |
| https://nodejs.org/docs/latest/api/fs.html | 28533 | 31154 | 91.6% |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | 28533 | 31153 | 91.6% |
| https://en.wikipedia.org/wiki/Readability | 7745 | 8444 | 91.7% |
| https://text.npr.org/ | 241 | 261 | 92.3% |
| https://docs.python.org/3/library/asyncio-task.html | 6094 | 6476 | 94.1% |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | 6094 | 6476 | 94.1% |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | 2892 | 3072 | 94.1% |
| https://playwright.dev/docs/api/class-page | 20829 | 21648 | 96.2% |
| https://lite.cnn.com/ | 1278 | 1311 | 97.5% |
| https://www.sqlite.org/lang_select.html | 5724 | 5870 | 97.5% |
| https://pkg.go.dev/net/http | 20412 | 20925 | 97.5% |
| https://news.ycombinator.com/item?id=1 | 103 | 104 | 99.0% |
| https://danluu.com/deconstruct-files/ | 6517 | 6580 | 99.0% |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 7070 | 7114 | 99.4% |
| https://overreacted.io/a-complete-guide-to-useeffect/ | 10196 | 10242 | 99.6% |
| https://news.ycombinator.com/news | 686 | 687 | 99.9% |
| https://www.google.com/search?q=playwright+headless+extension&num=20 | 40 | 40 | 100.0% |

## Why tabs were held back

| Rule that caught it | Count |
| :--- | ---: |
| Contains form or interactive input controls | 13 |
| Short or low-confidence content | 3 |
| Stateful URL path or client-side hash route | 1 |
| Complex search/filter query state | 1 |
| Media-dominated page with little prose | 1 |

## Per-URL

| URL | Tier | Reason | Words | Inputs (ta/sel/pw/app/other) | Dirty |
| :--- | :--- | :--- | ---: | :--- | :--- |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch | `safe_to_close` | Pure stateless reading article | 572 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise | `safe_to_close` | Pure stateless reading article | 2892 | 0/0/0/0/1 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas · | `suspend_only` | Contains form or interactive input controls | 272 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://nodejs.org/docs/latest/api/fs.html | `safe_to_close` | Pure stateless reading article | 28533 | 0/0/0/0/0 | — |
| https://playwright.dev/docs/api/class-page | `safe_to_close` | Pure stateless reading article | 20829 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/scripting | `safe_to_close` | Pure stateless reading article | 2020 | 0/0/0/0/0 | — |
| https://developer.chrome.com/docs/extensions/reference/api/tabs | `safe_to_close` | Pure stateless reading article | 4161 | 0/0/0/0/0 | — |
| https://www.sqlite.org/lang_select.html | `safe_to_close` | Pure stateless reading article | 5724 | 0/0/0/0/0 | — |
| https://pkg.go.dev/net/http | `safe_to_close` | Pure stateless reading article | 20412 | 0/0/0/0/0 | Unsaved textarea content detected |
| https://docs.python.org/3/library/asyncio-task.html | `safe_to_close` | Pure stateless reading article | 6094 | 0/0/0/0/0 | — |
| https://nodejs.org/docs/latest/api/fs.html#fspromisesreadfilepath-options | `safe_to_close` | Pure stateless reading article | 28533 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/API/fetch#syntax | `safe_to_close` | Pure stateless reading article | 572 | 0/0/0/0/1 | — |
| https://docs.python.org/3/library/asyncio-task.html#creating-tasks | `safe_to_close` | Pure stateless reading article | 6094 | 0/0/0/0/0 | — |
| https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas#examples · | `suspend_only` | Contains form or interactive input controls | 272 | 0/0/0/6/1 | Unsaved rich-text editor draft detected |
| https://en.wikipedia.org/wiki/Tab_(interface) | `safe_to_close` | Pure stateless reading article | 1559 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/Readability | `safe_to_close` | Pure stateless reading article | 7745 | 0/0/0/0/0 | — |
| https://en.wikipedia.org/wiki/IndexedDB | `safe_to_close` | Pure stateless reading article | 637 | 0/0/0/0/0 | — |
| https://danluu.com/deconstruct-files/ | `safe_to_close` | Pure stateless reading article | 6517 | 0/0/0/0/0 | — |
| https://jvns.ca/blog/2022/04/12/a-list-of-new-ish--command-line-tools/ | `safe_to_close` | Pure stateless reading article | 391 | 0/0/0/0/1 | — |
| https://martinfowler.com/articles/patterns-of-distributed-systems/ | `safe_to_close` | Pure stateless reading article | 619 | 0/0/0/0/0 | — |
| https://overreacted.io/a-complete-guide-to-useeffect/ | `safe_to_close` | Pure stateless reading article | 10196 | 0/0/0/0/0 | — |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | `safe_to_close` | Pure stateless reading article | 7070 | 0/0/0/0/0 | — |
| https://text.npr.org/ | `safe_to_close` | Pure stateless reading article | 241 | 0/0/0/0/0 | — |
| https://lite.cnn.com/ | `safe_to_close` | Pure stateless reading article | 1278 | 0/0/0/0/0 | — |
| https://www.bbc.com/news | `safe_to_close` | Pure stateless reading article | 1133 | 0/0/0/0/0 | — |
| https://arstechnica.com/gadgets/ | `safe_to_close` | Pure stateless reading article | 1080 | 0/0/0/0/0 | — |
| https://apnews.com/hub/technology | `safe_to_close` | Pure stateless reading article | 870 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/item?id=1 · | `suspend_only` | Short or low-confidence content | 103 | 0/0/0/0/0 | — |
| https://news.ycombinator.com/news | `safe_to_close` | Pure stateless reading article | 686 | 0/0/0/0/0 | — |
| https://lobste.rs/ | `safe_to_close` | Pure stateless reading article | 489 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/issues/1234 | `safe_to_close` | Pure stateless reading article | 359 | 0/0/0/0/0 | — |
| https://github.com/nodejs/node/pull/50000 | `safe_to_close` | Pure stateless reading article | 242 | 0/0/0/0/0 | — |
| https://github.com/microsoft/playwright/blob/main/README.md | `safe_to_close` | Pure stateless reading article | 964 | 0/0/0/0/1 | — |
| https://github.com/torvalds/linux | `safe_to_close` | Pure stateless reading article | 838 | 0/0/0/0/1 | — |
| https://gitlab.com/gitlab-org/gitlab | `safe_to_close` | Pure stateless reading article | 1196 | 0/0/0/0/0 | — |
| https://excalidraw.com/ | `suspend_only` | Contains form or interactive input controls | 42 | 0/0/0/2/0 | — |
| https://app.diagrams.net/ | `suspend_only` | Contains form or interactive input controls | 8 | 0/0/0/0/3 | Unsaved form input detected |
| https://jsonformatter.org/ | `suspend_only` | Contains form or interactive input controls | 492 | 0/0/0/2/1 | Unsaved textarea content detected |
| https://regex101.com/ | `suspend_only` | Contains form or interactive input controls | 113 | 0/0/0/5/1 | Unsaved rich-text editor draft detected |
| https://petstore.swagger.io/ | `suspend_only` | Contains form or interactive input controls | 181 | 0/0/0/1/1 | — |
| https://codepen.io/pen/ | `suspend_only` | Contains form or interactive input controls | 18 | 3/0/0/3/0 | — |
| https://play2048.co/ | `suspend_only` | Contains form or interactive input controls | 8 | 0/0/0/1/0 | — |
| https://news.ycombinator.com/login | `suspend_only` | Contains form or interactive input controls | 6 | 0/0/2/0/4 | — |
| https://the-internet.herokuapp.com/login | `suspend_only` | Contains form or interactive input controls | 34 | 0/0/1/0/2 | — |
| https://demoqa.com/automation-practice-form | `suspend_only` | Contains form or interactive input controls | 10 | 1/0/0/0/14 | — |
| https://the-internet.herokuapp.com/tinymce | `suspend_only` | Contains form or interactive input controls | 47 | 0/0/0/1/0 | — |
| https://www.amazon.com/gp/cart/view.html | `suspend_only` | Stateful URL path or client-side hash route | 63 | 0/0/0/0/0 | — |
| https://duckduckgo.com/?q=chrome+extension+tab+discard&ia=web | `suspend_only` | Short or low-confidence content | 30 | 0/0/0/0/0 | — |
| https://www.google.com/search?q=playwright+headless+extension&num=20 | `suspend_only` | Complex search/filter query state | 40 | 0/0/0/0/0 | — |
| https://pypi.org/search/?q=readability | `suspend_only` | Short or low-confidence content | 11 | 0/0/0/0/1 | — |
| https://www.youtube.com/watch?v=dQw4w9WgXcQ | `suspend_only` | Media-dominated page with little prose | 277 | 0/0/0/0/1 | — |

## Unreachable

| URL | Error |
| :--- | :--- |
| https://www.etsy.com/cart | HTTP 403 |
| https://github.com/search?q=tab+suspender&type=repositories | HTTP 429 |
