"use strict";

// bg/egg-tabs.js through the real background.js: the batch opener, the tab registry, and above
// all the safety rule that only tabs the extension itself opened are ever closed.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
// Same code, shorter waits: the stagger and the close delay are real-time timers.
const eggTabsSource = fs.readFileSync(path.join(root, "bg", "egg-tabs.js"), "utf8")
  .replace("EGG_TAB_STAGGER_MS = 175", "EGG_TAB_STAGGER_MS = 2")
  .replace("EGG_TAB_CLOSE_DELAY_MS = 250", "EGG_TAB_CLOSE_DELAY_MS = 5")
  .replace("EGG_TAB_WATCHDOG_MS = 60 * 1000", "EGG_TAB_WATCHDOG_MS = 500")
  .replace("EGG_BATCH_WATCHDOG_MS = 2 * 60 * 1000", "EGG_BATCH_WATCHDOG_MS = 1200");

const state = {};
const created = [];
const removed = [];
const sent = [];
const removedListeners = [];
const startupListeners = [];
const tabUrls = {};
const sessionState = {};
const alarmListeners = [];
let nextTabId = 100;
let messageListener;
let context;
const later = callback => setImmediate(callback);

const chrome = {
  runtime: {
    lastError: null,
    getURL: value => value,
    sendMessage() {},
    onInstalled: { addListener() {} },
    onStartup: { addListener(listener) { startupListeners.push(listener); } },
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  offscreen: {},
  windows: { update: () => Promise.resolve() },
  alarms: { clear() {}, create() {}, onAlarm: { addListener(listener) { alarmListeners.push(listener); } } },
  storage: { session: {
    get: defaults => new Promise(resolve => later(() => resolve({ ...defaults, ...JSON.parse(JSON.stringify(sessionState)) }))),
    set: values => new Promise(resolve => later(() => { Object.assign(sessionState, JSON.parse(JSON.stringify(values))); resolve(); }))
  }, local: {
    get(defaults, callback) {
      const result = new Promise(resolve => later(() => resolve({ ...defaults, ...JSON.parse(JSON.stringify(state)) })));
      if (callback) { result.then(callback); return undefined; }
      return result;
    },
    set(values, callback) {
      const result = new Promise(resolve => later(() => { Object.assign(state, JSON.parse(JSON.stringify(values))); resolve(); }));
      if (callback) { result.then(callback); return undefined; }
      return result;
    }
  } },
  tabs: {
    onRemoved: { addListener(listener) { removedListeners.push(listener); } },
    get(id, callback) { later(() => callback(tabUrls[id] ? { id, url: tabUrls[id] } : undefined)); },
    create(options, callback) { later(() => { created.push(options); const id = nextTabId++; tabUrls[id] = options.url; callback({ id }); }); },
    update(_tabId, _props, callback) { later(() => callback?.()); },
    remove(tabId) { removed.push(Number(tabId)); return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      sent.push({ tabId, message });
      callback?.();
      if (message?.type === "startSharedWorker") {
        later(() => messageListener({ type: "workerStarted", owner: message.owner, generation: message.generation }, { tab: { id: tabId } }, () => {}));
      }
    }
  }
};

context = vm.createContext({
  chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console, Promise,
  importScripts(...files) {
    for (const file of files) {
      const loaded = file === "bg/egg-tabs.js"
        ? eggTabsSource
        : fs.readFileSync(path.join(root, file), "utf8");
      vm.runInContext(loaded, context, { filename: file });
    }
  }
});
vm.runInContext(source, context, { filename: "background.js" });

const request = (message, sender = {}) => new Promise(resolve => messageListener(message, sender, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const fromTab = id => ({ tab: { id } });
const FOREIGN_TAB = 4242;
const eggs = count => Array.from({ length: count }, (_, i) => ({ id: String(9000 + i), usr: "555" }));

(async () => {
  assert(removedListeners.length === 1, "the tab manager must listen for closed tabs");

  // Only the sweep's own worker tab may open egg tabs.
  const beforeCreate = created.length;
  const noClaim = await request({ type: "eggBatchOpen", source: "sweep", batchId: "x", friendId: "555", eggs: eggs(3) }, fromTab(FOREIGN_TAB));
  assert(noClaim.ok === false && noClaim.reason === "not-egg-batch-coordinator", "a random tab must not be able to open egg tabs");
  assert(created.length === beforeCreate, "no tab may be opened for a refused request");

  // Own-Hatchery turning uses the same owned-tab engine, authorized by the egg-run task lease.
  const ownParentTab = 5151;
  const ownClaim = await request({ type: "taskClaim", task: { id: "egg-run", kind: "navigation" } }, fromTab(ownParentTab));
  assert(ownClaim.ok, "own Hatchery tab must be able to claim egg-run");
  const ownBefore = created.length;
  const ownOpen = await request({
    type: "eggBatchOpen", source: "own", batchId: "own-b1",
    eggs: [{ id: "8801", usr: "" }, { id: "8802", usr: "" }]
  }, fromTab(ownParentTab));
  assert(ownOpen.ok && ownOpen.expected === 2, "own egg-run may open its own profile tabs");
  for (let i = 0; i < 100 && created.length - ownBefore < 2; i += 1) await sleep(10);
  assert(created[ownBefore].url === "https://ovipets.com/#!/?src=pets&sub=profile&pet=8801", "own egg URL must not require usr=");
  await request({ type: "eggBatchStop", source: "own" }, fromTab(ownParentTab));
  await request({ type: "taskRelease", id: "egg-run", status: "complete" }, fromTab(ownParentTab));
  // Isolate the sweep safety assertions below from the two correctly-closed own-egg tabs.
  removed.length = 0;

  const claim = await request({ type: "claimWorker", owner: "sweep", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  assert(claim.ok, "sweep must claim the shared worker tab");
  const workerTabId = claim.tabId;
  await sleep(40);

  const stranger = await request({ type: "eggBatchOpen", source: "sweep", batchId: "x", friendId: "555", eggs: eggs(3) }, fromTab(FOREIGN_TAB));
  assert(stranger.ok === false, "only the sweep's worker tab may open egg tabs, not any tab");

  // 12 requested -> capped at 10, one tab each, inactive, canonical profile URL.
  const createdBefore = created.length;
  const open = await request({ type: "eggBatchOpen", source: "sweep", batchId: "b1", friendId: "555", eggs: eggs(12) }, fromTab(workerTabId));
  assert(open.ok && open.expected === 10, "a batch is capped at 10 tabs");
  for (let i = 0; i < 100 && created.length - createdBefore < 10; i += 1) await sleep(20);
  await sleep(60);
  const eggTabs = created.slice(createdBefore);
  assert(eggTabs.length === 10, `expected 10 egg tabs, opened ${eggTabs.length}`);
  assert(eggTabs.every(options => options.active === false), "egg tabs must open inactive");
  assert(eggTabs[0].url === "https://ovipets.com/#!/?src=pets&sub=profile&usr=555&pet=9000", `unexpected egg tab URL ${eggTabs[0].url}`);
  const eggTabIds = eggTabs.map((_, index) => createdBefore + index + 100 - createdBefore);
  const ids = Array.from({ length: 10 }, (_, i) => workerTabId + 1 + i);
  assert(ids.length === 10 && eggTabIds.length === 10, "test bookkeeping");

  // A second batch while tabs are still working is refused.
  const busy = await request({ type: "eggBatchOpen", source: "sweep", batchId: "b2", friendId: "555", eggs: eggs(2) }, fromTab(workerTabId));
  assert(busy.ok === false && busy.reason === "busy", "a new batch must wait for the running one");

  // Assignments: owned tabs learn their egg; foreign tabs are refused.
  const a0 = await request({ type: "eggTabAssignment" }, fromTab(ids[0]));
  assert(a0.ok && a0.eggId === "9000", "an egg tab must be told which egg is its own");
  const foreign = await request({ type: "eggTabAssignment" }, fromTab(FOREIGN_TAB));
  assert(foreign.ok === false, "a tab the player opened must not receive an egg assignment");

  // A foreign tab cannot report results or get anything closed.
  const forged = await request({ type: "eggTabResult", eggId: "9001", state: "turned" }, fromTab(FOREIGN_TAB));
  assert(forged.ok === false, "a foreign tab's result must be refused");
  const wrongEgg = await request({ type: "eggTabResult", eggId: "9005", state: "turned" }, fromTab(ids[1]));
  assert(wrongEgg.ok === false, "a tab may only report its own egg");
  await sleep(30);
  assert(!removed.includes(FOREIGN_TAB), "the foreign tab must never be closed");

  // Any explicit result resolves the tab. Success, already, failure and bounded abandonment all close the owned automation tab.
  const turned = await request({ type: "eggTabResult", eggId: "9000", state: "turned" }, fromTab(ids[0]));
  assert(turned.ok, "an owned tab's result is accepted");
  assert(removed.includes(ids[0]), "a turned egg's tab must be closed");
  const already = await request({ type: "eggTabResult", eggId: "9001", state: "already", reason: "no-turn-button" }, fromTab(ids[1]));
  assert(already.ok && removed.includes(ids[1]), "an already-turned egg's tab is closed");
  const failed = await request({ type: "eggTabResult", eggId: "9002", state: "failed", reason: "command-failed" }, fromTab(ids[2]));
  assert(failed.ok, "a failure is recorded");
  await sleep(30);
  assert(removed.includes(ids[2]), "an explicitly failed automation tab must close so it cannot accumulate as a leftover");
  const abandoned = await request({ type: "eggTabResult", eggId: "9004", state: "abandoned", reason: "species-error-stuck" }, fromTab(ids[4]));
  assert(abandoned.ok, "a bounded species UI failure is recorded");
  await sleep(30);
  assert(removed.includes(ids[4]), "a species-error-stuck tab must close instead of becoming a permanent leftover");

  // The player closes one of our pending tabs by hand: counted as aborted, batch can finish.
  removedListeners[0](ids[3]);
  await sleep(30);
  let status = await request({ type: "eggBatchStatus", batchId: "b1" });
  assert(status.turned === 1 && status.already === 1 && status.failed === 3 && status.resolved === 5, `status after mixed results: ${JSON.stringify(status)}`);
  assert(status.leftover === 0 && status.open === 5 && status.done === false, "open accounting has no new leftovers");
  assert(sent.some(item => item.tabId === workerTabId && item.message?.type === "eggBatchProgress" && item.message?.batchId === "b1"),
    "egg results push progress to the coordinator instead of waiting only for polling");

  // Closing an unrelated tab must not disturb the registry.
  removedListeners[0](FOREIGN_TAB);
  await sleep(20);
  status = await request({ type: "eggBatchStatus", batchId: "b1" });
  assert(status.resolved === 5, "the player closing their own tab is not an egg result");

  // Expiry: unresolved eggs become timeouts and are force-closed. No leftover may survive.
  const beforeExpire = removed.length;
  await request({ type: "eggBatchExpire", batchId: "b1" });
  status = await request({ type: "eggBatchStatus", batchId: "b1" });
  assert(status.done === true && status.open === 0 && status.leftover === 0, `expire must fully resolve the batch: ${JSON.stringify(status)}`);
  assert(status.timedOut === 5, `five still-open tabs should time out, got ${status.timedOut}`);
  assert(removed.length >= beforeExpire + 5, "expiring a batch force-closes unresolved owned tabs");
  assert((await request({ type: "eggBatchStatus", batchId: "nope" })).reason === "unknown-batch", "unknown batches are reported");

  // Stop has nothing left to clean, and never touches foreign/worker tabs.
  const stop = await request({ type: "eggBatchStop" });
  assert(stop.ok && stop.closed === 0, `expired batch should leave no registered tabs, closed ${stop.closed}`);
  assert(!removed.includes(FOREIGN_TAB) && !removed.includes(workerTabId), "Stop must not touch tabs the extension did not open as egg tabs");

  // closeOwnedTab refuses unknown ids even for ovipets.com tabs (exercised through a stale result).
  const late = await request({ type: "eggTabResult", eggId: "9004", state: "turned" }, fromTab(ids[4]));
  assert(late.ok === false, "after Stop nothing is registered any more");

  // Stopping while tabs are still being created closes the late tabs too (they are ours).
  const before = removed.length;
  await request({ type: "eggBatchOpen", source: "sweep", batchId: "b3", friendId: "555", eggs: eggs(3) }, fromTab(workerTabId));
  await request({ type: "eggBatchStop" });
  await sleep(100);
  assert(removed.length >= before + 1, "tabs created after a Stop must be closed again");
  assert(!removed.includes(FOREIGN_TAB) && !removed.includes(workerTabId), "still no foreign/worker tab closed");

  // The player confirmed extension-created egg tabs are disposable. Force Stop closes any tab id
  // still in the owned registry, regardless of navigation, while foreign tabs remain protected.
  await request({ type: "eggBatchStop" });
  const seedLeftover = (from, count) => {
    Object.assign(state, { owehEggTabs: { ...JSON.parse(JSON.stringify(state.owehEggTabs || {})), leftover: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(from + i), String(i)])) } });
    for (let i = 0; i < count; i += 1) tabUrls[from + i] = "https://ovipets.com/#!/?src=pets&sub=profile&usr=555&pet=" + i;
  };
  seedLeftover(700, 2);
  tabUrls[700] = "https://ovipets.com/#!/?src=pets&sub=overview";
  tabUrls[701] = "https://example.com/somewhere-else";
  const navigatedAway = await request({ type: "eggBatchStop" });
  assert(navigatedAway.closed === 2, "owned registry tabs are force-closed on Stop");
  assert(removed.includes(700) && removed.includes(701), "owned disposable tabs close even if navigation changed");

  // The registry is forgotten on browser start (tab ids do not survive a restart) without closing anything.
  seedLeftover(750, 3);
  const beforeStartup = removed.length;
  startupListeners.forEach(listener => listener());
  await sleep(40);
  assert(removed.length === beforeStartup, "browser start must not close tabs");
  const afterStartup = await request({ type: "eggBatchStop" });
  assert(afterStartup.closed === 0, "the registry is empty after a browser restart");

  // A Name-the-Species Error is terminal for that egg. `exhausted` is a resolved failure:
  // close this owned tab immediately, expose its egg id to the coordinator, and do not leave
  // a leftover tab that could stall the 10-tab batch.
  await request({ type: "eggBatchStop" });
  const exhaustedOpen = await request({ type: "eggBatchOpen", source: "sweep", batchId: "bx", friendId: "555", eggs: eggs(1) }, fromTab(workerTabId));
  assert(exhaustedOpen.ok, "terminal-answer test batch must open");
  for (let i = 0; i < 100 && !Object.keys(state.owehEggTabs.tabs || {}).length; i += 1) await sleep(10);
  const exhaustedTabId = Number(Object.keys(state.owehEggTabs.tabs)[0]);
  const exhaustedEggId = state.owehEggTabs.tabs[String(exhaustedTabId)].eggId;
  const exhaustedResult = await request({ type: "eggTabResult", eggId: exhaustedEggId, state: "exhausted", reason: "species-incorrect" }, fromTab(exhaustedTabId));
  assert(exhaustedResult.ok, "terminal species result must be accepted");
  await sleep(30);
  assert(removed.includes(exhaustedTabId), "terminal species Error must close the owned egg tab");
  const exhaustedStatus = await request({ type: "eggBatchStatus", batchId: "bx" });
  assert(exhaustedStatus.done === true, "terminal batch must resolve");
  assert(exhaustedStatus.failed === 1, "terminal result counts as one failed egg");
  assert(exhaustedStatus.exhausted === 1, "terminal result must be exposed separately");
  assert(JSON.stringify(exhaustedStatus.exhaustedIds) === JSON.stringify([exhaustedEggId]), `unexpected exhausted ids: ${JSON.stringify(exhaustedStatus.exhaustedIds)}`);
  assert(exhaustedStatus.leftover === 0, "terminal Error must not create a leftover tab");
  await request({ type: "eggBatchStop" });

  // Resolved-but-unclosed tabs (service worker slept in the close delay) do not block a new batch.
  await request({ type: "eggBatchOpen", source: "sweep", batchId: "b5", friendId: "555", eggs: eggs(1) }, fromTab(workerTabId));
  for (let i = 0; i < 100 && !Object.keys(JSON.parse(JSON.stringify(state.owehEggTabs || {})).tabs || {}).length; i += 1) await sleep(10);
  const stuckTab = Object.keys(state.owehEggTabs.tabs)[0];
  state.owehEggTabs.results["9000"] = { state: "turned" };
  const next = await request({ type: "eggBatchOpen", source: "sweep", batchId: "b6", friendId: "555", eggs: eggs(1) }, fromTab(workerTabId));
  assert(next.ok === true, "a resolved tab must not block the next batch");
  await sleep(30);
  assert(removed.includes(Number(stuckTab)), "the resolved leftover tab is closed when the next batch starts");
  await request({ type: "eggBatchStop" });

  // Leftovers from an earlier batch (especially Name-the-Species failures) must never become
  // a permanent admission lock. The next batch reconciles them first. Exact owned egg tabs are
  // closed; navigated-away tabs would only be forgotten by the safety check.
  seedLeftover(800, 10);
  const reconciled = await request({ type: "eggBatchOpen", source: "sweep", batchId: "b4", friendId: "555", eggs: eggs(2) }, fromTab(workerTabId));
  assert(reconciled.ok === true, "ten stale leftover tabs must be reconciled instead of stopping Full Sweep");
  await sleep(80);
  assert(Array.from({ length: 10 }, (_, i) => 800 + i).every(id => removed.includes(id)), "verified owned leftovers are closed before the new batch");
  assert(Object.keys(state.owehEggTabs.leftover || {}).length === 0, "leftover registry must be empty after reconciliation");

  // Fast Sweep can raise the configured concurrency to 15 after clean adaptive batches.
  await request({ type: "eggBatchStop" });
  state.owehEggTabConcurrency = 15;
  const fastBefore = created.length;
  const fastOpen = await request({ type: "eggBatchOpen", source: "sweep", batchId: "fast-15", friendId: "555", eggs: eggs(16) }, fromTab(workerTabId));
  assert(fastOpen.ok && fastOpen.expected === 15, "adaptive Fast Sweep may open up to 15 owned egg tabs");
  for (let i = 0; i < 100 && created.length - fastBefore < 15; i += 1) await sleep(10);
  assert(created.length - fastBefore === 15, "15 child tabs are created when adaptive concurrency reaches 15");
  await request({ type: "eggBatchStop", source: "sweep" });
  state.owehEggTabConcurrency = 10;

  // Rolling window: the coordinator tops a running batch up to the limit of unresolved tabs.
  await request({ type: "eggBatchStop" });
  const rollBefore = created.length;
  const rollOpen = await request({ type: "eggBatchOpen", source: "sweep", batchId: "roll", friendId: "555", eggs: eggs(3) }, fromTab(workerTabId));
  assert(rollOpen.ok && rollOpen.expected === 3, "rolling test batch opens");
  const foreignExtend = await request({ type: "eggBatchExtend", source: "sweep", batchId: "roll", friendId: "555", eggs: eggs(12) }, fromTab(FOREIGN_TAB));
  assert(foreignExtend.ok === false && foreignExtend.reason === "not-egg-batch-coordinator", "only the coordinator may extend a batch");
  const extended = await request({ type: "eggBatchExtend", source: "sweep", batchId: "roll", friendId: "555", eggs: eggs(12) }, fromTab(workerTabId));
  assert(extended.ok && extended.added === 7 && extended.expected === 10, `extension fills up to 10 unresolved: ${JSON.stringify(extended)}`);
  assert(JSON.stringify(extended.addedIds) === JSON.stringify(["9003", "9004", "9005", "9006", "9007", "9008", "9009"]), "eggs already in the batch are not added twice");
  for (let i = 0; i < 200 && Object.keys(state.owehEggTabs?.tabs || {}).length < 10; i += 1) await sleep(5);
  assert(created.length - rollBefore === 10, `one tab per egg across open + extension, got ${created.length - rollBefore}`);
  const full = await request({ type: "eggBatchExtend", source: "sweep", batchId: "roll", friendId: "555", eggs: eggs(11) }, fromTab(workerTabId));
  assert(full.ok && full.added === 0, "no room while 10 tabs are unresolved");
  const rollTabs = Object.entries(state.owehEggTabs.tabs);
  const [firstTabId, firstRecord] = rollTabs[0];
  await request({ type: "eggTabResult", eggId: firstRecord.eggId, state: "turned" }, fromTab(Number(firstTabId)));
  const refill = await request({ type: "eggBatchExtend", source: "sweep", batchId: "roll", friendId: "555", eggs: eggs(11) }, fromTab(workerTabId));
  assert(refill.ok && refill.added === 1 && refill.expected === 11, `a resolved tab frees one slot: ${JSON.stringify(refill)}`);
  assert(state.owehEggTabs.extendedAt > 0, "a top-up restarts the batch watchdog clock");
  const wrongBatch = await request({ type: "eggBatchExtend", source: "sweep", batchId: "other", friendId: "555", eggs: eggs(12) }, fromTab(workerTabId));
  assert(wrongBatch.ok === false && wrongBatch.reason === "unknown-batch", "an unknown batch cannot be extended");
  await sleep(40);
  await request({ type: "eggBatchExpire", batchId: "roll" });
  const afterDone = await request({ type: "eggBatchExtend", source: "sweep", batchId: "roll", friendId: "555", eggs: [{ id: "9500", usr: "555" }] }, fromTab(workerTabId));
  assert(afterDone.ok === false && afterDone.reason === "done", "a finished batch is never reopened");
  await request({ type: "eggBatchStop", source: "sweep" });

  // Per-tab watchdog: a tab with no report after 60s (40ms in this test) is marked timeout and force-closed.
  await request({ type: "eggBatchStop" });
  const wdOpen = await request({ type: "eggBatchOpen", source: "sweep", batchId: "wd-tab", friendId: "555", eggs: eggs(2) }, fromTab(workerTabId));
  assert(wdOpen.ok, "watchdog test batch opens");
  for (let i = 0; i < 100 && Object.keys(state.owehEggTabs?.tabs || {}).length < 2; i += 1) await sleep(5);
  const wdIds = Object.keys(state.owehEggTabs.tabs).map(Number);
  await sleep(550);
  const wdStatus = await request({ type: "eggBatchStatus", batchId: "wd-tab" });
  assert(wdStatus.done && wdStatus.timedOut === 2 && wdStatus.open === 0, `per-tab watchdog resolves stale tabs: ${JSON.stringify(wdStatus)}`);
  assert(wdIds.every(id => removed.includes(id)), "per-tab watchdog force-closes both owned tabs");

  // Batch watchdog: even when individual openedAt values look fresh, a >120s batch is force-resolved.
  await request({ type: "eggBatchStop" });
  const batchWd = await request({ type: "eggBatchOpen", source: "sweep", batchId: "wd-batch", friendId: "555", eggs: eggs(2) }, fromTab(workerTabId));
  assert(batchWd.ok, "batch watchdog test opens");
  for (let i = 0; i < 100 && Object.keys(state.owehEggTabs?.tabs || {}).length < 2; i += 1) await sleep(5);
  state.owehEggTabs.startedAt = Date.now() - 2000;
  const batchStatus = await request({ type: "eggBatchStatus", batchId: "wd-batch" });
  assert(batchStatus.done && batchStatus.timedOut === 2 && batchStatus.open === 0, `batch watchdog resolves the whole batch: ${JSON.stringify(batchStatus)}`);

  // Coordinator protection: even if corrupted/stale egg registry state accidentally contains
  // the Full Sweep worker tab id, egg cleanup/watchdogs must refuse to close the coordinator.
  await request({ type: "eggBatchStop" });
  state.owehEggTabs = {
    ...(state.owehEggTabs || {}),
    batchId: "corrupt-coordinator", source: "sweep", coordinatorTabId: workerTabId, expected: 1,
    eggIds: ["99999"], results: {}, leftover: {},
    tabs: { [String(workerTabId)]: { eggId: "99999", openedAt: Date.now() - 5000 } }
  };
  const removedBeforeCoordinatorGuard = removed.filter(id => id === workerTabId).length;
  const guardedStop = await request({ type: "eggBatchStop", source: "sweep" });
  assert(guardedStop.ok, "corrupted egg registry cleanup still completes");
  assert(removed.filter(id => id === workerTabId).length === removedBeforeCoordinatorGuard,
    "egg cleanup must never close the Full Sweep coordinator tab");

  // Stopping the sweep through the shared-worker release closes the newly-opened egg tabs too.
  const released = await request({ type: "releaseWorker", owner: "sweep" });
  assert(released.ok && released.wasRunning === true, "sweep release");
  await sleep(600);
  assert(!removed.includes(FOREIGN_TAB), "the foreign tab survives everything");

  // Browser restart: storage.session is wiped, Chrome reuses small tab ids, and a persisted
  // watchdog alarm may fire before onStartup clears the registry. Forced closes must not touch
  // ids from the previous browser session, which may now belong to the player's own tabs.
  assert(sessionState.owehEggTabSession != null, "opening a batch marks this browser session");
  for (const key of Object.keys(sessionState)) delete sessionState[key];
  state.owehEggTabs = {
    batchId: "old-session", source: "sweep", coordinatorTabId: null, expected: 2, startedAt: Date.now() - 5000,
    eggIds: ["1", "2"], results: {}, leftover: { 811: "2" },
    tabs: { 810: { eggId: "1", openedAt: Date.now() - 5000 } }
  };
  tabUrls[810] = "https://ovipets.com/#!/?src=pets&sub=hatchery";
  tabUrls[811] = "https://mail.example.com/inbox";
  const removedBeforeRestart = removed.length;
  alarmListeners.forEach(listener => listener({ name: "oweh-egg-tab-watchdog:810" }));
  alarmListeners.forEach(listener => listener({ name: "oweh-egg-batch-watchdog:old-session" }));
  await sleep(60);
  const restartStop = await request({ type: "eggBatchStop" });
  assert(removed.length === removedBeforeRestart, `no tab from a previous browser session may be force-closed: ${JSON.stringify(removed.slice(removedBeforeRestart))}`);
  assert(restartStop.closed === 0 && Object.keys(state.owehEggTabs.tabs || {}).length === 0, "the stale registry is forgotten");

  console.log("egg tab manager tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
