"use strict";

// Review-only retention ranking of the breeding-program line. It never removes a pet: it saves
// owehRetentionRanking/owehRetentionReview and can copy the lowest-ranked pets as CSV.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/retention.js");

  function createRetention(deps) {
    const {
      storageGet, storageSet, setStatus, writeClipboard,
      petPureMetrics, STRICT_PURE_TARGET, isBreedingProgramEnclosure
    } = deps;

    function retentionRecord(pet) {
      const pure = petPureMetrics(pet, STRICT_PURE_TARGET);
      return {
        id: pet.id,
        name: pet.name,
        gender: pet.gender,
        species: pet.species,
        enclosure: pet.enclosure,
        exactChannels: pure.exactChannels,
        usedChannels: pure.usedChannels,
        distance: pure.distance,
        // Review-only score. Exact target channels dominate distance, matching the strict
        // pure-line ordering used by breeding. No pet is removed automatically.
        score: pure.exactChannels * 100000 - (Number.isFinite(pure.distance) ? pure.distance : 99999)
      };
    }

    async function updateRetentionRanking(pets = null) {
      const source = pets || await storageGet("owehPets", {});
      const linePets = Object.values(source)
        .filter(pet => pet?.owned && pet?.colors && isBreedingProgramEnclosure(pet.enclosure));
      const speciesCounts = linePets.reduce((counts, pet) => {
        const key = pet.species || "Unknown";
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts;
      }, new Map());
      const focusSpecies = [...speciesCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      const ranking = linePets
        .filter(pet => (pet.species || "Unknown") === focusSpecies)
        .map(retentionRecord)
        .filter(item => item.usedChannels > 0)
        .sort((a, b) => b.exactChannels - a.exactChannels
          || a.distance - b.distance
          || String(a.id).localeCompare(String(b.id)));
      const review = [...ranking].reverse().slice(0, Math.min(25, ranking.length));
      await storageSet({ owehRetentionRanking: ranking, owehRetentionReview: review });
      return { ranking, review };
    }

    async function copyRetentionReviewCsv() {
      const { review } = await updateRetentionRanking();
      if (!review.length) return setStatus("No indexed pets available for retention review");
      const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const rows = [
        ["id", "name", "gender", "species", "enclosure", "exact_target_channels", "used_channels", "distance", "review_score"],
        ...review.map(item => [item.id, item.name, item.gender, item.species, item.enclosure,
          item.exactChannels, item.usedChannels, item.distance, item.score])
      ];
      try {
        await writeClipboard(rows.map(row => row.map(quote).join(",")).join("\n"));
        setStatus(`Copied ${review.length} lowest-ranked pet(s) as CSV; nothing was removed`);
      } catch {
        setStatus("Could not copy automatically — clipboard access was denied");
      }
    }

    return Object.freeze({ updateRetentionRanking, copyRetentionReviewCsv });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.retention = Object.freeze({ createRetention });
})();
