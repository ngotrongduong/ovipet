"use strict";

// Name the Species is shared with the full extension, file for file (scripts/sync-lite-species.js):
// the silhouette matcher, the totals and wrong-case store, and the learned overlay with the
// safety pause. This file only wires them to the sweep.
importScripts("domain/species-shape.js", "bg/species-stats.js", "bg/species-learned.js", "bg/species-shared.js", "bg/self-update.js");
const speciesStats = globalThis.OWEH_BG.speciesStats;
const speciesLearned = globalThis.OWEH_BG.speciesLearned;
const speciesShared = globalThis.OWEH_BG.speciesShared;
const selfUpdate = globalThis.OWEH_BG.selfUpdate;
// A new version is loaded only in a quiet moment; with a running sweep that is the wait between
// two passes, and only while this much of it is left.
const UPDATE_QUIET_MS = 90 * 1000;

const STATE_KEY = "owehLiteSweep";
// Lite 0.1 kept its totals and wrong cases under these keys; they are moved once.
const LEGACY_STATS_KEY = "owehLiteSpeciesStats";
const LEGACY_WRONG_KEY = "owehLiteSpeciesWrongCases";
const SPEED_KEY = "owehLiteSpeed";
const BATCH_KEY = "owehLiteBatch";
const WATCHDOG_ALARM = "oweh-lite-watchdog";
const RESUME_ALARM = "oweh-lite-resume";
const BLOCK_RULE = 5411001;
const CHALLENGE_RULE = 5411002;
const SPEED_LEVELS = [3, 4, 6];
const TAB_TIMEOUT_MS = 60 * 1000;
const CYCLE_WAIT_MS = 10 * 60 * 1000;
const OPEN_STAGGER_MS = 120;
const CHALLENGE_REGEX = "^https://(app\\.)?ovipets\\.com/img/pet/[0-9]+/credit-challenge/?(\\?.*)?$";
const ALLOWED_IMAGE_HOSTS = new Set(["ovipets.com", "app.ovipets.com"]);

const sessionStore = chrome.storage.session || chrome.storage.local;
let batchChain = Promise.resolve();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function localGet(key, fallback) {
  const result = await chrome.storage.local.get({ [key]: fallback });
  return result[key] ?? fallback;
}
async function localSet(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
async function sessionGet(key, fallback) {
  const result = await sessionStore.get({ [key]: fallback });
  return result[key] ?? fallback;
}
async function sessionSet(key, value) {
  await sessionStore.set({ [key]: value });
}
async function sessionRemove(key) {
  await sessionStore.remove(key);
}

function defaultState() {
  return {
    active: false,
    workerTabId: null,
    queue: [],
    index: 0,
    cycle: 1,
    phase: "idle",
    friendAttempts: {},
    waitingUntil: 0,
    startedAt: 0
  };
}

async function getState() {
  return { ...defaultState(), ...(await localGet(STATE_KEY, defaultState())) };
}
async function saveState(state) {
  await localSet(STATE_KEY, { ...defaultState(), ...(state || {}) });
  return state;
}

function canonicalEggUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    if (value.startsWith("#")) return "https://ovipets.com/" + value;
    const url = new URL(value, "https://ovipets.com/");
    if (url.protocol !== "https:" || !/^(?:app\.)?ovipets\.com$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function allowedSpeciesImageUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    if (!/^\/img\/pet\/\d+\/credit-challenge\/?$/.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchSpeciesImage(raw) {
  const url = allowedSpeciesImageUrl(raw);
  if (!url) return { ok: false, error: "invalid-species-image-url" };
  const response = await fetch(url.href, { credentials: "include", cache: "no-store" });
  if (!response.ok) return { ok: false, error: "species-image-http-" + response.status };
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > 1024 * 1024) return { ok: false, error: "species-image-size" };
  const type = String(response.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!/^image\//i.test(type)) return { ok: false, error: "species-image-not-image" };
  return { ok: true, dataUrl: `data:${type};base64,${bytesToBase64(new Uint8Array(buffer))}` };
}

async function getBatch() {
  return await sessionGet(BATCH_KEY, null);
}

function batchSummary(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    friendId: batch.friendId,
    expected: batch.expected,
    queued: batch.queue.length,
    open: Object.keys(batch.active || {}).length,
    resolved: batch.resolved || 0,
    turned: batch.turned || 0,
    already: batch.already || 0,
    exhausted: batch.exhausted || 0,
    failed: batch.failed || 0,
    timedOut: batch.timedOut || 0,
    concurrency: batch.concurrency
  };
}

async function updateNetworkRules() {
  const state = await getState();
  const batch = await getBatch();
  const ids = new Set();
  if (state.active && Number.isInteger(Number(state.workerTabId))) ids.add(Number(state.workerTabId));
  for (const id of Object.keys(batch?.active || {})) {
    const numeric = Number(id);
    if (Number.isInteger(numeric)) ids.add(numeric);
  }
  const tabIds = [...ids];
  const addRules = tabIds.length ? [
    {
      id: CHALLENGE_RULE,
      priority: 2,
      action: { type: "allow" },
      condition: { tabIds, regexFilter: CHALLENGE_REGEX, resourceTypes: ["image"] }
    },
    {
      id: BLOCK_RULE,
      priority: 1,
      action: { type: "block" },
      condition: { tabIds, resourceTypes: ["image", "media", "font"] }
    }
  ] : [];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [BLOCK_RULE, CHALLENGE_RULE],
    addRules
  });
}

