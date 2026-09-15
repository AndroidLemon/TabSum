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
import { buildTestExtension, extensionLaunchOptions, extractTab, waitForServiceWorker } from './helpers/test-extension.js';

const EXTENSION_PATH = buildTestExtension();
const USER_DATA_DIR = path.resolve('./tests/.playwright_user_data_hardening');

// Word fixtures for the /hidden-prose route (Step 2 of EXTRACTION_PLAN.md).
// Every paragraph gets its own unique word prefix so the test can assert a
// hidden/off-screen/nav word never appears in cleanText without relying on
// any particular boilerplate phrase.
function makeWords(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');
}
const VISIBLE_PARAGRAPHS = [
  makeWords('visible0-', 30),
  makeWords('visible1-', 30),
  makeWords('visible2-', 30)
];
const HIDDEN_DIV_PARAGRAPHS = [
  makeWords('hiddendiv0-', 20),
  makeWords('hiddendiv1-', 20),
  makeWords('hiddendiv2-', 20)
];
const OFFSCREEN_PARAGRAPH = makeWords('offscreen-', 15);
const NAV_PARAGRAPH = makeWords('navword-', 6);

// Fixtures for the /table-prose route (Step 3 of EXTRACTION_PLAN.md), modelled
// on HN: short <td> titles (must be harvested despite being under 20 chars)
// and <span class="commtext"> comments nested inside a <td> (must be counted
// once, via the <td>, not a second time via the <span>). Titles are kept
// under 20 chars on purpose -- that is the exact case the dropped floor fixes.
const TABLE_TITLES = [makeWords('ttl0-', 2), makeWords('ttl1-', 2)];
const TABLE_COMMENTS = [makeWords('cmt0-', 6), makeWords('cmt1-', 6)];
// A <p> nested two <div>s deep must be counted exactly once, not once per
// wrapping <div> -- the double-counting the leaf/containment rule exists to fix.
const NESTED_PARAGRAPH = makeWords('nested-', 25);

// Fixtures for the /nested-spans route: a <p><span><span>...</span></span></p>
// chain must be counted once, via the <p> that is the spans' nearest block
// ancestor; a visibility:visible <span> inside a visibility:hidden <p> must
// still be harvested, since the rendered test is asked of each text node's own
// parent; a <figcaption> must be harvested under the floor-free tag list; and a
// <p> inside a CLOSED <details> must not be rendered at all.
const NESTED_SPAN_WORDS = makeWords('nspan-', 12);
const HIDDEN_P_VISIBLE_SPAN_WORDS = makeWords('vspan-', 10);
const FIGCAPTION_WORDS = makeWords('figcap-', 6);
const SUMMARY_CAPTION = 'short cap';
const CLOSED_DETAILS_WORDS = makeWords('detailshidden-', 8);

// A top-level page's designMode must never be treated as an editor draft --
// only copy-enabler extensions set it there. A paragraph long enough to be
// unambiguous prose, not an editor draft.
const DESIGNMODE_TOP_PARAGRAPH = makeWords('dmtop-', 30);

