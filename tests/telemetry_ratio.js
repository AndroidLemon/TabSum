#!/usr/bin/env node
/**
 * Closure-ratio telemetry.
 *
 * Answers the question parked in logs/debate-closure-policy-20260911.md:215 —
 * under normal browsing, what share of candidate tabs fall into `suspend_only`
 * because of the coarse path/hash/search rules? The debate's terms: >70%
 * suspend_only means the auto-close thesis fails in practice; >60% close rate
 * means the coarse rules are harmless safety margin and tuning them is
 * bike-shedding.
 *
 * Visits every URL in tests/fixtures/corpus.txt, runs the REAL extractor and the
 * REAL policy against each, and writes a report to logs/.
 *
 * ponytail: no extension is loaded. in-tab-extractor.js is a self-contained IIFE
 * with no chrome.* calls, so page.evaluate(eval) returns identical telemetry
 * (same trick as tests/test_hybrid_mode.js:198). bypassCSP mirrors the isolated
 * world the real executeScript injection gets, which page CSP does not govern.
 *
 * Usage: node tests/telemetry_ratio.js [--corpus path] [--floor 0.80]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { classifyClosureSafety, mergeFrameExtractions } from '../src/shared/closure-policy.js';
import { readCorpus } from './helpers/test-extension.js';

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const CORPUS = path.resolve(argOf('--corpus', './tests/fixtures/corpus.txt'));
// 0.80 against a measured 85.7% (30 of 35) after EXTRACTION_PLAN.md Step 3,
// holding the same two-pages-of-drift tolerance (ADR 0001). Before that, 0.77
// against 82.9%: that threshold moved because the METRIC changed,
// not because the policy got worse: recall now scores what actually ships
// (safe_to_close AND not dirty), and pkg.go.dev — tiered closeable but reporting
// an unsaved textarea on every load — stopped counting as a close it never was.
// Corpus URLs are bot-blocked headless (403/429/503) and the reachable set shifts
// run to run, so the denominator itself moves. The leak gate below is the hard
// one, and it has no tolerance. Floor stays 0.80 against a measured 91.4%
// (32/35, 2026-09-15, logs/baseline-followups1.md): the gap is wider than two
// pages now; tighten to 0.86 only after three consecutive runs agree.
const CLOSE_RATE_FLOOR = Number(argOf('--floor', '0.80'));
const CONCURRENCY = 5;
const NAV_TIMEOUT_MS = 25000;
const SETTLE_MS = 1500; // let client-side routers paint before reading the DOM

// Real UA: the default headless string gets a different page from some sites,
// and a different page means different telemetry.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const EXTRACTOR = fs.readFileSync(path.resolve('./src/content/in-tab-extractor.js'), 'utf8');

// `# expect: close` / `# expect: suspend` markers (parsed by the shared
// readCorpus) set a running label that applies to every URL beneath them;
// mapped here to the tier names classifyClosureSafety returns.
const TIER_FOR_EXPECT = { close: 'safe_to_close', suspend: 'suspend_only' };

async function measure(context, { url, expect }) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = resp?.status() ?? 0;
    if (status >= 400) return { url, expect, error: `HTTP ${status}` };
    await page.waitForTimeout(SETTLE_MS);

    // Run the extractor in every frame and merge, mirroring the shipped
    // executeScript({ allFrames: true }) path. Measuring only the top frame
    // would miss iframe-hosted editors the real extension now sees.
    const runAllFrames = async () => {
      const frames = page.frames();
      const out = [];
      for (const [i, f] of frames.entries()) {
        try {
          out.push({ frameId: f === page.mainFrame() ? 0 : i, result: await f.evaluate((code) => eval(code), EXTRACTOR) });
        } catch { /* cross-origin or detached frame: the extension can inject there, Playwright can't */ }
      }
      return out;
    };

    // Some sites navigate again after DCL (consent hops, auth bounces), which
    // destroys the execution context mid-eval. One retry after settling covers it.
    let extracted;
    try {
      extracted = mergeFrameExtractions(await runAllFrames());
    } catch (err) {
      if (!/Execution context was destroyed/.test(String(err.message || err))) throw err;
      await page.waitForTimeout(SETTLE_MS);
      extracted = mergeFrameExtractions(await runAllFrames());
    }
    if (!extracted?.success) return { url, expect, error: 'extractor returned no result' };

    // Same bridge the service worker uses (service-worker.js:461): wordCount is a
    // sibling of closureTelemetry, not inside it.
    const safety = classifyClosureSafety({ ...extracted.closureTelemetry, wordCount: extracted.wordCount });

    // bodyWords: what the MAIN frame's body actually holds, independent of the
    // extractor's own block selection — the recall denominator. A separate
    // page.evaluate (not part of the extractor run above) using the same
    // tokenising rule as wordCount (in-tab-extractor.js:303) so the two are
    // comparable.
    let bodyWords = null;
    try {
      bodyWords = await page.mainFrame().evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return text.trim().split(/\s+/).filter(Boolean).length;
      });
    } catch { /* detached frame or navigation mid-measure: leave bodyWords null */ }

    const recall = bodyWords ? extracted.wordCount / bodyWords : null;

    return {
      url,
      expect,
      tier: safety.tier,
      reason: safety.reason,
      isDirty: extracted.isDirty,
      dirtyReason: extracted.reason,
      wordCount: extracted.wordCount,
      bodyWords,
      recall,
      inputCounts: extracted.closureTelemetry.inputCounts
    };
  } catch (err) {
    return { url, expect, error: String(err.message || err).split('\n')[0].slice(0, 120) };
  } finally {
    await page.close().catch(() => {});
  }
}

