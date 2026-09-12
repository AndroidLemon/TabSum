/**
 * TabSum - Closure Policy Unit Tests
 *
 * The whole closure ladder without a browser: every safety gate, the tier classifier and
 * the close-vs-suspend decision. Previously these branches were only reachable by launching
 * Chrome and backdating session storage.
 */

import assert from 'node:assert';
import {
  decideSweepAction,
  classifyClosureSafety,
  decideClosure,
  canCloseWith,
  isScriptableUrl,
  originPatternFor,
  mergeFrameExtractions,
  MIN_COUNTABLE_FRAME_AREA,
  READING_FLOOR_WORDS,
  MEDIA_READING_FLOOR_WORDS,
  AI_SUMMARY_SOURCES
} from '../src/shared/closure-policy.js';

console.log('--- Running TabSum Closure Policy Tests ---');

const MIN = 60 * 1000;
const settings = { timeoutMinutes: 60, archiveMode: 'hybrid', ignorePinnedTabs: true, excludedDomains: [] };
const now = 1_000_000_000_000;
const stale = now - 61 * MIN;
const fresh = now - 5 * MIN;

const tab = (over = {}) => ({ id: 1, url: 'https://example.com/article', active: false, pinned: false, audible: false, discarded: false, ...over });
const sweep = (t, ctx = {}) => decideSweepAction(t, { lastActive: stale, now, settings, hasGlobalPermission: true, domain: 'example.com', ...ctx });

// --- Gate ladder, in order -------------------------------------------------
console.log('Testing sweep gates...');
const gates = [
  ['active tab is never touched', tab({ active: true }), {}, 'skip'],
  ['pinned tab is skipped by default', tab({ pinned: true }), {}, 'skip'],
  ['audible tab is skipped', tab({ audible: true }), {}, 'skip'],
  ['fresh tab is not stale yet', tab(), { lastActive: fresh }, 'skip'],
  ['unscriptable scheme is skipped', tab({ url: 'chrome://settings' }), {}, 'skip'],
  ['the Web Store is skipped', tab({ url: 'https://chromewebstore.google.com/detail/x' }), {}, 'skip'],
  ['a stale ordinary tab is captured', tab(), {}, 'capture']
];
for (const [name, t, ctx, expected] of gates) {
  assert.strictEqual(sweep(t, ctx).action, expected, name);
}

// A pinned tab IS eligible once the user turns that guard off
assert.strictEqual(sweep(tab({ pinned: true }), { settings: { ...settings, ignorePinnedTabs: false } }).action, 'capture',
  'ignorePinnedTabs:false lets pinned tabs be swept');

// Excluded domains match the domain itself and its subdomains, but not a suffix lookalike
const excl = { settings: { ...settings, excludedDomains: ['Example.com'] } };
assert.strictEqual(sweep(tab(), { ...excl, domain: 'example.com' }).action, 'skip', 'exact domain excluded, case-insensitively');
assert.strictEqual(sweep(tab(), { ...excl, domain: 'mail.example.com' }).action, 'skip', 'subdomain excluded');
assert.strictEqual(sweep(tab(), { ...excl, domain: 'notexample.com' }).action, 'capture', 'suffix lookalike is not excluded');
console.log('✓ Gate ladder and exclusion matching verified');

// --- Host permission: the one gate that costs an await --------------------
console.log('Testing host permission handoff...');
assert.strictEqual(sweep(tab()).requiredOrigin, null, 'with <all_urls> no per-origin check is needed');
const scoped = sweep(tab(), { hasGlobalPermission: false });
assert.strictEqual(scoped.action, 'capture');
assert.strictEqual(scoped.requiredOrigin, 'https://example.com/*', 'policy hands back the pattern; the worker does the await');
assert.strictEqual(sweep(tab({ url: 'not a url' }), { hasGlobalPermission: false }).action, 'skip',
  'an unparseable URL is skipped when we need a per-origin grant');
assert.strictEqual(originPatternFor('https://a.b.co.uk:8443/x?y#z'), 'https://a.b.co.uk/*', 'port and path are dropped from the pattern');
console.log('✓ requiredOrigin handoff verified');

// --- Hybrid tier 2 --------------------------------------------------------
console.log('Testing hybrid tier 2...');
const discarded = tab({ discarded: true });
const t2 = sweep(discarded, { lastActive: now - 121 * MIN, discardedRecordId: 'rec-1' });
assert.strictEqual(t2.action, 're-evaluate-discarded', 'a suspended tab past 2x timeout is re-evaluated');
assert.strictEqual(t2.recordId, 'rec-1', 'the record id is carried through');
assert.strictEqual(sweep(discarded, { lastActive: now - 90 * MIN, discardedRecordId: 'rec-1' }).action, 'skip',
  'between 1x and 2x the timeout a suspended tab is left alone');
assert.strictEqual(sweep(discarded, { lastActive: now - 121 * MIN }).action, 'skip',
  'a suspended tab TabSum did not suspend is left alone');
