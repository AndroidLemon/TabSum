/**
 * TabSum - IndexedDB Storage & Local Settings Management
 */

const DB_NAME = 'TabSumDB';
const DB_VERSION = 2;
const STORE_NAME = 'archived_tabs';
const TEXT_STORE = 'tab_text'; // { id, cleanText } kept apart so list/stat queries never deserialize page text
const MAX_TEXT_CHARS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('domain', 'domain', { unique: false });
          store.createIndex('capturedAt', 'capturedAt', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        // ponytail: no users yet, so no data migrations; write one when a schema change ships post-launch
        if (!db.objectStoreNames.contains(TEXT_STORE)) {
          db.createObjectStore(TEXT_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * Validate that a URL strictly starts with http:// or https://
 */
function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\//i.test(url.trim());
}

/**
 * Keep only the summary fields the UI renders, as strings (summaries come from LLMs / the page).
 */
function sanitizeSummary(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const strings = (arr) => (Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  return {
    tldr: typeof s.tldr === 'string' ? s.tldr : '',
    bullets: strings(s.bullets),
    tags: strings(s.tags).map(t => t.trim().replace(/^#+/, '')).filter(Boolean)
  };
}

/**
 * Local midnight `daysAgo` days back, in ms.
 */
function startOfDay(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/**
 * Settle a transaction as a promise resolving to getResult() on commit.
 */
function onTxDone(tx, resolve, reject, getResult) {
  tx.oncomplete = () => resolve(getResult());
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
}

/**
 * Save an archived tab record into IndexedDB.
 * Dedupes on URL: an existing non-deleted record with the same URL is updated in place
 * (keeping its id, isFavorite and pinned).
 * @param {Object} tabData
 */
export async function saveArchivedTab(tabData) {
  const db = await getDB();

  // Scheme validation: strictly allow only http: and https: protocols
  const safeUrl = isValidHttpUrl(tabData.url) ? tabData.url.trim() : '';
  const safeFavicon = isValidHttpUrl(tabData.favIconUrl) ? tabData.favIconUrl.trim() : '';
  const cleanText = typeof tabData.cleanText === 'string' ? tabData.cleanText.slice(0, MAX_TEXT_CHARS) : '';

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let record = null;

    const write = (existing) => {
      record = {
        id: existing?.id || tabData.id || crypto.randomUUID(),
        url: safeUrl,
        // JSON import feeds arbitrary values here; the UI assumes these types
        title: (typeof tabData.title === 'string' && tabData.title) || 'Untitled Tab',
        domain: (typeof tabData.domain === 'string' && tabData.domain) || extractDomain(safeUrl),
        favIconUrl: safeFavicon,
        capturedAt: tabData.capturedAt || Date.now(),
        lastActiveAt: tabData.lastActiveAt || Date.now(),
        readingTimeMinutes: Math.max(1, Math.round(Number(tabData.readingTimeMinutes)) || 1),
        summary: sanitizeSummary(tabData.summary),
        summarySource: tabData.summarySource || 'heuristic', // 'gemini-api' | 'prompt-api' | 'heuristic'
        closedAt: tabData.closedAt || null, // set only when TabSum itself closed the tab
        wordCount: tabData.wordCount || 0,
        // 'discarded' (suspended) | 'archived' (closed) | 'restored' (reopened) |
        // 'captured' (summary saved, tab still open: manual archive or Chrome refused to close/suspend)
        status: tabData.status || 'archived',
        closureTier: tabData.closureTier || 'suspend_only',
        closureReason: tabData.closureReason || '',
        isFavorite: Boolean(tabData.isFavorite ?? existing?.isFavorite),
        pinned: Boolean(tabData.pinned ?? existing?.pinned),
        meta: tabData.meta || {}
      };
      store.put(record);
      tx.objectStore(TEXT_STORE).put({ id: record.id, cleanText });
    };

    const writeDedupedByUrl = () => {
      if (!safeUrl) return write(null); // never dedupe records without a URL together
      const req = store.index('url').getAll(safeUrl);
      req.onsuccess = () => write(req.result.find(r => !r.deletedAt));
    };

    if (tabData.id) {
      // An unknown id (e.g. JSON import) still dedupes on URL
      const req = store.get(tabData.id);
      req.onsuccess = () => (req.result ? write(req.result) : writeDedupedByUrl());
    } else {
      writeDedupedByUrl();
    }

    onTxDone(tx, resolve, reject, () => record);
  });
}

/**
 * Query archived tabs with keyword search and filters.
 * Records come back without cleanText unless `includeText: true`; soft-deleted records
 * are hidden unless `includeDeleted: true`.
 */
export async function getArchivedTabs(filters = {}) {
  const db = await getDB();
  const {
    query = '',
    tag = '',
    domain = '',
    timeRange = '',
    status = '',
    favoriteOnly = false,
    closedSince = 0, // only records TabSum closed at/after this time
    view = '', // 'inbox' (never reopened) | 'reopened' | '' (all)
    includeDeleted = false,
    includeText = false,
    sortBy = 'newest', // 'newest' | 'oldest' | 'reading-time-asc' | 'reading-time-desc' | 'title-asc' | 'domain'
    limit = 100,
    offset = 0
  } = filters;

  const normalizedQuery = query.toLowerCase().trim();
  const needsText = Boolean(normalizedQuery) || includeText;
  const fadeSettings = sortBy === 'expiring-soon' ? await getSettings() : null;
  const todayStart = startOfDay(0);
  const yesterdayStart = startOfDay(1);
  const weekAgo = Date.now() - 7 * DAY_MS;

  const passesFilters = (item) => {
    if (item.deletedAt && !includeDeleted) return false;
    if (favoriteOnly && !item.isFavorite) return false;
    if (status && item.status !== status) return false;
    if (closedSince && !(item.closedAt >= closedSince)) return false;
    if (view === 'inbox' && item.restoredAt) return false;
    if (view === 'reopened' && !item.restoredAt) return false;
    if (domain && item.domain !== domain) return false;
    if (tag && !(item.summary?.tags || []).some(t => t.toLowerCase() === tag.toLowerCase())) return false;
    if (timeRange === 'today' && item.capturedAt < todayStart) return false;
    if (timeRange === 'yesterday' && (item.capturedAt < yesterdayStart || item.capturedAt >= todayStart)) return false;
    if (timeRange === 'week' && item.capturedAt < weekAgo) return false;
    return true;
  };

  const metaMatches = (item) =>
    item.title?.toLowerCase().includes(normalizedQuery) ||
    item.url?.toLowerCase().includes(normalizedQuery) ||
    item.summary?.tldr?.toLowerCase().includes(normalizedQuery) ||
    (item.summary?.bullets || []).some(b => b.toLowerCase().includes(normalizedQuery)) ||
    (item.summary?.tags || []).some(t => t.toLowerCase().includes(normalizedQuery));

  return new Promise((resolve, reject) => {
    const tx = db.transaction(needsText ? [STORE_NAME, TEXT_STORE] : STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    // Use native index cursor direction for temporal sorting
    const isCustomSort = sortBy !== 'newest' && sortBy !== 'oldest';
    const direction = sortBy === 'oldest' ? 'next' : 'prev';
    const request = store.index('capturedAt').openCursor(null, direction);

    const matches = [];
    let results = [];
    let skipped = 0;

    const finish = () => {
      results = matches;
      if (isCustomSort) {
        if (sortBy === 'reading-time-asc') {
          matches.sort((a, b) => (a.readingTimeMinutes || 1) - (b.readingTimeMinutes || 1));
        } else if (sortBy === 'reading-time-desc') {
          matches.sort((a, b) => (b.readingTimeMinutes || 1) - (a.readingTimeMinutes || 1));
        } else if (sortBy === 'title-asc') {
          matches.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        } else if (sortBy === 'domain') {
          matches.sort((a, b) => (a.domain || '').localeCompare(b.domain || ''));
        } else if (sortBy === 'expiring-soon') {
          const expiry = (t) => getExpiry(t, fadeSettings) ?? Infinity; // never-fading notes last
          matches.sort((a, b) => (expiry(a) === expiry(b) ? 0 : expiry(a) - expiry(b)));
        }
        results = matches.slice(offset, offset + limit);
      }
      if (includeText) {
        const textStore = tx.objectStore(TEXT_STORE);
        for (const item of results) {
          const req = textStore.get(item.id);
          req.onsuccess = () => { item.cleanText = req.result?.cleanText || ''; };
        }
      }
    };

    const take = (item, cursor) => {
      if (!isCustomSort) {
        // Index-ordered queries stream and stop early once the page is full
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        matches.push(item);
        if (matches.length >= limit) {
          finish();
          return;
        }
      } else {
        matches.push(item);
      }
      cursor.continue();
    };

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        finish();
        return;
      }
      const item = cursor.value;
      if (!passesFilters(item)) {
        cursor.continue();
        return;
      }
      if (!normalizedQuery || metaMatches(item)) {
        take(item, cursor);
        return;
      }
      // Fall back to the page text only when metadata didn't match
      const textReq = tx.objectStore(TEXT_STORE).get(item.id);
      textReq.onsuccess = () => {
        if (textReq.result?.cleanText?.toLowerCase().includes(normalizedQuery)) {
          take(item, cursor);
        } else {
          cursor.continue();
        }
      };
    };

    onTxDone(tx, resolve, reject, () => results);
  });
}

/**
 * Get a single tab by ID, including its cleanText
 */
export async function getTabById(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readonly');
    const recordReq = tx.objectStore(STORE_NAME).get(id);
    const textReq = tx.objectStore(TEXT_STORE).get(id);
    onTxDone(tx, resolve, reject, () => (
      recordReq.result ? { ...recordReq.result, cleanText: textReq.result?.cleanText || '' } : null
    ));
  });
}

/**
 * Read-modify-write one record. Resolves the updated record or null if missing.
 */
async function updateRecord(id, mutate) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let record = null;
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return;
      record = req.result;
      mutate(record);
      store.put(record);
    };
    onTxDone(tx, resolve, reject, () => record);
  });
}

