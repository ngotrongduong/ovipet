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

console.log("pet record domain behavior tests passed");
