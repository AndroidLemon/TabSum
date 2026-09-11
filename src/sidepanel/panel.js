/**
 * TabSum - Side Panel Controller
 */

import { getArchivedTabs, getAllTags, getStats, deleteArchivedTab, updateTabStatus, getSettings } from '../storage/db.js';

let activeTagFilter = '';
let currentSearchQuery = '';
let currentSortBy = 'newest';
let currentDensity = 'comfortable'; // 'comfortable' | 'compact'

let searchDebounceTimer = null;
let selectedCardIndex = -1;
let toastTimeout = null;

// Staged deletion map: tabId -> { timer, tabData }
const pendingDeletes = new Map();
let lastDeletedTabId = null;

const TRASH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const UNDO_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 10h10a5 5 0 0 1 5 5v2M3 10l6-6M3 10l6 6"></path></svg>`;

function updateDeferredToast() {
  const count = pendingDeletes.size;
  if (count === 0) {
    hideToast();
    return;
  }
  const toastMsg = `${count} ${count === 1 ? 'item' : 'items'} pending deletion on close`;
  showToast(toastMsg, false, async () => {
    for (const [id] of pendingDeletes.entries()) {
      const targetCard = document.querySelector(`.tab-card[data-id="${id}"]`);
      if (targetCard) {
        targetCard.classList.remove('pending-deletion');
        const btn = targetCard.querySelector('.delete-btn');
        if (btn) {
          btn.classList.remove('is-undo');
          btn.title = 'Delete from Wiki';
          btn.setAttribute('aria-label', 'Delete from Wiki');
          btn.innerHTML = TRASH_SVG;
        }
        targetCard.classList.add('undo-restored');
        setTimeout(() => targetCard.classList.remove('undo-restored'), 1000);
      }
    }
    pendingDeletes.clear();
    await updateStats();
    hideToast();
    showToast('All deletions undone', false, null, 2000);
  }, 10000, true, 'Undo All');
}

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadDensityPreference();
  await checkPermissions();
  await refreshDashboard();
});

async function checkPermissions() {
  const permBanner = document.getElementById('perm-banner');
  try {
    const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (!hasPermission) {
      permBanner?.classList.remove('hidden');
    } else {
      permBanner?.classList.add('hidden');
    }
  } catch (err) {
    console.debug('Permission check error:', err);
  }
}

async function loadDensityPreference() {
  try {
    const data = await chrome.storage.local.get('sidepanel_density');
    if (data.sidepanel_density === 'compact' || data.sidepanel_density === 'comfortable') {
      currentDensity = data.sidepanel_density;
    }
  } catch (err) {
    console.debug('Failed to load density preference:', err);
  }
  updateDensityUI();
}

function updateDensityUI() {
  const btn = document.getElementById('density-toggle-btn');
  if (!btn) return;
  const isCompact = currentDensity === 'compact';
  btn.classList.toggle('active', isCompact);
  btn.setAttribute('aria-pressed', isCompact ? 'true' : 'false');
  btn.title = isCompact ? 'Switch to Comfortable View' : 'Switch to Compact View';
}

function updateSearchControlsUI() {
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchKbdHint = document.getElementById('search-kbd-hint');
  const hasText = Boolean(searchInput && searchInput.value.length > 0);

  if (searchClearBtn) {
    searchClearBtn.classList.toggle('hidden', !hasText);
  }
  if (searchKbdHint) {
    searchKbdHint.classList.toggle('hidden', hasText);
  }
}

