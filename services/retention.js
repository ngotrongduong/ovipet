"use strict";

// Retention ranking for the pure-line program. This remains review-first: it never deletes or
// moves a pet by itself. The domain policy classifies Generated/protected pets, target endpoints,
// near-target rescues, partner potential, lineage reserves and conservative cull candidates.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/retention.js");

  const DAILY_SCAN_MS = 24 * 60 * 60 * 1000;

  function createRetention(deps) {
    const {
      storageGet, storageSet, setStatus, writeClipboard,
      petPureMetrics, STRICT_PURE_TARGET, isBreedingProgramEnclosure,
      retentionPolicy = null
    } = deps;

    function legacyRetentionRecord(pet) {
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
        score: pure.exactChannels * 100000 - (Number.isFinite(pure.distance) ? pure.distance : 99999)
      };
    }

    function protectedIds(preview, queue) {
      if (!retentionPolicy?.protectedIdsFromQueues) return new Set();
      return retentionPolicy.protectedIdsFromQueues(preview?.queue || [], queue || []);
    }

    async function updateRetentionRanking(pets = null, options = {}) {
      const source = pets || await storageGet("owehPets", {});
      if (!retentionPolicy?.buildRetentionPlan) {
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
          .map(legacyRetentionRecord)
          .filter(item => item.usedChannels > 0)
          .sort((a, b) => b.exactChannels - a.exactChannels
            || a.distance - b.distance
            || String(a.id).localeCompare(String(b.id)));
        const review = [...ranking].reverse().slice(0, Math.min(25, ranking.length));
        await storageSet({ owehRetentionRanking: ranking, owehRetentionReview: review });
        return { ranking, review, species: focusSpecies || null, summary: { total: ranking.length } };
      }

      const [preview, queue] = await Promise.all([
        storageGet("owehBreedPreview", null),
        storageGet("owehBreedQueue", [])
      ]);
      const plan = retentionPolicy.buildRetentionPlan(source, STRICT_PURE_TARGET, {
        ...options,
        protectedIds: [...protectedIds(preview, queue), ...((options.protectedIds || []).map(String))]
      });
      const ranking = plan.rows;
      const review = ranking
        .filter(row => row.status === retentionPolicy.STATUS.EARLY_CULL_CANDIDATE
          || row.status === retentionPolicy.STATUS.REVIEW_CULL_CANDIDATE
          || row.status === retentionPolicy.STATUS.HOLD_UNVERIFIED)
        .slice()
        .sort((a, b) => {
          const weight = status => status === retentionPolicy.STATUS.EARLY_CULL_CANDIDATE ? 0
            : status === retentionPolicy.STATUS.REVIEW_CULL_CANDIDATE ? 1 : 2;
          return weight(a.status) - weight(b.status)
            || (b.fullTargetDistance ?? -1) - (a.fullTargetDistance ?? -1)
            || String(a.id).localeCompare(String(b.id));
        })
        .slice(0, 50);

      const now = Date.now();
      await storageSet({
        owehRetentionRanking: ranking,
        owehRetentionReview: review,
        owehRetentionSummary: { ...plan.summary, species: plan.species, at: now },
        owehRetentionLastFullScanAt: now
      });
      return { ranking, review, species: plan.species, summary: plan.summary };
    }

    async function maybeDailyRetentionScan(pets = null, now = Date.now()) {
      const last = Number(await storageGet("owehRetentionLastFullScanAt", 0));
      if (last && now - last < DAILY_SCAN_MS) return { skipped: true, reason: "fresh", last };
      const result = await updateRetentionRanking(pets);
      return { ...result, skipped: false };
    }

    async function copyRetentionReviewCsv() {
      const { review } = await updateRetentionRanking();
      if (!review.length) return setStatus("No indexed pets need retention review");
      const quote = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
      const advanced = Boolean(retentionPolicy?.buildRetentionPlan);
      const rows = advanced ? [
        [
          "id", "name", "gender", "species", "enclosure", "status", "reason", "generated",
          "body1_endpoint_pairs", "target_endpoint_pairs", "body1_distance", "body1_max_channel_distance",
          "full_target_distance", "near_target", "unique_lineage", "dominator_lineages",
          "best_partner_id", "best_pair_body1_pure_possible", "best_pair_full_pure_possible"
        ],
        ...review.map(item => [
          item.id, item.name, item.gender, item.species, item.enclosure, item.status, item.reason, item.generated,
          item.body1EndpointPairs, item.endpointPairs, item.body1Distance, item.body1MaxChannelDistance,
          item.fullTargetDistance, item.nearTarget, item.uniqueLineage, item.dominatorLineages,
          item.bestPartnerId, item.bestPairBody1PurePossible, item.bestPairPurePossible
        ])
      ] : [
        ["id", "name", "gender", "species", "enclosure", "exact_target_channels", "used_channels", "distance", "review_score"],
        ...review.map(item => [
          item.id, item.name, item.gender, item.species, item.enclosure,
          item.exactChannels, item.usedChannels, item.distance, item.score
        ])
      ];
      try {
        await writeClipboard(rows.map(row => row.map(quote).join(",")).join("\n"));
        setStatus("Copied " + review.length + " retention-review row(s) as CSV; nothing was removed");
      } catch {
        setStatus("Could not copy automatically — clipboard access was denied");
      }
    }

    return Object.freeze({
      DAILY_SCAN_MS,
      updateRetentionRanking,
      maybeDailyRetentionScan,
      copyRetentionReviewCsv
    });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.retention = Object.freeze({ createRetention });
})();
