/**
 * TabSum - Background Service Worker (Manifest V3)
 * Handles tab activity tracking, periodic inactivity sweeps, safe extraction,
 * soft suspension / auto-archival, and badge indicators.
 */

import { saveArchivedTab, updateArchivedTabStatus, reconcilePendingRecords, getSettings, extractDomain, getStats, enforceStorageQuota } from '../storage/db.js';
import { summarizeContent } from '../ai/summarizer.js';

const ALARM_NAME = 'tabsum-inactivity-sweep';
const SWEEP_INTERVAL_MINUTES = 1;

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[TabSum] Installed.');
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_INTERVAL_MINUTES });

  // Open side panel when clicking action icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('[TabSum] Could not set panel behavior:', err);
    }
  }

  // Initialize active tab timestamps & reconcile pending records
  await initializeTabTimestamps();
  await reconcilePendingRecords().catch(console.error);
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeTabTimestamps();
  await reconcilePendingRecords().catch(console.error);
  await updateBadge();
});

/**
 * Tab Activity Tracking in chrome.storage.session (Serialized via mutex)
 */
let storageLock = Promise.resolve();
function withStorageLock(fn) {
  storageLock = storageLock.then(fn).catch(err => console.error('[TabSum] Storage lock error:', err));
  return storageLock;
}

async function getTimestamps() {
  const data = await chrome.storage.session.get('tabTimestamps');
  return data.tabTimestamps || {};
}

async function setTimestamp(tabId, timestamp = Date.now()) {
  return withStorageLock(async () => {
    const timestamps = await getTimestamps();
    timestamps[tabId] = timestamp;
    await chrome.storage.session.set({ tabTimestamps: timestamps });
  });
}

async function removeTimestamp(tabId) {
  return withStorageLock(async () => {
    const timestamps = await getTimestamps();
    delete timestamps[tabId];
    await chrome.storage.session.set({ tabTimestamps: timestamps });
  });
}

async function initializeTabTimestamps() {
  return withStorageLock(async () => {
    const tabs = await chrome.tabs.query({});
    const timestamps = await getTimestamps();
    const now = Date.now();
    for (const tab of tabs) {
      if (!timestamps[tab.id]) {
        timestamps[tab.id] = now;
      }
    }
    await chrome.storage.session.set({ tabTimestamps: timestamps });
  });
}

// Track tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await setTimestamp(activeInfo.tabId, Date.now());
});

// Track tab updates (navigation / completion)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    await setTimestamp(tabId, Date.now());
  }
});

// Track tab replacement (prerendering / session restore)
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  return withStorageLock(async () => {
    const timestamps = await getTimestamps();
    if (timestamps[removedTabId]) {
      timestamps[addedTabId] = timestamps[removedTabId];
      delete timestamps[removedTabId];
      await chrome.storage.session.set({ tabTimestamps: timestamps });
    }
  });
});

// Track window focus change
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab && activeTab.id) {
      await setTimestamp(activeTab.id, Date.now());
    }
  } catch (err) {
    console.debug('Window focus update error:', err);
  }
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTimestamp(tabId);
});

function isScriptableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/^(chrome|chrome-extension|about|edge|brave|view-source|data|file):/i.test(url)) return false;
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) return false;
  return true;
}

/**
 * Inactivity Sweep via chrome.alarms (Guarded against concurrency)
 */
let isSweeping = false;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  // Safety Gate 1: Check if user is away from computer.
  // Don't auto-archive tabs while the user is AFK to prevent surprise on return.
  const idleState = await new Promise(resolve => {
    chrome.idle.queryState(60, resolve);
  });
  if (idleState === 'idle' || idleState === 'locked') {
    return;
  }

  await performInactivitySweep();
});

async function performInactivitySweep() {
  if (isSweeping) return;
  isSweeping = true;

  try {
    await reconcilePendingRecords().catch(console.error);
    const hasGlobalPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    const settings = await getSettings();
    const timeoutMs = (settings.timeoutMinutes || 60) * 60 * 1000;
    const timestamps = await getTimestamps();
    const now = Date.now();

    const allTabs = await chrome.tabs.query({});
    const excludedDomains = (settings.excludedDomains || []).map(d => d.toLowerCase());

    for (const tab of allTabs) {
      // Safety Gates:
      // 1. Never touch active tab in any window
      if (tab.active) continue;

      // 2. Never touch pinned tabs
      if (tab.pinned) continue;

      // 3. Never touch tabs playing audio
      if (tab.audible) continue;

      // 4. Never touch already discarded tabs
      if (tab.discarded) continue;

      // 5. Check if URL is scriptable
      if (!isScriptableUrl(tab.url)) {
        continue;
      }

      // 6. Check host permission for this specific tab's origin
      if (!hasGlobalPermission) {
        try {
          const parsed = new URL(tab.url);
          const hostPattern = `${parsed.protocol}//${parsed.hostname}/*`;
          const hasOrigin = await chrome.permissions.contains({ origins: [hostPattern] });
          if (!hasOrigin) {
            continue;
          }
        } catch {
          continue;
        }
      }

      // 7. Excluded domain check
      const domain = extractDomain(tab.url).toLowerCase();
      if (excludedDomains.some(ex => domain === ex || domain.endsWith('.' + ex))) {
        continue;
      }

      // 8. Check staleness threshold
      const lastActive = timestamps[tab.id] || now;
      const idleDuration = now - lastActive;
      if (idleDuration < timeoutMs) {
        continue;
      }

      // Tab is eligible! Process archival
      console.log(`[TabSum] Tab ${tab.id} (${tab.url}) is stale by ${Math.round(idleDuration / 1000)}s. Archiving...`);
      await processTabArchival(tab, settings, lastActive);
    }
  } finally {
    isSweeping = false;
  }
}

