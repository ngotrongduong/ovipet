"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({ breedPlanning = false, owner = true, queue = [], currentPetId = null, autoRename = false } = {}) {
  const clock = { now: 1000000 };
  const store = {
    owehPetIndex: { active: true, breedPlanning, index: 0, autoRename, returnHash: "#!/?src=pets&sub=overview", renamed: 0, indexed: 0 },
    owehPetScanQueue: JSON.parse(JSON.stringify(queue)),
    owehPets: {},
    owehDatabaseMeta: { completeProfiles: 0, missingProfiles: queue.length },
    owehOwnUserId: "77"
  };
  const page = { petId: currentPetId };
  const log = { releases: [], statuses: [], done: 0, tabs: [], renames: [], ranking: 0, navigations: [] };
  const profile = {
    id: currentPetId || "1",
    name: "Old",
    gender: "Female",
    species: "Catus",
    ancestors: [],
    pedigreeVerified: true,
    colors: { body1: "FFFFFF", body2: "FF0000", scales: "000000", extra1: "FF0000", extra2: "000000" }
  };

  const helpers = {
    storageGet: async (key, fallback) => key in store ? JSON.parse(JSON.stringify(store[key])) : fallback,
    getPetsByIds: async ids => Object.fromEntries(
      ids.map(id => String(id)).filter(id => Object.prototype.hasOwnProperty.call(store.owehPets, id))
        .map(id => [id, JSON.parse(JSON.stringify(store.owehPets[id]))])
    ),
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") store.owehPets = { ...store.owehPets, ...JSON.parse(JSON.stringify(value)) };
        else store[key] = JSON.parse(JSON.stringify(value));
      }
    },
    sleep: async ms => { clock.now += Number(ms || 0); },
    setStatus: text => log.statuses.push(text),
    requestReleaseWorker: async value => { log.releases.push(value); return { ok: true }; },
    isWorkerOwner: async expected => owner && expected === (breedPlanning ? "breed" : "index"),
    reportWorkerDone: () => { log.done += 1; },
    routes: {
      currentPetId: () => page.petId,
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`,
      navigateTo: value => { log.navigations.push(value); const id = value.match(/[?&]pet=(\d+)/)?.[1]; if (id) page.petId = id; }
    },
    profileDom: {
      isPedigreeLoaded: () => true,
      pedigreeAncestorIds: () => [],
      readPet: () => ({ ...profile, id: page.petId || profile.id })
    },
    domain: {
      petRecord: {
        isCompletePetRecord: pet => Boolean(pet?.gender && pet?.species && pet?.name && pet?.pedigreeVerified === true
          && pet?.colors && Array.isArray(pet?.ancestors))
      }
    },
    settings: { getPageLoadDelayMs: () => 0 },
    petIndexActions: {
      openTab: async name => { log.tabs.push(name); return true; },
      renamePet: async pet => { log.renames.push(pet.id); return { changed: true, name: `Renamed-${pet.id}` }; },
      updateRetentionRanking: async () => { log.ranking += 1; }
    }
  };

  const sandbox = vm.createContext({
    console: { error() {} }, Promise, Date: { now: () => clock.now },
    Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/pet-index.js"), "utf8"), sandbox, { filename: "pet-index.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-pet-index"].api, store, page, log };
}

(async () => {
  // Normal profile indexing persists metadata and moves to the next queued profile.
  {
    const queue = [
      { id: "1", modified: "m1", enclosure: "A", enclosureId: 1 },
      { id: "2", modified: "m2", enclosure: "B", enclosureId: 2 }
    ];
    const env = setup({ queue, currentPetId: "1", autoRename: true });
    await env.api.process();
    assert.equal(env.store.owehPetIndex.index, 1);
    assert.equal(env.store.owehPetIndex.indexed, 1);
    assert.equal(env.store.owehPetIndex.renamed, 1);
    assert.equal(env.store.owehPets["1"].name, "Renamed-1");
    assert.equal(env.store.owehPets["1"].profileStale, false);
    assert.deepEqual(env.log.tabs, ["Overview", "Pedigree"]);
    assert.equal(env.log.navigations.at(-1), "?usr=77&pet=2");

    await env.api.process();
    assert.equal(env.store.owehPetIndex.active, false);
    assert.equal(env.store.owehPetIndex.indexed, 2);
    assert.equal(env.log.ranking, 1);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=overview");
  }

  // A breed-planning index hands control back to the breed planner instead of completing
  // the shared worker as an ordinary index job.
  {
    const env = setup({ breedPlanning: true, queue: [], currentPetId: null });
    await env.api.process();
    assert.equal(env.store.owehPetIndex.active, false);
    assert.equal(env.store.owehBreedStartRequest.active, true);
    assert.equal(env.store.owehBreedStartRequest.resumeFromIndex, true);
    assert.equal(env.log.navigations.at(-1), "?src=pets&sub=overview");
    assert.equal(env.log.done, 0);
  }

  // A tab without the matching shared-worker lease cannot advance the queue.
  {
    const env = setup({ owner: false, queue: [{ id: "1" }], currentPetId: "1" });
    await env.api.process();
    assert.equal(env.store.owehPetIndex.index, 0);
    assert.equal(env.log.tabs.length, 0);
  }

  // Stop releases the correct shared-worker owner and clears durable active state.
  {
    const normal = setup({ queue: [] });
    await normal.api.stop();
    assert.equal(normal.store.owehPetIndex.active, false);
    assert.equal(normal.log.releases[0], "index");

    const breed = setup({ breedPlanning: true, queue: [] });
    await breed.api.stop();
    assert.equal(breed.log.releases[0], "breed");
  }

  console.log("pet index feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
