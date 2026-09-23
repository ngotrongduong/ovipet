"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.stateDb) return;

  const STATE_DB_NAME = "oweh-state-v1";
  const STATE_DB_VERSION = 1;
  const TASK_LEASE_MS = 45 * 1000;
  let legacyMigrationPromise = null;

  function openStateDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("indexeddb-unavailable"));
      const request = indexedDB.open(STATE_DB_NAME, STATE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("pets")) db.createObjectStore("pets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("commands")) db.createObjectStore("commands", { keyPath: "id" });
        if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexeddb-open-failed"));
    });
  }

  async function dbTransaction(storeName, mode, operation) {
    const db = await openStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = operation(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("indexeddb-transaction-failed"));
      tx.onabort = () => reject(tx.error || new Error("indexeddb-transaction-aborted"));
    }).finally(() => db.close());
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexeddb-request-failed"));
    });
  }

  async function runLegacyMigration() {
    const migrated = await dbTransaction("meta", "readonly", store => requestResult(store.get("legacyPetsMigrated")));
    if (migrated) return migrated;
    const legacy = await chrome.storage.local.get({ owehPets: {} });
    const records = Object.values(legacy.owehPets || {}).filter(pet => pet?.id);
    const db = await openStateDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["pets", "meta"], "readwrite");
      const pets = tx.objectStore("pets");
      records.forEach(pet => pets.put({ ...pet, id: String(pet.id) }));
      tx.objectStore("meta").put({ key: "legacyPetsMigrated", at: Date.now(), count: records.length });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return { key: "legacyPetsMigrated", count: records.length };
  }

  async function migrateLegacyPetsOnce() {
    if (!legacyMigrationPromise) {
      legacyMigrationPromise = runLegacyMigration().catch(error => {
        legacyMigrationPromise = null;
        throw error;
      });
    }
    return legacyMigrationPromise;
  }

  async function getAllRows(storeName) {
    if (storeName === "pets") await migrateLegacyPetsOnce();
    return dbTransaction(storeName, "readonly", store => requestResult(store.getAll()));
  }

  async function getAllPets() {
    const rows = await getAllRows("pets");
    return Object.fromEntries((rows || []).map(pet => [String(pet.id), pet]));
  }

  async function getPetsByIds(ids) {
    await migrateLegacyPetsOnce();
    const unique = [...new Set((ids || []).map(id => String(id || "")).filter(Boolean))];
    if (!unique.length) return {};
    const db = await openStateDb();
    const rows = [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction("pets", "readonly");
      const store = tx.objectStore("pets");
      for (const id of unique) {
        const request = store.get(id);
        request.onsuccess = () => { if (request.result) rows.push(request.result); };
        request.onerror = () => reject(request.error || new Error("indexeddb-request-failed"));
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("indexeddb-transaction-failed"));
      tx.onabort = () => reject(tx.error || new Error("indexeddb-transaction-aborted"));
    }).finally(() => db.close());
    return Object.fromEntries(rows.map(pet => [String(pet.id), pet]));
  }

  async function mergePets(records) {
    await migrateLegacyPetsOnce();
    const normalized = Object.values(records || {}).filter(pet => pet?.id);
    const db = await openStateDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("pets", "readwrite");
      const store = tx.objectStore("pets");
      normalized.forEach(incoming => {
        const id = String(incoming.id);
        const get = store.get(id);
        get.onsuccess = () => store.put({ ...(get.result || {}), ...incoming, id, dbUpdatedAt: Date.now() });
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return normalized.length;
  }


  async function getTask(id) {
    const db = await openStateDb();
    try {
      return await requestResult(db.transaction("tasks", "readonly").objectStore("tasks").get(String(id)));
    } finally {
      db.close();
    }
  }

  async function putTaskLease(task, tabId) {
    const now = Date.now();
    const id = String(task.id || "");
    if (!id) throw new Error("missing-task-id");
    const db = await openStateDb();
    let answer = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(id);
      get.onsuccess = () => {
        const existing = get.result;
        const held = existing?.status === "running" && existing.leaseUntil > now && existing.ownerTabId !== tabId;
        if (held) { answer = { ok: false, reason: "leased", task: existing }; return; }
        answer = { ok: true, task: { ...(existing || {}), ...task, id, status: "running", ownerTabId: tabId,
          heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now } };
        store.put(answer.task);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return answer;
  }

  async function heartbeatTasks(ids, tabId) {
    const now = Date.now();
    const db = await openStateDb();
    let sharedWorkerTask = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      (ids || []).forEach(rawId => {
        const id = String(rawId);
        const get = store.get(id);
        get.onsuccess = () => {
          const task = get.result;
          if (task?.ownerTabId === tabId && task.status === "running") {
            const updated = { ...task, heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now };
            store.put(updated);
            if (id === "shared-worker") sharedWorkerTask = updated;
          }
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return { sharedWorkerTask };
  }

  async function releaseTask(id, tabId, status = "complete") {
    const db = await openStateDb();
    let released = false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(String(id));
      get.onsuccess = () => {
        const task = get.result;
        if (task && (task.ownerTabId === tabId || task.leaseUntil <= Date.now())) {
          store.put({ ...task, status, leaseUntil: 0, finishedAt: Date.now(), updatedAt: Date.now() });
          released = true;
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return released;
  }

  OWEH_BG.stateDb = {
    STATE_DB_NAME, STATE_DB_VERSION, TASK_LEASE_MS,
    openStateDb, dbTransaction, requestResult, migrateLegacyPetsOnce, getAllRows,
    getAllPets, getPetsByIds, mergePets, getTask, putTaskLease, heartbeatTasks, releaseTask
  };
})();
