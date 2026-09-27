"use strict";

(() => {
  if (!globalThis.OWEH?.domain?.colors || !OWEH.domain?.pedigree || !OWEH.domain?.breedingScore) {
    throw new Error("colors, pedigree and breeding-score must load before domain/breeding-plan.js");
  }

  const { STRICT_PURE_TARGET, STRICT_TARGET_CHANNELS, TARGET_KEYS, petPureMetrics, comparePetPureMetrics } = OWEH.domain.colors;
  const { pedigreeCompatibility, lineageKey } = OWEH.domain.pedigree;
  const {
    DEFAULT_MALE_SHORTLIST_SIZE, pairPureMetrics, comparePairPureMetrics, shortlistMales,
    body1ExactMask, body1NearEquivalent, bestSecondaryTargetDistance
  } = OWEH.domain.breedingScore;

  const MALES_ENCLOSURE = "Males";
  const BREEDING_STOCK_ENCLOSURE = "Breeding Stock";
  // v5.6.0: males the cull review moved out of the program. Sort and both planners ignore
  // pets here so a culled male is never pulled back into Males or offered as a partner.
  const CULL_ENCLOSURE = "Males discard";
  const DEFAULT_BREEDING_STOCK_MAX_DISTANCE = 96;
  const BREED_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const BREEDING_STRATEGIES = Object.freeze({
    PURE_LINE: "pure-line",
    SAME_FF_TARGET: "same-ff-target"
  });
  const PURE_ENCLOSURE_BY_MASK = Object.freeze({
    "100": "FF ** **",
    "010": "** FF **",
    "001": "** ** FF",
    "110": "FF FF **",
    "101": "FF ** FF",
    "011": "** FF FF",
    "111": "FF FF FF"
  });
  const NEWBORN_ENCLOSURES = Object.freeze(Object.values(PURE_ENCLOSURE_BY_MASK));

  function normalizeEnclosureLabel(value) {
    return String(value || "").replace(/\s+/g, "").toUpperCase();
  }

  // Newborn names encode the three leading Body1 channel pairs; each exact FF
  // pair maps to one of the seven pure-line enclosure labels.
  function classifyNewbornName(name) {
    const prefix = String(name || "").trim().match(/^([A-Z0-9]{6})/i)?.[1]?.toUpperCase();
    if (!prefix) return { matched: false, reason: "invalid-prefix" };
    const pairs = [prefix.slice(0, 2), prefix.slice(2, 4), prefix.slice(4, 6)];
    const matches = pairs.map((pair, index) => pair === "FF" ? index : -1).filter(index => index >= 0);
    if (!matches.length) return { matched: false, reason: "no-match", prefix, pairs, matches };
    const mask = pairs.map(pair => pair === "FF" ? "1" : "0").join("");
    const target = PURE_ENCLOSURE_BY_MASK[mask];
    if (!target) return { matched: false, reason: "unmapped", prefix, pairs, matches, mask };
    return { matched: true, prefix, pairs, matches, mask, target };
  }

  function isPureLineEnclosure(value) {
    const normalized = normalizeEnclosureLabel(value);
    return NEWBORN_ENCLOSURES.some(label => normalizeEnclosureLabel(label) === normalized);
  }

  function isBreedingFemaleEnclosure(value) {
    return isPureLineEnclosure(value)
      || normalizeEnclosureLabel(value) === normalizeEnclosureLabel(BREEDING_STOCK_ENCLOSURE);
  }

  function isBreedingProgramEnclosure(value) {
    const normalized = normalizeEnclosureLabel(value);
    return isBreedingFemaleEnclosure(value)
      || normalized === normalizeEnclosureLabel(MALES_ENCLOSURE);
  }

  function isCullEnclosure(value) {
    return normalizeEnclosureLabel(value) === normalizeEnclosureLabel(CULL_ENCLOSURE);
  }

  function hasEndpointColorPair(pet) {
    return TARGET_KEYS.some(key => {
      const value = String(pet?.colors?.[key] || "").replace("#", "").toUpperCase();
      return value.match(/../g)?.some(pair => pair === "FF" || pair === "00");
    });
  }

  function desiredProgramEnclosure(pet, breedingStockMaxDistance = DEFAULT_BREEDING_STOCK_MAX_DISTANCE) {
    if (!pet || isCullEnclosure(pet.enclosure)) return null;
    if (String(pet.gender || "").toLowerCase() === "male") return MALES_ENCLOSURE;
    if (String(pet.gender || "").toLowerCase() !== "female") return null;
    const pure = classifyNewbornName(pet.colors?.body1?.replace("#", "") || pet.name);
    if (pure.matched) return pure.target;
    const metrics = petPureMetrics(pet, STRICT_PURE_TARGET);
    if (!hasEndpointColorPair(pet) && metrics.usedChannels === STRICT_TARGET_CHANNELS
      && metrics.distance <= breedingStockMaxDistance) {
      return BREEDING_STOCK_ENCLOSURE;
    }
    return null;
  }

  function recentMaleUsage(history, now, windowMs = BREED_HISTORY_WINDOW_MS) {
    const cutoff = Number(now) - windowMs;
    const usage = new Map();
    for (const row of history || []) {
      if (Number(row?.at || 0) < cutoff || !row?.fatherId) continue;
      const id = String(row.fatherId);
      usage.set(id, (usage.get(id) || 0) + 1);
    }
    return usage;
  }

  function normalizeBreedingStrategy(value) {
    return value === BREEDING_STRATEGIES.SAME_FF_TARGET
      ? BREEDING_STRATEGIES.SAME_FF_TARGET
      : BREEDING_STRATEGIES.PURE_LINE;
  }

  function completeForTarget(pet, target) {
    return petPureMetrics(pet, target).usedChannels === STRICT_TARGET_CHANNELS;
  }

  function secondaryTotalDistance(secondary) {
    const values = Object.values(secondary?.distances || {}).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : Infinity;
  }

  // v5.5.2: options.gameEligible = { [femaleId]: [maleId, ...] } read from each female's own
  // Breeding tab — the partners OviPets itself offers (related and cooling-down pets already
  // removed by the game). When a female has that list it is authoritative; otherwise the local
  // 3-generation pedigree check is the fail-closed fallback.
  function eligibilityIndex(gameEligible) {
    const index = new Map();
    for (const [femaleId, ids] of Object.entries(gameEligible || {})) {
      if (Array.isArray(ids)) index.set(String(femaleId), new Set(ids.map(String)));
    }
    return index;
  }

  function pairCompatibility(female, male, eligible) {
    const listed = eligible.get(String(female?.id || ""));
    if (!listed) return pedigreeCompatibility(female, male);
    if (!female || !male || String(female.id) === String(male.id)) return { safe: false, reason: "same-pet", overlapIds: [] };
    return listed.has(String(male.id))
      ? { safe: true, reason: "game-listed", overlapIds: [] }
      : { safe: false, reason: "not-offered-by-game", overlapIds: [] };
  }

  // Pedigree-verified, or the game already vouched for this female's partners.
  const pedigreeUsable = (pet, eligible) => pet?.pedigreeVerified === true || eligible.has(String(pet?.id || ""));

  // Females a plan may consider before the species focus / pedigree step, so the feature can
  // read their Breeding tab once. Same filters as the plans below minus pedigreeVerified.
  function plannableFemales(pets, target, strategy) {
    const sameFf = normalizeBreedingStrategy(strategy) === BREEDING_STRATEGIES.SAME_FF_TARGET;
    return Object.values(pets || {})
      .filter(pet => pet?.present !== false && pet?.owned && pet.gender === "Female" && !pet.onCooldown
        && !isCullEnclosure(pet.enclosure) && (sameFf || isBreedingFemaleEnclosure(pet.enclosure))
        && completeForTarget(pet, target));
  }

  // Enclosure labels holding at least one male a plan may pick (pure-line: Males only).
  function plannableMaleEnclosures(pets, target, strategy) {
    const sameFf = normalizeBreedingStrategy(strategy) === BREEDING_STRATEGIES.SAME_FF_TARGET;
    const labels = new Set();
    for (const pet of Object.values(pets || {})) {
      if (pet?.present === false || !pet?.owned || pet.gender !== "Male" || pet.onCooldown || isCullEnclosure(pet.enclosure)
        || !completeForTarget(pet, target)) continue;
      if (!sameFf && normalizeEnclosureLabel(pet.enclosure) !== normalizeEnclosureLabel(MALES_ENCLOSURE)) continue;
      if (pet.enclosure) labels.add(String(pet.enclosure));
    }
    return [...labels];
  }

  function candidateSnapshot(item) {
    if (!item?.male) return null;
    const total = secondaryTotalDistance(item.secondary);
    return {
      maleId: item.male.id,
      maleName: item.male.name || String(item.male.id || ""),
      gameListed: item.pedigree?.reason === "game-listed",
      pure: item.pure || null,
      maleUsageBefore: Number(item.usageCount || 0),
      maleLineageUseBefore: Number(item.lineageUse || 0),
      maleSecondaryBestDistance: Number.isFinite(item.secondary?.bestDistance) ? item.secondary.bestDistance : null,
      maleSecondaryBestKey: item.secondary?.bestKey || null,
      maleSecondaryTotalDistance: Number.isFinite(total) ? total : null
    };
  }

  // Decorate-sort-undecorate: the comparator used to recompute petPureMetrics for both sides
  // of every comparison (O(n log n) metric evaluations). Same order, one evaluation per pet.
  function sortByPureMetrics(pets, target) {
    const decorated = pets.map(pet => ({ pet, keyed: { ...pet, pure: petPureMetrics(pet, target) } }));
    decorated.sort((a, b) => comparePetPureMetrics(a.keyed, b.keyed));
    decorated.forEach((item, index) => { pets[index] = item.pet; });
    return pets;
  }

  function buildSameFfTargetPlan(pets, target, history, options, now) {
    // Line-improvement strategy: scan the complete enclosure snapshot. Every owned,
    // present, blue-heart-free female with complete target colors is considered,
    // regardless of enclosure. For each female, evaluate every breedable male of the
    // same species across the snapshot. The male must carry the exact same Body-1
    // target-endpoint mask (for the current target this is the same FF pair/set).
    const eligible = eligibilityIndex(options.gameEligible);
    const females = Object.values(pets)
      .filter(pet => pet?.present !== false && pet?.owned && pet.gender === "Female" && !pet.onCooldown
        && !isCullEnclosure(pet.enclosure) && pedigreeUsable(pet, eligible) && completeForTarget(pet, target));
    sortByPureMetrics(females, target);
    const males = Object.values(pets)
      .filter(pet => pet?.present !== false && pet?.owned && pet.gender === "Male" && !pet.onCooldown
        && !isCullEnclosure(pet.enclosure)
        && (pet.pedigreeVerified === true || eligible.size > 0) && completeForTarget(pet, target));

    const usage = recentMaleUsage(history, now);
    const lineageUsage = new Map();
    for (const male of males) {
      const count = usage.get(String(male.id)) || 0;
      const key = lineageKey(male);
      lineageUsage.set(key, (lineageUsage.get(key) || 0) + count);
    }

    let unpaired = 0;
    const queue = females.map(female => {
      const femaleMask = body1ExactMask(female, target);
      const candidates = !femaleMask ? [] : males
        .filter(male => (male.species || "Unknown") === (female.species || "Unknown")
          && body1ExactMask(male, target) === femaleMask)
        .map(male => ({
          male,
          pure: pairPureMetrics(female, male, target),
          secondary: bestSecondaryTargetDistance(male, target),
          pedigree: pairCompatibility(female, male, eligible),
          usageCount: usage.get(String(male.id)) || 0,
          lineageUse: lineageUsage.get(lineageKey(male)) || 0
        }))
        .filter(item => item.pedigree.safe && Number.isFinite(item.pure.distance))
        .sort((a, b) => {
          const bestDelta = Number(a.secondary?.bestDistance ?? Infinity)
            - Number(b.secondary?.bestDistance ?? Infinity);
          if (bestDelta) return bestDelta;
          const usageDelta = Number(a.usageCount || 0) - Number(b.usageCount || 0);
          if (usageDelta) return usageDelta;
          const lineageDelta = Number(a.lineageUse || 0) - Number(b.lineageUse || 0);
          if (lineageDelta) return lineageDelta;
          const totalDelta = secondaryTotalDistance(a.secondary) - secondaryTotalDistance(b.secondary);
          if (totalDelta) return totalDelta;
          return String(a.male.id || "").localeCompare(String(b.male.id || ""));
        });

      const chosen = candidates[0];
      const maleCandidates = candidates.map(candidateSnapshot).filter(Boolean);
      if (!chosen) unpaired += 1;
      if (chosen) {
        const maleId = String(chosen.male.id);
        usage.set(maleId, (usage.get(maleId) || 0) + 1);
        const key = lineageKey(chosen.male);
        lineageUsage.set(key, (lineageUsage.get(key) || 0) + 1);
      }
      return {
        id: female.id,
        name: female.name,
        species: female.species,
        maleId: chosen?.male.id || null,
        maleName: chosen?.male.name || null,
        pure: chosen?.pure || null,
        maleCandidates,
        maleCandidateIndex: 0,
        rejectedMaleIds: [],
        strategy: BREEDING_STRATEGIES.SAME_FF_TARGET,
        sameFfMask: femaleMask || 0,
        sameFfCandidateCount: candidates.length,
        maleUsageBefore: chosen?.usageCount || 0,
        maleLineageUseBefore: chosen?.lineageUse || 0,
        maleSecondaryBestDistance: Number.isFinite(chosen?.secondary?.bestDistance) ? chosen.secondary.bestDistance : null,
        maleSecondaryBestKey: chosen?.secondary?.bestKey || null,
        maleSecondaryTotalDistance: Number.isFinite(secondaryTotalDistance(chosen?.secondary))
          ? secondaryTotalDistance(chosen?.secondary) : null,
        maleBody1EquivalentPoolSize: 0
      };
    });

    return {
      queue,
      strategy: BREEDING_STRATEGIES.SAME_FF_TARGET,
      focusSpecies: null,
      femaleCount: females.length,
      maleCount: males.length,
      unpaired,
      shortlistSize: males.length
    };
  }

  function buildDatabaseBreedPlan(pets, target, history = [], options = {}) {
    const now = Number(options.now);
    if (!Number.isFinite(now)) throw new Error("buildDatabaseBreedPlan requires a finite options.now");
    const shortlistSize = Number.isFinite(options.shortlistSize) ? options.shortlistSize : DEFAULT_MALE_SHORTLIST_SIZE;
    const strategy = normalizeBreedingStrategy(options.strategy);
    if (strategy === BREEDING_STRATEGIES.SAME_FF_TARGET) {
      return buildSameFfTargetPlan(pets, target, history, options, now);
    }
    const eligible = eligibilityIndex(options.gameEligible);
    const breedableFemales = Object.values(pets)
      .filter(pet => pet?.present !== false && pet?.owned && pet.gender === "Female" && !pet.onCooldown
        && pedigreeUsable(pet, eligible) && isBreedingFemaleEnclosure(pet.enclosure)
        && petPureMetrics(pet, target).usedChannels === STRICT_TARGET_CHANNELS);
    const speciesCounts = breedableFemales.reduce((counts, pet) => {
      const key = pet.species || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());
    const focusSpecies = [...speciesCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const females = sortByPureMetrics(breedableFemales
      .filter(pet => (pet.species || "Unknown") === focusSpecies), target);
    const males = Object.values(pets)
      .filter(pet => pet?.present !== false && pet?.owned && pet.gender === "Male" && !pet.onCooldown
        && (pet.pedigreeVerified === true || eligible.size > 0)
        && normalizeEnclosureLabel(pet.enclosure) === normalizeEnclosureLabel(MALES_ENCLOSURE)
        && (pet.species || "Unknown") === focusSpecies
        && petPureMetrics(pet, target).usedChannels === STRICT_TARGET_CHANNELS);
    const usage = recentMaleUsage(history, now);
    const lineageUsage = new Map();
    for (const male of males) {
      const count = usage.get(String(male.id)) || 0;
      const key = lineageKey(male);
      lineageUsage.set(key, (lineageUsage.get(key) || 0) + count);
    }
    let unpaired = 0;
    const queue = females.map(female => {
      const shortlist = shortlistMales(female, males, target, shortlistSize);
      const ranked = shortlist.map(male => ({
        male,
        pure: pairPureMetrics(female, male, target),
        secondary: bestSecondaryTargetDistance(male, target),
        pedigree: pairCompatibility(female, male, eligible),
        usageCount: usage.get(String(male.id)) || 0,
        lineageUse: lineageUsage.get(lineageKey(male)) || 0
      })).filter(item => item.pedigree.safe && Number.isFinite(item.pure.distance))
        .sort((a, b) => comparePairPureMetrics(
          { ...a, otherId: a.male.id },
          { ...b, otherId: b.male.id }
        ));

      // Start from the male the legacy ranking would have selected. If other males
      // carry the same Body-1 endpoint mask and differ by no more than 15 RGB points
      // on the remaining Body-1 channel(s), treat that Body-1 quality as equivalent.
      // Within that pool, use the user's requested secondary rule: compare Body 2,
      // Scales, Extra 1 and Extra 2 independently and take each male's LOWEST slot
      // distance to target. Lower wins (e.g. 12 beats 14). Existing recent-use and
      // lineage-use tie-breaks only apply when that best secondary distance is equal.
      const baseline = ranked[0];
      const equivalentPool = baseline
        ? ranked.filter(item => body1NearEquivalent(baseline.male, item.male, target))
        : [];
      const preferredPool = (equivalentPool.length > 1 ? equivalentPool : ranked)
        .slice()
        .sort((a, b) => {
          if (equivalentPool.length > 1) {
            const secondary = Number(a.secondary?.bestDistance ?? Infinity)
              - Number(b.secondary?.bestDistance ?? Infinity);
            if (secondary) return secondary;
            const usageDelta = Number(a.usageCount || 0) - Number(b.usageCount || 0);
            if (usageDelta) return usageDelta;
            const lineageDelta = Number(a.lineageUse || 0) - Number(b.lineageUse || 0);
            if (lineageDelta) return lineageDelta;
          }
          return comparePairPureMetrics(
            { ...a, otherId: a.male.id },
            { ...b, otherId: b.male.id }
          );
        });
      const preferredIds = new Set(preferredPool.map(item => String(item.male.id)));
      const orderedCandidates = preferredPool.concat(
        ranked.filter(item => !preferredIds.has(String(item.male.id)))
      );
      const chosen = orderedCandidates[0];
      const maleCandidates = orderedCandidates.map(candidateSnapshot).filter(Boolean);
      if (!chosen) unpaired += 1;
      if (chosen) {
        const maleId = String(chosen.male.id);
        usage.set(maleId, (usage.get(maleId) || 0) + 1);
        const key = lineageKey(chosen.male);
        lineageUsage.set(key, (lineageUsage.get(key) || 0) + 1);
      }
      return {
        id: female.id,
        name: female.name,
        species: female.species,
        maleId: chosen?.male.id || null,
        maleName: chosen?.male.name || null,
        pure: chosen?.pure || null,
        maleCandidates,
        maleCandidateIndex: 0,
        rejectedMaleIds: [],
        maleUsageBefore: chosen?.usageCount || 0,
        maleLineageUseBefore: chosen?.lineageUse || 0,
        maleSecondaryBestDistance: Number.isFinite(chosen?.secondary?.bestDistance) ? chosen.secondary.bestDistance : null,
        maleSecondaryBestKey: chosen?.secondary?.bestKey || null,
        maleBody1EquivalentPoolSize: equivalentPool.length || (chosen ? 1 : 0)
      };
    });
    return {
      queue,
      strategy: BREEDING_STRATEGIES.PURE_LINE,
      focusSpecies,
      femaleCount: females.length,
      maleCount: males.length,
      unpaired,
      shortlistSize: Math.min(shortlistSize, males.length)
    };
  }

  // Database-only readiness summary for the panel: females in the breeding enclosures and how
  // many of them a campaign could use right now. Opens no page and sends no command.
  function breedingReadiness(pets) {
    const summary = { total: 0, ready: 0, cooldown: 0, unverified: 0 };
    for (const pet of Object.values(pets || {})) {
      if (pet?.present === false || !pet?.owned || pet.gender !== "Female" || !isBreedingFemaleEnclosure(pet.enclosure)) continue;
      summary.total += 1;
      if (pet.onCooldown) summary.cooldown += 1;
      else if (pet.pedigreeVerified !== true) summary.unverified += 1;
      else summary.ready += 1;
    }
    return summary;
  }

  OWEH.domain.breedingPlan = Object.freeze({
    MALES_ENCLOSURE,
    BREEDING_STOCK_ENCLOSURE,
    CULL_ENCLOSURE,
    DEFAULT_BREEDING_STOCK_MAX_DISTANCE,
    BREED_HISTORY_WINDOW_MS,
    BREEDING_STRATEGIES,
    PURE_ENCLOSURE_BY_MASK,
    NEWBORN_ENCLOSURES,
    normalizeEnclosureLabel,
    classifyNewbornName,
    isPureLineEnclosure,
    isBreedingFemaleEnclosure,
    isBreedingProgramEnclosure,
    isCullEnclosure,
    hasEndpointColorPair,
    desiredProgramEnclosure,
    recentMaleUsage,
    normalizeBreedingStrategy,
    buildDatabaseBreedPlan,
    plannableFemales,
    plannableMaleEnclosures,
    breedingReadiness
  });
})();
