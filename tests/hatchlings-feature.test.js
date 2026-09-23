"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function setup({
  owner = true,
  ownHatchery = true,
  eggs = [],
  cards = [],
  active = false,
  phase = "scan",
  queue = [],
  petId = null,
  gender = "Female",
  moveResult = { moved: true },
  renameResult = { changed: true, name: "FFFFFF-FF0000-000000" }
} = {}) {
  const clock = { now: 1_000_000 };
  const timers = new Map();
  let nextTimer = 1;
  const store = {
    owehHatchlingRun: {
      active, phase, index: 0, returnHash: "#!/?src=pets&sub=hatchery", target: {},
      maleCandidates: [], renamed: 0, movedFemales: 0, movedMales: 0,
      skippedEggs: 0, unroutable: 0, errors: 0
    },
    owehHatchlingQueue: clone(queue),
    owehHatchMaleMoveQueue: [],
    owehHatchlingRecords: {},
    owehPets: {},
    owehDatabaseMeta: { catalogCount: 0, completeProfiles: 0 },
    owehPetIndex: { active: false },
    owehEggRun: { active: false },
    owehSweep: { active: false },
    owehBreedCampaign: { active: false },
    owehBreedingStockMaxDistance: 96,
    owehOwnUserId: "77"
  };
  const page = { petId, hash: ownHatchery ? "#!/?src=pets&sub=hatchery" : "#!/?usr=999" };
  const log = {
    status: [], claims: [], releases: [], phases: [], done: 0, navigations: [],
    tabs: [], renames: [], moves: [], ranking: 0, timersCleared: 0
  };
  const petTemplate = {
    id: petId || queue[0]?.id || "10",
    name: "Unnamed",
    species: "Catus",
    gender,
    ancestors: [],
    colors: { body1: "FFFFFF", body2: "FF0000", scales: "000000", extra1: "FF0000", extra2: "000000" }
  };
  let ownUserId = "77";

  const helpers = {
    storageGet: async (key, fallback) => key in store ? clone(store[key]) : clone(fallback),
    storageSet: async values => { for (const [key, value] of Object.entries(values)) store[key] = clone(value); },
    sleep: async ms => { clock.now += Number(ms || 0); await Promise.resolve(); },
    setStatus: text => log.status.push(text),
    requestClaimWorker: async (workerOwner, url) => { log.claims.push([workerOwner, url]); return { ok: true }; },
    requestReleaseWorker: async workerOwner => { log.releases.push(workerOwner); return { ok: true }; },
    reportWorkerPhase: phaseText => log.phases.push(phaseText),
    reportWorkerDone: () => { log.done += 1; },
    isWorkerOwner: async expected => owner && expected === "hatchlings",
    workerClient: { getOwner: () => "hatchlings", getGeneration: () => 4 },
    routes: {
      isOwnHatchery: () => ownHatchery,
      currentPetId: () => page.petId,
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`,
      navigateTo: value => {
        log.navigations.push(value);
        page.hash = value;
        const id = value.match(/[?&]pet=(\d+)/)?.[1];
        if (id) page.petId = id;
      }
    },
    hatcheryDom: {
      getHatcheryEggs: () => clone(eggs),
      getHatcheryPetCards: () => clone(cards)
    },
    domain: {
      colors: {
        STRICT_PURE_TARGET: { body1: "#FFFFFF" },
        suggestedPetName: pet => `${pet.colors.body1}-${pet.colors.body2}-${pet.colors.scales}`
      },
      petRecord: { isCompletePetRecord: pet => Boolean(pet?.gender && pet?.colors) },
      breedingPlan: {
        MALES_ENCLOSURE: "Males",
        DEFAULT_BREEDING_STOCK_MAX_DISTANCE: 96,
        desiredProgramEnclosure: pet => String(pet.gender).toLowerCase() === "female" ? "FF ** **" : "Males"
      }
    },
    settings: { getPageLoadDelayMs: () => 0 },
    hatchlingActions: {
      readOwnEggRun: async () => clone(store.owehEggRun),
      readSweep: async () => clone(store.owehSweep),
      readBreedCampaign: async () => clone(store.owehBreedCampaign),
      ownedByThisTab: () => true,
      getOwnUserId: () => ownUserId,
      setOwnUserId: id => { if (id) ownUserId = id; },
      openTab: async name => { log.tabs.push(name); return true; },
      waitForPetGender: async () => gender,
      readPet: () => ({ ...clone(petTemplate), id: page.petId || petTemplate.id }),
      renamePet: async (pet, desiredName) => { log.renames.push([pet.id, desiredName]); return clone(renameResult); },
      movePetToEnclosure: async target => { log.moves.push(target); return clone(moveResult); },
      updateRetentionRanking: async () => { log.ranking += 1; },
      rankMale: () => ({ targetExact: 1, targetUsed: 1, targetDistance: 0, extremeExact: 3, extremeDistance: 0 })
    },
    pageActions: { currentHash: () => page.hash }
  };

  const sandbox = vm.createContext({
    console: { error() {} }, Promise, Date: { now: () => clock.now },
    Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp,
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => { if (timers.delete(id)) log.timersCleared += 1; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/hatchlings.js"), "utf8"), sandbox, { filename: "hatchlings.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-hatchlings"].api, store, page, log, clock, timers };
}

(async () => {
  // Turnable eggs have priority; an explicit hatchling worker keeps its claim and schedules
  // a bounded retry instead of competing for the Hatchery.
  {
    const env = setup({ ownHatchery: true, eggs: [{ id: "1" }] });
    await env.api.startWorker(4, true);
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.equal(env.timers.size, 1);
    assert.ok(env.log.status.some(text => text.includes("Turnable eggs are handled first")));
    env.api.stopLocal();
    assert.equal(env.timers.size, 0);
  }

  // One female is renamed, indexed, routed, then the run completes and returns to Hatchery.
  {
    const item = { id: "10", href: "?usr=77&pet=10", modified: "m1", likelyHatched: true, unnamed: true };
    const env = setup({ active: true, queue: [item], petId: "10", gender: "Female" });
    await env.api.process();
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.equal(env.store.owehHatchlingRun.renamed, 1);
    assert.equal(env.store.owehHatchlingRun.movedFemales, 1);
    assert.equal(env.store.owehPets["10"].enclosure, "FF ** **");
    assert.deepEqual(env.log.tabs, ["Overview"]);
    assert.deepEqual(env.log.moves, ["FF ** **"]);
    assert.equal(env.log.ranking, 1);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=hatchery");
  }

  // A male transitions through the durable maleMove phase, then moves into Males and finishes.
  {
    const item = { id: "20", href: "?usr=77&pet=20", modified: "m2", likelyHatched: true, unnamed: true };
    const env = setup({ active: true, queue: [item], petId: "20", gender: "Male" });
    await env.api.process();
    assert.equal(env.store.owehHatchlingRun.active, true);
    assert.equal(env.store.owehHatchlingRun.phase, "maleMove");
    assert.equal(env.store.owehHatchMaleMoveQueue.length, 1);
    assert.equal(env.store.owehHatchMaleMoveQueue[0].target, "Males");
    await env.api.process();
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.equal(env.store.owehHatchlingRun.movedMales, 1);
    assert.equal(env.log.moves.at(-1), "Males");
    assert.equal(env.log.done, 1);
  }

  // A non-owner tab cannot advance durable hatchling progress.
  {
    const item = { id: "30", href: "?usr=77&pet=30", likelyHatched: true, unnamed: true };
    const env = setup({ active: true, owner: false, queue: [item], petId: "30" });
    await env.api.process();
    assert.equal(env.store.owehHatchlingRun.index, 0);
    assert.equal(env.log.tabs.length, 0);
  }

  // Stop clears durable active state even if the worker claim has already gone stale.
  {
    const env = setup({ active: true });
    await env.api.stop();
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.deepEqual(env.log.releases, ["hatchlings"]);
  }

  // Worker start on the wrong page fails closed and releases itself via workerDone.
  {
    const env = setup({ ownHatchery: false });
    await env.api.startWorker(4, true);
    assert.equal(env.log.done, 1);
    assert.ok(env.log.status.some(text => text.includes("Open your own Hatchery")));
  }

  console.log("hatchling feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
