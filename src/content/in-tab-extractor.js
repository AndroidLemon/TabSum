/**
 * TabSum - In-Tab Content Extractor
 * Injected into background tabs via chrome.scripting.executeScript.
 * Runs in the isolated world against the live, hydrated DOM.
 */

(function extractPageContent() {
  // 1. Zero-Loss Safety Check: Inspect for dirty form inputs or active media
  function checkIsDirty() {
    // Check text inputs
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])');
    for (const input of inputs) {
      if (input.value && input.value.trim() !== '' && input.value !== input.defaultValue) {
        return { isDirty: true, reason: 'Unsaved form input detected' };
      }
    }

    // Check textareas
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.value && ta.value.trim() !== '' && ta.value !== ta.defaultValue) {
        return { isDirty: true, reason: 'Unsaved textarea content detected' };
      }
    }

    // Check contenteditable
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      if (el.innerText && el.innerText.trim().length > 5) {
        return { isDirty: true, reason: 'Unsaved editable text detected' };
      }
    }

    // Check playing audio or video
    const mediaElements = document.querySelectorAll('video, audio');
    for (const media of mediaElements) {
      if (!media.paused && !media.ended && media.currentTime > 0) {
        return { isDirty: true, reason: 'Active media playback detected' };
      }
    }

    return { isDirty: false };
  }

  const dirtyStatus = checkIsDirty();
  if (dirtyStatus.isDirty) {
    return {
      success: false,
      isDirty: true,
      reason: dirtyStatus.reason
    };
  }

  // 2. Extract Metadata
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
  const cleanTitle = rawTitle.replace(/\s*[-–|•]\s*[^–|-•]+$/, '').trim() || rawTitle;

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

  return {
    success: true,
    isDirty: false,
    isLowConfidence,
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
