"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const store = {
  owehSpeciesStats: { correct: 3857, wrong: 1541, detected: 10703, shapeAnswers: 2547 },
  owehSpeciesMemory: { old: true },
  owehSpeciesAnswerIds: { Feline: {} },
  owehSpeciesShapes: { Feline: {} },
  owehSpeciesInspectorV1: { sessions: [1] },
  owehSpeciesSeedSeen: { 1: true }
};

const chrome = {
  storage: {
    local: {
      async get(defaults) { return { ...defaults, ...JSON.parse(JSON.stringify(store)) }; },
      async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); },
      async remove(keys) { for (const key of keys) delete store[key]; }
    }
  }
};
const sandbox = vm.createContext({ chrome, console, Promise, Object, Array, Number, String, Boolean, globalThis: null });
sandbox.globalThis = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg", "species-stats.js"), "utf8"), sandbox, { filename: "species-stats.js" });

(async () => {
  const api = sandbox.OWEH_BG.speciesStats;
  const result = await api.bump({ patch: { correct: 1, wrong: 2, detected: 999 } });
  assert.deepEqual(JSON.parse(JSON.stringify(result.stats)), { correct: 3858, wrong: 1543 });
  assert.deepEqual(store.owehSpeciesStats, { correct: 3858, wrong: 1543 });
  for (const key of api.LEGACY_KEYS) assert.equal(key in store, false, `legacy Species key should be removed: ${key}`);
  assert.deepEqual(await api.read(), { correct: 3858, wrong: 1543 });
  console.log("aggregate-only Species stats tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
