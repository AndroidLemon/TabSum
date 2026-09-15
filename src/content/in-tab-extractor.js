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
  //
  // `options.checkOpacity` defaults to true, so every control path is unchanged.
  // The prose harvest passes false: scroll-reveal pages animate paragraphs from
  // opacity:0, and a background tab never scrolls, so an opacity gate would drop
  // everything below the first screen. Written defensively rather than with a
  // destructuring default because this function is also passed bare to
  // Array#filter/#some, which hands it the array index as a second argument.
  function isVisibleControl(el, options) {
    const checkOpacity = !(options && options.checkOpacity === false);
    let rendered;
    try {
      rendered = el.checkVisibility({ checkOpacity, checkVisibilityCSS: true });
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
      // Still at or past the viewport origin: on screen under either reading.
      if (rect.right > 0 && rect.bottom > 0) return true;

      // Past the origin. For a position:fixed element that is the whole truth —
      // its rect is viewport-relative by definition and does not move with
      // scroll, so adding the scroll offset would "rescue" a toolbar genuinely
      // parked at top:-9999px on any page scrolled far enough.
      let fixed = false;
      try { fixed = getComputedStyle(el).position === 'fixed'; } catch { /* detached */ }
      if (fixed) return false;

      if (rect.right + (window.scrollX || 0) <= 0) return false;
      if (rect.bottom + (window.scrollY || 0) <= 0) return false;
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

  // designMode makes the whole document editable rather than a single element,
  // which is how classic TinyMCE/CKEditor turn an iframe into an editor
  // surface -- that iframe is a SUBFRAME, so the check is scoped to one.
  // Copy-enabler browser extensions set designMode='on' on the TOP document
  // of every page the user visits (to defeat copy-paste blockers), which
  // would otherwise mark every tab dirty regardless of what it contains.
  // TEXT_EDITOR_SELECTOR only ever matches elements, so it can never see this.
  //
  // One shared source, returning the surface as a list so the dirty check and
  // the telemetry count read the same rule instead of drifting apart.
  function designModeBody() {
    return window !== window.top && document.designMode === 'on' && document.body
      ? [document.body]
      : [];
  }

  // 1. Zero-Loss Safety Check: Inspect for dirty form inputs, rich editors, or active media
  function checkIsDirty() {
    // Compare each user-editable control with its page-load default (search bars excluded).
    // Not checked, because page scripts change them without the user and would block every close:
    // checkboxes/radios (Wikipedia's menus and appearance prefs are JS-set checkboxes) and
    // color/range (implicit non-empty defaults look like edits).
    // pkg.go.dev folds a "Run this example" textarea under a closed <details> for every
    // example (17 on net/http), value filled by script on load, so a pure docs page reported
    // unsaved work on every sweep and could never be archived. Content the page folded away
    // is not a draft. Deliberately narrower than "unrendered = clean": virtualized editors
    // park the draft in an off-screen textarea, and GitHub's comment box goes display:none in
    // Preview mode with the draft still inside it, so those must stay dirty.
    // ponytail: a user who opened the details, typed, and closed it again loses that draft.
    // Upgrade path: snapshot control values at document_idle and diff against those.
    const isFoldedAway = (el) => Boolean(el.closest('details:not([open])'));

    const valueTypes = new Set(['text', 'email', 'url', 'tel', 'password', 'number', '',
      'date', 'datetime-local', 'month', 'time', 'week']);
    const inputs = queryAllDeep('input');
    for (const input of inputs) {
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      if (input.readOnly || input.disabled || isSearchInput(input) || isFoldedAway(input)) {
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
      if (ta.readOnly || ta.disabled || isFoldedAway(ta)) continue;
      if (ta.value !== ta.defaultValue) {
        return { isDirty: true, reason: 'Unsaved textarea content detected' };
      }
    }

    // Check rich-text editors, contenteditables, and modern web app editors.
    // Same list the telemetry counts, so an editor that marks the tab a tool can
    // never be one the zero-loss guard has not heard of.
    const editables = [...queryAllDeep(TEXT_EDITOR_SELECTOR), ...designModeBody()];
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

  // Elements a prose block must not be found inside. Hoisted so the list is
  // defined once rather than rebuilt (or re-queried) per extraction, and shared
  // by nothing else today — it is the same set extractCleanText used to strip
  // from a detached clone, now checked live via closest() instead.
  const NOISE_SELECTOR = 'script, style, noscript, nav, header, footer, aside, form, svg, iframe, ' +
    '.ad, .ads, .advertisement, #cookie-banner, .cookie-notice, .consent-modal, ' +
    '.social-share, .newsletter-signup, .sidebar, [role="banner"], [role="navigation"]';

  // The prose harvest walks TEXT NODES, not elements, and groups each node by
  // its nearest block ancestor. Every text node is therefore counted exactly
  // once by construction: there is no containment rule, no leaf rule, and no
  // ancestor-coverage walk, because no two groups can ever claim the same node.
  // The element-based harvest this replaces had to disqualify a block that held
  // a nested block, which silently dropped that block's OWN text -- Hacker News
  // writes a comment as `<div class="commtext">first<p>second<p>third</div>`, so
  // the first paragraph of most comments was lost. Grouping by nearest ancestor
  // keeps "first" under the div and "second"/"third" under their own <p>s.
  //
  // The rendered test is per text node (asked of its parent element, cached),
  // so a visible <span> inside a visibility:hidden <p> still contributes while
  // the hidden text around it does not. It deliberately does NOT check opacity:
  // scroll-reveal pages start paragraphs at opacity:0 and a background tab never
  // scrolls, so an opacity gate would drop everything below the first screen.
  // The zero-box and off-screen-parking tests stay -- that is what keeps a
  // clipboard shim's textarea and a paragraph parked at left:-9999px out.
  const CONTAINER_SELECTOR = 'article, main, [role="main"], .post-content, .article-content, .entry-content';
  // Every tag that starts a new group. span/a/b/em/code and friends are absent
  // on purpose: they are inline, so their text joins the group of whatever
  // block they sit in rather than splitting a sentence in half.
  const GROUP_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, blockquote, li, td, th, dd, dt, div, figcaption, summary';
  // td/th/dd/dt/p/figcaption/summary hold legitimately short content (HN
  // titles, table cells, definition terms, image captions, <details> labels).
  // Inherited via closest(), not matched on the group's own tag: a wrapper
  // `<td><div class="d-flex">opened this issue</div></td>` is still a cell.
  // Everything else is floored at 20 characters, which is where nav lists,
  // inline labels and layout wrappers produce their short noise.
  const NO_FLOOR_SELECTOR = 'td, th, dd, dt, p, figcaption, summary';
  const BOILERPLATE_REGEX = /^(cookie|privacy policy|terms|sign in|subscribe|all rights reserved)/i;

  // 3. Clean Content Extraction (Readability heuristic)
  function extractCleanText() {
    if (!document.body) return '';

    // Walk the LIVE document instead of a detached clone. A clone is cheap to
    // build but costs layout, which is exactly what tells prose from chrome:
    // on a detached node, checkVisibility/getBoundingClientRect have nothing
    // to answer from, and clone.innerText === clone.textContent (measured) —
    // so hidden nav text leaked straight into the harvest.
    //
    // The container is picked from the PRUNED set, not the raw document order:
    // `<aside class="sidebar"><article>teaser</article></aside>` sitting above
    // the real `.entry-content` would otherwise win and the harvest would be
    // the teaser alone.
    //
    // The candidate must also be RENDERED: responsive sites ship a mobile/desktop
    // pair of duplicate containers and hide one with `display:none`, so a hidden
    // `<article>` that precedes the real `.entry-content` in document order would
    // otherwise win outright -- every text node under it then fails the per-node
    // rendered test and the harvest comes back empty.
    const renderedCache = new WeakMap();
    function isRendered(el) {
      if (renderedCache.has(el)) return renderedCache.get(el);
      const result = isVisibleControl(el, { checkOpacity: false });
      renderedCache.set(el, result);
      return result;
    }
    const root = Array.from(document.querySelectorAll(CONTAINER_SELECTOR))
      .find((el) => !el.closest(NOISE_SELECTOR) && isRendered(el)) || document.body;

    // Insertion order is DOM order of each group's first text node, so the
    // blocks come out in reading order without a sort.
    const groups = new Map();

    // closest() may climb past the root (root itself need not be a group tag),
    // so anything it finds outside the root falls back to the root's own group.
    function groupFor(el) {
      const group = el && el.closest(GROUP_SELECTOR);
      return group && root.contains(group) ? group : root;
    }
    function append(groupEl, text) {
      groups.set(groupEl, (groups.get(groupEl) || '') + text);
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          // REJECT skips the whole subtree, which is why no per-node
          // closest(NOISE_SELECTOR) is needed below.
          if (node.matches(NOISE_SELECTOR)) return NodeFilter.FILTER_REJECT;
          // <br> carries no text but does separate words; accept it so the
          // loop can note it, and skip every other element into its children.
          if (node.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        // A text node sitting DIRECTLY inside a shadow host is on the page only
        // if the shadow root slots it. GitHub writes
        // `<relative-time>Sep 14, 2026</relative-time>` and renders "2 days ago"
        // from its shadow root instead, leaving the light-DOM date laid out
        // nowhere -- and the host itself is rendered, so asking the parent is not
        // enough. (An unslotted light-DOM *element* needs no special case: it has
        // no box, so checkVisibility and the zero-box test already refuse it.)
        // ponytail: only OPEN roots are visible here; a closed host reports
        // shadowRoot === null, so its unslotted light-DOM fallback is harvested
        // exactly as the old clone did. Upgrade path if a closed-root page ever
        // matters: Range.getClientRects() per text node, at layout cost.
        if (parent && parent.shadowRoot && !node.assignedSlot) continue;
        if (parent && isRendered(parent)) append(groupFor(parent), node.nodeValue);
      } else {
        // A <br>: "Line one<br>Line two" must stay two words, not one.
        append(groupFor(node.parentElement), ' ');
      }
    }

    const blocks = [];
    for (const [groupEl, raw] of groups) {
      const text = raw.replace(/\s+/g, ' ').trim();
      // A lone "·" bullet cell or single glyph still shouldn't count as a word.
      const floor = groupEl.closest(NO_FLOOR_SELECTOR) ? 1 : 20;
      if (text.length > floor && !BOILERPLATE_REGEX.test(text)) {
        blocks.push(text);
      }
    }

    return blocks.join('\n\n');
  }

  // Subframes contribute unsaved work and controls; mergeFrameExtractions throws
  // their prose away and keeps the top frame's. Cloning and walking the body in
  // every ad frame on the page is pure cost, so don't.
  const isTopFrame = window.top === window.self;
  const cleanText = isTopFrame ? extractCleanText() : '';
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
        appContainers: [...queryAllDeep(EDITOR_SURFACE_SELECTOR), ...designModeBody()]
          .filter(isVisibleControl).length,
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
