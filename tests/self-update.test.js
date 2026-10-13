"use strict";

// bg/self-update.js: an unpacked install loads a newer version found in its own folder, but
// only when nothing is running, and never in a loop.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clone = value => JSON.parse(JSON.stringify(value));
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "bg", "self-update.js"), "utf8");
const T = 1_700_000_000_000;

// `world` is what survives a reload: storage, the folder, the tabs, the clock.
const newWorld = extra => ({ store: {}, loaded: "1.0.0", disk: "1.0.0", tabs: [], now: T, ...extra });

// One service-worker lifetime.
function boot(world, { busy = () => "", beforeReload = null } = {}) {
  const log = { reloads: 0, tabReloads: [], applied: [], alarms: [], query: null };
  const alarmListeners = [];
  const chrome = {
    storage: {
      local: {
        async get(defaults) {
          return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in world.store ? clone(world.store[key]) : fallback]));
        },
        async set(values) { Object.assign(world.store, clone(values)); }
      }
    },
    runtime: {
      getManifest: () => ({ version: world.loaded }),
      getURL: file => `chrome-extension://self/${file}`,
      // The browser reads the folder again: the loaded version becomes the one on disk.
      reload() { log.reloads += 1; if (world.reloadTakes !== false) world.loaded = world.disk; }
    },
    management: { getSelf: async () => ({ installType: world.installType || "development" }) },
    alarms: {
      create(name, info) { log.alarms.push(clone([name, info])); },
      onAlarm: { addListener(fn) { alarmListeners.push(fn); } }
    },
    tabs: {
      async query(filter) { log.query = clone(filter); return world.tabs; },
      async reload(id) { log.tabReloads.push(id); }
    }
  };
  const fetch = async url => {
    assert.equal(url, "chrome-extension://self/manifest.json");
    if (world.disk === "unreadable") throw new Error("file busy");
    return { ok: true, text: async () => (world.disk === "broken" ? "{ not json" : JSON.stringify({ version: world.disk })) };
  };
  const sandbox = vm.createContext({ chrome, fetch, console, Promise, Object, Array, Number, String, Boolean, JSON, Date, RegExp, globalThis: null });
  sandbox.globalThis = sandbox;
  vm.runInContext(SOURCE, sandbox, { filename: "self-update.js" });
  const api = sandbox.OWEH_BG.selfUpdate;
  const started = api.start({
    busy: async () => busy(),
    tabUrls: ["https://ovipets.com/*"],
    beforeReload,
    onApplied: info => { log.applied.push(clone(info)); },
    now: () => world.now
  });
  return {
    api, log, started,
    check: async options => (await api.check(options)).action,
    // The listener does not hand its work back; everything it awaits here is a microtask.
    fireAlarm: name => {
      for (const listener of alarmListeners) listener({ name });
      return new Promise(resolve => setImmediate(resolve));
    }
  };
}

