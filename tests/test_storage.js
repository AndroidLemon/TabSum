/**
 * TabSum - Storage Unit Tests
 * Verifies favorites, storage estimates, soft-delete tombstones, text-store split,
 * URL dedupe, summary sanitization, calendar-day stats, closed-today bookkeeping and fading.
 */

import assert from 'node:assert';
import 'fake-indexeddb/auto';
import { getExpiry, fadeChipLabel, FADE_WARNING_DAYS } from '../src/shared/fade.js';

console.log('--- Running TabSum Storage Unit Tests ---');

globalThis.chrome = {
  storage: {
    local: {
      _data: {},
      async get(key) {
        return { [key]: this._data[key] };
      },
      async set(obj) {
        Object.assign(this._data, obj);
      }
    }
  }
};

// Import storage functions after polyfilling environment
const {
  DEFAULT_SETTINGS,
  saveArchivedTab,
  getArchivedTabs,
  getTabById,
  getStats,
  getAllDomains,
  toggleFavoriteTab,
  getStorageEstimate,
  clearAllHistory,
  softDeleteTab,
  restoreDeletedTab,
  purgeDeletedTabs,
  markClosedByTabSum,
  markTabGone,
  markReopened,
  markLeftOpen,
  markStaysSuspended,
  recordCapture,
  fadeExpiredTabs,
  getSettings,
  setDomainList
} = await import('../src/storage/db.js');

// Test 1: favorites and storage estimate (the count-based quota is gone; fading replaced it)
console.log('Testing toggleFavoriteTab and getStorageEstimate...');
assert.strictEqual(DEFAULT_SETTINGS.maxStoredItems, undefined, 'Storage quota setting was removed');
await clearAllHistory();
for (const id of ['s-1', 's-2', 's-3']) {
  await saveArchivedTab({ id, url: `https://example.com/${id}`, title: id, status: 'archived', cleanText: 'some text' });
}
assert.strictEqual((await toggleFavoriteTab('s-2')).isFavorite, true, 'isFavorite should toggle from false to true');
assert.strictEqual((await toggleFavoriteTab('s-2')).isFavorite, false, 'isFavorite should toggle from true to false');
const estimate = await getStorageEstimate();
assert.strictEqual(estimate.itemCount, 3);
assert.ok(estimate.byteEstimate > 0, 'Byte estimate should be positive number');
console.log(`✓ toggleFavoriteTab and getStorageEstimate verified (${estimate.itemCount} items)`);

// Test 6: Soft-delete tombstones
console.log('Testing soft delete / restore / purge...');
await clearAllHistory();
await saveArchivedTab({ id: 'keep', url: 'https://keep.example/', status: 'archived' });
await saveArchivedTab({ id: 'gone', url: 'https://gone.example/', status: 'archived' });

const tombstoned = await softDeleteTab('gone');
assert.ok(typeof tombstoned.deletedAt === 'number', 'softDeleteTab sets deletedAt');
assert.strictEqual(await softDeleteTab('missing'), null, 'softDeleteTab resolves null for unknown ids');
assert.deepStrictEqual((await getArchivedTabs()).map(t => t.id), ['keep'], 'Tombstones hidden by default');
assert.strictEqual((await getStats()).total, 1, 'getStats ignores tombstones');
assert.deepStrictEqual((await getAllDomains()).map(d => d.domain), ['keep.example'], 'getAllDomains ignores tombstones');
assert.strictEqual((await getStorageEstimate()).itemCount, 1, 'getStorageEstimate ignores tombstones');

const restored = await restoreDeletedTab('gone');
assert.strictEqual(restored.deletedAt, undefined, 'restoreDeletedTab removes deletedAt');
assert.strictEqual((await getArchivedTabs()).length, 2, 'Restored record is visible again');

await softDeleteTab('gone');
assert.strictEqual((await purgeDeletedTabs()).purgedCount, 0, 'Fresh tombstones survive the 1h default');
assert.strictEqual((await purgeDeletedTabs(0)).purgedCount, 1, 'Tombstone older than cutoff is purged');
assert.strictEqual(await getTabById('gone'), null);
assert.ok(await getTabById('keep'));
console.log('✓ Tombstones hide, restore, and purge correctly');

