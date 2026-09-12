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
    try {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch {
      return el.offsetParent !== null; // checkVisibility landed in Chrome 105
    }
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

    // Check rich-text editors, contenteditables, and modern web app editors
    const editables = queryAllDeep(
      '[contenteditable="true"], [role="textbox"], .ProseMirror, .monaco-editor, .ql-editor, .DraftEditor-root'
    );
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
    const candidateInputs = queryAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])')
      .filter(i => !isSearchInput(i) && isVisibleControl(i));
    const otherInputs = candidateInputs.filter(i => (i.getAttribute('type') || 'text').toLowerCase() !== 'email');
    const passwordInputs = otherInputs.filter(i => (i.getAttribute('type') || '').toLowerCase() === 'password');
    return {
      inputCounts: {
        textareas: queryAllDeep('textarea').filter(isVisibleControl).length,
        selects: queryAllDeep('select').filter(isVisibleControl).length,
        passwords: passwordInputs.length,
        appContainers: queryAllDeep(
          '[role="dialog"], [role="application"], [contenteditable="true"], [role="textbox"], .monaco-editor, .ProseMirror, .ql-editor'
        ).filter(isVisibleControl).length,
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
        search: window.location.search
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
