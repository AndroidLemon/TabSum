/**
 * TabSum - Chrome Web Store asset generator.
 *
 * Produces the screenshots, promo tile and demo GIFs listed in
 * docs/CHROMEWEBSTORE.md section 4, into docs/store/.
 *
 * Run: npm run assets:store   (== node tests/store_assets.js)
 * Needs TABSUM_HEADLESS=1 (see tests/helpers/test-extension.js for why: the default
 * headless Chromium build can't load extensions, so headless runs need channel 'chromium').
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { buildTestExtension, extensionLaunchOptions, waitForServiceWorker } from './helpers/test-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'store');
const TMP_ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tabsum-store-'));
const USER_DATA_DIR = path.join(TMP_ROOT, 'profile');

const WIDE = { width: 1280, height: 800 };
const PROMO = { width: 440, height: 280 };

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (days, hours = 0) => NOW - days * DAY - hours * HOUR;

// ---------------------------------------------------------------------------
// Seed data: ~12 notes across varied real domains, spread over the past two
// weeks, with overlapping tags, a couple of favorites, and several closed today.
// ---------------------------------------------------------------------------
const NOTES = [
  {
    id: 'n1',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade_layers',
    title: 'Understanding the CSS Cascade Layers',
    domain: 'developer.mozilla.org',
    capturedAt: ago(0, 1),
    closedAt: ago(0, 1),
    status: 'archived',
    summarySource: 'prompt-api',
    isFavorite: false,
    readingTimeMinutes: 6,
    summary: {
      tldr: 'CSS cascade layers let you group style rules into ordered layers so specificity and source order stop deciding which rule wins.',
      bullets: [
        '@layer declares a named layer; rules inside it are grouped for cascade purposes.',
        'Layers are ordered by the order they are first declared, not by selector specificity.',
        'Unlayered styles always beat any layered style, which matters for resets and overrides.',
        'A design system can ship reset, base, components and utilities as separate, reorderable layers.'
      ],
      tags: ['web', 'css', 'frontend']
    },
    cleanText: '## What cascade layers solve\n\nBefore cascade layers, overriding a third-party stylesheet meant either raising selector specificity or reaching for !important, both of which make a codebase harder to reason about over time.\n\n## Declaring a layer\n\nThe @layer rule creates a named layer. Anything declared inside it cascades according to the layer\'s position, not the selector\'s specificity, so a low-specificity rule in a later layer can still win against a highly specific one in an earlier layer.\n\n## Ordering layers explicitly\n\nA bare @layer reset, base, components, utilities; statement fixes the order up front, even before any of those layers have rules in them yet, which keeps the eventual cascade predictable.'
  },
  {
    id: 'n2',
    url: 'https://en.wikipedia.org/wiki/Byzantine_Empire',
    title: 'Byzantine Empire',
    domain: 'en.wikipedia.org',
    capturedAt: ago(0, 3),
    closedAt: ago(0, 3),
    status: 'archived',
    summarySource: 'heuristic',
    isFavorite: false,
    readingTimeMinutes: 12,
    summary: {
      tldr: 'The Byzantine Empire was the continuation of the Roman Empire in its eastern provinces, centered on Constantinople for over a thousand years.',
      bullets: [
        'Constantinople was founded by Constantine I in 330 CE as a new imperial capital.',
        'The empire preserved and transmitted much of classical Greek and Roman scholarship.',
        'Byzantine law, codified under Justinian I, influenced legal systems across Europe.',
        'Constantinople finally fell to the Ottoman Empire in 1453.'
      ],
      tags: ['history', 'research']
    },
    cleanText: 'The Byzantine Empire, also referred to as the Eastern Roman Empire, was the continuation of the Roman Empire centred on Constantinople during Late Antiquity and the Middle Ages.\n\nIt survived the fragmentation and fall of the Western Roman Empire in the 5th century and continued to exist for an additional thousand years until the fall of Constantinople in 1453.\n\nDuring most of its existence, the empire remained one of the most powerful economic, cultural and military forces in the Mediterranean world.'
  },
  {
    id: 'n3',
    url: 'https://arxiv.org/abs/2409.01234',
    title: 'Attention Is All You Need: A Ten-Year Retrospective',
    domain: 'arxiv.org',
    capturedAt: ago(0, 5),
    closedAt: ago(0, 5),
    status: 'archived',
    summarySource: 'gemini-api',
    isFavorite: true,
    readingTimeMinutes: 9,
    summary: {
      tldr: "Ten years after \"Attention Is All You Need\", the transformer architecture still underlies most state-of-the-art language and multimodal models.",
      bullets: [
        'Self-attention lets a model weigh relationships between all tokens in a sequence in parallel.',
        'Removing recurrence made transformers dramatically more parallelizable to train on GPUs.',
        'Scaling laws showed predictable performance gains from larger transformer models and datasets.',
        'Later variants added sparse and linear attention to reduce the quadratic cost of long sequences.'
      ],
      tags: ['ai', 'research', 'machine-learning']
    },
    cleanText: 'The original transformer paper replaced recurrence and convolution with self-attention, letting every position in a sequence attend directly to every other position.\n\nA decade on, the architecture (with many efficiency variants) remains the backbone of most large language and multimodal models.\n\nThis retrospective surveys what changed: sparse attention, mixture-of-experts routing, and much larger context windows, while the core self-attention block stayed remarkably intact.'
  },
  {
    id: 'n4',
    url: 'https://news.ycombinator.com/item?id=41800000',
    title: 'Show HN: A tiny WASM runtime for edge functions',
    domain: 'news.ycombinator.com',
    capturedAt: ago(0, 8),
    closedAt: ago(0, 8),
    status: 'archived',
    summarySource: 'openai-compatible',
    isFavorite: false,
    readingTimeMinutes: 4,
    summary: {
      tldr: 'A minimal WebAssembly runtime aims to start cold in under a millisecond for edge compute platforms.',
      bullets: [
        'The runtime strips down to a WASI-like subset needed for HTTP request handlers.',
        'Cold start time is the metric edge platforms optimize for, not raw throughput.',
        'Commenters compare the approach to existing runtimes like Wasmtime and Wasmer.'
      ],
      tags: ['programming', 'web']
    },
    cleanText: 'A new project posts benchmarks for a stripped-down WebAssembly runtime aimed specifically at edge function platforms, where cold-start latency dominates user-perceived performance.\n\nThe author trimmed the WASI surface down to the handful of syscalls an HTTP handler actually needs, cutting instantiation time substantially compared to general-purpose runtimes.\n\nSeveral commenters ask how it compares to Wasmtime and Wasmer on the same workloads.'
  },
  {
    id: 'n5',
    url: 'https://web.dev/articles/optimize-lcp',
    title: 'Optimizing Largest Contentful Paint in 2026',
    domain: 'web.dev',
    capturedAt: ago(0, 10),
    closedAt: ago(0, 10),
    status: 'archived',
    summarySource: 'prompt-api',
    isFavorite: false,
    readingTimeMinutes: 7,
    summary: {
      tldr: 'A 2026 refresh of Largest Contentful Paint guidance emphasizes resource priority hints and modern image formats.',
      bullets: [
        'Preloading the LCP image with fetchpriority="high" remains the single biggest lever.',
        'Modern image formats like AVIF cut payload size without visibly hurting quality.',
        'Render-blocking CSS above the fold should stay under a small byte budget.',
        'Field data from Chrome UX Report is more representative than lab data alone.'
      ],
      tags: ['web', 'performance', 'frontend']
    },
    cleanText: 'Largest Contentful Paint measures when the biggest visible element finishes rendering, and it usually comes down to how quickly the browser can discover and fetch one hero image or block of text.\n\nThe updated guide recommends preloading the LCP resource explicitly rather than relying on the browser to discover it late in the document.\n\nIt also revisits image format choices, favoring AVIF or WebP over JPEG for the same perceptual quality at a smaller byte size.'
  },
  {
    id: 'n6',
    url: 'https://nodejs.org/en/blog/release/v22.10.0',
    title: 'Node.js 22 LTS Release Notes',
    domain: 'nodejs.org',
    capturedAt: ago(2),
    closedAt: ago(2),
    status: 'archived',
    summarySource: 'heuristic',
    isFavorite: false,
    readingTimeMinutes: 5,
    summary: {
      tldr: 'Node.js 22 moves to Long Term Support with updates to the built-in test runner, permission model and V8 engine.',
      bullets: [
        'The permission model gained new flags for restricting filesystem and network access.',
        'The built-in test runner added snapshot testing support.',
        'V8 was updated, bringing incremental JavaScript language features along with it.'
      ],
      tags: ['programming', 'javascript']
    },
    cleanText: 'Node.js 22 has entered Long Term Support, meaning it now receives security and stability updates on the standard LTS cadence.\n\nThe release notes highlight expanded permission-model flags, snapshot testing in the built-in test runner, and the usual V8 engine bump.\n\nMost existing applications should be able to upgrade without code changes.'
  },
  {
    id: 'n7',
    url: 'https://www.seriouseats.com/sourdough-starter-science',
    title: 'The Science of a Perfect Sourdough Starter',
    domain: 'www.seriouseats.com',
    capturedAt: ago(3),
    status: 'discarded',
    summarySource: 'heuristic',
    isFavorite: false,
    readingTimeMinutes: 8,
    summary: {
      tldr: 'A sourdough starter is a stable culture of wild yeast and lactic acid bacteria that leavens bread without commercial yeast.',
      bullets: [
        'Regular feeding schedules keep the yeast-to-bacteria ratio predictable.',
        'Water temperature and flour type both change how quickly a starter rises.',
        "A starter's rise-and-fall pattern signals when it is ready to leaven a dough.",
        'Discarding part of the starter before each feeding keeps its size manageable.'
      ],
      tags: ['cooking', 'science']
    },
    cleanText: 'A sourdough starter is a small, stable ecosystem: wild yeast produces the gas that leavens the dough, while lactic acid bacteria contribute the tang and help control less friendly microbes.\n\nFeeding it flour and water on a regular schedule keeps that balance predictable, and warmer water speeds fermentation while cooler water slows it down.\n\nWatching how a starter rises and falls after a feeding is the most reliable way to judge when it is active enough to leaven a loaf.'
  },
  {
    id: 'n8',
    url: 'https://www.nomadicmatt.com/travel-guides/japan-travel-guide/kyoto/',
    title: "A Budget Traveler's Guide to Kyoto",
    domain: 'www.nomadicmatt.com',
    capturedAt: ago(5),
    closedAt: ago(5),
    status: 'archived',
    summarySource: 'openai-compatible',
    isFavorite: true,
    readingTimeMinutes: 10,
    summary: {
      tldr: "A budget-minded guide to seeing Kyoto's temples, gardens and food culture without overspending.",
      bullets: [
        'A day pass on the city bus network covers most of the major temple districts.',
        'Many of the most memorable temples, like Fushimi Inari, charge no entrance fee at all.',
        'Visiting popular sites such as Kinkaku-ji early in the morning avoids the largest crowds.',
        'Convenience store and market food make for a very affordable way to eat well.'
      ],
      tags: ['travel']
    },
    cleanText: "Kyoto rewards a slower pace, and a surprising amount of what makes it memorable — its temples, gardens and quiet backstreets — costs little or nothing to see.\n\nA day pass on the city bus network is usually the cheapest way to cover the major temple districts without renting a car.\n\nEating well on a budget just means leaning on convenience stores, market stalls, and set lunch menus rather than tourist-oriented restaurants."
  },
  {
    id: 'n9',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_components',
    title: 'Web Components: Custom Elements v1 Explained',
    domain: 'developer.mozilla.org',
    capturedAt: ago(6),
    closedAt: ago(6),
    status: 'archived',
    summarySource: 'prompt-api',
    isFavorite: false,
    readingTimeMinutes: 6,
    summary: {
      tldr: 'The Custom Elements v1 spec lets developers define new HTML tags with their own lifecycle callbacks.',
      bullets: [
        'connectedCallback and disconnectedCallback run when an element enters or leaves the DOM.',
        'Custom elements can extend built-in elements or start from scratch as autonomous elements.',
        'Shadow DOM gives a custom element encapsulated styles and markup.'
      ],
      tags: ['web', 'javascript', 'frontend']
    },
    cleanText: "Custom Elements v1 lets a page register a new tag name backed by a JavaScript class, complete with its own lifecycle callbacks.\n\nconnectedCallback fires when an instance is inserted into the document, and disconnectedCallback fires when it's removed, which is where most setup and teardown logic lives.\n\nPaired with Shadow DOM, a custom element's internal markup and styles stay isolated from the rest of the page."
  },
  {
    id: 'n10',
    url: 'https://arxiv.org/abs/2501.05678',
    title: 'Diffusion Models for Tabular Data Synthesis',
    domain: 'arxiv.org',
    capturedAt: ago(8),
    closedAt: ago(8),
    status: 'archived',
    summarySource: 'gemini-api',
    isFavorite: false,
    readingTimeMinutes: 11,
    summary: {
      tldr: 'A diffusion-based approach generates synthetic tabular data that preserves column correlations better than GAN baselines.',
      bullets: [
        'Categorical and continuous columns are diffused with separate noise schedules.',
        'Synthetic datasets trained downstream classifiers to within a few points of real-data accuracy.',
        'Privacy evaluation shows lower membership-inference risk than nearest-neighbor baselines.',
        'The method scales to tables with hundreds of columns without a major slowdown.'
      ],
      tags: ['ai', 'research']
    },
    cleanText: 'Synthetic tabular data is useful whenever the real data is too sensitive to share directly, but naive generators often break the correlations between columns that make the data useful in the first place.\n\nThis paper applies separate diffusion schedules to categorical and continuous columns, then reports downstream classifier accuracy close to models trained on the real data.\n\nA membership-inference evaluation suggests the synthetic rows leak less information about individual real records than nearest-neighbor style generators.'
  },
  {
    id: 'n11',
    url: 'https://en.wikipedia.org/wiki/Silk_Road',
    title: 'Silk Road Trade Network',
    domain: 'en.wikipedia.org',
    capturedAt: ago(10),
    status: 'captured',
    closureReason: 'Saved manually; tab left open',
    summarySource: 'heuristic',
    isFavorite: false,
    readingTimeMinutes: 9,
    summary: {
      tldr: 'The Silk Road was a network of trade routes connecting East Asia to the Mediterranean for roughly two thousand years.',
      bullets: [
        'Goods traded included silk, spices, precious metals, and eventually ideas and religions.',
        'The network was never a single road but a shifting set of overland and maritime routes.',
        'Oasis cities like Samarkand grew wealthy as waypoints along the route.'
      ],
      tags: ['history', 'travel']
    },
    cleanText: "The Silk Road refers not to one road but to a shifting network of overland and maritime trade routes linking East Asia, Central Asia, South Asia and the Mediterranean world.\n\nBeyond silk, the routes carried spices, precious metals, and — just as consequentially — religions, scripts and technologies between distant civilizations.\n\nOasis cities such as Samarkand and Bukhara grew wealthy as waypoints where caravans rested and traded."
  },
  {
    id: 'n12',
    url: 'https://news.ycombinator.com/item?id=41755555',
    title: "Ask HN: What's your favorite terminal multiplexer in 2026?",
    domain: 'news.ycombinator.com',
    capturedAt: ago(13),
    closedAt: ago(13),
    status: 'archived',
    summarySource: 'heuristic',
    isFavorite: false,
    readingTimeMinutes: 3,
    summary: {
      tldr: 'An Ask HN thread collects opinions on terminal multiplexers, with tmux and Zellij as the most discussed options.',
      bullets: [
        "Several commenters prefer Zellij's default keybindings over tmux's prefix-key model.",
        'Session persistence across SSH disconnects is the most cited reason to use one at all.',
        'A few replies point out plain detachable shells cover most of the same use case.'
      ],
      tags: ['programming']
    },
    cleanText: 'The thread asks which terminal multiplexer people reach for in 2026, and the top replies split fairly evenly between tmux and the newer Zellij.\n\nZellij fans cite its more discoverable default keybindings, while tmux holdouts point to its maturity and ubiquity on remote servers.\n\nThe most commonly cited reason to use either one at all is keeping a session alive across a dropped SSH connection.'
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedNotes(page) {
  await page.evaluate(async (notes) => {
    const { saveArchivedTab } = await import('/src/storage/db.js');
    for (const note of notes) await saveArchivedTab(note);
  }, NOTES);
}

/**
 * Grants <all_urls> as a required host permission in the TEMP extension copy's manifest.json
 * only (never tests/helpers/test-extension.js or the real manifest.json), so the screenshots
 * don't show the "Enable Tab Extraction" onboarding banner that a fresh install would have.
 */
