/**
 * TabSum - Full-Page Knowledge Wiki Dashboard Controller
 */

import {
  getArchivedTabs,
  getAllTags,
  getAllDomains,
  getStats,
  deleteArchivedTab,
  updateTabStatus,
  exportTabs,
  getTabById
} from '../storage/db.js';

let currentTimeFilter = '';
let currentTagFilter = '';
let currentDomainFilter = '';
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await refreshWiki();
});

function setupEventListeners() {
  // Search bar
  const searchInput = document.getElementById('wiki-search');
  searchInput.addEventListener('input', async (e) => {
    searchQuery = e.target.value;
    await renderGrid();
  });

  // Timeline navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      currentTimeFilter = item.dataset.time || '';
      currentTagFilter = '';
      currentDomainFilter = '';
      updateFilterBanner();
      await renderGrid();
    });
  });

  // Clear filter banner
  document.getElementById('clear-filter-btn').addEventListener('click', async () => {
    currentTagFilter = '';
    currentDomainFilter = '';
    currentTimeFilter = '';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-time=""]').classList.add('active');
    updateFilterBanner();
    await renderGrid();
  });

  // Export Markdown
  document.getElementById('export-md-btn').addEventListener('click', async () => {
    const md = await exportTabs('markdown');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TabSum_Knowledge_Export_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported Wiki to Markdown!');
  });

  // Settings
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Reader Modal Close
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('reader-modal').classList.add('hidden');
  });

  document.getElementById('reader-modal').addEventListener('click', (e) => {
    if (e.target.id === 'reader-modal') {
      document.getElementById('reader-modal').classList.add('hidden');
    }
  });
}

async function refreshWiki() {
  await updateCounts();
  await renderSidebarFilters();
  await renderGrid();
}

async function updateCounts() {
  const stats = await getStats();
  document.getElementById('count-all').textContent = stats.total;
  document.getElementById('count-today').textContent = stats.today;
}

async function renderSidebarFilters() {
  // Tags
  const tagsContainer = document.getElementById('sidebar-tags');
  const tags = await getAllTags();
  tagsContainer.innerHTML = '';

  for (const { tag, count } of tags.slice(0, 12)) {
    const btn = document.createElement('button');
    btn.className = `filter-item-btn ${currentTagFilter === tag ? 'active' : ''}`;
    btn.innerHTML = `<span>#${escapeHtml(tag)}</span><span class="badge">${count}</span>`;
    btn.addEventListener('click', async () => {
      currentTagFilter = currentTagFilter === tag ? '' : tag;
      currentDomainFilter = '';
      updateFilterBanner();
      await renderSidebarFilters();
      await renderGrid();
    });
    tagsContainer.appendChild(btn);
  }

  // Domains
  const domainsContainer = document.getElementById('sidebar-domains');
  const domains = await getAllDomains();
  domainsContainer.innerHTML = '';

  for (const { domain, count } of domains.slice(0, 8)) {
    const btn = document.createElement('button');
    btn.className = `filter-item-btn ${currentDomainFilter === domain ? 'active' : ''}`;
    btn.innerHTML = `<span>${escapeHtml(domain)}</span><span class="badge">${count}</span>`;
    btn.addEventListener('click', async () => {
      currentDomainFilter = currentDomainFilter === domain ? '' : domain;
      currentTagFilter = '';
      updateFilterBanner();
      await renderSidebarFilters();
      await renderGrid();
    });
    domainsContainer.appendChild(btn);
  }
}

function updateFilterBanner() {
  const banner = document.getElementById('filter-banner');
  const label = document.getElementById('filter-label');

  if (currentTagFilter) {
    banner.classList.remove('hidden');
    label.textContent = `Filtered by topic: #${currentTagFilter}`;
  } else if (currentDomainFilter) {
    banner.classList.remove('hidden');
    label.textContent = `Filtered by domain: ${currentDomainFilter}`;
  } else {
    banner.classList.add('hidden');
  }
}

