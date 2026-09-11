/**
 * TabSum - Knowledge Hub controller.
 *
 * One page serves both Chrome's side panel and the full view in a tab. Layout adapts to
 * width in app.css (narrow: single column + Filters drawer; wide: sidebar + card grid).
 * Only a few controls depend on the surface: "Archive current tab" and "Open full view"
 * exist in the side panel only (in a tab, the current tab is TabSum itself).
 *
 * Importable in Node for unit tests: all DOM/chrome access is behind the document guard.
 */

import {
  getArchivedTabs,
  getAllTags,
  getAllDomains,
  getStats,
  softDeleteTab,
  restoreDeletedTab,
  getTabById,
  toggleFavoriteTab,
  getSettings
} from '../storage/db.js';
import { escapeHtml, highlightSearch, faviconUrl, fadeChipHtml } from '../shared/html.js';
import {
  exportToMarkdown,
  exportToObsidianZip,
  exportToJSON,
  formatNoteSection,
  formatStandaloneNote,
  triggerDownload
} from '../shared/export.js';

const state = {
  surface: 'tab', // 'panel' | 'tab'
  view: '', // '' (all) | 'inbox' | 'reopened'
  time: '', // '' | 'today' | 'yesterday' | 'week' | 'favorites'
  tag: '',
  domain: '',
  query: '',
  sortBy: 'newest',
  density: 'comfortable' // 'comfortable' | 'compact'
};

const TIME_LABELS = { favorites: 'Favorites ⭐', today: 'Captured today', yesterday: 'Yesterday', week: 'Past 7 days' };
const DENSITY_KEY = 'sidepanel_density'; // pre-merge storage key, kept so saved preferences survive

let fadeSettings = null;
let tabsById = new Map();
let renderSeq = 0;
let selectedIndex = -1;
let searchTimer = null;
let toastTimer = null;
let readerTab = null;

const ICONS = {
  reopen: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>',
  star: '<svg width="14" height="14" viewBox="0 0 24 24" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
  reader: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  empty: '<svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'
};

const SKELETONS = '<div class="skeleton-card"><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:75%;height:16px"></div><div class="skeleton-line" style="height:32px"></div></div>'.repeat(3);

const $ = (id) => document.getElementById(id);

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // TabSum closes idle tabs in the background; refresh stats/feed/"Closed today" when that
  // happens. Must not call sendResponse or return true (no response expected here).
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'TABS_CLOSED') refresh();
  });
}

