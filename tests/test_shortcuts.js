/**
 * TabSum - Milestone 7 Keyboard Shortcuts & Navigation Verification Test
 * Verifies manifest command bindings, service worker onCommand listener,
 * notification & badge updates, and Knowledge Hub keyboard navigation (/, Escape, Enter).
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { chromium } from '@playwright/test';

const PORT = 8892;
import { buildTestExtension, extensionLaunchOptions, waitForServiceWorker } from './helpers/test-extension.js';

const EXTENSION_PATH = buildTestExtension();
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_shortcuts');

function createMockServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (req.url === '/article-shortcuts') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Keyboard Shortcuts in Modern Web Applications</title></head>
        <body>
          <article>
            <h1>Keyboard Shortcuts in Modern Web Applications</h1>
            <p>Keyboard shortcuts dramatically improve user productivity and ergonomics for power users.</p>
            <p>TabSum provides global shortcuts to rapidly archive and access knowledge wiki cards.</p>
          </article>
        </body>
        </html>
      `);
      return;
    }

    res.end('<h1>404 Not Found</h1>');
  });

  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

async function runShortcutsTests() {
  console.log('🧪 Starting TabSum Keyboard Shortcuts & Navigation Test Suite...\n');

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const server = await createMockServer();
  console.log(`✓ Mock server listening on http://localhost:${PORT}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR,
      extensionLaunchOptions(EXTENSION_PATH, ['--no-first-run']));

    const background = await waitForServiceWorker(context);
    const extensionId = background.url().split('/')[2];
    console.log(`✓ Extension loaded with ID: ${extensionId}\n`);

    // --- TEST 1: Manifest Commands Validation ---
    console.log('--- Test 1: Verify Manifest Command Bindings ---');
    const manifest = await background.evaluate(() => chrome.runtime.getManifest());
    assert.ok(manifest.commands, 'Manifest must declare commands');
    assert.ok(manifest.commands._execute_action, '_execute_action must exist');
    assert.strictEqual(manifest.commands._execute_action.suggested_key?.mac, 'Command+Shift+S');
    assert.strictEqual(manifest.commands._execute_action.suggested_key?.default, 'Ctrl+Shift+S');
    assert.ok(manifest.commands.archive_active_tab, 'archive_active_tab must exist');
    assert.strictEqual(manifest.commands.archive_active_tab.suggested_key?.mac, 'Command+Shift+E');
    assert.strictEqual(manifest.commands.archive_active_tab.suggested_key?.default, 'Ctrl+Shift+E');
    console.log('✓ Manifest commands bindings correctly registered in extension runtime\n');

    // --- TEST 2: onCommand Listener Execution & Active Tab Archival ---
    console.log('--- Test 2: Service Worker onCommand Archival Execution ---');
    const testPage = await context.newPage();
    await testPage.goto(`http://localhost:${PORT}/article-shortcuts`);
    await testPage.waitForLoadState('domcontentloaded');

    // Make testPage the active tab
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/article-shortcuts'));
      if (target) await chrome.tabs.update(target.id, { active: true });
    });

    // Instrument notifications in background to verify notification dispatch
    await background.evaluate(() => {
      self.__dispatchedNotifications = [];
      const originalCreate = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = (options, cb) => {
        self.__dispatchedNotifications.push(options);
        return originalCreate(options, cb);
      };
    });

    // Helper page to communicate with background service worker: the Knowledge Hub page at
    // side-panel width (narrow layout)
    const helperPage = await context.newPage();
    await helperPage.setViewportSize({ width: 380, height: 800 });
    await helperPage.goto(`chrome-extension://${extensionId}/src/app/index.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    // Ensure testPage is active tab again
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url.includes('/article-shortcuts'));
      if (target) await chrome.tabs.update(target.id, { active: true });
    });

    // Trigger archive_active_tab command
    const triggerRes = await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'TRIGGER_COMMAND',
          command: 'archive_active_tab'
        }, resolve);
      });
    });

    assert.strictEqual(triggerRes?.success, true, 'Command triggering should succeed');

    // Check badge & notification
    const swStatus = await background.evaluate(async () => {
      const badge = await chrome.action.getBadgeText({});
      const notifs = self.__dispatchedNotifications || [];
      return { badge, notificationsCount: notifs.length, lastNotification: notifs[notifs.length - 1] };
    });

    console.log(`✓ Service worker command execution complete`);
    console.log(`  Badge text: "${swStatus.badge}"`);
    console.log(`  Notifications sent: ${swStatus.notificationsCount}`);
    if (swStatus.lastNotification) {
      console.log(`  Notification title: "${swStatus.lastNotification.title}"`);
      console.log(`  Notification message: "${swStatus.lastNotification.message}"`);
    }

    assert.ok(Number(swStatus.badge) >= 1, 'Badge text must be >= 1');
    assert.ok(swStatus.notificationsCount >= 1, 'At least 1 notification must be triggered');

    // Verify record in IndexedDB
    const archivedRecord = await helperPage.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      const tabs = await getArchivedTabs({});
      return tabs.find(t => t.url.includes('/article-shortcuts'));
    });

    assert.ok(archivedRecord, 'Archived tab record must exist in IndexedDB');
    assert.strictEqual(archivedRecord.title, 'Keyboard Shortcuts in Modern Web Applications');
    console.log(`✓ Verified record persisted in IndexedDB: "${archivedRecord.title}"\n`);

    // --- TEST 3: Knowledge Hub Keyboard Navigation ---
    console.log('--- Test 3: Knowledge Hub Keyboard Navigation (/, Escape, Enter) ---');
    // Refresh the feed
    await helperPage.evaluate(async () => {
      window.location.reload();
    });
    await helperPage.waitForLoadState('domcontentloaded');

    // Wait for feed to load the archived card
    await helperPage.waitForSelector('.tab-card', { timeout: 5000 });
    console.log('✓ Knowledge Hub loaded with knowledge cards');

    // 3a. Pressing '/' focuses search input
    console.log('Testing "/" key focus shortcut...');
    await helperPage.click('.topbar');
    let isFocusedBefore = await helperPage.evaluate(() => document.activeElement.id === 'search-input');
    assert.strictEqual(isFocusedBefore, false, 'Search input should not be focused initially');

    await helperPage.keyboard.press('/');
    await helperPage.waitForTimeout(100);
    let isFocusedAfter = await helperPage.evaluate(() => document.activeElement.id === 'search-input');
    assert.strictEqual(isFocusedAfter, true, 'Pressing "/" must focus #search-input');
    console.log('✓ Pressing "/" successfully focused #search-input');

    // 3b. Typing in search bar does NOT prevent '/' when already focused
    console.log('Testing "/" key while already typing in search bar...');
    await helperPage.keyboard.type('test/');
    const inputVal = await helperPage.inputValue('#search-input');
    assert.ok(inputVal.includes('/'), 'Slash should be typed normally when already in input');
    console.log(`✓ Slash key typed into input without interception: "${inputVal}"`);

    // 3c. Pressing 'Escape' clears search and blurs input
    console.log('Testing "Escape" key to clear search and blur...');
    await helperPage.keyboard.press('Escape');
    await helperPage.waitForTimeout(200);

    const clearedVal = await helperPage.inputValue('#search-input');
    const isBlurred = await helperPage.evaluate(() => document.activeElement.id !== 'search-input');
    assert.strictEqual(clearedVal, '', 'Pressing Escape must clear #search-input');
    assert.strictEqual(isBlurred, true, 'Pressing Escape must blur #search-input');
    console.log('✓ Pressing "Escape" successfully cleared value and blurred #search-input');

    // 3d. Pressing 'Enter' in search bar restores the top filtered result
    console.log('Testing "Enter" key in search bar to restore top result...');
    await helperPage.keyboard.press('/');
    await helperPage.fill('#search-input', 'Shortcuts');

    // Press Enter in search input
    await helperPage.keyboard.press('Enter');
    await helperPage.waitForTimeout(600);

    // Toast should appear and restore action triggered
    const toastText = await helperPage.locator('#toast').textContent();
    console.log(`✓ Action triggered on Enter. Toast message: "${toastText}"`);
    assert.ok(toastText.includes('tab') || toastText.includes('Tab') || toastText.includes('sleeping'), 'Toast should confirm tab restoration');

    console.log('\n========================================================');
    console.log('🎉 ALL KEYBOARD SHORTCUTS & NAVIGATION TESTS PASSED! 🎉');
    console.log('========================================================\n');

  } finally {
    if (context) await context.close();
    server.close();
  }
}

runShortcutsTests().catch(err => {
  console.error('❌ Shortcuts Test Failure:', err);
  process.exit(1);
});
