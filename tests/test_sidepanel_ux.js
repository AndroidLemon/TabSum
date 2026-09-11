/**
 * TabSum - Workstreams 1, 2, 3 Side Panel UX Verification Test
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { chromium } from '@playwright/test';

const EXTENSION_PATH = path.resolve('.');
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_ux');

async function runSidePanelUXTests() {
  console.log('🧪 Starting TabSum Side Panel UX Verification Test Suite...\n');

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

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

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await page.waitForLoadState('domcontentloaded');

    // Seed test data in IndexedDB
    await page.evaluate(async () => {
      const { saveArchivedTab } = await import('/src/storage/db.js');
      await saveArchivedTab({
        id: 'test-tab-1',
        url: 'https://example.com/deep-learning',
        title: 'Deep Learning and Neural Networks',
        domain: 'example.com',
        capturedAt: Date.now() - 60000,
        readingTimeMinutes: 5,
        summary: {
          tldr: 'An extensive overview of modern deep learning architectures.',
          bullets: [
            'Convolutional networks excel at visual patterns.',
            'Transformers dominate NLP and multimodal tasks.',
            'Optimization requires careful learning rate scheduling.'
          ],
          tags: ['ai', 'machine-learning', 'research']
        },
        status: 'archived'
      });

      await saveArchivedTab({
        id: 'test-tab-2',
        url: 'https://developer.mozilla.org/web-apis',
        title: 'Modern Web APIs and Ergonomics',
        domain: 'developer.mozilla.org',
        capturedAt: Date.now() - 120000,
        readingTimeMinutes: 3,
        summary: {
          tldr: 'Exploring progressive disclosure and web performance APIs.',
          bullets: [
            'Backdrop filters and CSS view transitions.',
            'Tactile micro-interactions improve satisfaction.'
          ],
          tags: ['web', 'frontend', 'design']
        },
        status: 'discarded'
      });
    });

    // Reload side panel to display seeded tabs
    await page.reload();
    await page.waitForSelector('.tab-card', { timeout: 5000 });
    console.log('✓ Side panel loaded with 2 seeded cards\n');

    // --- TEST 1: Search Clear Button & Keyboard Badge ---
    console.log('--- Test 1: Search Clear Button & Keyboard Hint ---');
    const kbdHint = page.locator('#search-kbd-hint');
    const clearBtn = page.locator('#search-clear-btn');
    const searchInput = page.locator('#search-input');

    // Initially kbd hint visible, clear btn hidden
    assert.strictEqual(await clearBtn.isHidden(), true, 'Clear button should be hidden when search is empty');
    assert.strictEqual(await kbdHint.isVisible(), true, 'Keyboard hint / should be visible when search is empty');

    // Type query
    await searchInput.fill('Deep');
    await page.waitForTimeout(300);
    assert.strictEqual(await clearBtn.isVisible(), true, 'Clear button should be visible when input has text');
    assert.strictEqual(await kbdHint.isHidden(), true, 'Keyboard hint should be hidden when input has text');

    // --- TEST 2: Search Highlighting ---
    console.log('--- Test 2: Search Highlighting with <mark class="search-highlight"> ---');
    const highlight = page.locator('mark.search-highlight');
    const highlightCount = await highlight.count();
    console.log(`  Found ${highlightCount} highlight marks for "Deep"`);
    assert.ok(highlightCount >= 1, 'Should highlight matching term "Deep"');
    const highlightText = await highlight.first().textContent();
    assert.strictEqual(highlightText.toLowerCase(), 'deep');
    console.log('✓ Search highlighting verified\n');

    // Click clear button
    await clearBtn.click();
    await page.waitForTimeout(300);
    assert.strictEqual(await searchInput.inputValue(), '', 'Search input should be cleared');
    assert.strictEqual(await clearBtn.isHidden(), true, 'Clear button should be hidden after clearing');
    assert.strictEqual(await kbdHint.isVisible(), true, 'Keyboard hint should be visible after clearing');
    console.log('✓ Clear button and keyboard hint behavior verified\n');

    // --- TEST 3: Progressive Disclosure of Takeaways ---
    console.log('--- Test 3: Progressive Disclosure of Takeaways ---');
    const firstCard = page.locator('.tab-card[data-id="test-tab-1"]');
    const takeawaysBtn = firstCard.locator('.takeaways-toggle');
    const bulletsList = firstCard.locator('.card-bullets');

    assert.strictEqual(await takeawaysBtn.isVisible(), true, 'Takeaways toggle button should be visible');
    assert.strictEqual(await bulletsList.evaluate(el => el.classList.contains('collapsed')), true, 'Bullets list should be collapsed by default');

    // Click to expand
    await takeawaysBtn.click();
    await page.waitForTimeout(100);
    assert.strictEqual(await bulletsList.evaluate(el => el.classList.contains('collapsed')), false, 'Bullets list should be expanded after click');
    assert.strictEqual(await takeawaysBtn.evaluate(el => el.classList.contains('open')), true, 'Toggle button should have .open class');

    // Click to collapse
    await takeawaysBtn.click();
    await page.waitForTimeout(100);
    assert.strictEqual(await bulletsList.evaluate(el => el.classList.contains('collapsed')), true, 'Bullets list should collapse again');
    console.log('✓ Progressive disclosure of takeaways verified\n');

    // --- TEST 4: Density Toggle (Comfortable / Compact) ---
    console.log('--- Test 4: Density Toggle (Comfortable / Compact) ---');
    const densityBtn = page.locator('#density-toggle-btn');
    assert.strictEqual(await densityBtn.evaluate(el => el.classList.contains('active')), false, 'Density button should not be active initially');

    // Switch to compact view
    await densityBtn.click();
    await page.waitForTimeout(100);
    assert.strictEqual(await densityBtn.evaluate(el => el.classList.contains('active')), true, 'Density button should have .active in compact mode');
    assert.strictEqual(await firstCard.evaluate(el => el.classList.contains('compact')), true, 'Cards should have .compact class');

    // Verify storage persistence
    const storedDensity = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('sidepanel_density');
      return data.sidepanel_density;
    });
    assert.strictEqual(storedDensity, 'compact', 'Compact density should be stored in chrome.storage.local');

    // Switch back to comfortable
    await densityBtn.click();
    await page.waitForTimeout(100);
    assert.strictEqual(await firstCard.evaluate(el => el.classList.contains('compact')), false, 'Cards should revert to comfortable');
    console.log('✓ Density toggle and storage persistence verified\n');

    // --- TEST 5: Keyboard Navigation (j / k / Enter) ---
    console.log('--- Test 5: Keyboard Navigation (j / k / Enter) ---');
    // Ensure search input is blurred
    await page.keyboard.press('Escape');

    // Press j to select first card
    await page.keyboard.press('j');
    await page.waitForTimeout(100);
    const card1Selected = await page.locator('.tab-card[data-id="test-tab-1"]').evaluate(el => el.classList.contains('keyboard-selected'));
    assert.strictEqual(card1Selected, true, 'First card should have .keyboard-selected after pressing j');

    // Press j again to select second card
    await page.keyboard.press('j');
    await page.waitForTimeout(100);
    const card2Selected = await page.locator('.tab-card[data-id="test-tab-2"]').evaluate(el => el.classList.contains('keyboard-selected'));
    assert.strictEqual(card2Selected, true, 'Second card should have .keyboard-selected after pressing j again');

    // Press k to select first card again
    await page.keyboard.press('k');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.locator('.tab-card[data-id="test-tab-1"]').evaluate(el => el.classList.contains('keyboard-selected')), true, 'First card should have .keyboard-selected after pressing k');
    console.log('✓ j / k keyboard card selection verified\n');

    // --- TEST 6: Staged 5-Second Deletion & Interactive Undo Toast ---
    console.log('--- Test 6: Staged 5-Second Deletion & Interactive Undo Toast ---');
    const deleteBtn = firstCard.locator('.delete-btn');
    await deleteBtn.click();

    // Check .removing animation class applied
    const isRemoving = await firstCard.evaluate(el => el.classList.contains('removing'));
    assert.strictEqual(isRemoving, true, 'Card should receive .removing class on delete');

    // Verify Undo toast is displayed
    await page.waitForTimeout(100);
    const toast = page.locator('#toast');
    const toastUndoBtn = page.locator('#toast-undo-btn');
    assert.strictEqual(await toast.isVisible(), true, 'Toast should be visible');
    assert.strictEqual(await toastUndoBtn.isVisible(), true, 'Undo button in toast should be visible');

    // Click Undo
    console.log('Clicking Undo button...');
    await toastUndoBtn.click();
    await page.waitForTimeout(300);

    // Verify card is restored and in DOM
    const restoredCard = page.locator('.tab-card[data-id="test-tab-1"]');
    assert.strictEqual(await restoredCard.isVisible(), true, 'Card should be restored in feed after clicking Undo');
    console.log('✓ Staged deletion and Undo restoration verified\n');

    // Test actual deletion after 5 seconds
    console.log('Testing deletion permanence after 5.2 seconds...');
    const cardToDelete = page.locator('.tab-card[data-id="test-tab-2"]');
    await cardToDelete.locator('.delete-btn').click();
    await page.waitForTimeout(5300);

    // Verify record is permanently removed from IndexedDB
    const tab2ExistsInDb = await page.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      const tabs = await getArchivedTabs({});
      return tabs.some(t => t.id === 'test-tab-2');
    });
    assert.strictEqual(tab2ExistsInDb, false, 'Card should be permanently deleted from DB after 5s');
    console.log('✓ Permanent deletion verified after 5s timeout\n');

    // --- TEST 7: Defer Deletions Until Close Option ---
    console.log('--- Test 7: Defer Deletions Until Close Setting ---');
    // Seed a tab to test deferred deletion
    await page.evaluate(async () => {
      const { saveArchivedTab, saveSettings } = await import('/src/storage/db.js');
      await saveSettings({ deferDeletionsUntilClose: true });
      await saveArchivedTab({
        id: 'test-tab-deferred',
        url: 'https://example.com/deferred',
        title: 'Deferred Deletion Test Tab',
        domain: 'example.com',
        capturedAt: Date.now(),
        readingTimeMinutes: 1,
        summary: { tldr: 'Will not delete until window close.', bullets: [], tags: [] },
        status: 'archived'
      });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const deferredCard = page.locator('.tab-card[data-id="test-tab-deferred"]');
    assert.strictEqual(await deferredCard.isVisible(), true, 'Deferred test card should be rendered');

    // Click delete
    await deferredCard.locator('.delete-btn').click();
    await page.waitForTimeout(300);

    // Toast should show deferred deletion notice
    const deferredToastText = await page.locator('#toast-message').textContent();
    assert.ok(deferredToastText.includes('pending deletion on close'), 'Toast should indicate deletion is deferred until close');

    // Wait 1.5s - in standard mode, this would still be pending, but verify it is still in DB
    await page.waitForTimeout(1500);
    const stillInDb = await page.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      const tabs = await getArchivedTabs({});
      return tabs.some(t => t.id === 'test-tab-deferred');
    });
    assert.strictEqual(stillInDb, true, 'Card should still exist in DB while panel is open');

    // Trigger unload to finalize pending deletions
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    await page.waitForTimeout(300);

    // Verify it is now permanently deleted
    const deletedAfterUnload = await page.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      const tabs = await getArchivedTabs({});
      return tabs.some(t => t.id === 'test-tab-deferred');
    });
    assert.strictEqual(deletedAfterUnload, false, 'Card should be permanently deleted after panel beforeunload');
    console.log('✓ Defer deletions until close verified\n');

    // --- TEST 8: Close Sidebar When Opening Dashboard Setting ---
    console.log('--- Test 8: Close Sidebar When Opening Dashboard Setting ---');
    const openWikiBtn = page.locator('#open-wiki-btn');
    assert.strictEqual(await openWikiBtn.isVisible(), true, 'Open wiki button should be visible');

    // Track tab creations
    const [wikiPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 8000 }),
      openWikiBtn.click()
    ]);

    await wikiPage.waitForLoadState('domcontentloaded');
    assert.ok(wikiPage.url().includes('src/wiki/index.html'), 'Wiki dashboard tab should be opened');
    console.log('✓ Wiki dashboard tab successfully opened from sidebar');
    // Verify sidepanel closed itself
    await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(page.isClosed(), true, 'Sidepanel page should be closed after opening wiki dashboard');
    console.log('✓ Sidepanel closed automatically on dashboard open verified\n');

    // Reset settings for cleanliness via wikiPage
    await wikiPage.evaluate(async () => {
      const { saveSettings, DEFAULT_SETTINGS } = await import('/src/storage/db.js');
      await saveSettings(DEFAULT_SETTINGS);
    });

    console.log('========================================================');
    console.log('🎉 ALL WORKSTREAMS 1, 2, 3 & NEW OPTIONS TESTS PASSED! 🎉');
    console.log('========================================================\n');

  } finally {
    if (context) await context.close();
  }
}

runSidePanelUXTests().catch(err => {
  console.error('❌ Side Panel UX Test Failure:', err);
  process.exit(1);
});
