"use strict";

// v5.6.0 male cull review. Pure and database-only: it decides which males can leave the
// breeding program without lowering any female's best achievable pure chance.
//
// Every strict-target channel is an endpoint (00 or FF), and offspring land inside the
// parents' [min, max] range. So for ANY female, a male that is at least as close to the
// target on all 15 channels gives a range that is never wider and never misses an endpoint
// the other male would reach. A male dominated that way is redundant; the only thing it could
// still offer is a different pedigree, which is why a male is culled only when at least
// `minDominators` kept males from distinct lineages dominate it.
(() => {
  if (!globalThis.OWEH?.domain?.colors || !OWEH.domain?.pedigree || !OWEH.domain?.breedingPlan) {
    throw new Error("colors, pedigree and breeding-plan must load before domain/male-cull.js");
  }

  const { TARGET_KEYS, rgb } = OWEH.domain.colors;
  const { lineageKey } = OWEH.domain.pedigree;
  const { isBreedingProgramEnclosure, isCullEnclosure, hasEndpointColorPair } = OWEH.domain.breedingPlan;
  const REASONS = Object.freeze({ NO_ENDPOINT_PAIR: "no-endpoint-pair", DOMINATED: "dominated" });

  const DEFAULT_MIN_DOMINATORS = 2;
  const CHANNEL_NAMES = Object.freeze(["R", "G", "B"]);
  const CHANNEL_LABELS = Object.freeze(TARGET_KEYS.flatMap(key => CHANNEL_NAMES.map(name => `${key}.${name}`)));

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

  function dominatesOrEqual(better, worse) {
    for (let index = 0; index < better.length; index += 1) {
      if (better[index] > worse[index]) return false;
    }
    return true;
  }

  const isOwnedPresent = pet => pet?.owned && pet.present !== false && !isCullEnclosure(pet.enclosure);

  // Species in the breeding program (any pet in Males / Breeding Stock / pure-line enclosures).
  // Males of other species are never reviewed: they are not part of this pure project.
  function programSpecies(pets) {
    const species = new Set();
    for (const pet of Object.values(pets || {})) {
      if (isOwnedPresent(pet) && isBreedingProgramEnclosure(pet.enclosure)) species.add(pet.species || "Unknown");
    }
    return species;
  }

  function channelCoverage(pets, species, target, keptMaleIds) {
    const coverage = {};
    for (const name of species) {
      coverage[name] = {
        channels: CHANNEL_LABELS.map(label => ({ label, maleExact: 0, femaleExact: 0 })),
        missing: []
      };
    }
    for (const pet of Object.values(pets || {})) {
      if (!isOwnedPresent(pet)) continue;
      const row = coverage[pet.species || "Unknown"];
      if (!row) continue;
      const isMale = pet.gender === "Male";
      if (isMale && !keptMaleIds.has(String(pet.id))) continue;
      if (!isMale && pet.gender !== "Female") continue;
      const vector = channelDistances(pet, target);
      if (!vector) continue;
      vector.forEach((distance, index) => {
        if (distance !== 0) return;
        if (isMale) row.channels[index].maleExact += 1;
        else row.channels[index].femaleExact += 1;
      });
    }
    for (const row of Object.values(coverage)) {
      row.missing = row.channels.filter(item => !item.maleExact && !item.femaleExact).map(item => item.label);
    }
    return coverage;
  }

  // Males referenced by a breeding preview, queue or candidate list must stay where they are.
  function protectedMaleIds(...queues) {
    const ids = new Set();
    for (const queue of queues) {
      for (const row of Array.isArray(queue) ? queue : []) {
        if (row?.maleId) ids.add(String(row.maleId));
        for (const candidate of row?.maleCandidates || []) {
          if (candidate?.maleId) ids.add(String(candidate.maleId));
        }
      }
    }
    return ids;
  }

  // Why a cull-worthy male must stay anyway, or null. Generated males are never culled; a male
  // whose Generated flag was never read (records from before v5.6.1) is held as "unchecked"
  // until Update database reads its profile once.
  function keepReason(pet, protectedIds) {
    if (pet?.generated === true) return "generated";
    if (pet?.generated !== false) return "unchecked";
    if (protectedIds.has(String(pet.id))) return "protected";
    return null;
  }

  function planMaleCull(pets, target, options = {}) {
    const minDominators = Math.max(1, Math.floor(Number(options.minDominators) || DEFAULT_MIN_DOMINATORS));
    const protectedIds = new Set([...(options.protectedIds || [])].map(String));
    const species = options.species ? new Set(options.species) : programSpecies(pets);
    const summary = {
      considered: 0, keep: 0, cull: 0, protected: 0, generated: 0, unchecked: 0, incomplete: 0,
      noPair: 0, dominated: 0, minDominators, species: [...species].sort()
    };

    const cull = [];
    const keptIds = new Set();
    const bySpecies = new Map();
    for (const pet of Object.values(pets || {})) {
      if (!isOwnedPresent(pet) || pet.gender !== "Male" || !species.has(pet.species || "Unknown")) continue;
      const vector = channelDistances(pet, target);
      if (!vector) {
        summary.incomplete += 1;
        continue;
      }
      const id = String(pet.id);
      // v5.6.1: a male with no aligned FF or 00 pair (RR|GG|BB) in any of the five slots can
      // never hand an endpoint channel to a child, so it goes — unless it is Generated or
      // protected. "EFF1F0" has FF only across a pair boundary and does not count.
      if (!hasEndpointColorPair(pet)) {
        summary.considered += 1;
        const hold = keepReason(pet, protectedIds);
        if (hold) {
          summary[hold] += 1;
          keptIds.add(id);
          continue;
        }
        summary.noPair += 1;
        cull.push({
          id,
          name: pet.name || id,
          species: pet.species || "Unknown",
          enclosure: pet.enclosure || null,
          reason: REASONS.NO_ENDPOINT_PAIR,
          exactChannels: vector.filter(value => value === 0).length,
          distance: vector.reduce((sum, value) => sum + value, 0),
          dominatorCount: 0,
          dominatorLineages: 0,
          dominators: []
        });
        continue;
      }
      const entry = {
        pet,
        vector,
        distance: vector.reduce((sum, value) => sum + value, 0),
        exactChannels: vector.filter(value => value === 0).length,
        lineage: lineageKey(pet)
      };
      const key = pet.species || "Unknown";
      if (!bySpecies.has(key)) bySpecies.set(key, []);
      bySpecies.get(key).push(entry);
    }

    for (const entries of bySpecies.values()) {
      // A strict dominator always has a smaller total distance, so walking best-first means every
      // possible dominator was already decided. Equal vectors are ordered by the tie-breakers, so
      // among identical males the first ones stay as redundancy and later copies can go.
      entries.sort((a, b) => a.distance - b.distance
        || b.exactChannels - a.exactChannels
        || Number(b.pet.pedigreeVerified === true) - Number(a.pet.pedigreeVerified === true)
        || String(a.pet.id).localeCompare(String(b.pet.id), undefined, { numeric: true }));
      const kept = [];
      for (const entry of entries) {
        summary.considered += 1;
        const dominators = kept.filter(other => dominatesOrEqual(other.vector, entry.vector));
        const lineages = new Set(dominators.map(other => other.lineage));
        const id = String(entry.pet.id);
        const hold = keepReason(entry.pet, protectedIds);
        if (lineages.size >= minDominators && hold) summary[hold] += 1;
        if (lineages.size < minDominators || hold) {
          kept.push(entry);
          keptIds.add(id);
          continue;
        }
        // Report one dominator per lineage first — those are the males that justify the cull.
        const seen = new Set();
        const shown = [];
        for (const other of dominators) {
          if (seen.has(other.lineage)) continue;
          seen.add(other.lineage);
          shown.push(other);
          if (shown.length >= 3) break;
        }
        cull.push({
          id,
          name: entry.pet.name || id,
          species: entry.pet.species || "Unknown",
          enclosure: entry.pet.enclosure || null,
          reason: REASONS.DOMINATED,
          exactChannels: entry.exactChannels,
          distance: entry.distance,
          dominatorCount: dominators.length,
          dominatorLineages: lineages.size,
          dominators: shown.map(other => ({ id: String(other.pet.id), name: other.pet.name || String(other.pet.id) }))
        });
      }
    }
    cull.sort((a, b) => a.species.localeCompare(b.species) || b.distance - a.distance || a.id.localeCompare(b.id));
    summary.cull = cull.length;
    summary.dominated = cull.length - summary.noPair;
    summary.keep = keptIds.size;
    summary.coverage = channelCoverage(pets, species, target, keptIds);
    return { cull, keepIds: [...keptIds], summary };
  }

  OWEH.domain.maleCull = Object.freeze({
    DEFAULT_MIN_DOMINATORS,
    CHANNEL_LABELS,
    REASONS,
    keepReason,
    channelDistances,
    dominatesOrEqual,
    programSpecies,
    protectedMaleIds,
    planMaleCull
  });
})();
