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
  scanPartial = false,
  claimResult = { ok: true },
  extraStore = {},
  onProfileRead = null
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
    owehOwnUserId: "77",
    ...clone(extraStore)
  };
  let ownUserId = "77";
  const log = {
    status: [], claims: [], releases: [], phases: [], done: 0,
    navigations: [], breedCalls: [], catalogScans: 0, planOptions: [], profileReads: [], skippedTabs: []
  };
  const worker = { generation: 9 };
  const hooks = {};
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
    sleep: async () => {},
    requestClaimWorker: async (workerOwner, url) => { log.claims.push([workerOwner, url]); return clone(claimResult); },
    requestReleaseWorker: async workerOwner => { log.releases.push(workerOwner); return { ok: true }; },
    reportWorkerPhase: text => log.phases.push(text),
    reportWorkerDone: () => { log.done += 1; },
    isWorkerOwner: async expected => owner && expected === "breed",
    workerClient: { getGeneration: () => worker.generation },
    routes: {
      isPetsOverview: () => overview,
      navigateTo: value => log.navigations.push(value),
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`
    },
    domain: {
      colors: { STRICT_PURE_TARGET: { body1: "#FFFFFF", body2: "#FF0000" } },
      petRecord: {
        isCompletePetRecord: pet => pet?.complete !== false,
        // Stand-in for domain/pet-record.js mergeCatalogScan: `missingIds` are the new/changed
        // pets whose profile must be read.
        mergeCatalogScan: (allPets, items, { partial, keepUnseen }) => {
          const changed = {};
          const seen = new Set(items.map(item => String(item.id)));
          for (const item of items) {
            const id = String(item.id);
            allPets[id] = { ...(allPets[id] || {}), ...item, owned: true, present: true, profileStale: missingIds.includes(id) };
            changed[id] = allPets[id];
          }
          if (!partial) {
            for (const [id, pet] of Object.entries(allPets)) {
              if (pet?.owned && !seen.has(id) && pet.present !== false && !keepUnseen(pet)) {
                allPets[id] = { ...pet, present: false };
                changed[id] = allPets[id];
              }
            }
          }
          return { changed, added: 0, stale: missingIds.length, missing: 0 };
        },
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
        isCullEnclosure: name => String(name || "").replace(/\s+/g, "").toUpperCase() === "MALESDISCARD",
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
    settings: { getDelayMs: () => 0, DEFAULT_REQUEST_DELAY: 0 },
    petFetch: {
      collectCatalog: async ({ skipTab }) => {
        log.catalogScans += 1;
        log.skippedTabs = ["Males", "Males discard", "FF ** **"].filter(label => skipTab({ label, id: label }));
        store.owehEnclosureScanStats = { partial: scanPartial, at: clock.now };
        return { catalog: clone(catalog), partial: scanPartial, ownUserId: "77" };
      },
      readAndMerge: async cached => {
        log.profileReads.push(String(cached.id));
        if (hooks.readAndMerge) return hooks.readAndMerge(cached);
        onProfileRead?.(cached, worker);
        return { ok: true, profile: {}, pet: { ...cached, complete: true, profileStale: false, lastProfileScanAt: clock.now } };
      }
    },
    breedingActions: {
      readHatchlingRun: async () => clone(store.owehHatchlingRun),
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
  return { api: modules["feature-breeding"].api, store, log, clock, scheduled, hooks, helpers };
}

(async () => {
  // The two campaign buttons share one worker owner but persist different planner strategies.
  {
    const env = setup();
    await env.api.requestStart("same-ff-target");
    assert.equal(env.store.owehBreedStrategy, "same-ff-target");
    assert.deepEqual(env.log.claims, [["breed", "https://ovipets.com/#!/?src=pets&sub=overview"]]);
  }

  // v5.7.0: planning is command-first — it works from any page and never navigates. The catalog
  // fetch skips Males discard.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }];
    const env = setup({ overview: false, catalog });
    await env.api.startWorker(9, false, "same-ff-target");
    assert.deepEqual(env.log.navigations, []);
    assert.equal(env.log.catalogScans, 1);
    assert.deepEqual(env.log.skippedTabs, ["Males discard"]);
    assert.equal(env.store.owehBreedPreview.strategy, "same-ff-target");
    assert.equal(env.store.owehBreedStartRequest.active, false);
  }

  // New/changed profiles are fetched in place (no Pet Index handoff, no navigation); a pet sitting
  // in Males discard is never read, and a complete unchanged pet is not re-read.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }, { id: "20", usr: "77", name: "M", modified: "m2" }];
    const env = setup({
      overview: true, catalog, missingIds: ["10"],
      pets: { "40": { id: "40", owned: true, present: true, enclosure: "Males discard", profileStale: true } }
    });
    await env.api.startWorker(9, false, "same-ff-target");
    assert.deepEqual(env.log.profileReads, ["10"]);
    assert.equal(env.store.owehPetIndex.active, false);
    assert.equal(env.store.owehPetScanQueue, undefined);
    assert.deepEqual(env.log.navigations, []);
    assert.equal(env.store.owehPets["10"].profileStale, false);
    assert.equal(env.store.owehPets["40"].present, true, "Males discard pets are kept, not marked absent");
    assert.ok(env.log.phases.includes("profiles 1/1"));
    assert.equal(env.store.owehBreedPreview.catalogCount, 2);
  }

  // Profiles are read three at a time.
  {
    const catalog = Array.from({ length: 7 }, (_, i) => ({ id: String(100 + i), usr: "77", name: `P${i}`, modified: "m" }));
    let inFlight = 0;
    let peak = 0;
    const env = setup({ catalog, missingIds: catalog.map(pet => pet.id) });
    env.hooks.readAndMerge = async cached => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      return { ok: true, profile: {}, pet: { ...cached, profileStale: false } };
    };
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(peak, 3);
    assert.equal(Object.values(env.store.owehPets).filter(pet => pet.profileStale === false).length, 7);
  }

  // OviPets' partner lists are read three females at a time and feed the plan.
  {
    const females = Array.from({ length: 5 }, (_, i) => ({ id: String(200 + i) }));
    const env = setup({
      pets: { "10": { id: "10", owned: true, present: true, name: "F" } },
      extraStore: { owehEnclosureScanStats: { partial: false, at: 1_000_000 }, owehEnclosureIds: { Males: "5" } }
    });
    Object.assign(env.helpers.domain.breedingPlan, {
      plannableFemales: () => females,
      plannableMaleEnclosures: () => ["Males"],
      normalizeEnclosureLabel: label => String(label).toUpperCase()
    });
    let inFlight = 0;
    let peak = 0;
    env.helpers.petFetch.readBreedingPartners = async femaleId => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      return [`m${femaleId}`];
    };
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(peak, 3);
    assert.equal(Object.keys(env.log.planOptions[0].gameEligible).length, 5);
    assert.deepEqual(env.log.planOptions[0].gameEligible["204"], ["m204"]);
  }

  // A fresh database (complete catalog under 10 minutes old) is used without any fetch.
  {
    const env = setup({
      pets: { "10": { id: "10", owned: true, present: true, name: "F" } },
      extraStore: { owehEnclosureScanStats: { partial: false, at: 1_000_000 - 60_000 }, owehEnclosureIds: { Females: "5" } }
    });
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(env.log.catalogScans, 0);
    assert.deepEqual(env.log.profileReads, []);
    assert.ok(env.log.status.some(text => text.includes("using the pet database")));
    assert.equal(env.store.owehBreedPreview.catalogCount, 1);
  }

  // Stop during the profile fetch ends planning without a preview.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }, { id: "20", usr: "77", name: "M", modified: "m2" }];
    const env = setup({ catalog, missingIds: ["10", "20"], onProfileRead: (_cached, worker) => { worker.generation = null; } });
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(env.log.profileReads.length, 1);
    assert.equal(env.log.planOptions.length, 0);
    assert.equal(env.store.owehBreedPreview, undefined);
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

  // Planning only builds a preview: no command, no active campaign, and the worker is released.
  {
    const catalog = [{ id: "10", usr: "77", name: "F", modified: "m1" }, { id: "20", usr: "77", name: "M", modified: "m2" }];
    const queue = [{ id: "10", name: "F", maleId: "20", maleName: "M" }, { id: "11", name: "G", maleId: null }];
    const env = setup({ overview: true, catalog, queue, plan: { femaleCount: 2, maleCount: 1, unpaired: 1, focusSpecies: "Catus", shortlistSize: 30, queue } });
    await env.api.startWorker(9, false, "pure-line");
    assert.equal(env.log.breedCalls.length, 0, "planning must never breed");
    assert.equal(env.store.owehBreedCampaign.active, false);
    assert.equal(env.store.owehBreedPreview.queue.length, 2);
    assert.equal(env.store.owehBreedPreview.pairable, 1);
    assert.equal(env.store.owehBreedPreview.createdAt, env.clock.now);
    assert.equal(env.log.done, 1);
    assert.ok(env.log.status.at(-1).includes("nothing bred yet"));
  }

  // Confirm applies the pair limit, activates the campaign and claims the worker; the worker then
  // executes the confirmed queue without planning again.
  {
    const preview = {
      strategy: "pure-line", createdAt: 1_000_000 - 60_000, femaleCount: 3, pairable: 3, maleCount: 3, unpaired: 0,
      species: "Catus", shortlistSize: 30, catalogCount: 6, target: { body1: "#FFFFFF" },
      queue: [
        { id: "10", name: "F1", maleId: "20", maleName: "M1", pure: { distance: 0 } },
        { id: "11", name: "F2", maleId: "21", maleName: "M2", pure: { distance: 1 } },
        { id: "12", name: "F3", maleId: "22", maleName: "M3", pure: { distance: 2 } }
      ]
    };
    const env = setup({
      extraStore: { owehBreedPreview: preview, owehBreedPairLimit: 2 },
      pets: {
        "10": { id: "10", name: "F1", gender: "Female", pedigreeVerified: true, ancestors: ["a"] },
        "20": { id: "20", name: "M1", gender: "Male", pedigreeVerified: true, ancestors: ["b"] }
      }
    });
    await env.api.confirmPreview();
    assert.equal(env.store.owehBreedCampaign.active, true);
    assert.ok(env.store.owehBreedCampaign.confirmedAt > 0);
    assert.equal(env.store.owehBreedQueue.length, 2, "the pair limit trims the queue");
    assert.equal(env.store.owehBreedPreview, null);
    assert.deepEqual(env.log.claims, [["breed", "https://ovipets.com/#!/?src=pets&sub=overview"]]);
    assert.equal(env.log.breedCalls.length, 0, "confirming only claims the worker");

    await env.api.startWorker(9, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.catalogScans, 0, "a confirmed campaign is executed, not re-planned");
    assert.deepEqual(env.log.breedCalls[0].slice(0, 2), ["10", "20"]);
  }

  // A stale preview, or a busy worker, never starts breeding; busy keeps the plan.
  {
    const stale = setup({ extraStore: { owehBreedPreview: { createdAt: 1_000_000 - 16 * 60_000, queue: [{ id: "10", maleId: "20" }] } } });
    await stale.api.confirmPreview();
    assert.equal(stale.store.owehBreedCampaign.active, false);
    assert.equal(stale.store.owehBreedPreview, null);
    assert.equal(stale.log.claims.length, 0);

    const preview = { createdAt: 1_000_000, queue: [{ id: "10", maleId: "20" }], strategy: "pure-line" };
    const busy = setup({ extraStore: { owehBreedPreview: preview }, claimResult: { ok: false, reason: "busy", owner: "sweep" } });
    await busy.api.confirmPreview();
    assert.equal(busy.store.owehBreedCampaign.active, false);
    assert.equal(busy.store.owehBreedPreview.queue.length, 1, "a refused claim keeps the plan for later");
    assert.ok(busy.log.status.at(-1).includes("busy"));

    const running = setup({ campaign: { active: true, confirmedAt: 1, femaleIndex: 0, bredCount: 0 } });
    await running.api.requestStart("pure-line");
    assert.equal(running.log.claims.length, 0, "planning never starts over a running campaign");

    await busy.api.stop();
    assert.equal(busy.store.owehBreedPreview, null, "Stop withdraws an unconfirmed plan");
  }

  // The pair limit is a non-negative integer; 0 means every pair.
  {
    const env = setup();
    assert.equal(await env.api.setPairLimit("5.7"), 5);
    assert.equal(await env.api.setPairLimit("-3"), 0);
    assert.equal(await env.api.setPairLimit("abc"), 0);
    assert.equal(env.store.owehBreedPairLimit, 0);
  }

  console.log("breeding feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
