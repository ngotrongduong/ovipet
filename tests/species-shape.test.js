"use strict";

// domain/species-shape.js pure silhouette matcher used by the production static database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

const SIZE = 32;
// A rectangle silhouette on a 32x32 RGBA canvas; `jitter` flips a few pixels on the edge.
function rgbaRect({ x0, y0, x1, y1, jitter = 0 }) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      data[(y * SIZE + x) * 4 + 3] = inside ? 255 : 0;
    }
  }
  for (let i = 0; i < jitter; i += 1) {
    const index = (y0 * SIZE + x0 + i) * 4 + 3;
    data[index] = data[index] ? 0 : 255;
  }
  return data;
}

function loadDomain(extra = {}) {
  const sandbox = vm.createContext({ ...extra });
  vm.runInContext(read("domain/species-shape.js"), sandbox, { filename: "species-shape.js" });
  return sandbox;
}

(async () => {
  const api = loadDomain().OWEH_SPECIES_SHAPE;

  // Masks: alpha only, 256 hex chars; blank or fully opaque images carry no silhouette.
  const cat = api.shapeFromRgba(rgbaRect({ x0: 4, y0: 4, x1: 20, y1: 28 }));
  const catVariant = api.shapeFromRgba(rgbaRect({ x0: 4, y0: 4, x1: 20, y1: 28, jitter: 10 }));
  const catGenes = api.shapeFromRgba(rgbaRect({ x0: 4, y0: 4, x1: 21, y1: 28 }));
  const bird = api.shapeFromRgba(rgbaRect({ x0: 10, y0: 0, x1: 32, y1: 12 }));
  assert.ok(api.validShape(cat) && cat.length === 256);
  assert.equal(api.shapeFromRgba(rgbaRect({ x0: 0, y0: 0, x1: 0, y1: 0 })), null, "empty mask is rejected");
  assert.equal(api.shapeFromRgba(rgbaRect({ x0: 0, y0: 0, x1: 32, y1: 32 })), null, "fully opaque (no alpha) is rejected");
  assert.equal(api.shapeFromRgba(new Uint8ClampedArray(10)), null);

  // Hamming distance counts differing pixels.
  assert.equal(api.hamming(cat, cat), 0);
  assert.equal(api.hamming(cat, catVariant), 10);
  assert.equal(api.hamming(cat, catGenes), 24);
  assert.ok(api.hamming(cat, bird) > api.MATCH_DISTANCE, "different species are far apart");
  assert.equal(api.hamming(cat, "zz"), api.BITS, "invalid shapes are maximally far");

  // Library: near-duplicates are skipped, distinct variants kept, newest MAX_EXAMPLES only.
  const library = {};
  assert.equal(api.addExample(library, "Cat", cat).added, true);
  assert.equal(api.addExample(library, "Cat", api.shapeFromRgba(rgbaRect({ x0: 4, y0: 4, x1: 20, y1: 28, jitter: 3 }))).added, false, "a near-duplicate is not stored twice");
  assert.equal(api.addExample(library, "Cat", catGenes).added, true, "a different variant is kept");
  assert.equal(api.addExample(library, "", cat).added, false);
  assert.equal(api.addExample(library, "Cat", "bad").added, false);
  assert.equal(library.Cat.examples.length, 2);
  const crowded = {};
  let seed = 12345;
  const noise = () => {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 3; i < data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      data[i] = (seed >> 16) & 1 ? 255 : 0;
    }
    return data;
  };
  for (let i = 0; i < api.MAX_EXAMPLES + 8; i += 1) {
    api.addExample(crowded, "Blob", api.shapeFromRgba(noise()));
  }
  assert.equal(crowded.Blob.examples.length, api.MAX_EXAMPLES, "examples are capped");

  // A full species drops its most redundant silhouette, not its oldest (rare outlines survive).
  const full = {};
  const fullRgba = Array.from({ length: api.MAX_EXAMPLES }, noise);
  for (const rgba of fullRgba) api.addExample(full, "Mix", api.shapeFromRgba(rgba));
  assert.equal(full.Mix.examples.length, api.MAX_EXAMPLES);
  const oldest = full.Mix.examples[0];
  const twinSource = full.Mix.examples[5];
  const twinRgba = Uint8ClampedArray.from(fullRgba[5]);
  for (let i = 0; i < 10; i += 1) twinRgba[i * 4 + 3] = twinRgba[i * 4 + 3] ? 0 : 255;
  const twin = api.shapeFromRgba(twinRgba);
  assert.equal(api.hamming(twin, twinSource), 10);
  assert.equal(api.addExample(full, "Mix", twin).added, true);
  assert.equal(full.Mix.examples.length, api.MAX_EXAMPLES);
  assert.ok(full.Mix.examples.includes(oldest), "the oldest distinct silhouette is kept");
  assert.ok(full.Mix.examples.includes(twin) && !full.Mix.examples.includes(twinSource), "the older of the closest pair is dropped");

  // Ranking: a close learned silhouette wins over every other option.
  const ranked = api.rankOptions({ shape: catVariant, options: ["Bird", "Cat", "Dog"], library: { Cat: library.Cat, Bird: { examples: [bird] } } });
  assert.deepEqual(plain(ranked), { species: "Cat", method: "shape-match", distance: 10 });
  // Nothing close: pick among options never learned (the image is probably a new species).
  const unknown = api.rankOptions({ shape: bird, options: ["Cat", "Dog", "Fox"], library: { Cat: library.Cat }, random: () => 0.99 });
  assert.equal(unknown.method, "shape-unknown");
  assert.ok(["Dog", "Fox"].includes(unknown.species), "a species already known to look different is not guessed");
  // Every option learned, none close: nearest wins.
  const nearest = api.rankOptions({ shape: bird, options: ["Cat", "Fish"], library: { Cat: library.Cat, Fish: { examples: [catGenes] } } });
  assert.equal(nearest.method, "shape-nearest");
  // No shape: plain guess among options; no options: nothing.
  assert.equal(api.rankOptions({ shape: null, options: ["Cat"], library }).method, "guess");
  assert.equal(api.rankOptions({ shape: cat, options: [], library }), null);

  // Merge (import): only new silhouettes count.
  const target = { Cat: { examples: [cat] } };
  const merged = api.mergeLibraries(target, { Cat: { examples: [cat, catGenes] }, Bird: { examples: [bird, "junk"] } });
  assert.equal(merged.added, 2);
  assert.deepEqual(Object.keys(target).sort(), ["Bird", "Cat"]);

  // Content world: registers under OWEH.domain when the registry exists.
  assert.ok(loadDomain({ OWEH: {} }).OWEH.domain.speciesShape.rankOptions, "content scripts reach it via OWEH.domain");

  console.log("species shape tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
