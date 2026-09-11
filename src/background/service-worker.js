/**
 * TabSum - Background Service Worker (Manifest V3)
 * Handles tab activity tracking, periodic inactivity sweeps, safe extraction,
 * soft suspension / auto-archival, and badge indicators.
 */

import {
  saveArchivedTab,
  updateArchivedTabStatus,
  markTabClosed,
  purgeDeletedTabs,
  fadeExpiredTabs,
  getTabById,
  getSettings,
  extractDomain,
  getStats
} from '../storage/db.js';
import { summarizeContent } from '../ai/summarizer.js';

const ALARM_NAME = 'tabsum-inactivity-sweep';
const SWEEP_INTERVAL_MINUTES = 1;
const IDLE_DETECTION_SECONDS = 60;
const SLEEP_GAP_MS = 5 * 60 * 1000; // sweep gap that means the machine was asleep

// Chrome may drop alarms across browser restarts; make sure ours exists whenever the worker starts
chrome.alarms.get(ALARM_NAME).then((alarm) => {
  if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_INTERVAL_MINUTES });
});

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[TabSum] Installed.');

  // Open side panel when clicking action icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('[TabSum] Could not set panel behavior:', err);
    }
  }

  await initialize();
});

chrome.runtime.onStartup.addListener(initialize);

/**
 * Seed tab timestamps, clean up leftovers from earlier sessions, refresh the badge
 */
async function initialize() {
  await initializeTabTimestamps();
  await purgeDeletedTabs().catch(console.error);
  await updateBadge();
}

/**
 * Tab Activity Tracking in chrome.storage.session (Serialized via mutex).
 * Functions called inside withStorageLock must not call withStorageLock themselves.
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

/**
 * Push every tab's last-active time forward by ms (time the user was away doesn't count).
 * Call only inside withStorageLock.
 */
async function shiftTimestamps(ms) {
  const timestamps = await getTimestamps();
  const now = Date.now();
  for (const tabId of Object.keys(timestamps)) {
    timestamps[tabId] = Math.min(timestamps[tabId] + ms, now);
  }
  await chrome.storage.session.set({ tabTimestamps: timestamps });
}

/**
 * Discount time spent idle/locked (idleSince) or asleep (gap since lastSweepAt; alarms
 * don't fire during machine sleep). Both measure the same absence, so shift by the larger.
 */
function compensateAwayTime() {
  return withStorageLock(async () => {
    const now = Date.now();
    const { idleSince, lastSweepAt } = await chrome.storage.session.get(['idleSince', 'lastSweepAt']);
    const idleMs = idleSince ? now - idleSince : 0;
    const gapMs = lastSweepAt && now - lastSweepAt > SLEEP_GAP_MS ? now - lastSweepAt : 0;
    const awayMs = Math.max(idleMs, gapMs);
    if (awayMs > 0) {
      console.log(`[TabSum] User was away ${Math.round(awayMs / 1000)}s; pausing inactivity clocks.`);
      await shiftTimestamps(awayMs);
    }
    await chrome.storage.session.set({ lastSweepAt: now });
    await chrome.storage.session.remove('idleSince');
  });
}

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') {
    await compensateAwayTime();
    return;
  }
  await withStorageLock(async () => {
    const { idleSince } = await chrome.storage.session.get('idleSince');
    if (!idleSince) await chrome.storage.session.set({ idleSince: Date.now() });
  });
});

/**
 * tabId -> recordId for tabs TabSum discarded, so later tiers/events can find the record.
 * ponytail: lives in session storage, so after a browser restart old 'discarded' records
 * lose their tab link and keep that status.
 */
async function getDiscardedMap() {
  const data = await chrome.storage.session.get('discardedRecords');
  return data.discardedRecords || {};
}

function mapDiscardedRecord(tabId, recordId) {
  return withStorageLock(async () => {
    const map = await getDiscardedMap();
    map[tabId] = recordId;
    await chrome.storage.session.set({ discardedRecords: map });
  });
}

/**
 * Remove and return the record id mapped to tabId (undefined if none)
 */
function takeDiscardedRecord(tabId) {
  return withStorageLock(async () => {
    const map = await getDiscardedMap();
    const recordId = map[tabId];
    if (recordId) {
      delete map[tabId];
      await chrome.storage.session.set({ discardedRecords: map });
    }
    return recordId;
  });
}