// Fixtures for the /text-nodes route (round-2 rewrite: the harvest walks text
// nodes and groups each by its nearest block ancestor).
//   A/B/C model a Hacker News comment, `<div class="commtext">A<p>B<p>C</div>`:
//     the element harvest disqualified the div because of the nested <p>s and
//     lost A entirely. All three must count, each exactly once.
//   REVEAL is a scroll-reveal paragraph parked at opacity:0 -- a background tab
//     never scrolls, so the prose gate must not check opacity.
//   SIDEBAR sits in `<aside class="sidebar"><article>` BEFORE the real
//     .entry-content, so the container pick must skip it (it is noise) rather
//     than take the first match in document order and harvest the teaser alone.
//   BR_LINES: "Line one<br>Line two" is four words, not three.
//   CELL_WRAPPER: a wrapper <div> inside a <td> inherits the cell's no-floor.
const TEXTNODE_A = makeWords('tna-', 10);
const TEXTNODE_B = makeWords('tnb-', 10);
const TEXTNODE_C = makeWords('tnc-', 10);
const TEXTNODE_REVEAL = makeWords('tnreveal-', 10);
const TEXTNODE_SIDEBAR = makeWords('tnsidebar-', 10);
const TEXTNODE_BR_LINES = 'Line one Line two';
const TEXTNODE_CELL_WRAPPER = 'opened this issue';
// A text node directly inside a shadow host that does not slot it is laid out
// nowhere -- GitHub's `<relative-time>Sep 14, 2026</relative-time>` renders
// "2 days ago" from its shadow root instead -- so it must not reach cleanText.
const TEXTNODE_UNSLOTTED = makeWords('tnunslotted-', 10);
// A hidden `<article style="display:none">` sitting BEFORE the real
// `.entry-content` -- the responsive mobile/desktop duplicate-container shape.
// Without the "root must also be rendered" fix this wins the container pick
// outright, every text node under it fails the rendered test, and the whole
// harvest comes back empty.
const TEXTNODE_HIDDEN_ARTICLE = makeWords('tnhiddenart-', 12);
// A visible <div> whose own text must count even though it also holds a
// hidden nested <div> -- the shape the old element-level hasBlockingDescendant
// check lost; the text-node walk keeps it by construction.
const TEXTNODE_VISIBLE_PARENT = makeWords('tnvisparent-', 8);
const TEXTNODE_HIDDEN_CHILD = makeWords('tnhiddenchild-', 6);
// A visible <p> whose own words count, holding an inline `<span class="ad">`
// whose words must not -- the TreeWalker REJECTs NOISE_SELECTOR subtrees.
const TEXTNODE_AD_PARAGRAPH = makeWords('tnadpara-', 8);
const TEXTNODE_AD_SPAN = makeWords('tnadspan-', 5);

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

    // Controls the user cannot see: a display:none draft box and the off-screen
    // capture textarea every virtualized editor and clipboard shim parks in the DOM.
    if (req.url === '/hidden-controls') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Long Read</title></head>
        <body>
          <main><h1>Essay</h1><p>${'Prose that the reader came here to read. '.repeat(50)}</p></main>
          <textarea style="display:none"></textarea>
          <textarea style="position:absolute;left:-9999px;top:-9999px"></textarea>
          <select style="visibility:hidden"><option>a</option></select>
          <script>document.querySelector('textarea').value = 'a draft the user typed, then the page hid the box (GitHub Preview mode)';</script>
        </body>
        </html>
      `);
      return;
    }

    // A virtualized editor: no semantic signal at all, only a vendor class.
    if (req.url === '/vendor-editor') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>JSON Tool</title></head>
        <body>
          <h1>Formatter</h1>
          <p>${'Paste your document below to reformat it. '.repeat(40)}</p>
          <div class="ace_editor" style="width:600px;height:300px">editor surface</div>
        </body>
        </html>
      `);
      return;
    }

    // A classic TinyMCE/CKEditor-style editor: no element carries the editing
    // role, the whole iframe document does via document.designMode = 'on'.
    if (req.url === '/designmode-editor') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Newsletter Composer</title></head>
        <body>
          <h1>Compose</h1>
          <p>${'Draft your newsletter below before sending it out. '.repeat(40)}</p>
          <iframe src="/designmode-frame" width="600" height="400"></iframe>
        </body>
        </html>
      `);
      return;
    }

    if (req.url === '/designmode-frame') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <body>
          <p>Unsaved newsletter draft the user has not sent yet.</p>
          <script>document.designMode = 'on';</script>
        </body>
        </html>
      `);
      return;
    }

    // A select that IS data entry: it sits in a form with a submit button.
    if (req.url === '/submit-form-select') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Order Options</title></head>
        <body>
          <p>${'Choose your configuration before continuing. '.repeat(40)}</p>
          <form>
            <select name="size"><option>S</option><option>M</option></select>
            <button type="submit">Continue</button>
          </form>
        </body>
        </html>
      `);
      return;
    }

    // A DOM-only tool: a 2048-style game with no input, textarea, select,
    // contenteditable, canvas, dialog, or application role anywhere on the
    // page -- every telemetry count rule 1 checks is zero. Nothing here is an
    // article either, so rule 4's word-count floor is the only thing standing
    // between a discard and the game state living in these tile divs.
    if (req.url === '/dom-tool') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>2048</title></head>
        <body>
          <div class="heading"><h1>2048</h1></div>
          <div class="scores">
            <div class="score-box">Score <span>128</span></div>
            <div class="best-box">Best <span>2048</span></div>
          </div>
          <div class="grid">
            <div class="grid-row">
              <div class="tile tile-2">2</div>
              <div class="tile tile-4">4</div>
              <div class="tile tile-empty"></div>
              <div class="tile tile-empty"></div>
            </div>
            <div class="grid-row">
              <div class="tile tile-8">8</div>
              <div class="tile tile-empty"></div>
              <div class="tile tile-16">16</div>
              <div class="tile tile-empty"></div>
            </div>
            <div class="grid-row">
              <div class="tile tile-empty"></div>
              <div class="tile tile-32">32</div>
              <div class="tile tile-empty"></div>
              <div class="tile tile-empty"></div>
            </div>
            <div class="grid-row">
              <div class="tile tile-64">64</div>
              <div class="tile tile-empty"></div>
              <div class="tile tile-empty"></div>
              <div class="tile tile-128">128</div>
            </div>
          </div>
          <div class="game-footer"><p>Join the numbers to get the 2048 tile.</p></div>
        </body>
        </html>
      `);
      return;
    }

    // An editor at the top of a long page. The reader scrolls down to read; the
    // editor leaves the viewport but not the page, and must still be counted.
    if (req.url === '/scrolled-editor') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Notebook</title></head>
        <body>
          <div class="cm-editor" style="width:600px;height:300px">notebook cell the user was typing in</div>
          <textarea style="position:fixed;top:-9999px;left:0;width:200px;height:40px"></textarea>
          <main><p>${'Prose that goes on well past the fold so the page actually scrolls. '.repeat(200)}</p></main>
        </body>
        </html>
      `);
      return;
    }

    // #search must not "resolve" against <input name="search">, but a real
    // <a name="..."> anchor still has to.
    if (req.url.startsWith('/hash-names')) {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Handbook</title></head>
        <body>
          <input type="text" name="search" placeholder="Search">
          <a name="deep-link"></a>
          <main><p>${'The handbook explains each setting in turn. '.repeat(60)}</p></main>
        </body>
        </html>
      `);
      return;
    }

    // Step 2 of the extraction plan: the live-DOM harvest must skip hidden and
    // off-screen prose that a detached clone's innerText === textContent used
    // to let straight through, and must still skip nav text via the noise list.
    if (req.url === '/hidden-prose') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Hidden Prose Test</title></head>
        <body>
          <article>
            <p>${VISIBLE_PARAGRAPHS[0]}</p>
            <p>${VISIBLE_PARAGRAPHS[1]}</p>
            <p>${VISIBLE_PARAGRAPHS[2]}</p>
            <div style="display:none">
              <p>${HIDDEN_DIV_PARAGRAPHS[0]}</p>
              <p>${HIDDEN_DIV_PARAGRAPHS[1]}</p>
              <p>${HIDDEN_DIV_PARAGRAPHS[2]}</p>
            </div>
            <p style="position:absolute;left:-9999px">${OFFSCREEN_PARAGRAPH}</p>
          </article>
          <nav><p>${NAV_PARAGRAPH}</p></nav>
        </body>
        </html>
      `);
      return;
    }

    // Step 3 of the extraction plan: the widened block selector must harvest
    // <td> titles under the old 20-char floor and a <span class="commtext">
    // nested inside a <td>, counting the comment once (via the <td>) not
    // twice; and a <p> nested two plain <div>s deep must count exactly once.
    if (req.url === '/table-prose') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Table Prose Test</title></head>
        <body>
          <table>
            <tr><td>${TABLE_TITLES[0]}</td></tr>
            <tr><td>${TABLE_TITLES[1]}</td></tr>
            <tr><td><span class="commtext">${TABLE_COMMENTS[0]}</span></td></tr>
            <tr><td><span class="commtext">${TABLE_COMMENTS[1]}</span></td></tr>
          </table>
          <div class="outer"><div class="inner"><p>${NESTED_PARAGRAPH}</p></div></div>
        </body>
        </html>
      `);
      return;
    }

    // Inline markup joins its nearest block ancestor's group, so a nested span
    // chain is counted once via the <p>; and the rendered test is per text
    // node's own parent, so a visible <span> under a hidden <p> survives.
    if (req.url === '/nested-spans') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Nested Spans Test</title></head>
        <body>
          <article>
            <p><span><span>${NESTED_SPAN_WORDS}</span></span></p>
            <p style="visibility:hidden"><span style="visibility:visible">${HIDDEN_P_VISIBLE_SPAN_WORDS}</span></p>
            <figure><figcaption>${FIGCAPTION_WORDS}</figcaption></figure>
            <details><summary>${SUMMARY_CAPTION}</summary><p>${CLOSED_DETAILS_WORDS}</p></details>
          </article>
        </body>
        </html>
      `);
      return;
    }

    // Round-2 rewrite: the text-node walk must count a block's own text even
    // when it holds nested blocks (the HN comment shape), must not check
    // opacity on prose, must pick the container from the pruned set, must keep
    // <br> as a word break, and must inherit a <td>'s no-floor through a
    // wrapper <div>.
    if (req.url === '/text-nodes') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Text Nodes Test</title></head>
        <body>
          <aside class="sidebar"><article><p>${TEXTNODE_SIDEBAR}</p></article></aside>
          <article style="display:none"><p>${TEXTNODE_HIDDEN_ARTICLE}</p></article>
          <div class="entry-content">
            <table>
              <tr><td><div class="commtext">${TEXTNODE_A}<p>${TEXTNODE_B}<p>${TEXTNODE_C}</div></td></tr>
              <tr><td><div class="d-flex">${TEXTNODE_CELL_WRAPPER}</div></td></tr>
            </table>
            <p class="reveal" style="opacity:0">${TEXTNODE_REVEAL}</p>
            <p>Line one<br>Line two</p>
            <p><span id="shadow-host">${TEXTNODE_UNSLOTTED}</span></p>
            <div>${TEXTNODE_VISIBLE_PARENT} <div style="display:none">${TEXTNODE_HIDDEN_CHILD}</div></div>
            <p>${TEXTNODE_AD_PARAGRAPH} <span class="ad">${TEXTNODE_AD_SPAN}</span></p>
          </div>
          <script>
            document.getElementById('shadow-host')
              .attachShadow({ mode: 'open' }).innerHTML = '<span>rendered instead</span>';
          </script>
        </body>
        </html>
      `);
      return;
    }

    // designMode on the TOP document (a copy-enabler extension's doing, not an
    // editor) must never be treated as an unsaved rich-text draft.
    if (req.url === '/designmode-top') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Rich Reading Page</title></head>
        <body>
          <script>document.designMode = 'on';</script>
          <main><p>${DESIGNMODE_TOP_PARAGRAPH}</p></main>
        </body>
        </html>
      `);
      return;
    }

    // pkg.go.dev's shape: a docs page whose every example carries a "Run" textarea under a
    // closed <details>, its value filled by script on load. Folded away is not a draft.
    // The same page with the details OPEN must still read as unsaved work: the rule is
    // closed-details only, not "unrendered".
    const exampleDoc = (open) => `
        <!DOCTYPE html>
        <html>
        <head><title>net/http</title></head>
        <body>
          <article><h1>Package http</h1><p>${'Package http provides HTTP client and server implementations. '.repeat(40)}</p></article>
          <details${open ? ' open' : ''}><summary>Example</summary><div><textarea class="code"></textarea></div></details>
          <script>document.querySelector('textarea').value = 'package main // run me';</script>
        </body>
        </html>
      `;
    if (req.url === '/folded-example') { res.end(exampleDoc(false)); return; }
    if (req.url === '/unfolded-example') { res.end(exampleDoc(true)); return; }

    // The <summary> line renders even when its <details> is closed: a control there is
    // visible and typed-into, so the folded-away rule must not swallow it.
    if (req.url === '/summary-control') {
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Filtered Docs</title></head>
        <body>
          <article><h1>Reference</h1><p>${'Reference prose the reader came here for. '.repeat(40)}</p></article>
          <details><summary>Filter: <input type="text" name="filter"></summary><div>Filtered content appears here.</div></details>
          <script>document.querySelector('input').value = 'typed filter';</script>
        </body>
        </html>
      `);
      return;
    }

    res.end('<h1>404 Not Found</h1>');
  });

  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

