/**
 * Automated Unit Tests for Knowledge Wiki Export (Markdown, Obsidian, JSON)
 */

import assert from 'node:assert';
import {
  exportToMarkdown,
  exportToJSON,
  formatSingleNote,
  triggerDownload
} from '../src/wiki/wiki.js';

console.log('--- Running TabSum Knowledge Wiki Export Unit Tests ---');

const mockTab1 = {
  id: 'tab-001',
  url: 'https://example.com/vector-db',
  title: 'Modern Vector Databases & Semantic Retrieval',
  domain: 'example.com',
  capturedAt: 1726034500000,
  readingTimeMinutes: 4,
  summary: {
    tldr: 'Vector databases power high-dimensional semantic search in modern RAG systems.',
    bullets: [
      'HNSW graphs achieve logarithmic nearest-neighbor search latency',
      'Hybrid BM25 and dense vector search yields optimal recall'
    ],
    tags: ['AI', 'Databases', 'Search']
  }
};

const mockTab2 = {
  id: 'tab-002',
  url: 'https://dev.to/performance',
  title: 'Chrome V8 Optimization Guide',
  domain: 'dev.to',
  capturedAt: 1726038100000,
  readingTimeMinutes: 2,
  summary: {
    tldr: 'Practical tips for optimizing JavaScript execution in V8.',
    bullets: [
      'Avoid hidden class transitions by initializing object fields in constructor'
    ],
    tags: ['#JavaScript', '#WebDev'] // includes pre-existing hash symbols
  }
};

// Test 1: Standard Markdown Export
console.log('Testing exportToMarkdown with format = "markdown"...');
const mdOutput = exportToMarkdown([mockTab1], 'markdown');

assert.ok(mdOutput.startsWith('---\n'), 'Should start with YAML frontmatter delimiter');
assert.ok(mdOutput.includes('title: "Modern Vector Databases & Semantic Retrieval"'), 'Frontmatter should include title in quotes');
assert.ok(mdOutput.includes('url: "https://example.com/vector-db"'), 'Frontmatter should include url in quotes');
assert.ok(mdOutput.includes('captured_at: "2024-09-11T06:01:40.000Z"'), 'Frontmatter should include valid ISO captured_at');
assert.ok(mdOutput.includes('reading_time_minutes: 4'), 'Frontmatter should include numeric reading_time_minutes');
assert.ok(mdOutput.includes('tags: [AI, Databases, Search]'), 'Frontmatter should format tags without # in standard markdown');
assert.ok(mdOutput.includes('---\n# Modern Vector Databases & Semantic Retrieval'), 'Should end frontmatter and contain header');
assert.ok(mdOutput.includes('> TL;DR: Vector databases power high-dimensional semantic search in modern RAG systems.'), 'Should contain TL;DR blockquote');
assert.ok(mdOutput.includes('## Key Takeaways'), 'Should contain Key Takeaways section');
assert.ok(mdOutput.includes('- HNSW graphs achieve logarithmic nearest-neighbor search latency'), 'Should contain bullet 1');
assert.ok(mdOutput.includes('- Hybrid BM25 and dense vector search yields optimal recall'), 'Should contain bullet 2');
assert.ok(mdOutput.endsWith('*Captured via TabSum*'), 'Should conclude with TabSum attribution');
console.log('✓ Standard Markdown export format verified');

// Test 2: Obsidian Export Format
console.log('Testing exportToMarkdown with format = "obsidian"...');
const obsidianOutput = exportToMarkdown([mockTab1], 'obsidian');

assert.ok(obsidianOutput.startsWith('---\n'), 'Should start with YAML frontmatter delimiter');
assert.ok(obsidianOutput.includes('tags: ["#AI", "#Databases", "#Search"]'), 'Obsidian tags should be formatted with # and quoted for valid YAML');
assert.ok(obsidianOutput.includes('title: "Modern Vector Databases & Semantic Retrieval"'));
assert.ok(obsidianOutput.includes('# Modern Vector Databases & Semantic Retrieval'));
assert.ok(obsidianOutput.includes('*Captured via TabSum*'));
console.log('✓ Obsidian export format verified');

// Test 3: Tag Normalization (prevent duplicate ## hashes)
console.log('Testing tag normalization for tags with pre-existing #...');
const normMd = exportToMarkdown([mockTab2], 'markdown');
const normObs = exportToMarkdown([mockTab2], 'obsidian');

assert.ok(normMd.includes('tags: [JavaScript, WebDev]'), 'Should strip existing hash in standard markdown tags');
assert.ok(normObs.includes('tags: ["#JavaScript", "#WebDev"]'), 'Should have single hash in Obsidian tags');
assert.ok(!normObs.includes('##JavaScript'), 'Should not double-hash tags');
console.log('✓ Tag normalization verified');

// Test 4: Consolidated Multi-Tab Export
console.log('Testing consolidated multi-tab export...');
const multiMd = exportToMarkdown([mockTab1, mockTab2], 'markdown');
assert.ok(multiMd.includes('# Modern Vector Databases & Semantic Retrieval'));
assert.ok(multiMd.includes('# Chrome V8 Optimization Guide'));
assert.strictEqual((multiMd.match(/\*Captured via TabSum\*/g) || []).length, 2, 'Should have 2 attribution footers');
console.log('✓ Multi-tab consolidated export verified');

// Test 5: Fallback & Edge Cases
console.log('Testing sparse/missing fields fallback...');
const sparseTab = {
  title: 'Sparse Article',
  url: 'https://example.com/sparse'
};
const sparseMd = exportToMarkdown(sparseTab, 'markdown');
assert.ok(sparseMd.includes('title: "Sparse Article"'));
assert.ok(sparseMd.includes('reading_time_minutes: 1'), 'Should default reading time to 1');
assert.ok(sparseMd.includes('tags: []'), 'Empty tags should be []');
assert.ok(sparseMd.includes('> TL;DR: No overview available.'), 'Default TL;DR fallback');
assert.ok(sparseMd.includes('- No key takeaways recorded'), 'Default takeaways fallback');

const emptyOutput = exportToMarkdown([]);
assert.strictEqual(emptyOutput, '', 'Empty tabs array should return empty string');
console.log('✓ Sparse and empty tab fallbacks verified');

// Test 6: JSON Backup Export
console.log('Testing exportToJSON...');
const tabsList = [mockTab1, mockTab2];
const jsonOutput = exportToJSON(tabsList);
assert.doesNotThrow(() => JSON.parse(jsonOutput), 'Output must be valid JSON');
const parsed = JSON.parse(jsonOutput);
assert.strictEqual(parsed.length, 2);
assert.strictEqual(parsed[0].title, mockTab1.title);
assert.strictEqual(parsed[1].title, mockTab2.title);
assert.deepStrictEqual(parsed[0].summary.tags, ['AI', 'Databases', 'Search']);
console.log('✓ JSON backup export verified');

// Test 7: triggerDownload environment guard
console.log('Testing triggerDownload in non-browser environment...');
const downloadResult = triggerDownload('test', 'test.md', 'text/markdown');
assert.strictEqual(downloadResult, false, 'Should gracefully return false without throwing in Node');
console.log('✓ triggerDownload environment guard verified');

console.log('--- All Knowledge Wiki Export Unit Tests Passed Successfully! ---');
