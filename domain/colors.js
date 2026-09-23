"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before domain/colors.js");

  const TARGET_KEYS = Object.freeze(["body1", "body2", "scales", "extra1", "extra2"]);
  const PET_NAME_COLOR_KEYS = Object.freeze(["body1", "body2", "scales"]);
  const STRICT_PURE_TARGET = Object.freeze({
    body1: "#FFFFFF",
    body2: "#FF0000",
    scales: "#000000",
    extra1: "#FF0000",
    extra2: "#000000"
  });
  const STRICT_TARGET_CHANNELS = TARGET_KEYS.length * 3;

  // Confirmed live from https://ovipets.com/#!/?src=help&sub=faq ("What types of pure
  // colors are there?") on 2026-09-17 — see docs/dom-audit-2026-09-17.md.
  const PURE_COLORS = Object.freeze({
    White: "FFFFFF", Black: "000000", Red: "FF0000", Green: "00FF00",
    Blue: "0000FF", Yellow: "FFFF00", Magenta: "FF00FF", Cyan: "00FFFF",
    Gray: "808080", Maroon: "800000", Emerald: "008000", Navy: "000080",
    Teal: "008080", Purple: "800080", Olive: "808000", Diamond: "B9F2FF",
    Gold: "FFD700", Silver: "C0C0C0", Bronze: "CD7F32", Orange: "FFA500",
    Pink: "FFC0CB", Brown: "643200", "Robin Egg Blue": "00CCCC",
    "Pale Cornflower Blue": "ABCDEF", Indigo: "4B0082", "Mint Green": "98FF98",
    "Deep Pink": "FF1493", Lavender: "CCCCFF", "Floral White": "FFFAF0",
    "Misty Rose": "FFE4E1", Shamrock: "009E60", Violet: "7F00FF",
    "Light Yellow": "FFFF99", Capri: "00BFFF", Lime: "00FF45",
    "Red-Orange": "FF4500", Crimson: "DC143C", Denim: "1560BD",
    "Jet Black": "0A0A0A", "Forest Green": "014421",
    "Deep Saffron": "FF9933", Walnut: "443028", Chestnut: "954535",
    Pear: "D1E231", Blackberry: "4D0135", Plum: "8E4585",
    Dandelion: "F0E130"
  });

  function hex(value) {
    const raw = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map(char => char + char).join("")}`.toUpperCase();
    return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : null;
  }

  // Planning evaluates every female x shortlisted-male pair, re-parsing the same few hundred
  // hex strings millions of times (profiled at ~70% of plan time). Cache the parsed channels;
  // the arrays are frozen because callers share them.
  const RGB_CACHE_LIMIT = 8192;
  const rgbCache = new Map();

  function rgb(value) {
    let parsed = rgbCache.get(value);
    if (parsed) return parsed;
    parsed = Object.freeze([parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]);
    if (rgbCache.size >= RGB_CACHE_LIMIT) rgbCache.clear();
    rgbCache.set(value, parsed);
    return parsed;
  }

  function slotDistance(a, b) {
    if (!a || !b) return null;
    const left = rgb(a);
    const right = rgb(b);
    return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
  }

  function nearestPureColor(colorHex) {
    if (!colorHex) return null;
    let best = null;
    for (const [name, code] of Object.entries(PURE_COLORS)) {
      const distance = slotDistance(colorHex, `#${code}`);
      if (!best || distance < best.distance) best = { name, hex: `#${code}`, distance };
    }
    return best;
  }

  function suggestedPetName(pet) {
    const parts = PET_NAME_COLOR_KEYS
      .map(key => pet?.colors?.[key]?.replace("#", "").toUpperCase())
      .filter(Boolean);
    return parts.length ? parts.join("-").slice(0, 25) : null;
  }

  function petOffTarget(pet, target) {
    let total = 0;
    let used = 0;
    for (const key of Object.keys(target)) {
      const distance = target[key] && pet?.colors?.[key] ? slotDistance(pet.colors[key], target[key]) : null;
      if (distance === null) continue;
      total += distance;
      used += 1;
    }
    return used ? total : null;
  }

  function petTargetScore(pet, target) {
    let total = 0;
    let used = 0;
    for (const key of TARGET_KEYS) {
      const distance = target[key] && pet?.colors?.[key]
        ? slotDistance(pet.colors[key], target[key])
        : null;
      if (distance === null) continue;
      total += distance;
      used += 1;
    }
    return used ? total / used : Infinity;
  }

  // Ranking uses exact target channels first, then aggregate distance. Keeping this
  // calculation pure makes retention/breeding decisions reproducible in tests.
  function petPureMetrics(pet, target) {
    let exactChannels = 0;
    let usedChannels = 0;
    for (const key of TARGET_KEYS) {
      if (!target[key] || !pet?.colors?.[key]) continue;
      const actual = rgb(pet.colors[key]);
      const wanted = rgb(target[key]);
      for (let index = 0; index < 3; index += 1) {
        if (actual[index] === wanted[index]) exactChannels += 1;
        usedChannels += 1;
      }
    }
    return {
      exactChannels,
      usedChannels,
      distance: usedChannels ? petTargetScore(pet, target) : Infinity
    };
  }

  function comparePetPureMetrics(a, b) {
    return b.pure.exactChannels - a.pure.exactChannels
      || a.pure.distance - b.pure.distance
      || String(a.species || "").localeCompare(String(b.species || ""))
      || String(a.id || "").localeCompare(String(b.id || ""));
  }

  OWEH.domain = OWEH.domain || {};
  OWEH.domain.colors = Object.freeze({
    TARGET_KEYS,
    PET_NAME_COLOR_KEYS,
    STRICT_PURE_TARGET,
    STRICT_TARGET_CHANNELS,
    PURE_COLORS,
    hex,
    rgb,
    slotDistance,
    nearestPureColor,
    suggestedPetName,
    petOffTarget,
    petTargetScore,
    petPureMetrics,
    comparePetPureMetrics
  });
})();
