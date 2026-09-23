"use strict";

// jobs/species-seed.js: seeds the silhouette library from own pets and the Adoption Center.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const SIZE = 32;

function rgbaRect(x0, y0, x1, y1) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[(y * SIZE + x) * 4 + 3] = 255;
  return data;
}

function setup({ hostname = "ovipets.com", store = {} } = {}) {
  const images = {
    "https://app.ovipets.com/img/pet/11": rgbaRect(4, 4, 20, 28),
    "https://app.ovipets.com/img/pet/12": rgbaRect(10, 0, 32, 12),
    "https://app.ovipets.com/img/pet/21": rgbaRect(0, 16, 30, 32),
    "https://app.ovipets.com/img/pet/22": null
  };
  const profiles = {
    21: '{"html":"<div class = \\"label\\"><p>Species<\\/p><\\/div><div class = \\"value\\"><p>Lupus</p></div>"}',
    22: '{"html":"<p>Species<\\/p><\\/div><div class = \\"value\\"><p>Avi</p>"}'
  };
  const fetched = [];
  const learned = [];
  const statuses = [];
  class Image {
    set src(url) {
      this._src = url;
      Promise.resolve().then(() => (images[url] ? this.onload() : this.onerror()));
    }
  }
  const document = {
    createElement: () => {
      let drawn = null;
      return { getContext: () => ({ drawImage: image => { drawn = images[image._src]; }, getImageData: () => ({ data: drawn }) }) };
    }
  };
  const sandbox = vm.createContext({
    console: { warn() {}, error() {} }, Promise, Date, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp, Error,
    Image, document, location: { hostname },
    fetch: async url => {
      fetched.push(url);
      if (url.startsWith("/?src=adoption_center")) return { ok: true, text: async () => "cb('#!/?src=pets&sub=profile&pet=21 pet=22 pet=11')" };
      const id = (url.match(/pet=(\d+)/) || [])[1];
      return profiles[id] ? { ok: true, text: async () => profiles[id] } : { ok: false, status: 404 };
    }
  });
  for (const file of ["jobs/core.js", "domain/species-shape.js", "jobs/species-seed.js"]) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  const shapeApi = sandbox.OWEH.domain.speciesShape;
  const helpers = {
    storageGet: async (key, fallback) => (key in store ? JSON.parse(JSON.stringify(store[key])) : fallback),
    storageSet: async values => { Object.assign(store, JSON.parse(JSON.stringify(values))); },
    sleep: async () => {},
    setStatus: text => statuses.push(text),
    runtimeRequest: async message => {
      assert.equal(message.type, "speciesShapeLearn");
      learned.push({ species: message.species, shape: message.shape });
      const library = store.owehSpeciesShapes || {};
      const { added } = shapeApi.addExample(library, message.species, message.shape);
      store.owehSpeciesShapes = library;
      return { ok: true, added };
    }
  };
  const modules = sandbox.OWEH.boot(helpers);
  return { job: modules["species-seed"], store, fetched, learned, statuses, shapeApi };
}

(async () => {
  const store = {
    owehPets: {
      11: { id: "11", species: "Feline" },
      12: { id: "12", species: "Avi" },
      99: { id: "99" }
    }
  };
  const { job, fetched, learned, statuses } = setup({ store });
  assert.ok(job.buttons["#oweh-species-seed-start"] && job.buttons["#oweh-species-seed-stop"]);

  const totals = await job.api.start();
  // Own pets (11, 12) first, then Adoption Center pets 21 (Lupus) and 22 (image fails); 11 is not re-checked.
  assert.deepEqual(learned.map(entry => entry.species), ["Feline", "Avi", "Lupus"]);
  assert.equal(totals.added, 3);
  assert.equal(totals.failed, 1, "a pet image without a silhouette is counted as failed");
  assert.deepEqual(Object.keys(store.owehSpeciesShapes).sort(), ["Avi", "Feline", "Lupus"]);
  assert.deepEqual([...store.owehSpeciesSeedSeen].sort(), ["11", "12", "21", "22"]);
  assert.ok(fetched.every(url => url.startsWith("/?src=")), "only same-origin OviPets pages are fetched");
  assert.ok(/finished/.test(statuses.at(-1)));

  // A second run skips everything already seen.
  learned.length = 0;
  const again = await job.api.start();
  assert.equal(again.scanned, 0);
  assert.equal(learned.length, 0);

  // Outside ovipets.com only own pets are used; the Adoption Center is never fetched.
  const away = setup({ hostname: "app.ovipets.com", store: { owehPets: { 11: { species: "Feline" } } } });
  await away.job.api.start();
  assert.equal(away.fetched.length, 0);
  assert.deepEqual(away.learned.map(entry => entry.species), ["Feline"]);
  assert.ok(/open ovipets\.com/.test(away.statuses.at(-1)));

  // Stop ends the run early.
  const stopped = setup({ store: { owehPets: { 11: { species: "Feline" }, 12: { species: "Avi" } } } });
  const running = stopped.job.api.start();
  stopped.job.api.stop();
  const result = await running;
  assert.ok(result.scanned <= 1);
  assert.ok(/stopped/.test(stopped.statuses.at(-1)));

  // Profile parsing works on the escaped JSONP payload.
  assert.equal(await stopped.job.api.profileSpecies(21), "Lupus");

  console.log("species seed tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
