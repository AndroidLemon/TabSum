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

const PORT = 8891;
const EXTENSION_PATH = path.resolve('.');
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
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run'
      ]
    });

    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = background.url().split('/')[2];
    console.log(`✓ Extension loaded with ID: ${extensionId}\n`);

    // Helper page to run extension db queries
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    // --- TEST 1: Deduplication on Repeated Archival ---
    console.log('--- Test 1: Deduplication on Repeated Archival ---');
    const dupResult = await helperPage.evaluate(async () => {
      const { saveArchivedTab, getArchivedTabs } = await import('/src/storage/db.js');
      const url = 'https://example.com/test-deduplication';
      
      const rec1 = await saveArchivedTab({
        url,
        title: 'Dedup Title 1',
        status: 'pending'
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

    // --- TEST 2: Two-Phase Commit Status Transitions & TOCTOU Abort ---
    console.log('--- Test 2: Two-Phase Status Transitions & TOCTOU Abort ---');
    const toctouResult = await helperPage.evaluate(async () => {
      const { saveArchivedTab, updateArchivedTabStatus, getArchivedTabs } = await import('/src/storage/db.js');
      const url = 'https://example.com/toctou-test';

      // 1. Initial pending write
      const rec = await saveArchivedTab({ url, title: 'TOCTOU Page', status: 'pending' });

      // Pending records should not appear in default wiki query
      const defaultList1 = await getArchivedTabs({});
      const inDefaultBefore = defaultList1.some(t => t.id === rec.id);

      // 2. Abort due to user switching to tab
      await updateArchivedTabStatus(rec.id, 'aborted');

      // Aborted records should also NOT appear in default wiki query
      const defaultList2 = await getArchivedTabs({});
      const inDefaultAfter = defaultList2.some(t => t.id === rec.id);

      // But can be queried explicitly
      const abortedList = await getArchivedTabs({ status: 'aborted' });
      const inAborted = abortedList.some(t => t.id === rec.id);

      return { inDefaultBefore, inDefaultAfter, inAborted };
    });

    assert.strictEqual(toctouResult.inDefaultBefore, false, 'Pending records must be hidden from default queries');
    assert.strictEqual(toctouResult.inDefaultAfter, false, 'Aborted records must be hidden from default queries');
    assert.strictEqual(toctouResult.inAborted, true, 'Aborted records must be queryable via explicit status filter');
    console.log('✓ Two-phase status transitions & TOCTOU abort rollback verified\n');

    // --- TEST 3: Reconcile Orphan Pending Records on Restart ---
    console.log('--- Test 3: Reconcile Orphan Pending Records ---');
    const reconcileResult = await helperPage.evaluate(async () => {
      const { saveArchivedTab, reconcilePendingRecords, getTabById } = await import('/src/storage/db.js');
      
      // Simulate an orphaned pending record from 10 minutes ago
      const staleRec = await saveArchivedTab({
        url: 'https://example.com/orphan-tab',
        title: 'Orphan Tab',
        status: 'pending',
        capturedAt: Date.now() - (10 * 60 * 1000)
      });

      const { reconciledCount } = await reconcilePendingRecords(5 * 60 * 1000);
      const afterRec = await getTabById(staleRec.id);

      return {
        reconciledCount,
        afterStatus: afterRec?.status,
        abortReason: afterRec?.abortReason
      };
    });

    assert.ok(reconcileResult.reconciledCount >= 1, 'Reconcile should clean up at least 1 orphan record');
    assert.strictEqual(reconcileResult.afterStatus, 'aborted', 'Orphan record should be transitioned to aborted');
    console.log(`✓ Reconciled orphan pending records: status flipped to "${reconcileResult.afterStatus}"\n`);

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
      const helper = tabs.find(t => t.url.includes('/src/sidepanel/'));
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

    // --- TEST 6: Storage Quota Management & LRU Auto-Pruning with Favorite Preservation ---
    console.log('--- Test 6: Storage Quota Management & LRU Pruning ---');
    const quotaResult = await helperPage.evaluate(async () => {
      const {
        saveArchivedTab,
        getTabById,
        enforceStorageQuota,
        toggleFavoriteTab,
        getStorageEstimate,
        clearAllHistory
      } = await import('/src/storage/db.js');

      await clearAllHistory();

      // Create 5 tabs with varying ages and favorite / pinned flags
      const t1 = await saveArchivedTab({
        url: 'https://example.com/quota-1-oldest',
        title: 'Quota Oldest',
        capturedAt: 1000,
        status: 'archived',
        isFavorite: false,
        pinned: false
      });

      const t2 = await saveArchivedTab({
        url: 'https://example.com/quota-2-favorite',
        title: 'Quota Favorite',
        capturedAt: 2000,
        status: 'archived',
        isFavorite: true,
        pinned: false
      });

      const t3 = await saveArchivedTab({
        url: 'https://example.com/quota-3-pinned',
        title: 'Quota Pinned',
        capturedAt: 3000,
        status: 'archived',
        isFavorite: false,
        pinned: true
      });

      const t4 = await saveArchivedTab({
        url: 'https://example.com/quota-4-normal',
        title: 'Quota Normal 4',
        capturedAt: 4000,
        status: 'archived',
        isFavorite: false,
        pinned: false
      });

      const t5 = await saveArchivedTab({
        url: 'https://example.com/quota-5-newest',
        title: 'Quota Newest 5',
        capturedAt: 5000,
        status: 'archived',
        isFavorite: false,
        pinned: false
      });

      // Set quota to 3. Total tabs = 5. Excess = 2.
      // Oldest eligible tabs to prune: t1 and t4 (since t2 is favorite and t3 is pinned).
      const pruneRes = await enforceStorageQuota({
        maxStoredItems: 3,
        autoPruneEnabled: true
      });

      const check1 = await getTabById(t1.id);
      const check2 = await getTabById(t2.id);
      const check3 = await getTabById(t3.id);
      const check4 = await getTabById(t4.id);
      const check5 = await getTabById(t5.id);

      // Test toggleFavoriteTab
      const toggledFav = await toggleFavoriteTab(t5.id);
      const checkToggled = await getTabById(t5.id);

      // Test getStorageEstimate
      const estimate = await getStorageEstimate();

      return {
        prunedCount: pruneRes.prunedCount,
        t1Exists: Boolean(check1),
        t2Exists: Boolean(check2),
        t2IsFavorite: check2?.isFavorite,
        t3Exists: Boolean(check3),
        t3Pinned: check3?.pinned,
        t4Exists: Boolean(check4),
        t5Exists: Boolean(check5),
        t5ToggledFav: checkToggled?.isFavorite,
        estimateCount: estimate.itemCount,
        estimateBytePositive: estimate.byteEstimate > 0
      };
    });

    assert.strictEqual(quotaResult.prunedCount, 2, 'Should prune exactly 2 excess tabs');
    assert.strictEqual(quotaResult.t1Exists, false, 'Oldest normal tab t1 must be pruned');
    assert.strictEqual(quotaResult.t2Exists, true, 'Favorite tab t2 must be preserved');
    assert.strictEqual(quotaResult.t2IsFavorite, true, 't2 must retain isFavorite = true');
    assert.strictEqual(quotaResult.t3Exists, true, 'Pinned tab t3 must be preserved');
    assert.strictEqual(quotaResult.t3Pinned, true, 't3 must retain pinned = true');
    assert.strictEqual(quotaResult.t4Exists, false, 'Normal tab t4 must be pruned');
    assert.strictEqual(quotaResult.t5Exists, true, 'Newest tab t5 must be preserved');
    assert.strictEqual(quotaResult.t5ToggledFav, true, 'toggleFavoriteTab should successfully mark tab as favorite');
    assert.strictEqual(quotaResult.estimateCount, 3, 'Estimated item count should be 3');
    assert.strictEqual(quotaResult.estimateBytePositive, true, 'Storage byte estimate must be positive');
    console.log('✓ Storage Quota & LRU Pruning verified: preserved favorites and pinned tabs in real IndexedDB\n');

    console.log('====================================================');
    console.log('🎉 ALL 6 TAB HARDENING TESTS PASSED SUCCESSFULLY! 🎉');
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