function setupEventListeners() {
  // Permission banner grant button
  const enablePermBtn = document.getElementById('enable-perm-btn');
  if (enablePermBtn) {
    enablePermBtn.addEventListener('click', async () => {
      try {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (granted) {
          document.getElementById('perm-banner')?.classList.add('hidden');
          showToast('Extraction permissions enabled!');
        }
      } catch (err) {
        console.error('Permission request failed:', err);
      }
    });
  }

  // Open full wiki dashboard
  document.getElementById('open-wiki-btn')?.addEventListener('click', async () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/wiki/index.html') });
    try {
      const settings = await getSettings();
      if (settings.closeSidebarOnOpenDashboard !== false) {
        await closeSidePanel();
      }
    } catch (err) {
      console.debug('Failed to check closeSidebarOnOpenDashboard:', err);
    }
  });

  // Open settings
  document.getElementById('open-options-btn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Density toggle button
  const densityBtn = document.getElementById('density-toggle-btn');
  if (densityBtn) {
    densityBtn.addEventListener('click', async () => {
      currentDensity = currentDensity === 'comfortable' ? 'compact' : 'comfortable';
      updateDensityUI();
      try {
        await chrome.storage.local.set({ sidepanel_density: currentDensity });
      } catch (err) {
        console.debug('Failed to save density preference:', err);
      }
      const cards = document.querySelectorAll('#tabs-feed .tab-card');
      cards.forEach(card => card.classList.toggle('compact', currentDensity === 'compact'));
    });
  }

  // Archive current active tab
  const archiveBtn = document.getElementById('archive-current-btn');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      archiveBtn.disabled = true;
      archiveBtn.innerHTML = 'Archiving...';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'ARCHIVE_ACTIVE_TAB' });
        if (response && response.success) {
          showToast('Tab archived & summarized!');
          await refreshDashboard();
        } else {
          showToast(response?.error || 'Could not archive tab', true);
        }
      } catch (err) {
        showToast('Error archiving tab: ' + err.message, true);
      } finally {
        archiveBtn.disabled = false;
        archiveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Archive Current Tab`;
      }
    });
  }

  // Sweep now
  const sweepBtn = document.getElementById('sweep-now-btn');
  if (sweepBtn) {
    sweepBtn.addEventListener('click', async () => {
      sweepBtn.disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'TRIGGER_SWEEP_NOW' });
        showToast('Inactivity sweep executed');
        await refreshDashboard();
      } catch (err) {
        showToast('Sweep error: ' + err.message, true);
      } finally {
        sweepBtn.disabled = false;
      }
    });
  }

  // Search clear button
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchInput = document.getElementById('search-input');
  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', async () => {
      searchInput.value = '';
      currentSearchQuery = '';
      updateSearchControlsUI();
      clearKeyboardSelection();
      searchInput.focus();
      await renderFeed();
    });
  }

  // Search input with 200ms debounce
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      updateSearchControlsUI();
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
        currentSearchQuery = e.target.value;
        clearKeyboardSelection();
        await renderFeed();
      }, 200);
    });

    // Pressing Enter in the search bar restores/focuses the top filtered result
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        currentSearchQuery = searchInput.value;
        await renderFeed();
        const topRestoreBtn = document.querySelector('#tabs-feed .restore-btn');
        if (topRestoreBtn) {
          topRestoreBtn.focus();
          topRestoreBtn.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        const hadQuery = Boolean(searchInput.value || currentSearchQuery);
        searchInput.value = '';
        currentSearchQuery = '';
        updateSearchControlsUI();
        searchInput.blur();
        clearKeyboardSelection();
        if (hadQuery) {
          await renderFeed();
        }
      } else if (e.key === 'ArrowDown') {
        // Navigating down into the feed
        e.preventDefault();
        searchInput.blur();
        updateKeyboardSelection(0);
      }
    });
  }

  // Sort select
  const sortSelect = document.getElementById('panel-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', async (e) => {
      currentSortBy = e.target.value;
      clearKeyboardSelection();
      await renderFeed();
    });
  }

  // Global keyboard shortcuts within the Side Panel
  document.addEventListener('keydown', async (e) => {
    const activeEl = document.activeElement;
    const isTyping = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );

    // Pressing '/' focuses the search bar #search-input (unless already typing in an input or textarea)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isTyping && searchInput) {
        e.preventDefault();
        clearKeyboardSelection();
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // Pressing 'Escape' clears search and blurs input
    if (e.key === 'Escape') {
      clearTimeout(searchDebounceTimer);
      const hadQuery = Boolean(searchInput?.value || currentSearchQuery);
      if (searchInput) {
        searchInput.value = '';
        searchInput.blur();
      }
      currentSearchQuery = '';
      updateSearchControlsUI();
      clearKeyboardSelection();
      if (hadQuery) {
        await renderFeed();
      }
      return;
    }

    // Don't intercept navigation keys if user is typing
    if (isTyping) return;

    // j or ArrowDown -> navigate to next card
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      updateKeyboardSelection(selectedCardIndex + 1);
    }
    // k or ArrowUp -> navigate to previous card
    else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateKeyboardSelection(selectedCardIndex - 1);
    }
    // Enter -> reopen currently selected card
    else if (e.key === 'Enter') {
      const cards = Array.from(document.querySelectorAll('#tabs-feed .tab-card:not(.removing)'));
      if (selectedCardIndex >= 0 && selectedCardIndex < cards.length) {
        e.preventDefault();
        const selectedCard = cards[selectedCardIndex];
        const restoreBtn = selectedCard.querySelector('.restore-btn') || selectedCard.querySelector('.card-title');
        if (restoreBtn) {
          restoreBtn.click();
        }
      }
    }
  });

  // Finalize any staged deletions when the panel unloads or closes
  window.addEventListener('beforeunload', () => {
    finalizePendingDeletes();
  });
  window.addEventListener('pagehide', () => {
    finalizePendingDeletes();
  });
}

async function closeSidePanel() {
  try {
    await finalizePendingDeletes();
  } catch (err) {
    console.debug('Error finalizing deletes before close:', err);
  }

  try {
    const currentWin = await chrome.windows.getCurrent();
    if (chrome.sidePanel?.close && currentWin?.id) {
      await chrome.sidePanel.close({ windowId: currentWin.id });
    }
  } catch (err) {
    console.debug('chrome.sidePanel.close error:', err);
  }

  try {
    await chrome.runtime.sendMessage({ type: 'CLOSE_SIDE_PANEL' });
  } catch {}

  try {
    window.close();
  } catch {}
}

function updateKeyboardSelection(newIndex) {
  const cards = Array.from(document.querySelectorAll('#tabs-feed .tab-card:not(.removing)'));
  if (cards.length === 0) {
    selectedCardIndex = -1;
    return;
  }

  if (newIndex < 0) newIndex = 0;
  if (newIndex >= cards.length) newIndex = cards.length - 1;

  selectedCardIndex = newIndex;
  cards.forEach((card, idx) => {
    if (idx === selectedCardIndex) {
      card.classList.add('keyboard-selected');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      card.classList.remove('keyboard-selected');
    }
  });
}

function clearKeyboardSelection() {
  selectedCardIndex = -1;
  const cards = document.querySelectorAll('#tabs-feed .tab-card');
  cards.forEach(c => c.classList.remove('keyboard-selected'));
}

async function finalizePendingDeletes() {
  for (const [tabId, item] of pendingDeletes.entries()) {
    clearTimeout(item.timer);
    try {
      await deleteArchivedTab(tabId);
    } catch (err) {
      console.error('Error finalizing delete for tab', tabId, err);
    }
  }
  pendingDeletes.clear();
}

async function refreshDashboard() {
  await updateStats();
  await updateTagFilters();
  await renderFeed(true);
}

async function updateStats() {
  const stats = await getStats();
  const adjustedTotal = Math.max(0, stats.total - pendingDeletes.size);
  const adjustedToday = Math.max(0, stats.today - pendingDeletes.size);

  const totalEl = document.getElementById('stat-total');
  const todayEl = document.getElementById('stat-today');
  const timeEl = document.getElementById('stat-time');

  if (totalEl) totalEl.textContent = adjustedTotal;
  if (todayEl) todayEl.textContent = adjustedToday;
  if (timeEl) timeEl.textContent = `${stats.totalReadingMinutes}m`;
}

async function updateTagFilters() {
  const container = document.getElementById('tag-filters');
  if (!container) return;
  const tags = await getAllTags();

  if (tags.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = '';

  // "All" pill
  const allPill = document.createElement('button');
  allPill.className = `tag-pill ${activeTagFilter === '' ? 'active' : ''}`;
  allPill.textContent = 'All';
  allPill.addEventListener('click', async () => {
    activeTagFilter = '';
    updateActiveTagStyles();
    clearKeyboardSelection();
    await renderFeed();
  });
  container.appendChild(allPill);

  for (const { tag, count } of tags.slice(0, 10)) {
    const pill = document.createElement('button');
    pill.className = `tag-pill ${activeTagFilter === tag ? 'active' : ''}`;
    pill.textContent = `#${tag} (${count})`;
    pill.dataset.tag = tag;
    pill.addEventListener('click', async () => {
      activeTagFilter = activeTagFilter === tag ? '' : tag;
      updateActiveTagStyles();
      clearKeyboardSelection();
      await renderFeed();
    });
    container.appendChild(pill);
  }
}