async function readSpeed() {
  const raw = await localGet(SPEED_KEY, { level: 3, cleanStreak: 0, slowStreak: 0 });
  const level = SPEED_LEVELS.includes(Number(raw.level)) ? Number(raw.level) : 3;
  return {
    level,
    cleanStreak: Math.max(0, Number(raw.cleanStreak || 0)),
    slowStreak: Math.max(0, Number(raw.slowStreak || 0))
  };
}

async function updateSpeed(batch) {
  const speed = await readSpeed();
  let index = SPEED_LEVELS.indexOf(speed.level);
  let cleanStreak = speed.cleanStreak;
  let slowStreak = speed.slowStreak;
  const problems = Number(batch.failed || 0) + Number(batch.timedOut || 0);
  const durations = Array.isArray(batch.durations) ? batch.durations : [];
  const averageMs = durations.length ? durations.reduce((a,b) => a + b, 0) / durations.length : 0;
  const slow = averageMs > 18000;

  if (problems > 0) {
    index = Math.max(0, index - 1);
    cleanStreak = 0;
    slowStreak = 0;
  } else if (slow) {
    cleanStreak = 0;
    slowStreak += 1;
    if (slowStreak >= 2) {
      index = Math.max(0, index - 1);
      slowStreak = 0;
    }
  } else if (batch.expected >= speed.level) {
    cleanStreak += 1;
    slowStreak = 0;
    if (cleanStreak >= 3 && index < SPEED_LEVELS.length - 1) {
      index += 1;
      cleanStreak = 0;
    }
  }

  const next = { level: SPEED_LEVELS[index], cleanStreak, slowStreak, averageMs: Math.round(averageMs), updatedAt: Date.now() };
  await localSet(SPEED_KEY, next);
  return next;
}

async function notifyWorker(type, payload = {}) {
  const state = await getState();
  const tabId = Number(state.workerTabId);
  if (!state.active || !Number.isInteger(tabId)) return;
  try { await chrome.tabs.sendMessage(tabId, { type, ...payload }); } catch {}
}

async function openMore(batch) {
  while (batch.queue.length && Object.keys(batch.active).length < batch.concurrency) {
    const egg = batch.queue.shift();
    const url = canonicalEggUrl(egg.url || egg.href);
    if (!url) {
      batch.failed += 1;
      batch.resolved += 1;
      continue;
    }
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}
    } catch {
      batch.failed += 1;
      batch.resolved += 1;
      continue;
    }
    batch.active[String(tab.id)] = {
      eggId: String(egg.id),
      url,
      openedAt: Date.now()
    };
    await sessionSet(BATCH_KEY, batch);
    await updateNetworkRules();
    await sleep(OPEN_STAGGER_MS);
  }
  return batch;
}