/**
 * Update tab status (e.g. 'restored', 'archived', 'discarded')
 */
export async function updateArchivedTabStatus(id, status, reason) {
  return updateRecord(id, (record) => {
    record.status = status;
    if (reason) record.closureReason = reason;
    if (status === 'restored') {
      record.restoredAt = Date.now();
    }
    if (status !== 'archived') {
      record.closedAt = null; // the tab is open again (or never got closed)
    }
  });
}

/**
 * Mark a record as archived because TabSum closed its tab (feeds "Closed today").
 */
export async function markTabClosed(id) {
  return updateRecord(id, (record) => {
    record.status = 'archived';
    record.closedAt = Date.now();
  });
}

export async function updateTabStatus(id, status) {
  return updateArchivedTabStatus(id, status);
}

/**
 * Soft-delete (tombstone) a tab. Hidden from queries until restored or purged.
 */
export async function softDeleteTab(id) {
  return updateRecord(id, (record) => {
    record.deletedAt = Date.now();
  });
}

/**
 * Undo a soft delete
 */
export async function restoreDeletedTab(id) {
  return updateRecord(id, (record) => {
    delete record.deletedAt;
  });
}

/**
 * When a note fades (ms timestamp), or null if it never does. Unopened notes fade
 * fadeUnopenedDays after capture; reopened notes fadeReopenedDays after the last reopen.
 * Starred notes and a 0-day setting never fade.
 */