async function init() {
  // tabs.getCurrent() resolves undefined in the side panel and a Tab in a normal tab.
  let currentTab;
  try {
    currentTab = await chrome.tabs.getCurrent();
  } catch {}
  state.surface = currentTab ? 'tab' : 'panel';
  state.view = state.surface === 'panel' ? 'inbox' : '';
  document.body.dataset.surface = state.surface;
  document.querySelectorAll('.panel-only').forEach(el => { el.hidden = state.surface !== 'panel'; });

  setupEventListeners();
  syncControls();
  await loadDensity();
  checkPermissions();
  await refresh(true);
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------

async function refresh(showSkeletons = false) {
  await Promise.all([updateStats(), renderSidebarFilters(), renderClosedToday(), renderFeed(showSkeletons)]);
}

function currentFilters() {
  const favorites = state.time === 'favorites';
  return {
    query: state.query,
    tag: state.tag,
    domain: state.domain,
    timeRange: favorites ? '' : state.time,
    favoriteOnly: favorites,
    view: state.view
  };
}

async function updateStats() {
  const stats = await getStats();
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set('stat-total', stats.total);
  set('stat-today', stats.today);
  set('stat-time', `${stats.totalReadingMinutes}m`);
  set('count-all', stats.total);
  set('count-today', stats.today);
  set('count-favorites', stats.favorites || 0);
}

async function renderSidebarFilters() {
  const [tags, domains] = await Promise.all([getAllTags(), getAllDomains()]);
  const list = (items, key) => items.map(({ value, label, count }) =>
    `<button class="filter-item-btn${state[key] === value ? ' active' : ''}" data-${key}="${escapeHtml(value)}"><span>${escapeHtml(label)}</span><span class="badge">${count}</span></button>`
  ).join('') || '<p class="filter-empty">None yet</p>';
  $('sidebar-tags').innerHTML = list(tags.slice(0, 12).map(({ tag, count }) => ({ value: tag, label: `#${tag}`, count })), 'tag');
  $('sidebar-domains').innerHTML = list(domains.slice(0, 8).map(({ domain, count }) => ({ value: domain, label: domain, count })), 'domain');
}

function startOfLocalDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function renderClosedToday() {
  let tabs = [];
  try {
    tabs = await getArchivedTabs({ closedSince: startOfLocalDay(), limit: 50 });
  } catch (err) {
    console.debug('Failed to load closed-today tabs:', err);
  }
  $('closed-today-count').textContent = tabs.length;
  $('closed-today').hidden = tabs.length === 0;
  $('closed-today-list').innerHTML = tabs.map(tab => `
    <div class="closed-today-row">
      <img class="favicon" src="${escapeHtml(faviconUrl(tab.url))}" alt="">
      <div class="closed-today-info">
        <div class="closed-today-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
        <div class="closed-today-meta">
          <span class="closed-today-domain">${escapeHtml(tab.domain)}</span>
          ${tab.summary?.tldr ? `<span class="closed-today-tldr">${escapeHtml(tab.summary.tldr)}</span>` : ''}
        </div>
      </div>
      <button class="closed-today-reopen-btn" data-url="${escapeHtml(tab.url)}" data-id="${escapeHtml(tab.id)}">Reopen</button>
    </div>`).join('');
}

async function renderFeed(showSkeletons = false) {
  const feed = $('tabs-feed');
  const seq = ++renderSeq;
  if (showSkeletons || feed.children.length === 0) feed.innerHTML = SKELETONS;

  const [tabs, settings] = await Promise.all([
    getArchivedTabs({ ...currentFilters(), sortBy: state.sortBy, limit: 200 }),
    getSettings().catch(() => null)
  ]);
  if (seq !== renderSeq) return; // a newer render started while this one was loading
  fadeSettings = settings;
  tabsById = new Map(tabs.map(tab => [String(tab.id), tab]));
  setResultsCount(tabs.length);

  if (tabs.length === 0) {
    feed.innerHTML = emptyStateHtml();
    return;
  }
  feed.innerHTML = tabs.map(cardHtml).join('');
  if (selectedIndex >= 0) selectCard(selectedIndex);
}

function setResultsCount(n) {
  $('results-count').textContent = `${n} ${n === 1 ? 'summary' : 'summaries'}`;
}

function emptyStateHtml() {
  const hasFilter = Boolean(state.query || state.tag || state.domain || state.time);
  let title = 'Your knowledge wiki is ready';
  let desc = 'Tabs you leave open will be automatically distilled here' +
    (state.surface === 'panel' ? ', or click "Archive Current Tab" to save this page now.' : '.');
  if (state.view === 'inbox' && !hasFilter) {
    title = 'Inbox zero — nothing waiting.';
    desc = 'New captures land here until you reopen, star, or delete them.';
  } else if (hasFilter || state.view) {
    title = 'No matching summaries';
    desc = 'Try adjusting your search terms or filters.';
  }
  return `<div class="empty-state">${ICONS.empty}<div class="empty-title">${title}</div><div class="empty-desc">${desc}</div></div>`;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Status badge for a record: sleeping (discarded), reopened (restored), saved (captured:
 * summary saved but the tab is still open), otherwise archived. Tooltip = closureReason.
 * @param {Object} tab
 * @returns {string}
 */
export function getStatusBadge(tab) {
  const [cls, label, fallback] = {
    discarded: ['sleeping', '💤 Sleeping', 'Sleeping tab (RAM suspended)'],
    restored: ['restored', '↩ Reopened', 'Tab was reopened'],
    captured: ['captured', '📑 Saved', 'Summary saved; tab left open']
  }[tab.status] || ['archived', '🗄️ Archived', 'Archived to knowledge base'];
  return `<span class="badge-status ${cls}" title="${escapeHtml(tab.closureReason || fallback)}">${label}</span>`;
}

function starLabel(isFavorite) {
  return isFavorite ? 'Unstar' : 'Keep (never fades)';
}

function cardHtml(tab) {
  const q = state.query;
  const bullets = toSafeStringArray(tab.summary?.bullets);
  const tags = toSafeStringArray(tab.summary?.tags).map(t => t.replace(/^#/, ''));
  const star = starLabel(tab.isFavorite);
  return `
    <article class="tab-card" data-id="${escapeHtml(tab.id)}">
      <div class="card-header">
        <div class="card-source">
          <img class="favicon" src="${escapeHtml(faviconUrl(tab.url))}" alt="">
          <span class="card-domain">${highlightSearch(tab.domain, q)}</span>
          <span class="card-reading-time">${tab.readingTimeMinutes || 1}m read</span>
          ${getStatusBadge(tab)}
          ${fadeChipHtml(tab, fadeSettings, state.sortBy)}
        </div>
        <span class="card-time">${formatTimeAgo(tab.capturedAt)}</span>
      </div>
      <h3 class="card-title" title="${escapeHtml(tab.title)}">${highlightSearch(tab.title, q)}</h3>
      ${tab.summary?.tldr ? `<div class="card-tldr">${highlightSearch(tab.summary.tldr, q)}</div>` : ''}
      ${bullets.length ? `
        <button class="takeaways-toggle" type="button" aria-expanded="false"><span class="takeaways-chevron">▶</span> Key Takeaways (${bullets.length})</button>
        <ul class="card-bullets collapsed">${bullets.map(b => `<li>${highlightSearch(b, q)}</li>`).join('')}</ul>` : ''}
      ${tags.length ? `<div class="card-tags">${tags.map(t => `<button type="button" class="card-tag" data-tag="${escapeHtml(t)}" title="Filter by #${escapeHtml(t)}">#${highlightSearch(t, q)}</button>`).join('')}</div>` : ''}
      <div class="card-footer">
        <button class="restore-btn">${ICONS.reopen} Reopen Tab</button>
        <div class="card-actions">
          <button class="action-icon-btn star-btn${tab.isFavorite ? ' active' : ''}" title="${star}" aria-label="${star}">${ICONS.star}</button>
          <button class="action-icon-btn reader-btn" title="Reader view (full text)" aria-label="Reader view">${ICONS.reader}</button>
          <button class="action-icon-btn copy-btn" title="Copy summary (Markdown)" aria-label="Copy summary">${ICONS.copy}</button>
          <button class="action-icon-btn delete-btn" title="Delete summary" aria-label="Delete summary">${ICONS.trash}</button>
        </div>
      </div>
    </article>`;
}

async function onFeedClick(e) {
  const card = e.target.closest('.tab-card');
  const target = e.target.closest('button, .card-title');
  const tab = card && tabsById.get(card.dataset.id);
  if (!tab || !target || card.classList.contains('removing')) return;

  if (target.matches('.restore-btn, .card-title')) {
    await reopenTab(tab.url, tab.id);
  } else if (target.matches('.takeaways-toggle')) {
    const open = target.classList.toggle('open');
    target.setAttribute('aria-expanded', String(open));
    card.querySelector('.card-bullets')?.classList.toggle('collapsed', !open);
  } else if (target.matches('.star-btn')) {
    await toggleStar(tab, card, target);
  } else if (target.matches('.reader-btn')) {
    await openReader(tab);
  } else if (target.matches('.copy-btn')) {
    await copyText(formatNoteSection(tab), 'Copied summary Markdown!', target);
  } else if (target.matches('.delete-btn')) {
    await deleteCard(tab, card);
  } else if (target.matches('.card-tag')) {
    await applyFilters({ tag: target.dataset.tag, domain: '' });
  }
}

async function reopenTab(url, recordId) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'RESTORE_TAB', url, recordId });
    showToast(res?.restoredInPlace ? 'Focused existing sleeping tab!' : 'Tab reopened!');
  } catch (err) {
    showToast('Error reopening tab: ' + err.message, true);
  }
}

