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

let searchDebounceTimer = null;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      setupEventListeners();
      await refreshWiki();
    });
  } else {
    setupEventListeners();
    refreshWiki();
  }
}

function setupEventListeners() {
  // Search bar with 200ms debounce
  const searchInput = document.getElementById('wiki-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
      searchQuery = e.target.value;
      await renderGrid();
    }, 200);
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

  // Export Dropdown Action
  const exportDropdownBtn = document.getElementById('export-dropdown-btn');
  const exportDropdownMenu = document.getElementById('export-dropdown-menu');

  if (exportDropdownBtn && exportDropdownMenu) {
    const toggleMenu = (shouldOpen) => {
      const isCurrentlyOpen = !exportDropdownMenu.classList.contains('hidden');
      const open = shouldOpen !== undefined ? shouldOpen : !isCurrentlyOpen;
      exportDropdownMenu.classList.toggle('hidden', !open);
      exportDropdownBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        const firstOption = exportDropdownMenu.querySelector('.export-option-btn');
        if (firstOption) firstOption.focus();
      }
    };

    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!exportDropdownMenu.classList.contains('hidden')) {
        if (!exportDropdownBtn.contains(e.target) && !exportDropdownMenu.contains(e.target)) {
          toggleMenu(false);
        }
      }
    });

    // Keyboard support on dropdown trigger
    exportDropdownBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu(true);
      }
    });

    // Keyboard navigation inside dropdown menu
    exportDropdownMenu.addEventListener('keydown', (e) => {
      const options = Array.from(exportDropdownMenu.querySelectorAll('.export-option-btn'));
      const currentIndex = options.indexOf(document.activeElement);

      if (e.key === 'Escape') {
        e.preventDefault();
        toggleMenu(false);
        exportDropdownBtn.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % options.length;
        options[nextIndex].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        options[prevIndex].focus();
      } else if (e.key === 'Tab') {
        toggleMenu(false);
      }
    });

    // Option buttons click listeners
    const optionBtns = exportDropdownMenu.querySelectorAll('.export-option-btn');
    optionBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const format = btn.dataset.format;
        toggleMenu(false);
        await performWikiExport(format);
      });
    });
  }

  // Sidebar footer export button
  const sidebarExportBtn = document.getElementById('export-md-btn');
  if (sidebarExportBtn) {
    sidebarExportBtn.addEventListener('click', async () => {
      await performWikiExport('markdown');
    });
  }

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

    const isSleeping = tab.status === 'discarded';
    const statusBadge = isSleeping
      ? `<span class="badge-status sleeping" title="${escapeHtml(tab.closureReason || 'Sleeping tab (RAM suspended)')}">💤 Sleeping</span>`
      : `<span class="badge-status archived" title="${escapeHtml(tab.closureReason || 'Archived to knowledge base')}">🗄️ Archived</span>`;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-site-info">
          <img class="site-icon" src="${escapeHtml(faviconSrc)}" onerror="this.style.display='none'">
          <span class="site-domain">${escapeHtml(tab.domain)}</span>
          ${statusBadge}
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
    const handleRestore = async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'RESTORE_TAB',
        url: tab.url,
        recordId: tab.id
      });
      if (res?.restoredInPlace) {
        showToast('Focused existing sleeping tab!');
      } else {
        showToast('Tab reopened in a new tab!');
      }
    };

    card.querySelector('.wiki-card-title').addEventListener('click', handleRestore);
    card.querySelector('.restore-action-btn').addEventListener('click', handleRestore);

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

  // Strict scheme validation: only set href if http: or https:
  if (/^https?:\/\//i.test(tab.url)) {
    sourceLink.href = tab.url;
  } else {
    sourceLink.removeAttribute('href');
  }

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

/**
 * Format a single tab record as a Markdown or Obsidian note with YAML frontmatter
 * @param {Object} tab
 * @param {'markdown'|'obsidian'} [format='markdown']
 * @returns {string}
 */