export function getExpiry(record, settings = {}) {
  if (record.isFavorite) return null;
  const days = record.restoredAt ? settings.fadeReopenedDays : settings.fadeUnopenedDays;
  if (!days) return null;
  return (record.restoredAt || record.capturedAt) + days * DAY_MS;
}

/**
 * Delete notes past their fade date. Skips keepIds (records of tabs TabSum suspended that
 * are still open): hybrid mode's second tier needs that record to close the tab.
 */
export async function fadeExpiredTabs(settings, keepIds = new Set()) {
  const db = await getDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readwrite');
    const textStore = tx.objectStore(TEXT_STORE);
    let fadedCount = 0;
    tx.objectStore(STORE_NAME).openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      const expiry = getExpiry(cursor.value, settings);
      if (expiry !== null && expiry <= now && !keepIds.has(cursor.key)) {
        cursor.delete();
        textStore.delete(cursor.key);
        fadedCount++;
      }
      cursor.continue();
    };
    onTxDone(tx, resolve, reject, () => ({ fadedCount }));
  });
}

/**
 * Hard-delete tombstones older than the cutoff.
 */
export async function purgeDeletedTabs(olderThanMs = 60 * 60 * 1000) {
  const db = await getDB();
  const cutoff = Date.now() - olderThanMs;
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readwrite');
    const textStore = tx.objectStore(TEXT_STORE);
    let purgedCount = 0;
    tx.objectStore(STORE_NAME).openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      const item = cursor.value;
      if (item.deletedAt && item.deletedAt <= cutoff) {
        cursor.delete();
        textStore.delete(item.id);
        purgedCount++;
      }
      cursor.continue();
    };
    onTxDone(tx, resolve, reject, () => ({ purgedCount }));
  });
}

/**
 * Permanently delete an archived tab
 */
export async function deleteArchivedTab(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(TEXT_STORE).delete(id);
    onTxDone(tx, resolve, reject, () => true);
  });
}

/**
 * Get aggregated tag counts across all archived tabs
 */