/**
 * Extract, summarize, and archive an eligible tab
 */
async function processTabArchival(tab, settings, lastActiveTime) {
  try {
    // 1. Inject in-tab content extractor
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/in-tab-extractor.js']
    });

    const extracted = results?.[0]?.result;
    if (!extracted) {
      console.warn(`[TabSum] Extraction returned empty for tab ${tab.id} (${tab.url})`);
      return;
    }

    // 2. Dirty check: Don't touch if user has unsaved input
    if (extracted.isDirty) {
      console.log(`[TabSum] Tab ${tab.id} has unsaved work: ${extracted.reason}. Skipping.`);
      return;
    }

    // 3. Summarize content
    const summary = await summarizeContent(extracted, settings);

    // 4. Save to IndexedDB with status 'pending' (Two-phase commit)
    const record = await saveArchivedTab({
      url: extracted.url || tab.url,
      title: extracted.title || tab.title,
      domain: extracted.domain || extractDomain(tab.url),
      favIconUrl: extracted.favIconUrl || tab.favIconUrl,
      capturedAt: Date.now(),
      lastActiveAt: lastActiveTime,
      readingTimeMinutes: extracted.readingTimeMinutes || 1,
      summary,
      cleanText: extracted.cleanText || '',
      wordCount: extracted.wordCount || 0,
      status: 'pending',
      closureTier: extracted.closureTier || 'suspend_only',
      closureReason: extracted.closureReason || '',
      meta: extracted.meta
    });

    // 5. TOCTOU Re-Check: Did user switch into tab or play audio while we were summarizing?
    let currentTab;
    try {
      currentTab = await chrome.tabs.get(tab.id);
    } catch {
      // Tab was already closed by user
      if (record?.id) {
        await updateArchivedTabStatus(record.id, 'aborted');
      }
      return;
    }

    if (!currentTab || currentTab.active || currentTab.audible) {
      console.log(`[TabSum] Tab ${tab.id} became active or audible during processing. Aborting closure.`);
      if (record?.id) {
        await updateArchivedTabStatus(record.id, 'aborted');
      }
      return;
    }

    // 6. Action: Soft Discard or Auto-Close based on Archive Mode
    let shouldClose = false;
    if (settings.archiveMode === 'close') {
      shouldClose = true;
    } else if (settings.archiveMode === 'discard') {
      shouldClose = false;
    } else {
      // 'hybrid' mode (default): close pure reading articles; suspend forms/SPAs/interactive tabs
      shouldClose = extracted.closureTier === 'safe_to_close';
    }

    if (shouldClose) {
      await chrome.tabs.remove(tab.id);
      await removeTimestamp(tab.id);
      if (record?.id) {
        await updateArchivedTabStatus(record.id, 'archived');
      }
      if (settings.notificationsEnabled) {
        showArchivedNotification(record.title);
      }
    } else {
      // Soft discard: Inject sleeping tab indicator 💤 into title before discarding
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (!document.title.startsWith('💤 ')) {
              document.title = '💤 ' + document.title;
            }
          }
        });
      } catch (titleErr) {
        console.debug('[TabSum] Could not prefix title with sleeping symbol:', titleErr);
      }
      await chrome.tabs.discard(tab.id);
      if (record?.id) {
        await updateArchivedTabStatus(record.id, 'discarded');
      }
    }

    // Enforce storage quota auto-pruning after finalizing archival
    await enforceStorageQuota(settings).catch(err => {
      console.error('[TabSum] Storage quota enforcement error:', err);
    });

    await updateBadge();
  } catch (err) {
    console.error(`[TabSum] Error archiving tab ${tab.id}:`, err);
  }
}

/**
 * Extract, summarize, and archive a tab immediately.
 * Invoked by keyboard shortcut command, UI button, or runtime message.
 */
