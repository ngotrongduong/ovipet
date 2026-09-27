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

  const VOLATILE_KEYS = new Set(["lastSeenAt", "dbUpdatedAt"]);

  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // `next` is always `{...cached, ...item, ...}`, so it carries every key of `cached`.
  function recordChanged(cached, next) {
    if (!cached) return true;
    return Object.keys(next).some(key => !VOLATILE_KEYS.has(key) && !sameValue(cached[key], next[key]));
  }

  // v5.7.0: merges one catalog scan into the full pet map (mutated in place, so callers can
  // still compute metadata over it) and returns only the records that actually changed. The
  // database write then touches a handful of pets instead of rewriting every record.
  //   - `partial`: an enclosure failed to load, so nobody unseen is marked gone.
  //   - `keepUnseen(pet)`: pets never read by design (Males discard) are not marked gone.
  function mergeCatalogScan(pets, catalog, { partial = false, now, keepUnseen = () => false } = {}) {
    if (!Number.isFinite(Number(now))) throw new Error("mergeCatalogScan requires a finite now");
    const changed = {};
    const visibleIds = new Set();
    let added = 0;
    let stale = 0;
    let missing = 0;
    for (const item of catalog || []) {
      if (!item?.id) continue;
      visibleIds.add(item.id);
      const cached = pets[item.id];
      if (!cached) added += 1;
      // Computed BEFORE catalogModified is overwritten; the flag survives until a profile
      // read clears it.
      const needsProfile = petProfileNeedsRefresh(cached, item, false) || Boolean(cached?.profileStale);
      if (needsProfile) stale += 1;
      const next = {
        ...(cached || {}),
        ...item,
        owned: true,
        present: true,
        catalogModified: item.modified || cached?.catalogModified || null,
        profileStale: needsProfile
      };
      if (!recordChanged(cached, next)) continue;
      next.lastSeenAt = Number(now);
      pets[item.id] = next;
      changed[item.id] = next;
    }
    if (!partial) {
      for (const [id, pet] of Object.entries(pets)) {
        if (!pet?.owned || !pet.id || visibleIds.has(pet.id) || pet.present === false || keepUnseen(pet)) continue;
        const gone = { ...pet, present: false };
        pets[id] = gone;
        changed[id] = gone;
        missing += 1;
      }
    }
    return { changed, added, stale, missing };
  }

  OWEH.domain.petRecord = Object.freeze({ isCompletePetRecord, petProfileNeedsRefresh, databaseMetaFor, mergeCatalogScan });
})();
