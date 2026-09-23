"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");

const DAY = 24 * 60 * 60 * 1000;
const clock = { now: 100 * DAY };
const chrome = { storage: { local: { get: async defaults => defaults } } };
const context = vm.createContext({
  chrome, indexedDB: createFakeIndexedDB(), Date: { now: () => clock.now }, console,
  Promise, Set, Map, Object, Array, String, Number, Boolean, Math
});
for (const file of ["bg/state-db.js", "bg/command-journal.js", "bg/state-health.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
}
const db = context.OWEH_BG.stateDb;
const journal = context.OWEH_BG.commandJournal;
const health = context.OWEH_BG.stateHealth;

(async () => {
  await db.mergePets({
    "1": {
      id: "1", owned: true, present: true, name: "Complete", gender: "Female", species: "Catus", ancestors: [],
      colors: { body1: "FFFFFF", body2: "FF0000", scales: "000000", extra1: "FF0000", extra2: "000000" },
      lastProfileScanAt: clock.now
    },
    "2": { id: "2", owned: true, present: true, name: "Incomplete", lastProfileScanAt: clock.now - 8 * DAY },
    "3": { id: "3", owned: false, present: true, name: "Not owned" }
  });

  await journal.journalBegin({ id: "uncertain", command: "pet_breed" });
  await journal.journalUpdate("uncertain", { status: "dispatched", dispatchedAt: clock.now });
  await journal.journalBegin({ id: "rejected", command: "pet_breed" });
  await journal.journalUpdate("rejected", { status: "rejected" });

  await db.putTaskLease({ id: "live-task", kind: "test" }, 10);
  const state = await health.read(clock.now);

  assert.equal(state.pets, 3);
  assert.equal(state.present, 2);
  assert.equal(state.complete, 1);
  assert.equal(state.incomplete, 1);
  assert.equal(state.stale, 1);
  assert.equal(state.uncertainCommands, 1);
  assert.equal(state.rejectedCommands, 1);
  assert.equal(state.activeTasks, 1);
  assert.equal(state.staleTasks, 0);

  console.log("background state health behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
