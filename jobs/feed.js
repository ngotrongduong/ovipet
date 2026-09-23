"use strict";

// Button: "Feed pets". Reads the pet database and sends the free per-pet Feed command for
// every owned pet that isn't known to be full or fed recently. Never uses the Credit-priced
// Mass Feed. Scans nothing and sorts nothing.
OWEH.register("job-feed", helpers => {
  const { storageGet, storageSet, sleep, gameActions, settings } = helpers;
  // A fire-and-forget page-bridge response proves only that OviPets' own dispatcher
  // accepted the command. Give the live page/profile time to reflect the result, but do
  // not suppress retries for the full 20-hour confirmed-full window.
  const FEED_DISPATCH_RETRY_MS = 10 * 60 * 1000;

  const job = OWEH.get("runner").api.createJob({
    owner: "feed",
    label: "Feed pets",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const pets = await storageGet("owehPets", {});
      const now = Date.now();
      const queue = Object.values(pets)
        .filter(pet => pet?.owned && pet.present !== false && /^\d+$/.test(String(pet.id)))
        .filter(pet => {
          const knownFullRecently = Number(pet.foodPercent) >= 100
            && now - Number(pet.foodCheckedAt || 0) < settings.RECENT_FULL_FOOD_MS;
          const fedRecently = now - Number(pet.lastFedAt || 0) < settings.RECENT_FULL_FOOD_MS;
          const dispatchedRecently = now - Number(pet.feedDispatchedAt || 0) < FEED_DISPATCH_RETRY_MS;
          return !knownFullRecently && !fedRecently && !dispatchedRecently;
        })
        .sort((a, b) => Number(a.enclosureId || 0) - Number(b.enclosureId || 0) || Number(a.id) - Number(b.id));
      if (!queue.length) {
        status(Object.keys(pets).length
          ? "Feed: every pet was fed recently or is already full — nothing to do"
          : "Feed: the pet database is empty — run Update pet catalog first");
        return;
      }
      let sent = 0;
      let errors = 0;
      const changed = {};
      for (let index = 0; index < queue.length; index += 1) {
        if (isCancelled()) break;
        const pet = queue[index];
        phase(`feeding ${index + 1}/${queue.length}`);
        const result = await gameActions.feedPet(pet.id);
        if (result.ok) {
          sent += 1;
          // `pet_feed` is deliberately fire-and-forget. Persist only what we actually
          // know here: dispatch happened. A later catalog/profile observation owns
          // foodPercent/foodCheckedAt and therefore confirmation that the pet is full.
          pet.feedDispatchedAt = Date.now();
          changed[pet.id] = pet;
        } else {
          errors += 1;
        }
        if ((index + 1) % 10 === 0 && Object.keys(changed).length) {
          await storageSet({ owehPets: changed });
          for (const id of Object.keys(changed)) delete changed[id];
        }
        status(`Feed: ${index + 1}/${queue.length} · sent ${sent} · errors ${errors}`);
        await sleep(settings.PET_FEED_DELAY_MS);
      }
      if (Object.keys(changed).length) await storageSet({ owehPets: changed });
      if (sent) await storageSet({ owehLastFeedAt: Date.now() });
      status(`Feed ${isCancelled() ? "stopped" : "finished"}: sent ${sent}, errors ${errors}`);
    }
  });

  return {
    workerHandlers: { feed: job.workerHandler },
    buttons: job.buttons("#oweh-feed-start", "#oweh-feed-stop")
  };
});
