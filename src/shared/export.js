/**
 * TabSum - Shared export helpers (Markdown, Obsidian vault, JSON backup) for the
 * wiki dashboard and options page. Keeping this in one place avoids the two pages
 * producing two different, incompatible export formats.
 */

function toIsoDate(tab) {
  const d = new Date(tab.capturedAt || Date.now());
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Legacy/imported records can have non-string bullets/tags (numbers, null, etc.)
// from hand-edited JSON or older schema versions — coerce/filter before string ops.
function toSafeStringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : [];
}

function getTags(tab) {
  return toSafeStringArray(tab.summary?.tags).map(t => t.replace(/^#+\s*/, '')).filter(Boolean);
}

function getBullets(tab) {
  return toSafeStringArray(tab.summary?.bullets);
}

function getReadingTime(tab) {
  return Number.isFinite(tab.readingTimeMinutes) ? tab.readingTimeMinutes : 1;
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

  // Page-controlled text: escape what would end the link early ("[PDF] ..." titles, parens in URLs)
  const label = title.replace(/[\\[\]]/g, '\\$&');
  const dest = url.replace(/[\\()]/g, '\\$&').replace(/ /g, '%20');
  let section = `## [${label}](${dest})\n`;
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
 * @param {Array<Object>} tabs
 * @returns {string}
 */
export function exportToMarkdown(tabs) {
  if (tabs.length === 0) return '';
  const header = `# TabSum Knowledge Wiki Export\n*Exported on ${new Date().toLocaleString()}*\n\n`;
  return header + tabs.map(formatNoteSection).join('\n\n---\n\n');
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
  // JSON strings are valid YAML scalars, so any tag text round-trips
  const tagsFormatted = `[${tags.map(t => JSON.stringify(t)).join(', ')}]`;
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
 * @param {Array<Object>} tabs
 * @returns {string}
 */
export function exportToJSON(tabs) {
  return JSON.stringify(tabs, null, 2);
}

/**
 * Sanitize a note title into a filesystem-safe filename (no extension).
 */
export function sanitizeFilename(name, maxLength = 100) {
  return (String(name || '').replace(/[/\\:*?"<>|]/g, '').trim() || 'untitled').slice(0, maxLength).trim() || 'untitled';
}

/**
 * Dedupe a list of filenames (without extension) by suffixing " (2)", " (3)", ... on collision.
 */
export function dedupeFilenames(names) {
  const used = new Set(); // lowercased: Obsidian vaults often live on case-insensitive filesystems
  return names.map(name => {
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
    used.add(candidate.toLowerCase());
    return candidate;
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

function dosDateTime() {
  const date = new Date();
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
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // bit 11: names are UTF-8
    local.setUint16(8, 0, true); // method 0 = STORE (no compression)
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true);
    local.setUint32(22, dataBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true); // bit 11: names are UTF-8
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dataBytes.length, true);
    central.setUint32(24, dataBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);

  const result = new Uint8Array(centralOffset + centralSize + eocd.length);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, eocd]) { result.set(part, pos); pos += part.length; }
  return result;
}

/**
 * Build an Obsidian vault as a ZIP: one .md file per note (frontmatter + body).
 * Filenames are sanitized from the note title and deduped on collision.
 * @param {Array<Object>} tabs
 * @returns {Uint8Array}
 */
export function exportToObsidianZip(tabs) {
  const baseNames = dedupeFilenames(tabs.map(tab => sanitizeFilename(tab.title || tab.url)));
  const files = tabs.map((tab, i) => ({
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
  if (typeof document === 'undefined') return false;
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
