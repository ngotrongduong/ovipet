"use strict";

// v5: the friend sweep no longer spawns/bookkeeps its own dedicated worker tab
// (owehSweepWorker + SWEEP_WORKER_CLEANUP_ALARM); it claims the one shared worker tab
// through claimWorker/releaseWorker, same as every other long-running feature. This test
// exercises that generic claim/busy-refusal/release/status flow end to end against the
// real background.js, backed by a minimal in-memory IndexedDB stand-in for the
// "shared-worker" task-lease row.

const fs = require("node:fs");
const path = require("node:path");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const state = {};
const created = [];
const updated = [];
const removed = [];
const sent = [];
const tabUrls = {};
let messageListener;
const later = callback => setImmediate(callback);

const chrome = {
  runtime: {
    lastError: null,
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
    // Supports both the callback form and the promise form (omit callback) — background.js
    // uses both across the file, and real Chrome's storage API supports both natively.
    get(defaults, callback) {
      const result = new Promise(resolve => later(() => resolve({ ...defaults, ...state })));
      if (callback) { result.then(callback); return undefined; }
      return result;
    },
    set(values, callback) {
      const result = new Promise(resolve => later(() => { Object.assign(state, values); resolve(); }));
      if (callback) { result.then(callback); return undefined; }
      return result;
    }
  } },
  tabs: {
    get(id, callback) { later(() => callback(tabUrls[id] ? { id, url: tabUrls[id] } : undefined)); },
    create(options, callback) { later(() => { created.push(options); tabUrls[99] = options.url; callback({ id: 99, url: options.url }); }); },
    update(tabId, props, callback) { updated.push({ tabId, props }); later(() => callback?.()); },
    remove(tabId) { removed.push(tabId); delete tabUrls[tabId]; return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      sent.push({ tabId, message });
      callback?.();
      if (message?.type === "startSharedWorker") {
        later(() => messageListener({ type: "workerStarted", owner: message.owner, generation: message.generation }, { tab: { id: tabId } }, () => {}));
      }
    }
  }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });

function request(message, sender = {}) {
  return new Promise(resolve => messageListener(message, sender, resolve));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const claim = await request({ type: "claimWorker", owner: "sweep", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  if (!claim.ok || claim.tabId !== 99) throw new Error("Claim did not create/attach the shared worker tab");
  if (created.length !== 1 || created[0].active !== false) throw new Error("Inactive worker tab not created");
  if (!updated.some(entry => entry.tabId === 99 && entry.props.autoDiscardable === false)) {
    throw new Error("Worker tab was not marked non-discardable");
  }
  await sleep(50);
  if (!sent.some(call => call.tabId === 99 && call.message?.type === "startSharedWorker" && call.message.owner === "sweep")) {
    throw new Error("startSharedWorker was not sent to the claimed tab");
  }

  const initialLease = state.owehWorker?.leaseUntil;
  await sleep(5);
  const heartbeat = await request({ type: "taskHeartbeat", ids: ["shared-worker"] }, { tab: { id: 99 } });
  if (!heartbeat.ok || !(state.owehWorker?.leaseUntil > initialLease)) {
    throw new Error("Shared-worker heartbeat must renew the chrome.storage mirror lease");
  }

  const busy = await request({ type: "claimWorker", owner: "feed", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  if (busy.ok !== false || busy.reason !== "busy" || busy.owner !== "sweep") {
    throw new Error("A second feature must be refused, not queued, while sweep holds the shared worker");
  }

  const release = await request({ type: "releaseWorker" });
  if (release.ok !== true || release.wasRunning !== true) throw new Error("Release did not report the prior claim");
  if (!sent.some(call => call.tabId === 99 && call.message?.type === "stopSharedWorker")) {
    throw new Error("stopSharedWorker was not sent to the worker tab on release");
  }
  if (state.owehSweep?.active !== false) {
    throw new Error("Release must clear the feature's own active flag synchronously, not rely on the tab reacting");
  }
  await sleep(600);
  if (!removed.includes(99)) throw new Error("Worker tab was not removed after release");

  const status = await request({ type: "getWorkerStatus" });
  if (status.active !== false || status.worker !== null) throw new Error("Worker status should be inactive after release");

  const replacement = await request({ type: "claimWorker", owner: "feed", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  if (!replacement.ok) throw new Error("Replacement worker claim failed");
  await sleep(50);
  const replacementStatus = await request({ type: "getWorkerStatus" });
  const replacementGeneration = replacementStatus.worker?.generation;
  if (!(replacementGeneration > 1)) throw new Error("Replacement worker generation was not advanced");
  messageListener({ type: "workerDone", generation: 1 }, { tab: { id: 99 } }, () => {});
  await sleep(20);
  if (state.owehWorker?.generation !== replacementGeneration) {
    throw new Error("Stale workerDone must not clear the newer worker mirror");
  }

  console.log("background shared worker claim/release test passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
