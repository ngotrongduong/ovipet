"use strict";

// Button: "Sort pets into enclosures". Reads the pet database (filled by "Update pet
// catalog" / passive collection) and sends one `pets_enclosure` command per pet that isn't in
// the enclosure the breeding program wants. Scans nothing and feeds nothing.
OWEH.register("job-sort", helpers => {
  const { storageGet, storageSet, sleep, domain, gameActions, settings } = helpers;
  const { breedingPlan } = domain;

  const job = OWEH.get("runner").api.createJob({
    owner: "sort",
    label: "Sort pets into enclosures",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const [pets, enclosureIds, maxDistance] = await Promise.all([
        storageGet("owehPets", {}),
        storageGet("owehEnclosureIds", {}),
        storageGet("owehBreedingStockMaxDistance", breedingPlan.DEFAULT_BREEDING_STOCK_MAX_DISTANCE)
      ]);
      if (!Object.keys(pets).length || !Object.keys(enclosureIds).length) {
        status("Sort: the pet database has no enclosures yet — run Update pet catalog first");
        return;
      }
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
      if (!actions.length) {
        status("Sort: every pet is already in the right enclosure");
        return;
      }
      let moved = 0;
      let errors = 0;
      const changed = {};
      for (let index = 0; index < actions.length; index += 1) {
        if (isCancelled()) break;
        const { pet, target } = actions[index];
        phase(`moving ${index + 1}/${actions.length}`);
        status(`Sort: moving ${pet.name} → ${target} (${index + 1}/${actions.length})`);
        const result = await gameActions.fastMovePetToEnclosure(pet.id, target);
        if (result.moved) {
          pet.enclosure = target;
          pet.enclosureId = enclosureIds[target] || pet.enclosureId;
          changed[pet.id] = pet;
          moved += 1;
        } else {
          errors += 1;
        }
        if ((moved + errors) % 5 === 0 && Object.keys(changed).length) {
          await storageSet({ owehPets: changed });
          for (const id of Object.keys(changed)) delete changed[id];
        }
        await sleep(Math.max(500, settings.getDelayMs()));
      }
      if (Object.keys(changed).length) await storageSet({ owehPets: changed });
      status(`Sort ${isCancelled() ? "stopped" : "finished"}: moved ${moved}, errors ${errors}`);
    }
  });

  return {
    workerHandlers: { sort: job.workerHandler },
    buttons: job.buttons("#oweh-sort-start", "#oweh-sort-stop")
  };
});
