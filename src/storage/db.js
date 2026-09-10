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

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * Save an archived tab record into IndexedDB
 * @param {Object} tabData 
 */
export async function saveArchivedTab(tabData) {
  const db = await getDB();
  const record = {
    id: tabData.id || crypto.randomUUID(),
    url: tabData.url,
    title: tabData.title || 'Untitled Tab',
    domain: tabData.domain || extractDomain(tabData.url),
    favIconUrl: tabData.favIconUrl || '',
    capturedAt: tabData.capturedAt || Date.now(),
    lastActiveAt: tabData.lastActiveAt || Date.now(),
    readingTimeMinutes: tabData.readingTimeMinutes || 1,
    summary: tabData.summary || {
      tldr: '',
      bullets: [],
      tags: []
    },
    cleanText: tabData.cleanText || '',
    wordCount: tabData.wordCount || 0,
    status: tabData.status || 'archived', // 'archived' | 'discarded' | 'restored'
    meta: tabData.meta || {}
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
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
    const request = index.openCursor(null, 'prev'); // Most recent first

    const results = [];
    const {
      query = '',
      tag = '',
      domain = '',
      timeRange = '',
      status = '',
      limit = 100,
      offset = 0
    } = filters;

    const normalizedQuery = query.toLowerCase().trim();
    const now = Date.now();
    let skipped = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      const item = cursor.value;

      // Status filter
      if (status && item.status !== status) {
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

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      results.push(item);
      if (results.length >= limit) {
        resolve(results);
        return;
      }

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
 * Update tab status (e.g. 'restored' or 'archived')
 */
export async function updateTabStatus(id, status) {
  const tab = await getTabById(id);
  if (!tab) return null;
  tab.status = status;
  if (status === 'restored') {
    tab.restoredAt = Date.now();
  }
  return saveArchivedTab(tab);
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
 * Get dashboard stats
 */
export async function getStats() {
  const tabs = await getArchivedTabs({ limit: 1000 });
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const total = tabs.length;
  const today = tabs.filter(t => t.capturedAt >= dayAgo).length;
  const totalReadingMinutes = tabs.reduce((acc, t) => acc + (t.readingTimeMinutes || 2), 0);

  return {
    total,
    today,
    totalReadingMinutes
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
  archiveMode: 'discard', // 'discard' (soft suspension, keeps tab header) or 'close' (cleans tab bar)
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
  notificationsEnabled: true
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
