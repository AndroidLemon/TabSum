# TabSum Privacy Policy

Effective 2026-09-16. Applies to the TabSum Chrome extension, version 1.0.0 and later.

TabSum summarizes inactive browser tabs and stores the summaries in your browser. It has no server, no account system, and no analytics. This policy describes what the extension reads, where it keeps it, and the only circumstances under which anything leaves your computer.

## What TabSum reads

To do its job, TabSum reads two kinds of data from your browser:

- **Website content.** The text of a web page, read from an inactive tab that is about to be archived, or from the active tab when you press the archive shortcut. Only pages on sites you have granted access to are read. TabSum also checks the page for unsaved form input and playing media so it can leave those tabs alone.
- **Tab metadata.** The URL, title, and favicon of each tab, and the time it was last active. This is how TabSum decides which tabs are inactive and how it reopens a tab later.

TabSum reads nothing else. It does not read cookies, passwords, form values, or anything from tabs on sites you have not granted access to.

## Where it is stored

Everything TabSum saves stays in the browser profile it runs in:

- Summaries, extracted page text, URLs, titles, tags, and timestamps are stored in the browser's IndexedDB.
- Settings, domain lists, and any API key or server address you enter are stored in `chrome.storage.local`.

Nothing is synced to other devices or to any Google account. Like all extension storage, this data is unencrypted on disk and is protected by whatever protects your operating-system user account.

## What leaves your computer

**With the default settings, nothing.** TabSum makes no network requests of its own. Summaries are written by Chrome's built-in on-device model if it is available, or by an offline heuristic if it is not.

Page text leaves your computer only if you choose one of these summarization providers in Options:

- **Google Gemini.** If you enter a Gemini API key, the extracted text of each archived page is sent to Google's Gemini API using your key. Google's terms and privacy policy for that API apply to those requests. TabSum sends the page text and nothing else.
- **A local or OpenAI-compatible server.** If you enter a server URL, the extracted text is sent to that URL. This is typically a model running on your own machine. Access to the server's origin is granted through a permission prompt when you click Test Connection. What that server does with the text is up to whoever runs it.

Favicons are read from Chrome's own local cache, never fetched from the site or from a third-party icon service.

## Permissions

TabSum asks for site access as an optional permission during onboarding, not at install. Until you grant it, TabSum does not read or archive tabs on that site. You can revoke it at any time from `chrome://extensions`, and TabSum will stop reading page content.

The other permissions it holds (tabs, storage, alarms, idle, scripting, side panel, unlimited storage, notifications, favicon, context menus) are all used locally to detect inactive tabs, read and store summaries, and show the notebook. A per-permission explanation is in the Chrome Web Store listing.

## Retention and deletion

- Unstarred notes delete themselves 30 days after capture, or 7 days after you last reopened the tab. Both timers are configurable in Options, and 0 means never. Starred notes are kept until you delete them.
- Deleting a note tombstones it for one hour so it can be undone, then removes it permanently.
- Uninstalling the extension removes all of its stored data, as Chrome does for any extension.
- You can export everything as JSON, Markdown, or an Obsidian vault at any time from the notebook.

## What TabSum does not do

- No analytics, telemetry, crash reporting, or usage tracking.
- No advertising, no selling or sharing of data with anyone.
- No remote code. Everything the extension runs ships in the package you install.
- No data is used for any purpose other than summarizing and archiving your tabs.

## Changes

If this policy changes, the effective date above changes and the new version is published at the same URL. Material changes will be noted in the extension's version history.

## Contact

Questions about this policy can be raised as an issue on the project repository: https://github.com/AndroidLemon/TabSum/issues
