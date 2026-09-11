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

  // 4. Tiered Hybrid Safety Classifier: Distinguish 'safe_to_close' vs 'suspend_only'
  function classifyClosureSafety(wordCount) {
    // ponytail: ceiling - this can't tell a genuine single-field newsletter
    // signup apart from a one-field login/account form; both read as a lone
    // "other" input and are allowed to close, since neither has a textarea,
    // select, password field, rich editor, or 3+ additional text inputs.
    const candidateInputs = queryAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])')
      .filter(i => !isSearchInput(i));
    const otherInputs = candidateInputs.filter(i => (i.getAttribute('type') || 'text').toLowerCase() !== 'email');
    const passwordInputs = otherInputs.filter(i => (i.getAttribute('type') || '').toLowerCase() === 'password');
    const selects = queryAllDeep('select');
    const textareas = queryAllDeep('textarea');
    const appContainers = queryAllDeep(
      '[role="dialog"], [role="application"], [contenteditable="true"], [role="textbox"], .monaco-editor, .ProseMirror, .ql-editor'
    );

    // Check 1: Real interactive controls (forms, and lone search/email inputs, are exempt)
    if (textareas.length > 0 || selects.length > 0 || passwordInputs.length > 0 || appContainers.length > 0 || otherInputs.length >= 3) {
      return {
        tier: 'suspend_only',
        reason: 'Contains form or interactive input controls'
      };
    }

    // Check 2: Stateful URL path or client-side hash routing
    const pathname = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    const search = window.location.search.toLowerCase();

    if (hash.length > 3 || pathname.includes('checkout') || pathname.includes('cart') || pathname.includes('account')) {
      return {
        tier: 'suspend_only',
        reason: 'Stateful URL path or client-side hash route'
      };
    }

    // Check 3: Complex multi-param search result listings (preserve user query state)
    if (search.includes('&') && (search.includes('q=') || search.includes('query=') || search.includes('filter='))) {
      return {
        tier: 'suspend_only',
        reason: 'Complex search/filter query state'
      };
    }

    // Check 4: Content density and readability confidence
    if (wordCount < 120) {
      return {
        tier: 'suspend_only',
        reason: 'Short or low-confidence content'
      };
    }

    // High-confidence, stateless reading material
    return {
      tier: 'safe_to_close',
      reason: 'Pure stateless reading article'
    };
  }

  const safetyClassification = classifyClosureSafety(wordCount);

  return {
    success: true,
    isDirty: dirtyStatus.isDirty,
    reason: dirtyStatus.reason || '',
    isLowConfidence,
    closureTier: safetyClassification.tier,
    closureReason: safetyClassification.reason,
    url: window.location.href,
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
