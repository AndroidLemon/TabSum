/**
 * TabSum - Storage Quota Management & LRU Pruning Unit Tests
 * Verifies auto-pruning excess records, preserving favorite and pinned tabs,
 * toggling favorite status, and calculating storage estimates.
 */

import assert from 'node:assert';

console.log('--- Running TabSum Storage Quota Unit Tests ---');

// In-memory IndexedDB & Chrome Storage mock for Node.js environment
const STORE_NAME = 'archived_tabs';
const inMemoryData = new Map();

globalThis.indexedDB = {
  open(dbName, version) {
    const req = {};
    setTimeout(() => {
      const db = {
        objectStoreNames: {
          contains: (name) => name === STORE_NAME
        },
        createObjectStore: (name) => ({
          createIndex: () => {}
        }),
        close: () => {},
        transaction: (stores, mode) => {
          const tx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: (s) => ({
              put: (record) => {
                inMemoryData.set(record.id, JSON.parse(JSON.stringify(record)));
                const r = {};
                setTimeout(() => {
                  if (r.onsuccess) r.onsuccess({ target: { result: record.id } });
                }, 0);
                return r;
              },
              get: (id) => {
                const r = {};
                setTimeout(() => {
                  const rec = inMemoryData.get(id);
                  r.result = rec ? JSON.parse(JSON.stringify(rec)) : undefined;
                  if (r.onsuccess) r.onsuccess({ target: r });
                }, 0);
                return r;
              },
              delete: (id) => {
                inMemoryData.delete(id);
                const r = {};
                setTimeout(() => {
                  if (r.onsuccess) r.onsuccess({ target: {} });
                }, 0);
                return r;
              },
              clear: () => {
                inMemoryData.clear();
                const r = {};
                setTimeout(() => {
                  if (r.onsuccess) r.onsuccess({ target: {} });
                }, 0);
                return r;
              },
              openCursor: (range, direction) => {
                const r = {};
                const items = Array.from(inMemoryData.values());
                let idx = 0;
                const step = () => {
                  if (idx < items.length) {
                    const item = items[idx++];
                    const cursor = {
                      value: JSON.parse(JSON.stringify(item)),
                      continue: () => setTimeout(step, 0)
                    };
                    r.result = cursor;
                    if (r.onsuccess) r.onsuccess({ target: r });
                  } else {
                    r.result = null;
                    if (r.onsuccess) r.onsuccess({ target: r });
                    setTimeout(() => {
                      if (tx.oncomplete) tx.oncomplete();
                    }, 5);
                  }
                };
                setTimeout(step, 0);
                return r;
              },
              index: (idxName) => ({
                getAll: (val) => {
                  const r = {};
                  setTimeout(() => {
                    const matches = Array.from(inMemoryData.values()).filter(x => x[idxName] === val);
                    r.result = matches;
                    if (r.onsuccess) r.onsuccess({ target: r });
                  }, 0);
                  return r;
                },
                openCursor: (range, direction) => {
                  const r = {};
                  const items = Array.from(inMemoryData.values());
                  if (idxName === 'capturedAt') {
                    items.sort((a, b) => (direction === 'prev' ? b.capturedAt - a.capturedAt : a.capturedAt - b.capturedAt));
                  }
                  let idx = 0;
                  const step = () => {
                    if (idx < items.length) {
                      const item = items[idx++];
                      const cursor = {
                        value: JSON.parse(JSON.stringify(item)),
                        continue: () => setTimeout(step, 0)
                      };
                      r.result = cursor;
                      if (r.onsuccess) r.onsuccess({ target: r });
                    } else {
                      r.result = null;
                      if (r.onsuccess) r.onsuccess({ target: r });
                      setTimeout(() => {
                        if (tx.oncomplete) tx.oncomplete();
                      }, 5);
                    }
                  };
                  setTimeout(step, 0);
                  return r;
                }
              })
            })
          };
          return tx;
        }
      };

      if (req.onupgradeneeded) {
        req.onupgradeneeded({ target: { result: db } });
      }
      req.result = db;
      if (req.onsuccess) {
        req.onsuccess({ target: req });
      }
    }, 0);
    return req;
  }
};

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
  getTabById,
  enforceStorageQuota,
  toggleFavoriteTab,
  getStorageEstimate,
  clearAllHistory
} = await import('../src/storage/db.js');

// Test 1: DEFAULT_SETTINGS contains storage quota fields
console.log('Testing DEFAULT_SETTINGS quota configuration...');
assert.strictEqual(DEFAULT_SETTINGS.maxStoredItems, 1000, 'Default maxStoredItems must be 1000');
assert.strictEqual(DEFAULT_SETTINGS.autoPruneEnabled, true, 'Default autoPruneEnabled must be true');
console.log('✓ DEFAULT_SETTINGS quota defaults verified');

// Test 2: Populate records and test LRU pruning with favorite & pinned preservation
console.log('Testing LRU auto-pruning with favorite and pinned preservation...');
await clearAllHistory();

