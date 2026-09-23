"use strict";

// Egg-turning tabs shared by own-Hatchery turning and Start full sweep. Loaded into the
// service worker by background.js (importScripts), so everything here shares its global scope.
//
// A verified coordinator asks for an adaptive batch (10 → 12 → up to 15 eggs); this file opens one real browser
// tab per egg (inactive, so focus is not stolen). Each tab clicks the real Turn Egg button,
// resolves Name the Species if it appears, confirms the egg is no longer turnable, and reports
// back. Only then may the background close that tab.
//
// SAFETY RULE: the only tabs this file ever closes are tabs it opened itself. Every tab it
// creates is written into a registry (`tabs` for tabs still working; `leftover` is retained only
// for migration/recovery from older versions). closeOwnedTab() refuses any tab id that is
// not in that registry — a tab the player opened, even a Hatchery or pet page on ovipets.com,
// can never be closed from here. The registry lives in chrome.storage.local (not memory) so a
// service-worker restart cannot forget which tabs are ours.
const EGG_TAB_STATE_KEY = "owehEggTabs";
const EGG_TAB_DEFAULT = 10;
const EGG_TAB_MAX = 15;
const EGG_TAB_STAGGER_MS = 175;
const EGG_TAB_CLOSE_DELAY_MS = 250;
const EGG_TAB_WATCHDOG_MS = 60 * 1000;
const EGG_BATCH_WATCHDOG_MS = 2 * 60 * 1000;
const EGG_TAB_ALARM_PREFIX = "oweh-egg-tab-watchdog:";
const EGG_BATCH_ALARM_PREFIX = "oweh-egg-batch-watchdog:";
// chrome.storage.session survives service-worker restarts but not a browser restart. A marker
// there proves the registry's tab ids were issued in THIS browser session.
const EGG_SESSION_KEY = "owehEggTabSession";

const eggDiag = (level, event, data = {}) => globalThis.OWEH_BG?.diagnosticLog?.append(level, "egg-tabs", event, data).catch(() => {});
const eggLightweightTabs = globalThis.OWEH_BG?.lightweightTabs || null;

function emptyEggState() {
  return { batchId: null, source: null, friendId: null, coordinatorTabId: null, expected: 0, startedAt: 0, eggIds: [], tabs: {}, results: {}, leftover: {} };
}

const eggSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function eggTabAlarmName(tabId) {
  return `${EGG_TAB_ALARM_PREFIX}${tabId}`;
}

function eggBatchAlarmName(batchId) {
  return `${EGG_BATCH_ALARM_PREFIX}${encodeURIComponent(String(batchId || ""))}`;
}

function clearEggAlarm(name) {
  try { chrome.alarms.clear(name); } catch {}
}

function scheduleEggTabWatchdog(tabId, openedAt = Date.now()) {
  try { chrome.alarms.create(eggTabAlarmName(tabId), { when: Number(openedAt || Date.now()) + EGG_TAB_WATCHDOG_MS }); } catch {}
}

function scheduleEggBatchWatchdog(batchId, startedAt = Date.now()) {
  try { chrome.alarms.create(eggBatchAlarmName(batchId), { when: Number(startedAt || Date.now()) + EGG_BATCH_WATCHDOG_MS }); } catch {}
}

async function markEggSession(batchId) {
  try { await chrome.storage.session?.set?.({ [EGG_SESSION_KEY]: String(batchId || "") }); } catch {}
}

async function eggRegistryFromThisSession() {
  const area = chrome.storage?.session;
  if (typeof area?.get !== "function") return true;
  try { return (await area.get({ [EGG_SESSION_KEY]: null }))[EGG_SESSION_KEY] != null; } catch { return true; }
}

