"use strict";

// Behavior of each one-button job (jobs/catalog|profiles|sort|feed|ninja|requests.js) against
// stub helpers: each job does only its own thing, reads the database instead of scanning, and
// stops cooperatively. A separate file per job is the point — a failure here names the area.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FILES = ["core.js", "runner.js", "catalog.js", "profiles.js", "sort.js", "feed.js", "ninja.js", "requests.js"];

// The profiles job keeps the historical "index" owner name used by the navigation driver.
const OWNER = { catalog: "catalog", profiles: "index", sort: "sort", feed: "feed", ninja: "ninja", requests: "requests" };

function setup(initial = {}, legacyOverrides = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const log = { statuses: [], done: 0, phases: [], navigations: [], fed: [], requested: [], moved: [], sleeps: 0 };
  const helpers = {
    storageGet: async (key, fallback) => (key in store ? JSON.parse(JSON.stringify(store[key])) : fallback),
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") store.owehPets = { ...(store.owehPets || {}), ...JSON.parse(JSON.stringify(value)) };
        else store[key] = JSON.parse(JSON.stringify(value));
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
      isPetsOverview: legacyOverrides.isPetsOverview || (() => true),
      isOviPetsChatPage: legacyOverrides.isOviPetsChatPage || (() => true),
      navigateTo: path => log.navigations.push(path),
      petProfilePath: (id, userId) => userId ? `?usr=${userId}&pet=${id}` : `?pet=${id}`
    },
    domain: {
      colors: { suggestedPetName: pet => pet.expectedName || null },
      petRecord: {
        petProfileNeedsRefresh: legacyOverrides.petProfileNeedsRefresh || (() => false),
        isCompletePetRecord: pet => Boolean(pet?.complete),
        databaseMetaFor: (pets, catalog, stale, now) => ({ catalogAt: now, catalogCount: catalog.length, stale })
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
      feedPet: legacyOverrides.feedPet || (async id => { log.fed.push(id); return { ok: true }; }),
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
      waitForOverviewShell: async () => true,
      collectAllOverviewPets: legacyOverrides.collectAllOverviewPets || (async () => []),
      updateRetentionRanking: async () => {},
      setOwnUserId: id => { store.__ownUserId = id; },
      getOwnUserId: () => store.__ownUserId || null
    },
    profileIndexService: {
      stopPetIndexCampaign: async () => {},
      stopPetIndexCampaignLocal: () => {}
    },
    ninjaService: {
      performNinjaChatScan: legacyOverrides.performNinjaChatScan || (async () => [{ id: "9" }])
    }
  };

  const sandbox = vm.createContext({ console, Promise, Date, Object, Array, Set, Map, JSON, Math, Number, String, Boolean });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
  }
  sandbox.OWEH.boot(helpers);
  return {
    store, log,
    start: job => sandbox.OWEH.collect("workerHandlers")[OWNER[job]].start(1, {}),
    stop: job => sandbox.OWEH.collect("workerHandlers")[OWNER[job]].stop(),
    buttons: sandbox.OWEH.collect("buttons")
  };
}

const HOUR = 60 * 60 * 1000;