async function finishBatch(batch) {
  const speed = await updateSpeed(batch);
  await sessionRemove(BATCH_KEY);
  const state = await getState();
  if (state.active) {
    state.phase = "verify";
    await saveState(state);
  }
  await updateNetworkRules();
  await notifyWorker("liteBatchComplete", { summary: batchSummary(batch), speed });
}

async function maybeFinishOrFill(batch) {
  await openMore(batch);
  await sessionSet(BATCH_KEY, batch);
  await updateNetworkRules();
  await notifyWorker("liteBatchProgress", { summary: batchSummary(batch) });
  if (!batch.queue.length && !Object.keys(batch.active).length) await finishBatch(batch);
}

function serializeBatch(task) {
  const run = batchChain.then(task);
  batchChain = run.catch(() => {});
  return run;
}

async function startBatch(message, sender) {
  return serializeBatch(async () => {
    const state = await getState();
    if (!state.active || Number(state.workerTabId) !== Number(sender.tab?.id)) {
      return { ok: false, reason: "not-worker" };
    }
    const existing = await getBatch();
    if (existing) return { ok: false, reason: "batch-busy", summary: batchSummary(existing) };
    const eggs = (Array.isArray(message.eggs) ? message.eggs : [])
      .map(item => ({ id: String(item?.id || ""), url: canonicalEggUrl(item?.href || item?.url) }))
      .filter(item => item.id && item.url);
    if (!eggs.length) return { ok: true, empty: true };

    const speed = await readSpeed();
    const friendId = String(message.friendId || "");
    state.phase = "batch";
    state.friendAttempts = { ...(state.friendAttempts || {}) };
    state.friendAttempts[friendId] = Number(state.friendAttempts[friendId] || 0) + 1;
    await saveState(state);

    const batch = {
      id: "lite-" + Date.now().toString(36),
      friendId,
      workerTabId: sender.tab.id,
      expected: eggs.length,
      queue: eggs,
      active: {},
      concurrency: speed.level,
      resolved: 0,
      turned: 0,
      already: 0,
      exhausted: 0,
      failed: 0,
      timedOut: 0,
      durations: [],
      startedAt: Date.now()
    };
    await sessionSet(BATCH_KEY, batch);
    await maybeFinishOrFill(batch);
    return { ok: true, summary: batchSummary(batch) };
  });
}

async function eggResult(message, sender) {
  return serializeBatch(async () => {
    const batch = await getBatch();
    const tabId = String(sender.tab?.id ?? "");
    const assignment = batch?.active?.[tabId];
    if (!batch || !assignment) return { ok: false, reason: "not-assigned" };

    const duration = Math.max(0, Date.now() - Number(assignment.openedAt || Date.now()));
    batch.durations.push(duration);
    batch.resolved += 1;
    const state = String(message.state || "failed");
    if (state === "turned") batch.turned += 1;
    else if (state === "already") batch.already += 1;
    else if (state === "exhausted") batch.exhausted += 1;
    else batch.failed += 1;
    delete batch.active[tabId];
    await sessionSet(BATCH_KEY, batch);
    try { await chrome.tabs.remove(Number(tabId)); } catch {}
    await maybeFinishOrFill(batch);
    return { ok: true };
  });
}

async function handleRemovedTab(tabId) {
  return serializeBatch(async () => {
    const batch = await getBatch();
    const key = String(tabId);
    const assignment = batch?.active?.[key];
    if (!batch || !assignment) return;
    batch.resolved += 1;
    batch.failed += 1;
    batch.durations.push(Math.max(0, Date.now() - Number(assignment.openedAt || Date.now())));
    delete batch.active[key];
    await maybeFinishOrFill(batch);
  });
}

async function stopBatch() {
  return serializeBatch(async () => {
    const batch = await getBatch();
    if (batch) {
      const ids = Object.keys(batch.active || {}).map(Number).filter(Number.isInteger);
      await sessionRemove(BATCH_KEY);
      if (ids.length) {
        try { await chrome.tabs.remove(ids); } catch {}
      }
    }
    await updateNetworkRules();
  });
}

