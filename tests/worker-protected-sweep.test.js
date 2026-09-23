"use strict";

// A Full Sweep coordinator is a protected long-lived tab. Losing the 45s heartbeat lease is
// not permission for the health watchdog to close it: the background revives the lease and
// asks the same tab to recover. This reproduces the live failure where the sweep tab sometimes
// disappeared while child egg tabs were busy/stuck.
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

let now = 1_800_000_000_000;
class FakeDate extends Date {
  constructor(...args) { super(args.length ? args[0] : now); }
  static now() { return now; }
}

const state = {};
const removed = [];
const reloaded = [];
const sent = [];
const tabUrls = {};
let nextTabId = 99;
let messageListener;
const later = callback => setTimeout(callback, 0);

const chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: "5.3.8" }),
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
      tabUrls[id] = options.url;
      later(() => callback({ id, url: options.url }));
    },
    update(_id, _props, callback) { later(() => callback?.()); },
    remove(id) { removed.push(Number(id)); delete tabUrls[id]; return Promise.resolve(); },
    reload(id) { reloaded.push(Number(id)); return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      sent.push({ tabId, message });
      if (message?.type === "startSharedWorker") {
        callback?.({ ok: true });
        later(() => messageListener({ type: "workerStarted", owner: message.owner, generation: message.generation }, { tab: { id: tabId } }, () => {}));
        return;
      }
      if (message?.type === "recoverSharedWorker") {
        callback?.({ ok: true });
        return;
      }
      callback?.({ ok: true });
    }
  }
};

const context = loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date: FakeDate, console, Promise });
const request = (message, sender = {}) => new Promise(resolve => messageListener(message, sender, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const claim = await request({ type: "claimWorker", owner: "sweep", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  assert(claim.ok && claim.tabId === 99, "sweep coordinator must start");
  await sleep(30);
  const before = await context.OWEH_BG.workerManager.readSharedWorkerTask();
  assert(before?.owner === "sweep" && before.ownerTabId === 99, "shared worker row must own coordinator tab");

  // Simulate a long stall: no heartbeat for >45 seconds.
  now += 70_000;
  await context.OWEH_BG.workerManager.checkWorkerHealth();
  const after = await context.OWEH_BG.workerManager.readSharedWorkerTask();
  assert(removed.length === 0, "expired sweep heartbeat must never close the coordinator tab");
  assert(after?.status === "running" && after.leaseUntil > now, "health recovery must revive the protected sweep lease");
  assert(sent.some(entry => entry.tabId === 99 && entry.message?.type === "recoverSharedWorker"), "health recovery must ask the coordinator to resume");
  assert(Number(after.recoveryCount || 0) >= 1, "recovery attempt must be persisted for diagnostics");

  // If the content script does not acknowledge recovery, the SAME tab may be reloaded but it
  // still must not be closed. Override the sender to simulate an unresponsive content script.
  const originalSend = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (tabId, message, callback) => {
    sent.push({ tabId, message });
    if (message?.type === "recoverSharedWorker") return callback?.(undefined);
    return originalSend(tabId, message, callback);
  };
  now += 70_000;
  await context.OWEH_BG.workerManager.checkWorkerHealth();
  assert(removed.length === 0, "failed recovery probe still must not close coordinator");
  assert(reloaded.includes(99), "unresponsive coordinator should be reloaded in place for recovery");


  // If the coordinator tab itself disappears, health recovery must create a replacement
  // automatically instead of releasing the sweep into an orphaned active=true state.
  chrome.tabs.sendMessage = originalSend;
  delete tabUrls[99];
  now += 70_000;
  await context.OWEH_BG.workerManager.checkWorkerHealth();
  const replaced = await context.OWEH_BG.workerManager.readSharedWorkerTask();
  assert(replaced?.status === "running" && replaced.ownerTabId === 100, "missing protected coordinator must be replaced automatically");
  assert(replaced.generation === after.generation, "in-place protected replacement should preserve generation");
  assert(sent.some(entry => entry.tabId === 100 && entry.message?.type === "recoverSharedWorker"), "replacement coordinator must receive recovery command");

  console.log("protected Full Sweep coordinator recovery tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