function report(results, floor) {
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const close = ok.filter((r) => r.tier === 'safe_to_close');
  const suspend = ok.filter((r) => r.tier === 'suspend_only');

  const wantClose = ok.filter((r) => r.expect === 'safe_to_close');
  const wantSuspend = ok.filter((r) => r.expect === 'suspend_only');
  // Measure what SHIPS, not just the tier. processTabArchival aborts on isDirty
  // long before the tier is consulted, so a dirty page tiered safe_to_close is
  // never actually closed. Scoring it as a close overstated recall and invented
  // leaks that production could not produce.
  const wouldClose = (r) => r.tier === 'safe_to_close' && !r.isDirty;
  // Leaks are the gate: a tool that would really be closed is data loss.
  const leaks = wantSuspend.filter(wouldClose);
  const missed = wantClose.filter((r) => !wouldClose(r));
  // A must-suspend page that never loaded proves nothing. If bot-blocking takes
  // out the dangerous half of the corpus, "0 leaks" is vacuous, so say so.
  const unreachableSuspend = failed.filter((r) => r.expect === 'suspend_only');
  // Recall over the pages that SHOULD close — unlike a raw ratio, adding more
  // docs to the corpus can't inflate it.
  const closeRate = wantClose.length ? (wantClose.length - missed.length) / wantClose.length : 0;

  const byReason = new Map();
  for (const r of suspend) byReason.set(r.reason, (byReason.get(r.reason) || 0) + 1);

  // Extraction recall: extracted words vs. what the body actually holds.
  // 25% is a reporting aid to flag rows for attention, not a gate — see
  // EXTRACTION_PLAN.md Step 1. Sorted ascending so the worst recovery leads.
  const RECALL_FLOOR = 0.25;
  const recallRows = ok.slice().sort((a, b) => {
    const ra = a.recall === null ? Infinity : a.recall;
    const rb = b.recall === null ? Infinity : b.recall;
    return ra - rb;
  });
  const lowRecall = ok.filter((r) => r.recall !== null && r.recall < RECALL_FLOOR);

  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
  const lines = [
    '# Closure Ratio Report',
    '',
    `**Run**: ${new Date().toISOString()}  `,
    `**Corpus**: \`${path.relative(process.cwd(), CORPUS)}\` (${results.length} URLs, ${ok.length} reachable, ${failed.length} failed)  `,
    `**Close-rate floor**: ${(floor * 100).toFixed(0)}%`,
    '',
    '## Gate',
    '',
    '| Metric | Value | Requirement |',
    '| :--- | ---: | :--- |',
    `| **Must-suspend leaks** | **${leaks.length}** | must be 0 — a leak is data loss |`,
    `| Close recall (of ${wantClose.length} expect:close) | ${pct(wantClose.length - missed.length, wantClose.length)} | >= ${(floor * 100).toFixed(0)}% |`,
    `| Must-suspend pages measured | ${wantSuspend.length} of ${wantSuspend.length + unreachableSuspend.length} | the leak gate only sees these |`,
    '',
    '## Tier split (all reachable, for continuity with the baseline)',
    '',
    '| Tier | Count | % of reachable |',
    '| :--- | ---: | ---: |',
    `| \`safe_to_close\` | ${close.length} | ${pct(close.length, ok.length)} |`,
    `| \`suspend_only\` | ${suspend.length} | ${pct(suspend.length, ok.length)} |`,
    '',
    '> Tier is the policy verdict only. The shipped hybrid path gates closing further',
    '> on an AI summary (`canCloseWith`), so the real-world close rate is this number',
    '> times the AI-summary hit rate.',
    '',
    ...(leaks.length ? ['## ⚠️ Must-suspend pages classified closeable', '',
      '| URL | Reason it was allowed through |', '| :--- | :--- |',
      ...leaks.map((r) => `| ${r.url} | ${r.reason} |`), ''] : []),
    ...(missed.length ? ['## Reading pages still held open', '',
      '| URL | Rule that caught it | Words |', '| :--- | :--- | ---: |',
      ...missed.map((r) => `| ${r.url} | ${r.reason} | ${r.wordCount} |`), ''] : []),
    '## Extraction recall',
    '',
    `25% is a reporting aid to flag rows below for attention, not a gate — see EXTRACTION_PLAN.md Step 1.`,
    '',
    '| URL | Extracted words | Body words | Recall |',
    '| :--- | ---: | ---: | ---: |',
    ...recallRows.map((r) => {
      const recallPct = r.recall === null ? 'n/a' : `${(r.recall * 100).toFixed(1)}%`;
      const mark = r.recall !== null && r.recall < RECALL_FLOOR ? ' ⚠️' : '';
      return `| ${r.url}${mark} | ${r.wordCount} | ${r.bodyWords ?? 'n/a'} | ${recallPct} |`;
    }),
    '',
    '## Why tabs were held back',
    '',
    '| Rule that caught it | Count |',
    '| :--- | ---: |',
    ...[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `| ${reason} | ${n} |`),
    '',
    '## Per-URL',
    '',
    '| URL | Tier | Reason | Words | Inputs (ta/sel/pw/app/other) | Dirty |',
    '| :--- | :--- | :--- | ---: | :--- | :--- |',
    ...ok.map((r) => {
      const c = r.inputCounts || {};
      const counts = `${c.textareas || 0}/${c.selects || 0}/${c.passwords || 0}/${c.appContainers || 0}/${c.otherInputs || 0}`;
      const mark = r.tier === r.expect ? '' : (r.expect === 'suspend_only' ? ' ⚠️' : ' ·');
      return `| ${r.url}${mark} | \`${r.tier}\` | ${r.reason} | ${r.wordCount} | ${counts} | ${r.isDirty ? r.dirtyReason : '—'} |`;
    })
  ];

  if (failed.length) {
    lines.push('', '## Unreachable', '', '| URL | Error |', '| :--- | :--- |',
      ...failed.map((r) => `| ${r.url} | ${r.error} |`));
  }

  return { markdown: lines.join('\n') + '\n', closeRate, ok: ok.length, closeCount: close.length,
           suspendCount: suspend.length, failed: failed.length,
           leaks: leaks.length, missed: missed.length, wantClose: wantClose.length,
           wantSuspend: wantSuspend.length, unreachableSuspend: unreachableSuspend.length,
           lowRecallUrls: lowRecall.map((r) => r.url) };
}

