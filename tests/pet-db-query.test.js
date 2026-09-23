"use strict";

const assert = require("node:assert/strict");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

let listener;
const local = {};
const later = fn => setTimeout(fn, 0);
const chrome = {
  runtime: {
    lastError: null,
    getURL: value => value,
    sendMessage() {},
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { listener = fn; } }
  },
  offscreen: {},
  windows: { update: () => Promise.resolve() },
  alarms: { clear() {}, create() {}, onAlarm: { addListener() {} } },
  storage: { local: {
    get(defaults, callback) {
      const result = Promise.resolve({ ...defaults, ...local });
      if (callback) { result.then(callback); return undefined; }
      return result;
    },
    set(values, callback) {
      Object.assign(local, values);
      const result = Promise.resolve();
      if (callback) { result.then(callback); return undefined; }
      return result;
    }
  } },
  tabs: {
    get(_id, callback) { later(() => callback(undefined)); },
    create(_opts, callback) { later(() => callback({ id: 999 })); },
    update(_id, _props, callback) { later(() => callback?.()); },
    remove() { return Promise.resolve(); },
    sendMessage(_id, _msg, callback) { callback?.(); }
  }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });

function request(message) {
  return new Promise(resolve => listener(message, {}, resolve));
}

(async () => {
  const merged = await request({ type: "petDbMerge", pets: {
    "1": { id: "1", name: "one" },
    "2": { id: "2", name: "two" },
    "3": { id: "3", name: "three" }
  } });
  assert.equal(merged.ok, true);
  assert.equal(merged.count, 3);

  const result = await request({ type: "petDbGetMany", ids: ["1", "3", "404", "1", ""] });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.pets).sort(), ["1", "3"]);
  assert.equal(result.pets["1"].name, "one");
  assert.equal(result.pets["3"].name, "three");
  assert.equal(result.pets["2"], undefined);

  const empty = await request({ type: "petDbGetMany", ids: [] });
  assert.deepEqual(Object.keys(empty.pets), []);

  console.log("targeted pet database query tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
