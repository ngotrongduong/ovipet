"use strict";

// Behavior of each one-button job (jobs/maintain|ninja|requests.js) against stub helpers:
// each job does only its own thing, reads the database or fetched panels instead of
// navigating, and stops cooperatively. "Update database" (maintain) is tested step by step:
// every step can run alone through owehMaintainSteps.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FILES = ["core.js", "runner.js", "maintain.js", "ninja.js", "requests.js"];
const ONLY = step => ({ catalog: false, profiles: false, sort: false, feed: false, [step]: true });

function setup(initial = {}, overrides = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const log = { statuses: [], done: 0, phases: [], navigations: [], fed: [], requested: [], moved: [], renamed: [], reads: [], sleeps: 0, ranking: 0 };
  const helpers = {
    storageGet: async (key, fallback) => (key in store ? JSON.parse(JSON.stringify(store[key])) : fallback),
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") {
          const merged = { ...(store.owehPets || {}) };
          for (const [id, pet] of Object.entries(JSON.parse(JSON.stringify(value)))) merged[id] = { ...(merged[id] || {}), ...pet };
          store.owehPets = merged;
        } else store[key] = JSON.parse(JSON.stringify(value));
      }
    },
    sleep: async () => { log.sleeps += 1; },
    setStatus: text => log.statuses.push(text),
    reportWorkerPhase: text => log.phases.push(text),
    reportWorkerDone: () => { log.done += 1; },
    waitForGameReady: async () => true,
    requestClaimWorker: async () => ({ ok: true }),
    requestReleaseWorker: async () => ({ ok: true }),
    routes: {
      isPetsOverview: () => true,
      isOviPetsChatPage: overrides.isOviPetsChatPage || (() => true),
      navigateTo: target => log.navigations.push(target),
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`
    },
    domain: {
      colors: { suggestedPetName: pet => pet.expectedName || null },
      petRecord: {
        petProfileNeedsRefresh: overrides.petProfileNeedsRefresh || (() => false),
        isCompletePetRecord: pet => Boolean(pet?.complete),
        databaseMetaFor: (pets, catalog, stale, now) => ({ catalogAt: now, catalogCount: catalog.length, stale, completeProfiles: 0, missingProfiles: stale })
      },
      breedingPlan: {
        DEFAULT_BREEDING_STOCK_MAX_DISTANCE: 96,
        isBreedingProgramEnclosure: name => /^FF/.test(String(name || "")),
        desiredProgramEnclosure: pet => pet.wants || null,
        normalizeEnclosureLabel: value => String(value || "").replace(/\s+/g, "").toUpperCase()
      }
    },
    gameActions: {
      fastMovePetToEnclosure: async (id, target) => { log.moved.push([id, target]); return { moved: true }; },
      feedPet: overrides.feedPet || (async id => { log.fed.push(id); return { ok: true }; }),
      namePet: async (id, name, options) => { log.renamed.push([id, name, Boolean(options?.unnamed)]); return { ok: true }; },
      requestFriend: async id => { log.requested.push(id); return { ok: true }; }
    },
    settings: {
      getDelayMs: () => 0,
      getPageLoadDelayMs: () => 0,
      RECENT_FULL_FOOD_MS: 20 * 60 * 60 * 1000,
      PET_FEED_DELAY_MS: 100,
      DEFAULT_REQUEST_DELAY: 100
    },
    catalogService: {
      updateRetentionRanking: async () => { log.ranking += 1; },
      setOwnUserId: id => { if (id) store.__ownUserId = id; },
      getOwnUserId: () => store.__ownUserId || null
    },
    petFetch: {
      collectCatalog: overrides.collectCatalog || (async () => ({ catalog: [], partial: true })),
      readPet: overrides.readPet || (async id => {
        log.reads.push(id);
        return {
          ok: true,
          profile: { unnamed: false, canRename: true, enclosureId: "3", enclosureLabel: "FF ** **" },
          record: { id, name: `fresh${id}`, complete: true, pedigreeVerified: true, foodPercent: 100, foodCheckedAt: Date.now() }
        };
      }),
      mergePetRecord: (previous, record) => ({ ...(previous || {}), ...record })
    },
    ninjaService: {
      performNinjaChatScan: overrides.performNinjaChatScan || (async () => [{ id: "9" }])
    }
  };

  const sandbox = vm.createContext({ console, Promise, Date, Object, Array, Set, Map, JSON, Math, Number, String, Boolean });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
  }
  sandbox.OWEH.boot(helpers);
  return {
    store, log,
    start: owner => sandbox.OWEH.collect("workerHandlers")[owner].start(1, {}),
    stop: owner => sandbox.OWEH.collect("workerHandlers")[owner].stop(),
    buttons: sandbox.OWEH.collect("buttons")
  };
}

const HOUR = 60 * 60 * 1000;

(async () => {
  // Every job exposes exactly one Start and one Stop button and its own worker handler.
  {
    const { buttons } = setup();
    for (const job of ["maintain", "ninja", "requests"]) {
      assert.ok(buttons[`#oweh-${job}-start`], `${job}: missing Start button`);
      assert.ok(buttons[`#oweh-${job}-stop`], `${job}: missing Stop button`);
    }
    for (const retired of ["catalog", "profiles", "sort", "feed"]) {
      assert.equal(buttons[`#oweh-${retired}-start`], undefined, `${retired} is a step of Update database now`);
    }
  }

  // ---- feed step: only pets that need food; database only; cooperative stop --------------
  {
    const now = Date.now();
    const env = setup({
      owehMaintainSteps: ONLY("feed"),
      owehPets: {
        1: { id: "1", owned: true, name: "hungry" },
        2: { id: "2", owned: true, name: "full", foodPercent: 100, foodCheckedAt: now - HOUR },
        3: { id: "3", owned: true, name: "recent", lastFedAt: now - HOUR },
        4: { id: "4", owned: false, name: "not mine" },
        5: { id: "5", owned: true, present: false, name: "gone" }
      }
    });
    await env.start("maintain");
    assert.deepEqual([...env.log.fed], ["1"], "only the hungry owned pet is fed");
    assert.equal(env.store.owehPets["1"].foodPercent, undefined, "dispatch must not be persisted as confirmed full food state");
    assert.ok(env.store.owehPets["1"].feedDispatchedAt > 0, "dispatch timestamp should provide only a short retry guard");
    assert.equal(env.store.owehPets["1"].name, "hungry", "a partial write keeps the rest of the record");
    assert.ok(env.store.owehLastFeedAt > 0);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.navigations.length, 0, "feeding must not navigate anywhere");

    env.log.fed.length = 0;
    await env.start("maintain");
    assert.deepEqual([...env.log.fed], [], "a recent dispatch should not be duplicated immediately while confirmation catches up");
  }
  {
    const pets = {};
    for (let id = 1; id <= 5; id += 1) pets[id] = { id: String(id), owned: true, name: `p${id}` };
    let env;
    env = setup({ owehMaintainSteps: ONLY("feed"), owehPets: pets }, {
      feedPet: async id => { env.log.fed.push(id); env.stop("maintain"); return { ok: true }; }
    });
    await env.start("maintain");
    assert.equal(env.log.fed.length, 1, "Stop must halt feeding after the current pet");
    assert.equal(env.log.done, 0, "a stopped job leaves releasing to the Stop request");
  }
  {
    const env = setup({ owehMaintainSteps: ONLY("feed") });
    await env.start("maintain");
    assert.ok(env.log.statuses.some(text => text.includes("turn on the Catalog step")));
  }

  // ---- requests: skips everyone already asked; scans nothing ------------------------------
  {
    const env = setup({
      owehChatQueue: [{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }],
      owehFriendRequestHistory: { 2: { status: "dispatched" } }
    });
    await env.start("requests");
    assert.deepEqual([...env.log.requested], ["1", "3"]);
    assert.equal(env.store.owehFriendRequestHistory["1"].status, "dispatched");
    assert.equal(env.log.navigations.length, 0);
  }
  {
    const env = setup({});
    await env.start("requests");
    assert.ok(env.log.statuses.some(text => text.includes("press Scan Ninja + Ads first")));
  }

  // ---- sort step: only the focus species, only pets not already in place ------------------
  {
    const env = setup({
      owehMaintainSteps: ONLY("sort"),
      owehEnclosureIds: { "FF ** **": "3", Males: "9" },
      owehPets: {
        1: { id: "1", owned: true, name: "a", species: "Dragon", enclosure: "FF ** **", wants: "FF ** **" },
        2: { id: "2", owned: true, name: "b", species: "Dragon", enclosure: "Newborn", wants: "FF ** **" },
        3: { id: "3", owned: true, name: "c", species: "Dragon", enclosure: "Newborn", wants: "Males" },
        4: { id: "4", owned: true, name: "d", species: "Wolf", enclosure: "Newborn", wants: "Males" }
      }
    });
    await env.start("maintain");
    assert.deepEqual(env.log.moved.map(pair => pair.join(">")), ["2>FF ** **", "3>Males"], "pets already in place and other species are left alone");
    assert.equal(env.store.owehPets["2"].enclosure, "FF ** **");
    assert.equal(env.store.owehPets["2"].enclosureId, "3");
    assert.equal(env.log.ranking, 1, "moves change the breeding line, so ranking is refreshed once");
  }
  {
    const env = setup({ owehMaintainSteps: ONLY("sort"), owehPets: { 1: { id: "1", owned: true } } });
    await env.start("maintain");
    assert.equal(env.log.moved.length, 0);
    assert.ok(env.log.statuses.some(text => text.includes("no enclosure ids yet")));
  }

  // ---- catalog step: writes the database, flags stale profiles, opens no profile ----------
  {
    const catalog = [
      { id: "1", name: "new", usr: "77", enclosure: "A", enclosureId: 1, modified: "5" },
      { id: "2", name: "kept", usr: "77", enclosure: "A", enclosureId: 1, modified: "8" }
    ];
    const env = setup({
      owehMaintainSteps: ONLY("catalog"),
      owehPets: {
        2: { id: "2", owned: true, present: true, catalogModified: "8", profileStale: true },
        3: { id: "3", owned: true, present: true, name: "vanished" }
      }
    }, {
      collectCatalog: async () => ({ catalog, partial: false, ownUserId: "77" }),
      petProfileNeedsRefresh: (cached, item) => !cached && item.id === "1"
    });
    await env.start("maintain");
    assert.equal(env.store.owehPets["1"].profileStale, true, "a new pet needs its profile read");
    assert.equal(env.store.owehPets["2"].profileStale, true, "an unresolved stale flag survives later catalog runs");
    assert.equal(env.store.owehPets["3"].present, false, "a pet missing from every enclosure is marked absent");
    assert.equal(env.store.owehOwnUserId, "77");
    assert.equal(env.store.owehDatabaseMeta.stale, 2);
    assert.equal(env.log.navigations.length, 0, "the catalog step opens no pet profile");
    assert.equal(env.log.reads.length, 0, "the profile step is off");
    assert.equal(env.log.done, 1);
  }
  {
    const env = setup({ owehMaintainSteps: ONLY("catalog") });
    await env.start("maintain");
    assert.ok(env.log.statuses.some(text => text.includes("nothing changed")));
    assert.equal(env.store.owehPets, undefined, "an empty scan must never wipe the database");
  }
  // A partial scan must not mark unscanned pets as gone.
  {
    const env = setup({
      owehMaintainSteps: ONLY("catalog"),
      owehPets: { 7: { id: "7", owned: true, present: true, name: "in unscanned enclosure" } }
    }, {
      collectCatalog: async () => ({ catalog: [{ id: "1", name: "seen", usr: "77", enclosure: "A", enclosureId: 1 }], partial: true })
    });
    await env.start("maintain");
    assert.equal(env.store.owehPets["7"].present, true, "pets in unscanned enclosures are unknown, not gone");
    assert.ok(env.log.statuses.some(text => text.includes("partial")));
  }

  // ---- profiles step: queue comes from the database; renames by command -------------------
  {
    const env = setup({
      owehMaintainSteps: ONLY("profiles"),
      owehAutoRename: true,
      owehOwnUserId: "77",
      owehDatabaseMeta: { completeProfiles: 1, missingProfiles: 2 },
      owehPets: {
        1: { id: "1", owned: true, complete: true, name: "ok" },
        2: { id: "2", owned: true, complete: true, name: "old", profileStale: true },
        3: { id: "3", owned: true, complete: false, name: "incomplete" },
        4: { id: "4", owned: true, complete: true, name: "wrong", expectedName: "FFFFFF-FF0000-000000" },
        5: { id: "5", owned: false, complete: false }
      }
    });
    await env.start("maintain");
    assert.deepEqual([...env.log.reads].sort(), ["2", "3", "4"], "only stale, incomplete and wrongly named pets are read");
    assert.equal(env.store.owehPets["3"].profileStale, false);
    assert.equal(env.store.owehPets["3"].enclosure, "FF ** **", "the fetched profile owns the current enclosure");
    assert.equal(env.store.owehPets["3"].foodPercent, 100);
    assert.deepEqual(env.log.renamed.map(entry => entry.join(":")), ["4:FFFFFF-FF0000-000000:false"]);
    assert.equal(env.store.owehPets["4"].name, "FFFFFF-FF0000-000000");
    assert.equal(env.store.owehDatabaseMeta.completeProfiles, 2, "only the incomplete→complete transition counts");
    assert.equal(env.store.owehDatabaseMeta.missingProfiles, 1);
    assert.equal(env.log.navigations.length, 0, "profiles are fetched, never navigated");
    assert.equal(env.log.done, 1);
  }
  // A failed read counts as an error and leaves the record untouched.
  {
    const env = setup({
      owehMaintainSteps: ONLY("profiles"),
      owehPets: { 1: { id: "1", owned: true, complete: false, name: "x" } }
    }, { readPet: async () => ({ ok: false, reason: "profile:network" }) });
    await env.start("maintain");
    assert.equal(env.store.owehPets["1"].name, "x");
    assert.equal(env.store.owehPets["1"].lastProfileScanAt, undefined);
    assert.ok(env.log.statuses.some(text => text.includes("1 error(s)")));
  }

  // ---- whole pass: catalog feeds the profile queue, then sort and feed use fresh data -----
  {
    const env = setup({
      owehAutoRename: false,
      owehEnclosureIds: { "FF ** **": "3" }
    }, {
      collectCatalog: async () => ({ catalog: [{ id: "8", name: "n", usr: "77", enclosure: "Newborn", enclosureId: "0" }], partial: false, ownUserId: "77" }),
      petProfileNeedsRefresh: () => true
    });
    await env.start("maintain");
    assert.deepEqual([...env.log.reads], ["8"]);
    assert.equal(env.store.owehPets["8"].enclosure, "FF ** **");
    assert.equal(env.log.fed.length, 0, "a fresh profile read at 100% food is not fed again");
    assert.equal(env.log.ranking, 1);
    assert.ok(env.log.statuses.at(-1).startsWith("Update database finished"));
  }

  // ---- ninja: reads, stores, sends nothing --------------------------------------------------
  {
    let scans = 0;
    const env = setup({}, { isOviPetsChatPage: () => true, performNinjaChatScan: async () => { scans += 1; return [{ id: "1" }, { id: "2" }]; } });
    await env.start("ninja");
    assert.equal(scans, 1);
    assert.equal(env.log.requested.length, 0, "scanning must never send friend requests");
    assert.ok(env.log.statuses.some(text => text.includes("2 new commenter(s) queued")));
  }

  console.log("job behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
