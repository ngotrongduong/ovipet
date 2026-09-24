"use strict";

// Breeding-partner ranking on a pet profile (Rank partners button) and the hatchling male
// metrics used by features/hatchlings.js. Reads the profile's breeding links, scores each
// indexed partner and marks the best pair; it never dispatches a game command.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/partner-ranking.js");

  // Confirmed selector (docs/dom-audit-2026-09-17.md #4).
  const BREEDING_CANDIDATE_SELECTOR = "section#breeding a[onclick*=\"ui_action_cmdExec('pet_breed'\"]";

  function createPartnerRanking(deps) {
    const {
      storageGet, setStatus, readPet, rgb, petPureMetrics, petOffTarget, pairPureMetrics,
      comparePairPureMetrics, formatPureProbability, STRICT_PURE_TARGET
    } = deps;

    function hatchMaleMetrics(pet, target) {
      const targeted = petPureMetrics(pet, target);
      const body = pet?.colors?.body1 ? rgb(pet.colors.body1) : [];
      const extremeExact = body.filter(value => value === 0 || value === 255).length;
      const extremeDistance = body.reduce((sum, value) => sum + Math.min(value, 255 - value), 0);
      return {
        targetExact: targeted.exactChannels,
        targetUsed: targeted.usedChannels,
        targetDistance: targeted.distance,
        extremeExact,
        extremeDistance
      };
    }

    function breedingCandidates(parentId) {
      return [...document.querySelectorAll(BREEDING_CANDIDATE_SELECTOR)].map(anchor => {
        const onclick = anchor.getAttribute("onclick") || "";
        const mother = onclick.match(/MotherID=(\d+)/)?.[1];
        const father = onclick.match(/FatherID=(\d+)/)?.[1];
        const otherId = mother === parentId ? father : mother;
        return otherId ? { anchor, otherId } : null;
      }).filter(Boolean);
    }

    const hasBreedingCandidates = () => Boolean(document.querySelector(BREEDING_CANDIDATE_SELECTOR));

    function targetValues() {
      return { ...STRICT_PURE_TARGET };
    }

    async function rankPartners() {
      const parent = readPet();
      const target = targetValues();
      const pets = await storageGet("owehPets", {});
      if (!parent) return setStatus("Open the parent profile with its Colors table visible");
      if (!Object.values(target).some(Boolean)) return setStatus("Enter at least one target color");
      // v5.5.2: every card on the Breeding tab is a partner OviPets itself offers — the game has
      // already removed related and cooling-down pets. The old local pedigree check read the
      // parent from this page, where the lazy Pedigree tab is not loaded, so it failed closed and
      // flagged every male. Only a partner missing from the database is marked now.
      const ranked = breedingCandidates(parent.id).map(({ anchor, otherId }) => {
        const partner = pets[otherId];
        return {
          anchor,
          partner,
          otherId,
          pure: pairPureMetrics(parent, partner, target),
          offTarget: petOffTarget(partner, target),
          unindexed: !partner?.colors
        };
      }).sort(comparePairPureMetrics);
      const best = ranked.find(x => Number.isFinite(x.pure.distance) && !x.unindexed);
      document.querySelectorAll(".oweh-recommended, .oweh-warning").forEach(e => e.remove());
      const unindexed = ranked.filter(item => item.unindexed).length;
      ranked.forEach((item, index) => {
        item.anchor.style.outline = index < 3 && Number.isFinite(item.pure.distance) && !item.unindexed
          ? "3px solid #ffd166" : "";
        if (item.unindexed) {
          const warning = document.createElement("span");
          warning.className = "oweh-warning";
          warning.textContent = "Not in the database yet — run Update database";
          item.anchor.appendChild(warning);
          return;
        }
        if (item === best) {
          const offText = Number.isFinite(item.offTarget) ? ` · ${item.offTarget} off target` : "";
          const badge = document.createElement("span");
          badge.className = "oweh-recommended";
          const chance = item.pure.purePossible
            ? formatPureProbability(item.pure.pureProbability)
            : `${item.pure.reachableChannels}/${item.pure.usedChannels} target channels reachable`;
          badge.textContent = `Best pair · Body 1 ${item.pure.body1ReachableChannels}/3 reachable, +${item.pure.body1NewExactChannels} new FF · ${chance} · ${item.pure.lockedChannels} locked${offText}`;
          item.anchor.appendChild(badge);
        }
      });
      const missingText = unindexed ? ` · ${unindexed} partner(s) not in the database yet` : "";
      setStatus(best
        ? `Best of ${ranked.length} partner(s) OviPets offers: ${best.partner?.name || "unknown"}${missingText}`
        : `No indexed partner among the ${ranked.length} OviPets offers${missingText}`);
    }

    return { rankPartners, breedingCandidates, hasBreedingCandidates, hatchMaleMetrics };
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.partnerRanking = Object.freeze({ BREEDING_CANDIDATE_SELECTOR, createPartnerRanking });
})();
