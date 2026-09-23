"use strict";

// Explicit-start Hatchery newborn processor. Durable progress lives in owehHatchlingRun and
// queues in storage; this module owns retries, queue progression, male-move phase and Stop.
// UI mutations that still depend on live OviPets forms are injected through hatchlingActions.
OWEH.register("feature-hatchlings", helpers => {
  const {
    storageGet, storageSet, getPetsByIds, sleep, setStatus,
    requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone,
    isWorkerOwner, workerClient, routes, hatcheryDom, domain, settings,
    hatchlingActions, pageActions
  } = helpers;
  const { colors, petRecord, breedingPlan } = domain;
  const HATCHLING_RECHECK_MS = 60 * 1000;
  const HATCHLING_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
  let processing = false;
  let rescanTimer = null;

  async function read() {
    return storageGet("owehHatchlingRun", { active: false, phase: "scan", index: 0 });
  }

  function scheduleRetry(generation, force) {
    if (rescanTimer || !routes.isOwnHatchery()) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      if (workerClient.getOwner() !== "hatchlings" || workerClient.getGeneration() !== generation) return;
      startWorker(generation, force);
    }, HATCHLING_RECHECK_MS);
  }

  async function recordCheck(id, status, now = Date.now()) {
    const records = await storageGet("owehHatchlingRecords", {});
    const cutoff = now - HATCHLING_RECORD_TTL_MS;
    for (const [petId, record] of Object.entries(records)) {
      if ((record.at || 0) < cutoff) delete records[petId];
    }
    records[id] = { at: now, status };
    await storageSet({ owehHatchlingRecords: records });
  }

  async function eligibleCards(force = false, now = Date.now()) {
    const records = await storageGet("owehHatchlingRecords", {});
    return hatcheryDom.getHatcheryPetCards().filter(card => {
      if (card.turnable || (!card.likelyHatched && !card.unnamed)) return false;
      if (card.unnamed || force) return true;
      const record = records[card.id];
      if (!record) return true;
      const cooldown = /^(?:moved|renamed|already)/.test(record.status || "")
        ? HATCHLING_RECORD_TTL_MS
        : HATCHLING_RECHECK_MS;
      return now - (record.at || 0) >= cooldown;
    }).sort((a, b) => Number(b.unnamed) - Number(a.unnamed));
  }

  async function startWorker(generation, force = true) {
    if (!routes.isOwnHatchery()) {
      setStatus("Open your own Hatchery first");
      reportWorkerDone();
      return;
    }
    if (hatcheryDom.getHatcheryEggs().length) {
      scheduleRetry(generation, force);
      setStatus("Turnable eggs are handled first; hatchling sorting will resume afterward");
      return;
    }
    const [run, eggRun, sweep, breedCampaign, petIndex] = await Promise.all([
      read(), hatchlingActions.readOwnEggRun(), hatchlingActions.readSweep(),
      hatchlingActions.readBreedCampaign(), storageGet("owehPetIndex", { active: false })
    ]);
    if (run.active) return;
    const localEggRun = eggRun.active && hatchlingActions.ownedByThisTab(eggRun);
    const localSweep = sweep.active && await isWorkerOwner("sweep");
    if (localEggRun || localSweep || breedCampaign.active || petIndex.active) {
      scheduleRetry(generation, force);
      setStatus("Hatchling sorting is waiting for the current automation to finish");
      return;
    }
    const queue = await eligibleCards(force);
    if (!queue.length) {
      scheduleRetry(generation, force);
      setStatus("No newly hatched pets right now; will keep checking while this claim is held");
      return;
    }
    const firstUsr = queue.map(item => item.href.match(/[?&]usr=(\d+)/)?.[1]).find(Boolean);
    const ownUserId = firstUsr || hatchlingActions.getOwnUserId();
    hatchlingActions.setOwnUserId(ownUserId);
    const target = { ...colors.STRICT_PURE_TARGET };
    await storageSet({
      owehOwnUserId: ownUserId,
      owehHatchlingQueue: queue,
      owehHatchlingRun: {
        active: true,
        phase: "scan",
        index: 0,
        returnHash: pageActions.currentHash(),
        target,
        maleCandidates: [],
        renamed: 0,
        movedFemales: 0,
        movedMales: 0,
        skippedEggs: 0,
        unroutable: 0,
        errors: 0,
        startedAt: Date.now()
      }
    });
    reportWorkerPhase(`checking 0/${queue.length}`);
    setStatus(`Checking ${queue.length} Hatchery card(s) for newly hatched pets`);
    routes.navigateTo(queue[0].href || routes.petProfilePath(queue[0].id, ownUserId));
  }

  async function requestStart() {
    setStatus("Claiming the shared background tab for hatchling processing...");
    const response = await requestClaimWorker("hatchlings", "https://ovipets.com/#!/?src=pets&sub=hatchery");
    if (!response.ok) {
      if (response.reason === "busy") {
        setStatus(`Shared background tab is busy running "${response.owner}" (${response.phase || "working"}) — stop it first, then try again`);
      } else {
        setStatus(`Could not start hatchling processing${response.error ? `: ${response.error}` : ""}`);
      }
      return;
    }
    setStatus(response.alreadyRunning
      ? "Hatchling processing is already running in the shared background tab"
      : "Hatchling processing started in the shared background tab");
  }

  async function stop() {
    const state = await read();
    if (state.active) await storageSet({ owehHatchlingRun: { ...state, active: false } });
    await requestReleaseWorker("hatchlings");
  }

  function stopLocal() {
    if (rescanTimer) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
    storageGet("owehHatchlingRun", { active: false }).then(state => {
      if (state.active) storageSet({ owehHatchlingRun: { ...state, active: false } });
    });
    setStatus("Hatchling processing stopped");
  }

  async function prepareMaleMoves(state) {
    const moveQueue = [...new Map((state.maleCandidates || []).map(candidate => [candidate.id, {
      ...candidate,
      target: breedingPlan.MALES_ENCLOSURE,
      source: "hatchery"
    }])).values()];
    await storageSet({ owehHatchMaleMoveQueue: moveQueue });
    return moveQueue;
  }

  async function finish(state) {
    state.active = false;
    await storageSet({ owehHatchlingRun: state });
    // Ranking needs the whole pet DB, so compute it once per run rather than per hatchling.
    await hatchlingActions.updateRetentionRanking();
    setStatus(`Hatchery complete — renamed ${state.renamed || 0}, females moved ${state.movedFemales || 0}, males moved to Males ${state.movedMales || 0}, skipped ${state.unroutable || 0}, errors ${state.errors || 0}`);
    routes.navigateTo(state.returnHash || "?src=pets&sub=hatchery");
    reportWorkerDone();
  }

  async function advanceScan(state, queue) {
    const latest = await read();
    if (!latest.active) return;
    state.index += 1;
    if (state.index < queue.length) {
      await storageSet({ owehHatchlingRun: state });
      setStatus(`Hatchery scan ${state.index}/${queue.length} · renamed ${state.renamed || 0} · females moved ${state.movedFemales || 0}`);
      routes.navigateTo(queue[state.index].href || routes.petProfilePath(queue[state.index].id, hatchlingActions.getOwnUserId()));
      return;
    }
    const maleMoves = await prepareMaleMoves(state);
    if (!maleMoves.length) return finish(state);
    state.phase = "maleMove";
    state.index = 0;
    await storageSet({ owehHatchlingRun: state });
    setStatus(`Moving ${maleMoves.length} new male(s) into ${breedingPlan.MALES_ENCLOSURE}`);
    routes.navigateTo(routes.petProfilePath(maleMoves[0].id, hatchlingActions.getOwnUserId()));
  }

  async function process() {
    if (processing) return;
    processing = true;
    try {
      const state = await read();
      if (!state.active || !(await isWorkerOwner("hatchlings"))) return;
      if (state.phase === "maleMove") {
        const moves = await storageGet("owehHatchMaleMoveQueue", []);
        const item = moves[state.index];
        if (!item) return finish(state);
        if (routes.currentPetId() !== item.id) return;
        await sleep(settings.getPageLoadDelayMs());
        const result = await hatchlingActions.movePetToEnclosure(item.target);
        if (result.moved || result.alreadyThere) {
          if (result.moved) state.movedMales = (state.movedMales || 0) + 1;
          // Touch only this pet: owehPets writes merge per record, and re-writing the whole
          // DB from a stale snapshot would clobber concurrent updates from other tabs.
          const pets = await getPetsByIds([item.id]);
          if (pets[item.id]) await storageSet({ owehPets: { [item.id]: { id: item.id, enclosure: item.target } } });
          await recordCheck(item.id, result.moved ? "moved-male" : "already-male");
        } else {
          state.errors = (state.errors || 0) + 1;
          await recordCheck(item.id, `error:${result.reason || "move"}`);
        }
        const latest = await read();
        if (!latest.active) return;
        state.index += 1;
        await storageSet({ owehHatchlingRun: state });
        if (state.index >= moves.length) return finish(state);
        routes.navigateTo(routes.petProfilePath(moves[state.index].id, hatchlingActions.getOwnUserId()));
        return;
      }

      const queue = await storageGet("owehHatchlingQueue", []);
      const item = queue[state.index];
      if (!item) return advanceScan(state, queue);
      if (routes.currentPetId() !== item.id) return;
      await sleep(settings.getPageLoadDelayMs());
      if (!(await hatchlingActions.openTab("Overview"))) {
        state.errors = (state.errors || 0) + 1;
        await recordCheck(item.id, "error:overview");
        return advanceScan(state, queue);
      }
      const gender = (await hatchlingActions.waitForPetGender()).trim();
      const pet = hatchlingActions.readPet();
      if (!/^(?:Female|Male)$/i.test(gender) || !pet) {
        state.skippedEggs = (state.skippedEggs || 0) + 1;
        await recordCheck(item.id, "not-hatched");
        return advanceScan(state, queue);
      }
      pet.gender = gender;
      Object.assign(pet, {
        owned: true, present: true, enclosure: "Hatchery", enclosureId: null,
        catalogModified: item.modified || null, lastProfileScanAt: Date.now(), lastSeenAt: Date.now()
      });
      const desiredName = colors.suggestedPetName(pet);
      const rename = await hatchlingActions.renamePet(pet, desiredName);
      if (rename.changed) {
        pet.name = rename.name;
        state.renamed = (state.renamed || 0) + 1;
      } else if (rename.reason !== "already-named") {
        state.errors = (state.errors || 0) + 1;
        await recordCheck(item.id, `error:${rename.reason || "name"}`);
        return advanceScan(state, queue);
      }

      const pets = await getPetsByIds([pet.id]);
      const existingPet = pets[pet.id];
      pets[pet.id] = { ...(existingPet || {}), ...pet };
      const databaseMeta = await storageGet("owehDatabaseMeta", {});
      if (!existingPet || existingPet.present === false) {
        databaseMeta.catalogCount = Number(databaseMeta.catalogCount || 0) + 1;
        if (petRecord.isCompletePetRecord(pets[pet.id])) {
          databaseMeta.completeProfiles = Number(databaseMeta.completeProfiles || 0) + 1;
        }
      }
      databaseMeta.lastProfileAt = Date.now();
      await storageSet({ owehPets: pets, owehDatabaseMeta: databaseMeta });

      if (gender.toLowerCase() === "female") {
        const stockMaxDistance = await storageGet("owehBreedingStockMaxDistance", breedingPlan.DEFAULT_BREEDING_STOCK_MAX_DISTANCE);
        const targetEnclosure = breedingPlan.desiredProgramEnclosure(pet, stockMaxDistance);
        if (!targetEnclosure) {
          state.unroutable = (state.unroutable || 0) + 1;
          await recordCheck(item.id, "renamed-unroutable");
          return advanceScan(state, queue);
        }
        const moved = await hatchlingActions.movePetToEnclosure(targetEnclosure);
        if (moved.moved || moved.alreadyThere) {
          if (moved.moved) state.movedFemales = (state.movedFemales || 0) + 1;
          pets[pet.id].enclosure = targetEnclosure;
          await storageSet({ owehPets: pets });
          await recordCheck(item.id, moved.moved ? "moved-female" : "already-female");
        } else {
          state.errors = (state.errors || 0) + 1;
          await recordCheck(item.id, `error:${moved.reason || "move"}`);
        }
      } else {
        state.maleCandidates.push({
          id: pet.id,
          name: pet.name,
          target: breedingPlan.MALES_ENCLOSURE,
          rank: hatchlingActions.rankMale(pet, state.target || {})
        });
        await recordCheck(item.id, "renamed-male-candidate");
      }
      await advanceScan(state, queue);
    } finally {
      processing = false;
    }
  }

  return {
    api: {
      read,
      requestStart,
      startWorker,
      stop,
      stopLocal,
      process,
      eligibleCards,
      recordCheck,
      isProcessing: () => processing
    }
  };
});