function updateActiveTagStyles() {
  const pills = document.querySelectorAll('.tag-pill');
  pills.forEach(p => {
    if ((p.dataset.tag || '') === activeTagFilter) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

function renderSkeletons() {
  const feed = document.getElementById('tabs-feed');
  if (!feed) return;
  feed.innerHTML = Array(3).fill(0).map(() => `
    <div class="skeleton-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="skeleton-line" style="width: 32%;"></div>
        <div class="skeleton-line" style="width: 16%;"></div>
      </div>
      <div class="skeleton-line" style="width: 75%; height: 16px;"></div>
      <div class="skeleton-line" style="width: 100%; height: 32px; border-radius: 6px;"></div>
      <div style="display:flex; gap:6px;">
        <div class="skeleton-line" style="width: 50px; height: 18px; border-radius: 12px;"></div>
        <div class="skeleton-line" style="width: 60px; height: 18px; border-radius: 12px;"></div>
      </div>
    </div>
  `).join('');
}

async function renderFeed(showSkeletons = false) {
  const feed = document.getElementById('tabs-feed');
  if (!feed) return;

  if (showSkeletons || feed.children.length === 0) {
    renderSkeletons();
  }

  const tabs = await getArchivedTabs({
    query: currentSearchQuery,
    tag: activeTagFilter,
    sortBy: currentSortBy,
    limit: 50
  });

  const settings = await getSettings().catch(() => ({}));
  const deferUntilClose = Boolean(settings.deferDeletionsUntilClose);

  // Filter out any tabs with pending staged deletions only if deferUntilClose is FALSE.
  // If deferUntilClose is TRUE, we keep them so user can see them tinted red with undo action.
  const visibleTabs = deferUntilClose
    ? tabs
    : tabs.filter(tab => !pendingDeletes.has(tab.id));

  if (visibleTabs.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        <div class="empty-title">${currentSearchQuery || activeTagFilter ? 'No matching summaries' : 'Your knowledge wiki is ready'}</div>
        <div class="empty-desc">${currentSearchQuery || activeTagFilter ? 'Try adjusting your search terms or filters.' : 'Tabs you leave open will be automatically distilled here, or click "Archive Current Tab" to save this page now.'}</div>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';
  for (const tab of visibleTabs) {
    const isPendingDelete = deferUntilClose && pendingDeletes.has(tab.id);
    const card = document.createElement('div');
    card.className = currentDensity === 'compact' ? 'tab-card compact' : 'tab-card';
    if (isPendingDelete) {
      card.classList.add('pending-deletion');
    }
    card.dataset.id = tab.id;

    const timeAgo = formatTimeAgo(tab.capturedAt);
    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=32`;

    const bullets = tab.summary?.bullets || [];
    const bulletsHtml = bullets
      .map(b => `<li>${highlightSearch(b, currentSearchQuery)}</li>`)
      .join('');

    const tagsHtml = (tab.summary?.tags || [])
      .map(t => `<span class="card-tag">#${highlightSearch(t.replace(/^#/, ''), currentSearchQuery)}</span>`)
      .join('');

    const isSleeping = tab.status === 'discarded';
    const statusBadge = isSleeping
      ? `<span class="badge-status sleeping" title="${escapeHtml(tab.closureReason || 'Sleeping tab (RAM suspended)')}">💤 Sleeping</span>`
      : `<span class="badge-status archived" title="${escapeHtml(tab.closureReason || 'Archived to knowledge base')}">🗄️ Archived</span>`;

    const readingTimeMinutes = tab.readingTimeMinutes || 1;
    const readingTimeHtml = `<span class="card-reading-time">${readingTimeMinutes}m read</span>`;

    const takeawaysSection = bullets.length > 0
      ? `
        <button class="takeaways-toggle" type="button" aria-expanded="false" title="Toggle key takeaways">
          <span class="takeaways-chevron">▶</span>
          Key Takeaways (${bullets.length})
        </button>
        <ul class="card-bullets collapsed">${bulletsHtml}</ul>
      `
      : '';

    card.innerHTML = `
      <div class="card-header">
        <div class="card-source">
          <img class="card-favicon" src="${escapeHtml(faviconSrc)}" onerror="this.style.display='none'">
          <span class="card-domain">${highlightSearch(tab.domain, currentSearchQuery)}</span>
          ${readingTimeHtml}
          ${statusBadge}
        </div>
        <span class="card-time">${timeAgo}</span>
      </div>

      <div class="card-title" title="${escapeHtml(tab.title)}">${highlightSearch(tab.title, currentSearchQuery)}</div>

      ${tab.summary?.tldr ? `<div class="card-tldr">${highlightSearch(tab.summary.tldr, currentSearchQuery)}</div>` : ''}

      ${takeawaysSection}

      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}

      <div class="card-footer">
        <button class="restore-btn" data-url="${escapeHtml(tab.url)}" data-id="${tab.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
          Reopen Tab
        </button>
        <div class="card-actions">
          <button class="action-icon-btn copy-btn" title="Copy Summary" data-id="${tab.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="${isPendingDelete ? 'action-icon-btn delete delete-btn is-undo' : 'action-icon-btn delete delete-btn'}" title="${isPendingDelete ? 'Undo deletion' : 'Delete from Wiki'}" aria-label="${isPendingDelete ? 'Undo deletion' : 'Delete from Wiki'}" data-id="${tab.id}">
            ${isPendingDelete ? UNDO_SVG : TRASH_SVG}
          </button>
        </div>
      </div>
    `;

    // Progressive disclosure toggle event
    const takeawaysBtn = card.querySelector('.takeaways-toggle');
    if (takeawaysBtn) {
      takeawaysBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = takeawaysBtn.classList.toggle('open');
        takeawaysBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        const bulletsList = card.querySelector('.card-bullets');
        if (bulletsList) {
          bulletsList.classList.toggle('collapsed', !isOpen);
        }
      });
    }

    // Card Restore Action
    const handleRestore = async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'RESTORE_TAB',
        url: tab.url,
        recordId: tab.id
      });
      if (res?.restoredInPlace) {
        showToast('Focused existing sleeping tab!');
      } else {
        showToast('Tab reopened!');
      }
    };

    card.querySelector('.card-title')?.addEventListener('click', handleRestore);
    card.querySelector('.restore-btn')?.addEventListener('click', handleRestore);

    // Copy Summary
    card.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const summaryText = `# ${tab.title}\n${tab.url}\n\nTL;DR: ${tab.summary?.tldr || ''}\n\nKey Takeaways:\n${(tab.summary?.bullets || []).map(b => `- ${b}`).join('\n')}`;
      navigator.clipboard.writeText(summaryText);
      showToast('Copied summary to clipboard!');
    });

    // Deletion Handler (Deferred vs Standard 5-Second)
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tabId = tab.id;
        const currentSettings = await getSettings().catch(() => ({}));
        const defer = Boolean(currentSettings.deferDeletionsUntilClose);

        if (defer) {
          if (pendingDeletes.has(tabId)) {
            // Un-stage this single card
            pendingDeletes.delete(tabId);
            card.classList.remove('pending-deletion');
            deleteBtn.classList.remove('is-undo');
            deleteBtn.title = 'Delete from Wiki';
            deleteBtn.setAttribute('aria-label', 'Delete from Wiki');
            deleteBtn.innerHTML = TRASH_SVG;
            card.classList.add('undo-restored');
            setTimeout(() => card.classList.remove('undo-restored'), 1000);
            await updateStats();

            if (pendingDeletes.size === 0) {
              hideToast();
              showToast('Tab deletion undone', false, null, 2000);
            } else {
              updateDeferredToast();
            }
          } else {
            // Stage this card for deferred deletion
            pendingDeletes.set(tabId, { timer: null, tabData: tab, deferUntilClose: true });
            card.classList.add('pending-deletion');
            deleteBtn.classList.add('is-undo');
            deleteBtn.title = 'Undo deletion';
            deleteBtn.setAttribute('aria-label', 'Undo deletion');
            deleteBtn.innerHTML = UNDO_SVG;
            await updateStats();
            updateDeferredToast();
          }
          return;
        }

        // Standard 5-Second Staged Deletion (Option OFF)
        lastDeletedTabId = tabId;

        card.classList.add('removing');

        setTimeout(() => {
          if (card.parentNode) {
            card.remove();
          }
          const remaining = document.querySelectorAll('#tabs-feed .tab-card:not(.removing)');
          if (remaining.length === 0) {
            renderFeed();
          }
        }, 260);

        let timer = setTimeout(async () => {
          pendingDeletes.delete(tabId);
          if (lastDeletedTabId === tabId) {
            lastDeletedTabId = null;
          }
          try {
            await deleteArchivedTab(tabId);
            await updateStats();
          } catch (err) {
            console.error('Error deleting tab:', err);
          }
        }, 5000);

        pendingDeletes.set(tabId, { timer, tabData: tab, deferUntilClose: false });
        await updateStats();

        showToast('Tab removed from Wiki', false, async () => {
          const targetId = tabId;
          const pending = pendingDeletes.get(targetId);
          if (pending) {
            if (pending.timer) {
              clearTimeout(pending.timer);
            }
            pendingDeletes.delete(targetId);
            if (lastDeletedTabId === targetId) {
              lastDeletedTabId = null;
            }
            hideToast();
            await refreshDashboard();

            // Highlight the restored card
            const restoredCard = document.querySelector(`.tab-card[data-id="${targetId}"]`);
            if (restoredCard) {
              restoredCard.classList.add('keyboard-selected');
              restoredCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              setTimeout(() => {
                restoredCard.classList.remove('keyboard-selected');
              }, 1500);
            }
            showToast('Tab restored!');
          }
        }, 5000, false, 'Undo');
      });
    }

    feed.appendChild(card);
  }

  // Restore keyboard selection if active
  if (selectedCardIndex >= 0) {
    updateKeyboardSelection(selectedCardIndex);
  }
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Safely escapes HTML and wraps matching search terms in <mark class="search-highlight">
 */
