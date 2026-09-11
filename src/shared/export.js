/**
 * TabSum - Shared export helpers (Markdown, Obsidian vault, JSON backup) for the
 * wiki dashboard and options page. Keeping this in one place avoids the two pages
 * producing two different, incompatible export formats.
 */

function toIsoDate(tab) {
  try {
    const raw = tab.capturedAt || tab.captured_at;
    const d = raw ? new Date(raw) : new Date();
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// Legacy/imported records can have non-string bullets/tags (numbers, null, etc.)
// from hand-edited JSON or older schema versions — coerce/filter before string ops.
function toSafeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item !== null && item !== undefined)
    .map(item => (typeof item === 'string' ? item : String(item)))
    .map(item => item.trim())
    .filter(Boolean);
}

function getTags(tab) {
  return toSafeStringArray(tab.summary?.tags).map(t => t.replace(/^#/, ''));
}

function getBullets(tab) {
  return toSafeStringArray(tab.summary?.bullets);
}

function getReadingTime(tab) {
  return Number.isFinite(tab.readingTimeMinutes)
    ? tab.readingTimeMinutes
    : (Number.isFinite(tab.reading_time_minutes) ? tab.reading_time_minutes : 1);
}

/**
 * One `##`-per-note section for the combined Markdown export. No YAML frontmatter here —
 * concatenating a frontmatter block per note into a single file produces invalid Markdown
 * (only the first block is recognized by parsers).
 */
export function formatNoteSection(tab) {
  const title = tab.title || 'Untitled Tab';
  const url = tab.url || '';
  const domain = tab.domain || '';
  const readingTime = getReadingTime(tab);
  const capturedAt = toIsoDate(tab);
  const tags = getTags(tab);
  const bullets = getBullets(tab);

  let section = `## [${title}](${url})\n`;
  section += `*Captured: ${new Date(capturedAt).toLocaleDateString()} | Domain: ${domain} | Est. Read: ${readingTime} min*\n\n`;
  section += `**TL;DR**: ${tab.summary?.tldr || 'No overview available.'}\n\n`;
  section += `### Key Takeaways\n`;
  section += bullets.length ? bullets.map(b => `- ${b}`).join('\n') : '- No key takeaways recorded';
  if (tags.length) {
    section += `\n\n**Tags**: ${tags.map(t => `#${t}`).join(' ')}`;
  }
  return section;
}

/**
 * Combined single-file Markdown export: one `##` section per note, no frontmatter.
 * @param {Array<Object>|Object} tabs
 * @returns {string}
 */
export function exportToMarkdown(tabs) {
  const tabList = Array.isArray(tabs) ? tabs : (tabs ? [tabs] : []);
  if (tabList.length === 0) return '';
  const header = `# TabSum Knowledge Wiki Export\n*Exported on ${new Date().toLocaleString()}*\n\n`;
  return header + tabList.map(formatNoteSection).join('\n\n---\n\n');
}

/**
 * Frontmatter + body for one standalone note: an Obsidian vault file, or a single-note
 * clipboard copy. Frontmatter `tags` have no '#' prefix — Obsidian's YAML frontmatter tags
 * must not include '#' (only inline hashtags in the body do).
 * @param {Object} tab
 * @returns {string}
 */
export function formatStandaloneNote(tab) {
  const title = tab.title || 'Untitled Tab';
  const url = tab.url || '';
  const capturedAt = toIsoDate(tab);
  const readingTime = getReadingTime(tab);
  const tags = getTags(tab);
  const tagsFormatted = `[${tags.map(t => (t.includes(' ') ? `"${t}"` : t)).join(', ')}]`;
  const bullets = getBullets(tab);
  const bulletsContent = bullets.length ? bullets.map(b => `- ${b}`).join('\n') : '- No key takeaways recorded';

  return `---
title: ${JSON.stringify(title)}
url: ${JSON.stringify(url)}
captured_at: "${capturedAt}"
reading_time_minutes: ${readingTime}
tags: ${tagsFormatted}
---
# ${title}
> TL;DR: ${tab.summary?.tldr || 'No overview available.'}

## Key Takeaways
${bulletsContent}

*Captured via TabSum*`;
}

/**
 * Full structured JSON backup (includes cleanText when present on the records passed in).
 * @param {Array<Object>|Object} tabs
 * @returns {string}
 */
export function exportToJSON(tabs) {
  const tabList = Array.isArray(tabs) ? tabs : (tabs ? [tabs] : []);
  return JSON.stringify(tabList, null, 2);
}

/**
 * Sanitize a note title into a filesystem-safe filename (no extension).
 */
export function sanitizeFilename(name, maxLength = 100) {
  let clean = String(name || '').replace(/[/\\:*?"<>|]/g, '').trim();
  if (!clean) clean = 'untitled';
  if (clean.length > maxLength) clean = clean.slice(0, maxLength).trim();
  return clean || 'untitled';
}

/**
 * Dedupe a list of filenames (without extension) by suffixing " (2)", " (3)", ... on collision.
 */
export function dedupeFilenames(names) {
  const seenCounts = new Map();
  return names.map(name => {
    const count = seenCounts.get(name) || 0;
    seenCounts.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

// ponytail: minimal STORE-method (uncompressed) ZIP writer with CRC-32 — no deflate,
// no dependency. Fine for a handful of small markdown notes; not a general zip library.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(arr, offset, val) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(arr, offset, val) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
  arr[offset + 2] = (val >>> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

function dosDateTime(date = new Date()) {
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Build a minimal uncompressed (STORE) ZIP archive from {name, content} entries.
 * @param {Array<{name: string, content: string}>} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content } of files) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32LE(localHeader, 0, 0x04034b50);
    writeUint16LE(localHeader, 4, 20);
    writeUint16LE(localHeader, 6, 0);
    writeUint16LE(localHeader, 8, 0); // method 0 = STORE (no compression)
    writeUint16LE(localHeader, 10, dosTime);
    writeUint16LE(localHeader, 12, dosDate);
    writeUint32LE(localHeader, 14, crc);
    writeUint32LE(localHeader, 18, dataBytes.length);
    writeUint32LE(localHeader, 22, dataBytes.length);
    writeUint16LE(localHeader, 26, nameBytes.length);
    writeUint16LE(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32LE(centralHeader, 0, 0x02014b50);
    writeUint16LE(centralHeader, 4, 20);
    writeUint16LE(centralHeader, 6, 20);
    writeUint16LE(centralHeader, 8, 0);
    writeUint16LE(centralHeader, 10, 0);
    writeUint16LE(centralHeader, 12, dosTime);
    writeUint16LE(centralHeader, 14, dosDate);
    writeUint32LE(centralHeader, 16, crc);
    writeUint32LE(centralHeader, 20, dataBytes.length);
    writeUint32LE(centralHeader, 24, dataBytes.length);
    writeUint16LE(centralHeader, 28, nameBytes.length);
    writeUint32LE(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 8, files.length);
  writeUint16LE(eocd, 10, files.length);
  writeUint32LE(eocd, 12, centralSize);
  writeUint32LE(eocd, 16, centralOffset);

  const result = new Uint8Array(centralOffset + centralSize + eocd.length);
  let pos = 0;
  for (const part of localParts) { result.set(part, pos); pos += part.length; }
  for (const part of centralParts) { result.set(part, pos); pos += part.length; }
  result.set(eocd, pos);
  return result;
}

/**
 * Build an Obsidian vault as a ZIP: one .md file per note (frontmatter + body).
 * Filenames are sanitized from the note title and deduped on collision.
 * @param {Array<Object>|Object} tabs
 * @returns {Uint8Array}
 */
export function exportToObsidianZip(tabs) {
  const tabList = Array.isArray(tabs) ? tabs : (tabs ? [tabs] : []);
  const baseNames = dedupeFilenames(tabList.map(tab => sanitizeFilename(tab.title || tab.url)));
  const files = tabList.map((tab, i) => ({
    name: `${baseNames[i]}.md`,
    content: formatStandaloneNote(tab)
  }));
  return buildZip(files);
}

/**
 * Trigger a browser download for text or binary content. Revokes the object URL after a
 * short delay rather than synchronously, since revoking immediately can cancel the download
 * in some browsers before it has a chance to start.
 * @param {string|Uint8Array} content
 * @param {string} filename
 * @param {string} [mimeType]
 * @returns {boolean}
 */
export function triggerDownload(content, filename, mimeType = 'text/plain') {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (err) {
    console.error('Download trigger failed:', err);
    return false;
  }
}
