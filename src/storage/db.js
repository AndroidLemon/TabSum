/**
 * TabSum - IndexedDB Storage & Local Settings Management
 */

const DB_NAME = 'TabSumDB';
const DB_VERSION = 1;
const STORE_NAME = 'archived_tabs';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('domain', 'domain', { unique: false });
          store.createIndex('capturedAt', 'capturedAt', { unique: false });
          store.createIndex('status', 'status', { unique: false });
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
 * Save an archived tab record into IndexedDB
 * @param {Object} tabData 
 */
export async function saveArchivedTab(tabData) {
  const db = await getDB();
  
  // Scheme validation: strictly allow only http: and https: protocols
  const safeUrl = isValidHttpUrl(tabData.url) ? tabData.url.trim() : '';
  const safeFavicon = isValidHttpUrl(tabData.favIconUrl) ? tabData.favIconUrl.trim() : '';

  // Cap cleanText at 50,000 chars to avoid memory / storage bloat over time
  const rawText = tabData.cleanText || '';
  const cappedText = rawText.length > 50000 ? rawText.slice(0, 50000) : rawText;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const urlIndex = store.index('url');

    const finalizeSave = (targetId) => {
      const record = {
        id: targetId,
        url: safeUrl,
        title: tabData.title || 'Untitled Tab',
        domain: tabData.domain || extractDomain(safeUrl),
        favIconUrl: safeFavicon,
        capturedAt: tabData.capturedAt || Date.now(),
        lastActiveAt: tabData.lastActiveAt || Date.now(),
        readingTimeMinutes: tabData.readingTimeMinutes || 1,
        summary: tabData.summary || {
          tldr: '',
          bullets: [],
          tags: []
        },
        cleanText: cappedText,
        wordCount: tabData.wordCount || 0,
        status: tabData.status || 'pending', // 'pending' | 'discarded' | 'archived' | 'aborted' | 'restored'
        closureTier: tabData.closureTier || 'suspend_only',
        closureReason: tabData.closureReason || '',
        isFavorite: Boolean(tabData.isFavorite),
        pinned: Boolean(tabData.pinned),
        meta: tabData.meta || {}
      };
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };

    if (tabData.id) {
      const getExisting = store.get(tabData.id);
      getExisting.onsuccess = () => {
        const existing = getExisting.result;
        if (existing) {
          if (tabData.isFavorite === undefined && existing.isFavorite !== undefined) {
            tabData.isFavorite = existing.isFavorite;
          }
          if (tabData.pinned === undefined && existing.pinned !== undefined) {
            tabData.pinned = existing.pinned;
          }
        }
        finalizeSave(tabData.id);
      };
      getExisting.onerror = () => {
        finalizeSave(tabData.id);
      };
      return;
    }

    // Deduplication: check if record with identical URL was saved in the past hour
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const req = urlIndex.getAll(safeUrl);
    req.onsuccess = () => {
      const matches = req.result || [];
      const recent = matches.find(m => (now - m.capturedAt) < ONE_HOUR);
      const idToUse = recent ? recent.id : crypto.randomUUID();
      if (recent) {
        if (tabData.isFavorite === undefined && recent.isFavorite !== undefined) {
          tabData.isFavorite = recent.isFavorite;
        }
        if (tabData.pinned === undefined && recent.pinned !== undefined) {
          tabData.pinned = recent.pinned;
        }
      }
      finalizeSave(idToUse);
    };
    req.onerror = () => {
      finalizeSave(crypto.randomUUID());
    };
  });
}

/**
 * Query archived tabs with full-text keyword search and filters
 */
