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
 * Usage: node tests/telemetry_ratio.js [--corpus path] [--floor 0.60]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { classifyClosureSafety } from '../src/shared/closure-policy.js';

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const CORPUS = path.resolve(argOf('--corpus', './tests/fixtures/corpus.txt'));
const CLOSE_RATE_FLOOR = Number(argOf('--floor', '0.60'));
const CONCURRENCY = 5;
const NAV_TIMEOUT_MS = 25000;
const SETTLE_MS = 1500; // let client-side routers paint before reading the DOM

// Real UA: the default headless string gets a different page from some sites,
// and a different page means different telemetry.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const EXTRACTOR = fs.readFileSync(path.resolve('./src/content/in-tab-extractor.js'), 'utf8');

function readCorpus(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function measure(context, url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = resp?.status() ?? 0;
    if (status >= 400) return { url, error: `HTTP ${status}` };
    await page.waitForTimeout(SETTLE_MS);

    // Some sites navigate again after DCL (consent hops, auth bounces), which
    // destroys the execution context mid-eval. One retry after settling covers it.
    let extracted;
    try {
      extracted = await page.evaluate((code) => eval(code), EXTRACTOR);
    } catch (err) {
      if (!/Execution context was destroyed/.test(String(err.message || err))) throw err;
      await page.waitForTimeout(SETTLE_MS);
      extracted = await page.evaluate((code) => eval(code), EXTRACTOR);
    }
    if (!extracted?.success) return { url, error: 'extractor returned no result' };

    // Same bridge the service worker uses (service-worker.js:461): wordCount is a
    // sibling of closureTelemetry, not inside it.
    const safety = classifyClosureSafety({ ...extracted.closureTelemetry, wordCount: extracted.wordCount });
    return {
      url,
      tier: safety.tier,
      reason: safety.reason,
      isDirty: extracted.isDirty,
      dirtyReason: extracted.reason,
      wordCount: extracted.wordCount,
      inputCounts: extracted.closureTelemetry.inputCounts
    };
  } catch (err) {
    return { url, error: String(err.message || err).split('\n')[0].slice(0, 120) };
  } finally {
    await page.close().catch(() => {});
  }
}

function report(results, floor) {
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const close = ok.filter((r) => r.tier === 'safe_to_close');
  const suspend = ok.filter((r) => r.tier === 'suspend_only');
  const closeRate = ok.length ? close.length / ok.length : 0;

  const byReason = new Map();
  for (const r of suspend) byReason.set(r.reason, (byReason.get(r.reason) || 0) + 1);

  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
  const lines = [
    '# Closure Ratio Report',
    '',
    `**Run**: ${new Date().toISOString()}  `,
    `**Corpus**: \`${path.relative(process.cwd(), CORPUS)}\` (${results.length} URLs, ${ok.length} reachable, ${failed.length} failed)  `,
    `**Close-rate floor**: ${(floor * 100).toFixed(0)}%`,
    '',
    '## Tier split',
    '',
    '| Tier | Count | % of reachable |',
    '| :--- | ---: | ---: |',
    `| \`safe_to_close\` | ${close.length} | ${pct(close.length, ok.length)} |`,
    `| \`suspend_only\` | ${suspend.length} | ${pct(suspend.length, ok.length)} |`,
    '',
    `**Close rate: ${pct(close.length, ok.length)}** (debate floor ${(floor * 100).toFixed(0)}%, failure threshold >70% suspend_only)`,
    '',
    '> Tier is the policy verdict only. The shipped hybrid path gates closing further',
    '> on an AI summary (`canCloseWith`), so the real-world close rate is this number',
    '> times the AI-summary hit rate.',
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
      return `| ${r.url} | \`${r.tier}\` | ${r.reason} | ${r.wordCount} | ${counts} | ${r.isDirty ? r.dirtyReason : '—'} |`;
    })
  ];

  if (failed.length) {
    lines.push('', '## Unreachable', '', '| URL | Error |', '| :--- | :--- |',
      ...failed.map((r) => `| ${r.url} | ${r.error} |`));
  }

  return { markdown: lines.join('\n') + '\n', closeRate, ok: ok.length, closeCount: close.length, suspendCount: suspend.length, failed: failed.length };
}

(async () => {
  const urls = readCorpus(CORPUS);
  console.log(`Measuring ${urls.length} URLs (concurrency ${CONCURRENCY})...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ bypassCSP: true, userAgent: UA });
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((u) => measure(context, u)));
    for (const r of settled) {
      console.log(`  ${r.error ? '✗' : r.tier === 'safe_to_close' ? '→ close  ' : '→ suspend'} ${r.url}${r.error ? ` (${r.error})` : ''}`);
    }
    results.push(...settled);
  }
  await browser.close();

  const out = report(results, CLOSE_RATE_FLOOR);
  fs.mkdirSync('./logs', { recursive: true });
  const file = `./logs/closure-ratio-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(file, out.markdown);

  console.log(`\nclose ${out.closeCount} / suspend ${out.suspendCount} / unreachable ${out.failed}`);
  console.log(`Report: ${file}`);

  if (out.ok === 0) {
    console.error('FAIL: no URLs were reachable — nothing was measured.');
    process.exit(1);
  }
  if (out.closeRate < CLOSE_RATE_FLOOR) {
    console.error(`FAIL: close rate ${(out.closeRate * 100).toFixed(1)}% < floor ${(CLOSE_RATE_FLOOR * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log(`close rate ${(out.closeRate * 100).toFixed(1)}% >= ${(CLOSE_RATE_FLOOR * 100).toFixed(0)}% floor  ✓`);
})().catch((err) => {
  console.error(`FAIL: ${err.message || err}`);
  process.exit(1);
});
