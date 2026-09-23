"use strict";

// Up to 15 egg tabs learn Name-the-Species outcomes at the same moment. Every write to the shared
// species memory / stats goes through background.js, which must serialize them so no tab's
// lesson is lost to another tab's read-modify-write.
const assert = require("node:assert/strict");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const store = {};
const messageListeners = [];
// Every storage call yields to the event loop so unserialized writers would interleave.
const later = value => new Promise(resolve => setTimeout(() => resolve(value), Math.random() * 3));
const chrome = {
  alarms: { clear: () => Promise.resolve(), create: () => {}, onAlarm: { addListener: () => {} } },
  offscreen: {},
  runtime: {
    getURL: value => value,
    lastError: null,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: listener => messageListeners.push(listener) },
    sendMessage: () => {}
  },
  storage: { local: {
    get: defaults => later({ ...defaults, ...JSON.parse(JSON.stringify(store)) }),
    set: values => later().then(() => { Object.assign(store, JSON.parse(JSON.stringify(values))); })
  } },
  tabs: { update: () => {}, create: () => {}, remove: () => Promise.resolve(), sendMessage: () => {}, onRemoved: { addListener: () => {} } },
  windows: { update: () => Promise.resolve() }
};

loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console });
const request = (message, tabId) => new Promise(resolve => {
  const handled = messageListeners.some(listener => listener(message, { tab: { id: tabId } }, resolve) === true);
  assert.ok(handled, `${message.type} must be answered asynchronously`);
});

(async () => {
  const key = "visual:0101";
  const tabs = Array.from({ length: 15 }, (_, index) => index);
  const results = await Promise.all(tabs.flatMap(tab => [
    request({ type: "speciesMemoryLearn", keys: [key, `src:${tab}`], species: `Wrong${tab}`, correct: false, image: "data:image/jpeg;base64,x" }, 100 + tab),
    request({ type: "speciesStatsBump", patch: { detected: 1 } }, 100 + tab),
    request({ type: "speciesAnswerIdsMerge", options: [{ text: "Feline", answerId: "2" }] }, 100 + tab)
  ]));
  assert.ok(results.every(result => result.ok), JSON.stringify(results.find(result => !result.ok)));

  const record = store.owehSpeciesMemory[key];
  assert.equal(Object.keys(record.wrong).length, 15, `every tab's wrong answer is kept: ${JSON.stringify(record.wrong)}`);
  assert.equal(record.image, "data:image/jpeg;base64,x");
  assert.equal(Object.keys(store.owehSpeciesMemory).length, 16);
  assert.equal(store.owehSpeciesStats.wrong, 15);
  assert.equal(store.owehSpeciesStats.detected, 15);
  assert.equal(store.owehSpeciesAnswerIds.Feline.ids["2"], 15);

  // A correct vote wins the key, and invalid input is refused without touching storage.
  await request({ type: "speciesMemoryLearn", keys: [key], species: "Feline", correct: true }, 1);
  assert.equal(store.owehSpeciesMemory[key].species, "Feline");
  assert.equal(store.owehSpeciesStats.correct, 1);
  const refused = await request({ type: "speciesMemoryLearn", keys: [], species: "Feline", correct: true }, 1);
  assert.equal(refused.ok, false);
  const unknownField = await request({ type: "speciesStatsBump", patch: { hacked: 5 } }, 1);
  assert.equal(unknownField.stats.hacked, undefined, "only known counters can be bumped");

  console.log("species memory serialization tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
