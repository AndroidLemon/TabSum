/**
 * TabSum - Knowledge Hub UX Verification (Playwright)
 *
 * src/app/index.html is one page loaded both in Chrome's side panel and in a full tab.
 * This suite drives the narrow layout (side-panel width) and the wide layout (full tab),
 * plus the panel-only controls with chrome.tabs.getCurrent() stubbed to mimic the panel.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { chromium } from '@playwright/test';

import { buildTestExtension } from './helpers/test-extension.js';

const EXTENSION_PATH = buildTestExtension();
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_ux');
const NARROW = { width: 380, height: 800 };
const WIDE = { width: 1280, height: 800 };

async function runAppUXTests() {
  console.log('🧪 Starting TabSum Knowledge Hub UX Verification Test Suite...\n');

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
    const APP_URL = `chrome-extension://${extensionId}/src/app/index.html`;
    console.log(`✓ Extension loaded with ID: ${extensionId}\n`);

    const page = await context.newPage();
    await page.setViewportSize(NARROW);
    await page.goto(APP_URL);
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
        cleanText: '# Deep Learning\n\nThe full article text about neural networks lives here.',
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
          bullets: ['Backdrop filters and CSS view transitions.', 'Tactile micro-interactions improve satisfaction.'],
          tags: ['web', 'frontend', 'design']
        },
        status: 'discarded'
      });
      await saveArchivedTab({
        id: 'test-tab-3',
        url: 'https://docs.example.org/manual-save',
        title: 'Manually Saved Reference Page',
        domain: 'docs.example.org',
        capturedAt: Date.now() - 180000,
        readingTimeMinutes: 2,
        summary: { tldr: 'A page saved while the tab stays open.', bullets: ['Still open in the browser.'], tags: ['web'] },
        status: 'captured',
        closureReason: 'Saved manually; tab left open'
      });
    });

    await page.reload();
    await page.waitForSelector('.tab-card', { timeout: 5000 });
    const cardIds = (p = page) => p.$$eval('#tabs-feed .tab-card', cards => cards.map(c => c.dataset.id));
    console.log('✓ Knowledge Hub loaded with 3 seeded cards\n');

    // --- TEST 1: Surface detection & narrow layout ---
    console.log('--- Test 1: Surface Detection (tab) & Narrow Layout (380px) ---');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.surface), 'tab', 'Opened as a tab, surface must be "tab"');
    assert.strictEqual(await page.locator('#archive-current-btn').isHidden(), true, '"Archive Current Tab" must be hidden when opened as a tab');
    assert.strictEqual(await page.locator('#open-full-btn').isHidden(), true, '"Open full view" must be hidden when opened as a tab');
    assert.strictEqual(await page.locator('#view-all').getAttribute('aria-pressed'), 'true', 'Full view opens on All');
    assert.strictEqual(await page.locator('#sidebar').isHidden(), true, 'Narrow layout hides the sidebar behind the Filters drawer');
    assert.strictEqual(await page.locator('#filters-btn').isVisible(), true, 'Narrow layout shows the Filters button');
    assert.strictEqual(await page.locator('#view-tabs').isVisible(), true, 'Inbox/Reopened/All control stays visible above the feed');
    assert.strictEqual(await page.locator('.stats-banner').isVisible(), true, 'Stats row is visible');
    assert.strictEqual(await page.textContent('#stat-total'), '3', 'Stats row counts seeded summaries');
    console.log('✓ Tab surface hides panel-only controls; narrow layout uses the drawer\n');

    // --- TEST 2: Search clear button, keyboard hint & highlighting ---
    console.log('--- Test 2: Search Clear Button, Keyboard Hint & Highlighting ---');
    const kbdHint = page.locator('#search-kbd-hint');
    const clearBtn = page.locator('#search-clear-btn');
    const searchInput = page.locator('#search-input');
    assert.strictEqual(await clearBtn.isHidden(), true, 'Clear button should be hidden when search is empty');
    assert.strictEqual(await kbdHint.isVisible(), true, 'Keyboard hint / should be visible when search is empty');

    await searchInput.fill('Deep');
    await page.waitForTimeout(350);
    assert.strictEqual(await clearBtn.isVisible(), true, 'Clear button should be visible when input has text');
    assert.strictEqual(await kbdHint.isHidden(), true, 'Keyboard hint should be hidden when input has text');
    const highlight = page.locator('mark.search-highlight');
    assert.ok(await highlight.count() >= 1, 'Should highlight matching term "Deep"');
    assert.strictEqual((await highlight.first().textContent()).toLowerCase(), 'deep');
    assert.deepStrictEqual(await cardIds(), ['test-tab-1'], 'Search filters the feed');
    console.log('✓ Search highlighting verified');

    await clearBtn.click();
    await page.waitForTimeout(300);
    assert.strictEqual(await searchInput.inputValue(), '', 'Search input should be cleared');
    assert.strictEqual(await clearBtn.isHidden(), true, 'Clear button should be hidden after clearing');
    assert.strictEqual(await kbdHint.isVisible(), true, 'Keyboard hint should be visible after clearing');
    assert.strictEqual((await cardIds()).length, 3, 'Clearing search restores the full feed');
    console.log('✓ Clear button and keyboard hint behavior verified\n');

    // --- TEST 3: Progressive disclosure of takeaways (narrow layout) ---
    console.log('--- Test 3: Progressive Disclosure of Takeaways ---');
    const firstCard = page.locator('.tab-card[data-id="test-tab-1"]');
    const takeawaysBtn = firstCard.locator('.takeaways-toggle');
    const bulletsList = firstCard.locator('.card-bullets');
    assert.strictEqual(await takeawaysBtn.isVisible(), true, 'Takeaways toggle button should be visible');
    assert.strictEqual(await bulletsList.isHidden(), true, 'Bullets list should be collapsed by default');
    await takeawaysBtn.click();
    assert.strictEqual(await bulletsList.isVisible(), true, 'Bullets list should be expanded after click');
    assert.strictEqual(await takeawaysBtn.getAttribute('aria-expanded'), 'true', 'Toggle button should report aria-expanded="true"');
    await takeawaysBtn.click();
    assert.strictEqual(await bulletsList.isHidden(), true, 'Bullets list should collapse again');
    console.log('✓ Progressive disclosure of takeaways verified\n');

    // --- TEST 4: Density toggle (comfortable / compact) ---
    console.log('--- Test 4: Density Toggle (Comfortable / Compact) ---');
    const densityBtn = page.locator('#density-toggle-btn');
    const feedIsCompact = () => page.locator('#tabs-feed').evaluate(el => el.classList.contains('compact'));
    assert.strictEqual(await densityBtn.getAttribute('aria-pressed'), 'false', 'Density button should not be active initially');
    await densityBtn.click();
    assert.strictEqual(await densityBtn.evaluate(el => el.classList.contains('active')), true, 'Density button should have .active in compact mode');
    assert.strictEqual(await feedIsCompact(), true, 'Feed should switch to compact cards');
    assert.strictEqual(await firstCard.locator('.card-tldr').isHidden(), true, 'Compact cards hide the TL;DR');
    const storedDensity = await page.evaluate(async () => (await chrome.storage.local.get('sidepanel_density')).sidepanel_density);
    assert.strictEqual(storedDensity, 'compact', 'Compact density should be stored in chrome.storage.local');
    await page.reload();
    await page.waitForSelector('.tab-card');
    assert.strictEqual(await feedIsCompact(), true, 'Compact density persists across reloads');
    await densityBtn.click();
    assert.strictEqual(await feedIsCompact(), false, 'Cards should revert to comfortable');
    console.log('✓ Density toggle and storage persistence verified\n');

    // --- TEST 5: Keyboard navigation (j / k / Enter) ---
    console.log('--- Test 5: Keyboard Navigation (j / k / Enter) ---');
    await page.evaluate(() => document.activeElement?.blur());
    const isSelected = (id) => page.locator(`.tab-card[data-id="${id}"]`).evaluate(el => el.classList.contains('keyboard-selected'));
    await page.keyboard.press('j');
    assert.strictEqual(await isSelected('test-tab-1'), true, 'First card should have .keyboard-selected after pressing j');
    await page.keyboard.press('j');
    assert.strictEqual(await isSelected('test-tab-2'), true, 'Second card should have .keyboard-selected after pressing j again');
    await page.keyboard.press('k');
    assert.strictEqual(await isSelected('test-tab-1'), true, 'First card should have .keyboard-selected after pressing k');

    // Enter reopens the selected card (capture the RESTORE_TAB message instead of opening a tab)
    await page.evaluate(() => {
      window.__realSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (msg) => { window.__sent = msg; return { restoredInPlace: false }; };
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__sent);
    const sent = await page.evaluate(() => {
      chrome.runtime.sendMessage = window.__realSend;
      return window.__sent;
    });
    assert.strictEqual(sent.type, 'RESTORE_TAB', 'Enter on a selected card sends RESTORE_TAB');
    assert.strictEqual(sent.recordId, 'test-tab-1', 'Enter reopens the selected card');
    assert.match(await page.textContent('#toast-message'), /Tab reopened/, 'Reopen confirms with a toast');
    console.log('✓ j / k selection and Enter-to-reopen verified\n');

    // --- TEST 6: Filters drawer (narrow layout) ---
    console.log('--- Test 6: Filters Drawer (narrow layout) ---');
    await page.click('#filters-btn');
    await page.locator('#sidebar').waitFor({ state: 'visible' });
    assert.strictEqual(await page.getAttribute('#filters-btn', 'aria-expanded'), 'true', 'Filters button reports the open drawer');
    for (const selector of ['.nav-item[data-view="inbox"]', '.nav-item[data-time="today"]', '.nav-item[data-time="favorites"]', '#sidebar-tags [data-tag="ai"]', '#sidebar-domains [data-domain="example.com"]', '#export-dropdown-btn', '#settings-btn']) {
      assert.strictEqual(await page.locator(selector).isVisible(), true, `Drawer must contain ${selector}`);
    }
    assert.match(await page.textContent('#sidebar-tags [data-tag="web"] .badge'), /^2$/, 'Tag list shows counts');
    await page.keyboard.press('Escape');
    await page.locator('#sidebar').waitFor({ state: 'hidden' });
    console.log('✓ Drawer opens with views, time filters, favorites, tags, domains, export & settings; Escape closes it');

    await page.click('#filters-btn');
    await page.locator('#sidebar').waitFor({ state: 'visible' });
    await page.click('#sidebar-tags [data-tag="ai"]');
    await page.locator('#sidebar').waitFor({ state: 'hidden' });
    assert.deepStrictEqual(await cardIds(), ['test-tab-1'], 'Tag filter narrows the feed');
    assert.match(await page.textContent('#filter-label'), /#ai/, 'Filter banner names the active tag');
    assert.strictEqual(await page.locator('#filters-btn').evaluate(el => el.classList.contains('has-filter')), true, 'Filters button flags an active filter');
    await page.click('#clear-filter-btn');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 3);
    assert.strictEqual(await page.locator('#filter-banner').isHidden(), true, 'Clearing hides the filter banner');
    console.log('✓ Picking a tag closes the drawer, filters the feed and shows a clearable banner\n');

    // --- TEST 7: Reader view fills the panel ---
    console.log('--- Test 7: Reader View (narrow) ---');
    await page.click('.tab-card[data-id="test-tab-1"] .reader-btn');
    await page.waitForFunction(() => document.getElementById('modal-text-content').textContent.includes('full article text'));
    assert.strictEqual(await page.textContent('#modal-title'), 'Deep Learning and Neural Networks');
    assert.ok(await page.locator('#modal-text-content h2').count() === 1, 'Article text is formatted (headings)');
    // Layout size (offsetWidth/Height ignore the scale() entry animation)
    const dialogBox = await page.locator('#reader-dialog').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
    assert.ok(dialogBox.width >= NARROW.width - 1 && dialogBox.height >= NARROW.height - 1, `Reader should fill the panel, got ${dialogBox.width}x${dialogBox.height}`);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => document.getElementById('reader-dialog').open), false, 'Escape closes the reader');
    console.log('✓ Reader loads full text via getTabById, fills the panel, closes on Escape\n');

    // --- TEST 8: Durable delete with 5-second Undo toast ---
    console.log('--- Test 8: Durable Delete & Interactive Undo Toast ---');
    await firstCard.locator('.delete-btn').click();
    assert.strictEqual(await firstCard.evaluate(el => el.classList.contains('removing')), true, 'Card should receive .removing class on delete');
    const toastUndoBtn = page.locator('#toast-undo-btn');
    await toastUndoBtn.waitFor({ state: 'visible', timeout: 2000 }); // shown once softDeleteTab resolves
    assert.strictEqual(await page.locator('#toast').isVisible(), true, 'Toast should be visible');
    assert.strictEqual(await toastUndoBtn.isVisible(), true, 'Undo button in toast should be visible');
    const deletedNow = await page.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      return !(await getArchivedTabs({})).some(t => t.id === 'test-tab-1');
    });
    assert.strictEqual(deletedNow, true, 'Delete is durable immediately (softDeleteTab)');
    await toastUndoBtn.click();
    await page.waitForSelector('.tab-card[data-id="test-tab-1"]:not(.removing)');
    assert.strictEqual(await page.locator('.tab-card[data-id="test-tab-1"]').isVisible(), true, 'Card should be restored in feed after clicking Undo');
    console.log('✓ Delete and Undo restoration verified');

    console.log('Testing deletion permanence after 5.2 seconds...');
    await page.locator('.tab-card[data-id="test-tab-2"] .delete-btn').click();
    await page.waitForTimeout(5300);
    const tab2ExistsInDb = await page.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      return (await getArchivedTabs({})).some(t => t.id === 'test-tab-2');
    });
    assert.strictEqual(tab2ExistsInDb, false, 'Card should stay deleted from DB after the 5s undo window');
    assert.strictEqual(await page.locator('.tab-card[data-id="test-tab-2"]').count(), 0, 'Deleted card is gone from the feed');
    console.log('✓ Permanent deletion verified after 5s timeout\n');

    // --- TEST 9: Wide layout (full view) ---
    console.log('--- Test 9: Wide Layout (1280px): Sidebar, Grid, Filters, Export ---');
    await page.setViewportSize(WIDE);
    assert.strictEqual(await page.locator('#sidebar').isVisible(), true, 'Wide layout shows the persistent sidebar');
    assert.strictEqual(await page.locator('#filters-btn').isHidden(), true, 'Wide layout hides the Filters button');
    const [boxA, boxB] = await Promise.all([
      page.locator('.tab-card[data-id="test-tab-1"]').boundingBox(),
      page.locator('.tab-card[data-id="test-tab-3"]').boundingBox()
    ]);
    assert.ok(Math.abs(boxA.y - boxB.y) < 2 && boxB.x > boxA.x, 'Wide layout lays cards out in a multi-column grid');
    assert.strictEqual(await page.locator('.tab-card[data-id="test-tab-1"] .card-bullets').isVisible(), true, 'Wide cards show takeaways');
    assert.strictEqual(await page.textContent('#results-count'), '2 summaries', 'Results count reflects the feed');

    const savedBadge = page.locator('.tab-card[data-id="test-tab-3"] .badge-status');
    assert.strictEqual((await savedBadge.textContent()).trim(), '📑 Saved', 'captured status renders the 📑 Saved badge');
    assert.strictEqual(await savedBadge.getAttribute('title'), 'Saved manually; tab left open', 'Saved badge tooltip is the closureReason');
    console.log('✓ Sidebar + multi-column grid; 📑 Saved badge with closureReason tooltip');

    // Favorites
    await page.click('.tab-card[data-id="test-tab-3"] .star-btn');
    await page.waitForFunction(() => document.getElementById('count-favorites').textContent === '1');
    await page.click('.nav-item[data-time="favorites"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 1);
    assert.deepStrictEqual(await cardIds(), ['test-tab-3'], 'Favorites lists starred notes');
    assert.match(await page.textContent('#filter-label'), /Favorites/, 'Banner names the Favorites filter');
    await page.click('.tab-card[data-id="test-tab-3"] .star-btn');
    await page.waitForFunction(() => !document.querySelector('.tab-card[data-id="test-tab-3"]'));
    console.log('✓ Star + Favorites filter (unstarring drops the card from Favorites)');

    // Domain filter
    await page.click('.nav-item[data-view=""]');
    await page.click('#sidebar-domains [data-domain="example.com"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 1);
    assert.deepStrictEqual(await cardIds(), ['test-tab-1'], 'Domain filter narrows the feed');
    assert.match(await page.textContent('#filter-label'), /domain: example\.com/);
    await page.click('#clear-filter-btn');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 2);

    // Tag pill on a card
    await page.click('.tab-card[data-id="test-tab-1"] .card-tag[data-tag="research"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 1);
    assert.match(await page.textContent('#filter-label'), /#research/, 'Tag pill click filters by that tag');
    assert.strictEqual(await page.locator('#sidebar-tags [data-tag="research"]').evaluate(el => el.classList.contains('active')), true, 'Sidebar highlights the active tag');
    await page.click('#clear-filter-btn');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 2);
    console.log('✓ Domain filter, card tag-pill filter and banner clear verified');

    // Export dropdown
    const exportMenu = page.locator('#export-dropdown-menu');
    await page.click('#export-dropdown-btn');
    assert.strictEqual(await exportMenu.isVisible(), true, 'Export menu opens');
    assert.strictEqual(await exportMenu.locator('.export-option-btn').count(), 3, 'Export offers Markdown, Obsidian and JSON');
    await page.keyboard.press('Escape');
    assert.strictEqual(await exportMenu.isHidden(), true, 'Escape closes the export menu');
    await page.click('#export-dropdown-btn');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('.export-option-btn[data-format="obsidian"]')
    ]);
    assert.match(download.suggestedFilename(), /^tabsum-obsidian-vault-\d+\.zip$/, 'Obsidian export downloads a .zip vault');
    console.log(`✓ Export dropdown verified (downloaded ${download.suggestedFilename()})\n`);

    // --- TEST 10: Live refresh on TABS_CLOSED ---
    console.log('--- Test 10: "Closed today" refreshes live on TABS_CLOSED ---');
    assert.strictEqual(await page.locator('#closed-today').isHidden(), true, 'Closed today hidden when nothing was closed');
    await page.evaluate(async () => {
      const { saveArchivedTab, markTabClosed } = await import('/src/storage/db.js');
      await saveArchivedTab({
        id: 'closed-note', url: 'https://closed.example/article', title: 'Closed In Background', domain: 'closed.example',
        status: 'archived', summary: { tldr: 'Closed by the sweep', bullets: [], tags: [] }
      });
      await markTabClosed('closed-note');
    });
    await background.evaluate(() => chrome.runtime.sendMessage({ type: 'TABS_CLOSED' }).catch(() => {}));
    await page.waitForSelector('#closed-today:not([hidden])', { timeout: 5000 });
    assert.strictEqual(await page.textContent('#closed-today-count'), '1', 'Closed today counts the newly closed tab');
    await page.waitForSelector('.tab-card[data-id="closed-note"]', { timeout: 5000 });
    console.log('✓ TABS_CLOSED refreshes "Closed today" and the feed without a reload\n');

    await page.evaluate(async () => {
      const { saveSettings, DEFAULT_SETTINGS } = await import('/src/storage/db.js');
      await saveSettings(DEFAULT_SETTINGS);
    });

    // --- TEST 11: Side panel surface ---
    console.log('--- Test 11: Side Panel Surface (panel-only controls, Open full view) ---');
    const panel = await context.newPage();
    // In the real side panel chrome.tabs.getCurrent() resolves undefined; Playwright pages are tabs.
    await panel.addInitScript(() => { chrome.tabs.getCurrent = () => Promise.resolve(undefined); });
    await panel.setViewportSize(NARROW);
    await panel.goto(APP_URL);
    await panel.waitForSelector('body[data-surface="panel"]', { timeout: 5000 });
    assert.strictEqual(await panel.locator('#archive-current-btn').isVisible(), true, '"Archive Current Tab" is shown in the side panel');
    assert.strictEqual(await panel.locator('#open-full-btn').isVisible(), true, '"Open full view" is shown in the side panel');
    assert.strictEqual(await panel.locator('#view-inbox').getAttribute('aria-pressed'), 'true', 'Side panel opens on the Inbox');
    console.log('✓ Panel surface shows Archive Current Tab + Open full view and opens on Inbox');

    const [fullPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 8000 }),
      panel.click('#open-full-btn')
    ]);
    await fullPage.waitForLoadState('domcontentloaded');
    assert.ok(fullPage.url().endsWith('/src/app/index.html'), 'Open full view opens src/app/index.html in a tab');
    await fullPage.waitForSelector('body[data-surface="tab"]');
    assert.strictEqual(await fullPage.locator('#archive-current-btn').isHidden(), true, 'The full view tab hides Archive Current Tab');
    await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(panel.isClosed(), true, 'Side panel should close itself after opening the full view');
    console.log('✓ Open full view opens a tab and closes the side panel\n');
    await fullPage.close();

    // --- TEST 12: Inbox / Reopened views, fade chip, star, expiring-soon sort ---
    console.log('--- Test 12: Inbox Views, Fading & Expiring-Soon Sort ---');
    const hub = await context.newPage();
    await hub.goto(APP_URL);
    await hub.evaluate(async () => {
      const { saveArchivedTab, updateArchivedTabStatus } = await import('/src/storage/db.js');
      const DAY = 24 * 60 * 60 * 1000;
      const note = (id, capturedAt) => saveArchivedTab({
        id, url: `https://notes.example/${id}`, title: id, capturedAt, status: 'archived',
        summary: { tldr: `${id} summary`, bullets: [], tags: [] }
      });
      await note('inbox-note', Date.now() - DAY);
      await note('fading-note', Date.now() - 29 * DAY); // 30-day window -> fades in ~1 day
      await note('reopened-note', Date.now() - 2 * DAY);
      await updateArchivedTabStatus('reopened-note', 'restored');
    });
    await hub.reload();
    await hub.waitForSelector('.tab-card[data-id="inbox-note"]', { timeout: 5000 });
    await hub.click('#view-inbox');
    await hub.waitForFunction(() => !document.querySelector('.tab-card[data-id="reopened-note"]'));

    let ids = await cardIds(hub);
    assert.ok(ids.includes('fading-note') && !ids.includes('reopened-note'), `Inbox must hide reopened notes, got ${ids}`);
    const chip = await hub.textContent('.tab-card[data-id="fading-note"] .fade-chip');
    assert.match(chip, /Fades (in 1d|today)/, 'Note near its fade date shows a chip');
    console.log(`✓ Inbox hides reopened notes; fading note shows "${chip}"`);

    await hub.click('#view-reopened');
    await hub.waitForFunction(() => !document.querySelector('.tab-card[data-id="inbox-note"]'));
    const reopenedBadge = await hub.textContent('.tab-card[data-id="reopened-note"] .badge-status');
    assert.deepStrictEqual(await cardIds(hub), ['reopened-note'], 'Reopened view lists only reopened notes');
    assert.strictEqual(reopenedBadge.trim(), '↩ Reopened', 'Reopened notes carry the ↩ Reopened badge');
    console.log('✓ Reopened view lists only reopened notes');

    await hub.click('#view-all');
    await hub.waitForSelector('.tab-card[data-id="fading-note"]');
    await hub.click('.tab-card[data-id="fading-note"] .star-btn');
    await hub.waitForFunction(() => !document.querySelector('.tab-card[data-id="fading-note"] .fade-chip'));
    console.log('✓ Starring removes the fade chip');

    await hub.selectOption('#sort-select', 'expiring-soon');
    await hub.waitForFunction(() => document.querySelector('#tabs-feed .tab-card')?.dataset.id === 'reopened-note');
    ids = await cardIds(hub);
    assert.strictEqual(ids[0], 'reopened-note', 'Soonest-fading note first (reopened: 7-day window)');
    assert.strictEqual(ids[ids.length - 1], 'fading-note', 'Starred note never fades, so it sorts last');
    console.log('✓ Expiring-soon sort orders by fade date, starred last\n');
    await hub.close();

    console.log('========================================================');
    console.log('🎉 ALL KNOWLEDGE HUB UX TESTS PASSED (NARROW + WIDE LAYOUTS, PANEL + TAB SURFACES)! 🎉');
    console.log('========================================================\n');
  } finally {
    if (context) await context.close();
  }
}

runAppUXTests().catch(err => {
  console.error('❌ Knowledge Hub UX Test Failure:', err);
  process.exit(1);
});
