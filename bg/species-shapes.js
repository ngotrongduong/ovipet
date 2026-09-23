"use strict";

// Serialized store for the Name-the-Species silhouette library (owehSpeciesShapes, v5.4.0).
//
// { [species]: { examples: [256-hex 32x32 alpha masks], updatedAt } }. Up to 15 egg tabs learn
// at once, so every write goes through one promise chain here (same reason as species-memory).
// On first run it also back-fills the library from answers learned before v5.4.0: every
// confirmed credit-challenge URL in owehSpeciesMemory is re-fetched once and its mask stored.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesShapes) return;

  const SHAPES_KEY = "owehSpeciesShapes";
  const MEMORY_KEY = "owehSpeciesMemory";
  const MIGRATION_KEY = "owehSpeciesShapesMigration";
  const MIGRATION_CONCURRENCY = 3;
  const shapeApi = () => globalThis.OWEH_SPECIES_SHAPE;

  let chain = Promise.resolve();
  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  async function read(key, fallback) {
    const value = (await chrome.storage.local.get({ [key]: fallback }))[key];
    return value && typeof value === "object" ? value : fallback;
  }

  function learn(message) {
    const shape = shapeApi();
    const species = String(message?.species || "").trim();
    if (!shape || !species || !shape.validShape(message?.shape)) return Promise.resolve({ ok: false, reason: "invalid-shape" });
    return serialized(async () => {
      const { library, added } = shape.addExample(await read(SHAPES_KEY, {}), species, message.shape);
      if (added) await chrome.storage.local.set({ [SHAPES_KEY]: library });
      return { ok: true, added, species: Object.keys(library).length };
    });
  }

  function merge(message) {
    const shape = shapeApi();
    if (!shape) return Promise.resolve({ ok: false, reason: "shape-module-missing" });
    return serialized(async () => {
      const { library, added } = shape.mergeLibraries(await read(SHAPES_KEY, {}), message?.library || {});
      if (added) await chrome.storage.local.set({ [SHAPES_KEY]: library });
      return { ok: true, added, species: Object.keys(library).length };
    });
  }

  // Service-worker side mask: fetch the guarded challenge image and draw it at 32x32.
  async function shapeFromUrl(url) {
    const shape = shapeApi();
    const allowed = OWEH_BG.speciesImage?.allowedSpeciesImageUrl?.(url);
    if (!shape || !allowed || typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
    const response = await fetch(allowed.href, { credentials: "include", cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`species-shape-http-${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = new OffscreenCanvas(shape.SIZE, shape.SIZE);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, shape.SIZE, shape.SIZE);
      return shape.shapeFromRgba(context.getImageData(0, 0, shape.SIZE, shape.SIZE).data);
    } finally {
      bitmap.close?.();
    }
  }

  function confirmedSpecies(record) {
    const species = String(record?.species || "").trim();
    if (!species || record?.wrong?.[species] || !Number(record?.votes?.[species] || 0)) return null;
    return species;
  }

  // Resumable: processed keys are saved after every batch, so a service-worker restart continues.
  // A fetch that threw (offline, logged out) is retried on a later start, at most MAX_RUNS times.
  const MAX_RUNS = 3;
  let migrating = null;
  function migrateFromMemory() {
    if (migrating) return migrating;
    migrating = (async () => {
      const state = await read(MIGRATION_KEY, {});
      if (state.done) return { ok: true, skipped: true };
      const runs = Number(state.runs || 0) + 1;
      const processed = new Set(Array.isArray(state.processed) ? state.processed : []);
      const memory = await read(MEMORY_KEY, {});
      const pending = Object.entries(memory)
        .filter(([key, record]) => !processed.has(key) && OWEH_BG.speciesImage?.allowedSpeciesImageUrl?.(key) && confirmedSpecies(record));
      let added = 0;
      let failed = 0;
      for (let index = 0; index < pending.length; index += MIGRATION_CONCURRENCY) {
        const batch = pending.slice(index, index + MIGRATION_CONCURRENCY);
        const shapes = await Promise.all(batch.map(([key]) => shapeFromUrl(key).then(shape => ({ shape }), () => ({ error: true }))));
        for (let item = 0; item < batch.length; item += 1) {
          const [key, record] = batch[item];
          if (shapes[item].error) { failed += 1; continue; }
          processed.add(key);
          if (shapes[item].shape) {
            const result = await learn({ species: confirmedSpecies(record), shape: shapes[item].shape });
            if (result?.added) added += 1;
          }
        }
        await chrome.storage.local.set({ [MIGRATION_KEY]: { done: false, runs: runs - 1, processed: [...processed], updatedAt: Date.now() } });
      }
      const done = !failed || runs >= MAX_RUNS;
      await chrome.storage.local.set({
        [MIGRATION_KEY]: { done, runs, processed: done ? [] : [...processed], added, failed, updatedAt: Date.now() }
      });
      return { ok: true, added, failed, scanned: pending.length, done };
    })().finally(() => { migrating = null; });
    return migrating;
  }

  OWEH_BG.speciesShapes = Object.freeze({ learn, merge, shapeFromUrl, migrateFromMemory, SHAPES_KEY });
})();
