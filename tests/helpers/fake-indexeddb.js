"use strict";

// Minimal in-memory IndexedDB stand-in covering exactly the surface background.js uses
// (indexedDB.open, onupgradeneeded, db.createObjectStore/transaction/close,
// store.get/put/getAll). Good enough for vm.runInNewContext tests that exercise
// background.js's real task-lease/pet-record code paths without a browser.
function createFakeIndexedDB() {
  const stores = new Map(); // storeName -> Map(key -> value)
  const keyPaths = new Map();

  function storeApi(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    const keyPath = keyPaths.get(name) || (name === "meta" ? "key" : "id");
    return {
      get(key) {
        const request = {};
        queueMicrotask(() => {
          request.result = map.get(key);
          request.onsuccess?.();
        });
        return request;
      },
      put(value) {
        const request = {};
        map.set(value[keyPath], value);
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
      delete(key) {
        const request = {};
        map.delete(key);
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
      getAll() {
        const request = {};
        queueMicrotask(() => {
          request.result = [...map.values()];
          request.onsuccess?.();
        });
        return request;
      }
    };
  }

  function open(name, version) {
    const request = {};
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: storeName => stores.has(storeName) },
        createObjectStore(storeName, options = {}) {
          stores.set(storeName, new Map());
          keyPaths.set(storeName, options.keyPath || (storeName === "meta" ? "key" : "id"));
          return storeApi(storeName);
        },
        transaction(storeNames) {
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
          // Real IndexedDB fires oncomplete only once every request issued during this
          // transaction's synchronous phase has resolved; scheduling via setTimeout (a
          // macrotask) after the request callbacks (microtasks) reproduces that ordering.
          setTimeout(() => tx.oncomplete?.(), 0);
          return Object.assign(tx, { objectStore: storeApi });
        },
        close() {}
      };
      request.result = db;
      request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  }

  return { open };
}

module.exports = { createFakeIndexedDB };
