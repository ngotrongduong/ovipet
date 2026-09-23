"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.commandJournal) return;
  const dbApi = OWEH_BG.stateDb;
  if (!dbApi) throw new Error("bg/state-db.js must load before bg/command-journal.js");
  const { openStateDb } = dbApi;

  const COMMAND_PRUNE_META_KEY = "commandJournalPrunedAt";
  const COMMAND_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const QUEUED_RETENTION_MS = 24 * 60 * 60 * 1000;
  const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DISPATCHED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
  let lastPruneAt = 0;
  let prunePromise = null;

  async function journalBegin(entry) {
    const id = String(entry.id || "");
    if (!id) throw new Error("missing-command-id");
    const db = await openStateDb();
    let answer;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("commands", "readwrite");
      const store = tx.objectStore("commands");
      const get = store.get(id);
      get.onsuccess = () => {
        const existing = get.result;
        if (existing && ["dispatched", "callback-confirmed", "game-state-confirmed"].includes(existing.status)) {
          answer = { ok: false, duplicate: true, command: existing };
          return;
        }
        const command = { ...(existing || {}), ...entry, id, status: "queued", attempts: (existing?.attempts || 0) + 1,
          createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
        store.put(command);
        answer = { ok: true, command };
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return answer;
  }

  async function journalUpdate(id, patch) {
    const db = await openStateDb();
    let updated = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("commands", "readwrite");
      const store = tx.objectStore("commands");
      const get = store.get(String(id));
      get.onsuccess = () => {
        updated = { ...(get.result || { id: String(id) }), ...patch, updatedAt: Date.now() };
        store.put(updated);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return updated;
  }

  async function getAllCommands() {
    const db = await openStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("commands", "readonly");
      const request = tx.objectStore("commands").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  function retentionFor(command) {
    const status = String(command?.status || "");
    if (status === "queued") return QUEUED_RETENTION_MS;
    if (["callback-confirmed", "game-state-confirmed", "rejected"].includes(status)) return TERMINAL_RETENTION_MS;
    if (status === "dispatched") return DISPATCHED_RETENTION_MS;
    return null;
  }

  function commandTimestamp(command) {
    return Number(command?.updatedAt || command?.dispatchedAt || command?.createdAt || 0);
  }

  async function runPrune(now, force) {
    const db = await openStateDb();
    let result = { ok: true, skipped: false, pruned: 0, checked: 0, at: now };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["commands", "meta"], "readwrite");
      const commands = tx.objectStore("commands");
      const meta = tx.objectStore("meta");
      const previous = meta.get(COMMAND_PRUNE_META_KEY);
      previous.onsuccess = () => {
        const persistedAt = Number(previous.result?.at || 0);
        if (!force && persistedAt > 0 && now - persistedAt < COMMAND_PRUNE_INTERVAL_MS) {
          lastPruneAt = persistedAt;
          result = { ok: true, skipped: true, pruned: 0, checked: 0, at: persistedAt };
          return;
        }
        const all = commands.getAll();
        all.onsuccess = () => {
          const rows = all.result || [];
          result.checked = rows.length;
          for (const command of rows) {
            const retention = retentionFor(command);
            const timestamp = commandTimestamp(command);
            if (retention == null || timestamp <= 0 || now - timestamp <= retention) continue;
            commands.delete(String(command.id));
            result.pruned += 1;
          }
          meta.put({ key: COMMAND_PRUNE_META_KEY, at: now, pruned: result.pruned, checked: result.checked });
          lastPruneAt = now;
        };
        all.onerror = () => reject(all.error || new Error("command-prune-read-failed"));
      };
      previous.onerror = () => reject(previous.error || new Error("command-prune-meta-failed"));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("command-prune-transaction-failed"));
      tx.onabort = () => reject(tx.error || new Error("command-prune-transaction-aborted"));
    }).finally(() => db.close());
    return result;
  }

  function pruneOldCommands(now = Date.now(), force = false) {
    const timestamp = Number(now);
    if (!Number.isFinite(timestamp)) return Promise.reject(new Error("invalid-prune-time"));
    if (!force && lastPruneAt > 0 && timestamp - lastPruneAt < COMMAND_PRUNE_INTERVAL_MS) {
      return Promise.resolve({ ok: true, skipped: true, pruned: 0, checked: 0, at: lastPruneAt });
    }
    if (prunePromise) return prunePromise;
    prunePromise = runPrune(timestamp, Boolean(force)).finally(() => { prunePromise = null; });
    return prunePromise;
  }

  async function reconcileBreedCommands(catalog) {
    const byId = new Map((catalog || []).filter(item => item?.id).map(item => [String(item.id), item]));
    const now = Date.now();
    const db = await openStateDb();
    let confirmed = 0;
    let retryable = 0;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("commands", "readwrite");
      const store = tx.objectStore("commands");
      const request = store.getAll();
      request.onsuccess = () => {
        for (const command of request.result || []) {
          if (command.command !== "pet_breed" || command.status !== "dispatched") continue;
          const mother = byId.get(String(command.targetId));
          if (!mother) continue;
          if (mother.onCooldown) {
            store.put({ ...command, status: "game-state-confirmed", reconciledAt: now, updatedAt: now });
            confirmed += 1;
          } else if (now - Number(command.dispatchedAt || command.updatedAt || 0) > 5 * 60 * 1000) {
            store.put({ ...command, status: "rejected", reason: "catalog-shows-breedable", reconciledAt: now, updatedAt: now });
            retryable += 1;
          }
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    return { confirmed, retryable };
  }

  OWEH_BG.commandJournal = {
    COMMAND_PRUNE_INTERVAL_MS, QUEUED_RETENTION_MS, TERMINAL_RETENTION_MS, DISPATCHED_RETENTION_MS,
    journalBegin, journalUpdate, getAllCommands, pruneOldCommands, reconcileBreedCommands
  };
})();
