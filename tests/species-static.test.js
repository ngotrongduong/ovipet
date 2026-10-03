"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = vm.createContext({ console, Object, Array, Set, Number, String, Boolean, Math, globalThis: null });
sandbox.globalThis = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "data", "species-static.js"), "utf8"), sandbox, { filename: "species-static.js" });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "domain", "species-shape.js"), "utf8"), sandbox, { filename: "species-shape.js" });

const db = sandbox.OWEH_STATIC_SPECIES;
const shapeApi = sandbox.OWEH_SPECIES_SHAPE;
assert.ok(db && db.library && db.meta);
assert.equal(db.meta.species, 10);
assert.equal(db.meta.examples, 451);
assert.equal(db.meta.confirmedAllocationTotal, 450);
assert.equal(db.meta.validationCoverageExtras, 1);
assert.equal(Object.keys(db.library).length, 10);
assert.deepEqual(Object.keys(db.library).sort(), ["Canis","Draconis","Equus","Feline","Gekko","Lupus","Mantis","Raptor","Slime","Vulpes"]);

let examples = 0;
const expectedCounts = {
  Canis: 46, Draconis: 30, Equus: 49, Feline: 45, Gekko: 38,
  Lupus: 40, Mantis: 58, Raptor: 55, Slime: 46, Vulpes: 44
};
for (const [species, record] of Object.entries(db.library)) {
  assert.ok(species && Array.isArray(record.examples));
  assert.equal(record.examples.length, expectedCounts[species], `unexpected silhouette count for ${species}`);
  for (const shape of record.examples) {
    assert.ok(shapeApi.validShape(shape), `invalid built-in silhouette for ${species}`);
    examples += 1;
  }
}
assert.equal(examples, 451);

// The production data object must contain only anonymous silhouettes + compact metadata.
const serialized = JSON.stringify({ meta: db.meta, library: db.library });
for (const forbidden of ["thumbnail", "data:image", "userId", "eggId", "network", "sourceHints", "outerHTML"]) {
  assert.equal(serialized.includes(forbidden), false, `static DB must not embed raw Inspector field: ${forbidden}`);
}

console.log("static production species database tests passed");