export function formatSingleNote(tab, format = 'markdown') {
  const title = tab.title || 'Untitled Tab';
  const url = tab.url || '';
  
  let capturedAtIso = '';
  try {
    const rawDate = tab.capturedAt || tab.captured_at;
    const d = rawDate ? new Date(rawDate) : new Date();
    capturedAtIso = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    capturedAtIso = new Date().toISOString();
  }

  const readingTime = Number.isFinite(tab.readingTimeMinutes)
    ? tab.readingTimeMinutes
    : (Number.isFinite(tab.reading_time_minutes) ? tab.reading_time_minutes : 1);

  const rawTags = (tab.summary?.tags || [])
    .map(t => String(t).trim().replace(/^#/, ''))
    .filter(Boolean);

  let tagsFormatted;
  if (format === 'obsidian') {
    // For Obsidian: format tags as `#tag` and ensure frontmatter conforms to Obsidian YAML metadata standards
    tagsFormatted = `[${rawTags.map(t => `"#${t}"`).join(', ')}]`;
  } else {
    tagsFormatted = `[${rawTags.map(t => t.includes(' ') ? `"${t}"` : t).join(', ')}]`;
  }

  const tldr = tab.summary?.tldr || 'No overview available.';
  const bullets = tab.summary?.bullets || [];
  const bulletsContent = bullets.length > 0
    ? bullets.map(b => `- ${b}`).join('\n')
    : '- No key takeaways recorded';

  return `---
title: ${JSON.stringify(title)}
url: ${JSON.stringify(url)}
captured_at: "${capturedAtIso}"
reading_time_minutes: ${readingTime}
tags: ${tagsFormatted}
---
# ${title}
> TL;DR: ${tldr}

## Key Takeaways
${bulletsContent}

*Captured via TabSum*`;
}

/**
 * Trigger browser download using URL.createObjectURL(new Blob(...))
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 * @returns {boolean}
 */
export function triggerDownload(content, filename, mimeType = 'text/plain') {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch (err) {
    console.error('Download trigger failed:', err);
    return false;
  }
}

/**
 * Export tabs as consolidated Markdown or Obsidian note
 * @param {Array<Object>|Object} tabs
 * @param {'markdown'|'obsidian'} [format='markdown']
 * @returns {string} The formatted markdown string
 */
export function exportToMarkdown(tabs, format = 'markdown') {
  if (format === 'json') {
    return exportToJSON(tabs);
  }

  const tabList = Array.isArray(tabs) ? tabs : (tabs ? [tabs] : []);
  const mdContent = tabList.map(tab => formatSingleNote(tab, format)).join('\n\n');
  const filename = `tabsum-wiki-export-${Date.now()}.md`;

  triggerDownload(mdContent, filename, 'text/markdown;charset=utf-8');

  return mdContent;
}

/**
 * Export tabs as full structured database backup in JSON format
 * @param {Array<Object>|Object} tabs
 * @returns {string} The formatted JSON string
 */
export function exportToJSON(tabs) {
  const tabList = Array.isArray(tabs) ? tabs : (tabs ? [tabs] : []);
  const jsonContent = JSON.stringify(tabList, null, 2);
  const filename = `tabsum-wiki-export-${Date.now()}.json`;

  triggerDownload(jsonContent, filename, 'application/json;charset=utf-8');

  return jsonContent;
}

/**
 * Perform Wiki export for selected format
 * @param {'markdown'|'obsidian'|'json'} format
 */
export async function performWikiExport(format = 'markdown') {
  let tabs;
  if (format === 'json') {
    // Full structured database backup
    tabs = await getArchivedTabs({ limit: 10000 });
  } else if (searchQuery || currentTagFilter || currentDomainFilter || currentTimeFilter) {
    tabs = await getArchivedTabs({
      query: searchQuery,
      tag: currentTagFilter,
      domain: currentDomainFilter,
      timeRange: currentTimeFilter,
      limit: 10000
    });
    if (!tabs || tabs.length === 0) {
      tabs = await getArchivedTabs({ limit: 10000 });
    }
  } else {
    tabs = await getArchivedTabs({ limit: 10000 });
  }

  if (!tabs || tabs.length === 0) {
    showToast('No summaries to export yet.');
    return;
  }

  if (format === 'json') {
    exportToJSON(tabs);
    showToast('Exported Wiki Backup (JSON)!');
  } else if (format === 'obsidian') {
    exportToMarkdown(tabs, 'obsidian');
    showToast('Exported Wiki for Obsidian!');
  } else {
    exportToMarkdown(tabs, 'markdown');
    showToast('Exported Wiki to Markdown!');
  }
}
