/**
 * TabSum - In-Tab Content Extractor
 * Injected into background tabs via chrome.scripting.executeScript.
 * Runs in the isolated world against the live, hydrated DOM.
 */

(function extractPageContent() {
  // Deep query helper to traverse open Shadow DOM roots
  function queryAllDeep(selector, root = document) {
    const elements = Array.from(root.querySelectorAll(selector));
    try {
      const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = treeWalker.currentNode;
      while (node) {
        if (node.shadowRoot) {
          elements.push(...queryAllDeep(selector, node.shadowRoot));
        }
        node = treeWalker.nextNode();
      }
    } catch {
      // TreeWalker fallback
    }
    return elements;
  }

  // A control the user cannot see is not a control the user is using: virtualized
  // editors park off-screen capture textareas, docs sites ship collapsed menus, and
  // clipboard shims hide a textarea per code block. The layout engine already knows
  // which is which, so ask it instead of guessing from value length.
  function isVisibleControl(el) {
    let rendered;
    try {
      rendered = el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch {
      // checkVisibility landed in Chrome 105. offsetParent is null for
      // position:fixed even when the element is plainly on screen, so a fixed
      // toolbar or docked editor panel must not be vetoed by it alone.
      try {
        rendered = el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
      } catch { rendered = true; }
    }
    if (!rendered) return false;

    // checkVisibility reports display/visibility/opacity/content-visibility, but
    // an element parked at left:-9999px is "visible" to it. Off-screen parking is
    // the standard clipboard-shim and virtualized-editor trick, so test the box
    // too. Only fully past the top or left origin counts — content below the fold
    // is off-viewport but genuinely on the page.
    //
    // The comparison MUST happen in document space. getBoundingClientRect is
    // viewport-relative, so on a page the user has scrolled down, every control
    // above the fold reports a negative bottom — including the editor they were
    // typing in one scroll ago. Reading the rect raw silently emptied the control
    // counts of every scrolled page and handed them to the closer.
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const pageX = window.scrollX || 0;
      const pageY = window.scrollY || 0;
      if (rect.right + pageX <= 0 || rect.bottom + pageY <= 0) return false;
    } catch { /* detached node: treat the render check as authoritative */ }
    return true;
  }

  function resolvesToAnchor(rawHash) {
    const id = (rawHash || '').replace(/^#/, '');
    if (!id) return false;
    // Browsers match the raw fragment first, then its percent-decoded form.
    const candidates = [id];
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) candidates.push(decoded);
    } catch { /* malformed escape: the raw form is all we can try */ }
    return candidates.some((value) => {
      if (document.getElementById(value)) return true;
      // Pre-HTML5 docs still anchor with <a name="...">, but ONLY an anchor counts:
      // every other name-bearing element is a form control, and honouring those
      // makes #search resolve on any page carrying a search box — turning an SPA
      // route into a "deep link into prose" and handing its state to the closer.
      return Array.from(document.getElementsByName(value)).some((el) => el.tagName === 'A');
    });
  }

  // Editor surfaces, split by what each consumer can ask of them.
  //
  // TEXT_EDITOR_SELECTOR is shared by the dirty check and the telemetry count.
  // These hold typed text, so `innerText` is meaningful and an unsaved draft in
  // one is data loss. The two lists had silently diverged: the dirty check never
  // learned about CodeMirror or Ace, so a draft in either read as clean.
  //
  // ponytail: the vendor half rots on a schedule -- every entry that falls out
  // of fashion is a silently closed tool. It earns its place because virtualized
  // editors deliberately break semantic DOM, rendering visible lines only and
  // parking an off-screen capture textarea, so nothing structural sees them.
  // Upgrade path when this bites: score a tool by off-screen-textarea + tall
  // scroll container rather than by class name.
  const TEXT_EDITOR_SELECTOR = [
    '[role="textbox"]', '[contenteditable]:not([contenteditable="false"])',
    '.monaco-editor', '.cm-editor', '.CodeMirror', '.ace_editor',
    '.ProseMirror', '.ql-editor', '.DraftEditor-root'
  ].join(', ');

  // APP_SURFACE_SELECTOR marks the tab as a tool but holds no typed text, so it
  // must never reach the dirty check: `innerText` on an open cookie banner would
  // mark every page carrying one as having unsaved work.
  //
  // [role="dialog"] stays, though not comfortably -- consent and newsletter
  // modals use it more than editors do, and the visibility gate cannot help since
  // an undismissed banner is visible by definition. Dropping it was tried and
  // reverted: on the corpus it is inert, so there was no evidence for the change,
  // and test_hybrid_mode.js asserts an open modal marks an app.
  // ponytail: if banners start costing recall, require the dialog to contain a
  // control rather than dropping the signal.
  const APP_SURFACE_SELECTOR = ['canvas', '[role="application"]', '[role="dialog"]'].join(', ');

  const EDITOR_SURFACE_SELECTOR = `${TEXT_EDITOR_SELECTOR}, ${APP_SURFACE_SELECTOR}`;


  // A select or toggle only means "data entry" if it sits in a real form. On its
  // own it is a docs version picker, a language switcher, or a CSS disclosure
  // hack driving a menu.
  //
  // "Real" is two tests, not one. A submit button is the obvious signal, but SPA
  // registration flows bind onChange and submit via fetch() with no submit button
  // at all — so a form carrying another data-entry control counts too. What stays
  // excluded is the lone picker: one control, no submit, no siblings.
  //
  // Counting a formless <select> that sits off its page-load default was tried
  // and REVERTED: docs.python.org sets its version pickers by script on load, so
  // "modified" is true before the user touches anything, and close recall fell
  // 88.6% -> 82.9% on exactly those two pages. The extractor runs long after load
  // and cannot tell a script's selection from a person's. The formless SPA select
  // holding real state therefore stays a known gap, not a fixed one.
  const FORM_DATA_ENTRY = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea';
  function isInMeaningfulForm(el) {
    const form = el.form;
    if (!form) return false;
    if (form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')) return true;
    return Array.from(form.querySelectorAll(FORM_DATA_ENTRY))
      .some(peer => peer !== el && !isSearchInput(peer) && isVisibleControl(peer));
  }

  // Shared search-input exclusion so the dirty check and the closure
  // classifier agree on what counts as a site search box (not user content).
  const SEARCH_INPUT_NAMES = new Set(['q', 'query', 'search', 's']);
  function isSearchInput(input) {
    if (input.getAttribute('role') === 'searchbox') return true;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (type === 'search') return true;
    return SEARCH_INPUT_NAMES.has((input.getAttribute('name') || '').toLowerCase());
  }

  // 1. Zero-Loss Safety Check: Inspect for dirty form inputs, rich editors, or active media
  function checkIsDirty() {
    // Compare each user-editable control with its page-load default (search bars excluded).
    // Not checked, because page scripts change them without the user and would block every close:
    // checkboxes/radios (Wikipedia's menus and appearance prefs are JS-set checkboxes) and
    // color/range (implicit non-empty defaults look like edits).
    const valueTypes = new Set(['text', 'email', 'url', 'tel', 'password', 'number', '',
      'date', 'datetime-local', 'month', 'time', 'week']);
    const inputs = queryAllDeep('input');
    for (const input of inputs) {
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      if (input.readOnly || input.disabled || isSearchInput(input)) {
        continue;
      }
      // Direct comparison, so clearing a prefilled field counts as an edit too
      if (valueTypes.has(type) && input.value !== input.defaultValue) {
        return { isDirty: true, reason: 'Unsaved form input detected' };
      }
      if (type === 'file' && input.files?.length) {
        return { isDirty: true, reason: 'Selected file upload detected' };
      }
    }

    // Check textareas (including in Shadow DOM)
    const textareas = queryAllDeep('textarea');
    for (const ta of textareas) {
      if (ta.readOnly || ta.disabled) continue;
      if (ta.value !== ta.defaultValue) {
        return { isDirty: true, reason: 'Unsaved textarea content detected' };
      }
    }

    // Check rich-text editors, contenteditables, and modern web app editors.
    // Same list the telemetry counts, so an editor that marks the tab a tool can
    // never be one the zero-loss guard has not heard of.
    const editables = queryAllDeep(TEXT_EDITOR_SELECTOR);
    for (const el of editables) {
      if (el.innerText && el.innerText.trim().length > 5) {
        return { isDirty: true, reason: 'Unsaved rich-text editor draft detected' };
      }
    }

    // Check active Picture-in-Picture
    if (document.pictureInPictureElement) {
      return { isDirty: true, reason: 'Active picture-in-picture video playing' };
    }

    // Check playing audio or video
    const mediaElements = queryAllDeep('video, audio');
    for (const media of mediaElements) {
      if (!media.paused && !media.ended && media.currentTime > 0) {
        return { isDirty: true, reason: 'Active media playback detected' };
      }
    }

    return { isDirty: false, reason: '' };
  }

  const dirtyStatus = checkIsDirty();

  // 2. Extract Metadata (always runs - dirty tabs are still fully described,
  // just never auto-closed; see the isDirty/reason fields on the result)
  function getMetaContent(selector) {
    const el = document.querySelector(selector);
    return el ? (el.getAttribute('content') || el.innerText || '').trim() : '';
  }

  const ogTitle = getMetaContent('meta[property="og:title"]') || getMetaContent('meta[name="twitter:title"]');
  const ogDesc = getMetaContent('meta[property="og:description"]') || getMetaContent('meta[name="description"]') || getMetaContent('meta[name="twitter:description"]');
  const ogImage = getMetaContent('meta[property="og:image"]') || getMetaContent('meta[name="twitter:image"]');
  const ogSite = getMetaContent('meta[property="og:site_name"]');
  const author = getMetaContent('meta[name="author"]') || getMetaContent('meta[property="article:author"]');

  // Favicon extraction
  let favIconUrl = '';
  const iconLink = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]');
  if (iconLink && iconLink.href) {
    favIconUrl = iconLink.href;
  } else {
    try {
      favIconUrl = `${window.location.origin}/favicon.ico`;
    } catch {
      favIconUrl = '';
    }
  }

  // Page Title
  const rawTitle = ogTitle || document.title || 'Untitled Document';

  // TITLE_SEPARATOR_REGEX: strip a trailing " <sep> Site Name" suffix, but only
  // when the separator is surrounded by whitespace (so "self-driving" survives)
  // and the suffix is short enough to plausibly be a site name, not real title text.
  const TITLE_SEPARATOR_REGEX = /\s+[-–—|•·]\s+(.{1,40})$/;
  let cleanTitle = rawTitle;
  const separatorMatch = rawTitle.match(TITLE_SEPARATOR_REGEX);
  if (separatorMatch) {
    const remainder = rawTitle.slice(0, separatorMatch.index).trim();
    if (remainder.length >= 3) {
      cleanTitle = remainder;
    }
  }

  // 3. Clean Content Extraction (Readability heuristic)
  function extractCleanText() {
    if (!document.body) return '';
    // Clone body so we don't modify the real page
    const clone = document.body.cloneNode(true);

    // Remove noise elements
    const unwanted = clone.querySelectorAll(
      'script, style, noscript, nav, header, footer, aside, form, svg, iframe, ' +
      '.ad, .ads, .advertisement, #cookie-banner, .cookie-notice, .consent-modal, ' +
      '.social-share, .newsletter-signup, .sidebar, [role="banner"], [role="navigation"]'
    );
    unwanted.forEach(el => el.remove());

    // Locate primary content container if present
    const article = clone.querySelector('article, main, [role="main"], .post-content, .article-content, .entry-content') || clone;

    // Collect meaningful text blocks
    const blocks = [];
    const elements = article.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, li');

    for (const el of elements) {
      const text = el.innerText ? el.innerText.trim() : '';
      // Exclude very short snippets and navigation boilerplate
      if (text.length > 20 && !/^(cookie|privacy policy|terms|sign in|subscribe|all rights reserved)/i.test(text)) {
        blocks.push(text);
      }
    }

    const fullText = blocks.join('\n\n');
    return fullText;
  }

  const cleanText = extractCleanText();
  const words = cleanText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // Low-confidence check: if text is under 150 words, preserve as quick bookmark without bad summary
  const isLowConfidence = wordCount < 150;

  // 4. Closure telemetry: count the controls and read the URL parts. The counting needs the
  //    live DOM so it has to happen here; turning it into a closure tier does not, so that
  //    lives in src/shared/closure-policy.js where a Node test can reach it.
  function collectClosureTelemetry() {
    const TOGGLE_TYPES = new Set(['checkbox', 'radio']);
    const typeOf = (i) => (i.getAttribute('type') || 'text').toLowerCase();
    const candidateInputs = queryAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])')
      .filter(i => !isSearchInput(i) && isVisibleControl(i))
      // A toggle outside a submittable form is site chrome, not user state.
      .filter(i => !TOGGLE_TYPES.has(typeOf(i)) || isInMeaningfulForm(i));
    const otherInputs = candidateInputs.filter(i => typeOf(i) !== 'email');
    const passwordInputs = otherInputs.filter(i => typeOf(i) === 'password');
    return {
      inputCounts: {
        textareas: queryAllDeep('textarea').filter(isVisibleControl).length,
        selects: queryAllDeep('select').filter(s => isVisibleControl(s) && isInMeaningfulForm(s)).length,
        passwords: passwordInputs.length,
        appContainers: queryAllDeep(EDITOR_SURFACE_SELECTOR).filter(isVisibleControl).length,
        otherInputs: otherInputs.length
      },
      // A page built around a player is not a reading page: its state is playback
      // position, which the URL does not carry, and a summary of a video's blurb
      // is a near-useless wiki entry. Presence alone means nothing though — a
      // long article may embed a podcast player — so the policy pairs this with
      // a higher density floor rather than treating it as a veto.
      hasMediaSurface: queryAllDeep('video, audio').some(isVisibleControl),
      urlParts: {
        pathname: window.location.pathname,
        hash: window.location.hash,
        search: window.location.search,
        // A hash is a client-side route only when nothing in the page answers to
        // it. `#installation` on a docs page is a deep link into prose the user
        // is reading; `#/orders/42` in an SPA is navigation state. Only the live
        // DOM can tell them apart, which is why this is telemetry and not a
        // policy-local check.
        hashResolvesToAnchor: resolvesToAnchor(window.location.hash)
      }
    };
  }

  const closureTelemetry = collectClosureTelemetry();

  return {
    success: true,
    isDirty: dirtyStatus.isDirty,
    reason: dirtyStatus.reason || '',
    isLowConfidence,
    closureTelemetry,
    url: window.location.href,
    frameArea: (window.innerWidth || 0) * (window.innerHeight || 0),
    title: cleanTitle,
    domain: window.location.hostname.replace(/^www\./, ''),
    favIconUrl,
    cleanText,
    wordCount,
    readingTimeMinutes,
    meta: {
      description: ogDesc,
      image: ogImage,
      siteName: ogSite,
      author: author
    }
  };
})();
