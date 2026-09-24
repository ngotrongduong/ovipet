"use strict";

// Hatchery newborn processor (v5.5.0, command-first). One pass reads the Hatchery panel and each
// newborn's profile with services/pet-fetch.js, then names it, saves it to the database and moves
// it to its enclosure with direct game commands: no navigation, so the shared worker tab stays on
// whatever page it opened. Durable progress lives in owehHatchlingRun; Stop clears it.
OWEH.register("feature-hatchlings", helpers => {
  const {
    storageGet, storageSet, getPetsByIds, sleep, setStatus,
    requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone,
    workerClient, domain, gameActions, petFetch, hatchlingActions
  } = helpers;
  const { colors, petRecord, breedingPlan } = domain;
  const HATCHLING_RECHECK_MS = 60 * 1000;
  const HATCHLING_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
  const PET_PAUSE_MS = 150;
  let processing = false;
  let runToken = 0;

  async function read() {
    return storageGet("owehHatchlingRun", { active: false, phase: "scan", index: 0 });
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

  // Unnamed newborns always qualify; other Hatchery items without a Turn/Hatch icon are either
  // hatched pets or eggs still incubating, and are rechecked on the per-pet cooldown.
  async function eligibleCards(force = false, now = Date.now(), hatchery = null) {
    const panel = hatchery || await petFetch.readHatchery();
    const records = await storageGet("owehHatchlingRecords", {});
    const blocked = new Set([...(panel.turnable || []), ...(panel.hatchable || [])]);
    const unnamed = new Set(panel.unnamedIds || []);
    const ids = [...new Set([...(panel.unnamedIds || []), ...(panel.eggIds || [])])];
    return ids.filter(id => {
      if (blocked.has(id)) return false;
      if (unnamed.has(id) || force) return true;
      const record = records[id];
      if (!record) return true;
      const cooldown = /^(?:moved|renamed|already)/.test(record.status || "")
        ? HATCHLING_RECORD_TTL_MS
        : HATCHLING_RECHECK_MS;
      return now - (record.at || 0) >= cooldown;
    }).map(id => ({ id, unnamed: unnamed.has(id) }))
      .sort((a, b) => Number(b.unnamed) - Number(a.unnamed));
  }

  async function stillRunning(token) {
    return token === runToken && (await read()).active;
  }

  async function saveRecord(pet) {
    const pets = await getPetsByIds([pet.id]);
    const existing = pets[pet.id];
    const merged = petFetch.mergePetRecord(existing, pet);
    const databaseMeta = await storageGet("owehDatabaseMeta", {});
    if (!existing || existing.present === false) {
      databaseMeta.catalogCount = Number(databaseMeta.catalogCount || 0) + 1;
      if (petRecord.isCompletePetRecord(merged)) {
        databaseMeta.completeProfiles = Number(databaseMeta.completeProfiles || 0) + 1;
      }
    }
    databaseMeta.lastProfileAt = Date.now();
    // Only this pet's record: owehPets writes merge per record.
    await storageSet({ owehPets: { [pet.id]: merged }, owehDatabaseMeta: databaseMeta });
  }

  async function moveTo(pet, profile, target) {
    const current = breedingPlan.normalizeEnclosureLabel(profile.enclosureLabel || "");
    if (current && current === breedingPlan.normalizeEnclosureLabel(target)) return { alreadyThere: true };
    const optionId = Object.entries(profile.enclosureOptions || {})
      .find(([label]) => breedingPlan.normalizeEnclosureLabel(label) === breedingPlan.normalizeEnclosureLabel(target))?.[1];
    return optionId != null
      ? gameActions.movePetToEnclosureId(pet.id, optionId)
      : gameActions.fastMovePetToEnclosure(pet.id, target);
  }

  async function processPet(state, item, ownUserId) {
    const result = await petFetch.readPet(item.id, ownUserId);
    if (!result.ok) {
      if (result.profile && !/^(?:Female|Male)$/i.test(result.profile.gender || "")) {
        state.skippedEggs = (state.skippedEggs || 0) + 1;
        return recordCheck(item.id, "not-hatched");
      }
      state.errors = (state.errors || 0) + 1;
      return recordCheck(item.id, `error:${result.reason || "read"}`);
    }
    const { profile, record } = result;
    const gender = String(profile.gender || "").trim();
    if (!/^(?:Female|Male)$/i.test(gender)) {
      state.skippedEggs = (state.skippedEggs || 0) + 1;
      return recordCheck(item.id, "not-hatched");
    }
    const now = Date.now();
    const pet = {
      ...record, gender, owned: true, present: true,
      enclosure: profile.enclosureLabel || "Hatchery", enclosureId: profile.enclosureId ?? null,
      lastProfileScanAt: now, lastSeenAt: now, profileStale: false
    };

    const desiredName = colors.suggestedPetName(pet);
    const unnamed = Boolean(profile.unnamed || item.unnamed);
    if (desiredName && (unnamed || pet.name !== desiredName) && (profile.canName || profile.canRename || unnamed)) {
      const named = await gameActions.namePet(pet.id, desiredName, { unnamed });
      if (!named?.ok) {
        state.errors = (state.errors || 0) + 1;
        await saveRecord(pet);
        return recordCheck(item.id, `error:${named?.reason || "name"}`);
      }
      pet.name = desiredName;
      state.renamed = (state.renamed || 0) + 1;
    }
    await saveRecord(pet);

    const female = gender.toLowerCase() === "female";
    let target = breedingPlan.MALES_ENCLOSURE;
    if (female) {
      const stockMaxDistance = await storageGet("owehBreedingStockMaxDistance", breedingPlan.DEFAULT_BREEDING_STOCK_MAX_DISTANCE);
      target = breedingPlan.desiredProgramEnclosure(pet, stockMaxDistance);
      if (!target) {
        state.unroutable = (state.unroutable || 0) + 1;
        return recordCheck(item.id, "renamed-unroutable");
      }
    }
    const moved = await moveTo(pet, profile, target);
    const kind = female ? "female" : "male";
    if (moved.moved || moved.alreadyThere) {
      if (moved.moved) {
        if (female) state.movedFemales = (state.movedFemales || 0) + 1;
        else state.movedMales = (state.movedMales || 0) + 1;
        await storageSet({ owehPets: { [pet.id]: { id: pet.id, enclosure: target, enclosureId: null } } });
      }
      return recordCheck(item.id, moved.moved ? `moved-${kind}` : `already-${kind}`);
    }
    state.errors = (state.errors || 0) + 1;
    return recordCheck(item.id, `error:${moved.reason || "move"}`);
  }

  async function finish(state, message) {
    state.active = false;
    state.finishedAt = Date.now();
    await storageSet({ owehHatchlingRun: state });
    // Ranking needs the whole pet DB, so compute it once per run rather than per hatchling.
    await hatchlingActions.updateRetentionRanking();
    setStatus(message || `Hatchery complete — renamed ${state.renamed || 0}, females moved ${state.movedFemales || 0}, males moved to ${breedingPlan.MALES_ENCLOSURE} ${state.movedMales || 0}, not hatched ${state.skippedEggs || 0}, unroutable ${state.unroutable || 0}, errors ${state.errors || 0}`);
    reportWorkerDone();
  }

  async function runPass(state, queue, token) {
    const ownUserId = state.ownUserId || null;
    for (let index = state.index || 0; index < queue.length; index += 1) {
      if (!(await stillRunning(token))) return;
      await processPet(state, queue[index], ownUserId);
      state.index = index + 1;
      if (!(await stillRunning(token))) return;
      await storageSet({ owehHatchlingRun: state });
      reportWorkerPhase(`checking ${state.index}/${queue.length}`);
      setStatus(`Hatchery ${state.index}/${queue.length} · renamed ${state.renamed || 0} · females moved ${state.movedFemales || 0} · males moved ${state.movedMales || 0}`);
      if (index < queue.length - 1) await sleep(PET_PAUSE_MS);
    }
    if (await stillRunning(token)) await finish(state);
  }

  async function startWorker(generation, force = true) {
    if (processing) return;
    processing = true;
    const token = ++runToken;
    try {
      const run = await read();
      if (run.active) return;
      let hatchery;
      try {
        hatchery = await petFetch.readHatchery();
      } catch (error) {
        setStatus(`Could not read the Hatchery: ${error?.message || error}`);
        reportWorkerDone();
        return;
      }
      const queue = await eligibleCards(force, Date.now(), hatchery);
      if (!queue.length) {
        setStatus(hatchery.turnable?.length
          ? `No newborns to process — ${hatchery.turnable.length} egg(s) still need Turn Egg`
          : "No newborns to process in the Hatchery");
        reportWorkerDone();
        return;
      }
      const ownUserId = hatchlingActions.getOwnUserId() || await storageGet("owehOwnUserId", null);
      const state = {
        active: true, phase: "scan", index: 0, ownUserId,
        renamed: 0, movedFemales: 0, movedMales: 0,
        skippedEggs: 0, unroutable: 0, errors: 0, startedAt: Date.now()
      };
      await storageSet({ owehHatchlingQueue: queue, owehHatchlingRun: state });
      reportWorkerPhase(`checking 0/${queue.length}`);
      setStatus(`Processing ${queue.length} Hatchery newborn(s): name, save, move`);
      await runPass(state, queue, token);
    } catch (error) {
      console.error("[OviPets Helper] hatchling pass failed", error);
      const state = await read();
      await finish({ ...state }, `Hatchling processing failed: ${error?.message || error}`);
    } finally {
      processing = false;
    }
  }

  // Resumes a run this tab still owns after a reload of the worker tab.
  async function process() {
    if (processing) return;
    const state = await read();
    if (!state.active || workerClient.getOwner() !== "hatchlings") return;
    processing = true;
    const token = ++runToken;
    try {
      const queue = await storageGet("owehHatchlingQueue", []);
      await runPass({ ...state }, queue, token);
    } finally {
      processing = false;
    }
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
      return response;
    }
    setStatus(response.alreadyRunning
      ? "Hatchling processing is already running in the shared background tab"
      : "Hatchling processing started in the shared background tab");
    return response;
  }

  async function stop() {
    runToken += 1;
    const state = await read();
    if (state.active) await storageSet({ owehHatchlingRun: { ...state, active: false } });
    await requestReleaseWorker("hatchlings");
  }

  function stopLocal() {
    runToken += 1;
    storageGet("owehHatchlingRun", { active: false }).then(state => {
      if (state.active) storageSet({ owehHatchlingRun: { ...state, active: false } });
    });
    setStatus("Hatchling processing stopped");
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