// Track tab activation; a tab TabSum discarded is back in use
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await setTimestamp(activeInfo.tabId, Date.now());
  const recordId = await takeDiscardedRecord(activeInfo.tabId);
  if (recordId) {
    await updateArchivedTabStatus(recordId, 'restored').catch(console.error);
  }
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
    const map = await getDiscardedMap();
    if (map[removedTabId]) {
      map[addedTabId] = map[removedTabId];
      delete map[removedTabId];
      await chrome.storage.session.set({ discardedRecords: map });
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

// Clean up closed tabs; a closed discarded tab leaves only its archive behind
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTimestamp(tabId);
  const recordId = await takeDiscardedRecord(tabId);
  if (recordId) {
    await updateArchivedTabStatus(recordId, 'archived').catch(console.error);
  }
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
    chrome.idle.queryState(IDLE_DETECTION_SECONDS, resolve);
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
    await purgeDeletedTabs().catch(console.error);
    await compensateAwayTime();
    const hasGlobalPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    const settings = await getSettings();
    await fadeHourly(settings).catch(console.error);
    const timeoutMs = (settings.timeoutMinutes || 60) * 60 * 1000;
    const timestamps = await getTimestamps();
    const discardedMap = await getDiscardedMap();
    const now = Date.now();

    const allTabs = await chrome.tabs.query({});
    const excludedDomains = (settings.excludedDomains || []).map(d => d.toLowerCase());

    for (const tab of allTabs) {
      // Safety Gates:
      // 1. Never touch active tab in any window
      if (tab.active) continue;

      // 2. Never touch pinned tabs (if ignorePinnedTabs is enabled, default: true)
      if (settings.ignorePinnedTabs !== false && tab.pinned) continue;

      // 3. Never touch tabs playing audio
      if (tab.audible) continue;

      // 4. Excluded domain check
      const domain = extractDomain(tab.url).toLowerCase();
      if (excludedDomains.some(ex => domain === ex || domain.endsWith('.' + ex))) {
        continue;
      }

      // 5. Check staleness threshold
      const lastActive = timestamps[tab.id] || now;
      const idleDuration = now - lastActive;
      if (idleDuration < timeoutMs) {
        continue;
      }

      // 6. Discarded tabs can't be scripted. Hybrid mode's second tier closes tabs TabSum
      //    itself discarded once they've sat unused for 2x the timeout.
      if (tab.discarded) {
        if (settings.archiveMode === 'hybrid' && idleDuration >= 2 * timeoutMs && discardedMap[tab.id]) {
          await closeDiscardedTab(tab, discardedMap[tab.id], settings);
        }
        continue;
      }

      // 7. Check if URL is scriptable
      if (!isScriptableUrl(tab.url)) {
        continue;
      }

      // 8. Check host permission for this specific tab's origin
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

      // Tab is eligible! Process archival
      console.log(`[TabSum] Tab ${tab.id} (${tab.url}) is stale by ${Math.round(idleDuration / 1000)}s. Archiving...`);
      await processTabArchival(tab, settings, lastActive);
    }
  } finally {
    isSweeping = false;
  }
}

/**
 * Delete notes past their fade date, at most once an hour (the sweep runs every minute).
 */
async function fadeHourly(settings) {
  const { lastFadeAt } = await chrome.storage.session.get('lastFadeAt');
  if (lastFadeAt && Date.now() - lastFadeAt < 60 * 60 * 1000) return;
  await chrome.storage.session.set({ lastFadeAt: Date.now() });
  const { fadedCount } = await fadeExpiredTabs(settings);
  if (fadedCount) {
    console.log(`[TabSum] ${fadedCount} note(s) faded.`);
    await updateBadge();
  }
}

/**
 * Closing a tab promises "we kept the gist" — only an AI-written summary keeps that promise.
 */
function canCloseWith(summarySource, settings) {
  return settings.closeRequiresAiSummary === false || (summarySource && summarySource !== 'heuristic');
}

/**
 * Tell open extension pages (side panel "Closed today") that tabs were closed.
 * Replaces per-tab desktop notifications.
 */
function notifyTabsClosed() {
  chrome.runtime.sendMessage({ type: 'TABS_CLOSED' }).catch(() => {}); // no page open is fine
}

/**
 * Chrome refused a close/discard after the record was committed. If the tab is still
 * there, record why in `status`/`reason` and retry after another full timeout.
 */
async function revertIfStillOpen(tabId, recordId, status, reason) {
  try {
    await chrome.tabs.get(tabId);
  } catch {
    return; // tab is gone after all; the committed record stands
  }
  console.warn(`[TabSum] ${reason} (tab ${tabId}).`);
  await updateArchivedTabStatus(recordId, status, reason);
  await setTimestamp(tabId, Date.now());
}

/**
 * Hybrid tier 2: close a tab TabSum discarded earlier. No re-extraction (discarded tabs
 * can't be scripted); the record captured at discard time becomes the archive.
 */
