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
      async query(filter) {
        // "Is the owner on a game tab?" asks for the focused window's active tab.
        if (filter.active) return world.frontTab ? [world.frontTab] : [];
        log.query = clone(filter);
        return world.tabs;
      },
      async reload(id) { log.tabReloads.push(id); }
    },
    windows: { get: async () => ({ focused: world.windowFocused !== false }) },
    idle: { queryState: async () => world.idleState || "idle" }
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

  // "Update now" skips the settle time and the owner's own presence, never a running job.
  {
    let job = "the friend sweep";
    const world = newWorld({ frontTab: { id: 7, windowId: 1 }, idleState: "active" });
    const run = boot(world, { busy: () => job });
    await run.started;
    world.disk = "1.0.1";
    const refused = await run.api.check({ force: true });
    assert.deepEqual([refused.action, refused.waitingFor], ["waiting", "the friend sweep"]);
    assert.equal(run.log.reloads, 0);
    job = "";
    assert.equal(await run.check({ force: true }), "reloading");
    assert.equal(run.log.reloads, 1);
  }

  // The owner is in a game tab right now: the refresh would throw away what they are typing.
  {
    const world = newWorld({ frontTab: { id: 7, windowId: 1 }, idleState: "active" });
    const run = boot(world);
    await run.started;
    world.disk = "1.0.1";
    await run.check();
    world.now = T + 60_000;
    const held = await run.api.check();
    assert.equal(held.action, "waiting");
    assert.ok(held.waitingFor.includes("pause for a minute"));
    world.windowFocused = false;
    assert.equal(await run.check(), "reloading", "the browser is not the window in use");

    for (const away of [{ idleState: "idle" }, { idleState: "locked" }, { frontTab: null }]) {
      const quiet = newWorld({ frontTab: { id: 7, windowId: 1 }, idleState: "active", ...away });
      const other = boot(quiet);
      await other.started;
      quiet.disk = "1.0.1";
      await other.check();
      quiet.now = T + 60_000;
      assert.equal(await other.check(), "reloading", `not held: ${JSON.stringify(away)}`);
    }
  }

  // An older version in the folder is not a release.
  {
    const world = newWorld({ loaded: "5.11.0", disk: "5.11.0" });
    const run = boot(world);
    await run.started;
    for (const disk of ["5.10.2", "5.9.9", "4.99.99", "5.11"]) {
      world.disk = disk;
      world.now += 100_000;
      assert.equal(await run.check(), "current", `not loaded: ${disk}`);
      assert.equal(await run.check({ force: true }), "current");
    }
    assert.equal(run.log.reloads, 0);
    world.disk = "5.11.0.1";
    assert.equal(await run.check({ force: true }), "reloading", "a fourth number counts");
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
    assert.ok(/async function updateNow\(\) \{[\s\S]*?await automationBusy\(\)[\s\S]*?selfUpdate\.check\(\{ force: true \}\)/.test(background),
      "the background waits until nothing is running before the forced reload");
    assert.ok(JSON.parse(read("manifest.json")).permissions.includes("idle"), "the owner's presence is read through chrome.idle");
    assert.ok(SOURCE.includes('"owehSelfUpdateReloadAt"') && read("features/own-eggs.js").includes('"owehSelfUpdateReloadAt"'));
  }

  console.log("self-update tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