// Forced closes skip URL verification, so they must never act on ids from an earlier browser
// session: after a restart Chrome reuses small tab ids, and a persisted watchdog alarm can fire
// before onStartup has cleared the registry. Such a registry is forgotten without closing anything.
async function forgetStaleEggRegistry() {
  if (await eggRegistryFromThisSession()) return false;
  const forgotten = await withEggState(state => {
    const count = Object.keys(state.tabs || {}).length + Object.keys(state.leftover || {}).length;
    if (count || state.batchId) Object.assign(state, emptyEggState());
    return count;
  });
  if (forgotten) eggDiag("warning", "registry.stale-session-forgotten", { count: forgotten });
  return true;
}

async function readEggState() {
  const stored = (await chrome.storage.local.get({ [EGG_TAB_STATE_KEY]: null }))[EGG_TAB_STATE_KEY];
  return { ...emptyEggState(), ...(stored || {}) };
}

function summarizeEggState(state) {
  const results = Object.values(state.results || {});
  const count = names => results.filter(result => names.includes(result.state)).length;
  return {
    ok: true,
    batchId: state.batchId,
    source: state.source,
    expected: Number(state.expected || 0),
    resolved: results.length,
    turned: count(["turned"]),
    already: count(["already"]),
    failed: count(["failed", "aborted", "timeout", "exhausted", "abandoned"]),
    systemFailed: count(["failed", "aborted", "abandoned"]),
    timedOut: count(["timeout"]),
    exhausted: count(["exhausted"]),
    exhaustedIds: Object.entries(state.results || {}).filter(([, result]) => result.state === "exhausted").map(([eggId]) => eggId),
    open: Object.keys(state.tabs || {}).length,
    leftover: Object.keys(state.leftover || {}).length,
    startedAt: Number(state.startedAt || 0),
    results: Object.fromEntries(Object.entries(state.results || {}).map(([eggId, result]) => [eggId, { state: String(result?.state || ""), reason: String(result?.reason || "").slice(0, 160) }])),
    done: Number(state.expected || 0) > 0 && results.length >= Number(state.expected || 0)
  };
}

// Push progress to the coordinator as soon as a child tab resolves. The coordinator keeps a
// low-frequency poll as a recovery fallback, but the normal path no longer waits up to a full
// polling interval after the last egg has finished.
async function publishEggBatchProgress(batchId) {
  const state = await readEggState();
  if (!state.batchId || state.batchId !== String(batchId || "") || state.coordinatorTabId == null) return false;
  if (typeof chrome.tabs?.sendMessage !== "function") return false;
  const payload = { type: "eggBatchProgress", batchId: state.batchId, source: state.source, status: summarizeEggState(state) };
  try {
    chrome.tabs.sendMessage(Number(state.coordinatorTabId), payload, () => { try { void chrome.runtime.lastError; } catch {} });
    return true;
  } catch {
    return false;
  }
}

// One read-modify-write at a time: tab results can arrive from up to 15 tabs at once, and two
// interleaved writes would drop each other's registry changes.
let eggStateChain = Promise.resolve();
function withEggState(mutate) {
  const run = eggStateChain.then(async () => {
    const state = await readEggState();
    const value = mutate(state);
    await chrome.storage.local.set({ [EGG_TAB_STATE_KEY]: state });
    return value;
  });
  eggStateChain = run.catch(() => {});
  return run;
}

function eggTabUrl(egg) {
  const user = /^\d+$/.test(String(egg.usr || "")) ? `&usr=${egg.usr}` : "";
  return `https://ovipets.com/#!/?src=pets&sub=profile${user}&pet=${egg.id}`;
}