(async () => {
  // Every job exposes exactly one Start and one Stop button and its own worker handler.
  {
    const { buttons } = setup();
    for (const job of ["catalog", "profiles", "sort", "feed", "ninja", "requests"]) {
      assert.ok(buttons[`#oweh-${job}-start`], `${job}: missing Start button`);
      assert.ok(buttons[`#oweh-${job}-stop`], `${job}: missing Stop button`);
    }
  }

  // ---- feed: only pets that need food; database only; cooperative stop --------------------
  {
    const now = Date.now();
    const env = setup({
      owehPets: {
        1: { id: "1", owned: true, name: "hungry" },
        2: { id: "2", owned: true, name: "full", foodPercent: 100, foodCheckedAt: now - HOUR },
        3: { id: "3", owned: true, name: "recent", lastFedAt: now - HOUR },
        4: { id: "4", owned: false, name: "not mine" },
        5: { id: "5", owned: true, present: false, name: "gone" }
      }
    });
    await env.start("feed");
    assert.deepEqual([...env.log.fed], ["1"], "only the hungry owned pet is fed");
    assert.equal(env.store.owehPets["1"].foodPercent, undefined, "dispatch must not be persisted as confirmed full food state");
    assert.ok(env.store.owehPets["1"].feedDispatchedAt > 0, "dispatch timestamp should provide only a short retry guard");
    assert.ok(env.store.owehLastFeedAt > 0);
    assert.equal(env.log.done, 1);
    assert.equal(env.log.navigations.length, 0, "feeding must not navigate anywhere");

    env.log.fed.length = 0;
    await env.start("feed");
    assert.deepEqual([...env.log.fed], [], "a recent dispatch should not be duplicated immediately while confirmation catches up");
  }
  {
    const pets = {};
    for (let id = 1; id <= 5; id += 1) pets[id] = { id: String(id), owned: true, name: `p${id}` };
    let env;
    env = setup({ owehPets: pets }, {
      feedPet: async id => { env.log.fed.push(id); env.stop("feed"); return { ok: true }; }
    });
    await env.start("feed");
    assert.equal(env.log.fed.length, 1, "Stop must halt feeding after the current pet");
    assert.equal(env.log.done, 0, "a stopped job leaves releasing to the Stop request");
  }
  {
    const env = setup({});
    await env.start("feed");
    assert.ok(env.log.statuses.some(text => text.includes("run Update pet catalog first")));
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

  // ---- sort: only the focus species, only pets not already in place ------------------------
  {
    const env = setup({
      owehEnclosureIds: { "FF ** **": "3", Males: "9" },
      owehPets: {
        1: { id: "1", owned: true, name: "a", species: "Dragon", enclosure: "FF ** **", wants: "FF ** **" },
        2: { id: "2", owned: true, name: "b", species: "Dragon", enclosure: "Newborn", wants: "FF ** **" },
        3: { id: "3", owned: true, name: "c", species: "Dragon", enclosure: "Newborn", wants: "Males" },
        4: { id: "4", owned: true, name: "d", species: "Wolf", enclosure: "Newborn", wants: "Males" }
      }
    });
    await env.start("sort");
    assert.deepEqual(env.log.moved.map(pair => pair.join(">")), ["2>FF ** **", "3>Males"], "pets already in place and other species are left alone");
    assert.equal(env.store.owehPets["2"].enclosure, "FF ** **");
  }
  {
    const env = setup({ owehPets: { 1: { id: "1", owned: true } } });
    await env.start("sort");
    assert.equal(env.log.moved.length, 0);
    assert.ok(env.log.statuses.some(text => text.includes("run Update pet catalog first")));
  }

  // ---- catalog: writes the database, flags stale profiles, opens no profile ----------------
  {
    const catalog = [
      { id: "1", name: "new", usr: "77", enclosure: "A", enclosureId: 1, modified: "5" },
      { id: "2", name: "kept", usr: "77", enclosure: "A", enclosureId: 1, modified: "8" }
    ];
    const env = setup({
      owehPets: {
        2: { id: "2", owned: true, present: true, catalogModified: "8", profileStale: true },
        3: { id: "3", owned: true, present: true, name: "vanished" }
      }
    }, {
      collectAllOverviewPets: async () => catalog,
      petProfileNeedsRefresh: (cached, item) => !cached && item.id === "1"
    });
    await env.start("catalog");
    assert.equal(env.store.owehPets["1"].profileStale, true, "a new pet needs its profile read");
    assert.equal(env.store.owehPets["2"].profileStale, true, "an unresolved stale flag survives later catalog runs");
    assert.equal(env.store.owehPets["3"].present, false, "a pet missing from every enclosure is marked absent");
    assert.equal(env.store.owehOwnUserId, "77");
    assert.equal(env.store.owehDatabaseMeta.stale, 2);
    assert.equal(env.log.navigations.length, 0, "the catalog job opens no pet profile");
    assert.equal(env.log.done, 1);
  }
  {
    const env = setup({}, { collectAllOverviewPets: async () => [] });
    await env.start("catalog");
    assert.ok(env.log.statuses.some(text => text.includes("nothing was changed")));
    assert.equal(env.store.owehPets, undefined, "an empty scan must never wipe the database");
  }

  // A partial scan (fewer enclosures than before) must not mark unscanned pets as gone.
  {
    let env;
    env = setup({
      owehEnclosureIds: { A: "1", B: "2", C: "3" },
      owehPets: { 7: { id: "7", owned: true, present: true, name: "in unscanned enclosure" } }
    }, {
      collectAllOverviewPets: async () => {
        env.store.owehEnclosureIds = { A: "1" };
        return [{ id: "1", name: "seen", usr: "77", enclosure: "A", enclosureId: 1 }];
      }
    });
    await env.start("catalog");
    assert.equal(env.store.owehPets["7"].present, true, "pets in unscanned enclosures are unknown, not gone");
    assert.ok(env.log.statuses.some(text => text.includes("only part of the enclosures loaded")));
  }

  // Stop pressed while the profile job was still reading the database must not leave an
  // active owehPetIndex behind.
  {
    let env;
    env = setup({ owehPets: { 1: { id: "1", owned: true, complete: false, name: "x" } } });
    const originalGet = env.store;
    const running = env.start("profiles");
    env.stop("profiles");
    await running;
    assert.equal(originalGet.owehPetIndex, undefined, "a stopped profile job must not write the active flag");
    assert.equal(env.log.navigations.length, 0);
  }

  // ---- profiles: queue comes from the database; driver reports completion ------------------
  {
    const env = setup({
      owehAutoRename: true,
      owehPets: {
        1: { id: "1", owned: true, complete: true, name: "ok" },
        2: { id: "2", owned: true, complete: true, name: "old", profileStale: true },
        3: { id: "3", owned: true, complete: false, name: "incomplete" },
        4: { id: "4", owned: true, complete: true, name: "wrong", expectedName: "FFFFFF-FF0000-000000" },
        5: { id: "5", owned: false, complete: false }
      }
    });
    await env.start("profiles");
    assert.equal(env.store.owehPetScanQueue.map(item => item.id).join(","), "2,3,4");
    assert.equal(env.store.owehPetIndex.active, true);
    assert.equal(env.log.navigations[0], "?pet=2", "starts at the first stale profile");
    assert.equal(env.log.done, 0, "the navigation driver reports completion, not the job");
  }
  {
    const env = setup({ owehAutoRename: false, owehPets: { 1: { id: "1", owned: true, complete: true, name: "x", expectedName: "y" } } });
    await env.start("profiles");
    assert.equal(env.store.owehPetIndex, undefined, "nothing stale means nothing is started");
    assert.equal(env.log.done, 1);
  }
  {
    const env = setup({});
    await env.start("profiles");
    assert.ok(env.log.statuses.some(text => text.includes("run Update pet catalog first")));
    assert.equal(env.log.done, 1);
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
