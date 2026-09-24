"use strict";

// Command-first hatchling pass: Hatchery + profiles are fetched, then each newborn is named,
// saved and moved with direct commands. No navigation happens at any point.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function setup({
  hatchery = { eggIds: [], turnable: [], hatchable: [], unnamedIds: [] },
  profiles = {},
  owner = "hatchlings",
  nameResult = { ok: true },
  moveResult = { moved: true }
} = {}) {
  const clock = { now: 1_000_000 };
  const store = {
    owehHatchlingRun: { active: false, phase: "scan", index: 0 },
    owehHatchlingQueue: [],
    owehHatchlingRecords: {},
    owehPets: {},
    owehDatabaseMeta: { catalogCount: 0, completeProfiles: 0 },
    owehBreedingStockMaxDistance: 96,
    owehOwnUserId: "77"
  };
  const log = {
    status: [], claims: [], releases: [], phases: [], done: 0, ranking: 0,
    names: [], moves: [], reads: [], fullPetReads: 0, petWrites: [], navigations: 0
  };
  const helpers = {
    storageGet: async (key, fallback) => {
      if (key === "owehPets") log.fullPetReads += 1;
      return key in store ? clone(store[key]) : clone(fallback);
    },
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") {
          for (const [id, pet] of Object.entries(clone(value))) store.owehPets[id] = { ...(store.owehPets[id] || {}), ...pet };
          log.petWrites.push(Object.keys(value));
        } else store[key] = clone(value);
      }
    },
    getPetsByIds: async ids => Object.fromEntries(ids.map(String)
      .filter(id => Object.prototype.hasOwnProperty.call(store.owehPets, id))
      .map(id => [id, clone(store.owehPets[id])])),
    sleep: async ms => { clock.now += Number(ms || 0); },
    setStatus: text => log.status.push(text),
    requestClaimWorker: async (workerOwner, url) => { log.claims.push([workerOwner, url]); return { ok: true }; },
    requestReleaseWorker: async workerOwner => { log.releases.push(workerOwner); return { ok: true }; },
    reportWorkerPhase: text => log.phases.push(text),
    reportWorkerDone: () => { log.done += 1; },
    workerClient: { getOwner: () => owner, getGeneration: () => 4 },
    routes: { navigateTo: () => { log.navigations += 1; } },
    domain: {
      colors: { suggestedPetName: pet => `${pet.colors.body1}-${pet.colors.body2}` },
      petRecord: { isCompletePetRecord: pet => Boolean(pet?.gender && pet?.colors) },
      breedingPlan: {
        MALES_ENCLOSURE: "Males",
        DEFAULT_BREEDING_STOCK_MAX_DISTANCE: 96,
        normalizeEnclosureLabel: label => String(label || "").trim().toLowerCase(),
        desiredProgramEnclosure: pet => pet.colors.body1 === "FFFFFF" ? "FF ** **" : null
      }
    },
    gameActions: {
      namePet: async (id, name, options) => { log.names.push([id, name, Boolean(options?.unnamed)]); return clone(nameResult); },
      movePetToEnclosureId: async (id, enclosureId) => { log.moves.push([id, `#${enclosureId}`]); return clone(moveResult); },
      fastMovePetToEnclosure: async (id, label) => { log.moves.push([id, label]); return clone(moveResult); }
    },
    petFetch: {
      readHatchery: async () => clone(hatchery),
      readPet: async (id, usr) => {
        log.reads.push([id, usr]);
        const profile = profiles[id];
        if (!profile) return { ok: false, reason: "profile:fetch" };
        if (!profile.colors) return { ok: false, reason: "missing-colors", profile: clone(profile) };
        return {
          ok: true,
          profile: clone(profile),
          record: { id, name: profile.name, gender: profile.gender, colors: clone(profile.colors), pedigreeVerified: true }
        };
      },
      mergePetRecord: (previous, record) => ({ ...(previous || {}), ...record })
    },
    hatchlingActions: {
      getOwnUserId: () => "77",
      updateRetentionRanking: async () => { log.ranking += 1; }
    }
  };
  const sandbox = vm.createContext({
    console: { error() {} }, Promise, Date: { now: () => clock.now },
    Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/hatchlings.js"), "utf8"), sandbox, { filename: "hatchlings.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-hatchlings"].api, store, log, clock };
}

const female = { gender: "Female", name: "Unnamed", unnamed: true, canName: true, colors: { body1: "FFFFFF", body2: "FF0000" }, enclosureLabel: "Hatchery", enclosureOptions: { Hatchery: "1", "FF ** **": "55", Males: "66" } };
const male = { gender: "Male", name: "Unnamed", unnamed: true, canName: true, colors: { body1: "000000", body2: "00FF00" }, enclosureLabel: "Hatchery", enclosureOptions: { Hatchery: "1", Males: "66" } };

(async () => {
  // One pass: a female and a male are named, saved and moved by enclosure id; eggs with a
  // Turn/Hatch icon are left to the egg run; nothing navigates.
  {
    const env = setup({
      hatchery: { eggIds: ["5", "6"], turnable: ["5"], hatchable: ["6"], unnamedIds: ["10", "20"] },
      profiles: { 10: female, 20: male }
    });
    await env.api.startWorker(4, true);
    const run = env.store.owehHatchlingRun;
    assert.equal(run.active, false);
    assert.equal(run.renamed, 2);
    assert.equal(run.movedFemales, 1);
    assert.equal(run.movedMales, 1);
    assert.deepEqual(env.log.reads.map(read => read[0]), ["10", "20"]);
    assert.deepEqual(env.log.names, [["10", "FFFFFF-FF0000", true], ["20", "000000-00FF00", true]]);
    assert.deepEqual(env.log.moves, [["10", "#55"], ["20", "#66"]]);
    assert.equal(env.store.owehPets["10"].enclosure, "FF ** **");
    assert.equal(env.store.owehPets["10"].name, "FFFFFF-FF0000");
    assert.equal(env.store.owehPets["20"].enclosure, "Males");
    assert.equal(env.store.owehDatabaseMeta.catalogCount, 2);
    assert.equal(env.store.owehHatchlingRecords["10"].status, "moved-female");
    assert.equal(env.store.owehHatchlingRecords["20"].status, "moved-male");
    assert.equal(env.log.ranking, 1);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.navigations, 0);
    assert.equal(env.log.fullPetReads, 0, "per-pet writes never read the whole DB");
    assert.ok(env.log.petWrites.every(ids => ids.length === 1));
  }

  // An incubating egg (no gender) is skipped; a female already in place is not moved; a
  // missing enclosure option falls back to the label move.
  {
    const placed = { ...female, name: "FFFFFF-FF0000", unnamed: false, enclosureLabel: "FF ** **" };
    const noOption = { ...female, enclosureOptions: {} };
    const env = setup({
      hatchery: { eggIds: ["7", "11", "12"], turnable: [], hatchable: [], unnamedIds: ["12"] },
      profiles: { 7: { gender: "", name: "Egg" }, 11: placed, 12: noOption }
    });
    await env.api.startWorker(4, true);
    const run = env.store.owehHatchlingRun;
    assert.equal(run.skippedEggs, 1);
    assert.equal(env.store.owehHatchlingRecords["7"].status, "not-hatched");
    assert.equal(env.store.owehHatchlingRecords["11"].status, "already-female");
    assert.deepEqual(env.log.names, [["12", "FFFFFF-FF0000", true]], "the correctly named pet is not renamed");
    assert.deepEqual(env.log.moves, [["12", "FF ** **"]]);
  }

  // Unroutable females and failed commands are counted, never retried in a loop.
  {
    const offTarget = { ...female, colors: { body1: "123456", body2: "000000" } };
    const env = setup({
      hatchery: { eggIds: [], turnable: [], hatchable: [], unnamedIds: ["30", "31"] },
      profiles: { 30: offTarget, 31: male },
      moveResult: { moved: false, reason: "direct-command-failed" }
    });
    await env.api.startWorker(4, true);
    const run = env.store.owehHatchlingRun;
    assert.equal(run.unroutable, 1);
    assert.equal(run.errors, 1);
    assert.equal(env.store.owehHatchlingRecords["31"].status, "error:direct-command-failed");
  }

  // A failed name command records the error but still saves the fetched record.
  {
    const env = setup({
      hatchery: { eggIds: [], turnable: [], hatchable: [], unnamedIds: ["40"] },
      profiles: { 40: female },
      nameResult: { ok: false, reason: "timeout" }
    });
    await env.api.startWorker(4, true);
    assert.equal(env.store.owehHatchlingRun.errors, 1);
    assert.equal(env.store.owehHatchlingRecords["40"].status, "error:timeout");
    assert.equal(env.store.owehPets["40"].gender, "Female");
    assert.equal(env.log.moves.length, 0);
  }

  // Cooldowns: a recently processed pet is skipped unless forced; unnamed pets always qualify.
  {
    const env = setup();
    env.store.owehHatchlingRecords = { 50: { at: env.clock.now - 1000, status: "moved-female" }, 51: { at: env.clock.now - 120_000, status: "not-hatched" } };
    const panel = { eggIds: ["50", "51", "52"], turnable: ["52"], hatchable: [], unnamedIds: [] };
    assert.deepEqual(clone((await env.api.eligibleCards(false, env.clock.now, panel)).map(item => item.id)), ["51"]);
    assert.deepEqual(clone((await env.api.eligibleCards(true, env.clock.now, panel)).map(item => item.id)), ["50", "51"]);
  }

  // Nothing to do: the claim is released at once with a clear status.
  {
    const env = setup({ hatchery: { eggIds: ["5"], turnable: ["5"], hatchable: [], unnamedIds: [] } });
    await env.api.startWorker(4, true);
    assert.equal(env.log.done, 1);
    assert.match(env.log.status.at(-1), /still need Turn Egg/);
    assert.equal(env.store.owehHatchlingRun.active, false);
  }

  // Stop clears durable state and releases the worker; a non-owner tab never resumes.
  {
    const env = setup({ owner: null });
    env.store.owehHatchlingRun = { active: true, index: 0 };
    env.store.owehHatchlingQueue = [{ id: "60", unnamed: true }];
    await env.api.process();
    assert.equal(env.log.reads.length, 0);
    await env.api.stop();
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.deepEqual(env.log.releases, ["hatchlings"]);
  }

  // The worker tab resumes a run after a reload from the stored index.
  {
    const env = setup({ profiles: { 70: female, 71: male } });
    env.store.owehHatchlingRun = { active: true, index: 1, renamed: 1, movedFemales: 1, ownUserId: "77" };
    env.store.owehHatchlingQueue = [{ id: "70", unnamed: true }, { id: "71", unnamed: true }];
    await env.api.process();
    assert.deepEqual(env.log.reads.map(read => read[0]), ["71"]);
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.equal(env.store.owehHatchlingRun.movedMales, 1);
  }

  console.log("hatchling feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
