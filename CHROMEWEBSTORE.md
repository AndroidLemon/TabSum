# Chrome Web Store Listing: TabSum

**Last Updated**: 2026-09-10  
**Extension Name**: TabSum: Inactive Tab Summarizer & Knowledge Wiki  
**Version**: 1.0.0  
**Category**: Productivity / Tools  

---

## 1. Store Listing Copy

### Short Description (max 132 chars)
Automatically summarizes neglected tabs and organizes them into an in-browser personal knowledge wiki with 1-click restore.

### Detailed Description
**Solve Tab Overload Without Losing Your Ideas.**

We open dozens of tabs intending to read them, but our tab bar quickly becomes an unmanageable cognitive burden. Closing a tab feels like deleting a thought—so we hoard them. Traditional tab suspenders just freeze tabs into tiny, unreadable favicon slivers that clutter your workspace.

**TabSum** is an intelligent tab archiver that watches for inactive tabs, distills them into structured, readable summaries, and organizes them into your personal in-browser Knowledge Wiki.

### ✨ Key Features
- **Smart Inactivity Detection**: Tracks untouched tabs and runs periodic sweeps while you work (automatically pausing when you're away from your computer).
- **Zero-Loss Safety Net**: Inspects tabs for unsaved form inputs, drafts, or playing media before touching anything. Pinned tabs and domain whitelists are strictly protected.
- **On-Device Structured Distillation**: Generates clean TL;DR overviews, 3–5 bullet-point takeaways, and automatic topic tags. Works 100% offline with zero setup required.
- **Full In-Browser Knowledge Wiki**: A Notion-style dashboard with timeline browsing, topic tags, and instant keyword search across all your saved reads.
- **Always-Available Side Panel**: Access recently archived ideas, search your backlog, or manually summarize the active tab with 1 click.
- **Instant 1-Click Restore**: Reopen any archived tab at its exact original URL with a single click.
- **Markdown & JSON Export**: Export your personal reading notes directly into Obsidian, Logseq, or Notion.

---

## 2. Permissions Justification

Every permission is strictly necessary for TabSum's core functionality:

| Permission | Technical Need | Plain-English Reason for Store Review |
| :--- | :--- | :--- |
| `tabs` | `chrome.tabs.query`, `chrome.tabs.discard`, `chrome.tabs.remove`, `chrome.tabs.create` | Needed to detect inactive tabs, read tab URLs/titles for summarization, and restore tabs when clicked. |
| `storage` | `chrome.storage.local`, `chrome.storage.session` | Needed to store user preferences (timeouts, whitelists) and ephemeral per-tab activity timestamps. |
| `alarms` | `chrome.alarms.create` | Needed to schedule low-power periodic inactivity sweeps without keeping the background service worker constantly awake. |
| `idle` | `chrome.idle.queryState` | Needed to ensure tabs are never auto-archived while the user is away from the computer. |
| `scripting` | `chrome.scripting.executeScript` | Needed to inject the article content extractor into background tabs to parse article text and verify form safety. |
| `sidePanel` | `chrome.sidePanel` | Needed to provide an always-available knowledge companion alongside browsing. |
| `unlimitedStorage` | IndexedDB persistent quota | Needed to locally store clean reading snapshots and summaries in the user's browser without quota eviction. |
| `notifications` | `chrome.notifications.create` | Needed to show an optional subtle notification when an idle tab has been safely archived. |
| `optional_host_permissions: ["<all_urls>"]` | `chrome.permissions.request` | Requested during onboarding to allow TabSum to extract readable text from articles across user-visited websites. |

---

## 3. Privacy & Data Use Disclosure

- **Host Permissions**: TabSum requests `<all_urls>` purely as an optional permission during onboarding to extract article body text from tabs eligible for archival.
- **Data Handling**:
  - All content parsing, heuristic distillation, and storage occur **100% locally on the user's device**.
  - No browsing history, article contents, or personal information are ever transmitted to external servers, sold, or shared with third parties.
  - If the user chooses to configure an optional Google Gemini API key, summary prompts are sent directly to Google's official Gemini API using the user's key.

---

## 4. Version History

- **v1.0.0** (2026-09-10): Initial release.
  - Inactivity tracking with `chrome.storage.session` and 1-minute alarm sweeps.
  - Live in-tab Readability extraction with dirty form detection.
  - Multi-tier summarizer (Tier 0 Heuristic + Chrome Prompt API support + optional Gemini Flash BYOK).
  - IndexedDB storage with full-text search.
  - Full-page Wiki dashboard and Chrome Side Panel.
  - Markdown and JSON export.
