"use strict";

// Behavior of services/status.js, services/partner-ranking.js and services/worker-control.js,
// driven through their factories with fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = value => JSON.parse(JSON.stringify(value));

function load(file, extra = {}) {
  const context = { OWEH: {}, console, Date, setInterval, clearInterval, ...extra };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "services", file), "utf8"), context);
  return context.OWEH.services;
}

(async () => {
  // ---- status -------------------------------------------------------------------------------
  {
    const el = { textContent: "" };
    const logs = [];
    const writes = [];
    let released = 0;
    let owner = null;
    const { status } = load("status.js", { document: { querySelector: selector => (selector === "#oweh-status" ? el : null) } });
    const { setStatus, reportWorkerDone } = status.createStatus({
      diagnosticLog: (...args) => logs.push(args),
      storageSet: async values => { writes.push(values); },
      workerClient: { getOwner: () => owner },
      releaseFinishedWorker: () => { released += 1; }
    });

    setStatus("Sorted 12 pets, 0 failed, 0 timed out");
    assert.equal(el.textContent, "Sorted 12 pets, 0 failed, 0 timed out");
    assert.equal(logs.length, 0, "zero-count failures are not alerts");
    setStatus("Feed stopped: 2 failed");
    setStatus("Feed stopped: 2 failed");
    assert.equal(logs.length, 1, "the same alert is logged once");
    assert.deepEqual(plain(logs[0]), ["warning", "status", "status.alert", { text: "Feed stopped: 2 failed" }]);

    reportWorkerDone();
    assert.equal(writes.length, 0, "no notice without a worker owner");
    assert.equal(released, 1);
    owner = "feed";
    setStatus("No breedable females");
    reportWorkerDone();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].owehSweepNotice.text, "No breedable females");
    assert.equal(released, 2);
  }

  // ---- partner-ranking ----------------------------------------------------------------------
  {
    const makeAnchor = onclick => {
      const children = [];
      return { style: {}, children, getAttribute: () => onclick, appendChild: node => children.push(node) };
    };
    const anchors = [
      makeAnchor("ui_action_cmdExec('pet_breed', 'MotherID=1&FatherID=2')"),
      makeAnchor("ui_action_cmdExec('pet_breed', 'MotherID=1&FatherID=3')"),
      makeAnchor("ui_action_cmdExec('pet_breed', 'MotherID=1&FatherID=4')")
    ];
    const selectors = [];
    const document = {
      querySelector: selector => { selectors.push(selector); return anchors[0]; },
      querySelectorAll: selector => (selector.includes("pet_breed") ? anchors : []),
      createElement: () => ({ className: "", textContent: "" })
    };
    const statuses = [];
    let parent = { id: "1" };
    const pets = { 2: { id: "2", name: "Near", d: 5 }, 3: { id: "3", name: "Kin", d: 1 }, 4: { id: "4", name: "Far", d: 9 } };
    const { partnerRanking } = load("partner-ranking.js", { document });
    assert.equal(partnerRanking.BREEDING_CANDIDATE_SELECTOR, "section#breeding a[onclick*=\"ui_action_cmdExec('pet_breed'\"]");
    const service = partnerRanking.createPartnerRanking({
      storageGet: async () => pets,
      setStatus: text => statuses.push(text),
      readPet: () => parent,
      rgb: hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)],
      petPureMetrics: () => ({ exactChannels: 2, usedChannels: 3, distance: 7 }),
      petOffTarget: () => 0,
      pairPureMetrics: (a, b) => ({
        distance: b.d, purePossible: true, pureProbability: 0.5, reachableChannels: 3, usedChannels: 3,
        body1ReachableChannels: 3, body1NewExactChannels: 1, lockedChannels: 2
      }),
      comparePairPureMetrics: (a, b) => a.pure.distance - b.pure.distance,
      formatPureProbability: p => `${p * 100}% pure`,
      ancestorsOverlap: (a, b) => b.id === "3",
      STRICT_PURE_TARGET: { body1: "000000" }
    });

    assert.deepEqual(plain(service.hatchMaleMetrics({ colors: { body1: "00FF10" } }, {})), {
      targetExact: 2, targetUsed: 3, targetDistance: 7, extremeExact: 2, extremeDistance: 16
    });
    assert.deepEqual(plain(service.breedingCandidates("1").map(item => item.otherId)), ["2", "3", "4"]);
    assert.equal(service.hasBreedingCandidates(), true);
    assert.equal(selectors[0], partnerRanking.BREEDING_CANDIDATE_SELECTOR);

    await service.rankPartners();
    assert.equal(statuses.at(-1), "Best indexed partner: Near", "the inbred closer partner is skipped");
    assert.equal(anchors[1].style.outline, "3px solid #d9534f");
    assert.equal(anchors[1].children[0].className, "oweh-warning");
    assert.equal(anchors[0].children[0].className, "oweh-recommended");
    assert.match(anchors[0].children[0].textContent, /Body 1 3\/3 reachable, \+1 new FF · 50% pure · 2 locked/);

    parent = null;
    await service.rankPartners();
    assert.equal(statuses.at(-1), "Open the parent profile with its Colors table visible");
  }

  // ---- worker-control -----------------------------------------------------------------------
  {
    const { workerControl } = load("worker-control.js");
    const make = (overrides = {}) => {
      const calls = [];
      const requests = [];
      const statuses = [];
      const logs = [];
      let owner = null;
      const resyncs = [];
      const service = workerControl.createWorkerControl({
        runtimeRequest: async message => {
          requests.push(message);
          return overrides.workerStatus && message.type === "getWorkerStatus" ? overrides.workerStatus : { ok: true };
        },
        storageGetMany: async () => ({ owehEggRun: overrides.eggRun || { active: false } }),
        workerClient: {
          getOwner: () => owner,
          resync: (o, g) => resyncs.push([o, g]),
          heartbeatSharedWorker: async () => calls.push("heartbeat"),
          handleStartMessage: (message, handler) => calls.push(["start", message.owner, handler.start.name || "fn"]),
          handleStopMessage: (message, handler) => calls.push(["stop", message.owner, Boolean(handler)])
        },
        releaseFinishedWorker: () => calls.push("releaseFinished"),
        requestReleaseWorker: async () => calls.push("releaseWorker"),
        diagnosticLog: (...args) => logs.push(args),
        setStatus: text => statuses.push(text),
        instanceId: "me",
        getCurrentTabId: () => overrides.tabId ?? 5,
        stops: {
          stopFriendSweep: async () => calls.push("sweep"),
          stopBreedCampaign: async () => calls.push("breed"),
          stopPetIndex: async () => calls.push("petIndex"),
          stopHatchlings: async () => calls.push("hatchlings"),
          stopOwnEggs: async () => calls.push("ownEggs")
        },
        localWorkerHandlers: { sweep: { start: function sweepStart() {}, stop: () => {} } },
        collectWorkerHandlers: () => ({ feed: { start: function feedStart() {}, stop: () => {} } }),
        recoverSweepWorker: async () => calls.push("recoverSweep"),
        onEggBatchProgress: message => calls.push(["eggBatch", message.done]),
        goToNextFriend: () => calls.push("nextFriend")
      });
      return { service, calls, requests, statuses, logs, resyncs, setOwner: value => { owner = value; } };
    };

    // ownedByThisTab prefers the tab id, then falls back to the panel instance.
    {
      const { service } = make();
      assert.equal(service.ownedByThisTab({ ownerTabId: 5 }), true);
      assert.equal(service.ownedByThisTab({ ownerTabId: 6, ownerInstance: "me" }), false);
      assert.equal(service.ownedByThisTab({ ownerInstance: "me" }), true);
      assert.equal(service.ownedByThisTab({ ownerInstance: "other" }), false);
      assert.equal(service.ownedByThisTab({}), true);
    }

    // Stop All calls each feature's stop in order, then the generic releases.
    {
      const { service, calls, requests, statuses, logs } = make();
      await service.stopAllAutomation();
      assert.deepEqual(calls, ["sweep", "breed", "petIndex", "hatchlings", "ownEggs", "releaseWorker"]);
      assert.deepEqual(plain(requests), [{ type: "eggBatchStop" }]);
      assert.equal(logs[0][2], "automation.stop-all");
      assert.match(statuses.at(-1), /^Stop All:/);
    }

    // Heartbeat reports an owned egg run and always renews the shared worker.
    {
      const { service, calls, requests } = make({ eggRun: { active: true, ownerTabId: 5 } });
      await service.sendTaskHeartbeat();
      assert.deepEqual(plain(requests), [{ type: "taskHeartbeat", ids: ["egg-run"] }]);
      assert.deepEqual(calls, ["heartbeat"]);
      const other = make({ eggRun: { active: true, ownerTabId: 9 } });
      await other.service.sendTaskHeartbeat();
      assert.deepEqual(other.requests, []);
      const stop = service.startHeartbeat(() => false, 100000);
      assert.equal(typeof stop, "function");
      stop();
    }

    // Runtime message routing.
    {
      const { service, calls, resyncs, logs } = make();
      const responses = [];
      service.handleRuntimeMessage({ type: "startSharedWorker", owner: "sweep" });
      service.handleRuntimeMessage({ type: "startSharedWorker", owner: "feed" });
      service.handleRuntimeMessage({ type: "startSharedWorker", owner: "unknown" });
      service.handleRuntimeMessage({ type: "stopSharedWorker", owner: "unknown" });
      service.handleRuntimeMessage({ type: "recoverSharedWorker", owner: "sweep", generation: 3 }, null, r => responses.push(r));
      service.handleRuntimeMessage({ type: "eggBatchProgress", done: 4 });
      service.handleRuntimeMessage({ type: "goToNextFriendFromBackground" });
      assert.deepEqual(plain(calls), [
        ["start", "sweep", "sweepStart"], ["start", "feed", "feedStart"], ["stop", "unknown", false],
        "recoverSweep", ["eggBatch", 4], "nextFriend"
      ]);
      assert.deepEqual(plain(resyncs), [["sweep", 3]]);
      assert.deepEqual(plain(responses), [{ ok: true }]);
      assert.equal(logs[0][2], "worker.recovery-received");
    }

    // Recovery after a reload releases an orphaned one-button job, but not while it is starting.
    {
      const orphan = make({ workerStatus: { ok: true, active: true, worker: { tabId: 5, owner: "maintain", generation: 2, phase: "running" } } });
      await orphan.service.recoverAfterReload();
      assert.deepEqual(plain(orphan.resyncs), [["maintain", 2]]);
      assert.deepEqual(orphan.calls, ["releaseFinished"]);
      assert.equal(orphan.statuses[0], "\"Update database\" was interrupted by a page reload and released the shared background tab — press its button again");

      const starting = make({ workerStatus: { ok: true, active: true, worker: { tabId: 5, owner: "maintain", generation: 2, phase: "starting" } } });
      await starting.service.recoverAfterReload();
      assert.deepEqual(starting.calls, []);
      assert.equal(starting.resyncs.length, 1);

      const feature = make({ workerStatus: { ok: true, active: true, worker: { tabId: 5, owner: "sweep", generation: 2, phase: "running" } } });
      await feature.service.recoverAfterReload();
      assert.deepEqual(feature.calls, [], "features with a progress record resume instead of being released");

      const otherTab = make({ workerStatus: { ok: true, active: true, worker: { tabId: 8, owner: "maintain", generation: 2, phase: "running" } } });
      await otherTab.service.recoverAfterReload();
      assert.equal(otherTab.resyncs.length, 0);
    }
  }

  console.log("content services tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
