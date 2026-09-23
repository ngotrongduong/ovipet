"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.stateHealth) return;
  const stateDb = OWEH_BG.stateDb;
  const commandJournal = OWEH_BG.commandJournal;
  if (!stateDb || !commandJournal) throw new Error("state-db and command-journal must load before bg/state-health.js");
  const { migrateLegacyPetsOnce, getAllRows } = stateDb;
  const { getAllCommands, pruneOldCommands } = commandJournal;

  function isCompletePet(pet) {
    return Boolean(pet?.gender && pet?.species && pet?.name && Array.isArray(pet?.ancestors)
      && pet?.colors && ["body1", "body2", "scales", "extra1", "extra2"].every(key => pet.colors[key]));
  }

  async function read(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isFinite(timestamp)) throw new Error("invalid-health-time");
    await Promise.all([migrateLegacyPetsOnce(), pruneOldCommands(timestamp)]);
    const [pets, commands, tasks] = await Promise.all([
      getAllRows("pets"),
      getAllCommands(),
      getAllRows("tasks")
    ]);
    const present = pets.filter(pet => pet.present !== false && pet.owned);
    return {
      pets: pets.length,
      present: present.length,
      complete: present.filter(isCompletePet).length,
      incomplete: present.filter(pet => !isCompletePet(pet)).length,
      stale: present.filter(pet => timestamp - Number(pet.lastProfileScanAt || pet.updatedAt || 0) > 7 * 24 * 60 * 60 * 1000).length,
      uncertainCommands: commands.filter(command => command.status === "dispatched").length,
      rejectedCommands: commands.filter(command => command.status === "rejected").length,
      activeTasks: tasks.filter(task => task.status === "running" && task.leaseUntil > timestamp).length,
      staleTasks: tasks.filter(task => task.status === "running" && task.leaseUntil <= timestamp).length
    };
  }

  OWEH_BG.stateHealth = Object.freeze({ read, isCompletePet });
})();
