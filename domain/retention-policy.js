"use strict";

(() => {
  if (!globalThis.OWEH?.domain?.colors || !OWEH.domain?.pedigree || !OWEH.domain?.breedingScore || !OWEH.domain?.breedingPlan) {
    throw new Error("colors, pedigree, breeding-score and breeding-plan must load before domain/retention-policy.js");
  }

  const { TARGET_KEYS, rgb, petPureMetrics } = OWEH.domain.colors;
  const { pedigreeCompatibility, lineageKey } = OWEH.domain.pedigree;
  const { pairPureMetrics, comparePairPureMetrics } = OWEH.domain.breedingScore;
  const { isBreedingProgramEnclosure, isCullEnclosure, normalizeEnclosureLabel } = OWEH.domain.breedingPlan;

  const STATUS = Object.freeze({
    PROTECTED: "protected",
    HOLD_UNVERIFIED: "hold-unverified",
    ELITE_KEEP: "elite-keep",
    NEAR_TARGET_KEEP: "near-target-keep",
    LINEAGE_RESERVE: "lineage-reserve",
    BREEDING_CANDIDATE: "breeding-candidate",
    EARLY_CULL_CANDIDATE: "early-cull-candidate",
    REVIEW_CULL_CANDIDATE: "review-cull-candidate"
  });

  const DEFAULTS = Object.freeze({
    body1NearTotal: 48,
    body1NearMax: 24,
    allNearTotal: 160,
    allNearMax: 32,
    minDominatorLineages: 2
  });

  const isOwnedPresent = pet => Boolean(pet?.owned && pet.present !== false && !isCullEnclosure(pet.enclosure));
  const hasSex = pet => /^(?:Female|Male)$/i.test(String(pet?.gender || ""));
  const isEggLike = pet => !hasSex(pet) || normalizeEnclosureLabel(pet?.enclosure) === "HATCHERY";

  function targetVector(pet, target) {
    const distances = [];
    const exact = [];
    for (const key of TARGET_KEYS) {
      if (!target?.[key] || !pet?.colors?.[key]) return null;
      const actual = rgb(pet.colors[key]);
      const wanted = rgb(target[key]);
      for (let index = 0; index < 3; index += 1) {
        distances.push(Math.abs(actual[index] - wanted[index]));
        exact.push(actual[index] === wanted[index]);
      }
    }
    return { distances, exact };
  }

  function endpointMetrics(pet, target) {
    let total = 0;
    let body1 = 0;
    let body1Distance = 0;
    let body1Max = 0;
    let fullDistance = 0;
    let fullMax = 0;
    for (const key of TARGET_KEYS) {
      if (!target?.[key] || !pet?.colors?.[key]) {
        return {
          complete: false, endpointPairs: 0, body1EndpointPairs: 0,
          body1Distance: Infinity, body1MaxDistance: Infinity,
          fullDistance: Infinity, fullMaxDistance: Infinity
        };
      }
      const actual = rgb(pet.colors[key]);
      const wanted = rgb(target[key]);
      for (let index = 0; index < 3; index += 1) {
        const delta = Math.abs(actual[index] - wanted[index]);
        fullDistance += delta;
        fullMax = Math.max(fullMax, delta);
        if (key === "body1") {
          body1Distance += delta;
          body1Max = Math.max(body1Max, delta);
        }
        if ((wanted[index] === 0 || wanted[index] === 255) && actual[index] === wanted[index]) {
          total += 1;
          if (key === "body1") body1 += 1;
        }
      }
    }
    return {
      complete: true,
      endpointPairs: total,
      body1EndpointPairs: body1,
      body1Distance,
      body1MaxDistance: body1Max,
      fullDistance,
      fullMaxDistance: fullMax
    };
  }

  function isNearTarget(metrics, options = {}) {
    const cfg = { ...DEFAULTS, ...(options || {}) };
    if (!metrics?.complete) return false;
    const body1Near = metrics.body1Distance <= cfg.body1NearTotal
      && metrics.body1MaxDistance <= cfg.body1NearMax;
    const allNear = metrics.fullDistance <= cfg.allNearTotal
      && metrics.fullMaxDistance <= cfg.allNearMax;
    return body1Near || allNear;
  }

  function dominatesOrEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] > b[index]) return false;
    }
    return true;
  }

  function focusSpecies(pets) {
    const counts = new Map();
    for (const pet of Object.values(pets || {})) {
      if (!isOwnedPresent(pet) || !isBreedingProgramEnclosure(pet.enclosure)) continue;
      const key = pet.species || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  }

  function protectedIdsFromQueues(...queues) {
    const ids = new Set();
    for (const queue of queues) {
      for (const row of Array.isArray(queue) ? queue : []) {
        if (row?.id) ids.add(String(row.id));
        if (row?.maleId) ids.add(String(row.maleId));
        for (const item of row?.maleCandidates || []) {
          if (item?.maleId) ids.add(String(item.maleId));
        }
      }
    }
    return ids;
  }

  function relevantPets(pets, species) {
    return Object.values(pets || {}).filter(pet => {
      if (!isOwnedPresent(pet) || !pet?.colors || (pet.species || "Unknown") !== species) return false;
      const enclosure = normalizeEnclosureLabel(pet.enclosure);
      return isBreedingProgramEnclosure(pet.enclosure) || enclosure === "NEWBORN" || enclosure === "HATCHERY";
    });
  }

  function bestPartnerFor(pet, pool, target) {
    if (!hasSex(pet) || pet.pedigreeVerified !== true) return null;
    const opposite = String(pet.gender).toLowerCase() === "female" ? "male" : "female";
    const candidates = [];
    for (const other of pool) {
      if (String(other?.gender || "").toLowerCase() !== opposite) continue;
      if ((other.species || "Unknown") !== (pet.species || "Unknown")) continue;
      if (other.pedigreeVerified !== true) continue;
      const compatibility = pedigreeCompatibility(pet, other);
      if (!compatibility.safe) continue;
      const pure = pairPureMetrics(pet, other, target);
      if (!Number.isFinite(pure.distance)) continue;
      candidates.push({ other, pure });
    }
    candidates.sort((a, b) => comparePairPureMetrics(
      { pure: a.pure, otherId: a.other.id, usageCount: 0, lineageUse: 0 },
      { pure: b.pure, otherId: b.other.id, usageCount: 0, lineageUse: 0 }
    ));
    return candidates[0] || null;
  }

  function buildRetentionPlan(pets, target, options = {}) {
    const species = options.species || focusSpecies(pets);
    if (!species) return { species: null, rows: [], keepIds: [], cullCandidateIds: [], summary: {} };
    const protectedIds = new Set([...(options.protectedIds || [])].map(String));
    const pool = relevantPets(pets, species);
    const lineageCounts = new Map();
    for (const pet of pool) {
      if (!hasSex(pet)) continue;
      const key = String(pet.gender).toLowerCase() + ":" + lineageKey(pet);
      lineageCounts.set(key, (lineageCounts.get(key) || 0) + 1);
    }

    const vectors = new Map(pool.map(pet => [String(pet.id), targetVector(pet, target)?.distances || null]));
    const rows = pool.map(pet => {
      const id = String(pet.id);
      const pure = petPureMetrics(pet, target);
      const metrics = endpointMetrics(pet, target);
      const nearTarget = isNearTarget(metrics, options);
      const lineage = hasSex(pet) ? lineageKey(pet) : null;
      const uniqueLineage = lineage
        ? (lineageCounts.get(String(pet.gender).toLowerCase() + ":" + lineage) || 0) === 1
        : false;
      const partner = bestPartnerFor(pet, pool, target);
      const vector = vectors.get(id);
      const dominators = [];
      if (vector) {
        for (const other of pool) {
          if (String(other.id) === id || (other.species || "Unknown") !== species || !hasSex(other)) continue;
          if (hasSex(pet)
            && String(other.gender || "").toLowerCase() !== String(pet.gender || "").toLowerCase()) continue;
          const otherVector = vectors.get(String(other.id));
          if (!otherVector || !dominatesOrEqual(otherVector, vector)) continue;
          dominators.push(other);
        }
      }
      const dominatorLineages = new Set(dominators.map(lineageKey)).size;
      const dominatorSexes = new Set(dominators.map(other => String(other.gender || "").toLowerCase()));
      const generated = pet.generated === true;
      const planProtected = protectedIds.has(id);
      const unverified = hasSex(pet) && pet.pedigreeVerified !== true;
      // "Reachable with a perfect partner" is not enough to make a poor pet elite: almost any
      // endpoint-target channel becomes technically reachable against an exact partner, but a
      // huge parental range still makes it weak breeding stock. Elite is reserved for pets that
      // already carry substantial target endpoint structure themselves. Near-target and partner
      // potential are handled separately below.
      const elite = metrics.body1EndpointPairs >= 2 || metrics.endpointPairs >= 5;
      const usefulEndpoint = metrics.endpointPairs > 0;
      const partnerUseful = partner?.pure?.body1PurePossible === true
        || partner?.pure?.purePossible === true
        || (partner?.pure?.body1UnionExactChannels || 0) >= 2;
      const enoughLineages = dominatorLineages >= Math.max(1, Number(options.minDominatorLineages || DEFAULTS.minDominatorLineages));
      // An egg's future sex is unknown, so require good redundant coverage from both sexes.
      const safelyDominated = enoughLineages && (!isEggLike(pet)
        || (dominatorSexes.has("male") && dominatorSexes.has("female")));

      let status;
      let reason;
      if (generated || planProtected) {
        status = STATUS.PROTECTED;
        reason = generated ? "generated" : "active-plan";
      } else if (!metrics.complete || unverified) {
        status = STATUS.HOLD_UNVERIFIED;
        reason = !metrics.complete ? "incomplete-colors" : "pedigree-unverified";
      } else if (elite) {
        status = STATUS.ELITE_KEEP;
        reason = metrics.body1EndpointPairs >= 2 ? "strong-body1-endpoints" : "strong-target-endpoints";
      } else if (nearTarget) {
        status = STATUS.NEAR_TARGET_KEEP;
        reason = metrics.endpointPairs ? "near-target" : "near-target-rescue-no-endpoints";
      } else if (uniqueLineage && (usefulEndpoint || partnerUseful)) {
        status = STATUS.LINEAGE_RESERVE;
        reason = "unique-useful-lineage";
      } else if (isEggLike(pet) && safelyDominated) {
        // Unknown-sex eggs are only culled when redundant coverage exists from BOTH sexes.
        status = STATUS.EARLY_CULL_CANDIDATE;
        reason = "poor-egg-color-dominated";
      } else if (safelyDominated) {
        // Ordinary endpoint contribution is not permanent protection: if two distinct
        // same-sex lineages are at least as good on every target channel, that contribution
        // is already covered and this pet is redundant.
        status = STATUS.REVIEW_CULL_CANDIDATE;
        reason = "redundant-pareto-dominated";
      } else if (usefulEndpoint || partnerUseful) {
        status = STATUS.BREEDING_CANDIDATE;
        reason = usefulEndpoint ? "target-endpoint-contribution" : "partner-potential";
      } else {
        status = STATUS.BREEDING_CANDIDATE;
        reason = "insufficient-redundancy-to-cull";
      }

      return {
        id: pet.id,
        name: pet.name,
        gender: pet.gender,
        species: pet.species,
        enclosure: pet.enclosure,
        generated,
        status,
        reason,
        exactChannels: pure.exactChannels,
        usedChannels: pure.usedChannels,
        distance: pure.distance,
        endpointPairs: metrics.endpointPairs,
        body1EndpointPairs: metrics.body1EndpointPairs,
        body1Distance: Number.isFinite(metrics.body1Distance) ? metrics.body1Distance : null,
        body1MaxChannelDistance: Number.isFinite(metrics.body1MaxDistance) ? metrics.body1MaxDistance : null,
        fullTargetDistance: Number.isFinite(metrics.fullDistance) ? metrics.fullDistance : null,
        fullMaxChannelDistance: Number.isFinite(metrics.fullMaxDistance) ? metrics.fullMaxDistance : null,
        nearTarget,
        lineage,
        uniqueLineage,
        dominatorLineages,
        dominatorSexes: [...dominatorSexes].sort(),
        bestPartnerId: partner?.other?.id || null,
        bestPairBody1PurePossible: Boolean(partner?.pure?.body1PurePossible),
        bestPairBody1LogPureProbability: Number.isFinite(partner?.pure?.body1LogPureProbability)
          ? partner.pure.body1LogPureProbability : null,
        bestPairPurePossible: Boolean(partner?.pure?.purePossible),
        bestPairLogPureProbability: Number.isFinite(partner?.pure?.logPureProbability)
          ? partner.pure.logPureProbability : null
      };
    });

    const order = {
      [STATUS.PROTECTED]: 0,
      [STATUS.ELITE_KEEP]: 1,
      [STATUS.NEAR_TARGET_KEEP]: 2,
      [STATUS.LINEAGE_RESERVE]: 3,
      [STATUS.BREEDING_CANDIDATE]: 4,
      [STATUS.HOLD_UNVERIFIED]: 5,
      [STATUS.REVIEW_CULL_CANDIDATE]: 6,
      [STATUS.EARLY_CULL_CANDIDATE]: 7
    };
    rows.sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99)
      || b.body1EndpointPairs - a.body1EndpointPairs
      || b.endpointPairs - a.endpointPairs
      || Number(b.bestPairBody1PurePossible) - Number(a.bestPairBody1PurePossible)
      || (a.body1Distance ?? Infinity) - (b.body1Distance ?? Infinity)
      || (a.fullTargetDistance ?? Infinity) - (b.fullTargetDistance ?? Infinity)
      || String(a.id).localeCompare(String(b.id)));

    const cullCandidateIds = rows
      .filter(row => row.status === STATUS.EARLY_CULL_CANDIDATE || row.status === STATUS.REVIEW_CULL_CANDIDATE)
      .map(row => String(row.id));
    const keepIds = rows.filter(row => !cullCandidateIds.includes(String(row.id))).map(row => String(row.id));
    const summary = rows.reduce((out, row) => {
      out[row.status] = (out[row.status] || 0) + 1;
      return out;
    }, { total: rows.length });

    return { species, rows, keepIds, cullCandidateIds, summary };
  }

  OWEH.domain.retentionPolicy = Object.freeze({
    STATUS,
    DEFAULTS,
    endpointMetrics,
    isNearTarget,
    dominatesOrEqual,
    focusSpecies,
    protectedIdsFromQueues,
    buildRetentionPlan
  });
})();
