"use strict";

(() => {
  const SIZE = 32;
  const BITS = SIZE * SIZE;
  const HEX_LENGTH = BITS / 4;
  const ALPHA_THRESHOLD = 127;
  const MATCH_DISTANCE = 250;
  const MIN_FILLED_BITS = 24;
  const POPCOUNT = Array.from({ length: 16 }, (_, value) =>
    (value & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1));
  const HEX_VALUE = new Uint8Array(128);
  for (let value = 0; value < 16; value += 1) HEX_VALUE[value.toString(16).charCodeAt(0)] = value;

  function validShape(value) {
    return typeof value === "string" && value.length === HEX_LENGTH && /^[0-9a-f]+$/.test(value);
  }

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
    if (filled < MIN_FILLED_BITS || filled > BITS - MIN_FILLED_BITS) return null;
    return hex;
  }

  function hamming(a, b) {
    if (!validShape(a) || !validShape(b)) return BITS;
    let distance = 0;
    for (let i = 0; i < HEX_LENGTH; i += 1) {
      distance += POPCOUNT[HEX_VALUE[a.charCodeAt(i)] ^ HEX_VALUE[b.charCodeAt(i)]];
    }
    return distance;
  }

  function rankOptions(shape, options) {
    const names = [...new Set((options || []).map(String).filter(Boolean))];
    if (!names.length) return null;
    if (!validShape(shape)) return { species: names[0], method: "fallback", distance: null };
    const library = globalThis.OWEH_STATIC_SPECIES?.library || {};
    const scored = [];
    for (const species of names) {
      const examples = Array.isArray(library?.[species]?.examples) ? library[species].examples : [];
      let best = BITS;
      for (const example of examples) best = Math.min(best, hamming(shape, example));
      scored.push({ species, known: examples.length > 0, distance: examples.length ? best : null });
    }
    const known = scored.filter(item => item.known).sort((a,b) => a.distance - b.distance);
    const unknown = scored.filter(item => !item.known);
    if (known[0] && known[0].distance <= MATCH_DISTANCE) {
      return { species: known[0].species, method: "shape-match", distance: known[0].distance };
    }
    if (unknown.length) return { species: unknown[0].species, method: "shape-unknown", distance: known[0]?.distance ?? null };
    return known[0] ? { species: known[0].species, method: "shape-nearest", distance: known[0].distance } : null;
  }

  globalThis.OWEH_LITE_SHAPE = Object.freeze({ SIZE, validShape, shapeFromRgba, hamming, rankOptions });
})();