// Test 7: Text-store split
console.log('Testing cleanText split into its own store...');
await clearAllHistory();
await saveArchivedTab({
  id: 'text-1',
  url: 'https://text.example/',
  title: 'Plain title',
  status: 'archived',
  cleanText: 'An article mentioning the zebrafish genome.'
});
const [listed] = await getArchivedTabs();
assert.strictEqual(listed.cleanText, undefined, 'getArchivedTabs omits cleanText');
assert.strictEqual((await getArchivedTabs({ includeText: true }))[0].cleanText, 'An article mentioning the zebrafish genome.');
assert.strictEqual((await getTabById('text-1')).cleanText, 'An article mentioning the zebrafish genome.');
const hits = await getArchivedTabs({ query: 'ZEBRAFISH' });
assert.deepStrictEqual(hits.map(t => t.id), ['text-1'], 'Keyword search still matches page text');
assert.strictEqual(hits[0].cleanText, undefined, 'Search results omit cleanText');
assert.strictEqual((await getArchivedTabs({ query: 'platypus' })).length, 0);
await saveArchivedTab({ id: 'text-big', url: 'https://big.example/', status: 'archived', cleanText: 'x'.repeat(60000) });
assert.strictEqual((await getTabById('text-big')).cleanText.length, 50000, 'cleanText capped at 50k chars');
console.log('✓ cleanText lives in the text store and stays searchable');

// Test 8: URL dedupe
console.log('Testing URL dedupe...');
await clearAllHistory();
const THREE_HOURS = 3 * 60 * 60 * 1000;
const first = await saveArchivedTab({
  url: 'https://dupe.example/article',
  status: 'archived',
  capturedAt: Date.now() - THREE_HOURS,
  summary: { tldr: 'old', bullets: [], tags: [] },
  cleanText: 'old text'
});
await toggleFavoriteTab(first.id);
const second = await saveArchivedTab({
  url: 'https://dupe.example/article',
  status: 'discarded',
  summary: { tldr: 'new', bullets: [], tags: [] },
  cleanText: 'new text'
});
assert.strictEqual(second.id, first.id, 'Same URL updates the existing record regardless of age');
const deduped = await getTabById(first.id);
assert.strictEqual(deduped.isFavorite, true, 'Dedupe keeps isFavorite');
assert.strictEqual(deduped.status, 'discarded');
assert.strictEqual(deduped.summary.tldr, 'new');
assert.strictEqual(deduped.cleanText, 'new text');
assert.ok(deduped.capturedAt > Date.now() - 60000, 'Dedupe refreshes capturedAt');
assert.strictEqual((await getArchivedTabs({ status: 'discarded' })).length, 1);

const noUrl1 = await saveArchivedTab({ url: 'javascript:alert(1)', status: 'archived' });
const noUrl2 = await saveArchivedTab({ url: '', status: 'archived' });
assert.notStrictEqual(noUrl1.id, noUrl2.id, 'Records without a URL are never deduped together');

await softDeleteTab(first.id);
const afterDelete = await saveArchivedTab({ url: 'https://dupe.example/article', status: 'archived' });
assert.notStrictEqual(afterDelete.id, first.id, 'Tombstoned records are not dedupe targets');
console.log('✓ URL dedupe verified');

// Test 9: Summary sanitization
console.log('Testing summary sanitization...');
const dirty = await saveArchivedTab({
  url: 'https://sanitize.example/',
  status: 'archived',
  summary: { tldr: 42, bullets: ['a', 3, null, 'b'], tags: ['#AI', ' ml ', 5, '#', ''], extra: '<script>' }
});
assert.deepStrictEqual(dirty.summary, { tldr: '', bullets: ['a', 'b'], tags: ['AI', 'ml'] });
const missing = await saveArchivedTab({ url: 'https://nosummary.example/', status: 'archived', summary: 'nope' });
assert.deepStrictEqual(missing.summary, { tldr: '', bullets: [], tags: [] });
console.log('✓ Summary sanitized at save time');

// Test 10: Calendar-day stats and time ranges
console.log('Testing calendar-day today/yesterday...');
await clearAllHistory();
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
await saveArchivedTab({ id: 'd-today', url: 'https://d.example/today', status: 'archived', capturedAt: midnight.getTime() + 1000, isFavorite: true });
await saveArchivedTab({ id: 'd-yesterday', url: 'https://d.example/yesterday', status: 'archived', capturedAt: midnight.getTime() - 1000 });
const stats = await getStats();
assert.strictEqual(stats.total, 2);
assert.strictEqual(stats.today, 1, 'Only records since local midnight count as today');
assert.strictEqual(stats.favorites, 1);
assert.ok(stats.totalReadingMinutes >= 2);
assert.deepStrictEqual((await getArchivedTabs({ timeRange: 'today' })).map(t => t.id), ['d-today']);
assert.deepStrictEqual((await getArchivedTabs({ timeRange: 'yesterday' })).map(t => t.id), ['d-yesterday']);
console.log('✓ Calendar-day stats verified');

