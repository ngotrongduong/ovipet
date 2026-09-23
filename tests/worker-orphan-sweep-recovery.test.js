"use strict";

// Regression for live v5.3.9 failure: owehSweep stayed active after the protected coordinator
// disappeared and the shared-worker row was released. The dashboard still said "running" but
// no worker existed to advance the cursor. Health checks must self-heal that orphaned state by
// creating a replacement coordinator and sending recoverSharedWorker without resetting pass/index.
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

let now = 1_800_100_000_000;
class FakeDate extends Date {
  constructor(...args) { super(args.length ? args[0] : now); }
  static now() { return now; }
}

const state = {
  owehSweep: { active: true, cycle: 4, index: 28, maxFriends: 213, waitingUntil: 0 }
};
const tabUrls = {};
const created = [];
const sent = [];
let nextTabId = 99;
let messageListener;
const later = callback => setImmediate(callback);

const chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: "5.3.10" }),
    getURL: value => value,
    sendMessage() {},
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  offscreen: {},
  windows: { update: () => Promise.resolve() },
  alarms: { clear() {}, create() {}, onAlarm: { addListener() {} } },
  storage: { local: {
    get(defaults, callback) {
      const result = Promise.resolve({ ...defaults, ...JSON.parse(JSON.stringify(state)) });
      if (callback) { result.then(callback); return undefined; }
      return result;
    },
    set(values, callback) {
      Object.assign(state, JSON.parse(JSON.stringify(values)));
      const result = Promise.resolve();
      if (callback) { result.then(callback); return undefined; }
      return result;
    }
  } },
  tabs: {
    get(id, callback) { later(() => callback(tabUrls[id] ? { id, url: tabUrls[id] } : undefined)); },
    create(options, callback) {
      const id = nextTabId++;
      created.push({ id, url: options.url });
      tabUrls[id] = options.url;
      later(() => callback({ id, url: options.url }));
    },
    update(_id, _props, callback) { later(() => callback?.()); },
    remove(id) { delete tabUrls[Number(id)]; return Promise.resolve(); },
    reload(_id, _opts, callback) { callback?.(); return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      sent.push({ tabId, message });
      if (message?.type === "startSharedWorker") {
        callback?.({ ok: true });
        later(() => messageListener({ type: "workerStarted", owner: message.owner, generation: message.generation }, { tab: { id: tabId } }, () => {}));
        return;
      }
      if (message?.type === "recoverSharedWorker") return callback?.({ ok: true });
      callback?.({ ok: true });
    }
  }
};

const context = loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date: FakeDate, console, Promise });
const request = (message, sender = {}) => new Promise(resolve => messageListener(message, sender, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  // Establish an initial real sweep worker and then simulate the v5.3.9 orphan: its lease row
  // becomes stopped while owehSweep remains active.
  const initial = await request({ type: "claimWorker", owner: "sweep", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  assert(initial.ok && initial.tabId === 99, "initial sweep worker must start");
  await sleep(30);
  await context.OWEH_BG.workerManager.releaseSharedWorker(initial.generation, initial.tabId);
  delete tabUrls[initial.tabId];

  const before = await context.OWEH_BG.workerManager.readSharedWorkerTask();
  assert(before?.status === "stopped", "test must begin with a released worker row");
  assert(state.owehSweep.active && state.owehSweep.cycle === 4 && state.owehSweep.index === 28, "durable sweep state must remain active");

  await context.OWEH_BG.workerManager.checkWorkerHealth();
  await sleep(30);

  const after = await context.OWEH_BG.workerManager.readSharedWorkerTask();
  assert(after?.owner === "sweep" && after.status === "running", "health check must reclaim an orphaned active sweep");
  assert(after.ownerTabId === 100, "orphan recovery must create a replacement coordinator tab");
  assert(after.generation > initial.generation, "replacement coordinator must use a fresh generation after release");
  assert(sent.some(entry => entry.tabId === 100 && entry.message?.type === "recoverSharedWorker"), "replacement tab must receive recoverSharedWorker");
  assert(state.owehSweep.active && state.owehSweep.cycle === 4 && state.owehSweep.index === 28, "orphan recovery must not reset pass/index");
  assert(state.owehWorker?.tabId === 100 && state.owehWorker?.owner === "sweep", "reactive worker mirror must point at replacement coordinator");

  console.log("orphaned Full Sweep auto-recovery tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
