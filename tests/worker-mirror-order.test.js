"use strict";

// bg/worker-manager.js: owehWorker mirror writes are serialized and re-read the authoritative
// row, so a slow write carrying an older live snapshot can never land after a release.
const assert = require("node:assert/strict");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const state = {};
let messageListener;
let nextTabId = 900;
const tabUrls = {};
const later = callback => setImmediate(callback);
// A live mirror write is slow, a null write is fast: without serialization the stale one lands last.
const writeDelayMs = values => (values && "owehWorker" in values && values.owehWorker ? 30 : 0);

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
      const result = new Promise(resolve => setTimeout(() => { Object.assign(state, values); resolve(); }, writeDelayMs(values)));
      if (callback) { result.then(callback); return undefined; }
      return result;
    }
  } },
  tabs: {
    get(id, callback) { later(() => callback(tabUrls[id] ? { id, url: tabUrls[id] } : undefined)); },
    create(options, callback) { later(() => { const id = nextTabId++; tabUrls[id] = options.url; callback({ id, url: options.url }); }); },
    update(_tabId, _props, callback) { later(() => callback?.()); },
    remove(tabId) { delete tabUrls[tabId]; return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      callback?.();
      if (message?.type === "startSharedWorker") {
        later(() => messageListener({ type: "workerStarted", owner: message.owner, generation: message.generation }, { tab: { id: tabId } }, () => {}));
      }
    }
  }
};

const context = loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });
const manager = context.OWEH_BG.workerManager;
const request = message => new Promise(resolve => messageListener(message, {}, resolve));

(async () => {
  const claim = await request({ type: "claimWorker", owner: "maintain", url: "https://ovipets.com/#!/?src=pets" });
  assert.ok(claim.ok, "claim must succeed");
  const live = await manager.readSharedWorkerTask();
  assert.equal(state.owehWorker?.owner, "maintain");

  // A heartbeat mirror (slow, live snapshot) races a release (fast, null).
  const heartbeatMirror = manager.mirrorSharedWorkerState(live);
  const released = manager.releaseSharedWorker(live.generation);
  await Promise.all([heartbeatMirror, released]);
  assert.equal(state.owehWorker, null, "a release is never overwritten by an older live snapshot");

  // A stale live snapshot mirrored after the release is corrected from the stored row.
  await manager.mirrorSharedWorkerState(live);
  assert.equal(state.owehWorker, null, "the mirror follows the authoritative row, not the passed snapshot");

  console.log("worker mirror order tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
