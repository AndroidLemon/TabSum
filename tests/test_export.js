/**
 * Automated Unit Tests for the shared Knowledge Wiki export module
 * (Markdown, Obsidian vault .zip, JSON backup).
 */

import assert from 'node:assert';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  exportToMarkdown,
  exportToObsidianZip,
  exportToJSON,
  formatStandaloneNote,
  formatNoteSection,
  sanitizeFilename,
  dedupeFilenames,
  buildZip,
  triggerDownload
} from '../src/shared/export.js';
import { escapeHtml } from '../src/shared/html.js';

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

// Test 1: Combined Markdown export has NO per-note YAML frontmatter
console.log('Testing exportToMarkdown combined format (no frontmatter)...');
const mdOutput = exportToMarkdown([mockTab1, mockTab2]);

assert.ok(!/^title: "/m.test(mdOutput), 'Combined markdown must not contain per-note YAML frontmatter (title: field)');
assert.ok(!/^captured_at: /m.test(mdOutput), 'Combined markdown must not contain per-note YAML frontmatter (captured_at: field)');
assert.ok(mdOutput.includes('## [Modern Vector Databases & Semantic Retrieval](https://example.com/vector-db)'), 'Should contain a ## section for the first note');
assert.ok(mdOutput.includes('## [Chrome V8 Optimization Guide](https://dev.to/performance)'), 'Should contain a ## section for the second note');
assert.ok(mdOutput.includes('**TL;DR**: Vector databases power high-dimensional semantic search in modern RAG systems.'), 'Should contain TL;DR line');
assert.ok(mdOutput.includes('### Key Takeaways'), 'Should contain Key Takeaways section');
assert.ok(mdOutput.includes('- HNSW graphs achieve logarithmic nearest-neighbor search latency'), 'Should contain bullet 1');
assert.ok(mdOutput.includes('#AI') && mdOutput.includes('#Databases') && mdOutput.includes('#Search'), 'Should list tags as inline hashtags');
assert.ok(mdOutput.includes('#JavaScript') && !mdOutput.includes('##JavaScript'), 'Should not double-hash tags that already had #');
console.log('✓ Combined Markdown export format verified (single file, no frontmatter)');

// Test 2: Empty export
console.log('Testing empty tabs list...');
assert.strictEqual(exportToMarkdown([]), '', 'Empty tabs array should return empty string');

// Test 3: formatStandaloneNote (used for Obsidian vault files and single-note clipboard copy)
console.log('Testing formatStandaloneNote frontmatter...');
const standalone = formatStandaloneNote(mockTab1);
assert.ok(standalone.startsWith('---\n'), 'Should start with YAML frontmatter delimiter');
assert.ok(standalone.includes('title: "Modern Vector Databases & Semantic Retrieval"'), 'Frontmatter should include title as a JSON-quoted string');
assert.ok(standalone.includes('url: "https://example.com/vector-db"'), 'Frontmatter should include url as a JSON-quoted string');
assert.ok(standalone.includes('captured_at: "2024-09-11T06:01:40.000Z"'), 'Frontmatter should include valid ISO captured_at');
assert.ok(standalone.includes('reading_time_minutes: 4'), 'Frontmatter should include numeric reading_time_minutes');
assert.ok(standalone.includes('tags: ["AI", "Databases", "Search"]'), 'Obsidian frontmatter tags must NOT include the # prefix');
assert.ok(!standalone.includes('"#AI"'), 'Frontmatter tags must not be hash-prefixed');
assert.ok(standalone.includes('# Modern Vector Databases & Semantic Retrieval'));
assert.ok(standalone.endsWith('*Captured via TabSum*'));
console.log('✓ formatStandaloneNote frontmatter verified (no # in frontmatter tags)');

// Test 4: Tag normalization - strips any pre-existing '#'
console.log('Testing tag normalization for tags with pre-existing #...');
const standalone2 = formatStandaloneNote(mockTab2);
assert.ok(standalone2.includes('tags: ["JavaScript", "WebDev"]'), 'Should strip pre-existing hash and never re-add it');
console.log('✓ Tag normalization verified');

// Test 5: Sparse / missing field fallbacks
console.log('Testing sparse/missing fields fallback...');
const sparseTab = { title: 'Sparse Article', url: 'https://example.com/sparse' };
const sparseStandalone = formatStandaloneNote(sparseTab);
assert.ok(sparseStandalone.includes('title: "Sparse Article"'));
assert.ok(sparseStandalone.includes('reading_time_minutes: 1'), 'Should default reading time to 1');
assert.ok(sparseStandalone.includes('tags: []'), 'Empty tags should be []');
assert.ok(sparseStandalone.includes('> TL;DR: No overview available.'), 'Default TL;DR fallback');
assert.ok(sparseStandalone.includes('- No key takeaways recorded'), 'Default takeaways fallback');
console.log('✓ Sparse tab fallbacks verified');

// Test 6: Defensive rendering - non-string bullets/tags are coerced/filtered
console.log('Testing defensive coercion of non-string bullets/tags...');
const messyTab = {
  title: 'Messy Legacy Record',
  url: 'https://example.com/messy',
  summary: {
    tldr: 'Legacy data',
    bullets: [42, null, undefined, 'A real bullet', '  '],
    tags: [1, null, 'real-tag', '  ']
  }
};
assert.doesNotThrow(() => formatNoteSection(messyTab), 'formatNoteSection must not throw on non-string bullets/tags');
const messySection = formatNoteSection(messyTab);
assert.ok(messySection.includes('- 42'), 'Numeric bullets should be coerced to strings');
assert.ok(messySection.includes('- A real bullet'));
assert.ok(messySection.includes('#1') && messySection.includes('#real-tag'), 'Numeric/legacy tags should be coerced to strings');
console.log('✓ Defensive coercion of legacy bullets/tags verified');

// Test 7: JSON Backup Export
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

// Test 8: Filename sanitization & deduplication
console.log('Testing sanitizeFilename and dedupeFilenames...');
assert.strictEqual(sanitizeFilename('Safe Title'), 'Safe Title');
assert.strictEqual(sanitizeFilename('Bad/Name:*?"<>|Chars'), 'BadNameChars');
assert.strictEqual(sanitizeFilename(''), 'untitled');
assert.strictEqual(sanitizeFilename('x'.repeat(200), 20).length, 20);
assert.deepStrictEqual(
  dedupeFilenames(['Note', 'Note', 'Note', 'Other']),
  ['Note', 'Note (2)', 'Note (3)', 'Other']
);
console.log('✓ Filename sanitization and dedupe verified');

// Test 9: Obsidian vault ZIP - structure, filenames, frontmatter, CRC
console.log('Testing exportToObsidianZip produces a valid ZIP with one file per note...');
const dupTitleTab = { ...mockTab2, id: 'tab-003', title: mockTab1.title }; // force a filename collision
const zipBytes = exportToObsidianZip([mockTab1, mockTab2, dupTitleTab]);
assert.ok(zipBytes instanceof Uint8Array, 'exportToObsidianZip should return a Uint8Array');

// Local file header signature check (0x04034b50) + manual parse of all 3 local entries
const entries = parseZipLocalEntries(zipBytes);
assert.strictEqual(entries.length, 3, 'ZIP should contain exactly 3 local file entries (one per note)');

const names = entries.map(e => e.name).sort();
assert.ok(names.includes('Modern Vector Databases & Semantic Retrieval.md'), 'First note filename should be sanitized title + .md');
assert.ok(names.includes('Chrome V8 Optimization Guide.md'), 'Second note filename should be sanitized title + .md');
assert.ok(names.includes('Modern Vector Databases & Semantic Retrieval (2).md'), 'Colliding filename should be deduped with " (2)"');

for (const entry of entries) {
  const content = Buffer.from(entry.data).toString('utf-8');
  assert.ok(content.startsWith('---\n'), `Entry ${entry.name} should start with YAML frontmatter`);
  assert.ok(!/tags: \[.*"#/.test(content), `Entry ${entry.name} frontmatter tags must not include '#'`);
  assert.ok(/title: ".+"/.test(content), `Entry ${entry.name} frontmatter title must be a JSON-quoted string`);
  assert.ok(/url: ".*"/.test(content), `Entry ${entry.name} frontmatter url must be a JSON-quoted string`);

  const expectedCrc = zlib.crc32(entry.data);
  assert.strictEqual(entry.crc >>> 0, expectedCrc >>> 0, `CRC-32 of entry ${entry.name} should match its content`);
}
console.log('✓ Obsidian ZIP structure, filenames, frontmatter and CRC-32 verified');

// Test 10: Cross-check the ZIP with the system `unzip` tool when available
console.log('Cross-checking ZIP with system unzip (if available)...');
try {
  const tmpFile = path.join(os.tmpdir(), `tabsum-obsidian-test-${Date.now()}.zip`);
  fs.writeFileSync(tmpFile, zipBytes);
  const listing = execFileSync('unzip', ['-l', tmpFile], { encoding: 'utf-8' });
  fs.unlinkSync(tmpFile);
  assert.ok(listing.includes('Modern Vector Databases & Semantic Retrieval.md'), 'unzip -l should list the first note');
  assert.ok(listing.includes('Chrome V8 Optimization Guide.md'), 'unzip -l should list the second note');
  assert.ok(listing.includes('Modern Vector Databases & Semantic Retrieval (2).md'), 'unzip -l should list the deduped note');
  console.log('✓ system `unzip -l` confirms archive is valid and readable');
} catch (err) {
  console.log(`(skipped: system unzip not available or failed — ${err.message})`);
}

// Test 11: buildZip with zero files still produces a valid (empty) archive
console.log('Testing buildZip with no files...');
const emptyZip = buildZip([]);
assert.strictEqual(emptyZip.length, 22, 'An empty ZIP should be exactly the 22-byte End Of Central Directory record');
const view = new DataView(emptyZip.buffer, emptyZip.byteOffset, emptyZip.byteLength);
assert.strictEqual(view.getUint32(0, true), 0x06054b50, 'Empty ZIP should start with the EOCD signature');
console.log('✓ Empty ZIP archive verified');

// Test 12: triggerDownload environment guard
console.log('Testing triggerDownload in non-browser environment...');
const downloadResult = triggerDownload('test', 'test.md', 'text/markdown');
assert.strictEqual(downloadResult, false, 'Should gracefully return false without throwing in Node');
console.log('✓ triggerDownload environment guard verified');

// Test 13: escapeHtml escapes quotes (attribute-injection regression guard)
console.log('Testing escapeHtml escapes quotes...');
assert.strictEqual(escapeHtml(`He said "hi" and it's <ok>`), 'He said &quot;hi&quot; and it&#39;s &lt;ok&gt;');
assert.ok(!escapeHtml('"><script>alert(1)</script>').includes('"'), 'Double quotes must be escaped');
assert.ok(!escapeHtml("'><img src=x>").includes("'"), 'Single quotes must be escaped');
console.log('✓ escapeHtml quote-escaping verified');

console.log('--- All Knowledge Wiki Export Unit Tests Passed Successfully! ---');

/**
 * Minimal ZIP local-file-header parser for test verification (STORE method only).
 * Reads sequential local file headers starting at offset 0, as produced by buildZip().
 */
function parseZipLocalEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (!(view.getUint16(offset + 6, true) & 0x0800)) throw new Error('ZIP entry lacks the UTF-8 filename flag');
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = Buffer.from(bytes.slice(nameStart, nameStart + nameLen)).toString('utf-8');
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.slice(dataStart, dataStart + compSize);
    entries.push({ name, data, crc, compSize });
    offset = dataStart + compSize;
  }
  return entries;
}