async function renderGrid() {
  const container = document.getElementById('cards-container');
  const countLabel = document.getElementById('results-count');

  const tabs = await getArchivedTabs({
    query: searchQuery,
    tag: currentTagFilter,
    domain: currentDomainFilter,
    timeRange: currentTimeFilter,
    limit: 200
  });

  countLabel.textContent = `${tabs.length} ${tabs.length === 1 ? 'summary' : 'summaries'}`;

  if (tabs.length === 0) {
    container.innerHTML = `
      <div class="wiki-empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <h3>No summaries match your criteria</h3>
        <p>Try clearing filters or checking your open tabs in the Side Panel.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  for (const tab of tabs) {
    const card = document.createElement('article');
    card.className = 'wiki-card';

    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=32`;
    const bulletsHtml = (tab.summary?.bullets || [])
      .map(b => `<li>${escapeHtml(b)}</li>`)
      .join('');

    const tagsHtml = (tab.summary?.tags || [])
      .map(t => `<span class="wiki-tag-pill" data-tag="${escapeHtml(t.replace(/^#/, ''))}">#${escapeHtml(t.replace(/^#/, ''))}</span>`)
      .join('');

    card.innerHTML = `
      <div class="card-top">
        <div class="card-site-info">
          <img class="site-icon" src="${escapeHtml(faviconSrc)}" onerror="this.style.display='none'">
          <span class="site-domain">${escapeHtml(tab.domain)}</span>
        </div>
        <span class="card-reading-time">${tab.readingTimeMinutes || 1} min read</span>
      </div>

      <h3 class="wiki-card-title">${escapeHtml(tab.title)}</h3>

      ${tab.summary?.tldr ? `<div class="wiki-card-tldr"><strong>TL;DR:</strong> ${escapeHtml(tab.summary.tldr)}</div>` : ''}

      ${bulletsHtml ? `<ul class="wiki-card-bullets">${bulletsHtml}</ul>` : ''}

      ${tagsHtml ? `<div class="wiki-card-tags">${tagsHtml}</div>` : ''}

      <div class="wiki-card-footer">
        <button class="restore-action-btn" title="Open original tab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          Reopen Tab
        </button>
        <div class="card-subactions">
          <button class="subaction-btn reader-btn" title="Reader View (Full text)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
          </button>
          <button class="subaction-btn copy-btn" title="Copy Markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="subaction-btn delete delete-btn" title="Delete Summary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;

    // Events
    card.querySelector('.wiki-card-title').addEventListener('click', () => {
      chrome.tabs.create({ url: tab.url, active: true });
    });

    card.querySelector('.restore-action-btn').addEventListener('click', async () => {
      await chrome.tabs.create({ url: tab.url, active: true });
      await updateTabStatus(tab.id, 'restored');
      showToast('Tab reopened in a new tab!');
    });

    card.querySelector('.reader-btn').addEventListener('click', () => {
      openReaderModal(tab);
    });

    card.querySelector('.copy-btn').addEventListener('click', () => {
      const md = `## [${tab.title}](${tab.url})\n\n**TL;DR**: ${tab.summary?.tldr || ''}\n\n### Key Takeaways:\n${(tab.summary?.bullets || []).map(b => `- ${b}`).join('\n')}\n\n*Captured via TabSum*`;
      navigator.clipboard.writeText(md);
      showToast('Copied summary Markdown!');
    });

    card.querySelector('.delete-btn').addEventListener('click', async () => {
      await deleteArchivedTab(tab.id);
      showToast('Deleted summary');
      await refreshWiki();
    });

    card.querySelectorAll('.wiki-tag-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        currentTagFilter = pill.dataset.tag;
        updateFilterBanner();
        await renderSidebarFilters();
        await renderGrid();
      });
    });

    container.appendChild(card);
  }
}

function openReaderModal(tab) {
  const modal = document.getElementById('reader-modal');
  document.getElementById('modal-title').textContent = tab.title;
  const sourceLink = document.getElementById('modal-source-link');
  sourceLink.textContent = tab.url;
  sourceLink.href = tab.url;

  const summaryBox = document.getElementById('modal-summary-box');
  summaryBox.innerHTML = `
    <strong>Summary Overview</strong>
    <p style="margin-top:6px; color:var(--text-secondary);">${escapeHtml(tab.summary?.tldr || 'No overview available')}</p>
  `;

  document.getElementById('modal-text-content').textContent = tab.cleanText || 'No snapshot text saved.';
  modal.classList.remove('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}