async function startSweep(message, sender) {
  const workerTabId = Number(sender.tab?.id);
  if (!Number.isInteger(workerTabId)) return { ok: false, reason: "tab-required" };
  // Safety pause: the sweep would stop again at its first quiz.
  const guard = await speciesLearned.readGuard();
  if (guard.paused) return { ok: false, reason: "species-paused", paused: guard.paused };
  const existingState = await getState();
  if (existingState.active && Number(existingState.workerTabId) !== workerTabId) {
    return { ok: false, reason: "already-running" };
  }
  try { await chrome.tabs.update(workerTabId, { autoDiscardable: false }); } catch {}
  const queue = (Array.isArray(message.queue) ? message.queue : [])
    .map(friend => ({
      id: String(friend?.id || ""),
      name: String(friend?.name || friend?.id || ""),
      hatchery: String(friend?.hatchery || "")
    }))
    .filter(friend => friend.id && friend.hatchery);
  if (!queue.length) return { ok: false, reason: "empty-friend-list" };

  await stopBatch();
  await chrome.alarms.clear(RESUME_ALARM);
  const state = {
    ...defaultState(),
    active: true,
    workerTabId,
    queue,
    index: 0,
    cycle: 1,
    phase: "friend",
    startedAt: Date.now()
  };
  await saveState(state);
  await updateNetworkRules();
  return { ok: true, state };
}

async function stopSweep() {
  const state = await getState();
  const workerTabId = Number(state.workerTabId);
  state.active = false;
  state.phase = "idle";
  state.waitingUntil = 0;
  await saveState(state);
  await chrome.alarms.clear(RESUME_ALARM);
  await stopBatch();
  await updateNetworkRules();
  if (Number.isInteger(workerTabId)) {
    try { await chrome.tabs.update(workerTabId, { autoDiscardable: true }); } catch {}
  }
  return { ok: true };
}

async function advanceFriend(sender) {
  const state = await getState();
  if (!state.active || Number(state.workerTabId) !== Number(sender.tab?.id)) return { ok: false, reason: "not-worker" };
  if (state.index + 1 < state.queue.length) {
    state.index += 1;
    state.phase = "friend";
    await saveState(state);
    return { ok: true, state };
  }
  state.phase = "wait";
  state.waitingUntil = Date.now() + CYCLE_WAIT_MS;
  await saveState(state);
  await chrome.alarms.create(RESUME_ALARM, { when: state.waitingUntil });
  return { ok: true, state };
}

// Totals and wrong cases of Lite 0.1 move to the shared store's keys once; every species
// request waits for it.
async function migrateSpeciesKeys() {
  const stored = await chrome.storage.local.get({
    [LEGACY_STATS_KEY]: null, [LEGACY_WRONG_KEY]: null, owehSpeciesStats: null, owehSpeciesWrongCases: null
  });
  const oldStats = stored[LEGACY_STATS_KEY];
  const oldCases = Array.isArray(stored[LEGACY_WRONG_KEY]) ? stored[LEGACY_WRONG_KEY] : [];
  if (!oldStats && !oldCases.length) return;
  // One write moves the data and blanks the old keys together, so an interrupted start can
  // neither lose the 0.1 totals nor add them twice. They are added to whatever already exists.
  const moved = { [LEGACY_STATS_KEY]: null, [LEGACY_WRONG_KEY]: null };
  if (oldStats) {
    moved.owehSpeciesStats = {
      correct: Math.max(0, Number(stored.owehSpeciesStats?.correct || 0)) + Math.max(0, Number(oldStats.correct || 0)),
      wrong: Math.max(0, Number(stored.owehSpeciesStats?.wrong || 0)) + Math.max(0, Number(oldStats.wrong || 0))
    };
  }
  if (oldCases.length) {
    const current = Array.isArray(stored.owehSpeciesWrongCases) ? stored.owehSpeciesWrongCases : [];
    const known = new Set(current.map(item => String(item?.id || "")));
    moved.owehSpeciesWrongCases = [...current, ...oldCases.filter(item => !known.has(String(item?.id || "")))]
      .slice(0, speciesStats.MAX_WRONG_CASES);
  }
  await chrome.storage.local.set(moved);
  await chrome.storage.local.remove([LEGACY_STATS_KEY, LEGACY_WRONG_KEY]).catch(() => {});
}
const speciesReady = migrateSpeciesKeys().catch(() => {});

