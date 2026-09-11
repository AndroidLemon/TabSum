/**
 * TabSum - End-to-End Wikipedia Inactivity & Knowledge Archival Test
 * Opens multiple arbitrary Wikipedia pages, verifies real DOM readability extraction,
 * auto-archives stale background tabs, protects active tabs, checks IndexedDB persistence,
 * and tests Wiki search and 1-click tab restoration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const EXTENSION_PATH = path.resolve('.');
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_wiki');

const WIKI_PAGES = [
  {
    name: 'Claude Shannon',
    url: 'https://en.wikipedia.org/wiki/Claude_Shannon',
    searchTerm: 'Shannon'
  },
  {
    name: 'James Webb Space Telescope',
    url: 'https://en.wikipedia.org/wiki/James_Webb_Space_Telescope',
    searchTerm: 'Telescope'
  },
  {
    name: 'Voyager 1',
    url: 'https://en.wikipedia.org/wiki/Voyager_1',
    searchTerm: 'Voyager'
  }
];

async function runWikipediaMultiTabTest() {
  console.log('🧪 Starting TabSum Multi-Tab Wikipedia End-to-End Test...\n');

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const startTime = Date.now();
  let context;

  try {
    console.log('🚀 Launching Chromium with TabSum MV3 unpacked extension...');
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    // 1. Locate Extension Service Worker
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extensionId = background.url().split('/')[2];
    console.log(`✓ TabSum Extension ID: ${extensionId}`);

    // 2. Open Extension Sidepanel to interact with storage & DB directly via ES modules
    const sidepanel = await context.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await sidepanel.waitForLoadState('domcontentloaded');

    // Configure aggressive settings for test: 1 minute timeout, 'close' mode
    await sidepanel.evaluate(async () => {
      const { saveSettings } = await import('/src/storage/db.js');
      await saveSettings({
        timeoutMinutes: 1,
        archiveMode: 'close',
        notificationsEnabled: false,
        excludedDomains: []
      });
    });
    console.log('✓ Configured settings: timeoutMinutes=1, archiveMode="close"');

    // 3. Open Multiple Arbitrary Wikipedia Pages
    console.log('\n📚 Navigating to 3 live Wikipedia articles...');

    const tab1 = await context.newPage();
    console.log(`  -> Tab 1: ${WIKI_PAGES[0].name} (${WIKI_PAGES[0].url})`);
    await tab1.goto(WIKI_PAGES[0].url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const tab2 = await context.newPage();
    console.log(`  -> Tab 2: ${WIKI_PAGES[1].name} (${WIKI_PAGES[1].url})`);
    await tab2.goto(WIKI_PAGES[1].url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const tab3 = await context.newPage();
    console.log(`  -> Tab 3 (Active Foreground): ${WIKI_PAGES[2].name} (${WIKI_PAGES[2].url})`);
    await tab3.goto(WIKI_PAGES[2].url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Explicitly set Tab 3 as the active tab in Chrome
    await background.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const activeTarget = tabs.find(t => t.url && t.url.includes('Voyager_1'));
      if (activeTarget) {
        await chrome.tabs.update(activeTarget.id, { active: true });
      }
    }, WIKI_PAGES[2].url);

    await new Promise(r => setTimeout(r, 1000));

    // 4. Test In-Tab Extraction Performance & Content Fidelity on both background Wikipedia pages
    console.log('\n🔬 Testing In-Tab Extractor on live Wikipedia DOM...');
    const testExtraction = async (pageKey) => {
      const start = Date.now();
      const res = await background.evaluate(async (key) => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url && t.url.includes(key));
        if (!target) return { error: 'Tab not found' };

        const results = await chrome.scripting.executeScript({
          target: { tabId: target.id },
          files: ['src/content/in-tab-extractor.js']
        });
        return { success: true, result: results?.[0]?.result, tabId: target.id };
      }, pageKey);

      const latency = Date.now() - start;
      const data = res.result;
      console.log(`  ✓ Extracted "${data.title}" in ${latency}ms`);
      console.log(`    Words: ${data.wordCount.toLocaleString()} | Reading Time: ${data.readingTimeMinutes} min`);
      console.log(`    Zero-Loss isDirty: ${data.isDirty} | Snippet: "${data.cleanText.substring(0, 100).replace(/\s+/g, ' ')}..."`);
      return { ...data, latency };
    };

    const extShannon = await testExtraction('Claude_Shannon');
    const extWebb = await testExtraction('James_Webb_Space_Telescope');

    if (extShannon.wordCount < 1000 || extWebb.wordCount < 1000) {
      throw new Error('Wikipedia extraction returned insufficient content!');
    }

    // 5. Simulate Inactivity for BOTH Background Wikipedia Tabs
    console.log('\n⏳ Simulating inactivity for both background Wikipedia tabs...');
    const staleTabIds = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const shannon = tabs.find(t => t.url && t.url.includes('Claude_Shannon'));
      const webb = tabs.find(t => t.url && t.url.includes('James_Webb_Space_Telescope'));

      const data = await chrome.storage.session.get('tabTimestamps');
      const timestamps = data.tabTimestamps || {};
      
      // Backdate both tabs by 5 minutes
      if (shannon) timestamps[shannon.id] = Date.now() - (5 * 60 * 1000);
      if (webb) timestamps[webb.id] = Date.now() - (5 * 60 * 1000);

      await chrome.storage.session.set({ tabTimestamps: timestamps });
      return { shannonId: shannon?.id, webbId: webb?.id };
    });

    console.log(`  Stale Tab IDs: Shannon=${staleTabIds.shannonId}, Webb=${staleTabIds.webbId}`);

    // Verify initial open tabs count
    const initialTabs = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, url: t.url, active: t.active }));
    });
    console.log(`  Open tabs before sweep: ${initialTabs.length}`);

    // 6. Trigger Service Worker Inactivity Sweep
    console.log('\n🧹 Triggering background Service Worker inactivity sweep...');
    await sidepanel.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
      });
    });

    // Wait for BOTH tabs to be closed by the service worker
    console.log('  Waiting for background worker to summarize and close stale tabs...');
    let shannonClosed = false;
    let webbClosed = false;

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 600));
      const tabs = await background.evaluate(async () => {
        const tList = await chrome.tabs.query({});
        return tList.map(t => t.url);
      });

      if (!tabs.some(u => u && u.includes('Claude_Shannon'))) shannonClosed = true;
      if (!tabs.some(u => u && u.includes('James_Webb_Space_Telescope'))) webbClosed = true;

      if (shannonClosed && webbClosed) {
        console.log(`  🎯 SUCCESS! Both stale Wikipedia tabs were automatically closed after ${(attempt + 1) * 600}ms!`);
        break;
      }
    }

    if (!shannonClosed || !webbClosed) {
      throw new Error(`Archival closure failed! ShannonClosed=${shannonClosed}, WebbClosed=${webbClosed}`);
    }

    // 7. Verify Safety Guards: Active Tab Must Remain Open
    const remainingTabs = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, url: t.url, active: t.active }));
    });
    const voyagerActive = remainingTabs.find(t => t.url && t.url.includes('Voyager_1'));
    if (!voyagerActive) {
      throw new Error('Safety guard violated: Active foreground tab Voyager_1 was closed!');
    }
    console.log(`  ✓ Active foreground tab (Voyager 1) was safely preserved!`);

    // 8. Verify IndexedDB Persistence
    console.log('\n💾 Verifying IndexedDB Knowledge Wiki records...');
    const records = await sidepanel.evaluate(async () => {
      const { getArchivedTabs } = await import('/src/storage/db.js');
      return await getArchivedTabs();
    });

    console.log(`  Total records in IndexedDB: ${records.length}`);
    const shannonRecord = records.find(r => r.url.includes('Claude_Shannon'));
    const webbRecord = records.find(r => r.url.includes('James_Webb_Space_Telescope'));

    if (!shannonRecord || !webbRecord) {
      throw new Error('IndexedDB is missing one or more archived tab records!');
    }

    console.log(`  ✓ Record 1: "${shannonRecord.title}"`);
    console.log(`    TL;DR: "${shannonRecord.summary.tldr.substring(0, 100)}..."`);
    console.log(`    Takeaways: ${shannonRecord.summary.bullets.length} bullets`);
    console.log(`    Tags: [${shannonRecord.summary.tags.join(', ')}]`);

    console.log(`  ✓ Record 2: "${webbRecord.title}"`);
    console.log(`    TL;DR: "${webbRecord.summary.tldr.substring(0, 100)}..."`);
    console.log(`    Takeaways: ${webbRecord.summary.bullets.length} bullets`);
    console.log(`    Tags: [${webbRecord.summary.tags.join(', ')}]`);

    // 9. Verify Wiki Dashboard UI
    console.log('\n📖 Opening TabSum Knowledge Wiki Dashboard UI...');
    const wikiTab = await context.newPage();
    await wikiTab.goto(`chrome-extension://${extensionId}/src/wiki/index.html`);
    await wikiTab.waitForLoadState('domcontentloaded');

    await wikiTab.waitForSelector('.wiki-card', { timeout: 8000 });
    const initialCardCount = await wikiTab.locator('.wiki-card').count();
    console.log(`  ✓ Rendered ${initialCardCount} knowledge cards in Wiki dashboard`);

    if (initialCardCount < 2) {
      throw new Error(`Expected at least 2 cards in Wiki, got ${initialCardCount}`);
    }

    // 10. Test Full-Text Search in Wiki UI
    console.log('\n🔍 Testing interactive full-text search in Wiki UI...');
    await wikiTab.fill('#wiki-search', 'Shannon');
    await wikiTab.waitForTimeout(400);
    const shannonFilterCount = await wikiTab.locator('.wiki-card').count();
    console.log(`  Filter "Shannon": ${shannonFilterCount} card(s) displayed`);
    if (shannonFilterCount !== 1) throw new Error('Search for "Shannon" should yield exactly 1 card');

    await wikiTab.fill('#wiki-search', 'Telescope');
    await wikiTab.waitForTimeout(400);
    const webbFilterCount = await wikiTab.locator('.wiki-card').count();
    console.log(`  Filter "Telescope": ${webbFilterCount} card(s) displayed`);
    if (webbFilterCount !== 1) throw new Error('Search for "Telescope" should yield exactly 1 card');

    // Clear search
    await wikiTab.fill('#wiki-search', '');
    await wikiTab.waitForTimeout(400);
    const clearedCount = await wikiTab.locator('.wiki-card').count();
    console.log(`  Filter cleared: ${clearedCount} cards displayed`);

    // 11. Test 1-Click Tab Restoration
    console.log('\n🔄 Testing 1-Click Tab Restoration from Wiki UI...');
    const pagesBeforeRestore = context.pages().length;
    
    // Click reopen on the first card
    const firstRestoreBtn = wikiTab.locator('.restore-action-btn').first();
    await firstRestoreBtn.click();
    await wikiTab.waitForTimeout(1500);

    const pagesAfterRestore = context.pages().length;
    console.log(`  Open browser pages: before=${pagesBeforeRestore}, after=${pagesAfterRestore}`);

    const openUrls = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => t.url);
    });

    const restoredTabFound = openUrls.some(u => u && (u.includes('Claude_Shannon') || u.includes('James_Webb_Space_Telescope')));
    console.log(`  Archived Wikipedia page successfully reopened in browser: ${restoredTabFound}`);

    if (!restoredTabFound) {
      throw new Error('1-Click Restore did not reopen the archived Wikipedia page!');
    }

    console.log('\n======================================================');
    console.log('🎉 ALL MULTI-TAB WIKIPEDIA TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================');
    console.log(`Total test execution time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  } catch (err) {
    console.error('\n❌ Wikipedia Test Suite Failed:', err);
    throw err;
  } finally {
    if (context) await context.close();
  }
}

runWikipediaMultiTabTest().catch(() => process.exit(1));