async function toggleStar(tab, card, btn) {
  try {
    const updated = await toggleFavoriteTab(tab.id);
    tab.isFavorite = updated ? updated.isFavorite : !tab.isFavorite;
  } catch (err) {
    console.error('Error toggling favorite:', err);
    showToast('Could not update favorite', true);
    return;
  }
  btn.classList.toggle('active', tab.isFavorite);
  btn.title = starLabel(tab.isFavorite);
  btn.setAttribute('aria-label', btn.title);
  showToast(tab.isFavorite ? 'Starred — kept forever' : 'Unstarred');
  updateStats();
  if (state.time === 'favorites' && !tab.isFavorite) {
    await renderFeed();
    return;
  }
  // The fade chip depends on isFavorite; refresh it without a full re-render.
  card.querySelector('.fade-chip')?.remove();
  card.querySelector('.card-source').insertAdjacentHTML('beforeend', fadeChipHtml(tab, fadeSettings, state.sortBy));
}

async function copyText(text, message, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Clipboard write failed:', err);
    showToast('Could not copy to clipboard', true);
    return;
  }
  showToast(message);
  btn.classList.add('copied');
  const label = btn.querySelector('.btn-label');
  const original = label?.textContent;
  if (label) label.textContent = '✓ Copied';
  setTimeout(() => {
    btn.classList.remove('copied');
    if (label) label.textContent = original;
  }, 1500);
}

