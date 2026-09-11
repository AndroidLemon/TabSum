---
name: dogfood-extension-playwright
description: >-
  Automated end-to-end dogfooding and browser self-testing for Chrome extensions
  using Playwright. Use when testing unpacked Manifest V3 extensions, simulating
  multi-tab browsing workflows, measuring extraction latencies, verifying zero-loss
  safety heuristics, and gathering structured telemetry reports.
---

# Dogfood Extension with Playwright

This skill provides an automated framework for running Chrome extensions in real browser sessions with Playwright to validate lifecycle behavior, content extraction fidelity, and user interface workflows while collecting dogfood telemetry.

## When to Use

- Whenever testing or self-verifying a Chrome extension before release.
- Validating Manifest V3 background service workers, content script injections, and storage persistence.
- Gathering dogfooding performance telemetry (extraction latency, memory, summary quality).
- Verifying safety guards (e.g. ensuring tabs with unsaved form input or active audio are never auto-closed).

---

## Prerequisites

Ensure Playwright and Chromium are available in the workspace:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

---

## The 6-Stage Dogfooding Test Plan

### Stage 1: Launch Persistent Context with Extension
Chrome extensions require a persistent context and cannot run in legacy headless mode:

```js
import { chromium } from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve('.');
const context = await chromium.launchPersistentContext('/tmp/playwright-user-data', {
  headless: false, // Required for extension loading
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});
```

### Stage 2: Locate Background Service Worker & Extension ID
Wait for the background service worker registration and derive the assigned extension ID:

```js
let [background] = context.serviceWorkers();
if (!background) {
  background = await context.waitForEvent('serviceworker', { timeout: 10000 });
}
const extensionId = background.url().split('/')[2];
```

### Stage 3: Ingest Diverse Web Scenarios
Launch a local mock server or visit live test pages representing varied DOM archetypes:
1. **Dense Technical Article**: High word count, code blocks, deep headings.
2. **Short News / Blog**: Metadata-heavy (OpenGraph, byline, reading time).
3. **Dirty Draft Form**: User has active typed text in `<textarea>` or `<input>`.
4. **Active Media**: Playing `<audio>` or `<video>`.
5. **Internal / Restricted Pages**: `chrome://`, Chrome Web Store.

### Stage 4: Verify Zero-Loss Safety Heuristics
Validate that destructive or state-altering operations respect user safety:
- Ensure the extractor flags `isDirty === true` on tabs with modified input fields.
- Verify `isDirty` tabs are strictly skipped during sweeps.
- Verify pinned and audible tabs are untouched.

### Stage 5: UI & Restoration Verification
Navigate to extension views (`chrome-extension://${extensionId}/...`):
1. **Side Panel (`src/sidepanel/index.html`)**:
   - Verify permission onboarding banner.
   - Verify recent cards rendering and real-time search filtering.
2. **Wiki Dashboard (`src/wiki/index.html`)**:
   - Verify tag filtering, timeline grouping, and Reader View modal.
   - Click **"Reopen Tab"** on an archived card and verify the original URL is restored in a new tab.

### Stage 6: Telemetry Collection & Reporting
Collect and record:
- **Extraction Latency**: Milliseconds taken from script injection to clean DOM parsing.
- **Word Count & Compression Ratio**: Raw words vs summary bullet counts.
- **Safety Gate Reliability**: 100% pass rate on dirty form and media tab protections.
- Output results to a structured `DOGFOOD_REPORT.md` file.

---

## Running the Dogfooding Suite

Execute the integrated test suite with Node:

```bash
node tests/dogfood.js
```

Check the generated report in `DOGFOOD_REPORT.md`.
