# TabSum 📑✨

> **Turn neglected browser tabs into an organized personal knowledge wiki—without losing your open loops.**

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)
![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_First-10B981)
![AI Engine](https://img.shields.io/badge/AI-Gemini_Nano_%2F_Local_LLM_%2F_Gemini_Flash_%2F_Heuristics-6366F1)
![Storage](https://img.shields.io/badge/Storage-IndexedDB_%2B_Fading-F59E0B)
![Tests](https://img.shields.io/badge/Tests-Playwright_%26_Unit_Passing-10B981)
![License](https://img.shields.io/badge/License-MIT-gray)

---

## 📖 Table of Contents

- [The Problem: Tab Hoarding is Working Memory Overload](#-the-problem-tab-hoarding-is-working-memory-overload)
- [The Solution: TabSum](#-the-solution-tabsum)
- [🚀 Key Features](#-key-features)
  - [⚡ Tiered Hybrid Adaptive Archival](#-tiered-hybrid-adaptive-archival)
  - [🛡️ Deep Safety Checks Before Archival](#️-deep-safety-checks-before-archival)
  - [🧠 Multi-Tier Summarization Pipeline](#-multi-tier-summarization-pipeline)
  - [📚 Personal Knowledge Wiki & Side Panel](#-personal-knowledge-wiki--side-panel)
  - [📤 Obsidian, Markdown & JSON Export](#-obsidian-markdown--json-export)
  - [⌨️ Global Keyboard Shortcuts & In-Panel Navigation](#️-global-keyboard-shortcuts--in-panel-navigation)
  - [🔄 Smart In-Place Tab Reactivation](#-smart-in-place-tab-reactivation)
- [🛠️ Architecture & Codebase Map](#️-architecture--codebase-map)
- [📦 Installation & Setup](#-installation--setup)
- [⚙️ Configuration & Archival Modes](#️-configuration--archival-modes)
- [⌨️ Keyboard Shortcuts Reference](#️-keyboard-shortcuts-reference)
- [🧪 Automated Testing & Dogfooding](#-automated-testing--dogfooding)
- [🔒 Privacy & Security Principles](#-privacy--security-principles)
- [📄 License](#-license)

---

## 🤯 The Problem: Tab Hoarding is Working Memory Overload

We open dozens or hundreds of tabs intending to read them later, but our browser tab bar quickly degrades into an unmanageable cognitive burden.

Closing a tab feels like discarding a thought or abandoning an idea, so we hoard them. Traditional tab suspenders (like *The Great Suspender* or Chrome's native memory saver) freeze tabs in place, leaving dozens of tiny, unreadable favicon slivers that clutter your workspace, increase visual distraction, and offer no searchable record of what you accumulated.

---

## 💡 The Solution: TabSum

**TabSum** is an intelligent, privacy-first Manifest V3 Chrome extension that continuously monitors inactive background tabs. When tabs remain untouched past your configured threshold, TabSum:

1. **Conducts Deep Safety Checks**: Scans for active inputs, rich text editors (ProseMirror, Quill, Monaco, CodeMirror), audio/video playback, and pinned status before touching anything.
2. **Distills Core Knowledge**: Extracts clean article text, metadata, and reading time using an in-tab CSS-selector heuristic extractor that strips common boilerplate (navigation, headers/footers, sidebars, ads, cookie banners).
3. **Generates Multi-Tier Summaries**: Synthesizes a 1-sentence **TL;DR**, 3–5 **bullet takeaways**, and **topic tags** using Chrome's on-device model, a local OpenAI-compatible server, or a Gemini key, falling back to fast offline heuristics for the summary. Tags are only added when an AI tier wrote the summary.
4. **Executes Tiered Adaptive Archival**: Closes plain reading pages and suspends interactive ones (freeing their memory while keeping them in the tab strip, marked `💤`), then closes long-suspended tabs later — but it only closes a tab when an AI-written summary exists, so closing never loses the gist. Everything closed today is listed under **Closed today** for one-click reopening.
5. **Organizes Your Personal Wiki**: Indexes every tab into a searchable, local IndexedDB knowledge base with **1-click restore**, available as a compact view in the Chrome Side Panel or as a full-page, Notion-style view in a tab (the same page, adapting to its width).

---

## 🚀 Key Features

### ⚡ Tiered Hybrid Adaptive Archival

In the default **Smart Hybrid** mode, TabSum acts in two steps. Time you spend away from the computer (idle, locked, or asleep) doesn't count toward either threshold.

- **At the inactivity threshold (e.g. 60 min)**: TabSum summarizes the tab, then:
  - **Closes** plain reading pages (no forms, editors, dialogs, or stateful URLs like checkouts).
  - **Suspends** everything else with `chrome.tabs.discard()`, freeing its memory while keeping it in your tab strip with a `💤 ` prefix on its title.
- **At twice the threshold**: tabs TabSum suspended that you still haven't touched are closed; their summary was already saved when they were suspended.
- **Closing requires an AI-written summary** (Chrome's on-device model, a local OpenAI-compatible server, or your Gemini key). With only the offline heuristic summary available, the tab is suspended instead. Toggle this under **Only Close Tabs With an AI Summary**.
- **No per-tab desktop notifications**: closed tabs collect in a **Closed today** list at the top of the Knowledge Hub, where you can review and reopen them on your own schedule.

*(Options also offers **Soft Suspend All** — never close — and **Auto-Close All**.)*

### 🛡️ Deep Safety Checks Before Archival

TabSum runs a battery of pre-archival checks intended to avoid touching tabs you're still using. No automated heuristic is infallible, but coverage includes:

- **Deep Form & Rich Text Inspection**: Scans standard `<input>`, `<textarea>`, and `<select>` elements, traverses **nested Shadow DOM** trees, and detects modern web editors:
  - `[role="textbox"]`, `[contenteditable="true"]`
  - **ProseMirror** (Google Docs, Notion-like editors)
  - **Quill**, **Draft.js**, **Monaco Editor** (VS Code Web), and **CodeMirror**
- **Media Playback Lock**: Tabs actively playing sound, video conferences, or podcasts (`audible: true`) are unconditionally spared.
- **Pinned Tab Lock**: Pinned tabs are strictly preserved by default (`ignorePinnedTabs: true`).
- **Domain Whitelist**: A listed domain also covers its subdomains (`google.com` covers `docs.google.com`); defaults include Gmail, Google Docs/Drive/Calendar, GitHub, GitLab, Slack, Teams, YouTube, Spotify, and Netflix.
- **Crash Resilience**: The archive record is fully written before a tab is closed or suspended, so an interrupted service worker can't lose it. If Chrome refuses to close or suspend a tab, the note is kept as `📑 Saved` with the reason recorded.
- **Last-Moment Re-Check**: After summarizing, TabSum re-checks that you haven't switched to the tab or started audio in it before saving or closing anything.

### 🧠 Multi-Tier Summarization Pipeline

TabSum provides four summarization tiers; pick one under **AI Provider** in Options:

| Tier | Engine | Speed | Privacy | Requirements |
| :--- | :--- | :---: | :---: | :--- |
| **Tier 0** | **Algorithmic Heuristics** | Instant | 100% Offline | None (zero dependencies; lead-sentence extraction; no tags) |
| **Tier 1** | **Chrome Prompt API** | Device-dependent | 100% On-Device | Gemini Nano built into Chrome (`LanguageModel`), used only when already downloaded. This is what **Auto** uses. |
| **Tier 2** | **Google Gemini Flash** | Network-dependent | Cloud, your key | Gemini API key stored locally in `chrome.storage.local` |
| **Tier 3** | **Local / OpenAI-compatible server** | Hardware-dependent | Your server | Any `/v1/chat/completions` endpoint (Ollama, LM Studio, oMLX, llama.cpp, vLLM). Set URL, model and optional key in Options; **Test Connection** grants access and lists models. Responses are streamed, with a 2-minute cap. Ollama may need `OLLAMA_ORIGINS=chrome-extension://*`. |

*If the chosen AI tier is unavailable, errors, or times out (20 s for cloud/on-device, 2 min for local servers), the summary falls back to Tier 0 — and a tab with only a Tier 0 summary is suspended rather than closed.*

### 📚 Personal Knowledge Wiki & Side Panel

The side panel and the full view are one page (`src/app/`), so every feature below works in both. At side-panel widths it shows a single column of cards with a **Filters** drawer (views, timeline, favorites, tags, domains, export, settings); in a wide tab it shows a persistent sidebar and a multi-column card grid. The side panel additionally offers **Archive Current Tab** and **Open full view**.

- **Full-Text Search with Highlighting**: Searches titles, URLs, summaries, tags, and the saved page text, highlighting matches on the cards. Includes a `✕` clear button and a `/` shortcut hint.
- **Comfortable / Compact Density**: Toggle between detailed cards and a denser list; the choice is remembered.
- **Progressive Disclosure**: At narrow widths, cards stay clean with 1-sentence TL;DRs while 3–5 bullet takeaways expand via a disclosure toggle (`▸ Key Takeaways (3)`); wide layouts show takeaways inline.
- **Forgiving Undo**: Deleting a card saves the deletion immediately and shows a toast with a 5-second **Undo** button and countdown bar. Deleted notes are permanently purged an hour later.
- **Inbox, Reopened & Fading**: The Side Panel opens on your **Inbox**: captures you haven't dealt with (the full view opens on all summaries; the Inbox / Reopened / All switch is always one click away). Reopening a tab (from TabSum, or by returning to a suspended tab) moves its note to **Reopened**, still searchable. Unstarred notes fade (are deleted) automatically: 30 days after capture if never reopened, 7 days after the last reopen otherwise (both configurable; 0 = never). Notes close to fading show a `Fades in Nd` chip; star a note to keep it forever. Capturing the same page again puts it back in the Inbox with a fresh clock.
- **One-Click Full View**: Open the full-page view in a tab with 1 click; the side panel automatically closes to keep your screen distraction-free.
- **Multi-Attribute Sorting**:
  - 🕒 **Newest Added** (Default)
  - ⏳ **Oldest Added**
  - ⚡ **Quick Reads** ($\le 3$ minutes reading time)
  - 📖 **Deep Dives** (Long-form articles)
  - 🔤 **Title (A–Z)**
  - 🌐 **Domain / Source (A–Z)**
  - ⌛ **Expiring Soon** (notes closest to fading first)
- **Status Badges**: Visual indicators distinguish tab states at a glance:
  - `💤 Sleeping` (Tab discarded from RAM, still open in browser)
  - `↩ Reopened` (Tab was restored and is active again)
  - `📑 Saved` (Summary saved while the tab stays open: a manual archive, or Chrome refused to close/suspend it)
  - `🗄️ Archived` (Tab closed and preserved in Knowledge Wiki)
- **Reader View**: Opens the saved page text in a `<dialog>` with comfortable reading typography; Escape or a click outside closes it.
- **Favorites (`⭐`)**: Star a card to keep it forever (it never fades) and find it under **Favorites**.
- **Tags, Domains & Timeline**: Filter by AI-generated tags, top domains, or time (*Today*, *Yesterday*, *Past 7 Days*); clicking a tag on a card filters by it too.

### 📤 Obsidian, Markdown & JSON Export

Export your accumulated knowledge into your favorite external PKM (Personal Knowledge Management) tool:

- **Obsidian Vault Format**: Downloads a `.zip` archive containing one `.md` note per tab, each with YAML frontmatter (`title`, `url`, `captured_at`, `reading_time_minutes`, `tags`) that Obsidian reads as properties and tags.
- **Standard Markdown**: Clean GitHub-flavored markdown export ideal for Notion, Logseq, or personal repositories.
- **JSON Backup & Import**: Export all IndexedDB records, metadata, summaries, and extracted text to a JSON file, and re-import that file later from the Options page (`Import JSON`) to restore it.

### ⌨️ Global Keyboard Shortcuts & In-Panel Navigation

- **Global Hotkeys**:
  - `Command+Shift+S` (Mac) / `Ctrl+Shift+S` (Win/Linux): Open the Side Panel (Knowledge Hub).
  - `Command+Shift+E` (Mac) / `Ctrl+Shift+E` (Win/Linux): Summarize the active tab and save it to the wiki now (the tab stays open).
- **Keyboard Navigation (side panel & full view)**:
  - `j` or `↓`: Select next knowledge card.
  - `k` or `↑`: Select previous knowledge card.
  - `Enter`: Restore and reopen the selected tab.
  - `/`: Focus search input.
  - `Escape`: Clear search / close the reader view.

### 🔄 Smart In-Place Tab Reactivation

Restoring a tab from the Side Panel or the full view checks whether that URL is already open in any window. If the tab still exists (active or sleeping), TabSum **switches directly to it in-place** rather than creating redundant, duplicate tabs.

---

## 🛠️ Architecture & Codebase Map

```
TabSum/
├── manifest.json                  # Manifest V3 manifest, permissions & global shortcuts
├── package.json                   # Project scripts and Playwright test runner dependencies
├── CHROMEWEBSTORE.md              # Chrome Web Store listing metadata & privacy disclosures
├── LICENSE                        # MIT
├── DOGFOOD_REPORT.md              # Generated by `npm run test:dogfood` — not tracked in git
├── dist/                          # Generated by `npm run package` — not tracked in git
├── src/
│   ├── assets/
│   │   └── icons/                 # 16px, 48px, 128px extension icon assets
│   ├── background/
│   │   └── service-worker.js      # Inactivity tracking (idle/sleep aware), sweeps, hybrid close/suspend engine, fading
│   ├── content/
│   │   └── in-tab-extractor.js    # In-tab CSS-selector extraction heuristic, shadow DOM / dirty form guards, & title badge
│   ├── ai/
│   │   └── summarizer.js          # Heuristic (Tier 0), Chrome Prompt API (Tier 1), Gemini BYOK (Tier 2), local OpenAI-compatible (Tier 3)
│   ├── storage/
│   │   └── db.js                  # IndexedDB interface (tombstoned soft-deletes, separate text store), multi-attribute sorting, fading, & settings
│   ├── shared/
│   │   ├── html.js                # Shared escapeHtml/highlightSearch/faviconUrl/fade-chip helpers for the app & options pages
│   │   └── export.js               # Shared Markdown, Obsidian .zip, and JSON export/import helpers
│   ├── app/
│   │   ├── index.html             # Knowledge Hub: one page for the Chrome Side Panel and the full view in a tab
│   │   ├── app.js                 # Controller: search, filters, sort, cards, delete/undo, reader view, export, keyboard nav
│   │   └── app.css                # Width-driven layout (narrow: drawer + single column; wide: sidebar + grid), dark/light themes
│   └── options/
│       ├── index.html             # Options page with archival modes, fading, storage meter, & domain rules
│       ├── options.js             # Options controller with live storage telemetry
│       └── options.css            # Settings page layout
└── tests/
    ├── test_core.js               # Unit test runner (domain extraction, heuristics, settings defaults)
    ├── test_export.js             # Unit tests for Markdown, Obsidian frontmatter, & JSON export
    ├── test_storage.js            # Unit tests for the IndexedDB layer (soft deletes, dedupe, fading, closed-today)
    ├── test_sorting.js            # Unit tests for multi-attribute sorting (newest, reading time, A-Z)
    ├── test_app_unit.js           # Unit & markup tests for the app page: reader typography, status badges, search highlight
    ├── test_app_ux.js             # Playwright tests for both layouts & surfaces: drawer, grid, filters, density, undo, reader, export
    ├── test_hybrid_mode.js        # Playwright tests for dual-tier adaptive archival & status chips
    ├── test_tab_hardening.js      # Playwright tests for URL dedupe, rich-editor/form safety guards, 💤 marker, & in-place restore
    ├── test_shortcuts.js          # Playwright tests for global and in-panel keyboard shortcuts
    ├── test_local_llm.js          # Unit tests for the OpenAI-compatible tier (streaming, <think> blocks, fallback)
    ├── test_wikipedia.js          # Multi-tab end-to-end Wikipedia extraction and restore stress test
    ├── dogfood.js                 # Complete browser self-test and automated dogfooding suite
    └── helpers/
        └── test-extension.js      # Builds a temp copy of the extension with test-only host permissions for Playwright
```

---

## 📦 Installation & Setup

### 1. Load into Google Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/AndroidLemon/TabSum.git
   cd TabSum
   ```
2. Open Chrome and visit:
   ```
   chrome://extensions/
   ```
3. In the top-right corner, turn on **Developer mode**.
4. Click **Load unpacked** (top-left) and select the `TabSum` directory.

### 2. First-Run Onboarding

1. Click the **TabSum** icon in your Chrome toolbar (or press `Command+Shift+S` / `Ctrl+Shift+S`) to open the **Side Panel**.
2. Click **Enable** on the permission banner to let TabSum read article text from your tabs (or do it later from Options).
3. Optional: in **Options → AI Provider**, choose your summarizer (Chrome's on-device model is used automatically if downloaded; otherwise configure a local server or a Gemini key).
4. You are ready to go!

### 3. Package for the Chrome Web Store

The repository root doubles as the unpacked extension, so it contains tests and docs that shouldn't ship. Build an upload-ready zip containing only `manifest.json`, `src/` and `LICENSE`:

```bash
npm run package   # → dist/tabsum-<version>.zip
```

---

## ⚙️ Configuration & Archival Modes

Navigate to the TabSum settings by right-clicking the extension icon and selecting **Options** (or clicking **Settings** in the Knowledge Hub sidebar / Filters drawer):

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Archival Action** | `Smart Hybrid` | **Smart Hybrid**: closes plain reading pages and suspends interactive ones at the threshold; closes suspended tabs at 2× the threshold.<br>**Soft Suspend All**: never closes; suspends idle tabs to free memory while keeping them in the tab strip.<br>**Auto-Close All**: closes every idle tab (unless it has unsaved input); reopen from **Closed today**. |
| **Only Close Tabs With an AI Summary** | `Enabled` | Tabs are only closed when an AI tier wrote the summary; otherwise they are suspended. |
| **Inactivity Threshold** | `60 minutes` | Inactive time before a background tab is eligible (15m, 30m, 1h, 2h, 4h, 24h). Time away from the computer doesn't count. |
| **Ignore Pinned Tabs** | `Enabled` | Pinned tabs are never suspended or closed. |
| **Domain Whitelist** | *Default list* | Specific domains and subdomains where TabSum will never touch tabs (`docs.google.com`, `github.com`, etc.). |
| **Notes Fade After** | `30 / 7 days` | Unstarred notes are deleted this many days after capture (never reopened) / after the last reopen. 0 = never. |
| **AI Provider** | `Auto` | **Auto** uses Chrome's on-device model when it's downloaded, else offline heuristics. Or pick Gemini (cloud, your key) or a local OpenAI-compatible server (URL + model + optional key). |

---

## ⌨️ Keyboard Shortcuts Reference

### Global Browser Shortcuts

| Shortcut (Mac) | Shortcut (Windows / Linux) | Action |
| :--- | :--- | :--- |
| `Command + Shift + S` | `Ctrl + Shift + S` | Open the TabSum Side Panel |
| `Command + Shift + E` | `Ctrl + Shift + E` | Summarize & save the active tab now (it stays open) |

### Knowledge Hub Shortcuts (Side Panel & Full View)

| Key | Action |
| :---: | :--- |
| `j` or `↓` | Highlight next tab card |
| `k` or `↑` | Highlight previous tab card |
| `Enter` | Reopen / restore highlighted tab in browser |
| `/` | Jump focus to search input |
| `Escape` | Clear search / dismiss reader view |

---

## 🧪 Automated Testing & Dogfooding

TabSum includes a suite of unit and end-to-end integration tests powered by Node.js and Playwright:

### Run Unit Tests (Instant, No Browser)

Verifies domain extraction, heuristic summarization, the local-LLM tier (against a mocked server), Markdown/Obsidian export format, the storage layer (soft deletes, dedupe, fading), the closure policy (every safety gate, the tier classifier, the AI-summary gate) and multi-attribute sorting:

```bash
npm run test:unit     # every node-only suite; opens no window
npm test              # just the core suite
npm run test:policy   # just the closure policy
npm run test:storage  # just the storage layer
```

### Run Specialized Playwright Test Suites

```bash
# Test the Knowledge Hub in both layouts (side panel & full view): filters, inbox, fading, undo, reader, export
npm run test:ux

# Test tiered hybrid archival (soft-suspend vs closure) & status badges
npm run test:hybrid

# Test form-safety guards (Shadow DOM, ProseMirror, Quill), dedupe & in-place restore
npm run test:hardening

# Test global commands & Knowledge Hub keyboard navigation
npm run test:shortcuts

# Run real-world multi-tab stress test on live Wikipedia articles
npm run test:wiki

# Run complete end-to-end browser dogfooding suite
npm run test:dogfood
```

### Run Everything Without a Visible Window

By default the Playwright suites open a real Chrome window, which takes focus. `TABSUM_HEADLESS=1`
runs them with no window at all:

```bash
npm run test:browser   # every Playwright suite, headless
npm run test:all       # test:unit + test:browser
TABSUM_HEADLESS=1 npm run test:hybrid   # or one suite at a time
```

Headless needs Playwright's `chromium` channel, because the default headless build is the
headless *shell*, which cannot load extensions at all. `extensionLaunchOptions()` in
`tests/helpers/test-extension.js` handles that. If a suite ever behaves differently headless,
`TABSUM_OFFSCREEN=1` is the fallback: a real window, parked off-screen.

The Playwright suites load a temporary copy of the extension (see `tests/helpers/test-extension.js`) that adds `localhost` and Wikipedia host permissions, so the shipped manifest doesn't need them.

---

## 🔒 Privacy & Security Principles

- **Local-First Storage**: All summaries, clean text, metadata, and tags reside within your browser's local IndexedDB (`TabSumDB`).
- **No Telemetry**: TabSum does not include analytics trackers or external logging scripts.
- **Trust-First Permission Model**: Page access is an optional permission you grant with a click during onboarding, not at install. A local server's address is granted the same way, via **Test Connection**.
- **Local Favicons**: Favicons are loaded from Chrome's own local favicon cache (the `favicon` permission and `chrome-extension://.../_favicon` API) — never from a page-supplied URL or a third-party favicon service.
- **Strict Protocol Validation**: `http:` / `https:` URL sanitization prevents `javascript:` protocol injection and XSS vulnerabilities.
- **Local Key Storage**: Optional API keys (Gemini, local server) are kept only in this browser's `chrome.storage.local` — not synced, not sent anywhere except to the provider they belong to. Like other extension storage it's unencrypted on disk.
- **Only Network Egress**: Page text leaves the browser only for the summarization provider *you* choose: Google's Gemini API (with your key), or the OpenAI-compatible server URL you configure (keep it on `localhost` for fully local summaries). With the default Auto provider, TabSum makes no network requests at all.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
