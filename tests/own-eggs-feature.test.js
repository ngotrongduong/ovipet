"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({ hash = "#!/?src=pets&sub=hatchery", eggs = [], hatchable = [], hatchlingActive = false, claimOk = true } = {}) {
  const clock = { now: 1000000 };
  const store = {
    owehEggRun: { active: false, hatchery: "", count: 0, attempts: {}, batchId: null },
    owehHatchlingRun: { active: hatchlingActive, phase: "scan", index: 0 }
  };
  const page = {
    hash,
    eggs: eggs.map(egg => ({ ...egg })),
    hatchable: hatchable.map(egg => ({ ...egg }))
  };
  const log = { status: [], opened: [], hatches: [], reloads: 0, releases: [], claims: [], taskReleases: [], running: [], stops: [] };
  let currentBatch = null;
  const helpers = {
    storageGet: async (key, fallback) => key in store ? JSON.parse(JSON.stringify(store[key])) : fallback,
    storageSet: async values => { for (const [key, value] of Object.entries(values)) store[key] = JSON.parse(JSON.stringify(value)); },
    sleep: async ms => { clock.now += Number(ms || 0); await Promise.resolve(); },
    setStatus: text => log.status.push(text),
    runtimeRequest: async message => {
      if (message.type === "eggBatchOpen") {
        log.opened.push(JSON.parse(JSON.stringify(message)));
        currentBatch = { id: message.batchId, eggs: message.eggs.map(egg => egg.id) };
        return { ok: true, expected: message.eggs.length };
      }
      if (message.type === "eggBatchStatus") {
        if (!currentBatch || currentBatch.id !== message.batchId) return { ok: false, reason: "unknown-batch" };
        page.eggs = page.eggs.filter(egg => !currentBatch.eggs.includes(egg.id));
        return { ok: true, expected: currentBatch.eggs.length, turned: currentBatch.eggs.length, already: 0, failed: 0, open: 0, done: true };
      }
      if (message.type === "eggBatchStop") { log.stops.push(message.source || null); return { ok: true, closed: 0 }; }
      if (message.type === "eggBatchExpire") return { ok: true };
      return { ok: false, reason: "unexpected" };
    },
    requestReleaseWorker: async owner => { log.releases.push(owner); return { ok: true }; },
    claimTask: async (id, detail) => { log.claims.push([id, detail]); return claimOk; },
    releaseTask: async (id, status) => { log.taskReleases.push([id, status]); return { ok: true }; },
    routes: {
      isOwnHatchery: () => /src=pets&sub=hatchery/.test(page.hash) && !/[?&]usr=\d+/.test(page.hash)
    },
    hatcheryDom: {
      getHatcheryEggs: () => page.eggs.map(egg => ({ ...egg })),
      getHatcheryHatchableEggs: () => page.hatchable.map(egg => ({ ...egg }))
    },
    gameActions: {
      hatchOwnEgg: async id => {
        log.hatches.push(String(id));
        page.hatchable = page.hatchable.filter(egg => String(egg.id) !== String(id));
        return { ok: true, reason: "dispatched" };
      }
    },
    settings: { getPageLoadDelayMs: () => 0 },
    pageActions: { currentHash: () => page.hash, reloadPage: () => { log.reloads += 1; } },
    ownEggsService: {
      ownerInstance: "instance-1",
      getCurrentTabId: () => 42,
      ownedByThisTab: state => state?.ownerTabId == null || Number(state.ownerTabId) === 42,
      setRunning: value => log.running.push(Boolean(value))
    }
  };

  const sandbox = vm.createContext({ console: { error() {} }, Promise, Date: { now: () => clock.now }, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/own-eggs.js"), "utf8"), sandbox, { filename: "own-eggs.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-own-eggs"].api, store, page, log, clock };
}

(async () => {
  {
    const env = setup({ eggs: [{ id: "1", href: "?pet=1" }], hatchlingActive: true, claimOk: false });
    await env.api.start();
    assert.equal(env.store.owehHatchlingRun.active, false);
    assert.equal(env.store.owehHatchlingRun.phase, "interrupted-for-eggs");
    assert.deepEqual(env.log.releases, ["hatchlings"]);
    assert.equal(env.store.owehEggRun.active, false);
  }

  {
    const env = setup({ eggs: [], hatchlingActive: true });
    await env.api.start();
    assert.ok(env.log.status.some(text => text.includes("Stop Hatchling processing")));
    assert.equal(env.log.claims.length, 0);
  }

  // Own eggs are opened in real profile tabs, max 10 per batch; no hidden Turn Egg command exists here.
  {
    const env = setup({ eggs: [{ id: "10", href: "?pet=10" }, { id: "11", href: "?pet=11" }] });
    env.store.owehEggRun = { active: true, hatchery: env.page.hash, count: 0, attempts: {}, batchId: null, ownerInstance: "instance-1", ownerTabId: 42 };
    await env.api.process();
    assert.equal(env.log.opened.length, 1);
    assert.equal(env.log.opened[0].source, "own");
    assert.deepEqual(env.log.opened[0].eggs.map(egg => egg.id), ["10", "11"]);
    assert.equal(env.store.owehEggRun.count, 2);
    assert.equal(env.log.reloads, 1);
  }

  // Hatch-ready OWN eggs use the dedicated visible-UI dispatcher path directly from Hatchery.
  // No profile tab is opened and the same job reloads once to verify the resulting Hatchery.
  {
    const env = setup({
      hatchable: [{ id: "30", href: "?pet=30" }, { id: "31", href: "?pet=31" }]
    });
    env.store.owehEggRun = {
      active: true, hatchery: env.page.hash, count: 0, hatched: 0,
      attempts: {}, hatchAttempts: {}, hatchDispatched: {}, batchId: null,
      ownerInstance: "instance-1", ownerTabId: 42
    };
    await env.api.process();
    assert.deepEqual(env.log.hatches, ["30", "31"]);
    assert.equal(env.log.opened.length, 0);
    assert.equal(env.store.owehEggRun.hatched, 2);
    assert.equal(env.log.reloads, 1);

    await env.api.process();
    assert.equal(env.store.owehEggRun.active, false);
    assert.ok(env.log.status.some(text => text.includes("hatch commands sent 2")));
  }

  // Browsing ANY friend Hatchery must never auto-start egg turning, even when no sweep is active.
  {
    const env = setup({
      hash: "#!/?src=pets&sub=hatchery&usr=555",
      eggs: [{ id: "20", href: "?usr=555&pet=20" }],
      hatchable: [{ id: "21", href: "?usr=555&pet=21" }]
    });
    await env.api.maybeAutoStart();
    assert.equal(env.log.claims.length, 0);
    assert.equal(env.log.opened.length, 0);
    assert.equal(env.log.hatches.length, 0);
  }

  // Manual Start on a friend Hatchery is refused too; friend eggs belong to Full Sweep only.
  {
    const env = setup({
      hash: "#!/?src=pets&sub=hatchery&usr=555",
      eggs: [{ id: "20", href: "?usr=555&pet=20" }],
      hatchable: [{ id: "21", href: "?usr=555&pet=21" }]
    });
    await env.api.start();
    assert.equal(env.log.claims.length, 0);
    assert.ok(env.log.status.some(text => text.includes("Friend eggs are handled only by Start full sweep")));
    assert.equal(env.log.hatches.length, 0);
  }

  {
    const env = setup();
    env.store.owehEggRun = { active: true, hatchery: env.page.hash, count: 3, attempts: {}, batchId: null, ownerInstance: "instance-1", ownerTabId: 42 };
    await env.api.stop("stopped-test");
    assert.equal(env.store.owehEggRun.active, false);
    assert.equal(env.store.owehAutoTurn, false);
    assert.deepEqual(env.log.stops, ["own"]);
    assert.deepEqual(env.log.taskReleases[0], ["egg-run", "stopped"]);
  }

  console.log("own egg feature UI-tab behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
