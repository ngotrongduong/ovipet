"use strict";

// Silhouette matcher for the "Name the Species" challenge image (v5.4.0, tuned in v5.4.1).
//
// The challenge image (/img/pet/<id>/credit-challenge, 500x500 PNG with alpha) shows a RANDOM
// species with random colors and random genes, so the old 16x16 luminance hash never repeated
// across eggs and the answerer kept guessing (live: 336 correct out of 4617 detected). The pose
// of each species is roughly fixed, though, and normal pet images (/img/pet/<id>) are rendered
// in the same 500x500 frame. Measured live on 129 Adoption Center pets (31 species), 32x32 alpha
// mask (alpha > 127): nearest same-species distance p10/p50/p90 = 64/114/217 of 1024 bits,
// nearest other-species 135/175/216; leave-one-out nearest-neighbour with 4 options = ~87%.
// A 44-bit threshold (v5.4.0) almost never fired. v5.4.3 re-measured on 47 REAL confirmed
// challenge images (the challenge pool looks limited to ~10 species): same-species 103/171/259
// against an Adoption-only library, so at 150 the "unknown option" branch fired on most images
// and was right only 16% of the time. Accuracy by threshold (4 options):
//   library              T=150  T=200  T=250  nearest-only
//   adoption only        52%    69%    72%    74%
//   adoption+challenges  86%    85%    86%    86%
// 250 is robust across library mixes. This module is pure (no DOM/chrome), shared by the
// content world and the service worker.
(() => {
  const SIZE = 32;
  const BITS = SIZE * SIZE;
  const HEX_LENGTH = BITS / 4;
  const ALPHA_THRESHOLD = 127;
  // A known species closer than this is taken as the answer; beyond it, an option with no
  // examples yet is the better bet (the image is probably a species we have never learned).
  const MATCH_DISTANCE = 250;
  const DEDUPE_DISTANCE = 6;
  // Mutations change the outline a lot, so many variants per species are kept (~38 KB per species).
  const MAX_EXAMPLES = 150;
  const MIN_FILLED_BITS = 24;
  const POPCOUNT = Array.from({ length: 16 }, (_, value) =>
    (value & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1));
  // charCode of "0"-"9"/"a"-"f" -> nibble value (hamming runs O(n^2) when a species is full).
  const HEX_VALUE = new Uint8Array(128);
  for (let value = 0; value < 16; value += 1) HEX_VALUE[value.toString(16).charCodeAt(0)] = value;

  function validShape(value) {
    return typeof value === "string" && value.length === HEX_LENGTH && /^[0-9a-f]+$/.test(value);
  }

  // rgba: SIZE x SIZE RGBA bytes (a CanvasImageData.data after drawing the image at 32x32).
  function shapeFromRgba(rgba) {
    if (!rgba || rgba.length < BITS * 4) return null;
    let hex = "";
    let filled = 0;
    for (let nibble = 0; nibble < HEX_LENGTH; nibble += 1) {
      let value = 0;
      for (let bit = 0; bit < 4; bit += 1) {
        const on = rgba[(nibble * 4 + bit) * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
        value = (value << 1) | on;
        filled += on;
      }
      hex += value.toString(16);
    }
    // A fully opaque or empty mask carries no silhouette (JPEG, missing alpha, blank image).
    if (filled < MIN_FILLED_BITS || filled > BITS - MIN_FILLED_BITS) return null;
    return hex;
  }

  function hamming(a, b) {
    if (!validShape(a) || !validShape(b)) return BITS;
    let distance = 0;
    for (let index = 0; index < HEX_LENGTH; index += 1) {
      distance += POPCOUNT[HEX_VALUE[a.charCodeAt(index)] ^ HEX_VALUE[b.charCodeAt(index)]];
    }
    return distance;
  }

  function examplesOf(library, species) {
    const examples = library?.[species]?.examples;
    return Array.isArray(examples) ? examples.filter(validShape) : [];
  }

  function nearestDistance(shape, examples) {
    let best = BITS;
    for (const example of examples) best = Math.min(best, hamming(shape, example));
    return best;
  }

  // options: species names still eligible. Returns { species, method, distance } where method is
  // "shape-match" (a learned silhouette is close), "shape-unknown" (nothing close, so pick among
  // species never learned), "shape-nearest" (all options learned, none close) or "guess".
  function rankOptions({ shape, options, library, random = Math.random } = {}) {
    const names = [...new Set((options || []).map(String).filter(Boolean))];
    if (!names.length) return null;
    const pickRandom = list => list[Math.floor(random() * list.length)] || list[0];
    if (!validShape(shape)) return { species: pickRandom(names), method: "guess", distance: null };
    const scored = names.map(species => {
      const examples = examplesOf(library, species);
      return { species, known: examples.length > 0, distance: examples.length ? nearestDistance(shape, examples) : null };
    });
    const known = scored.filter(entry => entry.known).sort((a, b) => a.distance - b.distance);
    const unknown = scored.filter(entry => !entry.known);
    if (known[0] && known[0].distance <= MATCH_DISTANCE) {
      return { species: known[0].species, method: "shape-match", distance: known[0].distance };
    }
    if (unknown.length) return { species: pickRandom(unknown).species, method: "shape-unknown", distance: known[0]?.distance ?? null };
    return { species: known[0].species, method: "shape-nearest", distance: known[0].distance };
  }

  // When a species is full, the most redundant silhouette is dropped instead of the oldest: of
  // the closest pair, the older one goes. A rare mutation outline therefore survives a flood of
  // near-identical common ones.
  function dropMostRedundant(examples) {
    let best = { distance: BITS + 1, index: 0 };
    for (let i = 0; i < examples.length; i += 1) {
      for (let j = i + 1; j < examples.length; j += 1) {
        const distance = hamming(examples[i], examples[j]);
        if (distance < best.distance) best = { distance, index: i };
      }
    }
    return examples.filter((_, index) => index !== best.index);
  }

  // Adds one confirmed silhouette to a library entry. Near-duplicates are skipped; at most
  // MAX_EXAMPLES distinct silhouettes (different genes/extra parts) are kept.
  function addExample(library, species, shape, at = Date.now()) {
    const name = String(species || "").trim();
    if (!name || !validShape(shape)) return { library, added: false };
    const examples = examplesOf(library, name);
    if (examples.some(example => hamming(example, shape) <= DEDUPE_DISTANCE)) return { library, added: false };
    let next = [...examples, shape];
    while (next.length > MAX_EXAMPLES) next = dropMostRedundant(next);
    const added = next.includes(shape);
    library[name] = { examples: next, updatedAt: added ? at : library[name]?.updatedAt || at };
    return { library, added };
  }

  function mergeLibraries(target, incoming) {
    let added = 0;
    for (const [species, record] of Object.entries(incoming || {})) {
      for (const shape of examplesOf({ [species]: record }, species)) {
        if (addExample(target, species, shape, Number(record?.updatedAt || 0) || Date.now()).added) added += 1;
      }
    }
    return { library: target, added };
  }

  const api = Object.freeze({
    SIZE, BITS, HEX_LENGTH, MATCH_DISTANCE, DEDUPE_DISTANCE, MAX_EXAMPLES,
    validShape, shapeFromRgba, hamming, rankOptions, addExample, mergeLibraries
  });
  globalThis.OWEH_SPECIES_SHAPE = api;
  if (globalThis.OWEH) {
    globalThis.OWEH.domain = globalThis.OWEH.domain || {};
    globalThis.OWEH.domain.speciesShape = api;
  }
})();
