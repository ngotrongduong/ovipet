"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function setup({
  overview = true,
  owner = true,
  campaign = null,
  queue = [],
  pets = {},
  catalog = [],
  missingIds = [],
  plan = null,
  breedResult = { ok: true },
  hatchlingActive = false,
  scanPartial = false
} = {}) {
  const clock = { now: 1_000_000 };
  const scheduled = [];
  const store = {
    owehBreedCampaign: campaign || { active: false, femaleIndex: 0, attempted: {}, bredCount: 0 },
    owehBreedQueue: clone(queue),
    owehPets: clone(pets),
    owehBreedHistory: [],
    owehBreedStartRequest: { active: false },
    owehPetIndex: { active: false },
    owehHatchlingRun: { active: hatchlingActive },
    owehOwnUserId: "77"
  };
  let ownUserId = "77";
  const log = {
    status: [], claims: [], releases: [], phases: [], done: 0,
    navigations: [], breedCalls: [], catalogScans: 0, planOptions: []
  };
  const effectivePlan = plan || {
    femaleCount: 1,
    maleCount: 1,
    unpaired: 0,
    focusSpecies: "Catus",
    shortlistSize: 30,
    queue: clone(queue)
  };

  const helpers = {
    storageGet: async (key, fallback) => key in store ? clone(store[key]) : clone(fallback),
    getPetsByIds: async ids => Object.fromEntries(
      ids.map(id => String(id)).filter(id => Object.prototype.hasOwnProperty.call(store.owehPets, id))
        .map(id => [id, clone(store.owehPets[id])])
    ),
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") store.owehPets = { ...store.owehPets, ...clone(value) };
        else store[key] = clone(value);
      }
    },
    setStatus: text => log.status.push(text),
    requestClaimWorker: async (workerOwner, url) => { log.claims.push([workerOwner, url]); return { ok: true }; },
    requestReleaseWorker: async workerOwner => { log.releases.push(workerOwner); return { ok: true }; },
    reportWorkerPhase: text => log.phases.push(text),
    reportWorkerDone: () => { log.done += 1; },
    isWorkerOwner: async expected => owner && expected === "breed",
    workerClient: { getGeneration: () => 9 },
    routes: {
      isPetsOverview: () => overview,
      navigateTo: value => log.navigations.push(value),
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`
    },
    domain: {
      colors: { STRICT_PURE_TARGET: { body1: "#FFFFFF", body2: "#FF0000" } },
      petRecord: {
        petProfileNeedsRefresh: (_cached, item) => missingIds.includes(String(item.id)),
        databaseMetaFor: (_allPets, currentCatalog, missing, now) => ({ catalogAt: now, catalogCount: currentCatalog.length, missingProfiles: missing })
      },
      breedingScore: { DEFAULT_MALE_SHORTLIST_SIZE: 30 },
      pedigree: {
        pedigreeCompatibility: (female, male) => {
          if (female?.pedigreeVerified !== true || male?.pedigreeVerified !== true) {
            return { safe: false, reason: "pedigree-unverified", overlapIds: [] };
          }
          const overlap = (female.ancestors || []).find(id => (male.ancestors || []).includes(id));
          return overlap
            ? { safe: false, reason: "shared-ancestor", overlapIds: [overlap] }
            : { safe: true, reason: "verified-unrelated", overlapIds: [] };
        }
      },
      breedingPlan: {
        BREEDING_STRATEGIES: { PURE_LINE: "pure-line", SAME_FF_TARGET: "same-ff-target" },
        normalizeBreedingStrategy: value => value === "same-ff-target" ? "same-ff-target" : "pure-line",
        buildDatabaseBreedPlan: (_pets, _target, _history, options) => { log.planOptions.push(clone(options)); return clone(effectivePlan); }
      }
    },
    gameActions: {
      breedPairDirect: async (femaleId, maleId, campaignId) => {
        log.breedCalls.push([String(femaleId), String(maleId), campaignId]);
        const value = typeof breedResult === "function"
          ? breedResult(String(femaleId), String(maleId), log.breedCalls.length)
          : breedResult;
        return clone(value);
      }
    },
    settings: { getDelayMs: () => 0 },
    breedingActions: {
      readHatchlingRun: async () => clone(store.owehHatchlingRun),
      collectAllOverviewPets: async () => {
        log.catalogScans += 1;
        store.owehEnclosureScanStats = { partial: scanPartial };
        return clone(catalog);
      },
      getOwnUserId: () => ownUserId,
      setOwnUserId: id => { if (id) ownUserId = id; }
    }
  };

  const sandbox = vm.createContext({
    console: { error() {} }, Promise,
    Date: { now: () => clock.now }, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp,
    setTimeout: fn => { scheduled.push(fn); return scheduled.length; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/breeding.js"), "utf8"), sandbox, { filename: "breeding.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-breeding"].api, store, log, clock, scheduled };
}

(async () => {
  // The two campaign buttons share one worker owner but persist different planner strategies.
  {
    const env = setup();
    await env.api.requestStart("same-ff-target");
    assert.equal(env.store.owehBreedStrategy, "same-ff-target");
    assert.deepEqual(env.log.claims, [["breed", "https://ovipets.com/#!/?src=pets&sub=overview"]]);
  }

  // A worker starting outside Overview persists a resume request instead of trying to plan
  // against the wrong page.
  {
    const env = setup({ overview: false });
    await env.api.startWorker(9, false, "same-ff-target");
    assert.equal(env.store.owehBreedStartRequest.active, true);
    assert.equal(env.store.owehBreedStartRequest.strategy, "same-ff-target");
    assert.equal(env.log.navigations.at(-1), "?src=pets&sub=overview");
    assert.equal(env.log.catalogScans, 0);
  }

  // Planning indexes only missing/stale profiles and hands control to the persistent Pet Index.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }, { id: "20", usr: "77", name: "M", modified: "m2" }];
    const env = setup({ overview: true, catalog, missingIds: ["10"] });
    await env.api.startWorker(9, false, "same-ff-target");
    assert.equal(env.store.owehPetIndex.active, true);
    assert.equal(env.store.owehPetIndex.breedPlanning, true);
    assert.equal(env.store.owehPetIndex.breedStrategy, "same-ff-target");
    assert.equal(env.store.owehPetScanQueue.length, 1);
    assert.equal(env.store.owehPetScanQueue[0].id, "10");
    assert.equal(env.log.navigations.at(-1), "?usr=77&pet=10");
    assert.ok(env.log.phases.some(text => text === "indexing 0/1"));
  }

  // A partial enclosure scan fails closed: no pet is marked absent and no plan is built.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }];
    const env = setup({
      overview: true, catalog, scanPartial: true,
      pets: { "30": { id: "30", owned: true, present: true, name: "in an unscanned enclosure" } }
    });
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(env.store.owehPets["30"].present, true);
    assert.equal(env.store.owehBreedCampaign.active, false);
    assert.equal(env.log.planOptions.length, 0);
    assert.equal(env.log.done, 1);
    assert.ok(env.log.status.at(-1).includes("not every enclosure loaded"));
  }

  // Direct execution confirms the command before marking the female on cooldown and recording
  // breed history. A one-pair queue completes the campaign exactly once.
  {
    const pure = {
      distance: 0, lockedChannels: 4, body1ReachableChannels: 3,
      body1UnionExactChannels: 2, body1NewExactChannels: 1, exactParentCopies: 3,
      reachableChannels: 15, totalRangeWidth: 100, purePossible: true, pureProbability: 0.25
    };
    const env = setup({
      campaign: { active: true, mode: "database-direct-v2", strategy: "same-ff-target", femaleIndex: 0, bredCount: 0, errors: 0, unpaired: 0, startedAt: 123 },
      queue: [{ id: "10", name: "Female A", maleId: "20", pure }],
      pets: {
        "10": { id: "10", name: "Female A", gender: "Female", onCooldown: false, pedigreeVerified: true, ancestors: ["a"] },
        "20": { id: "20", name: "Male B", gender: "Male", pedigreeVerified: true, ancestors: ["b"] }
      }
    });
    await env.api.process();
    assert.deepEqual(env.log.breedCalls, [["10", "20", 123]]);
    assert.equal(env.store.owehPets["10"].onCooldown, true);
    assert.equal(env.store.owehBreedHistory.length, 1);
    assert.equal(env.store.owehBreedHistory[0].strategy, "same-ff-target");
    assert.equal(env.store.owehBreedCampaign.bredCount, 1);
    assert.equal(env.store.owehBreedCampaign.active, false);
    assert.equal(env.log.done, 1);
  }

  // OviPets may still reject a cached pair (most importantly when the server knows a
  // relationship that stale/partial local data missed). The campaign must keep the female
  // and try the next pedigree-verified male instead of abandoning her.
  {
    const pure = {
      distance: 1, lockedChannels: 4, body1ReachableChannels: 3,
      body1UnionExactChannels: 2, body1NewExactChannels: 1, exactParentCopies: 2,
      reachableChannels: 15, totalRangeWidth: 90, purePossible: true, pureProbability: 0.2
    };
    const env = setup({
      campaign: { active: true, mode: "database-direct-v2", strategy: "pure-line", femaleIndex: 0, bredCount: 0, errors: 0, unpaired: 0, startedAt: 456 },
      queue: [{
        id: "10", name: "Female A", maleId: "20", maleCandidateIndex: 0, rejectedMaleIds: [], pure,
        maleCandidates: [
          { maleId: "20", maleName: "Male rejected", pure },
          { maleId: "30", maleName: "Male fallback", pure }
        ]
      }],
      pets: {
        "10": { id: "10", name: "Female A", gender: "Female", onCooldown: false, pedigreeVerified: true, ancestors: ["fa"] },
        "20": { id: "20", name: "Male rejected", gender: "Male", pedigreeVerified: true, ancestors: ["ma"] },
        "30": { id: "30", name: "Male fallback", gender: "Male", pedigreeVerified: true, ancestors: ["mb"] }
      },
      breedResult: (_female, male) => male === "20"
        ? { ok: false, reason: "unable-to-breed-pets" }
        : { ok: true }
    });
    await env.api.process();
    assert.deepEqual(env.log.breedCalls, [["10", "20", 456]]);
    assert.equal(env.store.owehBreedQueue[0].maleCandidateIndex, 1);
    assert.deepEqual(env.store.owehBreedQueue[0].rejectedMaleIds, ["20"]);
    assert.equal(env.store.owehBreedCampaign.active, true, "female remains active while an alternate male exists");
    assert.ok(env.scheduled.length);
    await env.scheduled.shift()();
    assert.deepEqual(env.log.breedCalls, [["10", "20", 456], ["10", "30", 456]]);
    assert.equal(env.store.owehBreedCampaign.bredCount, 1);
    assert.equal(env.store.owehBreedCampaign.active, false);
  }

  // Runtime pedigree validation is fail-closed even if a corrupt/legacy queue somehow
  // reaches execution. No direct breeding command may be sent for an unverified female.
  {
    const pure = { distance: 0 };
    const env = setup({
      campaign: { active: true, mode: "database-direct-v2", strategy: "pure-line", femaleIndex: 0, bredCount: 0, errors: 0, unpaired: 0, startedAt: 789 },
      queue: [{ id: "10", name: "Unknown pedigree", maleId: "20", pure }],
      pets: {
        "10": { id: "10", name: "Unknown pedigree", gender: "Female", onCooldown: false, pedigreeVerified: false, ancestors: [] },
        "20": { id: "20", name: "Male", gender: "Male", pedigreeVerified: true, ancestors: [] }
      }
    });
    await env.api.process();
    assert.equal(env.log.breedCalls.length, 0);
    assert.equal(env.store.owehBreedCampaign.unpaired, 1);
    assert.equal(env.store.owehBreedCampaign.active, false);
  }

  // Old campaign formats fail closed after a schema/strategy upgrade.
  {
    const env = setup({ campaign: { active: true, mode: "old-mode", femaleIndex: 0, bredCount: 0 } });
    await env.api.process();
    assert.equal(env.store.owehBreedCampaign.active, false);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.breedCalls.length, 0);
  }

  // The continuation guard is synchronous: concurrent refreshes consume one persisted start
  // request once, not twice.
  {
    const env = setup({ overview: true, catalog: [] });
    env.store.owehBreedStartRequest = { active: true, resumeFromIndex: false };
    await Promise.all([env.api.maybeContinueStart(), env.api.maybeContinueStart()]);
    assert.equal(env.log.catalogScans, 1);
    assert.equal(env.store.owehBreedStartRequest.active, false);
    assert.equal(env.log.done, 1);
  }

  // Stop clears durable state even if the live lease is already missing.
  {
    const env = setup({ campaign: { active: true, mode: "database-direct-v2", femaleIndex: 0, bredCount: 0 } });
    await env.api.stop();
    assert.equal(env.store.owehBreedCampaign.active, false);
    assert.deepEqual(env.log.releases, ["breed"]);
  }

  console.log("breeding feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
