/**
 * TabSum - Hybrid Adaptive Archival Mode Verification Suite
 * Tests DOM classification heuristics, tiered actions (close vs suspend vs untouchable),
 * background inactivity sweep behavior in hybrid mode, and UI badge rendering.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { chromium } from '@playwright/test';

const PORT = 8893;
import { buildTestExtension } from './helpers/test-extension.js';

const EXTENSION_PATH = buildTestExtension();
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_hybrid');

const LOREM_PARAGRAPHS = `
Web performance optimization is an engineering discipline that focuses on improving the speed and efficiency
with which web pages are downloaded, parsed, rendered, and interacted with by users.
Fast websites lead to higher user engagement, improved retention rates, and better conversion metrics across e-commerce platforms.
Modern web browsers use sophisticated rendering pipelines, including layout calculation, compositing, and GPU acceleration.
Developers must carefully monitor Core Web Vitals such as Largest Contentful Paint, Interaction to Next Paint, and Cumulative Layout Shift.
Resource prioritization, code splitting, caching strategies, and asset compression play pivotal roles in maintaining high performance.
In addition, effective memory management prevents sluggish tab switching and browser crashes on memory-constrained client devices.
This comprehensive overview outlines the foundational principles of modern client-side performance engineering.
`;

function createMockServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (req.url === '/pure-article') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Modern Performance Engineering</title></head>
        <body>
          <main>
            <h1>Modern Performance Engineering</h1>
            <p>${LOREM_PARAGRAPHS}</p>
            <p>${LOREM_PARAGRAPHS}</p>
          </main>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/article-with-search') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Knowledge Base with Site Search</title></head>
        <body>
          <header>
            <form role="search">
              <input type="search" role="searchbox" name="q" placeholder="Search documentation...">
            </form>
          </header>
          <article>
            <h1>Knowledge Base Article</h1>
            <p>${LOREM_PARAGRAPHS}</p>
            <p>${LOREM_PARAGRAPHS}</p>
          </article>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/untouched-form') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Registration Portal</title></head>
        <body>
          <main>
            <h1>User Registration</h1>
            <p>${LOREM_PARAGRAPHS}</p>
            <form id="signup-form">
              <label for="email">Email address:</label>
              <input type="email" id="email" name="email" value="" placeholder="user@example.com">
              <label for="country">Country:</label>
              <select id="country" name="country">
                <option value="us">United States</option>
                <option value="uk">United Kingdom</option>
              </select>
            </form>
          </main>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/spa-checkout') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Checkout Page</title></head>
        <body>
          <main>
            <h1>Express Checkout</h1>
            <p>${LOREM_PARAGRAPHS}</p>
          </main>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/dialog-app') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Interactive Workspace</title></head>
        <body>
          <main>
            <h1>Application Dashboard</h1>
            <div role="dialog" aria-label="Quick Settings">
              <p>Active modal workspace</p>
            </div>
            <p>${LOREM_PARAGRAPHS}</p>
          </main>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/dirty-form') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Feedback Form</title></head>
        <body>
          <main>
            <h1>Leave Feedback</h1>
            <form>
              <textarea id="feedback-text">Default text</textarea>
            </form>
            <script>
              // Simulate user typing
              document.getElementById('feedback-text').value = 'User typed feedback that must not be lost!';
            </script>
          </main>
        </body>
        </html>
      `);
      return;
    }

    res.end('<h1>404 Not Found</h1>');
  });

  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

async function runHybridTests() {
  console.log('\n🧪 Starting TabSum Hybrid Adaptive Archival Mode Test Suite...\n');

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const server = await createMockServer();
  console.log(`✓ Mock server listening on http://localhost:${PORT}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  let background;
  for (const page of context.backgroundPages()) {
    background = page;
    break;
  }
  if (!background) {
    background = await context.waitForEvent('backgroundpage', { timeout: 7000 }).catch(() => null);
  }
  if (!background) {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 7000 });
    background = sw;
  }

  const extensionId = background.url().split('/')[2];
  console.log(`✓ Extension loaded with ID: ${extensionId}`);

  try {
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await helperPage.waitForLoadState('networkidle');

    // --- Test 1: In-Tab Safety Classifier Unit Verification ---
    console.log('\n--- Test 1: DOM Safety Classifier (in-tab-extractor.js) ---');
    const extractorCode = fs.readFileSync(path.resolve('./src/content/in-tab-extractor.js'), 'utf8');

    // 1a: Pure reading article -> safe_to_close
    const purePage = await context.newPage();
    await purePage.goto(`http://localhost:${PORT}/pure-article`);
    const pureResult = await purePage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(pureResult.isDirty, false, 'Pure article must not be dirty');
    assert.strictEqual(pureResult.closureTier, 'safe_to_close', 'Pure article must be classified safe_to_close');
    console.log(`✓ Pure reading article classified as: ${pureResult.closureTier} (${pureResult.closureReason})`);

    // 1a': the same article with a date the user picked -> dirty; a JS-ticked checkbox -> still clean
    const pickedResult = await purePage.evaluate((code) => {
      const date = document.createElement('input');
      date.type = 'date';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      document.body.append(date, cb);
      cb.checked = true;
      const withCheckbox = eval(code);
      date.value = '2026-09-11';
      const withDate = eval(code);
      date.remove();
      cb.remove();
      return { withCheckbox, withDate };
    }, extractorCode);
    assert.strictEqual(pickedResult.withCheckbox.isDirty, false, 'Script-ticked checkboxes (menus) must not block closure');
    assert.strictEqual(pickedResult.withDate.isDirty, true, 'A picked date must mark the page dirty');
    console.log(`✓ Picked date blocked (${pickedResult.withDate.reason}); menu checkbox ignored`);

    // 1b: Article with site search -> safe_to_close (search inputs must NOT block closure)
    const searchPage = await context.newPage();
    await searchPage.goto(`http://localhost:${PORT}/article-with-search`);
    const searchResult = await searchPage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(searchResult.closureTier, 'safe_to_close', 'Site search must not block closure');
    console.log(`✓ Article with site search correctly permitted: ${searchResult.closureTier}`);

    // 1c: Page with untouched form -> suspend_only
    const formPage = await context.newPage();
    await formPage.goto(`http://localhost:${PORT}/untouched-form`);
    const formResult = await formPage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(formResult.isDirty, false, 'Untouched form must not be marked dirty');
    assert.strictEqual(formResult.closureTier, 'suspend_only', 'Untouched form must be classified suspend_only');
    console.log(`✓ Untouched form page classified as: ${formResult.closureTier} (${formResult.closureReason})`);

    // 1d: Stateful route (/spa-checkout) -> suspend_only
    const spaPage = await context.newPage();
    await spaPage.goto(`http://localhost:${PORT}/spa-checkout`);
    const spaResult = await spaPage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(spaResult.closureTier, 'suspend_only', 'Checkout route must be classified suspend_only');
    console.log(`✓ Stateful route (/spa-checkout) classified as: ${spaResult.closureTier} (${spaResult.closureReason})`);

    // 1e: Interactive dialog container -> suspend_only
    const dialogPage = await context.newPage();
    await dialogPage.goto(`http://localhost:${PORT}/dialog-app`);
    const dialogResult = await dialogPage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(dialogResult.closureTier, 'suspend_only', 'Dialog app must be classified suspend_only');
    console.log(`✓ Dialog app classified as: ${dialogResult.closureTier} (${dialogResult.closureReason})`);

    // 1f: Dirty form with typed text -> isDirty: true (untouchable gate)
    const dirtyPage = await context.newPage();
    await dirtyPage.goto(`http://localhost:${PORT}/dirty-form`);
    const dirtyResult = await dirtyPage.evaluate((code) => eval(code), extractorCode);
    assert.strictEqual(dirtyResult.isDirty, true, 'User-typed form must be marked dirty');
    console.log(`✓ Dirty form with typed text blocked: isDirty = ${dirtyResult.isDirty} (${dirtyResult.reason})`);

    // Close testing pages from Test 1
    await purePage.close();
    await searchPage.close();
    await formPage.close();
    await spaPage.close();
    await dialogPage.close();
    await dirtyPage.close();

    // --- Test 2: Background Inactivity Sweep in Hybrid Mode ---
    console.log('\n--- Test 2: Background Sweep Execution in Hybrid Mode ---');

    // Ensure settings are set to archiveMode: 'hybrid' and timeout: 1 min
    await background.evaluate(() => {
      // Mock chrome.tabs.discard in test environment to avoid SwiftShader compositor segfault
      chrome.tabs.discard = async (tabId) => {
        return { id: tabId, discarded: true };
      };
    });

    await helperPage.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('src/storage/db.js'));
      await saveSettings({
        timeoutMinutes: 1,
        archiveMode: 'hybrid',
        closeRequiresAiSummary: false // no AI tier in CI; heuristic summaries must still close
      });
    });

    // 2a: Open pure reading article in background
    const bgPureArticle = await context.newPage();
    await bgPureArticle.goto(`http://localhost:${PORT}/pure-article`);
    await bgPureArticle.waitForLoadState('networkidle');

    // 2b: Open untouched form page in background
    const bgUntouchedForm = await context.newPage();
    await bgUntouchedForm.goto(`http://localhost:${PORT}/untouched-form`);
    await bgUntouchedForm.waitForLoadState('networkidle');

    // Focus helperPage so both test tabs are non-active background tabs
    // Ensure helperPage tab is active so pure and form tabs are inactive background tabs
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const helper = tabs.find(t => t.url.includes('src/options/index.html'));
      if (helper) {
        await chrome.tabs.update(helper.id, { active: true });
      }
      const pure = tabs.find(t => t.url.includes('/pure-article'));
      const form = tabs.find(t => t.url.includes('/untouched-form'));
      const staleTime = Date.now() - 120000; // 2 minutes ago
      const data = await chrome.storage.session.get('tabTimestamps');
      const timestamps = data.tabTimestamps || {};
      if (pure) timestamps[pure.id] = staleTime;
      if (form) timestamps[form.id] = staleTime;
      await chrome.storage.session.set({ tabTimestamps: timestamps });
    });

    // Wait 500ms for active tab state to settle
    await new Promise(r => setTimeout(r, 500));

    // Trigger Inactivity Sweep from helperPage (not background)
    console.log('Triggering background inactivity sweep in hybrid mode...');
    await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
      });
    });

    // Wait for sweep processing to settle
    await new Promise(r => setTimeout(r, 1200));

    // Verify Tab State after sweep:
    // Pure article should be REMOVED (closed)
    // Form page should REMAIN OPEN (discarded/suspended)
    const postSweepTabs = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const pureExists = tabs.some(t => t.url.includes('/pure-article'));
      const formTab = tabs.find(t => t.url.includes('/untouched-form'));
      return {
        pureExists,
        formTabExists: Boolean(formTab),
        formTabTitle: formTab?.title,
        formTabDiscarded: Boolean(formTab?.discarded)
      };
    });

    assert.strictEqual(postSweepTabs.pureExists, false, 'Pure article tab must be closed in hybrid mode');
    console.log('✓ Pure article was automatically closed into Wiki');

    assert.strictEqual(postSweepTabs.formTabExists, true, 'Form page tab must NOT be closed');
    assert.ok(postSweepTabs.formTabTitle.startsWith('💤 '), `Form tab must have sleeping indicator 💤 prefix, got: "${postSweepTabs.formTabTitle}"`);
    console.log(`✓ Untouched form was soft-suspended in place: title = "${postSweepTabs.formTabTitle}"`);

    // Verify IndexedDB records and closure tiers
    const dbRecords = await helperPage.evaluate(async () => {
      const { getArchivedTabs } = await import(chrome.runtime.getURL('src/storage/db.js'));
      return await getArchivedTabs({ limit: 10 });
    });

    const pureRecord = dbRecords.find(r => r.url.includes('/pure-article'));
    const formRecord = dbRecords.find(r => r.url.includes('/untouched-form'));

    assert.ok(pureRecord, 'Pure article record must exist in IndexedDB');
    assert.strictEqual(pureRecord.status, 'archived', 'Pure article record status must be archived');
    assert.strictEqual(pureRecord.closureTier, 'safe_to_close', 'Pure article record closureTier must be safe_to_close');
    console.log('✓ Pure article record verified: status = "archived", tier = "safe_to_close"');

    assert.ok(formRecord, 'Form page record must exist in IndexedDB');
    assert.strictEqual(formRecord.status, 'discarded', 'Form page record status must be discarded');
    assert.strictEqual(formRecord.closureTier, 'suspend_only', 'Form page record closureTier must be suspend_only');
    console.log('✓ Form page record verified: status = "discarded", tier = "suspend_only"');

    // --- Test 3: Status badges in both layouts of the Knowledge Hub page ---
    console.log('\n--- Test 3: UI Badge Status Rendering (🗄️ Archived vs 💤 Sleeping) ---');

    // One page serves the side panel (narrow layout) and the full view (wide layout)
    const hubPage = await context.newPage();
    for (const [layout, viewport] of [['Narrow (side panel)', { width: 380, height: 800 }], ['Wide (full view)', { width: 1280, height: 800 }]]) {
      await hubPage.setViewportSize(viewport);
      await hubPage.goto(`chrome-extension://${extensionId}/src/app/index.html`);
      await hubPage.waitForSelector('.tab-card', { timeout: 5000 });

      const badges = await hubPage.evaluate(() => Array.from(document.querySelectorAll('.badge-status')).map(b => ({
        className: b.className,
        text: b.textContent.trim()
      })));

      assert.ok(badges.some(b => b.className.includes('archived') && b.text.includes('🗄️ Archived')), `${layout} layout must render 🗄️ Archived badge`);
      assert.ok(badges.some(b => b.className.includes('sleeping') && b.text.includes('💤 Sleeping')), `${layout} layout must render 💤 Sleeping badge`);
      console.log(`✓ ${layout} layout correctly displays "🗄️ Archived" and "💤 Sleeping" status badges`);
    }

    // --- Test 4: Pinned Tab & Domain Whitelist Safety ---
    console.log('\n--- Test 4: Pinned Tab & Domain Whitelist Safety ---');

    // 4a: Pinned Tab Safety (ignorePinnedTabs: true)
    const pinnedPage = await context.newPage();
    await pinnedPage.goto(`http://localhost:${PORT}/pure-article`);
    await pinnedPage.waitForLoadState('networkidle');

    const pinnedTabId = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const pure = tabs.find(t => t.url.includes('/pure-article'));
      if (pure) {
        await chrome.tabs.update(pure.id, { pinned: true });
        const data = await chrome.storage.session.get('tabTimestamps');
        const timestamps = data.tabTimestamps || {};
        timestamps[pure.id] = Date.now() - 120000;
        await chrome.storage.session.set({ tabTimestamps: timestamps });
        return pure.id;
      }
      return null;
    });

    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const helper = tabs.find(t => t.url.includes('src/options/index.html'));
      if (helper) await chrome.tabs.update(helper.id, { active: true });
    });
    await new Promise(r => setTimeout(r, 400));

    await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
      });
    });
    await new Promise(r => setTimeout(r, 1000));

    const pinnedTabStatus = await background.evaluate(async (targetId) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.id === targetId);
      return {
        exists: Boolean(tab),
        pinned: tab?.pinned,
        title: tab?.title
      };
    }, pinnedTabId);

    assert.strictEqual(pinnedTabStatus.exists, true, 'Pinned tab must remain open when ignorePinnedTabs is enabled');
    assert.strictEqual(pinnedTabStatus.pinned, true, 'Pinned tab must still be pinned');
    assert.ok(!pinnedTabStatus.title?.startsWith('💤 '), 'Pinned tab must not be soft-suspended');
    console.log('✓ Pinned tab safely ignored during sweep (ignorePinnedTabs: true)');

    await pinnedPage.close();

    // 4b: Domain Whitelist Safety
    await helperPage.evaluate(async () => {
      const { saveSettings, getSettings } = await import(chrome.runtime.getURL('src/storage/db.js'));
      const curr = await getSettings();
      await saveSettings({
        excludedDomains: [...(curr.excludedDomains || []), 'localhost']
      });
    });

    const whitelistedPage = await context.newPage();
    await whitelistedPage.goto(`http://localhost:${PORT}/pure-article`);
    await whitelistedPage.waitForLoadState('networkidle');

    const whitelistedTabId = await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const pure = tabs.find(t => t.url.includes('/pure-article'));
      if (pure) {
        const data = await chrome.storage.session.get('tabTimestamps');
        const timestamps = data.tabTimestamps || {};
        timestamps[pure.id] = Date.now() - 120000;
        await chrome.storage.session.set({ tabTimestamps: timestamps });
        return pure.id;
      }
      return null;
    });

    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const helper = tabs.find(t => t.url.includes('src/options/index.html'));
      if (helper) await chrome.tabs.update(helper.id, { active: true });
    });
    await new Promise(r => setTimeout(r, 400));

    await helperPage.evaluate(async () => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
      });
    });
    await new Promise(r => setTimeout(r, 1000));

    const whitelistedTabStatus = await background.evaluate(async (targetId) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.id === targetId);
      return { exists: Boolean(tab) };
    }, whitelistedTabId);

    assert.strictEqual(whitelistedTabStatus.exists, true, 'Whitelisted domain tab must NEVER be archived');
    console.log('✓ Whitelisted domain tab safely ignored during sweep');

    await whitelistedPage.close();

    // --- Test 5: "Closed today" lists the article TabSum closed in Test 2 ---
    console.log('\n--- Test 5: Knowledge Hub "Closed today" ---');
    await hubPage.reload();
    await hubPage.waitForSelector('#closed-today:not([hidden])', { timeout: 5000 });
    const closedToday = await hubPage.evaluate(() => ({
      count: Number(document.getElementById('closed-today-count').textContent),
      titles: Array.from(document.querySelectorAll('.closed-today-title')).map(el => el.textContent)
    }));
    assert.ok(closedToday.count >= 1, 'Closed today must count the auto-closed article');
    assert.strictEqual(closedToday.titles.length, closedToday.count, 'One row per closed tab');
    console.log(`✓ Closed today shows ${closedToday.count} tab(s)`);

    // --- Test 6: Without an AI summary, a closable article is suspended instead ---
    console.log('\n--- Test 6: Close requires an AI summary ---');
    await helperPage.evaluate(async () => {
      const { saveSettings, getSettings } = await import(chrome.runtime.getURL('src/storage/db.js'));
      const curr = await getSettings();
      await saveSettings({
        closeRequiresAiSummary: true,
        excludedDomains: (curr.excludedDomains || []).filter(d => d !== 'localhost')
      });
    });
    const gatedPage = await context.newPage();
    await gatedPage.goto(`http://localhost:${PORT}/pure-article`);
    await gatedPage.waitForLoadState('networkidle');
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const helper = tabs.find(t => t.url.includes('src/options/index.html'));
      if (helper) await chrome.tabs.update(helper.id, { active: true });
      const pure = tabs.find(t => t.url.includes('/pure-article'));
      const data = await chrome.storage.session.get('tabTimestamps');
      const timestamps = data.tabTimestamps || {};
      if (pure) timestamps[pure.id] = Date.now() - 120000;
      await chrome.storage.session.set({ tabTimestamps: timestamps });
    });
    await new Promise(r => setTimeout(r, 400));
    await helperPage.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
    }));
    await new Promise(r => setTimeout(r, 1000));

    const gated = await helperPage.evaluate(async () => {
      const { getArchivedTabs } = await import(chrome.runtime.getURL('src/storage/db.js'));
      const [rec] = (await getArchivedTabs({ limit: 50 })).filter(r => r.url.includes('/pure-article'));
      const tabs = await chrome.tabs.query({});
      return { tabOpen: tabs.some(t => t.url.includes('/pure-article')), rec };
    });
    assert.strictEqual(gated.tabOpen, true, 'Heuristic-only summary must not close the tab');
    assert.strictEqual(gated.rec.status, 'discarded', 'Record must be suspended, not archived');
    assert.strictEqual(gated.rec.summarySource, 'heuristic');
    assert.strictEqual(gated.rec.closedAt, null, 'Suspended tab must not appear in Closed today');
    console.log('✓ Without an AI summary the article was suspended, not closed');

    // --- Test 7: Hybrid tier 2 closes a tab TabSum suspended once it sits unused for 2x the timeout ---
    console.log('\n--- Test 7: Hybrid tier 2 (suspended -> closed) ---');
    // discard() is mocked (see Test 2), so Chrome never flags the tab discarded; report the tabs
    // TabSum mapped as discarded so the sweep takes the tier-2 branch.
    await background.evaluate(() => {
      globalThis.__realTabsQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => {
        const { discardedRecords = {} } = await chrome.storage.session.get('discardedRecords');
        return (await globalThis.__realTabsQuery(q)).map(t => (discardedRecords[t.id] ? { ...t, discarded: true } : t));
      };
    });
    await helperPage.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('src/storage/db.js'));
      await saveSettings({ closeRequiresAiSummary: false }); // the Test 6 record is heuristic-only
    });
    await background.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const pure = tabs.find(t => t.url.includes('/pure-article'));
      const data = await chrome.storage.session.get('tabTimestamps');
      const timestamps = data.tabTimestamps || {};
      if (pure) timestamps[pure.id] = Date.now() - 180000; // 3 min > 2 x 1-min timeout
      await chrome.storage.session.set({ tabTimestamps: timestamps });
    });
    await helperPage.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' }, resolve);
    }));
    await new Promise(r => setTimeout(r, 1000));

    const tier2 = await helperPage.evaluate(async (id) => {
      const { getTabById } = await import(chrome.runtime.getURL('src/storage/db.js'));
      const tabs = await chrome.tabs.query({});
      return { tabOpen: tabs.some(t => t.url.includes('/pure-article')), rec: await getTabById(id) };
    }, gated.rec.id);
    await background.evaluate(() => { chrome.tabs.query = globalThis.__realTabsQuery; });
    assert.strictEqual(tier2.tabOpen, false, 'Tier 2 must close the long-suspended tab');
    assert.strictEqual(tier2.rec.status, 'archived', 'Tier 2 record must be archived');
    assert.ok(tier2.rec.closedAt > 0, 'Tier 2 close must stamp closedAt (Closed today)');
    console.log('✓ Long-suspended tab was closed by tier 2 and recorded as archived');

    // Clean up test tabs
    await bgUntouchedForm.close();
    await hubPage.close();

    console.log('\n======================================================');
    console.log('🎉 ALL HYBRID ADAPTIVE ARCHIVAL MODE TESTS PASSED! 🎉');
    console.log('======================================================\n');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(USER_DATA_DIR)) {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    }
  }
}

runHybridTests().catch(err => {
  console.error('❌ Hybrid Mode Test Failure:', err);
  process.exit(1);
});
