/**
 * Automated verification tests for TabSum core logic
 */

import assert from 'node:assert';
import { summarizeWithHeuristics, summarizeContent, normalizeSummary, excerpt } from '../src/ai/summarizer.js';
import { extractDomain, DEFAULT_SETTINGS } from '../src/storage/db.js';
import { withTimeout } from '../src/shared/with-timeout.js';

console.log('--- Running TabSum Core Verification Tests ---');

// Test 1: Domain Extraction
console.log('Testing domain extraction...');
assert.strictEqual(extractDomain('https://www.google.com/search?q=test'), 'google.com');
assert.strictEqual(extractDomain('https://subdomain.github.io/repo/page.html'), 'subdomain.github.io');
assert.strictEqual(extractDomain('http://localhost:3000'), 'localhost');
assert.strictEqual(extractDomain('invalid-url'), '');
console.log('✓ Domain extraction passed');

// Test 2: Heuristic Summarizer
console.log('Testing heuristic summarizer...');
const sampleArticle = {
  title: 'Exploring WebAssembly and Native Browser Performance',
  domain: 'techblog.com',
  meta: {
    description: 'A deep dive into how WebAssembly enables near-native execution speed in modern web applications.'
  },
  cleanText: `
    WebAssembly is revolutionizing modern web development by bringing high-performance bytecode execution to client browsers.
    Importantly, WebAssembly allows developers to compile languages like C, C++, and Rust directly into portable modules that run alongside JavaScript.
    Key takeaway is that computational workloads such as video rendering, physics simulations, and local machine learning models can achieve near-native performance.
    Furthermore, security in WebAssembly is maintained through an isolated linear memory sandbox.
    In conclusion, WebAssembly does not replace JavaScript, but rather complements it for CPU-intensive browser operations.
  `
};

const summary = summarizeWithHeuristics(sampleArticle);

assert.ok(summary.tldr, 'TL;DR should exist');
assert.ok(summary.bullets.length > 0, 'Bullets should exist');
assert.deepStrictEqual(summary.tags, [], 'Heuristic summaries carry no tags; only AI tiers tag');
const heuristicOnly = await summarizeContent(sampleArticle, { aiProvider: 'heuristic' });
assert.deepStrictEqual(heuristicOnly.tags, [], 'Without an AI tier summarizeContent emits no tags');
assert.strictEqual('heuristicTags' in heuristicOnly, false, 'Trial tagger output no longer rides on the summary');

console.log('Summary Output:\n', JSON.stringify(summary, null, 2));
console.log('✓ Heuristic summarizer passed');

// Test 3: Settings Defaults
console.log('Testing settings defaults...');
assert.strictEqual(DEFAULT_SETTINGS.timeoutMinutes, 60);
assert.strictEqual(DEFAULT_SETTINGS.archiveMode, 'hybrid');
assert.strictEqual(DEFAULT_SETTINGS.closeRequiresAiSummary, true);
assert.strictEqual(DEFAULT_SETTINGS.ignorePinnedTabs, true);
assert.strictEqual(DEFAULT_SETTINGS.fadeUnopenedDays, 30);
assert.strictEqual(DEFAULT_SETTINGS.fadeReopenedDays, 7);
assert.ok(DEFAULT_SETTINGS.excludedDomains.includes('docs.google.com'));
assert.ok(DEFAULT_SETTINGS.excludedDomains.includes('mail.google.com'));
console.log('✓ Settings defaults passed');

// Test 4: Manifest V3 Commands Configuration
console.log('Testing manifest.json commands configuration...');
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.ok(manifest.commands, 'Manifest must declare commands');
assert.ok(manifest.commands._execute_action, '_execute_action command must be declared');
assert.strictEqual(manifest.commands._execute_action.suggested_key?.default, 'Ctrl+Shift+S');
assert.strictEqual(manifest.commands._execute_action.suggested_key?.mac, 'Command+Shift+S');

assert.ok(manifest.commands.archive_active_tab, 'archive_active_tab command must be declared');
assert.strictEqual(manifest.commands.archive_active_tab.suggested_key?.default, 'Ctrl+Shift+E');
assert.strictEqual(manifest.commands.archive_active_tab.suggested_key?.mac, 'Command+Shift+E');
console.log('✓ Manifest commands configuration passed');

// Test 5: normalizeSummary validation
console.log('Testing normalizeSummary...');
assert.deepStrictEqual(
  normalizeSummary(null),
  { tldr: '', bullets: [], tags: [] },
  'Non-object input should normalize to empty shape'
);