function grantAllUrlsInTempManifest(extensionPath) {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), '<all_urls>'])];
  // Chrome rejects a permission listed as both required and optional.
  manifest.optional_host_permissions = (manifest.optional_host_permissions || []).filter(p => p !== '<all_urls>');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Writes the side-panel composite wrapper into the TEMP extension copy only (never src/).
 * The left pane is a generic, unbranded, original long-read article (no real publication or
 * organization name) with enough copy to run past the bottom of the 800px frame, the way an
 * actual article page would rather than trailing off into blank white space.
 */
function writeSidePanelWrapper(extensionPath) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 1280px; height: 800px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  body { display: flex; }
  .fake-article { flex: 1; min-width: 0; height: 800px; overflow: hidden; background: #ffffff;
    color: #1f2933; padding: 52px 56px; box-sizing: border-box; }
  .fake-article .kicker { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
  .fake-article h1 { font-size: 29px; line-height: 1.28; margin: 0 0 14px; color: #0f172a; max-width: 640px; }
  .fake-article .dek { font-size: 16px; line-height: 1.5; color: #64748b; margin-bottom: 28px; max-width: 620px; }
  .fake-article p { font-size: 15px; line-height: 1.7; color: #334155; margin: 0 0 16px; max-width: 640px; }
  .fake-article h2 { font-size: 19px; line-height: 1.3; margin: 30px 0 12px; color: #0f172a; max-width: 640px; }
  .fake-article blockquote { margin: 24px 0; padding: 4px 0 4px 20px; border-left: 3px solid #cbd5e1;
    font-size: 17px; line-height: 1.55; color: #1f2933; font-style: italic; max-width: 580px; }
  .panel-frame { width: 400px; flex-shrink: 0; height: 800px; border-left: 1px solid #cbd5e1;
    box-shadow: -6px 0 18px rgba(15, 23, 42, 0.08); }
  iframe { width: 400px; height: 800px; border: 0; display: block; }
</style></head>
<body>
  <article class="fake-article">
    <div class="kicker">Long Read</div>
    <h1>The Slow Return of Urban Rivers</h1>
    <div class="dek">Cities that buried their waterways under streets and parking lots decades ago are now digging them back up, one culvert at a time.</div>
    <p>For most of the twentieth century, a buried stream was considered a solved problem. Culverting a waterway freed up land for roads and buildings and made an unpredictable neighbor easy to ignore. Thousands of small rivers and creeks around the world were routed into concrete pipes and paved over, and within a generation or two, most residents had no idea the water was still running beneath their feet.</p>
    <p>That calculation is now being reversed in a small but growing number of places. Removing the pipe and letting a stream flow in the open again, a process engineers call daylighting, has gone from a fringe idea to a line item in mainstream infrastructure budgets. The reasons are practical as much as sentimental.</p>
    <h2>Daylighting, explained</h2>
    <p>A culverted stream still carries the same volume of water as before, just hidden and constrained. During a heavy storm, a pipe sized for an earlier era's rainfall can back up fast, sending water into basements and streets with nowhere else to go. An open channel, by contrast, can be shaped with a floodplain on either side, giving a storm surge room to spread out instead of pressurizing a fixed tube.</p>
    <p>Daylighting projects typically excavate the old culvert, reconstruct a meandering channel with a mix of stone, gravel and native plantings, and grade the surrounding land so it can flood safely in the rare event that it needs to. The finished result looks less like an engineered fix and more like the creek was simply left alone.</p>
    <blockquote>"We spent decades building water out of view and out of mind. Daylighting is really just admitting the water never left."</blockquote>
    <p>The ecological case is straightforward. A pipe cannot support fish, insects, or the plants that hold a bank together, and it does nothing to cool the surrounding area or recharge groundwater. An open channel, even a short restored stretch running through a few city blocks, can reintroduce shade, slow-moving pools, and the kind of habitat variety that a straight concrete tube never had.</p>
    <p>There is a social dimension too. Long-buried waterways tend to run through neighborhoods that had the least say when the original culverting decisions were made decades ago, often industrial districts or lower-income areas cut off from any nearby park space. Bringing the water back into view usually comes bundled with new public green space along the banks, which is part of why some of the most ambitious daylighting projects have been championed by residents rather than engineers.</p>
    <p>None of this is simple or cheap. Utilities, building foundations, and decades of unrelated construction tend to have been laid directly on top of the old culvert, so a project that sounds like undoing one bad decision often turns into untangling several later ones. Even a modest daylighting project can take years of planning before a single shovel goes into the ground.</p>
    <p>Even so, the projects that have been finished tend to be pointed to as evidence that the approach works, both as flood control and as a quieter kind of civic repair. A creek that residents can sit beside again, rather than only hear rumbling under a manhole cover, has a way of changing how a street feels, long after the construction crews have gone.</p>
  </article>
  <div class="panel-frame"><iframe src="src/app/index.html"></iframe></div>
</body></html>`;
  fs.writeFileSync(path.join(extensionPath, 'store-assets-sidepanel.html'), html);
}

/**
 * Scroll position that frames "Archival Action" cleanly: the card containing it (the product's
 * core setting) sits whole and un-clipped near the top of the frame, about 24px down. The
 * domain lists fall below the fold rather than forcing a mid-radio-button crop at the top.
 */
async function computeOptionsScroll(page) {
  return page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('.setting-label-group label'))
      .find(l => l.textContent.trim() === 'Archival Action');
    const card = label.closest('.settings-card');
    const top = card.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - 24);
  });
}

async function makePromoTile(context) {
  const iconB64 = fs.readFileSync(path.join(REPO_ROOT, 'src/assets/icons/icon-128.png')).toString('base64');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 440px; height: 280px; }
  body { display: flex; align-items: center; justify-content: center; gap: 22px;
    background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  img { width: 96px; height: 96px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05); }
  .copy { max-width: 270px; }
  .name { font-size: 30px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
  .name span { color: #4f46e5; }
  .tagline { font-size: 14px; line-height: 1.5; color: #475569; }
</style></head>
<body>
  <img src="data:image/png;base64,${iconB64}" alt="TabSum">
  <div class="copy">
    <div class="name"><span>Tab</span>Sum</div>
    <div class="tagline">Close the tabs you were never going to read, and keep what was in them.</div>
  </div>
</body></html>`;
  const page = await context.newPage();
  await page.setViewportSize(PROMO);
  await page.setContent(html);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, 'promo-440x280.png') });
  await page.close();
}

async function webmToGif(webmPath, gifPath) {
  const paletteFile = path.join(TMP_ROOT, `${path.basename(gifPath, '.gif')}-palette.png`);
  const filters = 'fps=12,scale=960:-1:flags=lanczos';
  // max_colors=112 (instead of the usual 256) and no dithering: a flat-color UI recording
  // compresses far better without dither noise, keeping the GIF comfortably under 5MB at
  // 12fps/960px wide without any visible banding.
  execFileSync('ffmpeg', ['-y', '-i', webmPath, '-vf', `${filters},palettegen=stats_mode=diff:max_colors=112`, paletteFile], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', webmPath, '-i', paletteFile, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=none`, gifPath], { stdio: 'inherit' });
  fs.rmSync(paletteFile, { force: true });
  fs.rmSync(webmPath, { force: true });
}

async function recordNotebookDemo(context, appUrl) {
  const page = await context.newPage();
  await page.setViewportSize(WIDE);
  await page.goto(appUrl);
  await page.waitForSelector('.tab-card');
  await page.waitForTimeout(700);

  const search = page.locator('#search-input');
  await search.click();
  await search.pressSequentially('css cascade', { delay: 130 });
  await page.waitForTimeout(1200);

  await page.locator('#search-clear-btn').click();
  await page.waitForTimeout(700);

  await page.click('#sidebar-tags [data-tag="frontend"]');
  await page.waitForTimeout(1300);

  await page.click('#clear-filter-btn');
  await page.waitForTimeout(700);

  await page.click('.tab-card[data-id="n1"] .reader-btn');
  await page.waitForFunction(() => document.getElementById('modal-text-content').textContent.includes('cascade layers solve'));
  await page.waitForTimeout(1600);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  await page.click('.tab-card[data-id="n9"] .star-btn');
  await page.waitForTimeout(1400);

  const video = page.video();
  await page.close();
  return video.path();
}

async function recordKeyboardDemo(context, appUrl) {
  const page = await context.newPage();
  await page.setViewportSize(WIDE);
  await page.goto(appUrl);
  await page.waitForSelector('.tab-card');
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(700);

  await page.keyboard.press('j');
  await page.waitForTimeout(650);
  await page.keyboard.press('j');
  await page.waitForTimeout(650);
  await page.keyboard.press('j');
  await page.waitForTimeout(650);
  await page.keyboard.press('k');
  await page.waitForTimeout(900);

  // Stub the round trip so Enter's reopen doesn't try to navigate to a real external site.
  await page.evaluate(() => {
    chrome.runtime.sendMessage = async (msg) => (msg?.type === 'RESTORE_TAB'
      ? { success: true, restoredInPlace: false }
      : { success: true });
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /reopened/i.test(document.getElementById('toast-message')?.textContent || ''));
  await page.waitForTimeout(1300);

  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  await page.locator('#search-input').pressSequentially('node', { delay: 150 });
  await page.waitForTimeout(1100);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  const video = page.video();
  await page.close();
  return video.path();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });

  console.log('Building test extension copy...');
  const EXTENSION_PATH = buildTestExtension();
  grantAllUrlsInTempManifest(EXTENSION_PATH);
  writeSidePanelWrapper(EXTENSION_PATH);

  const baseLaunchOpts = { deviceScaleFactor: 1, viewport: WIDE, ...extensionLaunchOptions(EXTENSION_PATH, ['--no-first-run']) };

  // ---- Pass 1: screenshots + promo tile ----
  let context = await chromium.launchPersistentContext(USER_DATA_DIR, baseLaunchOpts);
  try {
    const background = await waitForServiceWorker(context);
    const extensionId = background.url().split('/')[2];
    const APP_URL = `chrome-extension://${extensionId}/src/app/index.html`;
    const OPTIONS_URL = `chrome-extension://${extensionId}/src/options/index.html`;
    const PANEL_URL = `chrome-extension://${extensionId}/store-assets-sidepanel.html`;
    console.log(`Extension loaded: ${extensionId}`);

    const page = await context.newPage();
    await page.setViewportSize(WIDE);
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');
    await seedNotes(page);
    await page.reload();
    await page.waitForSelector('.tab-card', { timeout: 10000 });
    console.log(`Seeded ${NOTES.length} notes.`);

    // 01: full notebook
    await page.screenshot({ path: path.join(OUT_DIR, '01-notebook.png') });
    console.log('Wrote 01-notebook.png');

    // 02: card expanded / reader view
    await page.click('.tab-card[data-id="n1"] .reader-btn');
    await page.waitForFunction(() => document.getElementById('modal-text-content').textContent.includes('cascade layers solve'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, '02-card-expanded.png') });
    console.log('Wrote 02-card-expanded.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 03: tag filter narrowed (frontend -> n1, n5, n9)
    await page.click('#sidebar-tags [data-tag="frontend"]');
    await page.waitForFunction(() => document.querySelectorAll('#tabs-feed .tab-card').length === 3);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, '03-search-filter.png') });
    console.log('Wrote 03-search-filter.png');
    await page.click('#clear-filter-btn');
    await page.waitForTimeout(200);

    // 05: options, scrolled to frame Archival Action cleanly at the top
    const optionsPage = await context.newPage();
    await optionsPage.setViewportSize(WIDE);
    await optionsPage.goto(OPTIONS_URL);
    await optionsPage.waitForLoadState('domcontentloaded');
    await optionsPage.waitForSelector('#domain-chips .domain-chip');
    const scrollY = await computeOptionsScroll(optionsPage);
    await optionsPage.evaluate((y) => window.scrollTo(0, y), scrollY);
    await optionsPage.waitForTimeout(150);
    await optionsPage.screenshot({ path: path.join(OUT_DIR, '05-options.png') });
    console.log('Wrote 05-options.png');
    await optionsPage.close();

    // 04: side-panel composite (wrapper page + iframe of the app in panel mode)
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => { chrome.tabs.getCurrent = () => Promise.resolve(undefined); });
    await panelPage.setViewportSize(WIDE);
    await panelPage.goto(PANEL_URL);
    await panelPage.waitForSelector('iframe');
    await panelPage.waitForFunction(() => {
      const frame = document.querySelector('iframe');
      return Boolean(frame?.contentDocument?.body?.dataset?.surface === 'panel');
    }, { timeout: 10000 });
    await panelPage.waitForFunction(() => {
      const frame = document.querySelector('iframe');
      return frame?.contentDocument?.querySelectorAll('.tab-card').length > 0;
    }, { timeout: 10000 });
    await panelPage.waitForTimeout(400);
    await panelPage.screenshot({ path: path.join(OUT_DIR, '04-side-panel.png') });
    console.log('Wrote 04-side-panel.png');
    await panelPage.close();

    await makePromoTile(context);
    console.log('Wrote promo-440x280.png');

    await page.close();
  } finally {
    await context.close();
  }

  // ---- Pass 2: demo GIFs (separate context/pages so recordVideo has its own dir) ----
  console.log('Recording demo clips...');
  const videoDir = path.join(TMP_ROOT, 'videos');
  fs.mkdirSync(videoDir, { recursive: true });
  const recordLaunchOpts = { ...baseLaunchOpts, recordVideo: { dir: videoDir, size: WIDE } };
  context = await chromium.launchPersistentContext(USER_DATA_DIR, recordLaunchOpts);
  try {
    const background = await waitForServiceWorker(context);
    const extensionId = background.url().split('/')[2];
    const APP_URL = `chrome-extension://${extensionId}/src/app/index.html`;

    const notebookWebm = await recordNotebookDemo(context, APP_URL);
    console.log('Recorded demo-notebook clip.');
    const keyboardWebm = await recordKeyboardDemo(context, APP_URL);
    console.log('Recorded demo-keyboard clip.');

    await webmToGif(notebookWebm, path.join(OUT_DIR, 'demo-notebook.gif'));
    console.log('Wrote demo-notebook.gif');
    await webmToGif(keyboardWebm, path.join(OUT_DIR, 'demo-keyboard.gif'));
    console.log('Wrote demo-keyboard.gif');
  } finally {
    await context.close();
  }

  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  console.log('\nAll store assets written to', OUT_DIR);
}

main().catch(err => {
  console.error('store_assets.js failed:', err);
  process.exit(1);
});