(async () => {
  // Nothing new: nothing happens; the alarm is armed on every start.
  {
    const world = newWorld();
    const run = boot(world);
    await run.started;
    assert.deepEqual(run.log.alarms, [["oweh-self-update", { periodInMinutes: 1 }]]);
    assert.equal(await run.check(), "current");
    assert.equal(run.log.reloads, 0);
    const status = await run.api.status();
    assert.deepEqual([status.supported, status.enabled, status.loaded, status.pending], [true, true, "1.0.0", null]);
  }

  // A newer version in the folder: settle time, then wait for the running job, then reload.
  {
    let job = "the friend sweep";
    const world = newWorld({ tabs: [{ id: 7 }, { id: 9 }] });
    const run = boot(world, { busy: () => job, beforeReload: async () => ({ review: true }) });
    await run.started;
    world.disk = "1.0.1";
    assert.equal(await run.check(), "settling");
    world.now = T + 30_000;
    assert.equal(await run.check(), "settling", "its other files may still be copying");
    world.now = T + 46_000;
    const waiting = await run.api.check();
    assert.deepEqual([waiting.action, waiting.waitingFor], ["waiting", "the friend sweep"]);
    const shown = await run.api.status();
    assert.deepEqual([shown.pending.version, shown.waitingFor], ["1.0.1", "the friend sweep"]);
    assert.equal(run.log.reloads, 0, "never under a running job");

    job = "";
    world.now = T + 120_000;
    await run.fireAlarm("some-other-alarm");
    assert.equal(run.log.reloads, 0);
    await run.fireAlarm("oweh-self-update");
    assert.equal(run.log.reloads, 1, "the alarm drives the check");
    assert.deepEqual(clone(world.store.owehSelfUpdate.applying), { from: "1.0.0", to: "1.0.1", at: T + 120_000, resume: { review: true } });

    // The next service worker is the new version: tabs are refreshed once, page code is told.
    world.now = T + 123_000;
    const next = boot(world);
    await next.started;
    assert.deepEqual(next.log.query, { url: ["https://ovipets.com/*"] });
    assert.deepEqual(next.log.tabReloads, [7, 9]);
    assert.deepEqual(next.log.applied, [{ from: "1.0.0", to: "1.0.1", resume: { review: true } }]);
    assert.equal(world.store.owehSelfUpdateReloadAt, T + 123_000);
    const after = await next.api.status();
    assert.deepEqual([after.loaded, after.pending, after.applied.from, after.applied.to], ["1.0.1", null, "1.0.0", "1.0.1"]);
    assert.equal(next.log.reloads, 0);

    // A later plain restart refreshes nothing.
    const later = boot(world);
    await later.started;
    assert.deepEqual(later.log.tabReloads, []);
    assert.equal(later.log.applied.length, 0);
  }

  // A reload that does not load the new version is not repeated every minute.
  {
    const world = newWorld({ tabs: [{ id: 3 }], reloadTakes: false });
    const run = boot(world);
    await run.started;
    world.disk = "1.0.1";
    await run.check();
    world.now = T + 50_000;
    assert.equal(await run.check(), "reloading");

    world.now = T + 52_000;
    const next = boot(world);
    await next.started;
    assert.deepEqual(next.log.tabReloads, [], "nothing changed, so no tab is refreshed");
    assert.equal(next.log.applied.length, 0);
    world.now = T + 200_000;
    assert.equal(await next.check(), "held");
    assert.equal(next.log.reloads, 0);
    assert.ok((await next.api.status()).waitingFor.includes("by hand"));
    world.now = T + 50_000 + 31 * 60_000;
    assert.equal(await next.check(), "reloading", "tried again after the hold");
  }

  // "Update now": the owner stopped everything, so neither the settle time nor busy() holds it.
  {
    const world = newWorld();
    const run = boot(world, { busy: () => "the friend sweep" });
    await run.started;
    world.disk = "1.0.1";
    assert.equal(await run.check({ force: true }), "reloading");
    assert.equal(run.log.reloads, 1);
  }

  // Switched off, a store install, or an unreadable folder: never a reload.
  {
    const world = newWorld();
    const run = boot(world);
    await run.started;
    world.disk = "1.0.1";
    await run.check();
    const off = await run.api.setEnabled(false);
    assert.deepEqual([off.enabled, off.pending], [false, null]);
    world.now = T + 100_000;
    assert.equal(await run.check(), "off");
    assert.equal(await run.check({ force: true }), "off");
    await run.api.setEnabled(true);

    world.installType = "normal";
    world.now = T + 300_000;
    assert.equal(await run.check(), "off");
    assert.equal((await run.api.status()).supported, false);
    world.installType = "development";

    for (const disk of ["unreadable", "broken", "not.a.version"]) {
      world.disk = disk;
      assert.equal(await run.check(), "current", `ignored: ${disk}`);
    }
    assert.equal(run.log.reloads, 0);
  }

  // Wiring in the full extension: the module is loaded, its messages are handled, the panel has
  // its controls, and the page code honours the "refreshed by an update" mark.
  {
    const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const background = read("background.js");
    const panel = read("ui/panel.js");
    assert.ok(background.match(/importScripts\(([^;]+)\);/s)[1].includes('"bg/self-update.js"'));
    for (const type of ["selfUpdateStatus", "selfUpdateEnabled", "selfUpdateNow"]) {
      assert.ok(background.includes(`message?.type === "${type}"`), `background must handle ${type}`);
      assert.ok(panel.includes(`type: "${type}"`), `panel must send ${type}`);
    }
    for (const id of ["oweh-auto-update", "oweh-update-status", "oweh-update-now"]) {
      assert.ok(panel.includes(`id="${id}"`), `panel control missing: ${id}`);
    }
    assert.ok(/await stopAllAutomation\(\);\s+const response = await runtimeRequest\(\{ type: "selfUpdateNow" \}\)/.test(panel),
      "Update now stops every job before it asks for the reload");
    assert.ok(SOURCE.includes('"owehSelfUpdateReloadAt"') && read("features/own-eggs.js").includes('"owehSelfUpdateReloadAt"'));
  }

  console.log("self-update tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