// Test 11: closedAt feeds "Closed today"; reopening clears it
console.log('Testing record lifecycle / closedSince...');
await clearAllHistory();
await saveArchivedTab({ id: 'c-closed', url: 'https://c.example/closed', status: 'discarded' });
await saveArchivedTab({ id: 'c-manual', url: 'https://c.example/manual', status: 'archived' });
const closedRec = await markClosedByTabSum('c-closed');
assert.strictEqual(closedRec.status, 'archived');
assert.ok(closedRec.closedAt > 0, 'markClosedByTabSum stamps closedAt');
assert.deepStrictEqual((await getArchivedTabs({ closedSince: midnight.getTime() })).map(t => t.id), ['c-closed'],
  'closedSince returns only tabs TabSum closed');
await markReopened('c-closed');
assert.strictEqual((await getTabById('c-closed')).closedAt, null, 'Reopening clears closedAt');
assert.strictEqual((await getArchivedTabs({ closedSince: midnight.getTime() })).length, 0);
console.log('✓ Closed-today bookkeeping verified');

// Test 11b: 'captured' = summary saved, tab still open (Chrome refused to close, or manual save)
await markClosedByTabSum('c-manual');
const kept = await markLeftOpen('c-manual', 'Chrome refused to close this tab; summary saved, tab left open');
assert.strictEqual(kept.closureReason, 'Chrome refused to close this tab; summary saved, tab left open', 'Reason is recorded');
assert.strictEqual(kept.closedAt, null, 'A tab Chrome kept open is not in Closed today');
assert.strictEqual(kept.restoredAt, undefined, 'Not counted as reopened, so it stays in the inbox');
assert.ok((await getArchivedTabs({ view: 'inbox' })).some(t => t.id === 'c-manual'));
console.log('✓ Captured status verified');

// Test 12: Inbox views, fading, expiring-soon sort
// Lifecycle: a tab TabSum closed vs a tab that merely went away, and capture dispositions
console.log('Testing lifecycle transitions...');
await clearAllHistory();
await saveArchivedTab({ id: 'lc-gone', url: 'https://lc.example/gone', status: 'discarded' });
const gone = await markTabGone('lc-gone');
assert.strictEqual(gone.status, 'archived', 'markTabGone archives the record');
assert.ok(!gone.closedAt, 'a tab TabSum did not close must not count as closed today');
assert.strictEqual((await getArchivedTabs({ closedSince: 1 })).length, 0, 'and it stays out of Closed today (0 means the filter is off)');

const cap = { url: 'https://lc.example/cap', title: 'Cap' };
const asClosed = await recordCapture({ ...cap, url: 'https://lc.example/c1' }, 'closed');
assert.strictEqual(asClosed.status, 'archived');
assert.ok(asClosed.closedAt > 0, "disposition 'closed' pairs archived with closedAt");
const asSuspended = await recordCapture({ ...cap, url: 'https://lc.example/c2' }, 'suspended');
assert.strictEqual(asSuspended.status, 'discarded');
assert.strictEqual(asSuspended.closedAt, null, "disposition 'suspended' leaves closedAt null");
const asOpen = await recordCapture({ ...cap, url: 'https://lc.example/c3' }, 'left-open');
assert.strictEqual(asOpen.status, 'captured');
assert.strictEqual(asOpen.closedAt, null, "disposition 'left-open' leaves closedAt null");

const reopened = await markReopened(asClosed.id);
assert.strictEqual(reopened.closedAt, null, 'reopening clears closedAt');
assert.ok(reopened.restoredAt > 0, 'reopening stamps restoredAt');