async function closeDiscardedTab(tab, recordId, settings) {
  try {
    const record = await getTabById(recordId);
    if (!record || record.status !== 'discarded' || record.deletedAt) return;
    if (!canCloseWith(record.summarySource, settings)) return; // stays suspended

    await markTabClosed(recordId);
    const removed = await chrome.tabs.remove(tab.id).then(() => true, () => false);
    if (!removed) {
      await revertIfStillOpen(tab.id, recordId, 'discarded', 'Chrome refused to close this tab; it stays suspended');
      return;
    }
    console.log(`[TabSum] Closed long-discarded tab ${tab.id} (${tab.url}).`);
    notifyTabsClosed();
    await updateBadge();
  } catch (err) {
    console.error(`[TabSum] Error closing discarded tab ${tab.id}:`, err);
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

    // 2. Skip empty extractions and tabs with unsaved work; look again after another full timeout
    const extracted = results?.[0]?.result;
    if (!extracted) {
      console.warn(`[TabSum] Extraction returned empty for tab ${tab.id} (${tab.url})`);
      await setTimestamp(tab.id, Date.now());
      return;
    }
    if (extracted.isDirty) {
      console.log(`[TabSum] Tab ${tab.id} has unsaved work: ${extracted.reason}. Skipping.`);
      await setTimestamp(tab.id, Date.now());
      return;
    }

    // 3. Summarize content
    const summary = await summarizeContent(extracted, settings);

    // 4. TOCTOU Re-Check: Did user switch into tab or play audio while we were summarizing?
    //    Checked before anything is written, so an abort leaves no record behind.
    let currentTab;
    try {
      currentTab = await chrome.tabs.get(tab.id);
    } catch {
      return; // Tab was already closed by user
    }
    if (!currentTab || currentTab.active || currentTab.audible) {
      console.log(`[TabSum] Tab ${tab.id} became active or audible during processing. Aborting closure.`);
      return;
    }

    // 5. Soft Discard or Auto-Close based on Archive Mode
    let shouldClose = false;
    if (settings.archiveMode === 'close') {
      shouldClose = true;
    } else if (settings.archiveMode === 'discard') {
      shouldClose = false;
    } else {
      // 'hybrid' mode (default): close pure reading articles; suspend forms/SPAs/interactive tabs
      shouldClose = extracted.closureTier === 'safe_to_close';
    }
    let closureReason = extracted.closureReason || '';
    if (shouldClose && !canCloseWith(summary.source, settings)) {
      shouldClose = false;
      closureReason = 'Suspended instead of closed: no AI summary available';
    }

    // 6. Commit the final status BEFORE the destructive call, so a worker dying in
    //    between can't lose the archive.
    const record = await saveArchivedTab({
      url: extracted.url || tab.url,
      title: extracted.title || tab.title,
      domain: extracted.domain || extractDomain(tab.url),
      favIconUrl: extracted.favIconUrl || tab.favIconUrl,
      capturedAt: Date.now(),
      lastActiveAt: lastActiveTime,
      readingTimeMinutes: extracted.readingTimeMinutes || 1,
      summary,
      summarySource: summary.source,
      cleanText: extracted.cleanText || '',
      wordCount: extracted.wordCount || 0,
      status: shouldClose ? 'archived' : 'discarded',
      closedAt: shouldClose ? Date.now() : null,
      closureTier: extracted.closureTier || 'suspend_only',
      closureReason,
      meta: { ...extracted.meta, heuristicTags: summary.heuristicTags }
    });

    if (shouldClose) {
      const removed = await chrome.tabs.remove(tab.id).then(() => true, () => false);
      if (!removed) {
        await revertIfStillOpen(tab.id, record.id, 'captured', 'Chrome refused to close this tab; summary saved, tab left open');
        return;
      }
      await removeTimestamp(tab.id);
      notifyTabsClosed();
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
      // discard() resolves undefined when Chrome refuses to discard
      const discardedTab = await chrome.tabs.discard(tab.id).catch(() => null);
      if (!discardedTab) {
        await revertIfStillOpen(tab.id, record.id, 'captured', 'Chrome refused to suspend this tab; summary saved, tab left open');
        return;
      }
      await mapDiscardedRecord(discardedTab.id, record.id);
    }

    await updateBadge();
  } catch (err) {
    console.error(`[TabSum] Error archiving tab ${tab.id}:`, err);
  }
}

/**
 * Extract, summarize, and archive a tab immediately.
 * Invoked by keyboard shortcut command, UI button, or runtime message.
 * Archives even if the page reports unsaved work, since the tab stays open.
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
    summarySource: summary.source,
    cleanText: extracted.cleanText || '',
    wordCount: extracted.wordCount || 0,
    status: 'captured', // saved; the tab stays open
    closureTier: extracted.closureTier || 'safe_to_close',
    closureReason: 'Saved manually; tab left open',
    meta: { ...extracted.meta, heuristicTags: summary.heuristicTags }
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
    // Only reachable via a TRIGGER_COMMAND message; Chrome handles the real _execute_action key itself.
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

      // Test/debug hook: Playwright suites trigger sweeps with this.
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

      if (message.type === 'CLOSE_SIDE_PANEL') {
        try {
          if (chrome.sidePanel && typeof chrome.sidePanel.close === 'function') {
            const windowId = message.windowId || sender.tab?.windowId;
            if (windowId) {
              await chrome.sidePanel.close({ windowId });
            } else {
              const currentWin = await chrome.windows.getCurrent();
              await chrome.sidePanel.close({ windowId: currentWin.id });
            }
          }
          sendResponse({ success: true });
        } catch (err) {
          console.debug('[TabSum] Close side panel error:', err);
          sendResponse({ success: false, error: err.message });
        }
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
  const text = String(title || 'Page');
  const shortTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icons/icon-128.png'),
      title: 'Tab Archived to Wiki',
      message: `"${shortTitle}" summarized and saved to your knowledge base.`,
      silent: true
    });
  } catch (err) {
    console.debug('Notification error:', err);
  }
}