function highlightSearch(text, query) {
  if (!text) return '';
  if (!query || !query.trim()) return escapeHtml(text);
  const trimmed = query.trim();
  const escaped = escapeRegex(trimmed);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = String(text).split(regex);
  return parts.map(part => {
    if (part.toLowerCase() === trimmed.toLowerCase()) {
      return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
    }
    return escapeHtml(part);
  }).join('');
}

function showToast(message, isError = false, undoCallback = null, duration = 2600, deferUntilClose = false, undoText = 'Undo') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const undoBtn = document.getElementById('toast-undo-btn');
  const progressBar = document.getElementById('toast-progress');

  if (!toast) return;

  clearTimeout(toastTimeout);

  if (toastMsg) {
    toastMsg.textContent = message;
  } else {
    toast.textContent = message;
  }

  toast.style.background = isError ? '#ef4444' : '#1e293b';

  // Handle undo button
  if (undoBtn) {
    if (undoCallback) {
      undoBtn.textContent = undoText;
      undoBtn.classList.remove('hidden');
      undoBtn.onclick = (e) => {
        e.stopPropagation();
        undoCallback();
      };
    } else {
      undoBtn.classList.add('hidden');
      undoBtn.onclick = null;
    }
  }

  // Handle countdown progress bar (suppressed if deferUntilClose is true)
  if (progressBar) {
    progressBar.classList.remove('running');
    progressBar.style.animation = 'none';
    // Force DOM reflow to restart CSS animation
    void progressBar.offsetWidth;
    if (undoCallback && duration > 0 && !deferUntilClose) {
      progressBar.style.animation = `toastCountdown ${duration}ms linear forwards`;
      progressBar.classList.add('running');
    }
  }

  toast.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    hideToast();
  }, duration);
}

function hideToast() {
  const toast = document.getElementById('toast');
  const progressBar = document.getElementById('toast-progress');
  if (toast) toast.classList.add('hidden');
  if (progressBar) {
    progressBar.classList.remove('running');
    progressBar.style.animation = 'none';
  }
  clearTimeout(toastTimeout);
}
