"use strict";

// Button: "Refresh pet profiles". Opens the profile of every owned pet whose stored profile is
// missing, incomplete, flagged stale by "Update pet catalog", or wrongly named, and saves what
// it reads (renaming to BODY1-BODY2-SCALES when "Rename while indexing" is on). It does NOT
// scan the Overview itself — run "Update pet catalog" first if the database is out of date.
// The pet-to-pet navigation is driven by features/pet-index.js (it must survive each page
// change), so this job only builds the queue and starts the first page; that feature reports
// completion (`manualDone`).
OWEH.register("job-profiles", helpers => {
  const { storageGet, storageSet, routes, domain, profileIndexService } = helpers;
  const { colors, petRecord } = domain;

  const job = OWEH.get("runner").api.createJob({
    owner: "index",
    label: "Refresh pet profiles",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    manualDone: true,
    async run({ phase, status, isCancelled }) {
      const [pets, autoRename, ownUserId] = await Promise.all([
        storageGet("owehPets", {}),
        storageGet("owehAutoRename", true),
        storageGet("owehOwnUserId", null)
      ]);
      // Stop may have cleared owehPetIndex while the reads were in flight; writing it now
      // would leave an active flag with no live lease behind it.
      if (isCancelled()) return;
      const owned = Object.values(pets).filter(pet => pet?.owned && pet.present !== false && /^\d+$/.test(String(pet.id)));
      if (!owned.length) {
        status("Refresh pet profiles: the pet database is empty — run Update pet catalog first");
        helpers.reportWorkerDone();
        return;
      }
      const wrongName = pet => {
        if (!autoRename) return false;
        const expected = colors.suggestedPetName(pet);
        return Boolean(expected) && pet.name !== expected;
      };
      const queue = owned
        .filter(pet => pet.profileStale || !petRecord.isCompletePetRecord(pet) || wrongName(pet))
        .map(pet => ({
          id: pet.id, name: pet.name, modified: pet.modified || null, onCooldown: pet.onCooldown,
          enclosure: pet.enclosure, enclosureId: pet.enclosureId
        }));
      if (!queue.length) {
        status(`Refresh pet profiles: all ${owned.length} profile(s) are up to date`);
        helpers.reportWorkerDone();
        return;
      }
      await storageSet({
        owehPetScanQueue: queue,
        owehPetIndex: { active: true, index: 0, autoRename, returnHash: "#!/?src=pets&sub=overview", renamed: 0, indexed: 0 }
      });
      phase(`refreshing 0/${queue.length}`);
      status(`Refresh pet profiles: ${queue.length} of ${owned.length} profile(s) need refreshing`);
      routes.navigateTo(routes.petProfilePath(queue[0].id, ownUserId));
    }
  });

  // Unlike the straight-line jobs, this one leaves a persistent `owehPetIndex.active` flag for
  // the navigation driver, so Stop must clear that flag directly (a flag stuck true with no
  // live claim is the v5.0.1 bug class) and the dispatch-side stop must clear it too.
  return {
    workerHandlers: {
      index: {
        start: job.workerHandler.start,
        stop: () => {
          job.workerHandler.stop();
          profileIndexService.stopPetIndexCampaignLocal();
        }
      }
    },
    buttons: {
      "#oweh-profiles-start": { label: "Starting Refresh pet profiles", handler: job.request },
      "#oweh-profiles-stop": { label: "Stopping Refresh pet profiles", handler: profileIndexService.stopPetIndexCampaign }
    }
  };
});