export async function getArchivedTabs(filters = {}) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('capturedAt');

    const {
      query = '',
      tag = '',
      domain = '',
      timeRange = '',
      status = '',
      favoriteOnly = false,
      sortBy = 'newest', // 'newest' | 'oldest' | 'reading-time-asc' | 'reading-time-desc' | 'title-asc' | 'domain'
      limit = 100,
      offset = 0
    } = filters;

    // Use native index cursor direction for temporal sorting
    const isCustomSort = sortBy !== 'newest' && sortBy !== 'oldest';
    const direction = sortBy === 'oldest' ? 'next' : 'prev';
    const request = index.openCursor(null, direction);

    const matches = [];
    const normalizedQuery = query.toLowerCase().trim();
    const now = Date.now();
    let skipped = 0;

    const finalizeResults = () => {
      if (!isCustomSort) {
        resolve(matches);
        return;
      }

      if (sortBy === 'reading-time-asc') {
        matches.sort((a, b) => (a.readingTimeMinutes || 1) - (b.readingTimeMinutes || 1));
      } else if (sortBy === 'reading-time-desc') {
        matches.sort((a, b) => (b.readingTimeMinutes || 1) - (a.readingTimeMinutes || 1));
      } else if (sortBy === 'title-asc') {
        matches.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      } else if (sortBy === 'domain') {
        matches.sort((a, b) => (a.domain || '').localeCompare(b.domain || ''));
      }

      resolve(matches.slice(offset, offset + limit));
    };

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        finalizeResults();
        return;
      }

      const item = cursor.value;

      // Favorite filter
      if (favoriteOnly && !item.isFavorite) {
        cursor.continue();
        return;
      }

      // Status filter
      if (!status) {
        if (item.status === 'aborted' || item.status === 'pending') {
          cursor.continue();
          return;
        }
      } else if (item.status !== status) {
        cursor.continue();
        return;
      }

      // Domain filter
      if (domain && item.domain !== domain) {
        cursor.continue();
        return;
      }

      // Tag filter
      if (tag) {
        const itemTags = (item.summary?.tags || []).map(t => t.toLowerCase());
        if (!itemTags.includes(tag.toLowerCase())) {
          cursor.continue();
          return;
        }
      }

      // Time range filter
      if (timeRange) {
        const diffHours = (now - item.capturedAt) / (1000 * 60 * 60);
        if (timeRange === 'today' && diffHours > 24) {
          cursor.continue();
          return;
        }
        if (timeRange === 'yesterday' && (diffHours <= 24 || diffHours > 48)) {
          cursor.continue();
          return;
        }
        if (timeRange === 'week' && diffHours > 24 * 7) {
          cursor.continue();
          return;
        }
      }

      // Keyword search across title, tldr, bullets, tags, and cleanText
      if (normalizedQuery) {
        const titleMatch = item.title?.toLowerCase().includes(normalizedQuery);
        const urlMatch = item.url?.toLowerCase().includes(normalizedQuery);
        const tldrMatch = item.summary?.tldr?.toLowerCase().includes(normalizedQuery);
        const bulletsMatch = (item.summary?.bullets || []).some(b => b.toLowerCase().includes(normalizedQuery));
        const tagsMatch = (item.summary?.tags || []).some(t => t.toLowerCase().includes(normalizedQuery));
        const textMatch = item.cleanText?.toLowerCase().includes(normalizedQuery);

        if (!titleMatch && !urlMatch && !tldrMatch && !bulletsMatch && !tagsMatch && !textMatch) {
          cursor.continue();
          return;
        }
      }

      // For standard index-ordered queries, stream and terminate early when limit is satisfied
      if (!isCustomSort) {
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        matches.push(item);
        if (matches.length >= limit) {
          resolve(matches);
          return;
        }
        cursor.continue();
        return;
      }

      // For in-memory sorted criteria (reading time, title, domain), accumulate matches
      matches.push(item);
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single tab by ID
 */
export async function getTabById(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update tab status (e.g. 'restored', 'archived', 'discarded', 'aborted')
 */
export async function updateArchivedTabStatus(id, status) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve(null);
        return;
      }
      record.status = status;
      if (status === 'restored') {
        record.restoredAt = Date.now();
      }
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function updateTabStatus(id, status) {
  return updateArchivedTabStatus(id, status);
}

/**
 * Reconcile orphan pending records from interrupted service worker sweeps
 */
