/**
 * Automated Verification Tests for Workstream 4 & 5 (Wiki & Modal UX)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { highlightSearch, formatExtractedArticle } from '../src/wiki/wiki.js';

console.log('--- Running Wiki & Modal UX Verification Tests ---');

// Test 1: highlightSearch with standard queries
console.log('Testing highlightSearch basic and case-insensitive matching...');
const text1 = 'Vector databases power high-dimensional semantic search in modern RAG systems.';
const highlighted1 = highlightSearch(text1, 'vector');
assert.ok(highlighted1.includes('<mark class="search-highlight">Vector</mark>'), 'Should highlight "Vector" preserving original case');
assert.ok(!highlighted1.includes('<mark class="search-highlight">vector</mark>'), 'Should preserve title case "Vector"');

// Test 2: highlightSearch with special regex characters
console.log('Testing highlightSearch with special regex characters...');
const text2 = 'C++ and Rust (v1.80) are fast.';
const highlighted2 = highlightSearch(text2, 'C++');
assert.ok(highlighted2.includes('<mark class="search-highlight">C++</mark>'), 'Should safely handle ++ in regex query');

const highlighted3 = highlightSearch(text2, '(v1.80)');
assert.ok(highlighted3.includes('<mark class="search-highlight">(v1.80)</mark>'), 'Should safely handle parentheses and dots in regex query');

// Test 3: highlightSearch XSS safety
console.log('Testing highlightSearch XSS escaping...');
const maliciousText = '<img src=x onerror=alert(1)> and &special "chars"';
const safeHighlighted = highlightSearch(maliciousText, 'special');
assert.ok(!safeHighlighted.includes('<img'), 'Should escape HTML tags');
assert.ok(safeHighlighted.includes('&lt;img'), 'Should have &lt;img');
assert.ok(safeHighlighted.includes('<mark class="search-highlight">special</mark>'), 'Should highlight matching term');

// Test 4: highlightSearch with empty query
console.log('Testing highlightSearch empty query fallback...');
const untouched = highlightSearch('Simple text', '');
assert.strictEqual(untouched, 'Simple text', 'Empty query should return plain escaped string');

// Test 5: formatExtractedArticle paragraphs and headings
console.log('Testing formatExtractedArticle typography formatting...');
const articleRaw = `# Introduction to Antigravity

Antigravity is an advanced agentic framework.
It enables scalable autonomous workflows.

## Architecture & Design

> Autonomous agents operate with tool use and persistence.

### Key Capabilities

Here is another paragraph describing the system in detail.`;

const formattedArticle = formatExtractedArticle(articleRaw);
assert.ok(formattedArticle.includes('<h2>Introduction to Antigravity</h2>'), 'Heading 1 should map to <h2>');
assert.ok(formattedArticle.includes('<h3>Architecture &amp; Design</h3>'), 'Heading 2 should map to <h3>');
assert.ok(formattedArticle.includes('<h4>Key Capabilities</h4>'), 'Heading 3 should map to <h4>');
assert.ok(formattedArticle.includes('<blockquote>Autonomous agents operate with tool use and persistence.</blockquote>'), 'Blockquote should be formatted');
assert.ok(formattedArticle.includes('<p>Antigravity is an advanced agentic framework.<br>It enables scalable autonomous workflows.</p>'), 'Paragraphs should preserve line breaks');

// Test 6: formatExtractedArticle empty text fallback
console.log('Testing formatExtractedArticle empty fallback...');
const emptyArticle = formatExtractedArticle('');
assert.ok(emptyArticle.includes('empty-article-text'), 'Empty article should render empty-article-text paragraph');

// Test 7: Verify src/wiki/index.html markup
console.log('Verifying src/wiki/index.html markup...');
const htmlContent = fs.readFileSync(path.resolve('src/wiki/index.html'), 'utf-8');

assert.ok(htmlContent.includes('<dialog id="reader-dialog" class="reader-dialog" aria-labelledby="modal-title">'), 'index.html must include semantic HTML5 <dialog id="reader-dialog">');
assert.ok(!htmlContent.includes('<div id="reader-modal"'), 'index.html should not have legacy <div id="reader-modal">');
assert.ok(htmlContent.includes('id="wiki-search-clear-btn"'), 'index.html must include wiki-search-clear-btn');
assert.ok(htmlContent.includes('id="modal-copy-btn"'), 'index.html must include modal-copy-btn');
assert.ok(htmlContent.includes('id="modal-close-btn"'), 'index.html must include modal-close-btn');
assert.ok(htmlContent.includes('data-time="favorites"'), 'index.html should include Favorites filter option');

// Test 8: Verify src/wiki/wiki.css rules
console.log('Verifying src/wiki/wiki.css styling rules...');
const cssContent = fs.readFileSync(path.resolve('src/wiki/wiki.css'), 'utf-8');

assert.ok(cssContent.includes('dialog.reader-dialog'), 'wiki.css must have dialog.reader-dialog styling');
assert.ok(cssContent.includes('dialog.reader-dialog::backdrop'), 'wiki.css must have ::backdrop styling');
assert.ok(cssContent.includes('@starting-style'), 'wiki.css must support @starting-style entry animation');
assert.ok(cssContent.includes('.modal-text-content'), 'wiki.css must style .modal-text-content');
assert.ok(cssContent.includes('max-width: 68ch;'), 'wiki.css typography must have max-width: 68ch');
assert.ok(cssContent.includes('.search-highlight'), 'wiki.css must have .search-highlight class');
assert.ok(cssContent.includes('.wiki-card.pending-deletion'), 'wiki.css must have .wiki-card.pending-deletion styling');
assert.ok(cssContent.includes('.wiki-card .delete-btn.is-undo'), 'wiki.css must have .is-undo button styling');
assert.ok(cssContent.includes('.wiki-card.removing'), 'wiki.css must have .wiki-card.removing animation');
assert.ok(cssContent.includes('.star-btn'), 'wiki.css must have .star-btn styling');
assert.ok(cssContent.includes('.toast-undo-btn'), 'wiki.css must have .toast-undo-btn styling');
assert.ok(cssContent.includes('.toast-progress-bar'), 'wiki.css must have .toast-progress-bar countdown styling');

// Test 9: Verify src/options/index.html toggles
console.log('Verifying src/options/index.html markup for new settings...');
const optionsHtml = fs.readFileSync(path.resolve('src/options/index.html'), 'utf-8');
assert.ok(optionsHtml.includes('id="close-sidebar-toggle"'), 'options/index.html must include close-sidebar-toggle');
assert.ok(optionsHtml.includes('id="defer-deletions-toggle"'), 'options/index.html must include defer-deletions-toggle');

// Test 10: Verify src/options/options.js handlers
console.log('Verifying src/options/options.js logic for new settings...');
const optionsJs = fs.readFileSync(path.resolve('src/options/options.js'), 'utf-8');
assert.ok(optionsJs.includes('closeSidebarOnOpenDashboard'), 'options.js must manage closeSidebarOnOpenDashboard');
assert.ok(optionsJs.includes('deferDeletionsUntilClose'), 'options.js must manage deferDeletionsUntilClose');

// Test 11: Verify src/wiki/wiki.js lifecycle listeners
console.log('Verifying src/wiki/wiki.js lifecycle hooks...');
const wikiJs = fs.readFileSync(path.resolve('src/wiki/wiki.js'), 'utf-8');
assert.ok(wikiJs.includes("window.addEventListener('beforeunload'"), 'wiki.js must listen to beforeunload');
assert.ok(wikiJs.includes("window.addEventListener('pagehide'"), 'wiki.js must listen to pagehide');
assert.ok(wikiJs.includes('deferDeletionsUntilClose'), 'wiki.js must check deferDeletionsUntilClose');
assert.ok(wikiJs.includes('updateWikiDeferredToast'), 'wiki.js must define updateWikiDeferredToast');
assert.ok(wikiJs.includes("'Undo All'"), 'wiki.js must support Undo All button');

console.log('--- All Wiki & Modal UX Verification Tests Passed Successfully! ---');
