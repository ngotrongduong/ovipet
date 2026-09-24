"use strict";

// Button: "Update database" (v5.5.0). One command-first pass that replaces the four separate
// maintenance buttons (Update pet catalog, Refresh pet profiles, Sort, Feed):
//   1. catalog  — fetch every Overview enclosure panel and merge it into the pet database;
//   2. profiles — fetch the profile + pedigree of every stale/incomplete/wrongly named pet,
//                 save it, and rename it by the pet_rename / pet_name command;
//   3. sort     — send pets_enclosure for every focus-species pet in the wrong enclosure;
//   4. feed     — send the free per-pet Feed for every pet not known to be full.
// Each step can be switched off (owehMaintainSteps). Nothing navigates: reads go through
// services/pet-fetch.js and writes through core/game-actions.js, so the shared tab stays on
// the Overview for the whole run.
OWEH.register("job-maintain", helpers => {
  const { storageGet, storageSet, sleep, domain, gameActions, settings, catalogService, petFetch } = helpers;
  const { colors, petRecord, breedingPlan } = domain;
  const DEFAULT_STEPS = Object.freeze({ catalog: true, profiles: true, sort: true, feed: true });
  const PROFILE_CONCURRENCY = 3;
  const SAVE_EVERY = 10;
  // A fire-and-forget pet_feed proves only that the dispatcher accepted it; retry after a short
  // window rather than trusting it for the full confirmed-full window.
  const FEED_DISPATCH_RETRY_MS = 10 * 60 * 1000;
  const isOwnedPresent = pet => pet?.owned && pet.present !== false && /^\d+$/.test(String(pet.id));

  async function readSteps() {
    const stored = await storageGet("owehMaintainSteps", DEFAULT_STEPS);
    return { ...DEFAULT_STEPS, ...(stored || {}) };
  }

  async function catalogStep({ isCancelled, phase, status }) {
    phase("catalog");
    status("Update database: reading every enclosure...");
    const scan = await petFetch.collectCatalog({
      isCancelled,
      onProgress: (index, total, tab) => phase(`catalog ${index + 1}/${total} · ${tab.label}`)
    });
    if (scan.cancelled || isCancelled()) return null;
    if (!scan.catalog.length) return { empty: true };
    const { catalog, partial } = scan;
    catalogService.setOwnUserId(scan.ownUserId || catalog.find(pet => pet.usr)?.usr);
    const pets = await storageGet("owehPets", {});
    const visibleIds = new Set(catalog.map(item => item.id));
    let added = 0;
    let stale = 0;
    for (const item of catalog) {
      const cached = pets[item.id];
      if (!cached) added += 1;
      // Computed BEFORE catalogModified is overwritten; the flag survives until a profile
      // read clears it.
      const needsProfile = petRecord.petProfileNeedsRefresh(cached, item, false) || Boolean(cached?.profileStale);
      if (needsProfile) stale += 1;
      pets[item.id] = {
        ...(cached || {}),
        ...item,
        owned: true,
        present: true,
        catalogModified: item.modified || cached?.catalogModified || null,
        profileStale: needsProfile,
        lastSeenAt: Date.now()
      };
    }
    // Pets in an enclosure that failed to load are unknown, not gone.
    let missing = 0;
    if (!partial) {
      for (const pet of Object.values(pets)) {
        if (pet?.owned && pet.id && !visibleIds.has(pet.id) && pet.present !== false) {
          pet.present = false;
          missing += 1;
        }
      }
    }
    await storageSet({
      owehOwnUserId: catalogService.getOwnUserId(),
      owehPets: pets,
      owehDatabaseMeta: petRecord.databaseMetaFor(pets, catalog, stale, Date.now())
    });
    const enclosures = new Set(catalog.map(pet => pet.enclosureId ?? pet.enclosure)).size;
    return { count: catalog.length, enclosures, added, stale, missing, partial };
  }

  async function profilesStep({ isCancelled, phase, status }) {
    const [pets, autoRename, ownUserId] = await Promise.all([
      storageGet("owehPets", {}),
      storageGet("owehAutoRename", true),
      storageGet("owehOwnUserId", null)
    ]);
    const wrongName = pet => {
      if (!autoRename) return false;
      const expected = colors.suggestedPetName(pet);
      return Boolean(expected) && pet.name !== expected;
    };
    const queue = Object.values(pets)
      .filter(isOwnedPresent)
      .filter(pet => pet.profileStale || !petRecord.isCompletePetRecord(pet) || wrongName(pet));
    const result = { queued: queue.length, read: 0, renamed: 0, unverified: 0, errors: 0 };
    if (!queue.length) return result;

    const changed = {};
    let completeDelta = 0;
    let missingDelta = 0;
    let done = 0;
    const flush = async () => {
      if (!Object.keys(changed).length) return;
      const batch = { ...changed };
      for (const id of Object.keys(changed)) delete changed[id];
      await storageSet({ owehPets: batch });
    };

    async function refresh(cached) {
      const read = await petFetch.readPet(cached.id, ownUserId);
      if (!read.ok) {
        result.errors += 1;
        return;
      }
      const { profile, record } = read;
      const pet = petFetch.mergePetRecord(cached, record);
      Object.assign(pet, {
        onCooldown: cached.onCooldown,
        enclosure: profile.enclosureLabel || cached.enclosure,
        enclosureId: profile.enclosureId || cached.enclosureId,
        catalogModified: cached.catalogModified || cached.modified || null,
        lastProfileScanAt: Date.now(),
        profileStale: false,
        present: true,
        owned: true
      });
      if (pet.pedigreeVerified !== true) result.unverified += 1;
      if (autoRename) {
        const expected = colors.suggestedPetName(pet);
        if (expected && pet.name !== expected && (profile.canRename || profile.canName)) {
          const renamed = await gameActions.namePet(pet.id, expected, { unnamed: profile.unnamed });
          if (renamed.ok) {
            pet.name = expected;
            result.renamed += 1;
          }
        }
      }
      const wasComplete = petRecord.isCompletePetRecord(cached);
      const isComplete = petRecord.isCompletePetRecord(pet);
      if (!wasComplete && isComplete) {
        completeDelta += 1;
        missingDelta -= 1;
      } else if (wasComplete && !isComplete) {
        completeDelta -= 1;
      }
      changed[pet.id] = pet;
      result.read += 1;
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !isCancelled()) {
        const cached = queue[cursor];
        cursor += 1;
        await refresh(cached);
        done += 1;
        phase(`profiles ${done}/${queue.length}`);
        status(`Update database: profiles ${done}/${queue.length} · renamed ${result.renamed} · errors ${result.errors}`);
        if (Object.keys(changed).length >= SAVE_EVERY) await flush();
        await sleep(settings.DEFAULT_REQUEST_DELAY);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROFILE_CONCURRENCY, queue.length) }, worker));
    await flush();
    if (result.read) {
      const meta = await storageGet("owehDatabaseMeta", {});
      await storageSet({
        owehDatabaseMeta: {
          ...meta,
          completeProfiles: Math.max(0, Number(meta.completeProfiles || 0) + completeDelta),
          missingProfiles: Math.max(0, Number(meta.missingProfiles || 0) + missingDelta),
          lastProfileAt: Date.now()
        }
      });
    }
    return result;
  }

  async function sortStep({ isCancelled, phase, status }) {
    const [pets, enclosureIds, maxDistance] = await Promise.all([
      storageGet("owehPets", {}),
      storageGet("owehEnclosureIds", {}),
      storageGet("owehBreedingStockMaxDistance", breedingPlan.DEFAULT_BREEDING_STOCK_MAX_DISTANCE)
    ]);
    if (!Object.keys(enclosureIds).length) return { skipped: "no-enclosures", moved: 0, errors: 0 };
    // Only the species already filling the breeding-program enclosures is sorted.
    const lineSpecies = Object.values(pets)
      .filter(pet => pet?.present !== false && breedingPlan.isBreedingProgramEnclosure(pet?.enclosure))
      .reduce((counts, pet) => {
        const key = pet.species || "Unknown";
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts;
      }, new Map());
    const focusSpecies = [...lineSpecies.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const actions = Object.values(pets).map(pet => {
      if (!pet?.owned || pet.present === false) return null;
      if (focusSpecies && (pet.species || "Unknown") !== focusSpecies) return null;
      const target = breedingPlan.desiredProgramEnclosure(pet, maxDistance);
      if (!target || breedingPlan.normalizeEnclosureLabel(pet.enclosure) === breedingPlan.normalizeEnclosureLabel(target)) return null;
      return { pet, target };
    }).filter(Boolean);
    const result = { planned: actions.length, moved: 0, errors: 0 };
    const changed = {};
    for (let index = 0; index < actions.length; index += 1) {
      if (isCancelled()) break;
      const { pet, target } = actions[index];
      phase(`sort ${index + 1}/${actions.length}`);
      status(`Update database: moving ${pet.name} → ${target} (${index + 1}/${actions.length})`);
      const moved = await gameActions.fastMovePetToEnclosure(pet.id, target);
      if (moved.moved) {
        changed[pet.id] = { id: pet.id, enclosure: target, enclosureId: enclosureIds[target] || pet.enclosureId };
        result.moved += 1;
      } else {
        result.errors += 1;
      }
      if (Object.keys(changed).length >= 5) {
        await storageSet({ owehPets: { ...changed } });
        for (const id of Object.keys(changed)) delete changed[id];
      }
      await sleep(Math.max(500, settings.getDelayMs()));
    }
    if (Object.keys(changed).length) await storageSet({ owehPets: changed });
    return result;
  }

  async function feedStep({ isCancelled, phase, status }) {
    const pets = await storageGet("owehPets", {});
    const now = Date.now();
    const queue = Object.values(pets)
      .filter(isOwnedPresent)
      .filter(pet => {
        const knownFullRecently = Number(pet.foodPercent) >= 100
          && now - Number(pet.foodCheckedAt || 0) < settings.RECENT_FULL_FOOD_MS;
        const fedRecently = now - Number(pet.lastFedAt || 0) < settings.RECENT_FULL_FOOD_MS;
        const dispatchedRecently = now - Number(pet.feedDispatchedAt || 0) < FEED_DISPATCH_RETRY_MS;
        return !knownFullRecently && !fedRecently && !dispatchedRecently;
      })
      .sort((a, b) => Number(a.enclosureId || 0) - Number(b.enclosureId || 0) || Number(a.id) - Number(b.id));
    const result = { queued: queue.length, sent: 0, errors: 0 };
    const changed = {};
    for (let index = 0; index < queue.length; index += 1) {
      if (isCancelled()) break;
      const pet = queue[index];
      phase(`feed ${index + 1}/${queue.length}`);
      const fed = await gameActions.feedPet(pet.id);
      if (fed.ok) {
        result.sent += 1;
        // Only the dispatch is known; a later profile read owns foodPercent/foodCheckedAt.
        changed[pet.id] = { id: pet.id, feedDispatchedAt: Date.now() };
      } else {
        result.errors += 1;
      }
      if (Object.keys(changed).length >= SAVE_EVERY) {
        await storageSet({ owehPets: { ...changed } });
        for (const id of Object.keys(changed)) delete changed[id];
      }
      status(`Update database: feeding ${index + 1}/${queue.length} · sent ${result.sent} · errors ${result.errors}`);
      await sleep(settings.PET_FEED_DELAY_MS);
    }
    if (Object.keys(changed).length) await storageSet({ owehPets: changed });
    if (result.sent) await storageSet({ owehLastFeedAt: Date.now() });
    return result;
  }

  function summary(parts, cancelled) {
    const text = [];
    const { catalog, profiles, sort, feed } = parts;
    if (catalog?.empty) text.push("catalog: no pet cards found, nothing changed");
    else if (catalog) {
      text.push(`catalog ${catalog.count} pet(s) in ${catalog.enclosures} enclosure(s), ${catalog.added} new${catalog.missing ? `, ${catalog.missing} gone` : ""}${catalog.partial ? " (partial — nobody marked gone)" : ""}`);
    }
    if (profiles) text.push(`profiles ${profiles.read}/${profiles.queued}, renamed ${profiles.renamed}${profiles.unverified ? `, ${profiles.unverified} pedigree unverified` : ""}${profiles.errors ? `, ${profiles.errors} error(s)` : ""}`);
    if (sort?.skipped) text.push("sort: no enclosure ids yet");
    else if (sort) text.push(`moved ${sort.moved}${sort.errors ? ` (${sort.errors} error(s))` : ""}`);
    if (feed) text.push(`fed ${feed.sent}${feed.errors ? ` (${feed.errors} error(s))` : ""}`);
    return `Update database ${cancelled ? "stopped" : "finished"}: ${text.join(" · ") || "nothing to do"}`;
  }

  const job = OWEH.get("runner").api.createJob({
    owner: "maintain",
    label: "Update database",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run(ctx) {
      const { isCancelled, status } = ctx;
      const steps = await readSteps();
      const parts = {};
      if (steps.catalog) {
        parts.catalog = await catalogStep(ctx);
        if (isCancelled()) return status(summary(parts, true));
      } else if (!Object.keys(await storageGet("owehPets", {})).length) {
        status("Update database: the pet database is empty — turn on the Catalog step");
        return;
      }
      if (steps.profiles && !isCancelled()) parts.profiles = await profilesStep(ctx);
      if (steps.sort && !isCancelled()) parts.sort = await sortStep(ctx);
      if (steps.feed && !isCancelled()) parts.feed = await feedStep(ctx);
      if ((parts.catalog && !parts.catalog.empty) || parts.profiles?.read || parts.sort?.moved) {
        await catalogService.updateRetentionRanking();
      }
      status(summary(parts, isCancelled()));
    }
  });

  return {
    api: { DEFAULT_STEPS, readSteps },
    workerHandlers: { maintain: job.workerHandler },
    buttons: job.buttons("#oweh-maintain-start", "#oweh-maintain-stop")
  };
});
