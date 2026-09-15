/**
 * TabSum - Shared HTML helpers for extension pages (side panel, wiki, options).
 */

import { fadeChipLabel } from './fade.js';

/** "Fades in Nd" chip, or nothing when this note should not show one. */
export function fadeChipHtml(tab, settings, sortBy) {
  const label = fadeChipLabel(tab, settings, sortBy);
  return label ? `<span class="fade-chip">${label}</span>` : '';
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// String-based on purpose: the textContent->innerHTML trick does not escape quotes,
// which matters because we interpolate page-controlled titles into attributes.
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

/**
 * Escapes text and wraps case-insensitive matches of query in <mark class="search-highlight">.
 */
export function highlightSearch(text, query) {
  if (text === null || text === undefined || text === '') return '';
  if (!query || typeof query !== 'string' || !query.trim()) return escapeHtml(text);
  const trimmed = query.trim();
  const regex = new RegExp(`(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return String(text).split(regex).map(part =>
    part.toLowerCase() === trimmed.toLowerCase()
      ? `<mark class="search-highlight">${escapeHtml(part)}</mark>`
      : escapeHtml(part)
  ).join('');
}

/**
 * Favicon served from Chrome's local favicon cache (requires the "favicon" permission).
 * No network request to the site or to a third-party favicon service.
 */
export function faviconUrl(pageUrl, size = 32) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl || '')}&size=${size}`);
}
