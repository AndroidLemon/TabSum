/**
 * TabSum - Storage Unit Tests
 * Verifies favorites, storage estimates, soft-delete tombstones, text-store split,
 * URL dedupe, summary sanitization, calendar-day stats, closed-today bookkeeping and fading.
 */

import assert from 'node:assert';
import 'fake-indexeddb/auto';

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
  deleteArchivedTab,
  markTabClosed,
  updateArchivedTabStatus,
  getExpiry,
  fadeExpiredTabs
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
assert.strictEqual((await getArchivedTabs({ includeDeleted: true })).length, 2, 'includeDeleted shows tombstones');
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
await deleteArchivedTab('keep');
assert.strictEqual(await getTabById('keep'), null, 'deleteArchivedTab hard-deletes');
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
console.log('Testing markTabClosed / closedSince...');
await clearAllHistory();
await saveArchivedTab({ id: 'c-closed', url: 'https://c.example/closed', status: 'discarded' });
await saveArchivedTab({ id: 'c-manual', url: 'https://c.example/manual', status: 'archived' });
const closedRec = await markTabClosed('c-closed');
assert.strictEqual(closedRec.status, 'archived');
assert.ok(closedRec.closedAt > 0, 'markTabClosed stamps closedAt');
assert.deepStrictEqual((await getArchivedTabs({ closedSince: midnight.getTime() })).map(t => t.id), ['c-closed'],
  'closedSince returns only tabs TabSum closed');
await updateArchivedTabStatus('c-closed', 'restored');
assert.strictEqual((await getTabById('c-closed')).closedAt, null, 'Reopening clears closedAt');
assert.strictEqual((await getArchivedTabs({ closedSince: midnight.getTime() })).length, 0);
console.log('✓ Closed-today bookkeeping verified');

// Test 11b: 'captured' = summary saved, tab still open (Chrome refused to close, or manual save)
await markTabClosed('c-manual');
const kept = await updateArchivedTabStatus('c-manual', 'captured', 'Chrome refused to close this tab; summary saved, tab left open');
assert.strictEqual(kept.closureReason, 'Chrome refused to close this tab; summary saved, tab left open', 'Reason is recorded');
assert.strictEqual(kept.closedAt, null, 'A tab Chrome kept open is not in Closed today');
assert.strictEqual(kept.restoredAt, undefined, 'Not counted as reopened, so it stays in the inbox');
assert.ok((await getArchivedTabs({ view: 'inbox' })).some(t => t.id === 'c-manual'));
console.log('✓ Captured status verified');

// Test 12: Inbox views, fading, expiring-soon sort
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
await updateArchivedTabStatus('f-reopened', 'restored');

assert.deepStrictEqual((await getArchivedTabs({ view: 'reopened' })).map(t => t.id), ['f-reopened']);
assert.ok(!(await getArchivedTabs({ view: 'inbox' })).some(t => t.id === 'f-reopened'), 'Reopened notes leave the inbox');
assert.strictEqual(getExpiry(await getTabById('f-star'), fade), null, 'Starred notes never fade');
assert.strictEqual(getExpiry(await getTabById('f-new'), { ...fade, fadeUnopenedDays: 0 }), null, '0 days = never');
assert.deepStrictEqual((await getArchivedTabs({ sortBy: 'expiring-soon' })).map(t => t.id),
  ['f-old', 'f-reopened', 'f-new', 'f-star'], 'Soonest to fade first, never-fading last');
assert.strictEqual((await fadeExpiredTabs(fade)).fadedCount, 1);
assert.strictEqual(await getTabById('f-old'), null, 'Expired note faded');
const recaptured = await saveArchivedTab({ url: 'https://f.example/reopened', status: 'archived' });
assert.strictEqual(recaptured.restoredAt, undefined, 'Recapture puts a note back in the inbox');
console.log('✓ Inbox views, fading and expiring-soon sort verified');

await clearAllHistory();
console.log('--- Storage Unit Tests Passed Successfully! ---');
