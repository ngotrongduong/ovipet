"use strict";

// Pure rules for deciding whether a cached pet profile is complete/stale and for describing
// one completed catalog scan. Keeping these rules out of content.js lets jobs and feature
// drivers share exactly the same definition without depending on browser state.
(() => {
  if (!globalThis.OWEH?.domain?.colors) throw new Error("domain/colors.js must load before domain/pet-record.js");

  const { TARGET_KEYS, suggestedPetName } = OWEH.domain.colors;

  function isCompletePetRecord(pet) {
    return Boolean(pet?.gender && pet?.species && pet?.name && pet?.pedigreeVerified === true
      && Array.isArray(pet?.ancestors) && pet?.colors && TARGET_KEYS.every(key => pet.colors[key]));
  }

  function petProfileNeedsRefresh(cached, item, autoRename = false) {
    if (!isCompletePetRecord(cached)) return true;
    if (item?.modified && cached.catalogModified !== item.modified) return true;
    if (autoRename) {
      const expectedName = suggestedPetName(cached);
      if (expectedName && item?.name !== expectedName) return true;
    }
    return false;
  }

  function databaseMetaFor(pets, catalog, missingProfiles = 0, now) {
    if (!Number.isFinite(Number(now))) throw new Error("databaseMetaFor requires a finite now");
    const present = Object.values(pets || {}).filter(pet => pet?.present !== false && pet?.owned);
    const completeProfiles = present.filter(isCompletePetRecord).length;
    return {
      schemaVersion: 4,
      catalogAt: Number(now),
      catalogCount: (catalog || []).length,
      completeProfiles,
      missingProfiles,
      enclosureCount: new Set((catalog || []).map(pet => pet.enclosureId ?? pet.enclosure)).size
    };
  }

  OWEH.domain.petRecord = Object.freeze({ isCompletePetRecord, petProfileNeedsRefresh, databaseMetaFor });
})();
