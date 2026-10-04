"use strict";

// Best-egg ranking (2026-10-05): which eggs in the Hatchery are closest to the pure target,
// counting Body 1 first, then Body 2, Scales, Extra 1 and Extra 2 (owner's priority order).
// Pure and read-only; it decides nothing about keeping or discarding.
//
// Closeness uses the same per-channel scale as domain/surplus.js: a channel that is `d` away
// from the target is worth 1 / (d + 1), so an exact channel counts fully and "almost there"
// counts far more than "somewhere near". A slot is the sum of its three channels (0..3),
// multiplied by the slot's weight; the best possible egg scores 45.
(() => {
  if (!globalThis.OWEH?.domain?.colors) throw new Error("domain/colors.js must load before domain/egg-rank.js");

  const { TARGET_KEYS, rgb } = OWEH.domain.colors;
  const SLOT_WEIGHTS = Object.freeze({ body1: 5, body2: 4, scales: 3, extra1: 2, extra2: 1 });
  const MAX_SCORE = 3 * Object.values(SLOT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const DEFAULT_COUNT = 10;
  const MAX_COUNT = 50;

  // colors: { body1: "#RRGGBB", ... }. Null when any of the five slots is unknown.
  function scoreColors(colors, target) {
    let score = 0;
    let exactChannels = 0;
    let distance = 0;
    const slots = {};
    for (const key of TARGET_KEYS) {
      if (!colors?.[key] || !target?.[key]) return null;
      const actual = rgb(colors[key]);
      const wanted = rgb(target[key]);
      let slot = 0;
      for (let index = 0; index < 3; index += 1) {
        const delta = Math.abs(actual[index] - wanted[index]);
        slot += 1 / (delta + 1);
        distance += delta;
        if (delta === 0) exactChannels += 1;
      }
      slots[key] = slot;
      score += slot * SLOT_WEIGHTS[key];
    }
    return { score, exactChannels, distance, slots };
  }

  function clampCount(value) {
    const count = Math.floor(Number(value));
    return Number.isFinite(count) && count >= 1 ? Math.min(MAX_COUNT, count) : DEFAULT_COUNT;
  }

  // eggs: [{ id, colors }]. Returns the best `count`, best first; eggs with unknown colours
  // are left out and counted in `unscored`.
  function rankEggs(eggs, target, count = DEFAULT_COUNT) {
    const scored = [];
    let unscored = 0;
    for (const egg of eggs || []) {
      const result = scoreColors(egg?.colors, target);
      if (!result || egg?.id == null) {
        unscored += 1;
        continue;
      }
      scored.push({ id: String(egg.id), colors: egg.colors, ...result });
    }
    scored.sort((a, b) => b.score - a.score || a.distance - b.distance
      || a.id.localeCompare(b.id, undefined, { numeric: true }));
    return {
      scored: scored.length,
      unscored,
      best: scored.slice(0, clampCount(count)).map((egg, index) => ({ ...egg, rank: index + 1 }))
    };
  }

  OWEH.domain.eggRank = Object.freeze({ SLOT_WEIGHTS, MAX_SCORE, DEFAULT_COUNT, MAX_COUNT, scoreColors, clampCount, rankEggs });
})();