const messyRaw = {
  tldr: '  A concise overview.  ',
  bullets: ['Real bullet one', 42, null, '  Real bullet two  ', undefined, 'Bullet three', 'Bullet four', 'Bullet five', 'Bullet six (should be dropped)'],
  tags: ['#AI', ' Engineering ', 'engineering', '#Security', 123, '']
};
const normalized = normalizeSummary(messyRaw);
assert.strictEqual(normalized.tldr, 'A concise overview.', 'tldr should be trimmed');
assert.strictEqual(normalized.bullets.length, 5, 'Bullets should be capped at 5');
assert.deepStrictEqual(normalized.bullets.slice(0, 2), ['Real bullet one', 'Real bullet two'], 'Non-string/empty bullets should be dropped, strings trimmed');
assert.strictEqual(normalized.tags.length, 3, 'Duplicate "engineering" should be dropped, distinct tags kept (capped at 4)');
assert.deepStrictEqual(normalized.tags, ['AI', 'Engineering', 'Security'], 'Leading # should be stripped and dedupe should keep first casing');
assert.ok(!normalized.tags.some(t => t.startsWith('#')), 'No tag should retain a leading #');
console.log('✓ normalizeSummary passed');

// Test 6: Low-confidence pages must not emit junk bullets
console.log('Testing low-confidence summary bullets...');
const lowConfidenceSummary = await summarizeContent({
  title: 'Quick Link',
  domain: 'example.com',
  cleanText: 'Short.',
  isLowConfidence: true,
  meta: {}
});
assert.deepStrictEqual(lowConfidenceSummary.bullets, [], 'Low-confidence pages should have empty bullets, not placeholder junk');
assert.ok(lowConfidenceSummary.tldr, 'Low-confidence pages should still have a tldr');
assert.strictEqual(lowConfidenceSummary.source, 'heuristic', 'Summaries report which tier wrote them');
console.log('✓ Low-confidence bullets passed');

console.log('Testing block-aware excerpt...');
const nav = Array.from({ length: 12 }, (_, i) => `Nav item ${i}`);
const heading = 'The Actual Article Heading';
const paragraph = 'Real prose sentence that carries the article. '.repeat(7); // 329 chars
const chromeThenArticle = [...nav, heading, paragraph, 'Closing remark.'].join('\n\n');
assert.ok(excerpt(chromeThenArticle, 6000).startsWith(heading), 'Excerpt starts at the heading before the first real paragraph');
assert.ok(!excerpt(chromeThenArticle, 6000).includes('Nav item'), 'Nav fragments ahead of the article are dropped');
const allShort = Array.from({ length: 30 }, (_, i) => `Story title number ${i} on the front page`).join('\n\n');
assert.ok(excerpt(allShort, 6000).startsWith('Story title number 0'), 'With no real paragraph (HN front page) the excerpt starts at block 0');
assert.ok(excerpt(chromeThenArticle, 400).length <= 400, 'Excerpt never exceeds maxChars');
assert.strictEqual(excerpt('x'.repeat(7000), 6000).length, 6000, 'A single oversized block is hard-sliced to maxChars');
assert.strictEqual(excerpt('Heading\n\n' + 'y'.repeat(6500), 6000).length, 6000, 'A heading followed by one oversized block keeps the body, hard-sliced, instead of dropping it');
console.log('✓ Block-aware excerpt passed');

console.log('Testing withTimeout...');
await assert.rejects(withTimeout(new Promise(() => {}), 10), /timed out/, 'A hung promise must reject with a timeout error');
assert.strictEqual(await withTimeout(Promise.resolve(1), 10), 1, 'A settled promise passes its value through');
console.log('✓ withTimeout passed');

// Test 8: In-tab extractor title separator regex (honest regex-only test;
// the extractor stays a self-contained IIFE injected by chrome.scripting)
console.log('Testing in-tab extractor title separator regex...');
const extractorSrc = fs.readFileSync(new URL('../src/content/in-tab-extractor.js', import.meta.url), 'utf8');
const regexMatch = extractorSrc.match(/const TITLE_SEPARATOR_REGEX = (\/.*\/);/);
assert.ok(regexMatch, 'TITLE_SEPARATOR_REGEX constant must exist in in-tab-extractor.js');
// eslint-disable-next-line no-eval
const TITLE_SEPARATOR_REGEX = eval(regexMatch[1]);

function applyTitleSeparator(rawTitle) {
  const match = rawTitle.match(TITLE_SEPARATOR_REGEX);
  if (match) {
    const remainder = rawTitle.slice(0, match.index).trim();
    if (remainder.length >= 3) return remainder;
  }
  return rawTitle;
}

assert.strictEqual(
  applyTitleSeparator('Understanding self-driving cars'),
  'Understanding self-driving cars',
  'Hyphenated words must not be truncated'
);
assert.strictEqual(
  applyTitleSeparator('Rust Ownership - Rust Blog'),
  'Rust Ownership',
  'Trailing " - Site Name" suffix must be stripped'
);
console.log('✓ In-tab extractor title separator regex passed');

// Test 9: Knowledge Wiki Export (Markdown, Obsidian, JSON)
import './test_export.js';

// Test 10: Storage layer (IndexedDB)
import './test_storage.js';

// Test 11: Multi-Attribute Sorting
import { runSortingTests } from './test_sorting.js';
await runSortingTests();

// Test 12: Wiki & Modal UX (Highlighting, Typography, Dialog Markup)
import './test_closure_policy.js';

import './test_app_unit.js';

// Test 13: Local / OpenAI-compatible summarization tier
import './test_local_llm.js';

console.log('--- All Unit Verification Tests Passed Successfully! ---');