async function createEggTab(url, lightweight = false) {
  const useLightweight = Boolean(lightweight && eggLightweightTabs?.dnrAvailable?.());
  const tab = await new Promise(resolve => {
    chrome.tabs.create({ url: useLightweight ? "about:blank" : url, active: false }, created => {
      if (chrome.runtime.lastError || !created?.id) return resolve(null);
      resolve(created);
    });
  });
  if (!tab?.id) return null;

  if (useLightweight && eggLightweightTabs?.enable) {
    await eggLightweightTabs.enable(tab.id, "sweep-egg").catch(() => false);
    await new Promise(resolve => {
      chrome.tabs.update(tab.id, { url, active: false, autoDiscardable: false }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  } else {
    chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);
  }
  return tab.id;
}

async function removeTabQuietly(tabId) {
  try {
    await chrome.tabs.remove(Number(tabId));
  } catch {
    // Already gone.
  } finally {
    await eggLightweightTabs?.disable?.(tabId, "sweep-egg-close").catch?.(() => false);
  }
}

// A registry entry alone is not proof: the player may have navigated a leftover egg tab to a
// page of their own, and Chrome may reuse a tab id after a browser restart. Before a tab is
// closed it must still be sitting on THIS egg's own page on ovipets.com.
function isStillEggTab(tabId, eggId) {
  return new Promise(resolve => {
    chrome.tabs.get(Number(tabId), tab => {
      if (chrome.runtime.lastError || !tab) return resolve(false);
      const url = String(tab.url || tab.pendingUrl || "");
      resolve(/^https:\/\/(?:app\.)?ovipets\.com\//.test(url) && new RegExp("[?&]pet=" + eggId + "(?:&|$)").test(url));
    });
  });
}

async function removeVerifiedEggTab(tabId, eggId) {
  if (!(await isStillEggTab(tabId, eggId))) return false;
  await removeTabQuietly(tabId);
  return true;
}

// The one function that closes a single tab on behalf of an egg job.
async function closeOwnedTab(tabId) {
  const id = String(tabId);
  const eggId = await withEggState(state => {
    if (state.coordinatorTabId != null && Number(state.coordinatorTabId) === Number(id)) {
      eggDiag("error", "coordinator-close-blocked", { tabId: id, batchId: state.batchId, source: state.source });
      delete state.tabs[id];
      delete state.leftover[id];
      return null;
    }
    const found = state.tabs[id]?.eggId ?? state.leftover[id] ?? null;
    delete state.tabs[id];
    delete state.leftover[id];
    return found;
  });
  clearEggAlarm(eggTabAlarmName(id));
  if (eggId == null) return { ok: false, reason: "not-owned" };
  await removeVerifiedEggTab(id, eggId);
  return { ok: true };
}

// Watchdog closes are deliberately stronger than normal lifecycle closes. The player confirmed
// extension-created egg tabs are disposable and are never repurposed, so once a registered tab
// misses its deadline we close that owned tab by id even if the page never finished loading or
// its URL cannot be verified. A foreign/user tab still cannot be closed because it is absent
// from the ownership registry.
// Forced closes live in forceTimeoutEggTab, expireEggBatch and closeAllEggTabs({ force }).


// `leftover` is now migration/recovery state only. v5.3.6 does not intentionally create new
// leftovers: explicit failure and watchdog expiry both close owned tabs. Before a new batch,
// reconcile any entries persisted by older versions so they cannot become an admission lock.
async function reconcileEggLeftovers() {
  const state = await readEggState();
  const ids = Object.keys(state.leftover || {});
  if (ids.length) eggDiag("warning", "leftovers.reconcile", { count: ids.length, batchId: state.batchId, source: state.source });
  let closed = 0;
  let forgotten = 0;
  for (const id of ids) {
    const eggId = state.leftover[id];
    const stillOwnedEgg = await isStillEggTab(id, eggId);
    const result = await closeOwnedTab(id);
    if (!result.ok) continue;
    if (stillOwnedEgg) closed += 1;
    else forgotten += 1;
  }
  return { closed, forgotten };
}

async function closeAllEggTabs(expectedSource = null, { force = false } = {}) {
  if (force && await forgetStaleEggRegistry()) return 0;
  const snapshot = await withEggState(state => {
    if (expectedSource && state.source && state.source !== expectedSource) return { entries: [], batchId: null };
    const all = [
      ...Object.entries(state.tabs).map(([id, record]) => [id, record.eggId]),
      ...Object.entries(state.leftover)
    ].filter(([id]) => state.coordinatorTabId == null || Number(id) !== Number(state.coordinatorTabId));
    if (state.coordinatorTabId != null && (state.tabs[String(state.coordinatorTabId)] || state.leftover[String(state.coordinatorTabId)])) {
      eggDiag("error", "coordinator-close-blocked", { tabId: state.coordinatorTabId, batchId: state.batchId, source: state.source, all: true });
    }
    const batchId = state.batchId;
    Object.assign(state, emptyEggState());
    return { entries: all, batchId };
  });
  if (snapshot.batchId) clearEggAlarm(eggBatchAlarmName(snapshot.batchId));
  let closed = 0;
  for (const [id, eggId] of snapshot.entries) {
    clearEggAlarm(eggTabAlarmName(id));
    if (force) { await removeTabQuietly(id); closed += 1; }
    else if (await removeVerifiedEggTab(id, eggId)) closed += 1;
  }
  return closed;
}

async function isEggBatchCoordinator(source, sender) {
  const senderTabId = sender?.tab?.id;
  if (senderTabId == null) return false;
  if (source === "sweep") {
    const current = await readSharedWorkerTask();
    return isWorkerLeaseLive(current) && current.owner === "sweep" && Number(current.ownerTabId) === Number(senderTabId);
  }
  if (source === "own") {
    const task = await globalThis.OWEH_BG?.stateDb?.getTask?.("egg-run");
    return Boolean(task) && task.status === "running" && Number(task.ownerTabId) === Number(senderTabId)
      && Number(task.leaseUntil || 0) > Date.now();
  }
  return false;
}

async function openEggBatch(message, sender) {
  const source = String(message.source || "sweep");
  if (!(await isEggBatchCoordinator(source, sender))) {
    eggDiag("warning", "batch.rejected", { source, reason: "not-egg-batch-coordinator", senderTabId: sender?.tab?.id ?? null });
    return { ok: false, reason: "not-egg-batch-coordinator" };
  }
  const configured = Number((await chrome.storage.local.get({ owehEggTabConcurrency: EGG_TAB_DEFAULT })).owehEggTabConcurrency);
  const limit = Math.max(1, Math.min(EGG_TAB_MAX, Number.isFinite(configured) ? Math.floor(configured) : EGG_TAB_DEFAULT));
  const valid = (Array.isArray(message.eggs) ? message.eggs : [])
    .map(egg => ({ id: String(egg?.id || ""), usr: String(egg?.usr || "") }))
    .filter(egg => /^\d+$/.test(egg.id) && (source === "own" || /^\d+$/.test(egg.usr)));
  const eggs = [...new Map(valid.map(egg => [egg.id, egg])).values()].slice(0, limit);
  if (!eggs.length) {
    eggDiag("warning", "batch.rejected", { source, reason: "no-valid-eggs" });
    return { ok: false, reason: "no-valid-eggs" };
  }
  const batchId = String(message.batchId || Date.now());

  // Clean leftovers from earlier failed/expired batches before admission. This includes stale
  // v5.3.4 Name-the-Species tabs, which otherwise accumulated to 10 and stopped Full Sweep.
  await reconcileEggLeftovers();

  const admission = await withEggState(state => {
    // A tab whose result is already recorded is only waiting to be closed (e.g. the service
    // worker slept inside the close delay); it must not block the next batch.
    const working = Object.values(state.tabs).filter(record => !state.results[record.eggId]);
    if (working.length) return { ok: false, reason: "busy" };
    const finished = Object.entries(state.tabs).map(([id, record]) => [id, record.eggId]);
    const previousBatchId = state.batchId;
    const startedAt = Date.now();
    Object.assign(state, {
      batchId, source, friendId: String(message.friendId || ""), coordinatorTabId: sender?.tab?.id ?? null, expected: eggs.length,
      startedAt, eggIds: eggs.map(egg => egg.id), tabs: {}, results: {}
    });
    return { ok: true, finished, previousBatchId, startedAt };
  });
  if (!admission.ok) {
    eggDiag("warning", "batch.admission-blocked", { source, batchId, reason: admission.reason || "unknown", requested: eggs.length });
    return admission;
  }
  await markEggSession(batchId);
  eggDiag("info", "batch.opened", { source, batchId, friendId: String(message.friendId || ""), expected: eggs.length, coordinatorTabId: sender?.tab?.id ?? null });
  if (admission.previousBatchId) clearEggAlarm(eggBatchAlarmName(admission.previousBatchId));
  scheduleEggBatchWatchdog(batchId, admission.startedAt);
  for (const [id, eggId] of admission.finished) { clearEggAlarm(eggTabAlarmName(id)); await removeVerifiedEggTab(id, eggId); }

  // Tabs are opened a moment apart so an adaptive 10–15 page-load burst does not hit the game in the same instant.
  (async () => {
    for (const egg of eggs) {
      await eggSleep(EGG_TAB_STAGGER_MS);
      const tabId = await createEggTab(eggTabUrl(egg), source === "sweep");
      const registered = await withEggState(state => {
        if (state.batchId !== batchId) return false;
        if (tabId == null) {
          state.results[egg.id] = { state: "failed", reason: "tab-create-failed" };
          eggDiag("error", "tab.create-failed", { batchId, eggId: egg.id });
        } else {
          state.tabs[String(tabId)] = { eggId: egg.id, openedAt: Date.now() };
          eggDiag("info", "tab.opened", { batchId, tabId, eggId: egg.id });
        }
        return true;
      });
      if (registered && tabId != null) scheduleEggTabWatchdog(tabId);
      if (registered && tabId == null) publishEggBatchProgress(batchId).catch(() => {});
      // The batch was stopped while this tab was still being created: it is ours, close it.
      if (!registered && tabId != null) await removeTabQuietly(tabId);
    }
  })().catch(error => console.error("[OviPets Helper] egg tab batch failed", error));

  return { ok: true, batchId, expected: eggs.length };
}

async function eggTabAssignment(sender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return { ok: false, reason: "no-sender-tab" };
  const state = await readEggState();
  const record = state.tabs[String(tabId)];
  return record ? { ok: true, eggId: record.eggId, batchId: state.batchId } : { ok: false, reason: "not-owned" };
}

async function eggTabResult(message, sender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return { ok: false, reason: "no-sender-tab" };
  const outcome = await withEggState(state => {
    const record = state.tabs[String(tabId)];
    if (!record || record.eggId !== String(message.eggId)) return { ok: false, reason: "not-owned" };
    if (message.state === "turned" || message.state === "already" || message.state === "exhausted" || message.state === "abandoned") {
      state.results[record.eggId] = { state: message.state, reason: String(message.reason || "") };
      // Exhausted is a confirmed terminal egg. Abandoned is a bounded safety exit (for example
      // a Species Error UI that could not be dismissed). Both are resolved failures for this
      // batch, so close this extension-owned tab and continue instead of creating leftovers.
      const done = state.expected > 0 && Object.keys(state.results).length >= state.expected;
      return { ok: true, close: true, batchId: state.batchId, done };
    }
    // Fail-open policy: a tab that explicitly reports failure is still resolved for this batch.
    // The user does not inspect/reuse automation tabs, so close it instead of retaining a
    // diagnostic leftover that could accumulate and block long-running Full Sweep work.
    state.results[record.eggId] = { state: "failed", reason: String(message.reason || "failed").slice(0, 120) };
    const done = state.expected > 0 && Object.keys(state.results).length >= state.expected;
    return { ok: true, close: true, batchId: state.batchId, done };
  });
  if (outcome.ok) eggDiag(message.state === "turned" || message.state === "already" ? "info" : "warning", "tab.result", { tabId, eggId: String(message.eggId), state: message.state || "failed", reason: String(message.reason || ""), batchId: outcome.batchId });
  clearEggAlarm(eggTabAlarmName(tabId));
  if (outcome.done && outcome.batchId) clearEggAlarm(eggBatchAlarmName(outcome.batchId));
  if (outcome.ok && outcome.batchId) publishEggBatchProgress(outcome.batchId).catch(() => {});
  if (outcome.ok && outcome.close) {
    await eggSleep(EGG_TAB_CLOSE_DELAY_MS);
    await closeOwnedTab(tabId);
  }
  return { ok: outcome.ok, reason: outcome.reason };
}

async function forceTimeoutEggTab(tabId, reason = "tab watchdog exceeded 60s") {
  const id = String(tabId);
  if (await forgetStaleEggRegistry()) {
    clearEggAlarm(eggTabAlarmName(id));
    return { ok: false, reason: "stale-session" };
  }
  const outcome = await withEggState(state => {
    const record = state.tabs[id];
    if (!record) return { ok: false, reason: "not-owned" };
    if (!state.results[record.eggId]) state.results[record.eggId] = { state: "timeout", reason };
    delete state.tabs[id];
    delete state.leftover[id];
    const done = state.expected > 0 && Object.keys(state.results).length >= state.expected;
    return { ok: true, eggId: record.eggId, batchId: state.batchId, done };
  });
  clearEggAlarm(eggTabAlarmName(id));
  if (!outcome.ok) return outcome;
  eggDiag("warning", "tab.timeout", { tabId: id, eggId: outcome.eggId, batchId: outcome.batchId, reason });
  await removeTabQuietly(id);
  if (outcome.done && outcome.batchId) clearEggAlarm(eggBatchAlarmName(outcome.batchId));
  if (outcome.batchId) publishEggBatchProgress(outcome.batchId).catch(() => {});
  return outcome;
}

async function expireEggBatch(batchId, reason = "batch watchdog exceeded 120s") {
  if (await forgetStaleEggRegistry()) {
    clearEggAlarm(eggBatchAlarmName(batchId));
    return { ok: false, reason: "stale-session", entries: [] };
  }
  const snapshot = await withEggState(state => {
    if (state.batchId !== String(batchId)) return { ok: false, reason: "unknown-batch", entries: [] };
    const entries = [
      ...Object.entries(state.tabs).map(([id, record]) => [id, record.eggId]),
      ...Object.entries(state.leftover)
    ].filter(([id]) => state.coordinatorTabId == null || Number(id) !== Number(state.coordinatorTabId));
    if (state.coordinatorTabId != null && (state.tabs[String(state.coordinatorTabId)] || state.leftover[String(state.coordinatorTabId)])) {
      eggDiag("error", "coordinator-close-blocked", { tabId: state.coordinatorTabId, batchId: state.batchId, source: state.source, watchdog: true });
    }
    for (const [, eggId] of entries) {
      if (!state.results[eggId]) state.results[eggId] = { state: "timeout", reason };
    }
    for (const eggId of state.eggIds) {
      if (!state.results[eggId]) state.results[eggId] = { state: "timeout", reason: `${reason}; tab never reported` };
    }
    state.tabs = {};
    state.leftover = {};
    return { ok: true, entries, batchId: state.batchId };
  });
  if (!snapshot.ok) return snapshot;
  eggDiag("warning", "batch.timeout", { batchId: snapshot.batchId, forcedClosed: snapshot.entries.length, reason });
  clearEggAlarm(eggBatchAlarmName(snapshot.batchId));
  for (const [id] of snapshot.entries) {
    clearEggAlarm(eggTabAlarmName(id));
    await removeTabQuietly(id);
  }
  if (snapshot.batchId) publishEggBatchProgress(snapshot.batchId).catch(() => {});
  return { ok: true, closed: snapshot.entries.length };
}

async function enforceEggWatchdogs() {
  const state = await readEggState();
  const now = Date.now();
  if (state.batchId && state.startedAt && now - Number(state.startedAt) >= EGG_BATCH_WATCHDOG_MS) {
    await expireEggBatch(state.batchId);
    return;
  }
  const overdue = Object.entries(state.tabs)
    .filter(([, record]) => now - Number(record.openedAt || state.startedAt || now) >= EGG_TAB_WATCHDOG_MS)
    .map(([tabId]) => tabId);
  for (const tabId of overdue) await forceTimeoutEggTab(tabId);
}

async function eggBatchStatus(message) {
  await enforceEggWatchdogs();
  const state = await readEggState();
  if (message.batchId && state.batchId !== String(message.batchId)) return { ok: false, reason: "unknown-batch" };
  return summarizeEggState(state);
}

async function eggBatchExpire(message) {
  return expireEggBatch(String(message.batchId), "coordinator watchdog exceeded 120s");
}

async function handleEggTabRemoved(tabId) {
  const state = await readEggState();
  const id = String(tabId);
  if (!(id in state.tabs) && !(id in state.leftover)) return;
  const outcome = await withEggState(current => {
    const record = current.tabs[id];
    if (record && !current.results[record.eggId]) {
      current.results[record.eggId] = { state: "aborted", reason: "tab was closed before the egg was confirmed" };
      eggDiag("warning", "tab.closed-early", { tabId: id, eggId: record.eggId, batchId: current.batchId });
    }
    delete current.tabs[id];
    delete current.leftover[id];
    const done = current.expected > 0 && Object.keys(current.results).length >= current.expected;
    return { batchId: current.batchId, done };
  });
  clearEggAlarm(eggTabAlarmName(id));
  await eggLightweightTabs?.disable?.(id, "sweep-egg-removed").catch?.(() => false);
  if (outcome?.done && outcome.batchId) clearEggAlarm(eggBatchAlarmName(outcome.batchId));
  if (outcome?.batchId) publishEggBatchProgress(outcome.batchId).catch(() => {});
}
chrome.tabs.onRemoved?.addListener(tabId => { handleEggTabRemoved(tabId).catch(() => {}); });
chrome.alarms.onAlarm?.addListener(alarm => {
  const name = String(alarm?.name || "");
  if (name.startsWith(EGG_TAB_ALARM_PREFIX)) {
    const tabId = name.slice(EGG_TAB_ALARM_PREFIX.length);
    forceTimeoutEggTab(tabId).catch(() => {});
    return;
  }
  if (name.startsWith(EGG_BATCH_ALARM_PREFIX)) {
    const batchId = decodeURIComponent(name.slice(EGG_BATCH_ALARM_PREFIX.length));
    expireEggBatch(batchId).catch(() => {});
  }
});
// Tab ids do not survive a browser restart; a stored id could now belong to a tab of the
// player's. Forget the registry (without closing anything) when the browser starts.
chrome.runtime.onStartup?.addListener(() => {
  withEggState(state => { Object.assign(state, emptyEggState()); }).catch(() => {});
});

// Returns true when it took the message (the response is sent asynchronously).
function handleEggTabMessage(message, sender, respond) {
  const handlers = {
    eggBatchOpen: () => openEggBatch(message, sender),
    eggTabAssignment: () => eggTabAssignment(sender),
    eggTabResult: () => eggTabResult(message, sender),
    eggBatchStatus: () => eggBatchStatus(message),
    eggBatchExpire: () => eggBatchExpire(message),
    eggBatchStop: async () => ({ ok: true, closed: await closeAllEggTabs(message.source ? String(message.source) : null, { force: true }) })
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler().then(respond).catch(error => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}