/**
 * Delete is durable immediately (tombstone via softDeleteTab), with a 5-second Undo toast
 * that calls restoreDeletedTab.
 */
async function deleteCard(tab, card) {
  // Animate synchronously for instant feedback, before the IndexedDB write lands.
  card.classList.add('removing');
  try {
    await softDeleteTab(tab.id);
  } catch (err) {
    console.error('Error deleting tab:', err);
    card.classList.remove('removing');
    showToast('Error deleting summary', true);
    return;
  }
  clearSelection();
  setResultsCount($('tabs-feed').querySelectorAll('.tab-card:not(.removing)').length);
  updateStats();
  renderSidebarFilters();
  setTimeout(() => {
    card.remove();
    if (!$('tabs-feed').querySelector('.tab-card')) renderFeed();
  }, 260);

  showToast('Summary removed', false, async () => {
    hideToast();
    try {
      await restoreDeletedTab(tab.id);
    } catch (err) {
      console.error('Error restoring tab:', err);
    }
    await refresh();
    const restored = $('tabs-feed').querySelector(`.tab-card[data-id="${CSS.escape(String(tab.id))}"]`);
    if (restored) {
      restored.classList.add('undo-restored');
      restored.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => restored.classList.remove('undo-restored'), 1200);
    }
    showToast('Summary restored');
  }, 5000);
}

// ---------------------------------------------------------------------------
// Filters, search, view state
// ---------------------------------------------------------------------------

async function applyFilters(patch) {
  Object.assign(state, patch);
  clearSelection();
  closeDrawer();
  syncControls();
  await renderFeed();
}

/** Reflect `state` in every control (nav, view tabs, tag/domain lists, banner, sort). */
function syncControls() {
  document.querySelectorAll('.nav-item').forEach(item => {
    const active = item.dataset.time
      ? item.dataset.time === state.time
      : !state.time && item.dataset.view === state.view;
    item.classList.toggle('active', active);
  });
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  });
  document.querySelectorAll('#sidebar-tags [data-tag]').forEach(b => b.classList.toggle('active', b.dataset.tag === state.tag));
  document.querySelectorAll('#sidebar-domains [data-domain]').forEach(b => b.classList.toggle('active', b.dataset.domain === state.domain));

  const label = state.tag ? `Filtered by topic: #${state.tag}`
    : state.domain ? `Filtered by domain: ${state.domain}`
    : TIME_LABELS[state.time] ? `Filtered by: ${TIME_LABELS[state.time]}` : '';
  $('filter-banner').hidden = !label;
  $('filter-label').textContent = label;
  $('filters-btn').classList.toggle('has-filter', Boolean(label));
  $('sort-select').value = state.sortBy;
}

function updateSearchUI() {
  const hasText = $('search-input').value.length > 0;
  $('search-clear-btn').hidden = !hasText;
  $('search-kbd-hint').hidden = hasText;
}

