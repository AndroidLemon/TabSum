/**
 * TabSum - Shared HTML helpers for extension pages (side panel, wiki, options).
 */

import { getExpiry } from '../storage/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Fades in Nd" chip for notes within 3 days of fading (every fading note when
 * sorted by expiring-soon). Empty for starred / never-fading notes.
 */
export function fadeChipHtml(tab, settings, sortBy) {
  const expiry = settings ? getExpiry(tab, settings) : null;
  if (expiry === null) return '';
  const daysLeft = (expiry - Date.now()) / DAY_MS;
  if (sortBy !== 'expiring-soon' && daysLeft > 3) return '';
  const label = daysLeft < 1 ? 'Fades today' : `Fades in ${Math.ceil(daysLeft)}d`;
  return `<span class="fade-chip">${label}</span>`;
}

// String-based on purpose: the textContent->innerHTML trick does not escape quotes,
// which matters because we interpolate page-controlled titles into attributes.
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