export async function reconcilePendingRecords(maxAgeMs = 5 * 60 * 1000) {
  const db = await getDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const statusIndex = store.index('status');
    const req = statusIndex.getAll('pending');

    req.onsuccess = () => {
      const pendingList = req.result || [];
      let reconciledCount = 0;
      for (const record of pendingList) {
        if (now - record.capturedAt > maxAgeMs) {
          record.status = 'aborted';
          record.abortReason = 'Worker restarted or timed out during archival';
          store.put(record);
          reconciledCount++;
        }
      }
      resolve({ reconciledCount });
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete an archived tab
 */
export async function deleteArchivedTab(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
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
 * Get dashboard stats (excluding pending and aborted tabs)
 */
export async function getStats() {
  const tabs = await getArchivedTabs({ limit: 10000 });
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const todayTabs = tabs.filter(t => t.capturedAt >= dayAgo);
  return {
    total: tabs.length,
    today: todayTabs.length,
    totalReadingMinutes: tabs.reduce((acc, t) => acc + (t.readingTimeMinutes || 2), 0)
  };
}

/**
 * Export all tabs in JSON or Markdown format
 */
export async function exportTabs(format = 'json') {
  const tabs = await getArchivedTabs({ limit: 10000 });
  if (format === 'json') {
    return JSON.stringify(tabs, null, 2);
  }

  // Markdown Wiki export
  let md = `# TabSum Knowledge Wiki Export\n*Exported on ${new Date().toLocaleString()}*\n\n`;
  for (const tab of tabs) {
    md += `## [${tab.title}](${tab.url})\n`;
    md += `*Captured: ${new Date(tab.capturedAt).toLocaleDateString()} | Domain: ${tab.domain} | Est. Read: ${tab.readingTimeMinutes} min*\n\n`;
    if (tab.summary?.tldr) {
      md += `**TL;DR**: ${tab.summary.tldr}\n\n`;
    }
    if (tab.summary?.bullets?.length) {
      md += `### Key Takeaways:\n`;
      for (const bullet of tab.summary.bullets) {
        md += `- ${bullet}\n`;
      }
      md += `\n`;
    }
    if (tab.summary?.tags?.length) {
      md += `**Tags**: ${tab.summary.tags.map(t => `#${t.replace(/^#/, '')}`).join(' ')}\n\n`;
    }
    md += `---\n\n`;
  }
  return md;
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
  notificationsEnabled: true,
  maxStoredItems: 1000,
  autoPruneEnabled: true
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
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve(null);
        return;
      }
      record.isFavorite = !record.isFavorite;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Enforce storage quota by auto-pruning oldest non-favorite, non-pinned archived tabs.
 * @param {Object} [settings]
 * @returns {Promise<{ prunedCount: number }>}
 */
export async function enforceStorageQuota(settings) {
  const currentSettings = settings || await getSettings();
  const maxStoredItems = currentSettings.maxStoredItems !== undefined
    ? Number(currentSettings.maxStoredItems)
    : 1000;
  const autoPruneEnabled = currentSettings.autoPruneEnabled !== undefined
    ? Boolean(currentSettings.autoPruneEnabled)
    : true;

  if (!autoPruneEnabled || maxStoredItems <= 0) {
    return { prunedCount: 0 };
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('capturedAt');

    const request = index.openCursor(null, 'next');
    const eligibleIds = [];
    let totalNonAborted = 0;
    let prunedCount = 0;
    let hasResolved = false;

    const safeResolve = (val) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve(val);
      }
    };

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const item = cursor.value;
        if (item.status !== 'aborted') {
          totalNonAborted++;
          if (!item.isFavorite && !item.pinned) {
            eligibleIds.push(item.id);
          }
        }
        cursor.continue();
      } else {
        if (totalNonAborted <= maxStoredItems) {
          safeResolve({ prunedCount: 0 });
          return;
        }

        const excess = totalNonAborted - maxStoredItems;
        const toDelete = eligibleIds.slice(0, excess);
        prunedCount = toDelete.length;

        if (prunedCount === 0) {
          safeResolve({ prunedCount: 0 });
          return;
        }

        for (const id of toDelete) {
          store.delete(id);
        }
      }
    };

    tx.oncomplete = () => {
      safeResolve({ prunedCount });
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Estimate storage usage of archived tabs in IndexedDB
 * @returns {Promise<{ itemCount: number, byteEstimate: number, quota: number }>}
 */
export async function getStorageEstimate() {
  const settings = await getSettings();
  const quota = settings.maxStoredItems !== undefined ? Number(settings.maxStoredItems) : 1000;
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();

    let itemCount = 0;
    let byteEstimate = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const item = cursor.value;
        if (item.status !== 'aborted') {
          itemCount++;
          const serialized = JSON.stringify(item);
          byteEstimate += typeof TextEncoder !== 'undefined'
            ? new TextEncoder().encode(serialized).length
            : serialized.length;
        }
        cursor.continue();
      } else {
        resolve({
          itemCount,
          byteEstimate,
          quota
        });
      }
    };

    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear all archived tab records from IndexedDB
 */
export async function clearAllHistory() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export const clearAllTabs = clearAllHistory;