// Inject into every frame of the tab serving `route` and merge the per-frame
// results exactly as the background service worker does. The worker can't
// dynamic-import (banned on ServiceWorkerGlobalScope), so it hands back the raw
// per-frame results and the pure merge runs here in Node.
async function extractTabAllFrames(background, route) {
  const frames = await background.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url.includes(target));
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/content/in-tab-extractor.js']
    });
    return results.map(r => ({ frameId: r.frameId, result: r.result }));
  }, route);
  return mergeFrameExtractions(frames);
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

    const background = await waitForServiceWorker(context);
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

    const richCheck = await extractTab(background, '/rich-editor');

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

    const orphanCheck = await extractTabAllFrames(background, '/orphan-picker');

    assert.strictEqual(orphanCheck.closureTelemetry.inputCounts.selects, 0,
      'a version picker outside a form is chrome, not data entry');
    assert.strictEqual(orphanCheck.closureTelemetry.inputCounts.otherInputs, 0,
      'a menu checkbox outside a form is chrome, not data entry');
    assert.strictEqual(
      classifyClosureSafety({ ...orphanCheck.closureTelemetry, wordCount: orphanCheck.wordCount }).tier,
      'safe_to_close', 'so the article underneath them stays closeable');
    console.log(`✓ Orphan picker ignored: article with ${orphanCheck.wordCount} words stays closeable`);
    await orphanPage.close();

    // 4a-4. Table-driven coverage for the telemetry rules added in Steps 3-6.
    const telemetryCases = [
      { route: '/hidden-controls', tier: 'safe_to_close', dirty: true,
        expect: { textareas: 0, selects: 0 },
        why: 'controls the user cannot see are not counted as controls in use, but a hidden textarea holding a draft is still unsaved work: the closed-details rule must not widen into "unrendered = clean"' },
      { route: '/vendor-editor', tier: 'suspend_only', dirty: true,
        expect: { appContainers: 1 },
        why: 'a virtualized editor is visible only through its vendor class, and its draft is unsaved work' },
      { route: '/submit-form-select', tier: 'suspend_only',
        expect: { selects: 1 },
        why: 'a select inside a submittable form is real data entry' },
      { route: '/designmode-editor', tier: 'suspend_only', dirty: true,
        expect: { appContainers: 1 },
        why: 'document.designMode turns the whole iframe document into an editor, with no element for TEXT_EDITOR_SELECTOR to match' },
      { route: '/dom-tool', tier: 'suspend_only', dirty: false,
        expect: { appContainers: 0, textareas: 0, selects: 0, passwords: 0, otherInputs: 0 },
        reason: 'Short or low-confidence content',
        why: 'a DOM-only tool with zero controls is held by rule 4 alone; if a harvest change ever pushes its chrome past 120 words it would close with the user\'s game state' },
      { route: '/folded-example', tier: 'safe_to_close', dirty: false,
        expect: { textareas: 0 },
        why: 'a script-filled textarea under a closed <details> is content the page folded away, not a draft (pkg.go.dev)' },
      { route: '/unfolded-example', tier: 'suspend_only', dirty: true,
        expect: { textareas: 1 },
        why: 'the same textarea with the details open is a visible draft; the rule is closed-details only, not "unrendered"' },
      { route: '/summary-control', tier: 'safe_to_close', dirty: true,
        expect: { otherInputs: 1 },
        why: 'a control in the <summary> of a closed <details> is rendered and typed-into; the folded-away rule exempts it and the draft stays dirty' }
    ];

    for (const testCase of telemetryCases) {
      const casePage = await context.newPage();
      await casePage.goto(`http://localhost:${PORT}${testCase.route}`);
      // 'load' waits for iframes; domcontentloaded does not, and the
      // designmode-editor case sets its state in a subframe.
      await casePage.waitForLoadState('load');

      // Merged, same as the background service worker does, so a case whose
      // editor surface lives in a subframe (e.g. designmode-editor) is judged
      // on what the tab as a whole reports, not on whichever frame came first.
      const caseResult = await extractTabAllFrames(background, testCase.route);

      for (const [key, want] of Object.entries(testCase.expect)) {
        assert.strictEqual(caseResult.closureTelemetry.inputCounts[key], want,
          `${testCase.route}: ${key} should be ${want} — ${testCase.why}`);
      }
      const classified = classifyClosureSafety({ ...caseResult.closureTelemetry, wordCount: caseResult.wordCount });
      assert.strictEqual(classified.tier, testCase.tier, `${testCase.route} must classify ${testCase.tier}`);
      if (testCase.reason !== undefined) {
        assert.strictEqual(classified.reason, testCase.reason,
          `${testCase.route}: reason should be "${testCase.reason}" — ${testCase.why}`);
      }
      if (testCase.dirty !== undefined) {
        // The dirty check and the telemetry count share one editor list; before
        // they were reconciled, a draft in Ace or CodeMirror read as clean.
        assert.strictEqual(caseResult.isDirty, testCase.dirty,
          `${testCase.route}: isDirty should be ${testCase.dirty} — the zero-loss guard must know every editor the classifier does`);
      }
      console.log(`✓ ${testCase.route} -> ${testCase.tier} (${testCase.why})`);
      await casePage.close();
    }

    // 4a-4b. EXTRACTION_PLAN.md Step 2: the live-DOM harvest must recover
    // exactly the visible prose and none of the hidden/off-screen/nav prose
    // that a detached clone's innerText === textContent used to leak through.
    const hiddenProsePage = await context.newPage();
    await hiddenProsePage.goto(`http://localhost:${PORT}/hidden-prose`);
    await hiddenProsePage.waitForLoadState('domcontentloaded');

    const hiddenProseResult = await extractTabAllFrames(background, '/hidden-prose');

    const expectedWordCount = VISIBLE_PARAGRAPHS
      .join(' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    assert.strictEqual(hiddenProseResult.wordCount, expectedWordCount,
      `wordCount must equal exactly the visible paragraphs' word count (${expectedWordCount}), got ${hiddenProseResult.wordCount}`);

    const hiddenWords = ['hiddendiv0-0', 'hiddendiv1-0', 'hiddendiv2-0', 'offscreen-0', 'navword-0'];
    for (const word of hiddenWords) {
      assert.ok(!hiddenProseResult.cleanText.includes(word),
        `cleanText must not contain "${word}" — hidden/off-screen/nav prose must not survive the live-DOM harvest`);
    }
    console.log(`✓ /hidden-prose: wordCount === ${expectedWordCount} (visible only), no hidden/off-screen/nav words leaked into cleanText`);
    await hiddenProsePage.close();

    // 4a-4c. EXTRACTION_PLAN.md Step 3: widened block selector must harvest
    // <td> titles under the old 20-char floor and count a <p> nested two plain
    // <div>s deep exactly once, not once per wrapping <div>.
    const tableProsePage = await context.newPage();
    await tableProsePage.goto(`http://localhost:${PORT}/table-prose`);
    await tableProsePage.waitForLoadState('domcontentloaded');

    const tableProseResult = await extractTabAllFrames(background, '/table-prose');

    const expectedTableWordCount = [...TABLE_TITLES, ...TABLE_COMMENTS, NESTED_PARAGRAPH]
      .join(' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    assert.strictEqual(tableProseResult.wordCount, expectedTableWordCount,
      `wordCount must equal the exact expected count (${expectedTableWordCount}) — short <td> titles must be harvested and the nested <p> counted exactly once, got ${tableProseResult.wordCount}`);

    // The nested <p>'s first word must appear exactly once: not zero (dropped)
    // and not twice (double-counted by both wrapping <div>s).
    const nestedOccurrences = tableProseResult.cleanText.split('nested-0').length - 1;
    assert.strictEqual(nestedOccurrences, 1,
      `"nested-0" must appear exactly once in cleanText — nested <div>s must not double-count the <p> they wrap`);

    console.log(`✓ /table-prose: wordCount === ${expectedTableWordCount} (short <td> titles harvested, <span> comment counted once via its <td>, nested <p> counted once)`);
    await tableProsePage.close();

    // 4a-4d. Nested inline markup must be counted once, via the nearest block
    // ancestor, and the per-text-node rendered test must keep a visible <span>
    // that sits inside a visibility:hidden <p>.
    const nestedSpansPage = await context.newPage();
    await nestedSpansPage.goto(`http://localhost:${PORT}/nested-spans`);
    await nestedSpansPage.waitForLoadState('domcontentloaded');

    const nestedSpansResult = await extractTabAllFrames(background, '/nested-spans');

    // WORDS4 (inside a closed <details>) is asserted separately below, not
    // folded into this expectation, so a surprise there is visible on its own.
    const expectedNestedSpansWordCount = [NESTED_SPAN_WORDS, HIDDEN_P_VISIBLE_SPAN_WORDS, FIGCAPTION_WORDS, SUMMARY_CAPTION]
      .join(' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    // Verify the assumption the expectation above relies on: a closed <details>
    // does not render its non-summary children, so checkVisibility must say no.
    const closedDetailsWordLeaked = nestedSpansResult.cleanText.includes('detailshidden-0');
    assert.strictEqual(closedDetailsWordLeaked, false,
      'a <p> inside a CLOSED <details> must not be rendered, so its text must not reach cleanText');

    assert.strictEqual(nestedSpansResult.wordCount, expectedNestedSpansWordCount,
      `wordCount must equal exactly WORDS + WORDS2 + WORDS3 + "short cap" (${expectedNestedSpansWordCount}), got ${nestedSpansResult.wordCount}`);

    const nestedFirstWordOccurrences = nestedSpansResult.cleanText.split('nspan-0').length - 1;
    assert.strictEqual(nestedFirstWordOccurrences, 1,
      '"nspan-0" must appear exactly once — the <p> is harvested, and the outer/inner <span>s must not also contribute');

    console.log(`✓ /nested-spans: wordCount === ${expectedNestedSpansWordCount} (nested spans counted once via the <p>, visible span under a hidden <p> still harvested, figcaption harvested, closed-details text excluded)`);
    await nestedSpansPage.close();

    // 4a-4f. Round-2 rewrite: the harvest walks text nodes grouped by nearest
    // block ancestor, so a block that holds nested blocks keeps its OWN text
    // (the Hacker News comment shape), prose is not opacity-gated, the
    // container is picked from the pruned set, <br> breaks words, and a <td>'s
    // no-floor is inherited by a wrapper <div> inside it.
    const textNodesPage = await context.newPage();
    await textNodesPage.goto(`http://localhost:${PORT}/text-nodes`);
    await textNodesPage.waitForLoadState('domcontentloaded');

    const textNodesResult = await extractTabAllFrames(background, '/text-nodes');

    const expectedTextNodesWordCount = [
      TEXTNODE_A, TEXTNODE_B, TEXTNODE_C, TEXTNODE_REVEAL,
      TEXTNODE_BR_LINES, TEXTNODE_CELL_WRAPPER,
      TEXTNODE_VISIBLE_PARENT, TEXTNODE_AD_PARAGRAPH
    ].join(' ').trim().split(/\s+/).filter(Boolean).length;

    assert.strictEqual(textNodesResult.wordCount, expectedTextNodesWordCount,
      `wordCount must equal exactly A + B + C + reveal + "${TEXTNODE_BR_LINES}" + "${TEXTNODE_CELL_WRAPPER}" + visible-parent + ad-paragraph (${expectedTextNodesWordCount}), got ${textNodesResult.wordCount}`);

    // Each nested-block sibling contributes exactly once: not zero (the div's
    // own text dropped because it holds <p>s) and not twice (double-counted).
    for (const firstWord of ['tna-0', 'tnb-0', 'tnc-0']) {
      const occurrences = textNodesResult.cleanText.split(firstWord).length - 1;
      assert.strictEqual(occurrences, 1,
        `"${firstWord}" must appear exactly once in cleanText — a block that holds nested blocks keeps its own text, and no text node is counted twice`);
    }

    assert.ok(textNodesResult.cleanText.includes('tnreveal-0'),
      'an opacity:0 scroll-reveal paragraph must still be harvested — a background tab never scrolls, so the reveal never fires');
    assert.ok(!textNodesResult.cleanText.includes('tnunslotted-0'),
      'light-DOM text a shadow root does not slot is laid out nowhere, so it must not be counted (GitHub\'s <relative-time> fallback date)');
    assert.ok(!textNodesResult.cleanText.includes('tnsidebar-0'),
      'an <article> inside <aside class="sidebar"> must not win the container pick over the real .entry-content');
    assert.ok(textNodesResult.cleanText.includes(TEXTNODE_CELL_WRAPPER),
      'a wrapper <div> inside a <td> must inherit the cell\'s no-floor');

    assert.ok(!textNodesResult.cleanText.includes('tnhiddenart-0'),
      'a hidden <article style="display:none"> preceding the real .entry-content must not win the container pick, and must not be counted itself');
    assert.ok(textNodesResult.cleanText.includes('tnvisparent-0'),
      'a visible <div>\'s own text must be harvested even though it also holds a hidden nested <div>');
    assert.ok(!textNodesResult.cleanText.includes('tnhiddenchild-0'),
      'a hidden nested <div style="display:none"> inside a visible parent must not be counted');
    assert.ok(textNodesResult.cleanText.includes('tnadpara-0'),
      'a visible <p>\'s own text must be harvested even though it holds an inline <span class="ad">');
    assert.ok(!textNodesResult.cleanText.includes('tnadspan-0'),
      'an inline <span class="ad"> must be excluded -- the TreeWalker REJECTs NOISE_SELECTOR subtrees');

    console.log(`✓ /text-nodes: wordCount === ${expectedTextNodesWordCount} (nested-block siblings each counted once, opacity:0 prose kept, sidebar <article> skipped, hidden container decoy skipped, hidden child div excluded, inline .ad excluded, <br> breaks words, <td> no-floor inherited by a wrapper <div>)`);
    await textNodesPage.close();

    // 4a-4e. designMode on the TOP document (set by copy-enabler extensions on
    // every page) must never be treated as an unsaved editor draft -- only a
    // SUBFRAME's designMode is, per the adversarial-review fix to checkIsDirty.
    const designmodeTopPage = await context.newPage();
    await designmodeTopPage.goto(`http://localhost:${PORT}/designmode-top`);
    await designmodeTopPage.waitForLoadState('domcontentloaded');

    const designmodeTopCheck = await extractTab(background, '/designmode-top');

    assert.strictEqual(designmodeTopCheck.isDirty, false,
      'designMode on the top document must not mark the tab dirty -- copy-enabler extensions set it on every page');
    console.log('✓ /designmode-top: top-document designMode does not trigger isDirty');
    await designmodeTopPage.close();

    // 4a-5. The box test compares against the document origin, not the viewport.
    // Read raw, getBoundingClientRect made every control above the fold look
    // off-screen, so any page the reader had scrolled reported zero controls.
    const readAfterScroll = async (route, scrollTo) => {
      const p = await context.newPage();
      await p.goto(`http://localhost:${PORT}${route}`);
      await p.waitForLoadState('domcontentloaded');
      if (scrollTo) await p.evaluate((y) => window.scrollTo(0, y), scrollTo);
      const out = await background.evaluate(async (r) => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url.includes(r));
        const results = await chrome.scripting.executeScript({
          target: { tabId: target.id, allFrames: true },
          files: ['src/content/in-tab-extractor.js']
        });
        return results?.[0]?.result;
      }, route.split('#')[0]);
      await p.close();
      return out;
    };

    const unscrolled = await readAfterScroll('/scrolled-editor', 0);
    const scrolled = await readAfterScroll('/scrolled-editor', 4000);
    assert.strictEqual(unscrolled.closureTelemetry.inputCounts.appContainers, 1,
      'the editor is counted before the reader scrolls');
    assert.strictEqual(scrolled.closureTelemetry.inputCounts.appContainers, 1,
      'and is still counted once it has been scrolled past — it left the viewport, not the page');
    assert.strictEqual(
      classifyClosureSafety({ ...scrolled.closureTelemetry, wordCount: scrolled.wordCount }).tier,
      'suspend_only', 'so a scrolled page holding an editor is never handed to the closer');
    // The mirror of that bug: a position:fixed element's rect is viewport-relative
    // by definition and does not move with scroll, so adding the scroll offset
    // would rescue a toolbar genuinely parked at top:-9999px on any long page.
    assert.strictEqual(unscrolled.closureTelemetry.inputCounts.textareas, 0,
      'a fixed control parked off-screen is not counted');
    assert.strictEqual(scrolled.closureTelemetry.inputCounts.textareas, 0,
      'and scrolling does not rescue it — fixed elements do not move with scroll');
    console.log('✓ Scrolled-past editor still counted; parked fixed control still is not');

    // 4a-6. A hash resolves against real anchors only, never a form control name.
    const collide = await readAfterScroll('/hash-names#search', 0);
    const realAnchor = await readAfterScroll('/hash-names#deep-link', 0);
    assert.strictEqual(collide.closureTelemetry.urlParts.hashResolvesToAnchor, false,
      '#search must not resolve against <input name="search">');
    assert.strictEqual(realAnchor.closureTelemetry.urlParts.hashResolvesToAnchor, true,
      'but a genuine <a name="deep-link"> still resolves');
    assert.strictEqual(
      classifyClosureSafety({ ...collide.closureTelemetry, wordCount: collide.wordCount }).tier,
      'suspend_only', 'so an SPA route keeps its page');
    assert.strictEqual(
      classifyClosureSafety({ ...realAnchor.closureTelemetry, wordCount: realAnchor.wordCount }).tier,
      'safe_to_close', 'while a deep-linked handbook still closes');
    console.log('✓ Hash resolution ignores form-control names, honours real anchors');

    // 4b. Shadow DOM Form Input
    const shadowPage = await context.newPage();
    await shadowPage.goto(`http://localhost:${PORT}/shadow-dom-form`);
    await shadowPage.waitForLoadState('domcontentloaded');

    const shadowCheck = await extractTab(background, '/shadow-dom-form');

    assert.strictEqual(shadowCheck.isDirty, true, 'Shadow DOM modified input must trigger isDirty');
    console.log(`✓ Shadow DOM input detected: reason = "${shadowCheck.reason}"`);
    await shadowPage.close();

    // 4c. Role="textbox" (Slack / Notion / Jira editor)
    const rolePage = await context.newPage();
    await rolePage.goto(`http://localhost:${PORT}/role-textbox`);
    await rolePage.waitForLoadState('domcontentloaded');

    const roleCheck = await extractTab(background, '/role-textbox');

    assert.strictEqual(roleCheck.isDirty, true, 'Role="textbox" editor draft must trigger isDirty');
    console.log(`✓ Role="textbox" editor detected: reason = "${roleCheck.reason}"`);
    await rolePage.close();

    // 4d. Clean Page
    const cleanPage = await context.newPage();
    await cleanPage.goto(`http://localhost:${PORT}/clean-article`);
    await cleanPage.waitForLoadState('domcontentloaded');

    const cleanCheck = await extractTab(background, '/clean-article');

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
