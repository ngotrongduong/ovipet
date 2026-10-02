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
assert.equal(db.meta.species, 31);
assert.equal(db.meta.examples, 721);
assert.equal(db.meta.maxExamplesPerSpecies, 64);
assert.equal(Object.keys(db.library).length, 31);

let examples = 0;
for (const [species, record] of Object.entries(db.library)) {
  assert.ok(species && Array.isArray(record.examples));
  assert.ok(record.examples.length <= 64);
  for (const shape of record.examples) {
    assert.ok(shapeApi.validShape(shape), `invalid built-in silhouette for ${species}`);
    examples += 1;
  }
}
assert.equal(examples, 721);

// The production payload must contain only anonymous silhouettes + compact metadata.
const source = fs.readFileSync(path.join(__dirname, "..", "data", "species-static.js"), "utf8");
for (const forbidden of ["thumbnail", "data:image", "userId", "eggId", "network", "sourceHints", "outerHTML"]) {
  assert.equal(source.includes(forbidden), false, `static DB must not embed raw Inspector field: ${forbidden}`);
}

console.log("static production species database tests passed");