// Populate 6 records with increasing capturedAt timestamps
const tab1 = await saveArchivedTab({
  id: 'tab-1-oldest',
  url: 'https://example.com/1',
  title: 'Oldest Tab',
  capturedAt: 1000,
  status: 'archived',
  isFavorite: false,
  pinned: false
});

const tab2 = await saveArchivedTab({
  id: 'tab-2-favorite',
  url: 'https://example.com/2',
  title: 'Favorite Tab (Old)',
  capturedAt: 2000,
  status: 'archived',
  isFavorite: true,
  pinned: false
});

const tab3 = await saveArchivedTab({
  id: 'tab-3-pinned',
  url: 'https://example.com/3',
  title: 'Pinned Tab (Old)',
  capturedAt: 3000,
  status: 'archived',
  isFavorite: false,
  pinned: true
});

const tab4 = await saveArchivedTab({
  id: 'tab-4-normal',
  url: 'https://example.com/4',
  title: 'Normal Tab 4',
  capturedAt: 4000,
  status: 'archived',
  isFavorite: false,
  pinned: false
});

const tab5 = await saveArchivedTab({
  id: 'tab-5-normal',
  url: 'https://example.com/5',
  title: 'Normal Tab 5',
  capturedAt: 5000,
  status: 'archived',
  isFavorite: false,
  pinned: false
});

const tab6 = await saveArchivedTab({
  id: 'tab-6-newest',
  url: 'https://example.com/6',
  title: 'Newest Tab 6',
  capturedAt: 6000,
  status: 'archived',
  isFavorite: false,
  pinned: false
});

// We have 6 total archived tabs.
// Set quota to 4 tabs. Excess count = 6 - 4 = 2 tabs.
// The oldest non-favorite, non-pinned tabs are tab-1 (capturedAt: 1000) and tab-4 (capturedAt: 4000).
// tab-2 (favorite, 2000) and tab-3 (pinned, 3000) must be SKIPPED and preserved.
const pruneResult = await enforceStorageQuota({
  maxStoredItems: 4,
  autoPruneEnabled: true
});

assert.strictEqual(pruneResult.prunedCount, 2, 'Should prune exactly 2 excess tabs');

const checkTab1 = await getTabById('tab-1-oldest');
const checkTab2 = await getTabById('tab-2-favorite');
const checkTab3 = await getTabById('tab-3-pinned');
const checkTab4 = await getTabById('tab-4-normal');
const checkTab5 = await getTabById('tab-5-normal');
const checkTab6 = await getTabById('tab-6-newest');

assert.strictEqual(checkTab1, null, 'tab-1-oldest should have been pruned');
assert.ok(checkTab2, 'tab-2-favorite MUST be preserved');
assert.strictEqual(checkTab2.isFavorite, true);
assert.ok(checkTab3, 'tab-3-pinned MUST be preserved');
assert.strictEqual(checkTab3.pinned, true);
assert.strictEqual(checkTab4, null, 'tab-4-normal should have been pruned');
assert.ok(checkTab5, 'tab-5-normal should be preserved');
assert.ok(checkTab6, 'tab-6-newest should be preserved');
console.log('✓ Setting quota successfully pruned oldest tabs while preserving favorite and pinned tabs');

// Test 3: toggleFavoriteTab functionality
console.log('Testing toggleFavoriteTab...');
const toggled1 = await toggleFavoriteTab('tab-5-normal');
assert.strictEqual(toggled1.isFavorite, true, 'isFavorite should toggle from false to true');

const toggled2 = await toggleFavoriteTab('tab-5-normal');
assert.strictEqual(toggled2.isFavorite, false, 'isFavorite should toggle from true to false');
console.log('✓ toggleFavoriteTab correctly toggled boolean status');

// Test 4: getStorageEstimate
console.log('Testing getStorageEstimate...');
globalThis.chrome.storage.local._data['tabsum_settings'] = { maxStoredItems: 4 };
const estimate = await getStorageEstimate();
assert.strictEqual(estimate.itemCount, 4, 'Remaining items count should be 4');
assert.ok(estimate.byteEstimate > 0, 'Byte estimate should be positive number');
assert.strictEqual(estimate.quota, 4, 'Quota should reflect settings');
console.log(`✓ getStorageEstimate returned: ${estimate.itemCount} items, ~${Math.round(estimate.byteEstimate / 1024)} KB, quota: ${estimate.quota}`);

// Test 5: Quota when autoPruneEnabled = false or maxStoredItems = 0
console.log('Testing autoPruneEnabled = false and unlimited quota (0)...');
const noPruneDisabled = await enforceStorageQuota({ maxStoredItems: 2, autoPruneEnabled: false });
assert.strictEqual(noPruneDisabled.prunedCount, 0, 'Should not prune when autoPruneEnabled is false');

const noPruneUnlimited = await enforceStorageQuota({ maxStoredItems: 0, autoPruneEnabled: true });
assert.strictEqual(noPruneUnlimited.prunedCount, 0, 'Should not prune when maxStoredItems is 0 (unlimited)');
console.log('✓ Guard conditions for auto-pruning disabled / unlimited quota passed');

console.log('--- Storage Quota Unit Tests Passed Successfully! ---');
