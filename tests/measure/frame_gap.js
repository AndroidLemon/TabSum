#!/usr/bin/env node
/**
 * Measurement script (Step 2 follow-up): how big is the cross-origin iframe
 * gap in the zero-loss guard, and would a fail-closed "substantial iframes >
 * injected subframes" rule cost any expect:close corpus page?
 *
 * Read-only measurement. Does not touch src/. Writes nothing but stdout;
 * the caller pastes stdout into logs/measure-frames-discard-2026-09-14.md.
 *
 * Permission model: this script builds its OWN throwaway extension copy
 * (like tests/helpers/test-extension.js, but not using that helper, so the
 * shared test manifest is left alone) and grants host_permissions for only
 * the TOP-LEVEL origin of each corpus URL - one pattern per URL, computed
 * with the same originPatternFor() the extension itself uses. This is
 * "per-origin" mode: it simulates a user who has granted TabSum access to
 * the site they're reading, which is the realistic steady state (nobody
 * grants <all_urls> by default; optional_host_permissions in manifest.json
 * has to be requested). It deliberately does NOT grant permission for any
 * cross-origin child frame's own origin, because that's the gap under test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { originPatternFor, MIN_COUNTABLE_FRAME_AREA } from '../../src/shared/closure-policy.js';
import { extensionLaunchOptions } from '../helpers/test-extension.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const argCorpus = process.argv.slice(2).indexOf('--corpus');
const CORPUS = argCorpus === -1
  ? path.resolve(REPO_ROOT, 'tests/fixtures/corpus.txt')
  : path.resolve(process.argv[2 + argCorpus + 1]);
const NAV_TIMEOUT_MS = 25000;
const SETTLE_MS = 1500;

function readCorpus(file) {
  const out = [];
  let expect = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const marker = line.match(/^#\s*expect:\s*(close|suspend)\s*$/i);
    if (marker) { expect = marker[1].toLowerCase() === 'close' ? 'close' : 'suspend'; continue; }
    if (line.startsWith('#')) continue;
    if (!expect) continue;
    out.push({ url: line, expect });
  }
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Builds a throwaway extension copy whose static host_permissions are
 * exactly the top-level origins of the given URLs - i.e. per-origin grants,
 * never <all_urls>. Returns the temp dir.
 */
function buildPerOriginExtension(urls) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabsum-framegap-'));
  copyDir(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
  const patterns = new Set();
  for (const u of urls) {
    const p = originPatternFor(u);
    if (p) patterns.add(p);
  }
  manifest.host_permissions = [...(manifest.host_permissions || []), ...patterns];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, grantedOrigins: [...patterns] };
}