// Chrome refused to close a tab we had suspended: it stays suspended, and must land in
// neither "Closed today" nor the fully-open inbox.
await saveArchivedTab({ id: 'lc-stuck', url: 'https://lc.example/stuck', status: 'archived', closedAt: Date.now() });
const stuck = await markStaysSuspended('lc-stuck', 'Chrome refused to close this tab; it stays suspended');
assert.strictEqual(stuck.status, 'discarded', 'markStaysSuspended puts the record back to suspended');
assert.strictEqual(stuck.closedAt, null, 'and clears closedAt so it leaves Closed today');
assert.strictEqual(stuck.closureReason, 'Chrome refused to close this tab; it stays suspended', 'the refusal reason is recorded');
assert.ok(!(await getArchivedTabs({ closedSince: 1 })).some(t => t.id === 'lc-stuck'), 'a stuck tab is not closed today');

// An unknown disposition must fail at the call site rather than persisting 'captured'
await assert.rejects(() => recordCapture({ url: 'https://lc.example/typo' }, 'left_open'),
  /unknown disposition/, 'a mistyped disposition throws instead of silently writing captured');
console.log('✓ Lifecycle transitions verified');

console.log('Testing inbox views and fading...');
await clearAllHistory();
const DAY = 24 * 60 * 60 * 1000;
const fade = { fadeUnopenedDays: 30, fadeReopenedDays: 7 };
globalThis.chrome.storage.local._data['tabsum_settings'] = fade;
const nowMs = Date.now();
await saveArchivedTab({ id: 'f-old', url: 'https://f.example/old', status: 'archived', capturedAt: nowMs - 31 * DAY });
await saveArchivedTab({ id: 'f-new', url: 'https://f.example/new', status: 'archived', capturedAt: nowMs - DAY });
await saveArchivedTab({ id: 'f-star', url: 'https://f.example/star', status: 'archived', capturedAt: nowMs - 90 * DAY, isFavorite: true });
await saveArchivedTab({ id: 'f-reopened', url: 'https://f.example/reopened', status: 'archived', capturedAt: nowMs - 2 * DAY });
await markReopened('f-reopened');

assert.deepStrictEqual((await getArchivedTabs({ view: 'reopened' })).map(t => t.id), ['f-reopened']);
assert.ok(!(await getArchivedTabs({ view: 'inbox' })).some(t => t.id === 'f-reopened'), 'Reopened notes leave the inbox');
assert.strictEqual(getExpiry(await getTabById('f-star'), fade), null, 'Starred notes never fade');
assert.strictEqual(getExpiry(await getTabById('f-new'), { ...fade, fadeUnopenedDays: 0 }), null, '0 days = never');
assert.deepStrictEqual((await getArchivedTabs({ sortBy: 'expiring-soon', fadeSettings: fade })).map(t => t.id),
  ['f-old', 'f-reopened', 'f-new', 'f-star'], 'Soonest to fade first, never-fading last');
assert.strictEqual((await fadeExpiredTabs(fade)).fadedCount, 1);
assert.ok(typeof (await getTabById('f-old')).deletedAt === 'number', 'Fading tombstones, never hard-deletes');
assert.ok(!(await getArchivedTabs()).some(t => t.id === 'f-old'), 'A faded note is hidden from queries');
assert.strictEqual((await fadeExpiredTabs(fade)).fadedCount, 0, 'An already-tombstoned note does not fade twice');
assert.strictEqual((await restoreDeletedTab('f-old')).deletedAt, undefined, 'A faded note is restorable before the purge');
await softDeleteTab('f-old'); // re-tombstone so it stays out of the counts below
const recaptured = await saveArchivedTab({ url: 'https://f.example/reopened', status: 'archived' });
assert.strictEqual(recaptured.restoredAt, undefined, 'Recapture puts a note back in the inbox');
await saveArchivedTab({ id: 'f-kept', url: 'https://f.example/kept', status: 'discarded', capturedAt: nowMs - 31 * DAY });
await saveArchivedTab({ id: 'f-orphan', url: 'https://f.example/orphan', status: 'discarded', capturedAt: nowMs - 31 * DAY });
assert.strictEqual((await fadeExpiredTabs(fade, new Set(['f-kept']))).fadedCount, 1);
assert.ok(!(await getTabById('f-kept')).deletedAt, 'Records of still-suspended tabs survive fading');
assert.ok((await getTabById('f-orphan')).deletedAt, 'Untracked discarded records fade');
await purgeDeletedTabs(0);
assert.strictEqual(await getTabById('f-orphan'), null, 'The hourly purge finishes what the fade started');