async function archiveActiveTab(activeTab) {
  if (!activeTab || !activeTab.id) {
    return { success: false, error: 'No active tab found' };
  }

  if (!isScriptableUrl(activeTab.url)) {
    return { success: false, error: 'Cannot extract content from internal browser or extension store pages.' };
  }

  const settings = await getSettings();
  const timestamps = await getTimestamps();
  const lastActive = timestamps[activeTab.id] || Date.now();

  // Extract and archive immediately
  const results = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ['src/content/in-tab-extractor.js']
  });

  const extracted = results?.[0]?.result;
  if (!extracted) {
    return { success: false, error: 'Could not extract content from this page' };
  }

  const summary = await summarizeContent(extracted, settings);
  const record = await saveArchivedTab({
    url: extracted.url || activeTab.url,
    title: extracted.title || activeTab.title,
    domain: extracted.domain || extractDomain(activeTab.url),
    favIconUrl: extracted.favIconUrl || activeTab.favIconUrl,
    capturedAt: Date.now(),
    lastActiveAt: lastActive,
    readingTimeMinutes: extracted.readingTimeMinutes || 1,
    summary,
    cleanText: extracted.cleanText || '',
    wordCount: extracted.wordCount || 0,
    status: 'archived',
    closureTier: extracted.closureTier || 'safe_to_close',
    closureReason: extracted.closureReason || 'Manual archive shortcut',
    meta: extracted.meta
  });

  // Enforce storage quota auto-pruning after saving tab
  await enforceStorageQuota(settings).catch(err => {
    console.error('[TabSum] Storage quota enforcement error:', err);
  });

  await updateBadge();
  return { success: true, record };
}

/**
 * Handle Global Keyboard Shortcuts
 */
async function handleCommand(command) {
  if (command === 'archive_active_tab') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        console.warn('[TabSum] No active tab found for archive_active_tab command');
        return;
      }

      const result = await archiveActiveTab(activeTab);
      if (result?.success && result?.record) {
        await updateBadge();
        showArchivedNotification(result.record.title || activeTab.title || 'Page');
      } else if (!result?.success) {
        console.warn('[TabSum] Could not archive tab via shortcut:', result?.error);
      }
    } catch (err) {
      console.error('[TabSum] Error executing archive_active_tab command:', err);
    }
  } else if (command === '_execute_action') {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.windowId) {
          await chrome.sidePanel.open({ windowId: activeTab.windowId });
        }
      } catch (err) {
        console.debug('[TabSum] Could not open side panel on command:', err);
      }
    }
  }
}

chrome.commands.onCommand.addListener(handleCommand);

/**
 * Handle runtime messages from UI surfaces
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'ARCHIVE_ACTIVE_TAB') {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await archiveActiveTab(activeTab);
        sendResponse(result);
        return;
      }

      if (message.type === 'TRIGGER_COMMAND') {
        await handleCommand(message.command);
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'RESTORE_TAB') {
        if (message.url) {
          // 1. Search existing open tabs for matching URL or tabId
          const allTabs = await chrome.tabs.query({});
          const existingTab = allTabs.find(t => 
            (message.tabId && t.id === message.tabId) ||
            t.url === message.url ||
            t.pendingUrl === message.url
          );

          if (existingTab && existingTab.id) {
            // Reactivate discarded or background tab in place!
            await chrome.tabs.update(existingTab.id, { active: true });
            if (existingTab.windowId) {
              await chrome.windows.update(existingTab.windowId, { focused: true });
            }
            if (message.recordId) {
              await updateArchivedTabStatus(message.recordId, 'restored');
            }
            sendResponse({ success: true, restoredInPlace: true, tabId: existingTab.id });
            return;
          }

          // 2. Tab was closed, open fresh tab
          const newTab = await chrome.tabs.create({ url: message.url, active: true });
          if (message.recordId) {
            await updateArchivedTabStatus(message.recordId, 'restored');
          }
          sendResponse({ success: true, restoredInPlace: false, tabId: newTab.id });
          return;
        }
      }

      if (message.type === 'TRIGGER_SWEEP_NOW') {
        await performInactivitySweep();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'GET_STATS') {
        const stats = await getStats();
        sendResponse({ success: true, stats });
        return;
      }

      sendResponse({ success: false, error: 'Unknown message type' });
    } catch (err) {
      console.error('[TabSum] Message handling error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});

/**
 * Update Action Icon Badge Count
 */
async function updateBadge() {
  try {
    const stats = await getStats();
    const count = stats.today || 0;
    const badgeText = count > 0 ? String(count) : '';
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
  } catch (err) {
    console.debug('Badge update error:', err);
  }
}

function showArchivedNotification(title) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icons/icon-128.png'),
      title: 'Tab Archived to Wiki',
      message: `"${title.slice(0, 50)}..." summarized and saved to your knowledge base.`,
      silent: true
    });
  } catch (err) {
    console.debug('Notification error:', err);
  }
}
