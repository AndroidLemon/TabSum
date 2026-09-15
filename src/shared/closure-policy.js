/**
 * TabSum - Closure Policy
 *
 * The one place that decides whether a tab is skipped, captured, closed or suspended.
 * Every function here is pure: no chrome.*, no storage, no async, no imports. The sweep
 * in service-worker.js keeps the side effects; this file keeps the rules, so the whole
 * ladder is testable in Node instead of only through a real browser.
 *
 * Two stages, because the decision genuinely spans an await:
 *   1. decideSweepAction  - triage an open tab before anything is injected.
 *   2. classifyClosureSafety + decideClosure - once the page has been read and summarized.
 */

/** Only a model-written summary keeps the "we kept the gist" promise a close makes. */
export const AI_SUMMARY_SOURCES = new Set(['gemini-api', 'openai-compatible', 'prompt-api']);

const UNSCRIPTABLE_SCHEME = /^(chrome|chrome-extension|about|edge|brave|view-source|data|file):/i;
const WEBSTORE = /chromewebstore\.google\.com|chrome\.google\.com\/webstore/i;

export function isScriptableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (UNSCRIPTABLE_SCHEME.test(url)) return false;
  if (WEBSTORE.test(url)) return false;
  return true;
}

/** The origin pattern chrome.permissions wants for a tab, or null if the URL won't parse. */
export function originPatternFor(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

function isExcludedDomain(domain, excludedDomains = []) {
  const d = String(domain || '').toLowerCase();
  if (!d) return false;
  return excludedDomains.some((ex) => {
    const e = String(ex).toLowerCase();
    return d === e || d.endsWith('.' + e);
  });
}

const skip = (reason) => ({ action: 'skip', reason });

/**
 * Stage 1: should the sweep touch this tab at all?
 *
 * ctx: { lastActive, now, settings, hasGlobalPermission, discardedRecordId, domain }
 *   domain is passed in rather than parsed here so extraction stays the caller's business.
 *
 * Returns one of:
 *   { action: 'skip', reason }
 *   { action: 're-evaluate-discarded', recordId, reason }  - hybrid tier 2; caller must load
 *       the record and run decideClosure, because the verdict depends on its summarySource.
 *   { action: 'capture', requiredOrigin, reason }  - requiredOrigin is null when the extension
 *       already holds <all_urls>; otherwise the caller must confirm that one origin first.
 */
export function decideSweepAction(tab, ctx = {}) {
  const { lastActive, now = Date.now(), settings = {}, hasGlobalPermission, discardedRecordId, domain } = ctx;

  if (tab.active) return skip('active tab');
  if (settings.ignorePinnedTabs !== false && tab.pinned) return skip('pinned tab');
  if (tab.audible) return skip('playing audio');
  if (isExcludedDomain(domain, settings.excludedDomains)) return skip('excluded domain');

  const timeoutMs = (settings.timeoutMinutes || 60) * 60 * 1000;
  const idleDuration = now - (lastActive ?? now);
  if (idleDuration < timeoutMs) return skip('not stale yet');

  // Discarded tabs can't be scripted. Hybrid's second tier closes tabs TabSum itself
  // suspended once they've sat unused for twice the timeout.
  if (tab.discarded) {
    if (settings.archiveMode === 'hybrid' && idleDuration >= 2 * timeoutMs && discardedRecordId) {
      return { action: 're-evaluate-discarded', recordId: discardedRecordId, reason: 'suspended past 2x timeout' };
    }
    return skip('already suspended');
  }

  if (!isScriptableUrl(tab.url)) return skip('unscriptable url');

  const staleReason = `stale by ${Math.round(idleDuration / 1000)}s`;
  if (hasGlobalPermission) return { action: 'capture', requiredOrigin: null, reason: staleReason };

  const requiredOrigin = originPatternFor(tab.url);
  if (!requiredOrigin) return skip('unparseable url');
  return { action: 'capture', requiredOrigin, reason: staleReason };
}

/**
 * Stage 2a: is this page safe to close, or only safe to suspend?
 *
 * Takes counts and URL parts, never a DOM: the extractor does the querying in the page
 * (where a real browser is the only honest test), the verdict is decided here.
 *
 * ponytail: ceiling - this can't tell a genuine single-field newsletter signup apart from
 * a one-field login form; both read as a lone "other" input and are allowed to close,
 * since neither has a textarea, select, password field, rich editor, or 3+ text inputs.
 */
export const READING_FLOOR_WORDS = 120;
// A player-dominated page needs real prose before it counts as readable.
// ponytail: one threshold, calibrated against a YouTube watch page (291 words)
// and a long article carrying two audio embeds (7,974). Upgrade path if it
// misfires: compare the player's rendered area against the viewport instead of
// leaning on word count.
export const MEDIA_READING_FLOOR_WORDS = 500;

export function classifyClosureSafety({ inputCounts = {}, urlParts = {}, wordCount = 0, hasMediaSurface = false } = {}) {
  const { textareas = 0, selects = 0, passwords = 0, appContainers = 0, otherInputs = 0 } = inputCounts;
  const pathname = String(urlParts.pathname || '').toLowerCase();
  const hash = String(urlParts.hash || '').toLowerCase();
  const search = String(urlParts.search || '').toLowerCase();
  const hashResolvesToAnchor = Boolean(urlParts.hashResolvesToAnchor);

  // 1. Real interactive controls (forms; lone search/email inputs are exempt upstream)
  if (textareas > 0 || selects > 0 || passwords > 0 || appContainers > 0 || otherInputs >= 3) {
    return { tier: 'suspend_only', reason: 'Contains form or interactive input controls' };
  }
  // 2. Stateful URL path or client-side hash routing
  // A deep link into documentation is not client-side routing: every anchored
  // docs URL used to land here, and the corpus only scored this rule at zero
  // because it contained no anchors.
  if ((hash.length > 3 && !hashResolvesToAnchor) ||
      pathname.includes('checkout') || pathname.includes('cart') || pathname.includes('account')) {
    return { tier: 'suspend_only', reason: 'Stateful URL path or client-side hash route' };
  }
  // 3. Multi-param search result listings (preserve the user's query state)
  if (search.includes('&') && (search.includes('q=') || search.includes('query=') || search.includes('filter='))) {
    return { tier: 'suspend_only', reason: 'Complex search/filter query state' };
  }
  // 4. Content density / readability confidence
  if (wordCount < (hasMediaSurface ? MEDIA_READING_FLOOR_WORDS : READING_FLOOR_WORDS)) {
    return {
      tier: 'suspend_only',
      reason: hasMediaSurface ? 'Media-dominated page with little prose' : 'Short or low-confidence content'
    };
  }
  return { tier: 'safe_to_close', reason: 'Pure stateless reading article' };
}

/** Closing promises the gist was kept; only a model-written summary keeps it. */
export function canCloseWith(summarySource, settings = {}) {
  return settings.closeRequiresAiSummary === false || AI_SUMMARY_SOURCES.has(summarySource);
}

/**
 * Stage 2b: close the tab, or suspend it and keep it in the strip?
 *
 * Note: a page with unsaved work never reaches here - the sweep aborts before summarizing,
 * so no record is written at all. This decides only between close and suspend.
 *
 * Returns { action: 'close' | 'suspend', reason }.
 */
export function decideClosure({ closureTier, summarySource, settings = {} } = {}) {
  let close;
  if (settings.archiveMode === 'close') close = true;
  else if (settings.archiveMode === 'discard') close = false;
  else close = closureTier === 'safe_to_close'; // 'hybrid' (default)

  if (close && !canCloseWith(summarySource, settings)) {
    return { action: 'suspend', reason: 'Suspended instead of closed: no AI summary available' };
  }
  return { action: close ? 'close' : 'suspend', reason: '' };
}

/**
 * Collapse one chrome.scripting.executeScript({ allFrames: true }) result set
 * into a single extraction.
 *
 * The top frame owns the tab's identity — url, title, metadata, prose, word
 * count. Subframes contribute two things only: unsaved work, and controls.
 *
 * Dirtiness is a veto and is OR-ed across EVERY frame regardless of size. An
 * iframe-hosted editor (TinyMCE, CKEditor, the WordPress classic editor) holds
 * the user's draft in a frame the top document cannot see, and missing it is
 * the data-loss case this merge exists to close.
 *
 * ponytail: control counts skip frames under MIN_COUNTABLE_FRAME_AREA so a 1x1
 * tracking pixel carrying a hidden form can't suspend every page that embeds
 * one. Upgrade path if ad frames still distort counts: have the extractor
 * report whether its frame is same-origin and weight cross-origin frames out.
 */
export const MIN_COUNTABLE_FRAME_AREA = 100 * 100;

export function mergeFrameExtractions(frameResults = []) {
  // frameId is read as-is. Do NOT default a missing one to 0: that would let an entry
  // that never identified itself win the top-frame lookup below, which is the very
  // substitution this merge refuses to make.
  const frames = (frameResults || []).filter((frame) => frame?.result?.success);
  if (!frames.length) return null;

  // The top frame IS the tab. If its injection threw, we have no url, title,
  // prose or dirty verdict for the page itself - only whatever subframes
  // survived. Standing an ad frame in for it would archive the wrong content
  // and, worse, report isDirty=false for a page whose unsaved state was never
  // read. Both callers treat null as "try again later", which is the honest answer.
  const top = frames.find((frame) => frame.frameId === 0);
  if (!top) return null;
  const merged = { ...top.result };

  const dirty = frames.find((frame) => frame.result.isDirty);
  merged.isDirty = Boolean(dirty);
  merged.reason = dirty ? dirty.result.reason : '';

  // One area gate for everything a subframe contributes except dirtiness. A 1x1
  // ad iframe must not inflate the control counts, and it must not flip
  // hasMediaSurface either: that raises the reading floor from 120 to 500 words,
  // so an autoplay pixel would quietly stop ordinary articles from closing.
  const countable = frames.filter(
    (frame) => frame === top || (frame.result.frameArea || 0) >= MIN_COUNTABLE_FRAME_AREA
  );

  const counts = { textareas: 0, selects: 0, passwords: 0, appContainers: 0, otherInputs: 0 };
  for (const frame of countable) {
    const frameCounts = frame.result.closureTelemetry?.inputCounts || {};
    for (const key of Object.keys(counts)) counts[key] += frameCounts[key] || 0;
  }
  merged.closureTelemetry = {
    ...top.result.closureTelemetry,
    inputCounts: counts,
    hasMediaSurface: countable.some((frame) => frame.result.closureTelemetry?.hasMediaSurface)
  };

  return merged;
}
