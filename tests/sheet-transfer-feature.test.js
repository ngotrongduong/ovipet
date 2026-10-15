"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("ID discard requires owner-verified preview, confirmation and post-send game verification", async () => {
  globalThis.OWEH = { domain: {}, register(name, factory) { this.factory = factory; }, get(name) {
    if (name === "runner") return { api: { createJob(opts) {
      globalThis.__sheetJob = opts;
      return { request: async () => { globalThis.__sheetRequested = true; },
        stop: async () => {}, workerHandler: { start: () => {} } };
    } } };
  } };
  for (const name of ["../domain/sheet-transfer.js", "../features/sheet-transfer.js"]) {
    delete require.cache[require.resolve(name)];
    require(name);
  }
  const controls = {
    "#oweh-sheet-ids": { value: "ID,Discard\n101,YES\n102,NO\n999,YES" },
    "#oweh-sheet-url": { value: "" },
    "#oweh-sheet-file": { files: [] },
    "#oweh-sheet-preview": { textContent: "No ID discard list loaded" }
  };
  globalThis.document = { querySelector: key => controls[key] || null };
  const db = {
    101: { id: "101", species: "Draconis", colors: { body1: "#ffffff" } }
  };
  const stored = {};
  const alive = new Set(["101"]);
  let discards = 0;
  const helpers = {
    domain: OWEH.domain,
    storageGet: async (key, fallback) => key in stored ? stored[key] : fallback,
    storageSet: async patch => Object.assign(stored, patch),
    setStatus: () => {},
    runtimeRequest: async () => ({ ok: false }),
    getPetsByIds: async ids => Object.fromEntries(ids.filter(id => db[id]).map(id => [id, db[id]])),
    isWorkerOwner: async owner => owner === "sheet-discard",
    settings: { DEFAULT_REQUEST_DELAY: 0 },
    sleep: async () => {},
    gameActions: { discardPet: async id => { discards++; alive.delete(id); return { ok: true }; } },
    petFetch: {
      readOwnedPetIds: async () => ({ ids: [...alive], partial: false }),
      readHatchery: async () => ({ eggIds: [], unnamedIds: [], hatcherySeen: true })
    }
  };
  const module = OWEH.factory(helpers);
  await module.api.preview();
  assert.equal(discards, 0);
  assert.deepEqual(stored.owehSheetDiscardPlan.rows.map(row => row.id), ["101"]);
  assert.equal(stored.owehSheetDiscardPlan.missing, 1);
  assert.equal(stored.owehSheetDiscardPlan.confirmedAt, 0);
  assert.equal(globalThis.__sheetRequested, undefined);
  await module.api.confirm();
  assert.equal(globalThis.__sheetRequested, true);
  assert.equal(stored.owehSheetDiscardPlan.confirmedAt, stored.owehSheetDiscardPlan.createdAt);
  await globalThis.__sheetJob.run({ isCancelled: () => false, phase: () => {}, status: () => {} });
  assert.equal(discards, 1);
  assert.equal(stored.owehSheetDiscardPlan.rows[0].status, "discarded");
  assert.equal(stored.owehPets["101"].present, false);
  // Queued list is consumed. Even if the same worker runs again, it does not resend.
  await globalThis.__sheetJob.run({ isCancelled: () => false, phase: () => {}, status: () => {} });
  assert.equal(discards, 1);
  delete globalThis.document;
  delete globalThis.OWEH;
  delete globalThis.__sheetJob;
  delete globalThis.__sheetRequested;
});
