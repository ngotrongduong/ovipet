"use strict";

// Surplus review (2026-10-05): which owned pets and eggs can be discarded without lowering what
// the breeding program can still produce. Pure and database-only. It replaces the male-only
// cull (strict dominance on all 15 channels by 2 lineages), which flagged 1 egg in 975.
//
// Measured on the owner's 2,718 bred Draconis (40,770 channels): an offspring channel always
// lands inside its parents' [min, max]; when both parents are exactly on the target it is
// exact every time (1,451 of 1,451); when one parent is exact and the other is `d` away it is
// exact about 1 time in d + 1 (1,347 hits against 1,372 predicted). What a pet can pass on in
// one channel is therefore worth 1 / (d + 1), counted over all 15 channels of the five colour
// slots, not Body 1 alone.
//
// A pet is surplus when at least `minReplacements` kept pets of its own sex are worth as much
// in every channel, give or take `tolerance`. An egg has no sex yet, so it needs that many
// replacements among the kept males AND among the kept females. Pedigree is deliberately left
// out (owner decision): with this many replacements a related pair always has an alternative.
(() => {
  if (!globalThis.OWEH?.domain?.colors || !OWEH.domain?.breedingPlan) {
    throw new Error("colors and breeding-plan must load before domain/surplus.js");
  }

  const { TARGET_KEYS, rgb } = OWEH.domain.colors;
  const { isBreedingProgramEnclosure, isCullEnclosure } = OWEH.domain.breedingPlan;

  const DEFAULT_MIN_REPLACEMENTS = 10;
  // 0.05 = five percentage points of pass-on chance: an exact channel must be matched by an
  // exact one, and anything 19 or more off the target counts as equally far.
  const DEFAULT_TOLERANCE = 0.05;
  const KIND_ORDER = Object.freeze({ egg: 0, female: 1, male: 2 });
  const EXAMPLES_SHOWN = 3;

  // 15 per-channel distances to the target, or null when any target slot is unknown.
  function channelDistances(pet, target) {
    const vector = [];
    for (const key of TARGET_KEYS) {
      const actual = pet?.colors?.[key];
      const wanted = target?.[key];
      if (!actual || !wanted) return null;
      const a = rgb(actual);
      const w = rgb(wanted);
      for (let index = 0; index < 3; index += 1) vector.push(Math.abs(a[index] - w[index]));
    }
    return vector;
  }

  const channelWorth = distances => distances.map(distance => 1 / (distance + 1));

  function covers(better, worse, tolerance) {
    for (let index = 0; index < better.length; index += 1) {
      if (better[index] < worse[index] - tolerance) return false;
    }
    return true;
  }

  const sexOf = pet => {
    const gender = String(pet?.gender || "").toLowerCase();
    return gender === "female" || gender === "male" ? gender : null;
  };

  // Species in the breeding program (any pet in Males / Breeding Stock / pure-line enclosures).
  function programSpecies(pets) {
    const species = new Set();
    for (const pet of Object.values(pets || {})) {
      if (pet?.owned && pet.present !== false && pet.species && isBreedingProgramEnclosure(pet.enclosure)) {
        species.add(pet.species);
      }
    }
    return species;
  }

  // Pets referenced by a breeding preview, queue or candidate list must stay where they are.
  function protectedIdsFromQueues(...queues) {
    const ids = new Set();
    for (const queue of queues) {
      for (const row of Array.isArray(queue) ? queue : []) {
        if (row?.id) ids.add(String(row.id));
        if (row?.maleId) ids.add(String(row.maleId));
        for (const candidate of row?.maleCandidates || []) {
          if (candidate?.maleId) ids.add(String(candidate.maleId));
        }
      }
    }
    return ids;
  }

  // Why a surplus pet must stay anyway, or null. A hatched pet whose Generated flag was never
  // read is held as "unchecked" until Update database reads its profile once. Whether an egg
  // from the generator shows the wand icon is not known, so an egg is only listed when its
  // pedigree was read and names its parents: an egg that was bred, not generated.
  function holdReason(pet, kind, protectedIds) {
    if (pet?.generated === true) return "generated";
    if (kind === "egg") {
      const parents = pet?.parentIds?.length ? pet.parentIds : (pet?.ancestors || []);
      if (pet?.pedigreeVerified !== true || !parents.length) return "unchecked";
    } else if (pet?.generated !== false) {
      return "unchecked";
    }
    if (protectedIds.has(String(pet.id))) return "protected";
    return null;
  }

  const colorKey = pet => TARGET_KEYS.map(key => String(pet?.colors?.[key] || "").replace("#", "").toUpperCase()).join("-");

  // options.eggIds: ids listed as eggs in the live Hatchery panel. A record is an egg only when
  // its id is in that list; without the list no egg is reviewed.
  function planSurplus(pets, target, options = {}) {
    const minReplacements = Math.max(1, Math.floor(Number(options.minReplacements) || DEFAULT_MIN_REPLACEMENTS));
    const tolerance = Number.isFinite(Number(options.tolerance)) && Number(options.tolerance) >= 0
      ? Number(options.tolerance) : DEFAULT_TOLERANCE;
    const protectedIds = new Set([...(options.protectedIds || [])].map(String));
    const eggIds = new Set([...(options.eggIds || [])].map(String));
    const species = options.species ? new Set(options.species) : programSpecies(pets);
    const count = () => ({ egg: 0, female: 0, male: 0 });
    const summary = {
      minReplacements, tolerance, species: [...species].sort(),
      considered: count(), surplus: count(), kept: count(),
      generated: 0, unchecked: 0, protected: 0, incomplete: 0, eggsNotIndexed: 0
    };

    const groups = new Map();
    let eggsSeen = 0;
    for (const pet of Object.values(pets || {})) {
      if (!pet?.owned || !/^\d+$/.test(String(pet.id || ""))) continue;
      const id = String(pet.id);
      const isEgg = eggIds.has(id);
      const sex = sexOf(pet);
      if (!isEgg && (pet.present === false || !sex)) continue;
      // A record without a species is never compared: it would be pooled with strangers.
      if (!pet.species) {
        summary.incomplete += 1;
        continue;
      }
      if (!species.has(pet.species)) continue;
      const distances = channelDistances(pet, target);
      // A record with a sex that the Hatchery still lists as an egg contradicts itself.
      if (!distances || (isEgg && sex)) {
        summary.incomplete += 1;
        continue;
      }
      if (isEgg) eggsSeen += 1;
      const worth = channelWorth(distances);
      if (!groups.has(pet.species)) groups.set(pet.species, { egg: [], female: [], male: [] });
      groups.get(pet.species)[isEgg ? "egg" : sex].push({
        pet, id, kind: isEgg ? "egg" : sex, worth,
        score: worth.reduce((sum, value) => sum + value, 0),
        exactChannels: distances.filter(value => value === 0).length,
        distance: distances.reduce((sum, value) => sum + value, 0)
      });
    }
    summary.eggsNotIndexed = Math.max(0, eggIds.size - eggsSeen);

    const byScore = (a, b) => b.score - a.score || a.id.localeCompare(b.id, undefined, { numeric: true });
    const rows = [];
    const addRow = (entry, replacements, examples, extra = {}) => {
      summary.surplus[entry.kind] += 1;
      rows.push({
        id: entry.id,
        name: entry.pet.name || entry.id,
        kind: entry.kind,
        species: entry.pet.species,
        enclosure: entry.pet.enclosure || null,
        colors: colorKey(entry.pet),
        exactChannels: entry.exactChannels,
        distance: entry.distance,
        score: Math.round(entry.score * 100) / 100,
        replacements,
        examples: examples.slice(0, EXAMPLES_SHOWN).map(other => ({ id: other.id, name: other.pet.name || other.id })),
        ...extra
      });
    };

    for (const group of groups.values()) {
      const kept = { female: [], male: [] };
      for (const sex of ["female", "male"]) {
        // Best first, so everything that could replace a pet was already decided. Pets already
        // moved to Males discard are reviewed last and never count as a replacement.
        const inProgram = group[sex].filter(entry => !isCullEnclosure(entry.pet.enclosure)).sort(byScore);
        const penned = group[sex].filter(entry => isCullEnclosure(entry.pet.enclosure)).sort(byScore);
        for (const entry of [...inProgram, ...penned]) {
          summary.considered[sex] += 1;
          const penPet = isCullEnclosure(entry.pet.enclosure);
          const replacements = kept[sex].filter(other => covers(other.worth, entry.worth, tolerance));
          const hold = holdReason(entry.pet, sex, protectedIds);
          if (replacements.length >= minReplacements && !hold) {
            addRow(entry, replacements.length, replacements);
            continue;
          }
          if (replacements.length >= minReplacements) summary[hold] += 1;
          if (!penPet) kept[sex].push(entry);
          summary.kept[sex] += 1;
        }
      }
      for (const entry of group.egg.sort(byScore)) {
        summary.considered.egg += 1;
        const males = kept.male.filter(other => covers(other.worth, entry.worth, tolerance));
        const females = kept.female.filter(other => covers(other.worth, entry.worth, tolerance));
        const enough = males.length >= minReplacements && females.length >= minReplacements;
        const hold = holdReason(entry.pet, "egg", protectedIds);
        if (enough && !hold) {
          addRow(entry, Math.min(males.length, females.length), [...females.slice(0, 2), ...males.slice(0, 2)],
            { replacementMales: males.length, replacementFemales: females.length });
          continue;
        }
        if (enough) summary[hold] += 1;
        summary.kept.egg += 1;
      }
    }

    // Worst first inside each kind, so a run limited to a few rows starts with the least useful.
    rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.score - b.score
      || a.id.localeCompare(b.id, undefined, { numeric: true }));
    return { rows, summary };
  }

  OWEH.domain.surplus = Object.freeze({
    DEFAULT_MIN_REPLACEMENTS,
    DEFAULT_TOLERANCE,
    channelDistances,
    channelWorth,
    covers,
    colorKey,
    programSpecies,
    protectedIdsFromQueues,
    holdReason,
    planSurplus
  });
})();
