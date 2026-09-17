# Chrome Web Store Listing: TabSum

**Last Updated**: 2026-09-16  
**Extension Name**: TabSum: Inactive Tab Summarizer & Knowledge Wiki  
**Version**: 1.0.0  
**Category**: Productivity / Tools  
**Minimum Chrome**: 141 (side panel close API; the on-device model needs a recent Chrome too)  
**Homepage**: https://github.com/AndroidLemon/TabSum  

Everything the dashboard asks for, in the order it asks. Sections 2 and 3 are
pasted verbatim into the permission-justification and privacy-practices tabs.

---

## 1. Store Listing Copy

### Short Description (max 132 chars)
Automatically summarizes neglected tabs and organizes them into an in-browser personal knowledge wiki with 1-click restore.

### Detailed Description
**Close the tabs you were never going to read, and keep what was in them.**

We open dozens of tabs intending to read them, but the tab bar quickly becomes a burden. Closing a tab feels like deleting a thought, so we hoard them. Tab suspenders free the memory but leave the clutter, and neither they nor Chrome's memory saver keep any record of what you had open.

**TabSum** watches your background tabs. When one has sat untouched for an hour, it reads the article, writes a short summary, saves it to a searchable notebook in your browser, and then closes or suspends the tab. Anything it closes can be reopened with one click.

### Key Features
- **Real inactivity, not wall-clock time**: time you spend idle, locked, or asleep does not count toward the threshold.
- **Safety checks before touching anything**: unsaved form input, rich text editors (Google Docs, Notion-style editors, VS Code Web), playing audio or video, and pinned tabs are all left alone. A default whitelist protects Gmail, Google Docs, GitHub, Slack, YouTube and similar sites, and you can add your own from Options or by right-clicking a tab.
- **Smart Hybrid archival**: plain reading pages are closed once summarized; interactive pages are suspended in place to free memory and closed later if you still have not returned. A tab is only closed when an AI-written summary exists, so closing never loses the gist. Soft Suspend All and Auto-Close All modes are also available.
- **Summaries on your terms**: a one-sentence TL;DR, three to five bullet takeaways, and topic tags. Written by Chrome's built-in on-device model when it is available, or by a local OpenAI-compatible server (Ollama, LM Studio, llama.cpp) or Gemini with your own key. With none of those, an offline heuristic still captures the lead of the article.
- **A notebook, not a list**: full-text search across titles, summaries, tags and saved page text; filters by tag, domain, favorites and date; an Inbox for captures you have not dealt with yet; a reader view of the saved text. Available as a side panel or a full page.
- **Closed today**: every tab closed today is listed at the top of the notebook for one-click reopening. No per-tab notifications.
- **Notes that fade**: unstarred notes delete themselves after 30 days (7 days after a reopen). Star anything to keep it. Both timers are configurable.
- **Export**: Markdown, an Obsidian vault `.zip` with frontmatter, or a full JSON backup that can be re-imported.
- **Keyboard first**: `Ctrl/Cmd+Shift+S` opens the side panel, `Ctrl/Cmd+Shift+E` summarizes the current tab, and `j`/`k`/`Enter`/`/` navigate the notebook.
- **Local by default**: with the default provider, TabSum makes no network requests at all. Nothing is synced or sent anywhere unless you configure a summarizer.

### Single Purpose
TabSum archives inactive browser tabs: it summarizes them, stores the summary locally, and closes or suspends the tab. Every permission below serves that one purpose.

---

## 2. Permissions Justification

One entry per dashboard text box.

| Permission | Technical Need | Plain-English Reason for Store Review |
| :--- | :--- | :--- |
| `tabs` | `chrome.tabs.query`, `chrome.tabs.discard`, `chrome.tabs.remove`, `chrome.tabs.create`, `chrome.tabs.update` | Needed to detect inactive tabs, read tab URLs and titles for summarization, suspend or close eligible tabs, and reopen or switch to a tab from the notebook. |
| `storage` | `chrome.storage.local`, `chrome.storage.session` | Needed to store user preferences (thresholds, domain lists, provider settings) and ephemeral per-tab activity timestamps. |
| `alarms` | `chrome.alarms.create` | Needed to schedule periodic inactivity sweeps without keeping the background service worker constantly awake. |
| `idle` | `chrome.idle.queryState` | Needed so that time away from the computer does not count toward a tab's inactivity, and tabs are never archived while the user is away. |
| `scripting` | `chrome.scripting.executeScript` | Needed to inject the article extractor into an eligible background tab to read its text and check for unsaved input before archiving. |
| `sidePanel` | `chrome.sidePanel` | Needed to show the notebook alongside browsing and to close the panel when the user opens the full-page view. |
| `unlimitedStorage` | IndexedDB persistent quota | Needed to keep saved page text and summaries in the user's browser without quota eviction. |
| `notifications` | `chrome.notifications.create` | Needed for two confirmations that otherwise give no feedback: a manual archive triggered by the keyboard shortcut, and adding a site to a domain list from the tab context menu. Automatic archival never notifies. |
| `favicon` | The extension's `_favicon` API | Needed to show site icons in the notebook from Chrome's local favicon cache, with no request to the site or to any third-party favicon service. |
| `contextMenus` | `chrome.contextMenus.create` on the tab strip | Needed for the right-click menu on a tab that adds its site to "Never archive this site" or "Always close this site" without opening Options. |
| `optional_host_permissions: ["<all_urls>"]` | `chrome.permissions.request` | Requested with a click during onboarding, not at install. Needed to read article text from whichever site an inactive tab happens to be on; the extension cannot know in advance which sites the user will leave open. A user-configured local summarization server's origin is requested the same way. |

