"use strict";

// Button: "Update pet catalog". Does exactly one thing: scan every Overview enclosure (after
// OviPets has finished mounting them) and write what it sees into the pet database. It opens
// no pet profile, renames nothing and moves nothing; it only remembers, per pet, whether the
// profile is now out of date (`profileStale`) so the separate "Refresh pet profiles" job knows
// what to open.
OWEH.register("job-catalog", helpers => {
  const { storageGet, storageSet, routes, domain, settings, catalogService } = helpers;
  const { petRecord } = domain;

  const job = OWEH.get("runner").api.createJob({
    owner: "catalog",
    label: "Update pet catalog",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      if (!routes.isPetsOverview()) routes.navigateTo("?src=pets&sub=overview");
      await catalogService.waitForOverviewShell(Math.max(10000, settings.getPageLoadDelayMs() * 6));
      phase("scanning enclosures");
      status("Update pet catalog: scanning every enclosure...");
      const knownEnclosureCount = Object.keys(await storageGet("owehEnclosureIds", {})).length;
      const catalog = await catalogService.collectAllOverviewPets();
      if (isCancelled()) return;
      if (!catalog.length) {
        status("Update pet catalog: no pet cards were found — nothing was changed");
        return;
      }
      catalogService.setOwnUserId(catalog.find(pet => pet.usr)?.usr);
      const pets = await storageGet("owehPets", {});
      const visibleIds = new Set(catalog.map(item => item.id));
      let added = 0;
      let stale = 0;
      for (const item of catalog) {
        const cached = pets[item.id];
        if (!cached) added += 1;
        // Computed BEFORE catalogModified is overwritten below; the flag then survives later
        // catalog runs until a profile refresh clears it.
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
      // Fewer enclosures than last time means the scan was partial: pets in the unscanned ones
      // are unknown, not gone, so nobody is marked absent on a partial scan.
      const scannedEnclosureCount = Object.keys(await storageGet("owehEnclosureIds", {})).length;
      const partialScan = scannedEnclosureCount < knownEnclosureCount;
      if (!partialScan) {
        for (const pet of Object.values(pets)) {
          if (pet?.owned && pet.id && !visibleIds.has(pet.id)) pet.present = false;
        }
      }
      await storageSet({
        owehOwnUserId: catalogService.getOwnUserId(),
        owehPets: pets,
        owehDatabaseMeta: petRecord.databaseMetaFor(pets, catalog, stale, Date.now())
      });
      await catalogService.updateRetentionRanking(pets);
      const enclosures = new Set(catalog.map(pet => pet.enclosureId ?? pet.enclosure)).size;
      status(`Update pet catalog: saved ${catalog.length} pet(s) to database from ${enclosures} enclosure(s), ${added} new, ${stale} need a profile refresh${partialScan ? " — only part of the enclosures loaded, so no pet was marked missing; run it again" : ""}`);
    }
  });

  return {
    workerHandlers: { catalog: job.workerHandler },
    buttons: job.buttons("#oweh-catalog-start", "#oweh-catalog-stop")
  };
});
