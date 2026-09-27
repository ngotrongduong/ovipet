"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

delete require.cache[require.resolve(path.join(__dirname, "../jobs/core.js"))];
delete require.cache[require.resolve(path.join(__dirname, "../domain/colors.js"))];
delete require.cache[require.resolve(path.join(__dirname, "../domain/pet-record.js"))];
delete globalThis.OWEH;

require("../jobs/core.js");
require("../domain/colors.js");
require("../domain/pet-record.js");

const { petRecord } = globalThis.OWEH.domain;
const full = {
  id: "1",
  owned: true,
  name: "FFFFFF-FF0000-000000",
  gender: "Female",
  species: "Catus",
  ancestors: [],
  pedigreeVerified: true,
  colors: {
    body1: "FFFFFF", body2: "FF0000", scales: "000000", extra1: "FF0000", extra2: "000000"
  },
  catalogModified: "7"
};

assert.equal(petRecord.isCompletePetRecord(full), true);
assert.equal(petRecord.isCompletePetRecord({ ...full, species: "" }), false);
assert.equal(petRecord.isCompletePetRecord({ ...full, pedigreeVerified: false }), false);
assert.equal(petRecord.isCompletePetRecord({ ...full, pedigreeVerified: undefined }), false, "legacy pedigree rows must refresh");
assert.equal(petRecord.petProfileNeedsRefresh(full, { modified: "7", name: full.name }, false), false);
assert.equal(petRecord.petProfileNeedsRefresh(full, { modified: "8", name: full.name }, false), true);
assert.equal(petRecord.petProfileNeedsRefresh(full, { modified: "7", name: "wrong" }, true), true);

const now = 123456789;
const meta = petRecord.databaseMetaFor(
  { 1: full, 2: { ...full, id: "2", present: false } },
  [{ id: "1", enclosureId: "A" }],
  0,
  now
);
assert.equal(meta.schemaVersion, 4);
assert.equal(meta.catalogAt, now);
assert.equal(meta.catalogCount, 1);
assert.equal(meta.completeProfiles, 1);
assert.equal(meta.enclosureCount, 1);
assert.throws(() => petRecord.databaseMetaFor({}, [], 0), /requires a finite now/);

// v5.7.0: mergeCatalogScan writes only records that actually changed.
{
  const item = { id: "1", usr: "77", name: full.name, modified: "7", enclosure: "Females", enclosureId: "3" };
  const pets = {
    1: { ...full, ...item, present: true, catalogModified: "7", profileStale: false, lastSeenAt: 1 },
    2: { ...full, id: "2", present: true, enclosure: "Males", catalogModified: "7" },
    3: { ...full, id: "3", present: true, enclosure: "Males discard", catalogModified: "7" }
  };
  const keepUnseen = pet => pet.enclosure === "Males discard";
  const unchanged = petRecord.mergeCatalogScan(pets, [item, { ...item, id: "4", name: "new" }], { partial: true, now: 50, keepUnseen });
  assert.deepEqual(Object.keys(unchanged.changed), ["4"], "an unchanged pet is not rewritten");
  assert.equal(pets[1].lastSeenAt, 1);
  assert.equal(pets[4].profileStale, true, "a new pet needs its profile");
  assert.equal(pets[2].present, true, "a partial scan never marks pets absent");

  const moved = petRecord.mergeCatalogScan(pets, [{ ...item, enclosure: "Breeding", enclosureId: "8" }], { partial: false, now: 60, keepUnseen });
  assert.deepEqual(Object.keys(moved.changed).sort(), ["1", "2", "4"]);
  assert.equal(pets[1].enclosure, "Breeding");
  assert.equal(pets[1].lastSeenAt, 60);
  assert.equal(pets[1].profileStale, false, "a move alone does not force a profile read");
  assert.equal(pets[2].present, false);
  assert.equal(pets[3].present, true, "keepUnseen protects pets in skipped enclosures");

  const edited = petRecord.mergeCatalogScan(pets, [{ ...item, modified: "8", enclosure: "Breeding", enclosureId: "8" }], { partial: true, now: 70, keepUnseen });
  assert.equal(edited.changed[1].profileStale, true, "a changed modified stamp marks the profile stale");
}

console.log("pet record domain behavior tests passed");
