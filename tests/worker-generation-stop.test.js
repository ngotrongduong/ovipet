"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const state = {};
let messageListener;
let nextTabId = 700;
let blockedGet = null;
let blockIndexFlagRead = false;
const sent = [];
const tabUrls = {};
const removed = [];
const later = callback => setTimeout(callback, 0);

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
      if (blockIndexFlagRead && Object.prototype.hasOwnProperty.call(defaults || {}, "owehPetIndex")) {
        blockedGet = () => later(() => callback({ ...defaults, ...state }));
        return undefined;
      }
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
    create(options, callback) { later(() => { const id = nextTabId++; tabUrls[id] = options.url; callback({ id, url: options.url }); }); },
    update(_tabId, _props, callback) { later(() => callback?.()); },
    remove(tabId) { removed.push(tabId); delete tabUrls[tabId]; return Promise.resolve(); },
    sendMessage(tabId, message, callback) {
      sent.push({ tabId, message });
      callback?.();
      if (message?.type === "startSharedWorker") {
        later(() => messageListener(
          { type: "workerStarted", owner: message.owner, generation: message.generation },
          { tab: { id: tabId } },
          () => {}
        ));
      }
    }
  }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });

function request(message, sender = {}) {
  return new Promise(resolve => messageListener(message, sender, resolve));
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const URL = "https://ovipets.com/#!/?src=pets&sub=overview";

(async () => {
  const first = await request({ type: "claimWorker", owner: "index", url: URL });
  assert(first.ok && !first.alreadyRunning, "first worker claim must start");
  assert(Number.isFinite(first.generation), "first claim must expose generation");

  // Freeze Stop after it has atomically reserved generation N as `stopping`, but before
  // cleanup/release finishes. A competing Start must not be able to create generation N+1
  // inside this cleanup window.
  blockIndexFlagRead = true;
  const stopPromise = request({ type: "releaseWorker", owner: "index" });

  for (let i = 0; i < 50 && !blockedGet; i += 1) await sleep(2);
  assert(blockedGet, "Stop must reach the deliberately blocked owner-flag cleanup");

  const duringStop = await request({ type: "claimWorker", owner: "feed", url: URL });
  assert(duringStop.ok === false && duringStop.reason === "busy" && duringStop.owner === "index",
    "a new owner must remain blocked while the old generation is stopping");
  const sameOwnerDuringStop = await request({ type: "claimWorker", owner: "index", url: URL });
  assert(sameOwnerDuringStop.ok === false && sameOwnerDuringStop.reason === "busy" && sameOwnerDuringStop.phase === "stopping",
    "Start for the same owner must not report already-running success while its old generation is stopping");

  blockIndexFlagRead = false;
  blockedGet();
  blockedGet = null;
  const stopped = await stopPromise;
  assert(stopped.ok && stopped.wasRunning === true, "old generation Stop must complete normally");

  const second = await request({ type: "claimWorker", owner: "feed", url: URL });
  assert(second.ok && !second.alreadyRunning, "new claim must start after cleanup finishes");
  assert(second.generation > first.generation, "new claim must use a newer generation");

  // Generation is necessary but not sufficient: lifecycle signals must also come from the
  // exact worker tab that owns the claim. Another extension tab must not be able to spoof
  // phase/completion merely because it observed the generation in the storage mirror.
  messageListener({ type: "workerPhase", generation: second.generation, phase: "spoofed" }, { tab: { id: 9999 } }, () => {});
  await sleep(20);
  let protectedStatus = await request({ type: "getWorkerStatus" });
  assert(protectedStatus.worker?.phase !== "spoofed", "workerPhase must be scoped to the owning tab");

  messageListener({ type: "workerDone", generation: second.generation }, { tab: { id: 9999 } }, () => {});
  await sleep(20);
  protectedStatus = await request({ type: "getWorkerStatus" });
  assert(protectedStatus.active === true && protectedStatus.worker?.generation === second.generation,
    "workerDone from a non-owner tab must not release the live generation");

  // Simulate a late natural-completion signal from generation N. It must not release N+1.
  messageListener({ type: "workerDone", generation: first.generation }, { tab: { id: first.tabId } }, () => {});
  await sleep(30);
  const afterStaleDone = await request({ type: "getWorkerStatus" });
  assert(afterStaleDone.active === true, "stale workerDone must not release the new generation");
  assert(afterStaleDone.worker?.owner === "feed" && afterStaleDone.worker?.generation === second.generation,
    "stale completion must preserve the exact newer owner/generation");

  // If the player has navigated the extension-created worker tab away from OviPets, the
  // extension no longer owns that browser surface strongly enough to close it. Stop must
  // still release durable state, but leave the user-navigated tab open.
  tabUrls[second.tabId] = "https://example.com/user-kept-this-tab";
  const finalStop = await request({ type: "releaseWorker", owner: "feed" });
  assert(finalStop.ok && finalStop.wasRunning === true, "new generation must still be stoppable");
  await sleep(600);
  assert(!removed.includes(second.tabId), "Stop must not close a worker tab after the user navigated it away from OviPets");

  console.log("worker generation-safe Stop and owned-tab safety test passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
