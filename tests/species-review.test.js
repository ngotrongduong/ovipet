"use strict";

// Species Review (v5.4.4): the review page groups every saved challenge image, and the service
// worker stores a human label (plus its silhouette) without ever overriding the game's verdict.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");
const { loadBackground } = require("./helpers/load-background");

const ROOT = path.resolve(__dirname, "..");
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, "domain/species-shape.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(ROOT, "review/species-review.js"), "utf8"), context);
const shapeApi = context.OWEH_SPECIES_SHAPE;
const review = context.OWEH_SPECIES_REVIEW;

const shapeA = "f".repeat(128) + "0".repeat(128);
const shapeB = "0".repeat(128) + "f".repeat(128);
const url = id => `https://app.ovipets.com/img/pet/${id}/credit-challenge`;

// ---- pure model
const memory = {
  [url(1)]: { species: "Canis", votes: { Canis: 1 }, wrong: { Lupus: 1 }, image: "data:image/jpeg;base64,one", updatedAt: 10 },
  "visual:1": { species: "Canis", votes: { Canis: 1 }, wrong: { Lupus: 1 }, image: "data:image/jpeg;base64,one", updatedAt: 10 },
  [url(2)]: { species: null, votes: {}, wrong: { Feline: 2 }, image: "data:image/jpeg;base64,two", updatedAt: 30 },
  "visual:2": { species: null, votes: {}, wrong: { Feline: 2 }, image: "data:image/jpeg;base64,two", updatedAt: 30 },
  [url(3)]: { species: "Gekko", votes: { Gekko: 1 }, wrong: {}, manual: { species: "Gekko", at: 5 }, image: "data:image/jpeg;base64,three", updatedAt: 20 }
};
const sessions = [{ question: { key: "visual:2", image: { fingerprint: "visual:2", sources: [url(2)], shape: shapeA }, options: [{ text: "Feline" }, { text: "Canis" }, { text: "Gekko" }, { text: "Lupus" }] } }];
const model = review.buildModel({
  memory, sessions, answerIds: { Canis: {}, Feline: {}, Gekko: {}, Lupus: {} },
  library: { Canis: { examples: [shapeA] }, Gekko: { examples: [shapeB] } }, shapeApi
});
assert.equal(model.items.length, 3, "URL and visual keys of one image are one card");
const byEgg = Object.fromEntries(model.items.map(item => [item.eggId, item]));
assert.equal(byEgg[1].status, "confirmed");
assert.equal(byEgg[1].confirmed, "Canis");
assert.deepEqual([...byEgg[1].keys].sort(), [url(1), "visual:1"].sort());
assert.equal(byEgg[2].status, "unresolved");
assert.deepEqual([...byEgg[2].options], ["Feline", "Canis", "Gekko", "Lupus"]);
assert.ok(!byEgg[2].eligible.includes("Feline"), "a species the game rejected is not eligible");
assert.equal(byEgg[2].guess?.species, "Canis", "the silhouette suggestion uses the learned library");
assert.equal(byEgg[3].status, "manual", "a vote that only comes from a manual label is not game-confirmed");
assert.equal(byEgg[3].confirmed, null);
assert.deepEqual({ ...model.summary }, { images: 3, confirmed: 1, manual: 1, unresolved: 1, attempts: 4, wrongTries: 3 });
assert.equal(model.perSpecies.Canis.confirmed, 1);
assert.equal(model.perSpecies.Canis.references.length, 1);
const eggs = (options) => [...review.filterItems(model.items, options).map(item => item.eggId)];
assert.deepEqual(eggs({ filter: "all", sort: "new" }), ["2", "3", "1"]);
assert.deepEqual(eggs({ filter: "all", species: "Feline" }), ["2"]);
assert.deepEqual(eggs({ filter: "unresolved" }), ["2"]);

