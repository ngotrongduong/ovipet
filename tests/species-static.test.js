"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = vm.createContext({ console, Object, Array, Set, Number, String, Boolean, Math, globalThis: null });
sandbox.globalThis = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "data", "species-static.js"), "utf8"), sandbox, { filename: "species-static.js" });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "domain", "species-shape.js"), "utf8"), sandbox, { filename: "species-shape.js" });

const QUIZ_SPECIES = ["Canis", "Draconis", "Equus", "Feline", "Gekko", "Lupus", "Mantis", "Raptor", "Slime", "Vulpes"];
const db = sandbox.OWEH_STATIC_SPECIES;
const shapeApi = sandbox.OWEH_SPECIES_SHAPE;
assert.ok(db && db.library && db.meta);
assert.equal(db.meta.species, 10);
assert.deepEqual(Object.keys(db.library).sort(), QUIZ_SPECIES);

// The 451-silhouette subsample (v5.10.2) left gaps a real quiz fell into; every species keeps
// (nearly) the full learned set now.
let examples = 0;
for (const [species, record] of Object.entries(db.library)) {
  assert.ok(Array.isArray(record.examples));
  assert.ok(record.examples.length >= 140, `too few silhouettes for ${species}`);
  assert.equal(record.examples.length, db.meta.counts[species], `meta count mismatch for ${species}`);
  assert.equal(new Set(record.examples).size, record.examples.length, `duplicate silhouette for ${species}`);
  assert.ok(db.meta.gameConfirmed[species] <= record.examples.length);
  for (const shape of record.examples) {
    assert.ok(shapeApi.validShape(shape), `invalid built-in silhouette for ${species}`);
    examples += 1;
  }
}
assert.equal(examples, db.meta.examples);

// Real quizzes OviPets rejected on 2026-10-04 (answered Canis/Mantis off the 451 library).
const rejected = [
  {
    correct: "Vulpes",
    wrong: "Canis",
    options: ["Canis", "Draconis", "Feline", "Gekko", "Mantis", "Vulpes"],
    shape: "000000000000000000000000000000000000008000000fc000000fc000001ff000401ff800401ff800c01ff80041bff80061fff0003bffe0003fffe0003fffe0001fffe0001fffe0001fffc0001fffe0000dffe0000dbe30000d9c30000ccc30000e0c0000060c00000000000000000000000000000000000000000000000000"
  },
  {
    correct: "Slime",
    wrong: "Mantis",
    options: ["Equus", "Feline", "Lupus", "Mantis", "Raptor", "Slime"],
    shape: "00000000000000000000000000000000000000000000000000000000000000000000000000000000003e0780007f8fc000ffffe002ffffe007ffffe007fffff003ffffe003ffffc003ffffc007ffff8007ffff00077fff000027ff000027e700000f8380000f0380000c00000000000000000000000000000000000000000000"
  },
  {
    correct: "Vulpes",
    wrong: "Canis",
    options: ["Canis", "Draconis", "Equus", "Feline", "Gekko", "Vulpes"],
    shape: "000000000000000000000400000007c0000067e000007ff000007fd800007fec00007ff800007ff800003ff810001ff81ff80ff00fffffe003fffff0001ffff0001ffff8001ffff0001fffe0001fffe0000fffe0000dff30000dff30000cfc30000e7c0000060e00000004000000000000000000000000000000000000000000"
  }
];
const nearest = (shape, species, library) => Math.min(...library[species].examples.map(example => shapeApi.hamming(shape, example)));
for (const item of rejected) {
  const shipped = shapeApi.rankOptions({ shape: item.shape, options: item.options, library: db.library });
  assert.equal(shipped.species, item.correct);
  assert.equal(shipped.method, "shape-match");
  // Not just memorised: with the exact silhouette held out the right species still wins clearly.
  const heldOut = Object.fromEntries(Object.entries(db.library)
    .map(([species, record]) => [species, { examples: record.examples.filter(shape => shape !== item.shape) }]));
  assert.equal(shapeApi.rankOptions({ shape: item.shape, options: item.options, library: heldOut }).species, item.correct);
  assert.ok(nearest(item.shape, item.wrong, heldOut) - nearest(item.shape, item.correct, heldOut) >= 15,
    `${item.correct} must beat ${item.wrong} by a margin, not by a bit`);
}

// The production data object must contain only anonymous silhouettes + compact metadata.
const serialized = JSON.stringify({ meta: db.meta, library: db.library });
for (const forbidden of ["thumbnail", "data:image", "userId", "eggId", "network", "sourceHints", "outerHTML"]) {
  assert.equal(serialized.includes(forbidden), false, `static DB must not embed raw Inspector field: ${forbidden}`);
}

console.log("static production species database tests passed");