// The warning window: a note is silent until it is FADE_WARNING_DAYS from going, unless the
// user is sorting by fade date, where the point is seeing every one of them.
const chipNow = 1_700_000_000_000;
const chipNote = { capturedAt: chipNow, isFavorite: false };
const chipAt = (daysLeft, sortBy) =>
  fadeChipLabel({ ...chipNote, capturedAt: chipNow - (30 - daysLeft) * DAY }, { ...fade }, sortBy, chipNow);
assert.strictEqual(chipAt(FADE_WARNING_DAYS + 1), '', 'outside the warning window a fading note is silent');
assert.strictEqual(chipAt(FADE_WARNING_DAYS), 'Fades in 3d', 'at the window edge the chip appears');
assert.strictEqual(chipAt(0.5), 'Fades today', 'under a day it says today');
assert.strictEqual(chipAt(FADE_WARNING_DAYS + 1, 'expiring-soon'), 'Fades in 4d',
  'the expiring-soon sort shows every fading note regardless of the window');
assert.strictEqual(fadeChipLabel({ ...chipNote, isFavorite: true }, fade, 'newest', chipNow), '',
  'starred notes never show a chip');
assert.strictEqual(fadeChipLabel(chipNote, null, 'newest', chipNow), '', 'no settings means no chip');
// Regression: getArchivedTabs defaults fadeSettings to null and app.js can pass null when the
// settings read fails. That must not throw mid-render.
assert.strictEqual(getExpiry({ capturedAt: chipNow }, null), null, 'null settings means never fades, not a crash');
assert.strictEqual(getExpiry({ capturedAt: chipNow }, undefined), null, 'undefined settings likewise');
await assert.doesNotReject(() => getArchivedTabs({ sortBy: 'expiring-soon' }),
  'the expiring-soon sort survives a missing fadeSettings');
console.log('✓ Inbox views, fading and expiring-soon sort verified');

// Test 13: JSON import - unknown ids dedupe on URL; field types are coerced
const imported = await saveArchivedTab({ id: 'imp-1', url: 'https://f.example/new', title: 42, readingTimeMinutes: '<img src=x onerror=alert(1)>', summarySource: 'manual' });
assert.strictEqual(imported.summarySource, 'heuristic', 'Unknown summary sources cannot pass the AI-only close gate');
assert.strictEqual(imported.id, 'f-new', 'Unknown id falls back to URL dedupe');
assert.strictEqual(imported.title, 'Untitled Tab');
assert.strictEqual(imported.readingTimeMinutes, 1, 'Non-numeric reading time is coerced');
assert.strictEqual((await getArchivedTabs({ query: 'f.example' })).length > 0, true, 'Search still works after import');
const restoredImport = await saveArchivedTab({ id: 'imp-2', url: 'https://f.example/imp2', status: 'restored', restoredAt: nowMs - DAY, capturedAt: 'garbage' });
assert.strictEqual(restoredImport.restoredAt, nowMs - DAY, 'Import keeps restoredAt');
assert.ok(Number.isFinite(restoredImport.capturedAt), 'Invalid capturedAt falls back to now');
assert.ok((await getArchivedTabs({ view: 'reopened' })).some(t => t.id === 'imp-2'), 'Imported reopened note stays out of the inbox');
console.log('✓ Import validation verified');

// Test 14: fading leaves tombstones to purgeDeletedTabs, so Undo still works
await saveArchivedTab({ id: 'f-tomb', url: 'https://f.example/tomb', status: 'archived', capturedAt: nowMs - 31 * DAY });
await softDeleteTab('f-tomb');
await fadeExpiredTabs(fade);
assert.ok(await restoreDeletedTab('f-tomb'), 'A soft-deleted expired note can still be restored after a fade pass');
console.log('✓ Fading skips tombstones');

// Test 15: setDomainList keeps the whitelist and the trusted list mutually exclusive
console.log('Testing setDomainList...');
await setDomainList('a.com', 'alwaysCloseDomains');
assert.ok((await getSettings()).alwaysCloseDomains.includes('a.com'), 'a.com is on the trusted list');
await setDomainList('a.com', 'excludedDomains');
const afterSwitch = await getSettings();
assert.ok(afterSwitch.excludedDomains.includes('a.com'), 'a.com moved to the whitelist');
assert.ok(!afterSwitch.alwaysCloseDomains.includes('a.com'), 'a.com is off the trusted list');
console.log('✓ setDomainList mutual exclusion verified');

await clearAllHistory();
console.log('--- Storage Unit Tests Passed Successfully! ---');
