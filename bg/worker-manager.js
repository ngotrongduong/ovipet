"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.workerManager) return;
  const stateDb = OWEH_BG.stateDb;
  if (!stateDb) throw new Error("bg/state-db.js must load before bg/worker-manager.js");
  const diag = (level, event, data = {}) => OWEH_BG.diagnosticLog?.append(level, "worker", event, data).catch(() => {});
  const lightweightTabs = OWEH_BG.lightweightTabs || null;
  const { TASK_LEASE_MS, openStateDb, dbTransaction, requestResult } = stateDb;

  function closeAllEggTabsIfLoaded() {
    if (typeof closeAllEggTabs === "function") closeAllEggTabs().catch(() => {});
  }

  const SHARED_WORKER_TASK_ID = "shared-worker";
  const WORKER_HEALTH_ALARM = "oweh-worker-health";
  const WORKER_HEALTH_INTERVAL_MINUTES = 1;
  const WORKER_START_ACK_TIMEOUT_MS = 15 * 1000;
  const WORKER_START_RETRY_MS = 1000;
  const PROTECTED_WORKER_OWNERS = new Set(["sweep"]);
  const WORKER_RECOVERY_RELOAD_DELAY_MS = 1200;
  const PROTECTED_RECOVERY_URLS = Object.freeze({ sweep: "https://ovipets.com/#!/?src=pets&sub=overview" });
  const PROTECTED_RECOVERY_ACK_TIMEOUT_MS = 15 * 1000;
  const PROTECTED_RECOVERY_RETRY_MS = 1000;
  const workerStartWaiters = new Map();

  async function readSharedWorkerTask() {
    const row = await dbTransaction("tasks", "readonly", store => requestResult(store.get(SHARED_WORKER_TASK_ID)));
    return row || null;
  }

  function isWorkerLeaseLive(task, now = Date.now()) {
    return Boolean(task)
      && ["starting", "running", "stopping"].includes(String(task.status || ""))
      && Number(task.leaseUntil || 0) > now;
  }

  async function mirrorSharedWorkerState(task) {
    const now = Date.now();
    const owehWorker = isWorkerLeaseLive(task, now)
      ? {
          tabId: task.ownerTabId ?? null,
          owner: task.owner,
          phase: task.phase || "",
          startedAt: task.startedAt,
          heartbeatAt: task.heartbeatAt,
          leaseUntil: task.leaseUntil,
          generation: task.generation,
          status: task.status
        }
      : null;
    await chrome.storage.local.set({ owehWorker });
    return owehWorker;
  }

  // Reserves the shared-worker row for `owner` without yet knowing the tab id (the tab may
  // still need to be created). A live claim by a DIFFERENT owner is refused so the panel can
  // offer an explicit "Stop & switch" action instead of silently queueing (queueing would let
  // the next feature auto-activate the moment the first finishes, with no fresh button press —
  // exactly the auto-activation this project's conventions rule out for anything but plain
  // egg-turning). A live starting/running claim by the SAME owner is treated as an idempotent
  // attach, so double-clicking Start never spawns a duplicate tab. A `stopping` claim is busy
  // even for the same owner: reporting "already running" there would lose the fresh Start as
  // soon as the old generation finishes cleanup.
  async function claimSharedWorker(owner, requestedByTabId) {
    const now = Date.now();
    const db = await openStateDb();
    let answer;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (isWorkerLeaseLive(existing, now)) {
          if (existing.owner !== owner || existing.status === "stopping") {
            answer = { ok: false, reason: "busy", owner: existing.owner, phase: existing.phase || existing.status || "", tabId: existing.ownerTabId ?? null };
            diag("warning", "worker.claim.busy", { requestedOwner: owner, activeOwner: existing.owner, phase: existing.phase || existing.status || "", generation: existing.generation });
            return;
          }
          answer = { ok: true, alreadyRunning: true, tabId: existing.ownerTabId ?? null, generation: existing.generation };
          return;
        }
        const generation = Number(existing?.generation || 0) + 1;
        const task = {
          id: SHARED_WORKER_TASK_ID, status: "starting", owner, ownerTabId: null, requestedByTabId,
          phase: "starting", generation, startedAt: now, heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now
        };
        store.put(task);
        answer = { ok: true, alreadyRunning: false, generation, task };
        diag("info", "worker.claimed", { owner, generation, requestedByTabId });
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (answer.ok) await mirrorSharedWorkerState(answer.task || await readSharedWorkerTask());
    return answer;
  }

  // Fills in the tab id once the worker tab exists (created fresh, or an existing one
  // reused). Guarded by generation so a slow attach from a superseded claim (e.g. the user
  // pressed Stop, then Start again, before the first tab finished opening) can never clobber
  // the newer claim's row.
  async function attachSharedWorkerTab(generation, tabId, windowId) {
    const now = Date.now();
    const db = await openStateDb();
    let attached = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== generation || existing.status !== "starting") return;
        attached = { ...existing, ownerTabId: tabId, windowId, heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now };
        store.put(attached);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (attached) {
      await mirrorSharedWorkerState(attached);
      diag("info", "worker.tab-attached", { owner: attached.owner, generation: attached.generation, tabId });
    }
    return attached;
  }

  async function markSharedWorkerStarted(generation, owner, tabId) {
    const now = Date.now();
    const db = await openStateDb();
    let updated = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== generation || existing.owner !== owner || Number(existing.ownerTabId) !== Number(tabId)) return;
        if (existing.status !== "starting" && existing.status !== "running") return;
        updated = { ...existing, status: "running", phase: existing.phase === "starting" ? "running" : existing.phase,
          startedAckAt: existing.startedAckAt || now, heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now };
        store.put(updated);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (updated) {
      await mirrorSharedWorkerState(updated);
      diag("info", "worker.started", { owner: updated.owner, generation: updated.generation, tabId });
    }
    return updated;
  }

  async function beginSharedWorkerStop(expectGeneration) {
    const now = Date.now();
    const db = await openStateDb();
    let stopping = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== expectGeneration) return;
        if (!["starting", "running", "stopping"].includes(existing.status)) return;
        stopping = existing.status === "stopping"
          ? existing
          : { ...existing, status: "stopping", phase: "stopping", heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now };
        if (stopping !== existing) store.put(stopping);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (stopping) await mirrorSharedWorkerState(stopping);
    return stopping;
  }

  async function updateSharedWorkerPhase(generation, phase, ownerTabId) {
    const now = Date.now();
    const db = await openStateDb();
    let updated = null;
    let phaseChanged = false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== generation || existing.status !== "running") return;
        if (ownerTabId != null && Number(existing.ownerTabId) !== Number(ownerTabId)) return;
        phaseChanged = existing.phase !== phase;
        updated = { ...existing, phase, heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS, updatedAt: now };
        store.put(updated);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (updated) {
      await mirrorSharedWorkerState(updated);
      if (phaseChanged) diag("info", "worker.phase", { owner: updated.owner, generation: updated.generation, phase });
    }
    return updated;
  }

  // Generation-scoped lease release. Internal cleanup paths pass the exact generation they
  // reserved; workerDone additionally passes its sender tab so another extension tab cannot
  // spoof completion after reading the lightweight storage mirror. User Stop first reserves
  // the exact generation as `stopping`, then calls this same function after cleanup.
  async function releaseSharedWorker(expectGeneration, expectTabId = null) {
    const generation = Number(expectGeneration);
    if (!Number.isFinite(generation)) {
      await mirrorSharedWorkerState(await readSharedWorkerTask());
      return null;
    }
    const db = await openStateDb();
    let released = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing) return;
        if (existing.generation !== generation) return;
        if (expectTabId != null && Number(existing.ownerTabId) !== Number(expectTabId)) return;
        released = { ...existing, status: "stopped", leaseUntil: 0, finishedAt: Date.now(), updatedAt: Date.now() };
        store.put(released);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    // A late workerDone from an older generation must not erase the reactive mirror for a
    // newer live claim. Only clear the mirror when this call actually released the row;
    // otherwise restore it from the authoritative task currently in IndexedDB.
    if (released) {
      await chrome.storage.local.set({ owehWorker: null });
      diag("info", "worker.released", { owner: released.owner, generation: released.generation, tabId: released.ownerTabId, previousStatus: released.status });
    } else await mirrorSharedWorkerState(await readSharedWorkerTask());
    return released;
  }

  async function reviveSharedWorkerLease(expectGeneration, expectTabId, reason = "health-recovery") {
    const now = Date.now();
    const db = await openStateDb();
    let revived = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== Number(expectGeneration)) return;
        if (Number(existing.ownerTabId) !== Number(expectTabId)) return;
        if (!PROTECTED_WORKER_OWNERS.has(existing.owner)) return;
        revived = { ...existing, status: "running", heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS,
          recoveryAt: now, recoveryCount: Number(existing.recoveryCount || 0) + 1, recoveryReason: reason, updatedAt: now };
        store.put(revived);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (revived) await mirrorSharedWorkerState(revived);
    return revived;
  }

  function sendWorkerRecovery(tabId, task) {
    return new Promise(resolve => {
      chrome.tabs.sendMessage(Number(tabId), { type: "recoverSharedWorker", owner: task.owner, generation: task.generation }, response => {
        const error = chrome.runtime.lastError?.message || "";
        resolve({ ok: !error && response?.ok === true, error });
      });
    });
  }

  async function reloadWorkerTab(tabId) {
    if (typeof chrome.tabs.reload !== "function") return false;
    return new Promise(resolve => {
      let settled = false;
      let fallbackTimer = null;
      const done = value => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== null) clearTimeout(fallbackTimer);
        resolve(Boolean(value));
      };
      try {
        const maybe = chrome.tabs.reload(Number(tabId), {}, () => {
          const error = chrome.runtime.lastError?.message || "";
          done(!error);
        });
        if (maybe && typeof maybe.then === "function") maybe.then(() => done(true)).catch(() => done(false));
        else if (chrome.tabs.reload.length < 2) setTimeout(() => done(true), 0);
        fallbackTimer = setTimeout(() => done(false), 2500);
      } catch {
        done(false);
      }
    });
  }

  function waitForProtectedRecoveryAck(tabId, task, timeoutMs = PROTECTED_RECOVERY_ACK_TIMEOUT_MS) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      let finished = false;
      const finish = result => { if (!finished) { finished = true; resolve(result); } };
      const attempt = async () => {
        if (finished) return;
        const probe = await sendWorkerRecovery(tabId, task);
        if (probe.ok) return finish({ ok: true, error: "" });
        if (Date.now() - startedAt >= timeoutMs) return finish({ ok: false, error: probe.error || "recovery-ack-timeout" });
        setTimeout(attempt, PROTECTED_RECOVERY_RETRY_MS);
      };
      attempt().catch(error => finish({ ok: false, error: error?.message || String(error) }));
    });
  }

  async function rebindProtectedWorkerTab(expectGeneration, expectOldTabId, newTabId) {
    const now = Date.now();
    const db = await openStateDb();
    let rebound = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const get = store.get(SHARED_WORKER_TASK_ID);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || existing.generation !== Number(expectGeneration)) return;
        if (Number(existing.ownerTabId) !== Number(expectOldTabId)) return;
        if (!PROTECTED_WORKER_OWNERS.has(existing.owner)) return;
        rebound = { ...existing, ownerTabId: Number(newTabId), status: "running", heartbeatAt: now, leaseUntil: now + TASK_LEASE_MS,
          replacementAt: now, replacementCount: Number(existing.replacementCount || 0) + 1, updatedAt: now };
        store.put(rebound);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
    if (rebound) await mirrorSharedWorkerState(rebound);
    return rebound;
  }

  async function createProtectedReplacement(current, reason = "orphaned-sweep") {
    if (!current || !PROTECTED_WORKER_OWNERS.has(current.owner)) return null;
    const url = PROTECTED_RECOVERY_URLS[current.owner];
    if (!url) return null;
    let tab = null;
    try {
      tab = await createInactiveWorkerTab(url, current.owner);
      chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);
      const rebound = await rebindProtectedWorkerTab(current.generation, current.ownerTabId, tab.id);
      if (!rebound) {
        await closeOwnedWorkerTab(tab.id);
        return null;
      }
      diag("warning", "worker.protected-replacement-created", { owner: rebound.owner, generation: rebound.generation, oldTabId: current.ownerTabId, tabId: tab.id, reason, replacementCount: rebound.replacementCount });
      let recovery = await waitForProtectedRecoveryAck(tab.id, rebound);
      if (!recovery.ok) {
        const reloaded = await reloadWorkerTab(tab.id);
        diag(reloaded ? "warning" : "error", "worker.protected-replacement-reload", { owner: rebound.owner, generation: rebound.generation, tabId: tab.id, reloaded, reason: recovery.error || "recovery-ack-timeout" });
        if (reloaded) recovery = await waitForProtectedRecoveryAck(tab.id, rebound);
      }
      if (recovery.ok) {
        await markSharedWorkerStarted(rebound.generation, rebound.owner, tab.id);
        diag("info", "worker.protected-replacement-active", { owner: rebound.owner, generation: rebound.generation, tabId: tab.id });
      }
      return { tabId: tab.id, task: await readSharedWorkerTask(), recovered: recovery.ok };
    } catch (error) {
      diag("error", "worker.protected-replacement-failed", { owner: current.owner, generation: current.generation, oldTabId: current.ownerTabId, tabId: tab?.id || null, reason, message: error?.message || String(error) });
      return null;
    }
  }

  async function recoverOrphanedSweep(reason = "orphaned-sweep") {
    const stored = await chrome.storage.local.get({ owehSweep: { active: false } });
    if (!stored?.owehSweep?.active) return null;
    const current = await readSharedWorkerTask();
    if (isWorkerLeaseLive(current)) return null;
    if (current && current.status !== "stopped" && current.owner && current.owner !== "sweep") return null;

    const claim = await claimSharedWorker("sweep", null);
    if (!claim.ok) return null;
    if (claim.alreadyRunning) return claim;
    let tab = null;
    try {
      tab = await createInactiveWorkerTab(PROTECTED_RECOVERY_URLS.sweep, "sweep");
      chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);
      const attached = await attachSharedWorkerTab(claim.generation, tab.id, null);
      if (!attached) throw new Error("orphan-recovery-attach-failed");
      diag("warning", "worker.orphan-recovery-created", { owner: "sweep", generation: claim.generation, tabId: tab.id, reason });
      let recovery = await waitForProtectedRecoveryAck(tab.id, attached);
      if (!recovery.ok) {
        const reloaded = await reloadWorkerTab(tab.id);
        diag(reloaded ? "warning" : "error", "worker.orphan-recovery-reload", { owner: "sweep", generation: claim.generation, tabId: tab.id, reloaded, reason: recovery.error || "recovery-ack-timeout" });
        if (reloaded) recovery = await waitForProtectedRecoveryAck(tab.id, attached);
      }
      if (!recovery.ok) return { ok: false, tabId: tab.id, generation: claim.generation, error: recovery.error || "recovery-ack-timeout" };
      await markSharedWorkerStarted(claim.generation, "sweep", tab.id);
      diag("info", "worker.orphan-recovery-active", { owner: "sweep", generation: claim.generation, tabId: tab.id, reason });
      return { ok: true, tabId: tab.id, generation: claim.generation };
    } catch (error) {
      diag("error", "worker.orphan-recovery-failed", { owner: "sweep", generation: claim.generation, tabId: tab?.id || null, reason, message: error?.message || String(error) });
      if (tab?.id != null) await closeOwnedWorkerTab(tab.id);
      await releaseSharedWorker(claim.generation).catch(() => {});
      return null;
    }
  }

  function waitForWorkerStartAck(tabId, owner, generation, extra = {}) {
    return new Promise(resolve => {
      let finished = false;
      let retryTimer = null;
      const finish = (ok, error = "") => {
        if (finished) return;
        finished = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        clearTimeout(timeoutTimer);
        workerStartWaiters.delete(generation);
        resolve({ ok, error });
      };
      const send = () => {
        if (finished) return;
        chrome.tabs.sendMessage(tabId, { type: "startSharedWorker", owner, generation, extra }, () => {
          void chrome.runtime.lastError;
        });
        retryTimer = setTimeout(send, WORKER_START_RETRY_MS);
      };
      const timeoutTimer = setTimeout(() => finish(false, "worker-start-timeout"), WORKER_START_ACK_TIMEOUT_MS);
      workerStartWaiters.set(generation, { tabId: Number(tabId), owner, finish });
      send();
    });
  }

  async function acknowledgeWorkerStarted(message, sender, respond) {
    const generation = Number(message.generation);
    const owner = String(message.owner || "");
    const tabId = sender.tab?.id;
    if (!Number.isFinite(generation) || !owner || !Number.isInteger(tabId)) {
      respond?.({ ok: false, error: "invalid-worker-start-ack" });
      return;
    }
    const updated = await markSharedWorkerStarted(generation, owner, tabId);
    if (!updated) {
      respond?.({ ok: false, error: "stale-worker-start-ack" });
      return;
    }
    const waiter = workerStartWaiters.get(generation);
    if (waiter && waiter.owner === owner && waiter.tabId === Number(tabId)) waiter.finish(true);
    respond?.({ ok: true });
  }


  function isOviPetsWorkerUrl(url) {
    return /^https:\/\/(?:app\.)?ovipets\.com\//.test(String(url || ""));
  }

  function readTab(tabId) {
    return new Promise(resolve => {
      chrome.tabs.get(Number(tabId), tab => {
        if (chrome.runtime.lastError || !tab) return resolve(null);
        resolve(tab);
      });
    });
  }

  async function closeOwnedWorkerTab(tabId) {
    if (tabId == null) return false;
    const tab = await readTab(tabId);
    if (!tab) {
      await lightweightTabs?.disable?.(tabId, "worker-missing").catch?.(() => false);
      return false;
    }
    const url = String(tab.url || tab.pendingUrl || "");
    if (!isOviPetsWorkerUrl(url)) return false;
    await chrome.tabs.remove(Number(tabId)).catch(() => {});
    await lightweightTabs?.disable?.(tabId, "worker-close").catch?.(() => false);
    return true;
  }

  async function createInactiveWorkerTab(url, owner = "") {
    const lightweight = owner === "sweep" && Boolean(lightweightTabs?.dnrAvailable?.());
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.create({ url: lightweight ? "about:blank" : url, active: false }, created => {
        const error = chrome.runtime.lastError?.message;
        if (error || !created?.id) reject(new Error(error || "tab-create-failed"));
        else resolve(created);
      });
    });
    if (lightweight) {
      await lightweightTabs?.enable?.(tab.id, "sweep-coordinator").catch?.(() => false);
      await new Promise(resolve => {
        chrome.tabs.update(tab.id, { url, active: false, autoDiscardable: false }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    }
    return tab;
  }

  async function claimWorker(message, sender, respond) {
    const owner = String(message.owner || "");
    if (!owner) return respond({ ok: false, error: "missing-owner" });
    const requestedByTabId = sender.tab?.id ?? null;
    const claim = await claimSharedWorker(owner, requestedByTabId);
    if (!claim.ok) return respond(claim);
    if (claim.alreadyRunning) return respond(claim);

    let tab = null;
    try {
      tab = await createInactiveWorkerTab(message.url, owner);
      chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);
      const attached = await attachSharedWorkerTab(claim.generation, tab.id, null);
      if (!attached) {
        diag("warning", "worker.claim-superseded", { owner, generation: claim.generation, tabId: tab.id });
        await closeOwnedWorkerTab(tab.id);
        return respond({ ok: false, error: "worker-claim-superseded" });
      }

      const started = await waitForWorkerStartAck(tab.id, owner, claim.generation, message.extra || {});
      if (!started.ok) {
        diag("error", "worker.start-failed", { owner, generation: claim.generation, tabId: tab.id, reason: started.error || "worker-start-failed" });
        chrome.tabs.sendMessage(tab.id, { type: "stopSharedWorker", owner, generation: claim.generation }, () => void chrome.runtime.lastError);
        await clearOwnerActiveFlag(owner);
        await releaseSharedWorker(claim.generation);
        if (owner === "sweep") closeAllEggTabsIfLoaded();
        await closeOwnedWorkerTab(tab.id);
        return respond({ ok: false, error: started.error || "worker-start-failed" });
      }

      respond({ ok: true, tabId: tab.id, generation: claim.generation });
    } catch (error) {
      diag("error", "worker.start-exception", { owner, generation: claim.generation, message: error?.message || String(error) });
      await releaseSharedWorker(claim.generation).catch(() => {});
      if (tab?.id != null) await closeOwnedWorkerTab(tab.id);
      respond({ ok: false, error: error?.message || "worker-start-failed" });
    }
  }

  // Owner name -> the storage key holding that feature's own progress/active flag. Used so
  // Stop always clears the feature's `active` state directly and synchronously, instead of
  // depending on the worker tab receiving and acting on `stopSharedWorker` — the exact gap
  // that let the old per-feature stop paths leave things stuck (see the header comment above
  // SHARED_WORKER_TASK_ID).
  const WORKER_OWNER_STORAGE_KEYS = {
    sweep: "owehSweep",
    breed: "owehBreedCampaign",
    index: "owehPetIndex",
    hatchlings: "owehHatchlingRun"
    // The one-button jobs (catalog, sort, feed, ninja, requests) keep no storage flag at all:
    // the shared-worker lease alone says whether they run, so there is nothing to clear.
  };

  // Owners whose claim also covers sub-runs kept under other storage keys. None right now (the
  // old Daily Maintenance feed/request sub-lanes were removed); the hook stays so a future job
  // that needs one can list it here instead of growing a special case.
  const WORKER_OWNER_DEPENDENT_KEYS = {};

  function clearOwnerActiveFlag(owner) {
    const key = WORKER_OWNER_STORAGE_KEYS[owner];
    const dependentKeys = (WORKER_OWNER_DEPENDENT_KEYS[owner] || []).filter(k => k !== key);
    const allKeys = key ? [key, ...dependentKeys] : dependentKeys;
    if (!allKeys.length) return Promise.resolve();
    return new Promise(resolve => {
      const defaults = Object.fromEntries(allKeys.map(k => [k, null]));
      chrome.storage.local.get(defaults, existing => {
        const patch = Object.fromEntries(allKeys.map(k => [k, existing[k] ? { ...existing[k], active: false } : { active: false }]));
        chrome.storage.local.set(patch, resolve);
      });
    });
  }

  async function releaseWorker(message, sender, respond) {
    const current = await readSharedWorkerTask();
    const occupied = isWorkerLeaseLive(current);
    if (current) diag("info", "worker.stop-requested", { owner: current.owner, generation: current.generation, occupied, requestedOwner: message?.owner || null, senderTabId: sender?.tab?.id ?? null });
    if (current && message?.owner && current.owner !== message.owner) {
      return respond?.({ ok: true, wasRunning: false });
    }
    if (!current) {
      return respond?.({ ok: true, wasRunning: false });
    }

    // Reserve this exact generation in a stopping state before any async cleanup. That keeps a
    // newer Start from claiming the row while an old Stop is still clearing flags/tabs.
    const stopping = occupied ? await beginSharedWorkerStop(current.generation) : current;
    if (occupied && !stopping) return respond?.({ ok: true, wasRunning: false });

    try {
      if (occupied && current.ownerTabId != null) {
        chrome.tabs.sendMessage(Number(current.ownerTabId), { type: "stopSharedWorker", owner: current.owner, generation: current.generation }, () => {
          void chrome.runtime.lastError;
        });
      }
      await clearOwnerActiveFlag(current.owner);
      if (current.owner === "sweep") closeAllEggTabsIfLoaded();
    } finally {
      await releaseSharedWorker(current.generation);
    }

    if (current.ownerTabId != null) {
      setTimeout(() => closeOwnedWorkerTab(current.ownerTabId).catch(() => {}), 500);
    }
    respond?.({ ok: true, wasRunning: occupied });
  }

  async function getWorkerStatus(message, sender, respond) {
    const current = await readSharedWorkerTask();
    const live = isWorkerLeaseLive(current);
    const worker = await mirrorSharedWorkerState(live ? current : null);
    respond({ ok: true, active: live, worker });
  }

  async function checkWorkerHealth() {
    const current = await readSharedWorkerTask();
    if (!(current && ["starting", "running", "stopping"].includes(current.status) && !isWorkerLeaseLive(current))) {
      await recoverOrphanedSweep("health-orphan-check");
      return;
    }

    diag("error", "worker.lease-expired", { owner: current.owner, generation: current.generation, tabId: current.ownerTabId, phase: current.phase, status: current.status, leaseUntil: current.leaseUntil });

    // Full Sweep's coordinator tab is protected. A delayed heartbeat can be caused by slow
    // navigation, a busy SPA, ten child egg tabs, network stalls, or temporary browser
    // scheduling. None of those is permission to close the coordinator. Revive the durable
    // lease and ask the existing tab to resume. If its content script is unresponsive, reload
    // the SAME tab and retry recovery; the tab identity survives and durable owehSweep state
    // tells the feature where to continue. Only explicit Stop / valid workerDone may close it.
    if (PROTECTED_WORKER_OWNERS.has(current.owner) && current.ownerTabId != null) {
      const tab = await readTab(current.ownerTabId);
      if (tab) {
        const revived = await reviveSharedWorkerLease(current.generation, current.ownerTabId, "lease-expired");
        if (!revived) return;
        diag("warning", "worker.protected-recovery", { owner: current.owner, generation: current.generation, tabId: current.ownerTabId, recoveryCount: revived.recoveryCount });
        const probe = await sendWorkerRecovery(current.ownerTabId, revived);
        if (!probe.ok) {
          const reloaded = await reloadWorkerTab(current.ownerTabId);
          diag(reloaded ? "warning" : "error", "worker.protected-reload", { owner: current.owner, generation: current.generation, tabId: current.ownerTabId, reloaded, reason: probe.error || "no-recovery-ack" });
          if (reloaded) {
            setTimeout(() => sendWorkerRecovery(current.ownerTabId, revived).catch(() => {}), WORKER_RECOVERY_RELOAD_DELAY_MS);
          } else if (!(await readTab(current.ownerTabId))) {
            const replacement = await createProtectedReplacement(revived, "reload-failed-tab-missing");
            if (replacement) return;
          }
        }
        return;
      }

      // The browser tab itself is gone. Keep the sweep progress record intact and release only
      // the dead lease so a new Start/recovery can claim a replacement coordinator. Do NOT
      // clear owehSweep.active here: loss of a coordinator is a recoverable infrastructure
      // failure, not a user Stop.
      diag("error", "worker.protected-tab-missing", { owner: current.owner, generation: current.generation, tabId: current.ownerTabId });
      const replacement = await createProtectedReplacement(current, "protected-tab-missing");
      if (replacement) return;
      await releaseSharedWorker(current.generation);
      await recoverOrphanedSweep("protected-tab-missing-release");
      return;
    }

    // Non-protected workers keep the old fail-closed behavior.
    if (current.ownerTabId != null) await closeOwnedWorkerTab(current.ownerTabId);
    await clearOwnerActiveFlag(current.owner);
    await releaseSharedWorker(current.generation);
    if (current.owner === "sweep") closeAllEggTabsIfLoaded();
  }

  OWEH_BG.workerManager = {
    SHARED_WORKER_TASK_ID, WORKER_HEALTH_ALARM, WORKER_HEALTH_INTERVAL_MINUTES,
    readSharedWorkerTask, isWorkerLeaseLive, mirrorSharedWorkerState, claimSharedWorker,
    attachSharedWorkerTab, markSharedWorkerStarted, beginSharedWorkerStop, updateSharedWorkerPhase,
    releaseSharedWorker, acknowledgeWorkerStarted, claimWorker, releaseWorker, getWorkerStatus,
    checkWorkerHealth, clearOwnerActiveFlag, closeOwnedWorkerTab, reviveSharedWorkerLease, recoverOrphanedSweep, createProtectedReplacement, PROTECTED_WORKER_OWNERS
  };
})();
