"use strict";

// Shared-worker Start is a handshake, not a fire-and-forget tab creation. The caller must
// not hear "started" until the exact worker tab acknowledges the exact generation. Missing
// ACK must fail closed and release/close the half-started worker.
const fs = require("node:fs");
const path = require("node:path");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const state = {};
const created = [];
const removed = [];
const sent = [];
const tabUrls = {};
let messageListener;
let nextTabId = 700;
const nativeSetTimeout = setTimeout;
const later = callback => setImmediate(callback);
// Keep production delays intact except the 15s-ish start deadline, which is shortened for test.
const testSetTimeout = (callback, ms, ...args) => nativeSetTimeout(callback, ms >= 10000 ? 30 : ms, ...args);

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
    create(options, callback) { later(() => { created.push(options); const id = nextTabId++; tabUrls[id] = options.url; callback({ id, url: options.url }); }); },
    update(_tabId, _props, callback) { later(() => callback?.()); },
    remove(tabId) { removed.push(tabId); delete tabUrls[tabId]; return Promise.resolve(); },
    sendMessage(tabId, message, callback) { sent.push({ tabId, message }); callback?.(); }
  }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout: testSetTimeout, clearTimeout, Date, console });

function request(message, sender = {}) {
  return new Promise(resolve => messageListener(message, sender, resolve));
}
const sleep = ms => new Promise(resolve => nativeSetTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function waitFor(predicate, timeout = 150) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition");
    await sleep(2);
  }
}

(async () => {
  let settled = false;
  const claimPromise = request({ type: "claimWorker", owner: "feed", url: "https://ovipets.com/#!/?src=pets&sub=overview" })
    .then(value => { settled = true; return value; });

  await waitFor(() => sent.some(call => call.message?.type === "startSharedWorker"));
  assert(settled === false, "claimWorker must not report success before workerStarted ACK");

  const startCall = sent.find(call => call.message?.type === "startSharedWorker");
  const generation = startCall.message.generation;
  messageListener(
    { type: "workerStarted", owner: "feed", generation },
    { tab: { id: startCall.tabId } },
    () => {}
  );

  const claim = await claimPromise;
  assert(claim.ok === true && claim.generation === generation, "matching ACK must complete the claim");
  assert(state.owehWorker?.phase === "running", "ACK must move the worker mirror out of starting phase");

  const released = await request({ type: "releaseWorker", owner: "feed" });
  assert(released.ok && released.wasRunning, "first worker must release cleanly");

  const secondTabId = nextTabId;
  const missingAck = await request({ type: "claimWorker", owner: "catalog", url: "https://ovipets.com/#!/?src=pets&sub=overview" });
  assert(missingAck.ok === false && missingAck.error === "worker-start-timeout", "missing ACK must fail the Start request");
  await sleep(10);
  assert(removed.includes(secondTabId), "missing ACK must close the half-started worker tab");
  const status = await request({ type: "getWorkerStatus" });
  assert(status.active === false && status.worker === null, "missing ACK must release the shared-worker lease");

  console.log("worker start ACK test passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
