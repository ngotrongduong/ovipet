"use strict";

// Learn Species Shapes (v5.4.1): seeds the silhouette library (domain/species-shape.js) from
// pets whose species is already known in the Adoption Center. A normal pet image (/img/pet/<id>)
// is rendered in the same 500x500 frame as the Name the Species challenge, so its 32x32 alpha
// mask is a valid example. The job only reads public pages and images; it never clicks, adopts
// or changes anything. v5.5.1: own pets are no longer a source — a collection is usually one or
// two species, so they add little variety; Species Review labels already teach their silhouette.
OWEH.register("species-seed", helpers => {
  const { storageGet, storageSet, sleep, setStatus, runtimeRequest } = helpers;
  const SEEN_KEY = "owehSpeciesSeedSeen";
  const SHAPES_KEY = "owehSpeciesShapes";
  const MAX_SEEN = 5000;
  const ADOPTION_ROUNDS = 3;
  const REQUEST_DELAY_MS = 150;
  const SPECIES_PATTERN = /<p>Species<\\?\/p><\\?\/div><div class ?= ?\\?"value\\?"><p>([^<]+)</;
  let running = false;
  let stopRequested = false;

  const api = () => OWEH.domain?.speciesShape;
  const petImageUrl = id => `https://app.ovipets.com/img/pet/${id}`;

  async function fetchText(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  // Adoption Center list (JSONP, needs the logged-in session): pet ids only.
  async function adoptionIds() {
    const text = await fetchText(`/?src=adoption_center&!=cb&_=${Date.now()}`);
    return [...new Set([...text.matchAll(/pet=(\d+)/g)].map(match => match[1]))];
  }

  async function profileSpecies(id) {
    const text = await fetchText(`/?src=pets&sub=profile&usr=0&pet=${id}&!=cb`);
    const match = text.match(SPECIES_PATTERN);
    return match ? match[1].trim() : null;
  }

  function shapeOfImage(url) {
    const shapeApi = api();
    return new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = shapeApi.SIZE;
          canvas.height = shapeApi.SIZE;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, shapeApi.SIZE, shapeApi.SIZE);
          resolve(shapeApi.shapeFromRgba(context.getImageData(0, 0, shapeApi.SIZE, shapeApi.SIZE).data));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  async function learn(species, shape) {
    const result = await runtimeRequest({ type: "speciesShapeLearn", species, shape });
    return Boolean(result?.ok && result.added);
  }

  async function run() {
    const shapeApi = api();
    if (!shapeApi) throw new Error("Species shape matcher is not loaded");
    if (location.hostname !== "ovipets.com") {
      setStatus("Learn Species Shapes reads the Adoption Center — open ovipets.com and press it again");
      return { scanned: 0, added: 0, failed: 0 };
    }
    running = true;
    stopRequested = false;
    const seen = new Set((await storageGet(SEEN_KEY, [])).map(String));
    const library = await storageGet(SHAPES_KEY, {});
    const counts = {};
    for (const [species, record] of Object.entries(library || {})) counts[species] = record?.examples?.length || 0;
    // A full species still learns: the library drops its most redundant silhouette instead.
    const totals = { scanned: 0, added: 0, failed: 0 };
    const report = source => setStatus(`Learn Species Shapes (${source}) — ${totals.scanned} pet(s) checked, ${totals.added} new silhouette(s), ${Object.keys(counts).length} species known`);

    const process = async (id, species, source) => {
      seen.add(id);
      totals.scanned += 1;
      if (!species) return;
      const shape = await shapeOfImage(petImageUrl(id));
      if (!shape) { totals.failed += 1; return; }
      if (await learn(species, shape)) {
        totals.added += 1;
        counts[species] = Math.min((counts[species] || 0) + 1, shapeApi.MAX_EXAMPLES);
      }
      report(source);
    };

    try {
      for (let round = 0; round < ADOPTION_ROUNDS && !stopRequested; round += 1) {
        let ids = [];
        try { ids = await adoptionIds(); } catch (error) { console.warn("[OviPets Helper] Adoption Center list failed", error); }
        for (const id of ids) {
          if (stopRequested) break;
          if (seen.has(id)) continue;
          let species = null;
          try { species = await profileSpecies(id); } catch { totals.failed += 1; }
          await process(id, species, "Adoption Center");
          await sleep(REQUEST_DELAY_MS);
        }
        if (round + 1 < ADOPTION_ROUNDS) await sleep(1500);
      }
    } finally {
      running = false;
      await storageSet({ [SEEN_KEY]: [...seen].slice(-MAX_SEEN) });
    }
    setStatus(`Learn Species Shapes ${stopRequested ? "stopped" : "finished"} — ${totals.scanned} pet(s) checked, ${totals.added} new silhouette(s), ${Object.keys(counts).length} species known`);
    return totals;
  }

  async function start() {
    if (running) {
      setStatus("Learn Species Shapes is already running");
      return null;
    }
    return run();
  }

  function stop() {
    stopRequested = true;
    setStatus(running ? "Stopping Learn Species Shapes after the current pet..." : "Learn Species Shapes is not running");
  }

  return {
    api: { start, stop, profileSpecies, adoptionIds, isRunning: () => running },
    buttons: {
      "#oweh-species-seed-start": { label: "Starting Learn Species Shapes", handler: start },
      "#oweh-species-seed-stop": { label: "Stopping Learn Species Shapes", handler: stop }
    }
  };
});
