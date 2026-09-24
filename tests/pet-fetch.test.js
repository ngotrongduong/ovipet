"use strict";

// services/pet-fetch.js (v5.5.0): fetch-based catalog/profile reads keep the storage contract
// of the navigated Overview scan (partial merge, empty scan writes nothing).
const assert = require("node:assert/strict");
const path = require("node:path");
const samples = require("./fixtures/markup-samples");

for (const file of ["../jobs/core.js", "../dom/markup.js", "../services/pet-fetch.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
require("../jobs/core.js");
require("../dom/markup.js");
require("../services/pet-fetch.js");
const { createPetFetch, mergePetRecord, profilePath } = globalThis.OWEH.services.petFetch;

const emptyEnclosure = id => `<ui:section title = "Pets-${id}" id = "pets-${id}"></ui:section>`;

function harness(routes, initial = {}) {
  const store = { ...initial };
  const requests = [];
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(url);
    assert.match(url, /&!=cb&_=\d+$/, "every panel read uses the SPA's JSONP form");
    const route = Object.keys(routes).find(prefix => url.startsWith(prefix));
    const body = route ? routes[route] : undefined;
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => samples.cb(body) };
  };
  const service = createPetFetch({
    storageGet: async (key, fallback) => (key in store ? store[key] : fallback),
    storageSet: async values => Object.assign(store, values),
    runtimeRequest: async message => { requests.push(message); return { ok: true }; },
    sleep: async () => {},
    markup: globalThis.OWEH.dom.markup,
    fingerprint: text => `fp${text.length}`,
    fetchImpl
  });
  return { service, store, requests, fetched };
}

(async () => {
  // ---- full catalog scan
  const enclosureRoute = id => `/?src=pets&sub=overview&sec=pets&enclosure=${id}&usr=4973830&!=cb`;
  const full = harness({
    "/?src=pets&sub=overview&!=cb": samples.overview,
    [enclosureRoute(0)]: emptyEnclosure(0),
    [enclosureRoute(1)]: emptyEnclosure(1),
    [enclosureRoute(8)]: emptyEnclosure(8),
    [enclosureRoute(9)]: samples.enclosure
  });
  const scan = await full.service.collectCatalog();
  assert.equal(scan.partial, false);
  assert.equal(scan.ownUserId, "4973830");
  assert.deepEqual(scan.catalog.map(pet => pet.id), ["153900436", scan.catalog[1].id]);
  assert.equal(scan.catalog[0].enclosure, "males");
  assert.equal(scan.catalog[0].enclosureId, "9");
  assert.deepEqual({ ...full.store.owehEnclosureIds }, { Newborn: "0", "** ** FF": "1", "Breeding stock": "8", males: "9" });
  assert.equal(full.store.owehEnclosureSnapshots["9"].count, 2);
  assert.equal(full.store.owehEnclosureScanStats.partial, false);
  assert.equal(full.requests[0].type, "reconcileBreedCommands");
  assert.equal(full.requests[0].catalog.length, 2);

  // ---- one enclosure fails: partial, saved ids are merged, not dropped
  const partial = harness({
    "/?src=pets&sub=overview&!=cb": samples.overview,
    [enclosureRoute(0)]: emptyEnclosure(0),
    [enclosureRoute(1)]: new Error("network"),
    [enclosureRoute(8)]: emptyEnclosure(8),
    [enclosureRoute(9)]: samples.enclosure
  }, { owehEnclosureIds: { "** ** FF": "1", Old: "12" }, owehEnclosureSnapshots: { 1: { count: 5 } } });
  const partialScan = await partial.service.collectCatalog();
  assert.equal(partialScan.partial, true);
  assert.equal(partial.store.owehEnclosureIds.Old, "12", "a partial scan never drops an enclosure");
  assert.equal(partial.store.owehEnclosureIds["** ** FF"], "1");
  assert.equal(partial.store.owehEnclosureSnapshots["1"].count, 5, "the failed enclosure keeps its last snapshot");
  assert.equal(partial.store.owehEnclosureScanStats.skipped, 1);

  // ---- nothing found: nothing written, nothing reconciled
  const empty = harness({
    "/?src=pets&sub=overview&!=cb": samples.overview,
    [enclosureRoute(0)]: emptyEnclosure(0),
    [enclosureRoute(1)]: emptyEnclosure(1),
    [enclosureRoute(8)]: emptyEnclosure(8),
    [enclosureRoute(9)]: emptyEnclosure(9)
  }, { owehEnclosureIds: { keep: "1" } });
  const emptyScan = await empty.service.collectCatalog();
  assert.equal(emptyScan.catalog.length, 0);
  assert.deepEqual({ ...empty.store.owehEnclosureIds }, { keep: "1" });
  assert.equal(empty.requests.length, 0);

  // ---- cancelled mid-scan: nothing written
  let calls = 0;
  const cancelled = await full.service.collectCatalog({ isCancelled: () => ++calls > 1 });
  assert.equal(cancelled.cancelled, true);

  // ---- profile + pedigree read
  const reader = harness({
    [profilePath("157155269", "4973830")]: samples.namedProfile,
    "/?src=pets&sub=profile&sec=pedigree&pet=157155269": samples.pedigree
  });
  const read = await reader.service.readPet("157155269", "4973830");
  assert.equal(read.ok, true);
  assert.equal(read.record.name, "F5FAF2-F20B18-13101B");
  assert.equal(read.record.pedigreeVerified, true);
  assert.equal(read.record.parentIds.length, 2);
  assert.equal(read.profile.enclosureId, "8");
  assert.equal(read.record.url, "https://ovipets.com/#!/?src=pets&sub=profile&usr=4973830&pet=157155269");

  const noPedigree = harness({ [profilePath("157155269", null)]: samples.namedProfile });
  const partialRead = await noPedigree.service.readPet("157155269");
  assert.equal(partialRead.ok, true);
  assert.equal(partialRead.record.pedigreeVerified, false, "a failed pedigree read is unverified, not an error");
  assert.equal(noPedigree.fetched.filter(url => url.includes("sec=pedigree")).length, 2, "one retry per panel");

  const missing = await harness({}).service.readPet("1");
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /^profile:/);

  // ---- hatchery
  const hatchery = await harness({ "/?src=pets&sub=hatchery&!=cb": samples.hatchery }).service.readHatchery();
  assert.deepEqual([...hatchery.unnamedIds], ["530491258"]);

  // ---- merge keeps a verified pedigree
  const previous = { id: "1", name: "old", pedigreeVerified: true, ancestors: ["2"], pedigree: [{ id: "2" }], parentIds: ["2"], enclosure: "males" };
  const merged = mergePetRecord(previous, { id: "1", name: "new", pedigreeVerified: false, ancestors: [], pedigree: [], parentIds: [] });
  assert.equal(merged.name, "new");
  assert.equal(merged.pedigreeVerified, true);
  assert.deepEqual([...merged.parentIds], ["2"]);
  assert.equal(merged.enclosure, "males", "fields the record does not carry survive");

  console.log("pet fetch tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