---

## 3. Privacy Practices

### Single purpose
See section 1.

### Data collected
For the dashboard's data-use checkboxes:

- **Website content**: article text is read from eligible tabs to summarize it. Stored locally.
- **Web history**: the URL, title and capture time of each archived tab are stored locally so the tab can be reopened and the notebook searched.
- **Nothing else.** No personal identifiers, health, financial, authentication, personal communication, location, or user-activity data.

### Certifications
- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the extension's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

### Disclosure text
- **Host permissions**: TabSum requests `<all_urls>` as an optional permission during onboarding so it can extract article text from tabs eligible for archival. Until granted, TabSum leaves tabs on that site alone.
- **Favicons**: site icons come from Chrome's local favicon cache via the `favicon` permission, never from the live site or a third-party favicon service. No extra request, no leak.
- **Storage**: content parsing, summarization by the default provider, and storage all happen on the user's device, in the browser's IndexedDB and `chrome.storage.local`. Nothing is synced.
- **Network**: with the default provider, TabSum makes no network requests. The only exceptions are summarization providers the user configures:
  - **Google Gemini** with the user's own API key: the extracted text of a tab is sent to Google's Gemini API. Governed by Google's terms for that key.
  - **An OpenAI-compatible server** at a user-supplied URL, typically a local model on the user's own machine: the extracted text is sent to that URL. Access to the server's origin is granted through an explicit permission prompt.
- **Keys**: API keys and server addresses are stored in `chrome.storage.local`, unencrypted like all extension storage, never synced, and sent only to the provider they belong to.
- **No analytics, no telemetry, no remote code.**

### Privacy policy URL
https://github.com/AndroidLemon/TabSum/blob/main/PRIVACY.md

---

## 4. Assets Checklist

- [x] Icon 128×128 PNG (`src/assets/icons/icon-128.png`)
- [x] Screenshots, 1280×800, five: full notebook, a summarized card expanded (reader view), a tag filter narrowing results, a composited side-panel view, and Options (`docs/store/01-notebook.png`, `docs/store/02-card-expanded.png`, `docs/store/03-search-filter.png`, `docs/store/04-side-panel.png`, `docs/store/05-options.png`). Regenerate with `npm run assets:store` (see `tests/store_assets.js`).
- [x] Small promo tile, 440×280 (`docs/store/promo-440x280.png`)
- [x] Privacy policy URL (`PRIVACY.md`, see section 3)
- [x] Upload zip: `npm run package` → `dist/tabsum-<version>.zip` (manifest, `src/`, `LICENSE` only)
- Demo GIFs (not a dashboard requirement, but useful for the listing copy or a README): `docs/store/demo-notebook.gif`, `docs/store/demo-keyboard.gif`.

---

## 5. Version History

- **v1.0.0** (2026-09-16): Initial release.
  - Inactivity tracking with `chrome.storage.session` and alarm sweeps; idle, locked and sleep time excluded.
  - Smart Hybrid archival: close plain pages at the threshold, suspend interactive ones, close suspended tabs at twice the threshold; Soft Suspend All and Auto-Close All modes.
  - Closing gated on an AI-written summary; heuristic-only summaries suspend instead.
  - In-tab article extraction with shadow DOM, rich-editor and dirty-form guards; last-moment re-check before archiving.
  - Four summarization tiers: offline heuristic, Chrome's on-device model, local OpenAI-compatible server (streamed), Gemini with the user's key.
  - Domain whitelist (never archive) and trusted sites (always close), editable from Options or a tab context menu.
  - IndexedDB notebook with full-text search, Inbox / Reopened / All, favorites, tags, domains, timeline, reader view, undo, and note fading.
  - Closed-today list for one-click reopening; in-place restore when the URL is already open.
  - Side panel and full-page view from one page.
  - Markdown, Obsidian vault `.zip`, and JSON export; JSON import.
