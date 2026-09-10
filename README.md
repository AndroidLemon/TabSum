# TabSum 📑✨

> **Turn neglected browser tabs into an organized personal knowledge wiki—without losing your open loops.**

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)
![Local First](https://img.shields.io/badge/Privacy-100%25_Local_First-10B981)
![AI-Powered](https://img.shields.io/badge/AI-Gemini_Nano_%2F_Heuristics-6366F1)
![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB-F59E0B)

---

## The Problem: Tab Hoarding is Working Memory Overload

We open dozens or hundreds of tabs intending to read them, but our tab bar quickly becomes an unmanageable cognitive burden. 

Closing a tab feels like deleting a thought or abandoning an idea, so we hoard them. Traditional tab suspenders (like *The Great Suspender* or Chrome's built-in memory saver) simply freeze tabs in place, leaving dozens of tiny, unreadable favicon slivers that clutter your workspace and slow down your focus.

## The Solution: TabSum

**TabSum** is an intelligent Manifest V3 Chrome extension that watches for inactive background tabs. When a tab remains untouched past a configurable threshold, TabSum:

1. **Safety Checks**: Inspects the page for unsaved form inputs, active media playback, or pinned status before touching anything.
2. **Distills Content**: Injects a clean Readability extractor directly into the rendered DOM to extract clean article text, metadata, and reading time.
3. **Summarizes**: Generates a 1-sentence **TL;DR**, 3–5 **bullet takeaways**, and automatic **topic tags** (`#AI`, `#Engineering`, `#Design`, etc.).
4. **Archives Safely**: Either **soft-suspends** the tab (saving 95% RAM while keeping the tab header visible) or **auto-closes** it with an Undo notification.
5. **Organizes into a Knowledge Wiki**: Saves everything into a searchable, personal knowledge base and always-available Chrome Side Panel with **1-click tab restoration**.

---

## 🚀 Key Features

- **Smart Inactivity Sweeper**: Evaluates background tabs using a lightweight 1-minute `chrome.alarms` scheduler. Automatically pauses sweeps when you step away from your keyboard (`chrome.idle`) to avoid surprises upon return.
- **Zero-Loss Safety Net**:
  - Automatically skips tabs with active form inputs, textareas, or contenteditable drafts.
  - Automatically skips tabs playing audio or video.
  - Strictly protects pinned tabs and domain whitelists (`docs.google.com`, `mail.google.com`, `github.com`, etc.).
  - TOCTOU guard: Re-checks tab state immediately prior to suspension/closure.
- **Multi-Tier Summarization Engine**:
  - **Tier 0 (Instant Baseline)**: Algorithmic heuristic distillation (Lead-3 + TextRank sentence scoring + topic tags). Runs 100% offline in $<10$ms with zero dependencies and zero cost.
  - **Tier 1 (On-Device AI)**: Chrome Built-in Prompt API (`LanguageModel` / Gemini Nano) runs completely locally with zero cloud API keys.
  - **Tier 2 (Cloud BYOK)**: Optional Google Gemini Flash API key support (stored securely in `chrome.storage.local`).
- **Always-Available Side Panel**: Access recently archived ideas, search your reading backlog, or manually summarize the active tab with 1 click.
- **Notion-Style Full Wiki Dashboard**:
  - Timeline grouping (Today, Yesterday, Past 7 Days).
  - Topic tag cloud with counts.
  - Instant full-text search across titles, summaries, tags, and article bodies.
  - Full-text Reader View modal.
  - Markdown and JSON export for Obsidian, Notion, or Logseq.
- **1-Click Restore**: Click any card or citation to reopen the tab at its exact original URL.

---

## 🛠️ Architecture

```
TabSum/
├── manifest.json                  # Manifest V3 configuration & permissions
├── CHROMEWEBSTORE.md              # Store listing metadata & privacy justifications
├── package.json                   # Test runner configuration
├── src/
│   ├── assets/
│   │   └── icons/                 # 16px, 48px, 128px PNG icon assets
│   ├── background/
│   │   └── service-worker.js      # Tab activity tracking, alarms, safety & sweep engine
│   ├── content/
│   │   └── in-tab-extractor.js    # In-tab isolated Readability & dirty form detection
│   ├── ai/
│   │   └── summarizer.js          # Heuristic, Chrome Prompt API, & Gemini BYOK summarizer
│   ├── storage/
│   │   └── db.js                  # IndexedDB persistent storage, queries & settings
│   ├── sidepanel/
│   │   ├── index.html             # Side panel companion drawer
│   │   ├── panel.js               # Side panel controller with permission onboarding
│   │   └── panel.css              # Modern Apple/Arc-style responsive styling
│   ├── wiki/
│   │   ├── index.html             # Full-page personal knowledge dashboard
│   │   ├── wiki.js                # Wiki controller with search, tags, & reader modal
│   │   └── wiki.css               # Multi-column Notion-style layout (dark/light mode)
│   └── options/
│       ├── index.html             # Settings & domain whitelist configuration
│       ├── options.js             # Options controller
│       └── options.css            # Settings styling
└── tests/
    └── test_core.js               # Unit tests for summarization, domains, & settings
```

---

## 📦 Installation & Setup

### 1. Load into Google Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/TabSum.git
   cd TabSum
   ```
2. Open Chrome and navigate to:
   ```
   chrome://extensions/
   ```
3. In the top-right corner, toggle on **Developer mode**.
4. Click **Load unpacked** (top-left) and select the `TabSum` project folder.

### 2. First-Run Onboarding

1. Click the **TabSum** icon in your Chrome toolbar to open the **Side Panel**.
2. Click **Enable Tab Extraction** on the banner to grant permission for reading article contents.
3. You're all set!

---

## 🧪 Testing Inactivity Sweeps (Quick Demo)

Want to see the automatic background archival in action?

1. Right-click the extension icon and select **Options** (or click the Settings gear in the Side Panel).
2. Set the **Inactivity Threshold** to **1 minute (Testing mode)**.
3. Open 2–3 article tabs (e.g. Wikipedia, a technical blog, documentation).
4. Switch to another window and browse normally for 1–2 minutes.
5. Watch the extension badge count update as untouched tabs are automatically summarized and archived to your Knowledge Wiki!

---

## 🔒 Privacy & Security

- **100% Client-Side**: All DOM parsing, heuristic distillation, and IndexedDB storage occur entirely on your local machine.
- **Zero Third-Party Telemetry**: TabSum collects no analytics, personal data, or browsing history.
- **Trust-First Permissions**: Uses `optional_host_permissions` requested through an explicit user gesture during onboarding rather than showing scary install-time warnings.
- **XSS & Protocol Protection**: Strict `http:` / `https:` scheme validation is enforced before rendering links or loading favicons.

---

## 🧪 Running Tests

TabSum includes automated unit tests verifying domain extraction, extractive summarization, and default settings:

```bash
npm test
# or
node tests/test_core.js
```

---

## 📄 License

MIT License. Feel free to use, modify, and distribute.
