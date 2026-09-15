/**
 * TabSum - Sorting Unit Tests
 * Verifies getArchivedTabs sorting capabilities:
 * - 'newest' (most recent first)
 * - 'oldest' (chronological oldest first)
 * - 'reading-time-asc' (quick reads shortest first)
 * - 'reading-time-desc' (deep dives longest first)
 * - 'title-asc' (alphabetical title)
 * - 'domain' (alphabetical domain)
 */

import assert from 'node:assert';
import 'fake-indexeddb/auto';

if (!globalThis.chrome) {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
}

export async function runSortingTests() {
  console.log('--- Running TabSum Database Sorting Unit Tests ---');
  const { clearAllHistory, saveArchivedTab, getArchivedTabs } = await import('../src/storage/db.js');

  await clearAllHistory();

  // Seed test dataset with known attributes
  const sampleTabs = [
    {
      id: 'tab-1',
      url: 'https://zeta-blog.com/quick-tip',
      title: 'Zeta Quick Tip',
      domain: 'zeta-blog.com',
      capturedAt: 1000,
      readingTimeMinutes: 2,
      status: 'archived'
    },
    {
      id: 'tab-2',
      url: 'https://alpha-news.org/deep-dive',
      title: 'Alpha Deep Dive',
      domain: 'alpha-news.org',
      capturedAt: 2000,
      readingTimeMinutes: 25,
      status: 'archived'
    },
    {
      id: 'tab-3',
      url: 'https://beta-tech.io/medium-post',
      title: 'Beta Guide to Systems',
      domain: 'beta-tech.io',
      capturedAt: 3000,
      readingTimeMinutes: 8,
      status: 'archived'
    }
  ];

  // Populate database
  for (const tab of sampleTabs) {
    await saveArchivedTab(tab);
  }

  // Test 1: Default sorting (newest first)
  console.log('Testing default sorting (newest first)...');
  const newestTabs = await getArchivedTabs({ sortBy: 'newest' });
  assert.strictEqual(newestTabs.length, 3);
  assert.strictEqual(newestTabs[0].id, 'tab-3', 'Most recently captured tab must be first');
  assert.strictEqual(newestTabs[1].id, 'tab-2');
  assert.strictEqual(newestTabs[2].id, 'tab-1', 'Oldest captured tab must be last');
  console.log('✓ Default "newest" sort verified');

  // Test 2: Oldest first sorting
  console.log('Testing "oldest" sort...');
  const oldestTabs = await getArchivedTabs({ sortBy: 'oldest' });
  assert.strictEqual(oldestTabs[0].id, 'tab-1', 'Earliest captured tab must be first');
  assert.strictEqual(oldestTabs[2].id, 'tab-3', 'Most recent captured tab must be last');
  console.log('✓ "oldest" sort verified');

  // Test 3: Reading Time Ascending (Quick Reads)
  console.log('Testing "reading-time-asc" (Quick Reads)...');
  const quickReadTabs = await getArchivedTabs({ sortBy: 'reading-time-asc' });
  assert.strictEqual(quickReadTabs[0].readingTimeMinutes, 2, 'Shortest reading time (2m) must be first');
  assert.strictEqual(quickReadTabs[1].readingTimeMinutes, 8);
  assert.strictEqual(quickReadTabs[2].readingTimeMinutes, 25, 'Longest reading time (25m) must be last');
  console.log('✓ "reading-time-asc" sort verified');

  // Test 4: Reading Time Descending (Deep Dives)
  console.log('Testing "reading-time-desc" (Deep Dives)...');
  const deepDiveTabs = await getArchivedTabs({ sortBy: 'reading-time-desc' });
  assert.strictEqual(deepDiveTabs[0].readingTimeMinutes, 25, 'Longest reading time (25m) must be first');
  assert.strictEqual(deepDiveTabs[1].readingTimeMinutes, 8);
  assert.strictEqual(deepDiveTabs[2].readingTimeMinutes, 2, 'Shortest reading time (2m) must be last');
  console.log('✓ "reading-time-desc" sort verified');

  // Test 5: Alphabetical Title (A-Z)
  console.log('Testing "title-asc" (Alphabetical Title)...');
  const titleTabs = await getArchivedTabs({ sortBy: 'title-asc' });
  assert.strictEqual(titleTabs[0].title, 'Alpha Deep Dive', '"Alpha..." must be first');
  assert.strictEqual(titleTabs[1].title, 'Beta Guide to Systems', '"Beta..." must be second');
  assert.strictEqual(titleTabs[2].title, 'Zeta Quick Tip', '"Zeta..." must be last');
  console.log('✓ "title-asc" sort verified');

  // Test 6: Alphabetical Domain
  console.log('Testing "domain" (Alphabetical Domain)...');
  const domainTabs = await getArchivedTabs({ sortBy: 'domain' });
  assert.strictEqual(domainTabs[0].domain, 'alpha-news.org', 'alpha-news.org must be first');
  assert.strictEqual(domainTabs[1].domain, 'beta-tech.io', 'beta-tech.io must be second');
  assert.strictEqual(domainTabs[2].domain, 'zeta-blog.com', 'zeta-blog.com must be last');
  console.log('✓ "domain" sort verified');

  // Test 7: Sorting with Limit
  console.log('Testing sort with limit...');
  const limitedQuickReads = await getArchivedTabs({ sortBy: 'reading-time-asc', limit: 2 });
  assert.strictEqual(limitedQuickReads.length, 2);
  assert.strictEqual(limitedQuickReads[0].readingTimeMinutes, 2);
  assert.strictEqual(limitedQuickReads[1].readingTimeMinutes, 8);
  console.log('✓ Sort with limit verified');

  // Test 8: Unknown/empty/undefined sortBy falls back to default (newest first)
  console.log('Testing unknown sortBy falls back to default order...');
  const bogusSortTabs = await getArchivedTabs({ sortBy: 'bogus' });
  assert.strictEqual(bogusSortTabs[0].id, 'tab-3', 'Unknown sortBy must fall back to newest-first');
  assert.strictEqual(bogusSortTabs[1].id, 'tab-2');
  assert.strictEqual(bogusSortTabs[2].id, 'tab-1');
  const emptySortTabs = await getArchivedTabs({ sortBy: '' });
  assert.strictEqual(emptySortTabs[0].id, 'tab-3', 'Empty sortBy must fall back to newest-first');
  assert.strictEqual(emptySortTabs[1].id, 'tab-2');
  assert.strictEqual(emptySortTabs[2].id, 'tab-1');
  const undefinedSortTabs = await getArchivedTabs({ sortBy: undefined });
  assert.strictEqual(undefinedSortTabs[0].id, 'tab-3', 'Undefined sortBy must fall back to newest-first');
  assert.strictEqual(undefinedSortTabs[1].id, 'tab-2');
  assert.strictEqual(undefinedSortTabs[2].id, 'tab-1');
  console.log('✓ Unknown/empty/undefined sortBy fallback verified');

  console.log('--- All Sorting Unit Tests Passed Successfully! ---');
}

if (process.argv[1] && process.argv[1].endsWith('test_sorting.js')) {
  await runSortingTests();
}
