/**
 * Automated verification tests for TabSum core logic
 */

import assert from 'node:assert';
import { summarizeWithHeuristics } from '../src/ai/summarizer.js';
import { extractDomain, DEFAULT_SETTINGS } from '../src/storage/db.js';

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
assert.ok(summary.tags.length > 0, 'Tags should exist');
assert.ok(summary.tags.includes('Engineering') || summary.tags.includes('Dev'), 'Should detect engineering tag');

console.log('Summary Output:\n', JSON.stringify(summary, null, 2));
console.log('✓ Heuristic summarizer passed');

// Test 3: Settings Defaults
console.log('Testing settings defaults...');
assert.strictEqual(DEFAULT_SETTINGS.timeoutMinutes, 60);
assert.strictEqual(DEFAULT_SETTINGS.archiveMode, 'discard');
assert.strictEqual(DEFAULT_SETTINGS.maxStoredItems, 1000);
assert.strictEqual(DEFAULT_SETTINGS.autoPruneEnabled, true);
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

// Test 5: Knowledge Wiki Export (Markdown, Obsidian, JSON)
import './test_export.js';

// Test 6: Storage Quota Management & LRU Pruning
import './test_storage_quota.js';

console.log('--- All Unit Verification Tests Passed Successfully! ---');


