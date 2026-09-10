/**
 * TabSum - Side Panel Controller
 */

import { getArchivedTabs, getAllTags, getStats, deleteArchivedTab, updateTabStatus } from '../storage/db.js';

let activeTagFilter = '';
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await refreshDashboard();
});

function setupEventListeners() {
  // Open full wiki dashboard
  document.getElementById('open-wiki-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/wiki/index.html') });
  });

  // Open settings
  document.getElementById('open-options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Archive current active tab
  const archiveBtn = document.getElementById('archive-current-btn');
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

  // Sweep now
  const sweepBtn = document.getElementById('sweep-now-btn');
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

  // Search input
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', async (e) => {
    currentSearchQuery = e.target.value;
    await renderFeed();
  });
}

async function refreshDashboard() {
  await updateStats();
  await updateTagFilters();
  await renderFeed();
}

async function updateStats() {
  const stats = await getStats();
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-today').textContent = stats.today;
  document.getElementById('stat-time').textContent = `${stats.totalReadingMinutes}m`;
}

async function updateTagFilters() {
  const container = document.getElementById('tag-filters');
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

async function renderFeed() {
  const feed = document.getElementById('tabs-feed');
  const tabs = await getArchivedTabs({
    query: currentSearchQuery,
    tag: activeTagFilter,
    limit: 50
  });

  if (tabs.length === 0) {
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
  for (const tab of tabs) {
    const card = document.createElement('div');
    card.className = 'tab-card';

    const timeAgo = formatTimeAgo(tab.capturedAt);
    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=32`;

    const bulletsHtml = (tab.summary?.bullets || [])
      .map(b => `<li>${escapeHtml(b)}</li>`)
      .join('');

    const tagsHtml = (tab.summary?.tags || [])
      .map(t => `<span class="card-tag">#${escapeHtml(t.replace(/^#/, ''))}</span>`)
      .join('');

    card.innerHTML = `
      <div class="card-header">
        <div class="card-source">
          <img class="card-favicon" src="${escapeHtml(faviconSrc)}" onerror="this.style.display='none'">
          <span class="card-domain">${escapeHtml(tab.domain)}</span>
        </div>
        <span class="card-time">${timeAgo}</span>
      </div>

      <div class="card-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>

      ${tab.summary?.tldr ? `<div class="card-tldr">${escapeHtml(tab.summary.tldr)}</div>` : ''}

      ${bulletsHtml ? `<ul class="card-bullets">${bulletsHtml}</ul>` : ''}

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
          <button class="action-icon-btn delete delete-btn" title="Delete from Wiki" data-id="${tab.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;

    // Bind card events
    card.querySelector('.card-title').addEventListener('click', () => {
      chrome.tabs.create({ url: tab.url, active: true });
    });

    card.querySelector('.restore-btn').addEventListener('click', async () => {
      await chrome.tabs.create({ url: tab.url, active: true });
      await updateTabStatus(tab.id, 'restored');
      showToast('Tab reopened!');
    });

    card.querySelector('.copy-btn').addEventListener('click', () => {
      const summaryText = `# ${tab.title}\n${tab.url}\n\nTL;DR: ${tab.summary?.tldr || ''}\n\nKey Takeaways:\n${(tab.summary?.bullets || []).map(b => `- ${b}`).join('\n')}`;
      navigator.clipboard.writeText(summaryText);
      showToast('Copied summary to clipboard!');
    });

    card.querySelector('.delete-btn').addEventListener('click', async () => {
      await deleteArchivedTab(tab.id);
      showToast('Tab removed from Wiki');
      await refreshDashboard();
    });

    feed.appendChild(card);
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

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#ef4444' : '#1e293b';
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}