async function measureOne(context, background, entry) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = resp?.status() ?? 0;
    if (status >= 400) return { ...entry, error: `HTTP ${status}` };
    await page.waitForTimeout(SETTLE_MS);

    const finalUrl = page.url();
    const topOriginPattern = originPatternFor(finalUrl);

    // Substantial iframes in the MAIN frame, and how many are cross-origin to
    // the top frame, using the same protocol+hostname rule as originPatternFor.
    const iframeInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe')).map((f) => {
        const r = f.getBoundingClientRect();
        return { area: Math.max(0, r.width) * Math.max(0, r.height), src: f.src || '' };
      });
    });
    let substantialIframes = 0;
    let crossOriginSubstantial = 0;
    for (const f of iframeInfo) {
      if (f.area < MIN_COUNTABLE_FRAME_AREA) continue;
      substantialIframes++;
      let childOriginPattern = null;
      try {
        if (f.src) {
          const childUrl = new URL(f.src, finalUrl);
          if (childUrl.protocol === 'http:' || childUrl.protocol === 'https:') {
            childOriginPattern = originPatternFor(childUrl.href);
          }
        }
      } catch { /* non-http(s) frames such as about:blank and javascript: inherit the parent origin; unparseable src falls through to the same null. */ }
      if (childOriginPattern && childOriginPattern !== topOriginPattern) crossOriginSubstantial++;
    }

    // Real executeScript({ allFrames: true }) via the background page, exactly
    // the shape service-worker.js uses at processTabArchival. Also pull back
    // each injected frame's own url/frameArea (in-tab-extractor.js reports
    // both) so we can cross-check the parent-side iframe scan above against
    // what actually got injected, instead of trusting only a frame count.
    let frameResultsReturned = null;
    let injectedFrames = null;
    let execError = null;
    try {
      const out = await background.evaluate(async (targetUrl) => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((t) => t.url === targetUrl);
        if (!target) return { error: 'tab not found in chrome.tabs.query' };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: target.id, allFrames: true },
            files: ['src/content/in-tab-extractor.js']
          });
          return {
            count: results.length,
            frames: results.map((r) => ({
              frameId: r.frameId,
              url: r.result && r.result.url,
              frameArea: r.result && r.result.frameArea
            }))
          };
        } catch (err) {
          return { error: String(err && err.message || err) };
        }
      }, finalUrl);
      if (out.error) execError = out.error;
      else { frameResultsReturned = out.count; injectedFrames = out.frames; }
    } catch (err) {
      execError = String(err && err.message || err);
    }

    let injectedCrossOrigin = null;
    if (injectedFrames) {
      injectedCrossOrigin = injectedFrames.filter((f) => {
        if (f.frameId === 0 || !f.url) return false;
        let p = null;
        try { p = originPatternFor(f.url); } catch { /* unparseable */ }
        return p && p !== topOriginPattern;
      }).length;
    }

    return {
      ...entry,
      finalUrl,
      substantialIframes,
      crossOriginSubstantial,
      frameResultsReturned,
      injectedFrames,
      injectedCrossOrigin,
      execError
    };
  } catch (err) {
    return { ...entry, error: String(err.message || err).split('\n')[0].slice(0, 140) };
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  const urls = readCorpus(CORPUS);
  const { dir: extensionPath, grantedOrigins } = buildPerOriginExtension(urls.map((u) => u.url));
  console.log(`Built per-origin test extension at ${extensionPath}`);
  console.log(`Granted ${grantedOrigins.length} static host_permissions (one per corpus top-level origin), no <all_urls>.`);

  const userDataDir = path.resolve(REPO_ROOT, 'tests/.playwright_user_data_framegap');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir,
    extensionLaunchOptions(extensionPath, ['--no-first-run']));
  try {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    console.log(`Extension loaded: ${background.url()}\n`);

    const results = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(batch.map((u) => measureOne(context, background, u)));
      for (const r of settled) {
        const mark = r.error ? '✗' : '✓';
        console.log(`  ${mark} [${r.expect}] ${r.url}` +
          (r.error ? ` (${r.error})` : ` substantial=${r.substantialIframes} crossOrigin=${r.crossOriginSubstantial} frameResults=${r.frameResultsReturned} injectedCrossOrigin=${r.injectedCrossOrigin}${r.execError ? ` execError=${r.execError}` : ''}`));
        if (r.injectedFrames && r.injectedFrames.length > 1) {
          for (const f of r.injectedFrames) console.log(`       frame ${f.frameId}: ${f.url} (area ${f.frameArea})`);
        }
      }
      results.push(...settled);
    }

    const ok = results.filter((r) => !r.error);
    console.log('\n=== Table: substantial iframes / cross-origin / frame results ===');
    console.log('URL | expect | substantial iframes | of which cross-origin | frame results returned | injected subframes');
    for (const r of ok) {
      const injectedSubframes = r.frameResultsReturned === null ? 'n/a' : Math.max(0, r.frameResultsReturned - 1);
      console.log(`${r.url} | ${r.expect} | ${r.substantialIframes} | ${r.crossOriginSubstantial} | ${r.frameResultsReturned ?? 'n/a (execError: ' + r.execError + ')'} | ${injectedSubframes}`);
    }

    const pagesWithCrossOriginSubstantial = ok.filter((r) => r.crossOriginSubstantial > 0);
    console.log(`\nPages (reachable, ${ok.length} of ${urls.length}) with >=1 substantial cross-origin iframe: ${pagesWithCrossOriginSubstantial.length}`);
    for (const r of pagesWithCrossOriginSubstantial) console.log(`  - [${r.expect}] ${r.url} (substantial=${r.substantialIframes}, crossOrigin=${r.crossOriginSubstantial})`);

    // Fail-closed simulation: would "suspend when substantial iframes > injected subframes"
    // have suspended any expect:close page?
    const expectClose = ok.filter((r) => r.expect === 'close');
    const wouldHaveSuspended = expectClose.filter((r) => {
      const injected = r.frameResultsReturned === null ? 0 : Math.max(0, r.frameResultsReturned - 1);
      return r.substantialIframes > injected;
    });
    console.log(`\nFail-closed rule "substantial iframes > injected subframes" would have suspended ${wouldHaveSuspended.length} of ${expectClose.length} reachable expect:close pages:`);
    for (const r of wouldHaveSuspended) console.log(`  - ${r.url} (substantial=${r.substantialIframes}, injected=${r.frameResultsReturned === null ? 0 : r.frameResultsReturned - 1})`);

    console.log('\nDone.');
  } finally {
    await context.close().catch(() => {});
  }
})().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
