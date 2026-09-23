"use strict";

// Persistent pet-profile indexing state machine. The queue/progress survives page navigation
// in storage; this module owns the reentrancy guard, worker-ownership checks, Stop semantics,
// per-profile persistence and the handoff back to the breeding planner when indexing was
// started as part of a breed snapshot.
OWEH.register("feature-pet-index", helpers => {
  const {
    storageGet, storageSet, getPetsByIds, sleep, setStatus, requestReleaseWorker, isWorkerOwner,
    reportWorkerDone, routes, profileDom, domain, settings, petIndexActions
  } = helpers;
  const { petRecord } = domain;
  let processing = false;

  async function stop() {
    const state = await storageGet("owehPetIndex", { active: false, index: 0 });
    await storageSet({ owehPetIndex: { ...state, active: false } });
    await requestReleaseWorker(state.breedPlanning ? "breed" : "index");
    setStatus(`Pet indexing stopped after ${state.indexed || 0} profile(s)`);
  }

  function stopLocal() {
    storageGet("owehPetIndex", { active: false, index: 0 }).then(state => {
      if (state.active) storageSet({ owehPetIndex: { ...state, active: false } });
    });
    setStatus("Pet indexing stopped");
  }

  async function finish(state) {
    state.active = false;
    await storageSet({ owehPetIndex: state });
    await petIndexActions.updateRetentionRanking();
    setStatus(`Index complete — ${state.indexed || 0} pet(s), ${state.renamed || 0} renamed`);
    if (state.breedPlanning) {
      await storageSet({
        owehBreedStartRequest: {
          active: true, resumeFromIndex: true, strategy: state.breedStrategy || null, requestedAt: Date.now()
        }
      });
      routes.navigateTo("?src=pets&sub=overview");
    } else {
      if (state.returnHash) routes.navigateTo(state.returnHash);
      reportWorkerDone();
    }
  }

  async function nextProfilePath(petId) {
    const ownUserId = await storageGet("owehOwnUserId", null);
    return routes.petProfilePath(petId, ownUserId);
  }

  async function waitForPedigreeLoaded(timeoutMs = 8000, stableMs = 300) {
    const deadline = Date.now() + timeoutMs;
    let lastSignature = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (profileDom.isPedigreeLoaded?.()) {
        const signature = (profileDom.pedigreeAncestorIds?.() || []).map(String).join(",");
        if (signature !== lastSignature) {
          lastSignature = signature;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          return true;
        }
      } else {
        lastSignature = null;
        stableSince = 0;
      }
      await sleep(150);
    }
    return Boolean(profileDom.isPedigreeLoaded?.()) && lastSignature !== null;
  }

  async function ensurePedigreeLoaded() {
    if (await waitForPedigreeLoaded()) return true;
    // One bounded re-open handles cases where the first lazy-tab request was dropped while
    // the profile itself was still settling. Never loop forever on a broken profile.
    await petIndexActions.openTab("Overview");
    await sleep(150);
    await petIndexActions.openTab("Pedigree");
    return waitForPedigreeLoaded();
  }

  async function process() {
    if (processing) return;
    processing = true;
    try {
      const state = await storageGet("owehPetIndex", { active: false, index: 0 });
      if (!state.active) return;
      // Pet indexing is reused by two callers (Refresh pet profiles and breed planning), each
      // claiming the shared worker under its own name. Only the live owner may advance it.
      if (state.breedPlanning && !(await isWorkerOwner("breed"))) return;
      if (!state.breedPlanning && !(await isWorkerOwner("index"))) return;

      const queue = await storageGet("owehPetScanQueue", []);
      const item = queue[state.index];
      if (!item) {
        await finish(state);
        return;
      }
      if (routes.currentPetId() !== item.id) return;

      await sleep(settings.getPageLoadDelayMs());
      await petIndexActions.openTab("Overview");
      await petIndexActions.openTab("Pedigree");
      const pedigreeLoaded = await ensurePedigreeLoaded();
      const pet = profileDom.readPet();
      if (pet) {
        Object.assign(pet, {
          onCooldown: item.onCooldown,
          enclosure: item.enclosure,
          enclosureId: item.enclosureId,
          catalogModified: item.modified || null,
          lastProfileScanAt: Date.now(),
          profileStale: false,
          present: true,
          owned: true
        });
        if (!pedigreeLoaded || pet.pedigreeVerified !== true) {
          setStatus(`${pet.name}: Pedigree did not finish loading; cached as unverified and excluded from breeding`);
        }
        if (state.autoRename) {
          const result = await petIndexActions.renamePet(pet);
          if (result.changed) {
            pet.name = result.name;
            state.renamed = (state.renamed || 0) + 1;
          }
        }
        const pets = await getPetsByIds([pet.id]);
        const wasComplete = Boolean(pets[pet.id]) && petRecord.isCompletePetRecord(pets[pet.id]);
        pets[pet.id] = { ...(pets[pet.id] || {}), ...pet };
        const databaseMeta = await storageGet("owehDatabaseMeta", {});
        // Count transitions only: re-indexing an already complete profile must not inflate the
        // dashboard's "complete/catalog" counter past the catalog size.
        const isComplete = petRecord.isCompletePetRecord(pets[pet.id]);
        if (!wasComplete && isComplete) {
          databaseMeta.completeProfiles = Number(databaseMeta.completeProfiles || 0) + 1;
          databaseMeta.missingProfiles = Math.max(0, Number(databaseMeta.missingProfiles || 0) - 1);
        } else if (wasComplete && !isComplete) {
          databaseMeta.completeProfiles = Math.max(0, Number(databaseMeta.completeProfiles || 0) - 1);
        }
        databaseMeta.lastProfileAt = Date.now();
        await storageSet({ owehPets: pets, owehDatabaseMeta: databaseMeta });
        state.indexed = (state.indexed || 0) + 1;
      }

      // Stop may have cleared the active flag while profile reads/mutations were in flight.
      const latestState = await storageGet("owehPetIndex", { active: false });
      if (!latestState.active) return;

      state.index += 1;
      if (state.index >= queue.length) {
        await finish(state);
        return;
      }
      await storageSet({ owehPetIndex: state });
      setStatus(`Indexed ${state.index}/${queue.length} pet(s)${state.autoRename ? ` · renamed ${state.renamed || 0}` : ""}`);
      routes.navigateTo(await nextProfilePath(queue[state.index].id));
    } finally {
      processing = false;
    }
  }

  return { api: { stop, stopLocal, process, isProcessing: () => processing } };
});
