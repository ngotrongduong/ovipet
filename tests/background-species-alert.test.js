"use strict";

const assert = require("node:assert/strict");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const messageListeners = [];
const calls = [];

const chrome = {
  alarms: {
    clear: () => Promise.resolve(),
    create: () => {},
    onAlarm: { addListener: () => {} }
  },
  offscreen: {
    createDocument: async options => calls.push({ type: "offscreen", options })
  },
  runtime: {
    getContexts: async () => [],
    getURL: path => `chrome-extension://test/${path}`,
    lastError: null,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: listener => messageListeners.push(listener) },
    sendMessage: (message, callback) => {
      calls.push({ type: "message", message });
      callback?.();
    }
  },
  storage: { local: { get: () => {}, set: () => {} } },
  tabs: {
    update: async (tabId, options) => calls.push({ type: "tab", tabId, options }),
    create: () => {},
    remove: () => Promise.resolve(),
    sendMessage: () => {}
  },
  windows: {
    update: async (windowId, options) => calls.push({ type: "window", windowId, options })
  }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });

const listener = messageListeners[0];
assert.equal(typeof listener, "function");
listener(
  { type: "speciesVerificationRequired", playSound: true },
  { tab: { id: 42, windowId: 7 } },
  () => {}
);

setTimeout(() => {
  const tabCall = calls.find(call => call.type === "tab");
  assert.equal(tabCall?.tabId, 42);
  assert.equal(tabCall?.options?.active, true);
  const windowCall = calls.find(call => call.type === "window");
  assert.equal(windowCall?.windowId, 7);
  assert.equal(windowCall?.options?.focused, true);
  assert.equal(calls.find(call => call.type === "offscreen")?.options.reasons[0], "AUDIO_PLAYBACK");
  assert.equal(calls.find(call => call.type === "message")?.message.type, "playSpeciesAlert");
  console.log("species alert background test passed");
}, 20);