async function clearSearch() {
  clearTimeout(searchTimer);
  const hadQuery = Boolean($('search-input').value || state.query);
  $('search-input').value = '';
  updateSearchUI();
  if (hadQuery) await applyFilters({ query: '' });
}

// ---------------------------------------------------------------------------
// Keyboard selection
// ---------------------------------------------------------------------------

function liveCards() {
  return Array.from(document.querySelectorAll('#tabs-feed .tab-card:not(.removing)'));
}

function selectCard(index) {
  const cards = liveCards();
  if (cards.length === 0) {
    selectedIndex = -1;
    return;
  }
  selectedIndex = Math.max(0, Math.min(index, cards.length - 1));
  cards.forEach((card, i) => card.classList.toggle('keyboard-selected', i === selectedIndex));
  cards[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearSelection() {
  selectedIndex = -1;
  document.querySelectorAll('#tabs-feed .keyboard-selected').forEach(c => c.classList.remove('keyboard-selected'));
}

// ---------------------------------------------------------------------------
// Drawer (narrow layout) and export menu
// ---------------------------------------------------------------------------

function openDrawer() {
  document.body.classList.add('drawer-open');
  $('filters-btn').setAttribute('aria-expanded', 'true');
  document.querySelector('#sidebar .nav-item.active, #sidebar .nav-item')?.focus();
}

function closeDrawer() {
  if (!document.body.classList.contains('drawer-open')) return;
  document.body.classList.remove('drawer-open');
  $('filters-btn').setAttribute('aria-expanded', 'false');
  if ($('sidebar').contains(document.activeElement)) $('filters-btn').focus();
}

function toggleExportMenu(open) {
  const menu = $('export-dropdown-menu');
  const shouldOpen = open ?? menu.hidden;
  menu.hidden = !shouldOpen;
  $('export-dropdown-btn').setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) menu.querySelector('.export-option-btn')?.focus();
}

/**
 * Export in the chosen format. Markdown / Obsidian respect the active search, view, tag,
 * domain and time filters; JSON is always a full backup. Formatting lives in shared/export.js.
 * @param {'markdown'|'obsidian'|'json'} format
 */
export async function performExport(format = 'markdown') {
  const tabs = format === 'json'
    ? await getArchivedTabs({ limit: Infinity, includeText: true })
    : await getArchivedTabs({ ...currentFilters(), limit: 10000 });

  if (!tabs.length) {
    const filtered = Boolean(state.query || state.tag || state.domain || state.time || state.view);
    showToast(filtered && format !== 'json' ? 'No summaries match the active filter to export.' : 'No summaries to export yet.');
    return;
  }
  const stamp = Date.now();
  if (format === 'json') {
    triggerDownload(exportToJSON(tabs), `tabsum-wiki-export-${stamp}.json`, 'application/json;charset=utf-8');
    showToast('Exported Wiki Backup (JSON)!');
  } else if (format === 'obsidian') {
    triggerDownload(exportToObsidianZip(tabs), `tabsum-obsidian-vault-${stamp}.zip`, 'application/zip');
    showToast('Exported Obsidian vault (.zip)!');
  } else {
    triggerDownload(exportToMarkdown(tabs), `tabsum-wiki-export-${stamp}.md`, 'text/markdown;charset=utf-8');
    showToast('Exported Wiki to Markdown!');
  }
}

// ---------------------------------------------------------------------------
// Reader view
// ---------------------------------------------------------------------------

async function openReader(tab) {
  readerTab = tab;
  const dialog = $('reader-dialog');
  $('modal-title').textContent = tab.title || 'Untitled Tab';
  const link = $('modal-source-link');
  link.textContent = tab.url || '';
  if (/^https?:\/\//i.test(tab.url)) link.href = tab.url; // only http(s) links are clickable
  else link.removeAttribute('href');
  $('modal-summary-box').innerHTML = `<strong>Summary Overview</strong><p>${escapeHtml(tab.summary?.tldr || 'No overview available')}</p>`;
  $('modal-text-content').innerHTML = '<p class="empty-article-text">Loading article text…</p>';
  dialog.showModal();

  // List results omit cleanText; fetch the full record for the article body.
  try {
    const full = await getTabById(tab.id);
    if (readerTab !== tab) return; // another card was opened while this one loaded
    readerTab = { ...tab, cleanText: full?.cleanText || '' };
    $('modal-text-content').innerHTML = formatExtractedArticle(readerTab.cleanText);
  } catch (err) {
    console.error('Failed to load full article text:', err);
    $('modal-text-content').innerHTML = formatExtractedArticle('');
  }
}

/**
 * Format raw article snapshot text into readable semantic HTML paragraphs and headings.
 * @param {string} text
 * @returns {string} HTML string
 */
export function formatExtractedArticle(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return '<p class="empty-article-text">No snapshot text saved for this article.</p>';
  }
  return text.split(/\n\s*\n+/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length + 1; // # -> h2 ... #### -> h5
      return `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
    }
    if (/^>\s*(.+)$/s.test(trimmed)) {
      return `<blockquote>${escapeHtml(trimmed.replace(/^>\s*/gm, ''))}</blockquote>`;
    }
    return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Surface-level actions, density, permissions
// ---------------------------------------------------------------------------

async function closeSidePanel() {
  try {
    const win = await chrome.windows.getCurrent();
    if (chrome.sidePanel?.close && win?.id) await chrome.sidePanel.close({ windowId: win.id });
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

async function archiveCurrentTab(btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Archiving...';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ARCHIVE_ACTIVE_TAB' });
    if (response?.success) {
      showToast('Tab archived & summarized!');
      await refresh();
    } else {
      showToast(response?.error || 'Could not archive tab', true);
    }
  } catch (err) {
    showToast('Error archiving tab: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

async function loadDensity() {
  try {
    const data = await chrome.storage.local.get(DENSITY_KEY);
    if (data[DENSITY_KEY] === 'compact' || data[DENSITY_KEY] === 'comfortable') state.density = data[DENSITY_KEY];
  } catch (err) {
    console.debug('Failed to load density preference:', err);
  }
  applyDensity();
}

function applyDensity() {
  const compact = state.density === 'compact';
  $('tabs-feed').classList.toggle('compact', compact);
  const btn = $('density-toggle-btn');
  btn.classList.toggle('active', compact);
  btn.setAttribute('aria-pressed', String(compact));
  btn.title = compact ? 'Switch to Comfortable View' : 'Switch to Compact View';
}

async function checkPermissions() {
  try {
    $('perm-banner').hidden = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch (err) {
    console.debug('Permission check error:', err);
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function showToast(message, isError = false, onUndo = null, duration = 2600) {
  const toast = $('toast');
  const undoBtn = $('toast-undo-btn');
  const progress = $('toast-progress');
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  toast.classList.toggle('error', isError);
  undoBtn.hidden = !onUndo;
  undoBtn.onclick = onUndo ? (e) => { e.stopPropagation(); onUndo(); } : null;
  // Restart the countdown bar animation (force reflow between resets).
  progress.style.animation = 'none';
  void progress.offsetWidth;
  progress.style.animation = onUndo ? `toastCountdown ${duration}ms linear forwards` : 'none';
  toast.classList.remove('hidden');
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.add('hidden');
  $('toast-progress').style.animation = 'none';
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function setupEventListeners() {
  const searchInput = $('search-input');
  const feed = $('tabs-feed');

  // CSP forbids inline onerror handlers; hide broken favicons via one capturing listener.
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('favicon')) e.target.hidden = true;
  }, true);

  feed.addEventListener('click', onFeedClick);
  $('closed-today-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.closed-today-reopen-btn');
    if (btn) reopenTab(btn.dataset.url, btn.dataset.id);
  });

  // Surface-specific actions
  $('archive-current-btn').addEventListener('click', (e) => archiveCurrentTab(e.currentTarget));
  $('open-full-btn').addEventListener('click', async () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
    await closeSidePanel();
  });
  $('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('enable-perm-btn').addEventListener('click', async () => {
    try {
      if (await chrome.permissions.request({ origins: ['<all_urls>'] })) {
        $('perm-banner').hidden = true;
        showToast('Extraction permissions enabled!');
      }
    } catch (err) {
      console.error('Permission request failed:', err);
    }
  });

  // Drawer
  $('filters-btn').addEventListener('click', openDrawer);
  $('drawer-close-btn').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);

  // Filters
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => applyFilters({
    time: item.dataset.time || '',
    view: item.dataset.time ? '' : item.dataset.view,
    tag: '',
    domain: ''
  })));
  document.querySelectorAll('.view-tab-btn').forEach(btn => btn.addEventListener('click', () => applyFilters({ view: btn.dataset.view, time: '' })));
  $('sidebar-tags').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (btn) applyFilters({ tag: state.tag === btn.dataset.tag ? '' : btn.dataset.tag, domain: '' });
  });
  $('sidebar-domains').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-domain]');
    if (btn) applyFilters({ domain: state.domain === btn.dataset.domain ? '' : btn.dataset.domain, tag: '' });
  });
  $('clear-filter-btn').addEventListener('click', () => applyFilters({ tag: '', domain: '', time: '' }));
  $('sort-select').addEventListener('change', (e) => applyFilters({ sortBy: e.target.value }));

  $('density-toggle-btn').addEventListener('click', async () => {
    state.density = state.density === 'compact' ? 'comfortable' : 'compact';
    applyDensity();
    try {
      await chrome.storage.local.set({ [DENSITY_KEY]: state.density });
    } catch (err) {
      console.debug('Failed to save density preference:', err);
    }
  });

  // Search (200ms debounce)
  searchInput.addEventListener('input', () => {
    updateSearchUI();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters({ query: searchInput.value }), 200);
  });
  $('search-clear-btn').addEventListener('click', async () => {
    await clearSearch();
    searchInput.focus();
  });
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      // Reopen the top filtered result
      e.preventDefault();
      clearTimeout(searchTimer);
      await applyFilters({ query: searchInput.value });
      feed.querySelector('.restore-btn')?.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchInput.blur();
      selectCard(0);
    }
  });

  // Export dropdown
  const exportBtn = $('export-dropdown-btn');
  const exportMenu = $('export-dropdown-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });
  exportBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      toggleExportMenu(true);
    }
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.hidden && !exportMenu.contains(e.target)) toggleExportMenu(false);
  });
  exportMenu.addEventListener('keydown', (e) => {
    const options = Array.from(exportMenu.querySelectorAll('.export-option-btn'));
    const i = options.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also clear the search / close the drawer
      toggleExportMenu(false);
      exportBtn.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      options[(i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    } else if (e.key === 'Tab') {
      toggleExportMenu(false);
    }
  });
  exportMenu.querySelectorAll('.export-option-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    toggleExportMenu(false);
    await performExport(btn.dataset.format);
  }));

  // Reader dialog: close button, light-dismiss on backdrop, copy full note
  const dialog = $('reader-dialog');
  $('modal-close-btn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
    if (!inside) dialog.close();
  });
  $('modal-copy-btn').addEventListener('click', (e) => {
    if (readerTab) copyText(formatStandaloneNote(readerTab), 'Copied full note Markdown!', e.currentTarget);
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', async (e) => {
    if (dialog.open) return; // the <dialog> closes itself on Escape
    const el = document.activeElement;
    const typing = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
    const drawerOpen = document.body.classList.contains('drawer-open');

    if (e.key === 'Escape') {
      if (drawerOpen) return closeDrawer();
      searchInput.blur();
      clearSelection();
      await clearSearch();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!typing) {
        e.preventDefault();
        clearSelection();
        closeDrawer();
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
    if (typing || drawerOpen) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectCard(selectedIndex + 1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectCard(selectedIndex - 1);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && !el?.closest('button, a, summary')) {
      e.preventDefault();
      liveCards()[selectedIndex]?.querySelector('.restore-btn')?.click();
    }
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Legacy/imported bullets or tags may contain non-strings or null entries.
function toSafeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item !== null && item !== undefined)
    .map(item => String(item).trim())
    .filter(Boolean);
}

function formatTimeAgo(timestamp) {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