// The totals and the safety pause see the same answers. When the pause trips, the sweep stops
// (its egg tabs close) and the owner gets the review page.
async function bumpSpecies(message) {
  const result = await speciesStats.bump(message);
  const { guard, tripped } = await speciesLearned.noteAnswers(message)
    .catch(() => ({ guard: null, tripped: false }));
  if (tripped) await pauseSweep(guard?.paused?.reason || "");
  return { ...result, guard, tripped };
}

// Stop first; telling the worker tab and opening the review page must not hold the stop up.
async function pauseSweep(reason) {
  const workerTabId = Number((await getState()).workerTabId);
  await stopSweep().catch(() => {});
  if (Number.isInteger(workerTabId)) {
    chrome.tabs.sendMessage(workerTabId, { type: "liteSpeciesPaused", reason }).catch(() => {});
  }
  speciesLearned.openReview().catch(() => {});
}

// A species the game rejected (or overruled) for an image must not stay learned for it.
async function forgetRefutedSpecies(result, refuted = null) {
  const targets = [...(Array.isArray(result?.overruled) ? result.overruled : [])];
  if (refuted) targets.push(refuted);
  for (const target of targets) {
    await speciesLearned.forget({ ...target, refuted: true }).catch(() => null);
  }
  return result;
}

function speciesRequest(message) {
  const rejected = message.case || {};
  const handlers = {
    speciesStatsBump: () => bumpSpecies(message),
    speciesWrongCaseRecord: () => speciesStats.recordWrong(message)
      .then(result => forgetRefutedSpecies(result, { species: rejected.wrongSpecies, shape: rejected.shape })),
    speciesWrongCaseResolve: () => speciesStats.resolveWrong(message).then(forgetRefutedSpecies),
    speciesWrongCasesGet: () => speciesStats.readWrongCases().then(cases => ({ ok: true, cases, count: cases.length })),
    speciesWrongCasesClear: () => speciesStats.clearWrongCases(message),
    speciesConfirmedShape: () => speciesLearned.learn(message),
    speciesOwnerLabel: () => speciesLearned.labelCase(message),
    speciesLearnedGet: () => speciesLearned.readAll().then(library => ({ ok: true, library })),
    speciesGuardGet: () => speciesLearned.status(),
    speciesGuardResume: () => speciesLearned.resume(),
    speciesWrongReviewOpen: () => speciesLearned.openReview(),
    speciesSharedStatus: () => speciesShared.status(),
    speciesSharedToken: () => speciesShared.setToken(message),
    speciesSharedSync: () => speciesShared.sync({ force: true })
  };
  const handler = handlers[message?.type];
  return handler ? speciesReady.then(handler) : null;
}

