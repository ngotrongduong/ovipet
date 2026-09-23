"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before domain/pedigree.js");

  function pedigreeCompatibility(a, b) {
    if (!a || !b) return { safe: false, reason: "missing-pet", overlapIds: [] };
    if (String(a.id || "") === String(b.id || "")) {
      return { safe: false, reason: "same-pet", overlapIds: [String(a.id || "")] };
    }
    // Pedigree is lazy-loaded on OviPets. An empty ancestor list is only meaningful after
    // the Pedigree panel itself has been observed. Old/partial cache rows must therefore
    // fail closed instead of being interpreted as unrelated.
    if (a.pedigreeVerified !== true || b.pedigreeVerified !== true) {
      return { safe: false, reason: "pedigree-unverified", overlapIds: [] };
    }

    const aId = String(a.id || "");
    const bId = String(b.id || "");
    const aAncestors = [...new Set((a.ancestors || []).map(String).filter(Boolean))];
    const bAncestors = [...new Set((b.ancestors || []).map(String).filter(Boolean))];
    if (aAncestors.includes(bId)) return { safe: false, reason: "direct-ancestor", overlapIds: [bId] };
    if (bAncestors.includes(aId)) return { safe: false, reason: "direct-ancestor", overlapIds: [aId] };
    const bSet = new Set(bAncestors);
    const overlapIds = aAncestors.filter(id => bSet.has(id));
    if (overlapIds.length) return { safe: false, reason: "shared-ancestor", overlapIds };
    return { safe: true, reason: "verified-unrelated", overlapIds: [] };
  }

  function ancestorsOverlap(a, b) {
    return !pedigreeCompatibility(a, b).safe;
  }

  function lineageKey(pet) {
    const parents = (pet?.parentIds?.length ? pet.parentIds : pet?.ancestors?.slice(0, 2) || [])
      .map(String).sort();
    return parents.length ? parents.join(":") : `pet:${pet?.id || "unknown"}`;
  }

  OWEH.domain = OWEH.domain || {};
  OWEH.domain.pedigree = Object.freeze({ pedigreeCompatibility, ancestorsOverlap, lineageKey });
})();
