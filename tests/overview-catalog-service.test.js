"use strict";

// Behavior of services/overview-catalog.js collectAllOverviewPets against a fake Overview page:
// full scan, a tab that never activates (partial scan), an empty scan and snapshot reuse.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "services", "overview-catalog.js"), "utf8");

// Values built inside the vm carry its own Array/Object prototypes; compare them as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function load() {
  // Virtual clock: sleep() advances Date.now(), so the service's 10 s timeouts finish instantly.
  let now = 1_000_000;
  const FakeDate = class extends Date {};
  FakeDate.now = () => now;
  const context = { OWEH: {}, Date: FakeDate, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { service: context.OWEH.services.overviewCatalog, advance: ms => { now += ms; } };
}

// tabs: [{ label, id, cards: [petId...], stuck?: true }] — a stuck tab ignores clicks.
function fakePage(tabs) {
  let active = 0;
  const elements = tabs.map((tab, index) => ({
    get textContent() { return ` ${tab.label} `; },
    get active() { return active === index; },
    getAttribute: () => null,
    querySelector(selector) {
      if (selector === "a") return { click() { if (!tab.stuck) active = index; } };
      if (selector === "[enclosure]") return tab.id == null ? null : { getAttribute: () => String(tab.id) };
      return null;
    }
  }));
  const cards = () => (tabs[active]?.cards || []).map(id => ({ id: String(id), name: `Pet ${id}` }));
  return {
    overviewDom: {
      overviewEnclosureTabs: () => elements,
      overviewCards: cards,
      overviewCardInfo: card => ({ ...card }),
      isOverviewBusy: () => false,
      overviewSignature: () => cards().map(card => card.id).join(",")
    },
    isTabActive: tab => Boolean(tab?.active)
  };
}

function create(page, stored = {}) {
  const { service, advance } = load();
  const storage = { ...stored };
  const writes = [];
  const requests = [];
  const catalog = service.createOverviewCatalog({
    storageGet: async (key, fallback) => (key in storage ? storage[key] : fallback),
    storageSet: async values => { writes.push(values); Object.assign(storage, values); },
    runtimeRequest: async message => { requests.push(message); return { ok: true }; },
    sleep: async ms => advance(ms),
    getPageLoadDelayMs: () => 0,
    overviewDom: page.overviewDom,
    isTabActive: page.isTabActive,
    normalizeEnclosureLabel: label => String(label).trim().toLowerCase()
  });
  return { catalog, storage, writes, requests, fingerprint: service.fastFingerprint };
}

(async () => {
  // Full scan: every enclosure is filed under its own id and breed commands are reconciled.
  {
    const page = fakePage([{ label: "Main", id: 11, cards: [1, 2] }, { label: "Newborn", id: 22, cards: [3] }]);
    const { catalog, storage, requests } = create(page);
    const pets = await catalog.collectAllOverviewPets();
    assert.deepEqual(plain(pets).map(pet => [pet.id, pet.enclosure, pet.enclosureId]),
      [["1", "Main", "11"], ["2", "Main", "11"], ["3", "Newborn", "22"]]);
    assert.deepEqual(plain(storage.owehEnclosureIds), { Main: "11", Newborn: "22" });
    assert.equal(storage.owehEnclosureScanStats.partial, false);
    assert.equal(storage.owehEnclosureScanStats.scanned, 2);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, "reconcileBreedCommands");
    assert.equal(requests[0].catalog.length, 3);
  }

  // A tab that never activates: its (stale) cards are not filed under it, the scan is partial
  // and the saved ids/snapshots of enclosures it could not read are kept.
  {
    const page = fakePage([
      { label: "Main", id: 11, cards: [1] },
      { label: "Stuck", id: 33, cards: [9], stuck: true },
      { label: "Newborn", id: 22, cards: [3] }
    ]);
    const previousIds = { Main: "11", Stuck: "33", Newborn: "22", Old: "44" };
    const previousSnapshots = { 33: { fingerprint: "x", records: [{ id: "9" }] }, 44: { fingerprint: "y", records: [] } };
    const { catalog, storage } = create(page, { owehEnclosureIds: previousIds, owehEnclosureSnapshots: previousSnapshots });
    const pets = await catalog.collectAllOverviewPets();
    assert.deepEqual(plain(pets).map(pet => [pet.id, pet.enclosure]), [["1", "Main"], ["3", "Newborn"]]);
    assert.ok(!pets.some(pet => pet.enclosure === "Stuck"), "cards must never be filed under a tab that did not activate");
    assert.deepEqual(plain(storage.owehEnclosureIds), previousIds, "a partial scan must not drop saved enclosure ids");
    assert.ok(storage.owehEnclosureSnapshots[33] && storage.owehEnclosureSnapshots[44], "a partial scan must keep old snapshots");
    assert.equal(storage.owehEnclosureScanStats.partial, true);
    assert.equal(storage.owehEnclosureScanStats.skipped, 1);
    assert.equal(storage.owehEnclosureScanStats.scanned, 2);
  }

  // Fewer tabs than the last full scan (Overview still mounting) also counts as partial.
  {
    const page = fakePage([{ label: "Main", id: 11, cards: [1] }]);
    const { catalog, storage } = create(page, { owehEnclosureIds: { Main: "11", Newborn: "22" } });
    await catalog.collectAllOverviewPets();
    assert.equal(storage.owehEnclosureScanStats.partial, true);
    assert.deepEqual(plain(storage.owehEnclosureIds), { Main: "11", Newborn: "22" });
  }

  // Empty scan (Overview not mounted): nothing is written and nothing is reconciled.
  {
    const page = fakePage([]);
    const previousIds = { Main: "11" };
    const { catalog, writes, requests, storage } = create(page, { owehEnclosureIds: previousIds });
    const pets = await catalog.collectAllOverviewPets();
    assert.deepEqual(plain(pets), []);
    assert.equal(writes.length, 0, "an empty scan must not overwrite saved enclosure ids");
    assert.equal(requests.length, 0, "an empty scan must not reconcile breed commands");
    assert.deepEqual(storage.owehEnclosureIds, previousIds);
  }

  // Snapshot reuse: an unchanged enclosure (same fingerprint) reuses its saved records.
  {
    const page = fakePage([{ label: "Main", id: 11, cards: [1, 2] }]);
    const { fingerprint } = create(page);
    const saved = [{ id: "1", name: "Saved one", enclosure: "Main", enclosureId: "11" }, { id: "2", name: "Saved two", enclosure: "Main", enclosureId: "11" }];
    const { catalog, storage } = create(page, {
      owehEnclosureIds: { Main: "11" },
      owehEnclosureSnapshots: { 11: { fingerprint: fingerprint("1,2"), records: saved } }
    });
    const pets = await catalog.collectAllOverviewPets();
    assert.deepEqual(plain(pets).map(pet => pet.name), ["Saved one", "Saved two"]);
    assert.equal(storage.owehEnclosureScanStats.reused, 1);
    assert.equal(storage.owehEnclosureScanStats.changed, 0);
  }

  console.log("overview catalog service tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
