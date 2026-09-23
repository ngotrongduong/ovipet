"use strict";

// The one-button jobs (catalog, sort, feed, ninja, requests) keep no storage flag: the shared
// worker lease alone says whether one is running. This drives the real background.js through
// claim / repeat-claim / busy-refusal / release for those owners.
const fs = require("node:fs");
const path = require("node:path");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const state = {};
const created = [];
const removed = [];
const sent = [];
const tabUrls = {};
let nextTabId = 200;
let messageListener;
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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const URL = "https://ovipets.com/#!/?src=pets&sub=overview";
const starts = () => sent.filter(call => call.message?.type === "startSharedWorker");
const forbidden = ["owehDailyMaintenance", "owehRequestRun", "owehFeedRun", "owehFeedQueue", "owehSweep"];

(async () => {
  for (const owner of ["catalog", "sort", "feed", "ninja", "requests"]) {
    const before = starts().length;
    const createdBefore = created.length;
    const claim = await request({ type: "claimWorker", owner, url: URL });
    assert(claim.ok && !claim.alreadyRunning, `${owner}: first claim must succeed`);
    assert(created.length === createdBefore + 1 && created.at(-1).active === false, `${owner}: exactly one inactive tab must be opened`);
    await sleep(40);
    const startCalls = starts().slice(before);
    assert(startCalls.length === 1 && startCalls[0].message.owner === owner, `${owner}: exactly one startSharedWorker for its own owner`);

    const repeat = await request({ type: "claimWorker", owner, url: URL });
    await sleep(40);
    assert(repeat.ok && repeat.alreadyRunning === true, `${owner}: a second Start must report alreadyRunning`);
    assert(created.length === createdBefore + 1, `${owner}: a second Start must not open another tab`);
    assert(starts().length === before + 1, `${owner}: a second Start must not restart the running job`);

    const other = owner === "catalog" ? "feed" : "catalog";
    const busy = await request({ type: "claimWorker", owner: other, url: URL });
    assert(busy.ok === false && busy.reason === "busy" && busy.owner === owner, `${owner}: a different job must be refused while it runs`);

    const wrongStop = await request({ type: "releaseWorker", owner: other });
    assert(wrongStop.wasRunning === false, `${owner}: Stop for another job must not release this one`);
    assert((await request({ type: "getWorkerStatus" })).active === true, `${owner}: still running after a foreign Stop`);

    const tabId = created.length ? 200 + created.length - 1 : null;
    const release = await request({ type: "releaseWorker", owner });
    assert(release.ok && release.wasRunning === true, `${owner}: own Stop must release`);
    assert(sent.some(call => call.tabId === tabId && call.message?.type === "stopSharedWorker" && call.message.owner === owner), `${owner}: stop must reach the worker tab`);
    await sleep(600);
    assert(removed.includes(tabId), `${owner}: the extension's own worker tab must be closed`);
    const status = await request({ type: "getWorkerStatus" });
    assert(status.active === false && status.worker === null, `${owner}: status must be idle after release`);
  }

  for (const key of forbidden) {
    assert(!(key in state), `stale storage key was written by the shared-worker core: ${key}`);
  }

  console.log("background one-button job claim test passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
