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
  getTabById,
  toggleFavoriteTab,
  getSettings
} from '../storage/db.js';

let currentTimeFilter = '';
let currentTagFilter = '';
let currentDomainFilter = '';
let searchQuery = '';
let currentSortBy = 'newest';

let searchDebounceTimer = null;
let toastTimeout = null;
let activeReaderTab = null;
const pendingDeletes = new Map(); // tabId -> { timer, tabData, cardElement, nextSibling, parent }

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

  // Ensure any pending deletions are committed if the window unloads or closes
  const finalizeWikiDeletes = () => {
    for (const [tabId, entry] of pendingDeletes.entries()) {
      if (entry.timer) clearTimeout(entry.timer);
      deleteArchivedTab(tabId);
    }
    pendingDeletes.clear();
  };
  window.addEventListener('beforeunload', finalizeWikiDeletes);
  window.addEventListener('pagehide', finalizeWikiDeletes);
}

function setupEventListeners() {
  // Search bar with 200ms debounce and clear button
  const searchInput = document.getElementById('wiki-search');
  const searchClearBtn = document.getElementById('wiki-search-clear-btn');

  const updateClearBtnVisibility = () => {
    if (searchClearBtn) {
      if (searchInput.value.length > 0) {
        searchClearBtn.classList.remove('hidden');
      } else {
        searchClearBtn.classList.add('hidden');
      }
    }
  };

  searchInput.addEventListener('input', (e) => {
    updateClearBtnVisibility();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
      searchQuery = e.target.value;
      await renderGrid();
    }, 200);
  });

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', async () => {
      searchInput.value = '';
      searchQuery = '';
      updateClearBtnVisibility();
      searchInput.focus();
      await renderGrid();
    });
  }

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

  // Sort select
  const sortSelect = document.getElementById('wiki-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', async (e) => {
      currentSortBy = e.target.value;
      await renderGrid();
    });
  }

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

  // Modern HTML5 <dialog> Reader View Setup
  const readerDialog = document.getElementById('reader-dialog');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCopyBtn = document.getElementById('modal-copy-btn');

  if (readerDialog) {
    // Light-dismiss fallback: clicking backdrop closes dialog
    readerDialog.addEventListener('click', (event) => {
      if (event.target === readerDialog) {
        const rect = readerDialog.getBoundingClientRect();
        const isInDialog = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (!isInDialog) {
          readerDialog.close();
        }
      }
    });

    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => {
        readerDialog.close();
      });
    }

    if (modalCopyBtn) {
      modalCopyBtn.addEventListener('click', async () => {
        if (!activeReaderTab) return;
        const md = formatSingleNote(activeReaderTab, 'markdown');
        await navigator.clipboard.writeText(md);
        const originalHtml = modalCopyBtn.innerHTML;
        modalCopyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>✓ Copied</span>
        `;
        modalCopyBtn.classList.add('copied');
        showToast('Copied full note Markdown!');
        setTimeout(() => {
          modalCopyBtn.innerHTML = originalHtml;
          modalCopyBtn.classList.remove('copied');
        }, 1500);
      });
    }
  }
}

async function refreshWiki() {
  await updateCounts();
  await renderSidebarFilters();
  await renderGrid();
}

async function updateCounts() {
  const stats = await getStats();
  const allEl = document.getElementById('count-all');
  if (allEl) allEl.textContent = stats.total;

  const todayEl = document.getElementById('count-today');
  if (todayEl) todayEl.textContent = stats.today;

  const favEl = document.getElementById('count-favorites');
  if (favEl) {
    const favTabs = await getArchivedTabs({ favoriteOnly: true, limit: 10000 });
    favEl.textContent = favTabs.filter(t => !pendingDeletes.has(t.id)).length;
  }
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
  } else if (currentTimeFilter === 'favorites') {
    banner.classList.remove('hidden');
    label.textContent = `Filtered by: Favorites ⭐`;
  } else {
    banner.classList.add('hidden');
  }
}

async function renderGrid() {
  const container = document.getElementById('cards-container');
  const countLabel = document.getElementById('results-count');

  const isFavoritesOnly = currentTimeFilter === 'favorites';
  const rawTabs = await getArchivedTabs({
    query: searchQuery,
    tag: currentTagFilter,
    domain: currentDomainFilter,
    timeRange: isFavoritesOnly ? '' : currentTimeFilter,
    favoriteOnly: isFavoritesOnly,
    sortBy: currentSortBy,
    limit: 200
  });

  // Filter out any tabs that are currently staged for deletion
  const tabs = rawTabs.filter(t => !pendingDeletes.has(t.id));

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
    card.dataset.id = tab.id;

    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=32`;
    const bulletsHtml = (tab.summary?.bullets || [])
      .map(b => `<li>${highlightSearch(b, searchQuery)}</li>`)
      .join('');

    const tagsHtml = (tab.summary?.tags || [])
      .map(t => {
        const clean = t.replace(/^#/, '');
        return `<span class="wiki-tag-pill" data-tag="${escapeHtml(clean)}">#${highlightSearch(clean, searchQuery)}</span>`;
      })
      .join('');

    const isSleeping = tab.status === 'discarded';
    const statusBadge = isSleeping
      ? `<span class="badge-status sleeping" title="${escapeHtml(tab.closureReason || 'Sleeping tab (RAM suspended)')}">💤 Sleeping</span>`
      : `<span class="badge-status archived" title="${escapeHtml(tab.closureReason || 'Archived to knowledge base')}">🗄️ Archived</span>`;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-site-info">
          <img class="site-icon" src="${escapeHtml(faviconSrc)}" onerror="this.style.display='none'">
          <span class="site-domain">${highlightSearch(tab.domain, searchQuery)}</span>
          ${statusBadge}
        </div>
        <div class="card-top-right">
          <span class="card-reading-time">${tab.readingTimeMinutes || 1} min read</span>
          <button class="star-btn ${tab.isFavorite ? 'active' : ''}" title="${tab.isFavorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="Favorite">
            <svg width="15" height="15" viewBox="0 0 24 24" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </button>
        </div>
      </div>

      <h3 class="wiki-card-title">${highlightSearch(tab.title, searchQuery)}</h3>

      ${tab.summary?.tldr ? `<div class="wiki-card-tldr"><strong>TL;DR:</strong> ${highlightSearch(tab.summary.tldr, searchQuery)}</div>` : ''}

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

    // Star Toggle
    const starBtn = card.querySelector('.star-btn');
    starBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await toggleFavoriteTab(tab.id);
      tab.isFavorite = updated ? updated.isFavorite : !tab.isFavorite;
      starBtn.classList.toggle('active', tab.isFavorite);
      starBtn.title = tab.isFavorite ? 'Remove from favorites' : 'Add to favorites';
      showToast(tab.isFavorite ? 'Starred summary ⭐' : 'Removed from favorites');
      await updateCounts();
      if (currentTimeFilter === 'favorites' && !tab.isFavorite) {
        await renderGrid();
      }
    });

    // Reader View
    card.querySelector('.reader-btn').addEventListener('click', () => {
      openReaderModal(tab);
    });

    // Copy Markdown with Tactile Feedback
    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', async () => {
      const md = `## [${tab.title}](${tab.url})\n\n**TL;DR**: ${tab.summary?.tldr || ''}\n\n### Key Takeaways:\n${(tab.summary?.bullets || []).map(b => `- ${b}`).join('\n')}\n\n*Captured via TabSum*`;
      await navigator.clipboard.writeText(md);
      const originalHtml = copyBtn.innerHTML;
      const originalTitle = copyBtn.title;
      copyBtn.innerHTML = `
        <span class="copied-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          ✓ Copied
        </span>
      `;
      copyBtn.classList.add('copied');
      copyBtn.title = 'Copied!';
      showToast('Copied summary Markdown!');
      setTimeout(() => {
        copyBtn.innerHTML = originalHtml;
        copyBtn.classList.remove('copied');
        copyBtn.title = originalTitle;
      }, 1500);
    });

    // Staged deletion with 5-second undo
    card.querySelector('.delete-btn').addEventListener('click', () => {
      stageCardDeletion(tab, card);
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
  activeReaderTab = tab;
  const readerDialog = document.getElementById('reader-dialog');
  if (!readerDialog) return;

  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = tab.title || 'Untitled Tab';

  const sourceLink = document.getElementById('modal-source-link');
  if (sourceLink) {
    sourceLink.textContent = tab.url || '';
    // Strict scheme validation: only set href if http: or https:
    if (/^https?:\/\//i.test(tab.url)) {
      sourceLink.href = tab.url;
    } else {
      sourceLink.removeAttribute('href');
    }
  }

  const summaryBox = document.getElementById('modal-summary-box');
  if (summaryBox) {
    summaryBox.innerHTML = `
      <strong>Summary Overview</strong>
      <p style="margin-top:6px; color:var(--text-secondary);">${escapeHtml(tab.summary?.tldr || 'No overview available')}</p>
    `;
  }

  const textContent = document.getElementById('modal-text-content');
  if (textContent) {
    textContent.innerHTML = formatExtractedArticle(tab.cleanText);
  }

  if (typeof readerDialog.showModal === 'function') {
    readerDialog.showModal();
  } else {
    readerDialog.setAttribute('open', '');
  }
}

/**
 * Format raw article snapshot text into readable semantic HTML paragraphs and headings
 * @param {string} text
 * @returns {string} HTML string
 */
export function formatExtractedArticle(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return '<p class="empty-article-text">No snapshot text saved for this article.</p>';
  }

  const blocks = text.split(/\n\s*\n+/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';

    // Headings
    if (/^#\s+(.+)$/.test(trimmed)) {
      return `<h2>${escapeHtml(trimmed.replace(/^#\s+/, ''))}</h2>`;
    }
    if (/^##\s+(.+)$/.test(trimmed)) {
      return `<h3>${escapeHtml(trimmed.replace(/^##\s+/, ''))}</h3>`;
    }
    if (/^###\s+(.+)$/.test(trimmed)) {
      return `<h4>${escapeHtml(trimmed.replace(/^###\s+/, ''))}</h4>`;
    }
    if (/^####\s+(.+)$/.test(trimmed)) {
      return `<h5>${escapeHtml(trimmed.replace(/^####\s+/, ''))}</h5>`;
    }

    // Blockquote
    if (/^>\s*(.+)$/s.test(trimmed)) {
      return `<blockquote>${escapeHtml(trimmed.replace(/^>\s*/gm, ''))}</blockquote>`;
    }

    // Paragraph
    const formatted = escapeHtml(trimmed).replace(/\n/g, '<br>');
    return `<p>${formatted}</p>`;
  }).filter(Boolean).join('\n');
}