(async () => {
  const urls = readCorpus(CORPUS).map(({ url, expect }) => ({ url, expect: TIER_FOR_EXPECT[expect] }));
  console.log(`Measuring ${urls.length} URLs (concurrency ${CONCURRENCY})...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ bypassCSP: true, userAgent: UA });
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((u) => measure(context, u)));
    for (const r of settled) {
      const bad = !r.error && (r.tier === 'safe_to_close' && !r.isDirty ? 'safe_to_close' : 'suspend_only') !== r.expect;
      const mark = r.error ? '✗' : bad && r.expect === 'suspend_only' ? '⚠ LEAK  ' : bad ? '· held   ' : r.tier === 'safe_to_close' ? '→ close  ' : '→ suspend';
      console.log(`  ${mark} ${r.url}${r.error ? ` (${r.error})` : ''}`);
    }
    results.push(...settled);
  }
  await browser.close();

  const out = report(results, CLOSE_RATE_FLOOR);
  fs.mkdirSync('./logs', { recursive: true });
  const file = `./logs/closure-ratio-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(file, out.markdown);

  console.log(`\nclose ${out.closeCount} / suspend ${out.suspendCount} / unreachable ${out.failed}`);
  console.log(`must-suspend leaks: ${out.leaks}/${out.wantSuspend} measured   reading pages held open: ${out.missed}/${out.wantClose}`);
  if (out.unreachableSuspend > 0) {
    console.log(`note: ${out.unreachableSuspend} must-suspend page(s) never loaded — the leak gate did not see them.`);
  }
  console.log(`Report: ${file}`);
  console.log(`extraction recall < 25% (reporting aid, not a gate): ${out.lowRecallUrls.length} page(s)` +
    (out.lowRecallUrls.length ? ` — ${out.lowRecallUrls.join(', ')}` : ''));

  if (out.ok === 0) {
    console.error('FAIL: no URLs were reachable — nothing was measured.');
    process.exit(1);
  }
  // Leaks gate first: closing a tool is data loss, and no close rate buys it back.
  if (out.leaks > 0) {
    console.error(`FAIL: ${out.leaks} must-suspend page(s) classified safe_to_close — see the report.`);
    process.exit(1);
  }
  if (out.closeRate < CLOSE_RATE_FLOOR) {
    console.error(`FAIL: close recall ${(out.closeRate * 100).toFixed(1)}% < floor ${(CLOSE_RATE_FLOOR * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log(`0 leaks, close recall ${(out.closeRate * 100).toFixed(1)}% >= ${(CLOSE_RATE_FLOOR * 100).toFixed(0)}% floor  ✓`);
})().catch((err) => {
  console.error(`FAIL: ${err.message || err}`);
  process.exit(1);
});
