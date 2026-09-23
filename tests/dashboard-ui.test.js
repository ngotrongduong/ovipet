"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class FakeElement {
  constructor() {
    this.textContent = "";
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.title = "";
    this.className = "";
  }
  replaceChildren(...children) { this.children = children; }
}

function setup({ pets = {} } = {}) {
  const clock = { now: 1_000_000 };
  const state = {
    owehEggRun: { active: false, count: 0 },
    owehSweep: { active: false, index: 0, maxFriends: 0 },
    owehWorker: null,
    owehBreedCampaign: { active: false, femaleIndex: 0, bredCount: 0 },
    owehBreedQueue: [],
    owehPetIndex: { active: false, index: 0, indexed: 0 },
    owehPetScanQueue: [],
    owehHatchlingRun: { active: false, phase: "", index: 0 },
    owehHatchlingQueue: [],
    owehFriendRemoval: { active: false },
    owehDatabaseMeta: { catalogCount: 2, completeProfiles: 1, enclosureCount: 1 },
    owehSweepNotice: null,
    owehBreedPreview: null
  };
  const panel = new FakeElement();
  const summary = new FakeElement();
  const jobs = new FakeElement();
  const header = new FakeElement();
  const meta = new FakeElement();
  const health = new FakeElement();
  const ready = new FakeElement();
  const preview = new FakeElement();
  const confirm = new FakeElement();
  const discard = new FakeElement();
  const selectors = {
    "#oweh-breed-preview": preview,
    "#oweh-confirm-breed": confirm,
    "#oweh-discard-breed": discard,
    "#oweh-active-summary": summary,
    "#oweh-active-jobs": jobs,
    "#oweh-header-state": header,
    "#oweh-db-meta": meta
  };
  panel.querySelector = selector => selectors[selector] || null;
  const document = {
    getElementById: id => id === "panel" ? panel : null,
    querySelector: selector => ({ "#oweh-db-health": health, "#oweh-breed-ready": ready })[selector] || null,
    createElement: () => new FakeElement()
  };
  const log = { status: [], healthRequests: 0, visibilityCounts: [] };
  const timers = [];
  const helpers = {
    storageGet: async (key, fallback) => key === "owehPets" ? JSON.parse(JSON.stringify(pets)) : fallback,
    domain: {
      breedingPlan: {
        breedingReadiness: all => {
          const females = Object.values(all).filter(pet => pet.gender === "Female");
          return { total: females.length, ready: females.filter(pet => !pet.onCooldown).length, cooldown: females.filter(pet => pet.onCooldown).length, unverified: 0 };
        }
      }
    },
    storageGetMany: async () => JSON.parse(JSON.stringify(state)),
    runtimeRequest: async message => {
      if (message.type === "stateHealth") {
        log.healthRequests += 1;
        return { ok: true, health: { complete: 1, present: 2, incomplete: 1, stale: 0, uncertainCommands: 0, activeTasks: 0, staleTasks: 0 } };
      }
      return { ok: false };
    },
    setStatus: text => log.status.push(text),
    uiDashboardActions: {
      panelId: "panel",
      isPanelVisible: count => { log.visibilityCounts.push(count); return count > 0; }
    }
  };
  const sandbox = vm.createContext({
    console: { error() {} }, Promise, document,
    Date: { now: () => clock.now }, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../ui/dashboard.js"), "utf8"), sandbox, { filename: "dashboard.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["ui-dashboard"].api, state, clock, panel, summary, jobs, header, meta, health, ready, preview, confirm, discard, log, timers };
}

(async () => {
  // A live shared-worker lease is the source of truth for straight-line job activity.
  {
    const env = setup();
    env.state.owehWorker = { owner: "catalog", phase: "scanning", leaseUntil: env.clock.now + 30_000 };
    await env.api.update();
    assert.equal(env.api.getJobCount(), 1);
    assert.equal(env.summary.textContent, "1 automation running");
    assert.equal(env.header.textContent, "1 active");
    assert.equal(env.jobs.children.length, 1);
    assert.ok(env.jobs.children[0].textContent.includes("Update catalog"));
    assert.equal(env.meta.textContent, "Database: 1/2 profiles · 1 enclosures");
  }

  // Breeding planning holds the breed lease before the campaign record is active; the panel
  // must not read "Idle" during the full-enclosure scan.
  {
    const env = setup();
    env.state.owehWorker = { owner: "breed", phase: "running", leaseUntil: env.clock.now + 30_000 };
    await env.api.update();
    assert.equal(env.api.getJobCount(), 1);
    assert.equal(env.header.textContent, "1 active");
    assert.ok(env.jobs.children[0].textContent.includes("Breeding · planning"));
  }

  // Once the campaign is active (or planning hands off to the pet index), only one chip shows.
  {
    const env = setup();
    env.state.owehWorker = { owner: "breed", phase: "breeding 0/3", leaseUntil: env.clock.now + 30_000 };
    env.state.owehBreedCampaign = { active: true, femaleIndex: 0, bredCount: 0, strategy: "pure-line" };
    env.state.owehBreedQueue = [{}, {}, {}];
    await env.api.update();
    assert.equal(env.api.getJobCount(), 1);
    assert.ok(!env.jobs.children[0].textContent.includes("planning"));

    const indexing = setup();
    indexing.state.owehWorker = { owner: "breed", phase: "indexing 0/1", leaseUntil: indexing.clock.now + 30_000 };
    indexing.state.owehPetIndex = { active: true, breedPlanning: true, index: 0 };
    indexing.state.owehPetScanQueue = [{}];
    await indexing.api.update();
    assert.equal(indexing.api.getJobCount(), 1);
    assert.ok(indexing.jobs.children[0].textContent.includes("Pet index"));
  }

  // An expired lease must not keep the UI stuck in a false busy state.
  {
    const env = setup();
    env.state.owehWorker = { owner: "feed", phase: "working", leaseUntil: env.clock.now - 1 };
    await env.api.update();
    assert.equal(env.api.getJobCount(), 0);
    assert.equal(env.summary.textContent, "No automation running");
    assert.equal(env.header.textContent, "Idle");
  }

  // Sweep notices are surfaced once while fresh, and health calls are cached for 30 seconds.
  {
    const env = setup();
    env.state.owehSweepNotice = { text: "Sweep stopped safely", at: env.clock.now };
    await env.api.update();
    await env.api.update();
    assert.deepEqual(env.log.status, ["Sweep stopped safely"]);
    assert.equal(env.log.healthRequests, 1);
    assert.ok(env.health.textContent.includes("1/2 complete"));
  }


  // An active sweep without a live worker is an orphan/recovery state, not "this tab".
  {
    const env = setup();
    env.state.owehSweep = { active: true, index: 28, maxFriends: 213, cycle: 1, waitingUntil: 0 };
    env.state.owehWorker = null;
    await env.api.update();
    assert.equal(env.api.getJobCount(), 1);
    assert.ok(env.jobs.children[0].textContent.includes("recovering"));
    assert.ok(!env.jobs.children[0].textContent.includes("this tab"));
  }

  // Sweep notices expire quickly so an old timeout does not look like the current blocker.
  {
    const env = setup();
    env.state.owehSweepNotice = { text: "Friend eggs: batch timeout", at: env.clock.now - 20_000 };
    await env.api.update();
    assert.deepEqual(env.log.status, []);
  }

  // Females ready X/Y comes from the database; a fresh plan is shown and can be confirmed.
  {
    const env = setup({ pets: { 1: { gender: "Female" }, 2: { gender: "Female", onCooldown: true }, 3: { gender: "Male" } } });
    env.state.owehBreedPreview = {
      strategy: "pure-line", createdAt: env.clock.now - 120_000, species: "Catus", femaleCount: 2, pairable: 1, unpaired: 1,
      queue: [{ id: "1", name: "Fem", maleId: "3", maleName: "Mal" }, { id: "2", name: "Other", maleId: null }]
    };
    await env.api.update();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.ready.textContent, "Females ready: 1/2 · 1 on cooldown · 0 pedigree unverified");
    assert.ok(env.preview.textContent.includes("1 pair(s) for 2 female(s)"));
    assert.ok(env.preview.textContent.includes("Fem × Mal"));
    assert.ok(env.preview.textContent.includes("built 2m ago"));
    assert.equal(env.confirm.disabled, false);

    env.state.owehBreedCampaign = { active: true, femaleIndex: 0, bredCount: 0 };
    await env.api.update();
    assert.equal(env.confirm.disabled, true, "no second confirm while a campaign runs");

    env.state.owehBreedCampaign = { active: false };
    env.state.owehBreedPreview.createdAt = env.clock.now - 16 * 60_000;
    await env.api.update();
    assert.equal(env.confirm.disabled, true, "an expired plan cannot be confirmed");
    assert.ok(env.preview.textContent.includes("expired"));
  }

  // Schedule coalesces repeated requests into one timer.
  {
    const env = setup();
    env.api.schedule(10);
    env.api.schedule(10);
    assert.equal(env.timers.length, 1);
  }

  console.log("dashboard UI behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