assert.strictEqual(
  sweep(discarded, { lastActive: now - 121 * MIN, discardedRecordId: 'rec-1', settings: { ...settings, archiveMode: 'close' } }).action,
  'skip', 'tier 2 is hybrid-only');
console.log('✓ Tier 2 timing and mode gating verified');

// --- Tier classifier -----------------------------------------------------
console.log('Testing closure safety classifier...');
const article = { inputCounts: {}, urlParts: { pathname: '/blog/post', hash: '', search: '' }, wordCount: 500 };
const tierOf = (over) => classifyClosureSafety({ ...article, ...over }).tier;

assert.strictEqual(tierOf({}), 'safe_to_close', 'a long stateless article is safe to close');
for (const [field, value] of [['textareas', 1], ['selects', 1], ['passwords', 1], ['appContainers', 1], ['otherInputs', 3]]) {
  assert.strictEqual(tierOf({ inputCounts: { [field]: value } }), 'suspend_only', `${field}=${value} demotes to suspend_only`);
}
assert.strictEqual(tierOf({ inputCounts: { otherInputs: 2 } }), 'safe_to_close', 'two stray inputs still close (the documented ceiling)');
assert.strictEqual(tierOf({ wordCount: 119 }), 'suspend_only', 'under 120 words is low confidence');
assert.strictEqual(tierOf({ wordCount: 120 }), 'safe_to_close', '120 words is the threshold itself');
assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, hash: '#/route' } }), 'suspend_only', 'a hash route is stateful');
assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, hash: '#ab' } }), 'safe_to_close', 'a short anchor is not a route');
assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, search: '?q=x&page=2' } }), 'suspend_only', 'multi-param query state is preserved');
assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, search: '?q=x' } }), 'safe_to_close', 'a single query param is not state');

// Substring rules: these fire on words that merely contain the keyword. Asserted so that
// anyone tightening the rules sees exactly which pages change behaviour.
for (const path of ['/checkout', '/cart', '/account']) {
  assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, pathname: path } }), 'suspend_only', `${path} is stateful`);
}
for (const path of ['/cartography/maps', '/blog/descartes', '/accounting-software', '/account-of-the-siege']) {
  assert.strictEqual(tierOf({ urlParts: { ...article.urlParts, pathname: path } }), 'suspend_only',
    `KNOWN CEILING: ${path} is demoted by a substring match, not real state`);
}
// The demotion is the safe direction: it suspends rather than closes, so no state is lost.
assert.strictEqual(classifyClosureSafety().tier, 'suspend_only', 'missing telemetry fails closed');
console.log('✓ Classifier branches and substring ceiling verified');

// --- Close vs suspend ----------------------------------------------------
console.log('Testing closure decision...');
const ai = 'gemini-api';
const closeIn = (mode, tier, source, over = {}) =>
  decideClosure({ closureTier: tier, summarySource: source, settings: { ...settings, archiveMode: mode, ...over } }).action;

assert.strictEqual(closeIn('hybrid', 'safe_to_close', ai), 'close', 'hybrid closes safe articles');
assert.strictEqual(closeIn('hybrid', 'suspend_only', ai), 'suspend', 'hybrid suspends stateful pages');
assert.strictEqual(closeIn('close', 'suspend_only', ai), 'close', 'close mode ignores the tier');
assert.strictEqual(closeIn('discard', 'safe_to_close', ai), 'suspend', 'discard mode never closes');

// The AI gate overrides every mode
for (const mode of ['hybrid', 'close']) {
  const v = decideClosure({ closureTier: 'safe_to_close', summarySource: 'heuristic', settings: { ...settings, archiveMode: mode } });
  assert.strictEqual(v.action, 'suspend', `${mode} mode still refuses to close without an AI summary`);
  assert.match(v.reason, /no AI summary/, 'and says why, for the status badge tooltip');
}
assert.strictEqual(closeIn('close', 'safe_to_close', 'heuristic', { closeRequiresAiSummary: false }), 'close',
  'the user can turn the AI-summary requirement off');

for (const source of AI_SUMMARY_SOURCES) assert.ok(canCloseWith(source, settings), `${source} may close a tab`);
assert.ok(!canCloseWith('heuristic', settings), 'heuristic summaries may not close a tab');
assert.ok(!canCloseWith(undefined, settings), 'a missing source may not close a tab');
console.log('✓ Archive modes and the AI-summary gate verified');

assert.ok(isScriptableUrl('https://example.com'), 'https is scriptable');
assert.ok(!isScriptableUrl(''), 'an empty url is not scriptable');
assert.ok(!isScriptableUrl(null), 'a missing url is not scriptable');

// --- Media-dominated pages need real prose, not just any prose ---
console.log('Testing media density floor...');

const bare = { inputCounts: {}, urlParts: { pathname: '/', hash: '', search: '' } };
const densityTier = (over) => classifyClosureSafety({ ...bare, ...over }).tier;

assert.strictEqual(densityTier({ wordCount: 300 }), 'safe_to_close', '300 words with no player reads fine');
assert.strictEqual(densityTier({ wordCount: 300, hasMediaSurface: true }), 'suspend_only',
  'a YouTube watch page (291 words behind a player) must not close');
