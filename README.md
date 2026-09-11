# TabSum 📑✨

> **Turn neglected browser tabs into an organized personal knowledge wiki—without losing your open loops.**

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)
![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_First-10B981)
![AI Engine](https://img.shields.io/badge/AI-Gemini_Nano_%2F_Heuristics_%2F_Flash-6366F1)
![Storage](https://img.shields.io/badge/Storage-IndexedDB_%2B_LRU_Quota-F59E0B)
![Tests](https://img.shields.io/badge/Tests-Playwright_%26_Unit_Passing-10B981)
![License](https://img.shields.io/badge/License-MIT-gray)

---

## 📖 Table of Contents

- [The Problem: Tab Hoarding is Working Memory Overload](#-the-problem-tab-hoarding-is-working-memory-overload)
- [The Solution: TabSum](#-the-solution-tabsum)
- [🚀 Key Features](#-key-features)
  - [⚡ Tiered Hybrid Adaptive Archival](#-tiered-hybrid-adaptive-archival)
  - [🛡️ Deep Zero-Loss Safety Engine](#️-deep-zero-loss-safety-engine)
  - [🧠 Multi-Tier Summarization Pipeline](#-multi-tier-summarization-pipeline)
  - [📚 Personal Knowledge Wiki & Side Panel](#-personal-knowledge-wiki--side-panel)
  - [📤 Obsidian, Markdown & JSON Export](#-obsidian-markdown--json-export)
  - [🧹 Storage Quota & LRU Auto-Pruning](#-storage-quota--lru-auto-pruning)
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
2. **Distills Core Knowledge**: Extracts clean article text, metadata, reading time, and removes boilerplate using an in-tab Readability engine.
3. **Generates Multi-Tier Summaries**: Synthesizes a 1-sentence **TL;DR**, 3–5 **bullet takeaways**, and automatic **topic tags** (`#AI`, `#Engineering`, `#Design`, etc.) using on-device AI or fast offline heuristics.
4. **Executes Tiered Adaptive Archival**: Soft-suspends tabs to free ~95% RAM while keeping headers visible (marked with a sleeping indicator `💤`), then gracefully auto-closes neglected tabs with undo notifications.
5. **Organizes Your Personal Wiki**: Indexes every tab into a searchable, local IndexedDB knowledge base accessible anytime via the Chrome Side Panel or a full-page Notion-style dashboard with **1-click restore**.

---

## 🚀 Key Features

### ⚡ Tiered Hybrid Adaptive Archival

TabSum features a dual-threshold **Hybrid Archival Engine** that balances tab visibility with aggressive memory savings:

- **Tier 1 (Soft Suspension at $1\times$ Threshold, e.g., 15–60 min)**:
  - Invokes `chrome.tabs.discard()` to immediately reclaim up to **95% of tab memory**.
  - Injects a `💤 ` indicator directly into the page `<title>` so you can visually identify suspended tabs in your tab strip.
  - Leaves the tab safely open in your tab bar for instant resumption.
- **Tier 2 (Wiki Archival & Graceful Closure at $2\times$ Threshold, e.g., 30–120 min)**:
  - If a tab remains untouched through a second inactivity window, TabSum closes the tab and archives its synthesized knowledge into your personal wiki.
  - Dispatches an interactive Chrome notification with a **1-click "Undo / Reopen"** action.

*(You can also configure TabSum to operate strictly in "Soft Suspension Only" or "Auto-Close Only" mode via Options).*

### 🛡️ Deep Zero-Loss Safety Engine

TabSum guarantees **Zero Data Loss** through comprehensive pre-archival validation:

- **Deep Form & Rich Text Inspection**: Scans standard `<input>`, `<textarea>`, and `<select>` elements, traverses **nested Shadow DOM** trees, and detects modern web editors:
  - `[role="textbox"]`, `[contenteditable="true"]`
  - **ProseMirror** (Google Docs, Notion-like editors)
  - **Quill**, **Draft.js**, **Monaco Editor** (VS Code Web), and **CodeMirror**
- **Media Playback Lock**: Tabs actively playing sound, video conferences, or podcasts (`audible: true`) are unconditionally spared.
- **Pinned Tab Lock**: Pinned tabs are strictly preserved by default (`ignorePinnedTabs: true`).
- **Domain Whitelists**: Wildcard and subdomain protection (`*.google.com`, `github.com`, `slack.com`, etc.).
- **Two-Phase Commit & Crash Resilience**: Archives records in a `pending` state prior to tab modification, auto-reconciling interrupted states on service worker wakeups.
- **TOCTOU Guard**: Re-evaluates tab state in real-time immediately prior to closure or discard.

### 🧠 Multi-Tier Summarization Pipeline

TabSum provides three flexible summarization tiers based on your environment:

| Tier | Engine | Speed | Privacy | Requirements |
| :--- | :--- | :---: | :---: | :--- |
| **Tier 0** | **Algorithmic Heuristics** | $<10\text{ ms}$ | 100% Offline | None (Zero dependencies, Lead-3 + TextRank + keyword classification) |
| **Tier 1** | **Chrome Prompt API** | $\sim 500\text{ ms}$ | 100% On-Device | Gemini Nano built into Chrome (`window.ai` / `LanguageModel`) |
| **Tier 2** | **Google Gemini Flash** | $\sim 1\text{ s}$ | Cloud BYOK | Optional Gemini API key stored locally in `chrome.storage.local` |

*Automatic fallback ensures that if an AI model is unavailable or encounters rate limits, distillation gracefully drops down to Tier 0 without interruption.*

### 📚 Personal Knowledge Wiki & Side Panel

- **Instant Full-Text Search with Keyword Highlighting**: Real-time substring matching highlights queried keywords with `<mark class="search-highlight">` across titles, URLs, and summaries. Includes an instant `✕` clear button and keyboard `[/]` hint badge.
- **View Density Modes (Comfortable vs. Compact)**: Toggle between detailed cards and a scannable ~42px **Compact mode** with saved preference in `chrome.storage.local`.
- **Progressive Disclosure**: Keeps cards clean with 1-sentence TL;DRs by default, while 3–5 bullet takeaways expand smoothly via an interactive disclosure toggle (`▸ 3 key takeaways`).
- **Forgiving Undo & Session-Deferred Deletions**: Deleting cards triggers a smooth exit animation and an actionable toast with an animated countdown progress bar and a **`[ Undo ]`** button. When *Defer Deletions Until Closed* is enabled, cards remain undoable across your entire session and are only committed to storage upon closing the panel or dashboard tab.
- **Seamless Dashboard Launch**: Launch the full-page Knowledge Wiki dashboard with 1 click; the side panel automatically closes by default (`closeSidebarOnOpenDashboard`) to keep your screen distraction-free.
- **Multi-Attribute Sorting**:
  - 🕒 **Newest Added** (Default)
  - ⏳ **Oldest Added**
  - ⚡ **Quick Reads** ($\le 3$ minutes reading time)
  - 📖 **Deep Dives** (Long-form articles)
  - 🔤 **Title (A–Z)**
  - 🌐 **Domain / Source (A–Z)**
- **Real-Time Status Badges**: Visual indicators distinguish tab states at a glance:
  - `💤 Suspended` (Tab discarded from RAM, still open in browser)
  - `📦 Archived` (Tab closed and preserved in Knowledge Wiki)
  - `🟢 Active` (Tab currently loaded and active in browser)
- **Modern Semantic `<dialog>` Reader View**: Distraction-free reading typography formatted to optimal `68ch` measure, line-height 1.75, backdrop blur, native Escape dismissal, and light-dismiss backdrop bounds checking.
- **1-Click Favorite Star Toggles (`⭐`)**: Favorite cards directly from the Wiki or Side Panel to quickly filter favorites in the sidebar and protect them from automated storage quota pruning.
- **Tactile Physics & Micro-Interactions**: Spring-like button press states (`:active { transform: scale(0.96); }`), pulsing skeleton shimmer loaders during queries, and soft-edge horizontal tag gradient masking.
- **Topic Tag Cloud & Timeline**: Filter notes by dynamic tag counts (`#AI`, `#Dev`, `#Design`) or time intervals (*Today*, *Yesterday*, *Past 7 Days*).

### 📤 Obsidian, Markdown & JSON Export

Export your accumulated knowledge into your favorite external PKM (Personal Knowledge Management) tool:

- **Obsidian Vault Format**: Generates `.md` notes complete with YAML frontmatter (`title`, `url`, `captured_at`, `reading_time_minutes`, `tags`) and native Obsidian tag links.
- **Standard Markdown**: Clean GitHub-flavored markdown export ideal for Notion, Logseq, or personal repositories.
- **Full JSON Backup & Restore**: Complete export of all IndexedDB records, metadata, summaries, and extracted text for portable backups.

### 🧹 Storage Quota & LRU Auto-Pruning

Keep browser storage lean and performant over time:

- **Configurable Quota Limit**: Set a maximum threshold for archived tabs (e.g., 500, 1,000, or unlimited).
- **Intelligent LRU Pruning**: Automatically purges the oldest least-recently-used records when your quota is reached.
- **Favorite & Pinned Tab Immunity**: Star any card (`⭐ Favorite`) or pin it to permanently protect it from automated pruning.
- **Live Storage Telemetry**: View real-time storage metrics (total records, byte estimates in KB/MB, and quota percentage) directly in the Options dashboard.

### ⌨️ Global Keyboard Shortcuts & In-Panel Navigation

- **Global Hotkeys**:
  - `Command+Shift+S` (Mac) / `Ctrl+Shift+S` (Win/Linux): Toggle Side Panel / Knowledge Hub.
  - `Command+Shift+E` (Mac) / `Ctrl+Shift+E` (Win/Linux): Instantly summarize and archive the active tab.
- **Side Panel Keyboard Navigation**:
  - `j` or `↓`: Select next knowledge card.
  - `k` or `↑`: Select previous knowledge card.
  - `Enter`: Restore and reopen the selected tab.
  - `/`: Focus search input.

### 🔄 Smart In-Place Tab Reactivation

Restoring a tab from the Side Panel or Wiki Dashboard intelligently checks if that tab or URL is already open in your browser window. If the tab still exists (active or sleeping), TabSum **switches directly to it in-place** rather than creating redundant, duplicate tabs.

---

## 🛠️ Architecture & Codebase Map

```
TabSum/
├── manifest.json                  # Manifest V3 manifest, permissions & global shortcuts
├── package.json                   # Project scripts and Playwright test runner dependencies
├── CHROMEWEBSTORE.md              # Chrome Web Store listing metadata & privacy disclosures
├── DOGFOOD_REPORT.md              # Automated Playwright test run telemetry report
├── src/
│   ├── assets/
│   │   └── icons/                 # 16px, 48px, 128px extension icon assets
│   ├── background/
│   │   └── service-worker.js      # Idle monitor, alarm sweeper, two-phase commit, & hybrid engine
│   ├── content/
│   │   └── in-tab-extractor.js    # In-tab Readability parser, shadow DOM / dirty form guards, & title badge
│   ├── ai/
│   │   └── summarizer.js          # Heuristic summarizer (Tier 0), Chrome Prompt API (Tier 1), & Gemini BYOK (Tier 2)
│   ├── storage/
│   │   └── db.js                  # IndexedDB interface, multi-attribute sorting, storage quota LRU, & settings
│   ├── sidepanel/
│   │   ├── index.html             # Chrome Side Panel UI
│   │   ├── panel.js               # Side panel controller, keyboard navigation, & real-time search
│   │   └── panel.css              # Apple/Arc-inspired modern glassmorphic styling
│   ├── wiki/
│   │   ├── index.html             # Notion-style full-page Knowledge Wiki dashboard
│   │   ├── wiki.js                # Wiki controller, reader view modal, tag cloud, & export engine
│   │   └── wiki.css               # Responsive multi-column layout with dark/light themes
│   └── options/
│       ├── index.html             # Options page with archival modes, storage quota meter, & domain rules
│       ├── options.js             # Options controller with live storage telemetry
│       └── options.css            # Settings page layout
└── tests/
    ├── test_core.js               # Unit test runner (domain extraction, heuristics, settings defaults)
    ├── test_export.js             # Unit tests for Markdown, Obsidian frontmatter, & JSON export
    ├── test_storage_quota.js      # Unit tests for storage limits, LRU pruning, & favorite preservation
    ├── test_sorting.js            # Unit tests for multi-attribute sorting (newest, reading time, A-Z)
    ├── test_wiki_ux.js            # Unit & DOM tests for modern dialog, reading typography, & search highlight
    ├── test_sidepanel_ux.js       # Playwright tests for density toggle, progressive disclosure, & 5s undo
    ├── test_hybrid_mode.js        # Playwright tests for dual-tier adaptive archival & status chips
    ├── test_tab_hardening.js      # Playwright tests for two-phase commit, crash recovery, & rich form safety
    ├── test_shortcuts.js          # Playwright tests for global and in-panel keyboard shortcuts
    ├── test_wikipedia.js          # Multi-tab end-to-end Wikipedia extraction and restore stress test
    └── dogfood.js                 # Complete browser self-test and automated dogfooding suite
```

---

## 📦 Installation & Setup

### 1. Load into Google Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/TabSum.git
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
2. Click **Enable Tab Extraction** on the onboarding banner to grant permission for reading article text.
3. You are ready to go!

---

## ⚙️ Configuration & Archival Modes

Navigate to the TabSum settings by right-clicking the extension icon and selecting **Options** (or clicking the gear icon in the Side Panel):

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Archival Mode** | `Hybrid Adaptive` | **Hybrid Adaptive**: Soft-suspends tabs at $1\times$ threshold, auto-closes at $2\times$ threshold.<br>**Soft Suspension**: Discards tabs to save 95% RAM; keeps tab strip visible.<br>**Auto-Close**: Gracefully closes tabs into Wiki with undo notification. |
| **Inactivity Threshold** | `60 minutes` | Inactive duration before a background tab is eligible for archival (options: 1m for testing, 15m, 30m, 1h, 2h, 4h). |
| **Protect Pinned Tabs** | `Enabled` | When enabled, pinned browser tabs will never be suspended or closed. |
| **Domain Whitelist** | *Default list* | Specific domains and subdomains where TabSum will never touch tabs (`docs.google.com`, `github.com`, etc.). |
| **Close Sidebar on Dashboard Open** | `Enabled` | Automatically closes the side panel when launching the full-page Knowledge Wiki dashboard to declutter your screen. |
| **Defer Deletions Until Closed** | `Disabled` | Postpones permanent deletion until the side panel or wiki dashboard tab is closed, keeping deleted cards recoverable via Undo for the entire active session. |
| **Storage Quota** | `1,000 tabs` | Maximum number of tabs preserved in IndexedDB before LRU auto-pruning takes effect. |
| **Auto-Pruning** | `Enabled` | Automatically prunes oldest non-favorite tabs when quota is reached. |
| **AI Provider** | `Auto` | Automatically selects between Chrome Prompt API (Gemini Nano), Cloud Gemini API (BYOK), or Offline Heuristics. |

---

## ⌨️ Keyboard Shortcuts Reference

### Global Browser Shortcuts

| Shortcut (Mac) | Shortcut (Windows / Linux) | Action |
| :--- | :--- | :--- |
| `Command + Shift + S` | `Ctrl + Shift + S` | Open / Toggle TabSum Side Panel |
| `Command + Shift + E` | `Ctrl + Shift + E` | Immediately summarize & archive the active tab |

### Side Panel Shortcuts

| Key | Action |
| :---: | :--- |
| `j` or `↓` | Highlight next tab card |
| `k` or `↑` | Highlight previous tab card |
| `Enter` | Reopen / restore highlighted tab in browser |
| `/` | Jump focus to search input |
| `Escape` | Clear search / dismiss reader view |

---

## 🧪 Automated Testing & Dogfooding

TabSum includes an exhaustive suite of unit and end-to-end integration tests powered by Node.js and Playwright:

### Run Unit Tests (Instant)

Verifies domain extraction, heuristic summarization, Markdown/Obsidian export format, storage quota LRU pruning, and multi-attribute sorting:

```bash
npm test
```

### Run Specialized Playwright Test Suites

```bash
# Test UI/UX ergonomics (modern dialog, typography, search highlighting, 5s undo, density modes)
npm run test:ux

# Test tiered hybrid archival (soft-suspend vs closure) & status badges
npm run test:hybrid

# Test zero-loss form safety (Shadow DOM, ProseMirror, Quill) & crash recovery
npm run test:hardening

# Test global commands & side panel keyboard navigation
npm run test:shortcuts

# Run real-world multi-tab stress test on live Wikipedia articles
npm run test:wiki

# Run complete end-to-end browser dogfooding suite
npm run test:dogfood
```

---

## 🔒 Privacy & Security Principles

- **100% Local-First Storage**: All summaries, clean text, metadata, and tags reside strictly within your browser's local IndexedDB (`TabSumDB`).
- **Zero Third-Party Tracking**: TabSum does not include telemetry, analytics trackers, or external logging scripts.
- **Trust-First Permission Model**: Uses `optional_host_permissions` requested via an explicit user gesture during onboarding rather than intimidating install-time permission dialogs.
- **Strict Protocol Validation**: Strict `http:` / `https:` URL and favicon sanitization prevents `javascript:` protocol injection and XSS vulnerabilities.
- **Secure Key Storage**: Optional BYOK API keys are stored solely inside Chrome's private `chrome.storage.local` store.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