// ---- service worker label handler
const store = JSON.parse(JSON.stringify({ owehSpeciesMemory: memory, owehSpeciesShapes: {} }));
const listeners = [];
const createdTabs = [];
const chrome = {
  alarms: { clear: () => Promise.resolve(), create: () => {}, onAlarm: { addListener: () => {} } },
  offscreen: {},
  runtime: {
    getURL: value => `chrome-extension://id/${value}`, lastError: null,
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: listener => listeners.push(listener) }, sendMessage: () => {}
  },
  storage: { local: {
    get: defaults => Promise.resolve({ ...defaults, ...JSON.parse(JSON.stringify(store)) }),
    set: values => Promise.resolve().then(() => { Object.assign(store, JSON.parse(JSON.stringify(values))); })
  } },
  tabs: { update: () => {}, create: tab => createdTabs.push(tab), remove: () => Promise.resolve(), sendMessage: () => {}, onRemoved: { addListener: () => {} } },
  windows: { update: () => Promise.resolve() }
};
// The label request passes the silhouette itself, so no network fetch is needed here.
loadBackground({ chrome, indexedDB: createFakeIndexedDB(), setTimeout, clearTimeout, Date, console, fetch: () => Promise.reject(new Error("offline")) });
const request = message => new Promise(resolve => {
  const handled = listeners.some(listener => listener(message, { tab: { id: 9 } }, resolve) === true);
  if (!handled) resolve(undefined);
});

(async () => {
  const opened = await request({ type: "openSpeciesReview" });
  assert.equal(opened?.ok, true, "opening the page answers synchronously");
  assert.equal(createdTabs[0].url, "chrome-extension://id/review/species-review.html");

  const keys2 = [url(2), "visual:2"];
  let result = await request({ type: "speciesReviewLabel", keys: keys2, species: "Canis", shape: shapeA });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.shapeLearned, true);
  for (const key of keys2) {
    assert.equal(store.owehSpeciesMemory[key].species, "Canis");
    assert.equal(store.owehSpeciesMemory[key].manual.species, "Canis");
    assert.equal(store.owehSpeciesMemory[key].wrong.Feline, 2, "the game's rejections are kept");
  }
  assert.deepEqual(store.owehSpeciesShapes.Canis.examples, [shapeA]);

  // Relabel: the old vote and the silhouette move to the new species.
  result = await request({ type: "speciesReviewLabel", keys: keys2, species: "Gekko", shape: shapeA });
  assert.equal(result.ok, true);
  assert.deepEqual({ ...store.owehSpeciesMemory[url(2)].votes }, { Gekko: 1 });
  assert.equal(store.owehSpeciesShapes.Canis, undefined, "the mistaken silhouette is removed");
  assert.deepEqual(store.owehSpeciesShapes.Gekko.examples, [shapeA]);

  // The game's verdict wins over a human label.
  result = await request({ type: "speciesReviewLabel", keys: keys2, species: "Feline", shape: shapeA });
  assert.equal(result.reason, "game-rejected");
  result = await request({ type: "speciesReviewLabel", keys: [url(1), "visual:1"], species: "Lupus", shape: shapeB });
  assert.equal(result.reason, "game-confirmed");
  assert.equal(store.owehSpeciesMemory[url(1)].species, "Canis");

  // Clearing removes the manual vote and its silhouette.
  result = await request({ type: "speciesReviewLabel", keys: keys2, species: "" });
  assert.equal(result.ok, true);
  assert.deepEqual({ ...store.owehSpeciesMemory[url(2)].votes }, {});
  assert.equal(store.owehSpeciesMemory[url(2)].manual, undefined);
  assert.equal(store.owehSpeciesShapes.Gekko, undefined);

  // A later game outcome keeps the manual marker (so the vote is never mistaken for the game's).
  await request({ type: "speciesReviewLabel", keys: [url(3)], species: "Gekko" });
  await request({ type: "speciesMemoryLearn", keys: [url(3)], species: "Lupus", correct: false });
  assert.equal(store.owehSpeciesMemory[url(3)].manual.species, "Gekko");

  const html = fs.readFileSync(path.join(ROOT, "review/species-review.html"), "utf8");
  assert.match(html, /<script src="\.\.\/domain\/species-shape\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, "extension pages may not use inline scripts");
  const panel = fs.readFileSync(path.join(ROOT, "ui/panel.js"), "utf8");
  assert.match(panel, /id="oweh-species-review"/);
  assert.match(panel, /type: "openSpeciesReview"/);

  console.log("species review tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
