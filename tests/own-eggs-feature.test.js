"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({ hash = "#!/?src=pets&sub=hatchery", eggs = [], hatchable = [], hatchlingActive = false, claimOk = true, remoteStop = false } = {}) {
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
        if (remoteStop) {
          // Another tab stopped the run (Stop All there, or the Species safety pause in an egg tab).
          store.owehEggRun = { active: false, hatchery: "", count: 0, attempts: {}, batchId: null };
          return { ok: true, expected: 1, turned: 0, already: 0, failed: 0, open: 1, done: false };
        }
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

  // A safety stop (eggs exhausted after MAX_ATTEMPTS) or a user Stop must not be undone by the
  // next Hatchery refresh; otherwise attempts reset and the same failing tabs reopen forever.
  {
    const env = setup({ eggs: [{ id: "40", href: "?pet=40" }] });
    env.store.owehEggRun = {
      active: true, hatchery: env.page.hash, count: 0, attempts: { 40: 2 }, batchId: null,
      ownerInstance: "instance-1", ownerTabId: 42
    };
    await env.api.process();
    assert.ok(env.log.status.some(text => text.includes("could not be confirmed after 2 tries")));
    assert.equal(env.store.owehEggRun.active, false);
    const claimsAfterStop = env.log.claims.length;
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, claimsAfterStop, "auto-start must stay off after a stop");
    assert.equal(env.store.owehEggRun.active, false);
    assert.equal(env.log.opened.length, 0);

    await env.api.start();
    assert.equal(env.log.claims.length, claimsAfterStop + 1, "explicit Start re-enables the run");
  }

  {
    const env = setup({ eggs: [{ id: "50", href: "?pet=50" }] });
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, 1, "fresh Hatchery open still auto-starts own eggs");
  }

  // Name-the-Species safety pause: no run starts, by itself or by the button, until Resume.
  {
    const env = setup({ eggs: [{ id: "60", href: "?pet=60" }] });
    env.store.owehSpeciesGuard = { wrongAt: [], streak: 3, paused: { at: 1, reason: "3 wrong answers in a row" } };
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, 0, "auto-start must not open eggs while paused");
    assert.equal(env.log.status.length, 0, "auto-start stays silent while paused");
    await env.api.start();
    assert.equal(env.log.claims.length, 0, "Start is refused while paused");
    assert.ok(env.log.status.at(-1).includes("paused after 3 wrong answers in a row"));
    assert.equal(env.store.owehEggRun.active, false);

    env.store.owehSpeciesGuard = { wrongAt: [], streak: 0, paused: null };
    await env.api.start();
    assert.equal(env.log.claims.length, 1, "Start works again after Resume");
  }

  // The extension updated itself and refreshed this tab: that page load starts nothing, also
  // not later in the same tab; the button still works.
  {
    const env = setup({ eggs: [{ id: "65", href: "?pet=65" }] });
    env.store.owehSelfUpdateReloadAt = env.clock.now - 5000;
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, 0, "a refresh caused by an update must not auto-start a run");
    env.clock.now += 10 * 60 * 1000;
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, 0, "and it stays that way for this page load");
    await env.api.start();
    assert.equal(env.log.claims.length, 1);
  }

  // A run stopped from another tab (the pause is seen in an egg tab) must not auto-start again
  // on this Hatchery tab's next refresh.
  {
    const env = setup({ eggs: [{ id: "70", href: "?pet=70" }], remoteStop: true });
    env.store.owehEggRun = {
      active: true, hatchery: env.page.hash, count: 0, attempts: { 70: 1 }, batchId: "own-1",
      ownerInstance: "instance-1", ownerTabId: 42
    };
    await env.api.process();
    assert.equal(env.store.owehEggRun.active, false);
    assert.equal(env.log.reloads, 0);
    await env.api.maybeAutoStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.log.claims.length, 0, "a stop from another tab holds here too");
    assert.equal(env.log.opened.length, 0);
  }

  console.log("own egg feature UI-tab behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