/**
 * Safely escapes HTML and highlights occurrences of query with <mark class="search-highlight">
 * @param {string} text
 * @param {string} query
 * @returns {string} Safe HTML string
 */
export function highlightSearch(text, query) {
  if (!text) return '';
  if (!query || typeof query !== 'string' || !query.trim()) {
    return escapeHtml(text);
  }
  const trimmed = query.trim();
  const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = String(text).split(regex);
  return parts.map(part => {
    if (part.toLowerCase() === trimmed.toLowerCase()) {
      return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
    }
    return escapeHtml(part);
  }).join('');
}

export function escapeHtml(str) {
  if (!str) return '';
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimeout);
  toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>`;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}

function showUndoToast(message, onUndo, duration = 5000, deferUntilClose = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimeout);

  const progressBarHtml = deferUntilClose ? '' : '<div class="toast-progress-bar"></div>';

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-undo-btn" id="toast-undo-action-btn">Undo</button>
    </div>
    ${progressBarHtml}
  `;
  toast.classList.remove('hidden');

  const undoBtn = toast.querySelector('#toast-undo-action-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      toast.classList.add('hidden');
      clearTimeout(toastTimeout);
      if (onUndo) onUndo();
    });
  }

  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/**
 * Stage card deletion (respecting deferDeletionsUntilClose setting)
 * @param {Object} tab
 * @param {HTMLElement} cardElement
 */
