/**
 * TabSum - Core Tab Hardening Verification Suite
 * Tests deduplication, two-phase commit status transitions,
 * orphan pending reconciliation, expanded zero-loss safety detection (Shadow DOM, rich editors),
 * and in-place tab reactivation without duplicate tabs.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { chromium } from '@playwright/test';
import { mergeFrameExtractions, classifyClosureSafety } from '../src/shared/closure-policy.js';

const PORT = 8891;
import { buildTestExtension, extensionLaunchOptions } from './helpers/test-extension.js';

const EXTENSION_PATH = buildTestExtension();
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_hardening');

// Mock server serving test pages for dirty checks and lifecycle testing
function createMockServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (req.url === '/clean-article') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Clean Technical Article</title></head>
        <body>
          <article>
            <h1>Clean Technical Article</h1>
            <p>This is a standard article without any dirty form inputs or running media.</p>
          </article>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/rich-editor') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Document Editor</title></head>
        <body>
          <div class="ProseMirror" contenteditable="true">
            <p>This is an active draft written in a ProseMirror rich text container.</p>
          </div>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/shadow-dom-form') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Web Component Form</title></head>
        <body>
          <div id="host"></div>
          <script>
            const host = document.getElementById('host');
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = \`
              <form>
                <input type="text" id="shadow-input" value="Unsaved shadow draft">
              </form>
            \`;
            // Alter value from defaultValue to simulate user typing
            const inp = shadow.getElementById('shadow-input');
            inp.value = 'Unsaved typed text in shadow root';
          </script>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/role-textbox') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Collaboration App Editor</title></head>
        <body>
          <h1>Issue Tracker</h1>
          <div role="textbox" aria-multiline="true">
            Fixing the memory leak in the transaction manager component.
          </div>
        </body>
        </html>
      `);
      return;
    }

    // The iframe-hosted editor case: the draft lives in a frame the top
    // document cannot reach, so a top-frame-only injection reports isDirty=false.
    if (req.url === '/framed-editor') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>CMS Compose</title></head>
        <body>
          <h1>Edit Post</h1>
          <iframe src="/framed-editor-inner" width="600" height="400"></iframe>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/framed-editor-inner') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <body>
          <textarea id="draft"></textarea>
          <script>document.getElementById('draft').value = 'Half-written post the user has not saved yet.';</script>
        </body>
        </html>
      `);
      return;
    }

    // Step 4's intent, from the other side: a long article whose only controls
    // are a docs version picker and a CSS-hack menu toggle, neither in a form.
    if (req.url === '/orphan-picker') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>API Reference</title></head>
        <body>
          <nav>
            <input type="checkbox" id="menu-toggle"><label for="menu-toggle">Menu</label>
            <select id="version"><option>v3.12</option><option>v3.11</option></select>
          </nav>
          <main><h1>Reference</h1><p>${'The reference describes every parameter in detail. '.repeat(40)}</p></main>
        </body>
        </html>
      `);
      return;
    }

    res.end('<h1>404 Not Found</h1>');
  });

  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

async function runHardeningTests() {
  console.log('🧪 Starting TabSum Core Tab Hardening Test Suite...\n');

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const server = await createMockServer();
  console.log(`✓ Mock server listening on http://localhost:${PORT}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR,
      extensionLaunchOptions(EXTENSION_PATH, ['--no-first-run']));

    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = background.url().split('/')[2];
    console.log(`✓ Extension loaded with ID: ${extensionId}\n`);

    // Helper page to run extension db queries
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/src/app/index.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    // --- TEST 1: Deduplication on Repeated Archival ---
    console.log('--- Test 1: Deduplication on Repeated Archival ---');
    const dupResult = await helperPage.evaluate(async () => {
      const { saveArchivedTab, getArchivedTabs } = await import('/src/storage/db.js');
      const url = 'https://example.com/test-deduplication';
      
      const rec1 = await saveArchivedTab({
        url,
        title: 'Dedup Title 1',
        status: 'archived'
      });

      // Second save within 1 hour for the identical URL
      const rec2 = await saveArchivedTab({
        url,
        title: 'Dedup Title 2 Updated',
        status: 'discarded'
      });

      const allTabs = await getArchivedTabs({ status: 'discarded' });
      const matches = allTabs.filter(t => t.url === url);

      return {
        rec1Id: rec1.id,
        rec2Id: rec2.id,
        matchesCount: matches.length,
        finalTitle: matches[0]?.title
      };
    });

    assert.strictEqual(dupResult.rec1Id, dupResult.rec2Id, 'Repeated save for same URL must preserve record ID');
    assert.strictEqual(dupResult.matchesCount, 1, 'Should have exactly 1 record for URL after repeated save');
    assert.strictEqual(dupResult.finalTitle, 'Dedup Title 2 Updated', 'Record should be updated with new data');
    console.log('✓ Deduplication verified: repeated save for same URL updates existing record\n');

    // --- TEST 4: Deep Zero-Loss Safety Guards (Shadow DOM, Rich Editors, BeforeUnload) ---
    console.log('--- Test 4: Deep Zero-Loss Safety Guards ---');

    // 4a. ProseMirror Rich Text Editor
    const richPage = await context.newPage();
    await richPage.goto(`http://localhost:${PORT}/rich-editor`);
    await richPage.waitForLoadState('domcontentloaded');

    const richCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/rich-editor'));
      const results = await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ['src/content/in-tab-extractor.js']
      });
      return results?.[0]?.result;
    });

    assert.strictEqual(richCheck.isDirty, true, 'ProseMirror rich editor draft must trigger isDirty');
    console.log(`✓ Rich editor detected: reason = "${richCheck.reason}"`);
    await richPage.close();

    // 4a-2. Editor inside an iframe — requires allFrames injection + frame merge
    const framedPage = await context.newPage();
    await framedPage.goto(`http://localhost:${PORT}/framed-editor`);
    await framedPage.waitForLoadState('domcontentloaded');
    await framedPage.waitForTimeout(500);

    // The worker can't dynamic-import (banned on ServiceWorkerGlobalScope), so it
    // hands back the raw per-frame results and the pure merge runs here in Node.
    const framedCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/framed-editor'));
      const topOnly = await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ['src/content/in-tab-extractor.js']
      });
      const allFrames = await chrome.scripting.executeScript({
        target: { tabId: target.id, allFrames: true },
        files: ['src/content/in-tab-extractor.js']
      });
      return { topOnlyDirty: topOnly?.[0]?.result?.isDirty, allFrames };
    });

    const framedMerged = mergeFrameExtractions(framedCheck.allFrames);
    assert.ok(framedCheck.allFrames.length >= 2, 'allFrames must reach the subframe');
    assert.strictEqual(framedCheck.topOnlyDirty, false,
      'top-frame-only injection is blind to the framed draft (this is the bug)');
    assert.strictEqual(framedMerged.isDirty, true,
      'merged extraction must see the unsaved draft inside the iframe');
    assert.strictEqual(framedMerged.title, 'CMS Compose',
      'and identity must still come from the top frame');
    console.log(`✓ Framed editor detected across ${framedCheck.allFrames.length} frames: reason = "${framedMerged.reason}"`);
    await framedPage.close();

    // 4a-3. Orphan picker: a version <select> and a menu checkbox outside any
    // form are site chrome, and must not hold a long article open.
    const orphanPage = await context.newPage();
    await orphanPage.goto(`http://localhost:${PORT}/orphan-picker`);
    await orphanPage.waitForLoadState('domcontentloaded');

    const orphanCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/orphan-picker'));
      const results = await chrome.scripting.executeScript({
        target: { tabId: target.id, allFrames: true },
        files: ['src/content/in-tab-extractor.js']
      });
      return results?.[0]?.result;
    });

    assert.strictEqual(orphanCheck.closureTelemetry.inputCounts.selects, 0,
      'a version picker outside a form is chrome, not data entry');
    assert.strictEqual(orphanCheck.closureTelemetry.inputCounts.otherInputs, 0,
      'a menu checkbox outside a form is chrome, not data entry');
    assert.strictEqual(
      classifyClosureSafety({ ...orphanCheck.closureTelemetry, wordCount: orphanCheck.wordCount }).tier,
      'safe_to_close', 'so the article underneath them stays closeable');
    console.log(`✓ Orphan picker ignored: article with ${orphanCheck.wordCount} words stays closeable`);
    await orphanPage.close();

    // 4b. Shadow DOM Form Input
    const shadowPage = await context.newPage();
    await shadowPage.goto(`http://localhost:${PORT}/shadow-dom-form`);
    await shadowPage.waitForLoadState('domcontentloaded');

    const shadowCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/shadow-dom-form'));
      const results = await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ['src/content/in-tab-extractor.js']
      });
      return results?.[0]?.result;
    });

    assert.strictEqual(shadowCheck.isDirty, true, 'Shadow DOM modified input must trigger isDirty');
    console.log(`✓ Shadow DOM input detected: reason = "${shadowCheck.reason}"`);
    await shadowPage.close();

    // 4c. Role="textbox" (Slack / Notion / Jira editor)
    const rolePage = await context.newPage();
    await rolePage.goto(`http://localhost:${PORT}/role-textbox`);
    await rolePage.waitForLoadState('domcontentloaded');

    const roleCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/role-textbox'));
      const results = await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ['src/content/in-tab-extractor.js']
      });
      return results?.[0]?.result;
    });

    assert.strictEqual(roleCheck.isDirty, true, 'Role="textbox" editor draft must trigger isDirty');
    console.log(`✓ Role="textbox" editor detected: reason = "${roleCheck.reason}"`);
    await rolePage.close();

    // 4d. Clean Page
    const cleanPage = await context.newPage();
    await cleanPage.goto(`http://localhost:${PORT}/clean-article`);
    await cleanPage.waitForLoadState('domcontentloaded');

    const cleanCheck = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/clean-article'));
      const results = await chrome.scripting.executeScript({
        target: { tabId: target.id },
        files: ['src/content/in-tab-extractor.js']
      });
      return results?.[0]?.result;
    });

    assert.strictEqual(cleanCheck.isDirty, false, 'Clean page must not be flagged dirty');
    assert.ok(cleanCheck.cleanText.includes('Clean Technical Article'), 'Clean text must be extracted');
    console.log('✓ Clean page correctly permitted for extraction\n');

    // --- TEST 5: Sleeping Tab Attribution (💤) & In-Place Restore ---
    console.log('--- Test 5: Sleeping Tab Marker (💤) & In-Place Restore ---');

    // Ensure helperPage is active so cleanPage is in the background before discarding
    await helperPage.bringToFront();
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const helper = tabs.find(t => t.url.includes('/src/app/'));
      if (helper) await chrome.tabs.update(helper.id, { active: true });
    });
    await helperPage.waitForTimeout(300);

    // Simulate title prefix injection for sleeping tab
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/clean-article'));
      if (!target) return;

      await chrome.scripting.executeScript({
        target: { tabId: target.id },
        func: () => {
          if (!document.title.startsWith('💤 ')) {
            document.title = '💤 ' + document.title;
          }
        }
      });
    });

    // Verify title in tab strip has 💤 prefix
    const tabTitle = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/clean-article'));
      return target?.title;
    });

    assert.ok(tabTitle?.startsWith('💤 '), `Sleeping tab title must start with 💤 , got "${tabTitle}"`);
    console.log(`✓ Sleeping tab indicator confirmed in browser tab: "${tabTitle}"`);

    // Test 5a: RESTORE_TAB on living tab -> Reactivates in-place (no duplicate tabs)
    const initialPagesCount = context.pages().length;
    const restoreLivingResponse = await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'RESTORE_TAB',
          url: 'http://localhost:8891/clean-article'
        }, resolve);
      });
    });

    assert.strictEqual(restoreLivingResponse?.success, true, 'Restore message must succeed');
    assert.strictEqual(restoreLivingResponse?.restoredInPlace, true, 'Must reactivate existing tab in place');
    const afterPagesCount = context.pages().length;
    assert.strictEqual(afterPagesCount, initialPagesCount, 'Page count must not increase when restoring living tab');
    console.log('✓ Smart In-Place Restore reactivated living tab with 0 duplicate tabs spawned');

    // Test 5b: RESTORE_TAB on closed tab -> Opens fresh tab
    await cleanPage.close();
    const afterCloseCount = context.pages().length;
    const restoreClosedResponse = await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'RESTORE_TAB',
          url: 'http://localhost:8891/clean-article'
        }, resolve);
      });
    });

    assert.strictEqual(restoreClosedResponse?.success, true, 'Restore closed tab message must succeed');
    assert.strictEqual(restoreClosedResponse?.restoredInPlace, false, 'Closed tab must open fresh tab');
    await helperPage.waitForTimeout(500);
    const afterReopenCount = context.pages().length;
    assert.strictEqual(afterReopenCount, afterCloseCount + 1, 'Page count must increase by 1 for closed tab');
    console.log('✓ Fallback restore successfully opened fresh tab for closed tab\n');

    console.log('====================================================');
    console.log('🎉 ALL TAB HARDENING TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================');

  } finally {
    if (context) await context.close();
    server.close();
  }
}

runHardeningTests().catch(err => {
  console.error('❌ Tab Hardening Test Failure:', err);
  process.exit(1);
});