async function watchdog() {
  const state = await getState();
  if (!state.active) return;
  const workerTabId = Number(state.workerTabId);
  try { await chrome.tabs.get(workerTabId); }
  catch {
    await stopSweep();
    return;
  }

  await serializeBatch(async () => {
    const batch = await getBatch();
    if (!batch) return;
    const now = Date.now();
    const timedOut = [];
    for (const [tabId, assignment] of Object.entries(batch.active || {})) {
      if (now - Number(assignment.openedAt || now) >= TAB_TIMEOUT_MS) timedOut.push(Number(tabId));
    }
    if (!timedOut.length) return;
    for (const tabId of timedOut) {
      const key = String(tabId);
      const assignment = batch.active[key];
      if (!assignment) continue;
      batch.resolved += 1;
      batch.failed += 1;
      batch.timedOut += 1;
      batch.durations.push(now - Number(assignment.openedAt || now));
      delete batch.active[key];
    }
    await sessionSet(BATCH_KEY, batch);
    try { await chrome.tabs.remove(timedOut); } catch {}
    await maybeFinishOrFill(batch);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (type === "liteDelay") {
    const ms = Math.max(0, Math.min(5000, Math.floor(Number(message.ms) || 0)));
    setTimeout(() => sendResponse({ ok: true, ms }), ms);
    return true;
  }
  if (type === "liteGetState") {
    speciesReady.then(() => Promise.all([getState(), getBatch(), readSpeed(), speciesStats.read(), speciesLearned.readGuard(), selfUpdate.status()]))
      .then(([state,batch,speed,stats,guard,update]) => sendResponse({
        ok: true,
        state,
        batch: batchSummary(batch),
        speed,
        stats,
        paused: guard.paused,
        update: { pending: update.pending?.version || "", waitingFor: update.waitingFor },
        isWorker: state.active && Number(state.workerTabId) === Number(sender.tab?.id)
      }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  const species = speciesRequest(message);
  if (species) {
    species.then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (type === "liteStartSweep") {
    startSweep(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteStopSweep") {
    stopSweep().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteAdvanceFriend") {
    advanceFriend(sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteStartBatch") {
    startBatch(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteAssignment") {
    getBatch().then(batch => {
      const assignment = batch?.active?.[String(sender.tab?.id ?? "")];
      sendResponse(assignment ? { ok: true, assignment } : { ok: false, reason: "not-assigned" });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteEggResult") {
    // An egg tab that met the safety pause means the sweep must not go on, whatever happened
    // to the stop that normally follows the pause. Stopping closes the batch's tabs; the egg is
    // not counted as a failed turn and no replacement tab is opened.
    const done = message.reason === "species-paused"
      ? stopSweep().then(() => ({ ok: true, stopped: true }))
      : eggResult(message, sender);
    done.then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "liteSpeciesImage") {
    fetchSpeciesImage(message.url).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  getState().then(state => {
    if (state.active && Number(state.workerTabId) === Number(tabId)) stopSweep().catch(() => {});
    else handleRemovedTab(tabId).catch(() => {});
  }).catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === WATCHDOG_ALARM) watchdog().catch(() => {});
  if (alarm.name === RESUME_ALARM) {
    getState().then(async state => {
      if (!state.active || state.phase !== "wait") return;
      state.index = 0;
      state.cycle = Math.max(1, Number(state.cycle || 1)) + 1;
      state.phase = "friend";
      state.waitingUntil = 0;
      state.friendAttempts = {};
      await saveState(state);
      await notifyWorker("liteResume", { state });
    }).catch(() => {});
  }
});

chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
updateNetworkRules().catch(() => {});

// The alarm that starts the next pass does not survive an extension reload: without it a sweep
// reloaded during its wait would wait forever.
async function ensureResumeAlarm() {
  const state = await getState();
  if (!state.active || state.phase !== "wait") return;
  if (await chrome.alarms.get(RESUME_ALARM)) return;
  await chrome.alarms.create(RESUME_ALARM, { when: Math.max(Number(state.waitingUntil || 0), Date.now() + 5000) });
}
ensureResumeAlarm().catch(() => {});

// The Name-the-Species database shared with the full extension and every other install
// (bg/species-shared.js): read every hour, sent too once a token is saved on the review page.
// Started at the top level: its alarm listener must exist when an alarm wakes this worker.
speciesShared.start();

// Self-update (bg/self-update.js, shared): a newer version in this folder — put there by
// auto-update.ps1 or by hand — is loaded when no sweep runs, or in the wait between two passes.
// The reload keeps the sweep's state; the worker tab is refreshed and carries on from it.
const REVIEW_PAGE_URL = chrome.runtime.getURL("review/species-review.html");
async function sweepBusy() {
  const front = await chrome.tabs.query({ active: true }).catch(() => []);
  if (front.some(tab => String(tab.url || "").startsWith(REVIEW_PAGE_URL))) return "the review page (close it or switch tabs)";
  const state = await getState();
  if (!state.active) return "";
  const quiet = state.phase === "wait" && !(await getBatch())
    && Number(state.waitingUntil || 0) - Date.now() > UPDATE_QUIET_MS;
  return quiet ? "" : "the sweep (it loads between two passes)";
}
selfUpdate.start({
  busy: sweepBusy,
  tabUrls: ["https://ovipets.com/*", "https://app.ovipets.com/*"],
  beforeReload: async () => {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return { review: tabs.some(tab => String(tab.url || "").startsWith(REVIEW_PAGE_URL)) };
  },
  onApplied: async ({ resume }) => {
    await ensureResumeAlarm().catch(() => {});
    if (resume?.review) await speciesLearned.openReview({ focus: false }).catch(() => null);
  }
});