export async function getAllTags() {
  const tabs = await getArchivedTabs({ limit: 1000 });
  const tagCounts = {};
  for (const tab of tabs) {
    const tags = tab.summary?.tags || [];
    for (const tag of tags) {
      const clean = tag.trim().replace(/^#/, '');
      if (clean) {
        tagCounts[clean] = (tagCounts[clean] || 0) + 1;
      }
    }
  }
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get aggregated domain counts
 */
export async function getAllDomains() {
  const tabs = await getArchivedTabs({ limit: 1000 });
  const domainCounts = {};
  for (const tab of tabs) {
    if (tab.domain) {
      domainCounts[tab.domain] = (domainCounts[tab.domain] || 0) + 1;
    }
  }
  return Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get dashboard stats (excluding soft-deleted tabs).
 * "today" means since local midnight.
 */
export async function getStats() {
  const tabs = await getArchivedTabs({ limit: Infinity });
  const todayStart = startOfDay(0);
  return {
    total: tabs.length,
    today: tabs.filter(t => t.capturedAt >= todayStart).length,
    favorites: tabs.filter(t => t.isFavorite).length,
    totalReadingMinutes: tabs.reduce((acc, t) => acc + (t.readingTimeMinutes || 2), 0)
  };
}

/**
 * Settings Management using chrome.storage.local
 */
export const DEFAULT_SETTINGS = {
  timeoutMinutes: 60,
  archiveMode: 'hybrid', // 'hybrid' (smart adaptive) | 'discard' (soft suspension) | 'close' (auto-close)
  ignorePinnedTabs: true, // Never archive or suspend pinned tabs unless explicitly allowed
  aiProvider: 'auto',     // 'auto' | 'prompt-api' | 'heuristic' | 'gemini-api'
  geminiApiKey: '',
  openaiBaseUrl: 'http://localhost:11434/v1', // any OpenAI-compatible server; Ollama's default shown
  openaiModel: '',
  openaiApiKey: '', // optional; most local servers ignore it
  excludedDomains: [
    'mail.google.com',
    'docs.google.com',
    'drive.google.com',
    'calendar.google.com',
    'github.com',
    'gitlab.com',
    'slack.com',
    'teams.microsoft.com',
    'youtube.com',
    'spotify.com',
    'netflix.com'
  ],
  minTextLength: 150,
  closeRequiresAiSummary: true, // without an AI-written summary, suspend instead of closing
  fadeUnopenedDays: 30, // unstarred, never-reopened notes are deleted this long after capture (0 = never)
  fadeReopenedDays: 7 // unstarred reopened notes are deleted this long after the last reopen (0 = never)
};

export async function getSettings() {
  const res = await chrome.storage.local.get('tabsum_settings');
  return Object.assign({}, DEFAULT_SETTINGS, res.tabsum_settings || {});
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const updated = Object.assign({}, current, settings);
  await chrome.storage.local.set({ tabsum_settings: updated });
  return updated;
}

export function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Toggle favorite status on an archived tab
 * @param {string} id
 * @returns {Promise<Object|null>} Updated record or null
 */
export async function toggleFavoriteTab(id) {
  return updateRecord(id, (record) => {
    record.isFavorite = !record.isFavorite;
  });
}

/**
 * Estimate storage usage of archived tabs (records + text) in IndexedDB
 * @returns {Promise<{ itemCount: number, byteEstimate: number }>}
 */
export async function getStorageEstimate() {
  const db = await getDB();
  const encoder = new TextEncoder();
  const sizeOf = (value) => encoder.encode(JSON.stringify(value)).length;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readonly');
    const liveIds = new Set();
    let byteEstimate = 0;

    tx.objectStore(STORE_NAME).openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const item = cursor.value;
        if (!item.deletedAt) {
          liveIds.add(item.id);
          byteEstimate += sizeOf(item);
        }
        cursor.continue();
        return;
      }
      tx.objectStore(TEXT_STORE).openCursor().onsuccess = (textEvent) => {
        const textCursor = textEvent.target.result;
        if (!textCursor) return;
        if (liveIds.has(textCursor.key)) {
          byteEstimate += sizeOf(textCursor.value);
        }
        textCursor.continue();
      };
    };

    onTxDone(tx, resolve, reject, () => ({ itemCount: liveIds.size, byteEstimate }));
  });
}

/**
 * Clear all archived tab records from IndexedDB
 */
export async function clearAllHistory() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TEXT_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(TEXT_STORE).clear();
    onTxDone(tx, resolve, reject, () => true);
  });
}

export const clearAllTabs = clearAllHistory;