export async function stageCardDeletion(tab, cardElement) {
  const tabId = tab.id;
  if (pendingDeletes.has(tabId)) return;

  // Animate card removal
  cardElement.classList.add('removing');

  // Record DOM placement for restoration
  const nextSibling = cardElement.nextElementSibling;
  const parent = cardElement.parentElement;

  let settings = {};
  try {
    settings = await getSettings();
  } catch (err) {
    console.debug('Failed to get settings in stageCardDeletion:', err);
  }
  const deferUntilClose = Boolean(settings.deferDeletionsUntilClose);

  // Staged deletion timer (only if not deferred until close)
  let timer = null;
  if (!deferUntilClose) {
    timer = setTimeout(async () => {
      pendingDeletes.delete(tabId);
      if (cardElement.parentElement) {
        cardElement.remove();
      }
      await deleteArchivedTab(tabId);
      await updateCounts();
      await renderSidebarFilters();
    }, 5000);
  }

  pendingDeletes.set(tabId, {
    timer,
    tabData: tab,
    cardElement,
    nextSibling,
    parent,
    deferUntilClose
  });

  const toastMsg = deferUntilClose
    ? `Summary removed (${pendingDeletes.size} pending deletion on close)`
    : 'Summary removed from Wiki';
  const duration = deferUntilClose ? 8000 : 5000;

  showUndoToast(toastMsg, async () => {
    const pending = pendingDeletes.get(tabId);
    if (!pending) return;

    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pendingDeletes.delete(tabId);

    // Restore card into DOM
    if (pending.parent) {
      if (pending.nextSibling && pending.nextSibling.parentElement === pending.parent) {
        pending.parent.insertBefore(pending.cardElement, pending.nextSibling);
      } else {
        pending.parent.appendChild(pending.cardElement);
      }
    }

    // Reset styles & pulse highlight
    pending.cardElement.classList.remove('removing');
    pending.cardElement.classList.add('undo-restored');
    setTimeout(() => {
      pending.cardElement.classList.remove('undo-restored');
    }, 1200);

    showToast('Summary restored');
    await updateCounts();
    await renderSidebarFilters();
  }, duration, deferUntilClose);
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
