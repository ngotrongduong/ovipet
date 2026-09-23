"use strict";

(() => {
  if (!globalThis.OWEH?.domain?.colors) throw new Error("domain/colors.js must load before domain/breeding-score.js");

  const { TARGET_KEYS, STRICT_TARGET_CHANNELS, rgb, slotDistance, petPureMetrics } = OWEH.domain.colors;
  const DEFAULT_MALE_SHORTLIST_SIZE = 40;
  const BODY1_EQUIVALENCE_TOLERANCE = 15;
  const SECONDARY_TARGET_KEYS = Object.freeze(["body2", "scales", "extra1", "extra2"]);

  // Estimate how well a pair brackets each target channel. A target inside the
  // parental range gets only a small midpoint penalty; unreachable channels pay
  // the distance to the nearer parent. This preserves the pre-extraction ranking.
  function pairScore(parent, partner, target) {
    let score = 0;
    let used = 0;
    for (const key of Object.keys(target)) {
      if (!target[key] || !parent?.colors?.[key] || !partner?.colors?.[key]) continue;
      const a = rgb(parent.colors[key]);
      const b = rgb(partner.colors[key]);
      const wanted = rgb(target[key]);
      for (let index = 0; index < 3; index += 1) {
        const low = Math.min(a[index], b[index]);
        const high = Math.max(a[index], b[index]);
        if (wanted[index] >= low && wanted[index] <= high) {
          score += Math.abs((a[index] + b[index]) / 2 - wanted[index]) * 0.05;
        } else {
          score += Math.min(Math.abs(a[index] - wanted[index]), Math.abs(b[index] - wanted[index]));
        }
      }
      used += 1;
    }
    return used ? score / used : Infinity;
  }

  function pairPureMetrics(parent, partner, target) {
    let lockedChannels = 0;
    let exactParentCopies = 0;
    let reachableChannels = 0;
    let usedChannels = 0;
    let totalRangeWidth = 0;
    let logPureProbability = 0;
    let allReachable = true;
    let body1LockedChannels = 0;
    let body1UnionExactChannels = 0;
    let body1NewExactChannels = 0;
    let body1ReachableChannels = 0;
    let body1LogPureProbability = 0;
    for (const key of TARGET_KEYS) {
      if (!target[key] || !parent?.colors?.[key] || !partner?.colors?.[key]) continue;
      const a = rgb(parent.colors[key]);
      const b = rgb(partner.colors[key]);
      const wanted = rgb(target[key]);
      for (let index = 0; index < 3; index += 1) {
        const aExact = a[index] === wanted[index];
        const bExact = b[index] === wanted[index];
        if (aExact && bExact) lockedChannels += 1;
        if (aExact) exactParentCopies += 1;
        if (bExact) exactParentCopies += 1;
        const low = Math.min(a[index], b[index]);
        const high = Math.max(a[index], b[index]);
        const width = high - low;
        totalRangeWidth += width;
        if (wanted[index] >= low && wanted[index] <= high) {
          reachableChannels += 1;
          logPureProbability -= Math.log(width + 1);
        } else {
          allReachable = false;
        }
        if (key === "body1") {
          if (aExact && bExact) body1LockedChannels += 1;
          if (aExact || bExact) body1UnionExactChannels += 1;
          if (!aExact && bExact) body1NewExactChannels += 1;
          if (wanted[index] >= low && wanted[index] <= high) {
            body1ReachableChannels += 1;
            body1LogPureProbability -= Math.log(width + 1);
          }
        }
        usedChannels += 1;
      }
    }
    const purePossible = usedChannels === STRICT_TARGET_CHANNELS && allReachable;
    return {
      lockedChannels,
      body1LockedChannels,
      body1UnionExactChannels,
      body1NewExactChannels,
      body1ReachableChannels,
      body1PurePossible: body1ReachableChannels === 3,
      body1LogPureProbability: body1ReachableChannels === 3 ? body1LogPureProbability : -Infinity,
      exactParentCopies,
      reachableChannels,
      usedChannels,
      totalRangeWidth,
      purePossible,
      pureProbability: purePossible ? Math.exp(logPureProbability) : 0,
      logPureProbability: purePossible ? logPureProbability : -Infinity,
      distance: usedChannels ? pairScore(parent, partner, target) : Infinity
    };
  }

  function comparePairPureMetrics(a, b) {
    return Number(b.pure.body1PurePossible) - Number(a.pure.body1PurePossible)
      || (a.pure.body1PurePossible && b.pure.body1PurePossible
        ? b.pure.body1LogPureProbability - a.pure.body1LogPureProbability : 0)
      || b.pure.body1UnionExactChannels - a.pure.body1UnionExactChannels
      || b.pure.body1NewExactChannels - a.pure.body1NewExactChannels
      || b.pure.body1ReachableChannels - a.pure.body1ReachableChannels
      || Number(b.pure.purePossible) - Number(a.pure.purePossible)
      || (a.pure.purePossible && b.pure.purePossible ? b.pure.logPureProbability - a.pure.logPureProbability : 0)
      || b.pure.lockedChannels - a.pure.lockedChannels
      || b.pure.reachableChannels - a.pure.reachableChannels
      || b.pure.exactParentCopies - a.pure.exactParentCopies
      || Number(a.usageCount || 0) - Number(b.usageCount || 0)
      || Number(a.lineageUse || 0) - Number(b.lineageUse || 0)
      || a.pure.totalRangeWidth - b.pure.totalRangeWidth
      || a.pure.distance - b.pure.distance
      || String(a.otherId || a.partner?.id || "").localeCompare(String(b.otherId || b.partner?.id || ""));
  }


  // When two males already carry the same exact endpoint channels on Body 1, a tiny
  // difference in the remaining channel(s) should not force the campaign to reuse one
  // ancestor forever. Treat those Body-1 values as equivalent when every non-exact
  // channel stays within the configured RGB tolerance. Exact endpoint masks must match,
  // so a genuinely purer Body 1 still keeps its priority.
  function body1EndpointMask(pet, target) {
    if (!pet?.colors?.body1 || !target?.body1) return 0;
    const actual = rgb(pet.colors.body1);
    const wanted = rgb(target.body1);
    return actual.reduce((mask, value, index) => {
      const endpoint = wanted[index] === 0 || wanted[index] === 255;
      return endpoint && value === wanted[index] ? mask | (1 << index) : mask;
    }, 0);
  }

  function body1NearEquivalent(a, b, target, tolerance = BODY1_EQUIVALENCE_TOLERANCE) {
    if (!a?.colors?.body1 || !b?.colors?.body1 || !target?.body1) return false;
    const av = rgb(a.colors.body1);
    const bv = rgb(b.colors.body1);
    const wanted = rgb(target.body1);
    const aMask = body1EndpointMask(a, target);
    const bMask = body1EndpointMask(b, target);
    if (!aMask || aMask !== bMask) return false;

    const maxDelta = Math.max(0, Number(tolerance) || 0);
    for (let index = 0; index < 3; index += 1) {
      const aExact = av[index] === wanted[index];
      const bExact = bv[index] === wanted[index];
      if (aExact !== bExact) return false;
      if (!aExact && Math.abs(av[index] - bv[index]) > maxDelta) return false;
    }
    return true;
  }

  // User rule for near-equivalent Body-1 males: inspect Body 2, Scales, Extra 1
  // and Extra 2 independently, then use the single closest slot to target. This is
  // deliberately NOT an average: [20,14,40,25] scores 14.
  function bestSecondaryTargetDistance(pet, target) {
    let bestDistance = Infinity;
    let bestKey = null;
    const distances = {};
    for (const key of SECONDARY_TARGET_KEYS) {
      const distance = target?.[key] && pet?.colors?.[key]
        ? slotDistance(pet.colors[key], target[key])
        : null;
      distances[key] = distance;
      if (Number.isFinite(distance) && distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }
    return { bestDistance, bestKey, distances };
  }

  function formatPureProbability(value) {
    if (!Number.isFinite(value) || value <= 0) return "not reachable this generation";
    const percent = value * 100;
    return percent >= 0.01 ? `${percent.toFixed(2)}% estimated pure chance` : `${percent.toExponential(2)}% estimated pure chance`;
  }

  function body1ExactMask(pet, target) {
    if (!pet?.colors?.body1 || !target?.body1) return 0;
    const actual = rgb(pet.colors.body1);
    const wanted = rgb(target.body1);
    return actual.reduce((mask, value, index) => mask | (value === wanted[index] ? (1 << index) : 0), 0);
  }

  function shortlistMales(female, males, target, limit = DEFAULT_MALE_SHORTLIST_SIZE) {
    const femaleMask = body1ExactMask(female, target);
    const ranked = males.map(male => {
      const maleMask = body1ExactMask(male, target);
      const newMask = maleMask & ~femaleMask;
      const unionMask = maleMask | femaleMask;
      return {
        male,
        preGain: newMask.toString(2).replace(/0/g, "").length,
        preUnion: unionMask.toString(2).replace(/0/g, "").length,
        preDistance: petPureMetrics(male, target).distance
      };
    }).sort((a, b) => b.preGain - a.preGain || b.preUnion - a.preUnion
      || a.preDistance - b.preDistance || String(a.male.id).localeCompare(String(b.male.id)));

    const base = ranked.slice(0, Math.max(1, limit));
    if (!base.length) return [];

    // Keep near-equivalent Body-1 alternatives even when a large male pool would
    // otherwise push them just outside the performance shortlist. Compare against
    // every retained baseline candidate so one related/odd top row cannot hide an
    // otherwise valid equivalent alternative.
    const selected = new Map(base.map(item => [String(item.male.id), item.male]));
    for (const item of ranked.slice(base.length)) {
      if (base.some(baseItem => body1NearEquivalent(baseItem.male, item.male, target))) {
        selected.set(String(item.male.id), item.male);
      }
    }
    return [...selected.values()];
  }

  OWEH.domain.breedingScore = Object.freeze({
    DEFAULT_MALE_SHORTLIST_SIZE,
    BODY1_EQUIVALENCE_TOLERANCE,
    SECONDARY_TARGET_KEYS,
    pairScore,
    pairPureMetrics,
    comparePairPureMetrics,
    formatPureProbability,
    body1ExactMask,
    body1EndpointMask,
    body1NearEquivalent,
    bestSecondaryTargetDistance,
    shortlistMales
  });
})();