assert.strictEqual(densityTier({ wordCount: 7974, hasMediaSurface: true }), 'safe_to_close',
  'but a long article carrying a podcast embed still closes');
assert.match(classifyClosureSafety({ ...bare, wordCount: 300, hasMediaSurface: true }).reason, /Media-dominated/,
  'and says which floor it hit, so the report can tell the two apart');
assert.strictEqual(densityTier({ wordCount: READING_FLOOR_WORDS - 1 }), 'suspend_only', 'the plain floor is exclusive');
assert.strictEqual(densityTier({ wordCount: MEDIA_READING_FLOOR_WORDS, hasMediaSurface: true }), 'safe_to_close',
  'and so is the media floor');
console.log('✓ Media density floor verified');

// --- Frame merging: the zero-loss guard must see into iframes ---
console.log('Testing frame merge...');

const BIG = MIN_COUNTABLE_FRAME_AREA;
const frame = (frameId, over = {}) => ({
  frameId,
  result: {
    success: true, isDirty: false, reason: '', url: `https://x/${frameId}`, title: `t${frameId}`,
    wordCount: 500, frameArea: BIG,
    closureTelemetry: { inputCounts: { textareas: 0, selects: 0, passwords: 0, appContainers: 0, otherInputs: 0 }, urlParts: { pathname: '/', hash: '', search: '' } },
    ...over
  }
});

assert.strictEqual(mergeFrameExtractions([]), null, 'no frames means no extraction');
assert.strictEqual(mergeFrameExtractions([{ frameId: 0, result: undefined }]), null, 'a frame that threw is not an extraction');
assert.strictEqual(mergeFrameExtractions([{ frameId: 0, result: { success: false } }]), null, 'an unsuccessful frame is not an extraction');

// This is the bug the step exists to fix: the editor is in the subframe.
const tinymce = mergeFrameExtractions([
  frame(0, { title: 'An Editor' }),
  frame(7, { isDirty: true, reason: 'Unsaved rich-text editor draft detected', title: 'about:blank' })
]);
assert.strictEqual(tinymce.isDirty, true, 'a dirty subframe makes the whole tab dirty');
assert.match(tinymce.reason, /rich-text/, 'and carries that frame\'s reason');
assert.strictEqual(tinymce.title, 'An Editor', 'while identity still comes from the top frame');

assert.strictEqual(mergeFrameExtractions([frame(0), frame(7)]).isDirty, false, 'all-clean frames stay clean');

// An embedded player lives in a subframe, so the flag has to survive the merge.
assert.strictEqual(
  mergeFrameExtractions([frame(0), frame(7, { closureTelemetry: { inputCounts: {}, urlParts: {}, hasMediaSurface: true } })])
    .closureTelemetry.hasMediaSurface,
  true, 'a player in any frame marks the tab as carrying media');

// Identity never comes from a subframe, even when the top frame is listed second.
const reordered = mergeFrameExtractions([frame(9, { title: 'ad', url: 'https://ads/x' }), frame(0, { title: 'real' })]);
assert.strictEqual(reordered.title, 'real', 'the top frame wins regardless of result order');
assert.strictEqual(mergeFrameExtractions([frame(4, { title: 'only' })]).title, 'only', 'with no top frame, the first usable one stands in');

// Controls are summed so a framed form still counts...
const counted = mergeFrameExtractions([
  frame(0, { closureTelemetry: { inputCounts: { textareas: 1, selects: 0, passwords: 0, appContainers: 0, otherInputs: 2 }, urlParts: { pathname: '/', hash: '', search: '' } } }),
  frame(7, { closureTelemetry: { inputCounts: { textareas: 0, selects: 2, passwords: 1, appContainers: 0, otherInputs: 3 }, urlParts: {} } })
]);
assert.deepStrictEqual(counted.closureTelemetry.inputCounts,
  { textareas: 1, selects: 2, passwords: 1, appContainers: 0, otherInputs: 5 }, 'control counts sum across frames');

// ...but a tracking pixel cannot suspend every page that embeds one.
const pixel = mergeFrameExtractions([
  frame(0),
  frame(7, { frameArea: 1, closureTelemetry: { inputCounts: { textareas: 9, selects: 9, passwords: 9, appContainers: 9, otherInputs: 9 }, urlParts: {} } })
]);
assert.deepStrictEqual(pixel.closureTelemetry.inputCounts,
  { textareas: 0, selects: 0, passwords: 0, appContainers: 0, otherInputs: 0 }, 'a sub-threshold frame contributes no controls');
assert.strictEqual(
  mergeFrameExtractions([frame(0), frame(7, { frameArea: 1, isDirty: true, reason: 'Unsaved form input detected' })]).isDirty,
  true, 'but a tiny frame can still veto on dirtiness — size never gates safety');

console.log('✓ Frame merge and iframe dirty propagation verified');

console.log('--- Closure Policy Tests Passed Successfully! ---');
