"use strict";

// Database-first breeding campaign state machine. Planning scans the cached/visible catalog,
// requests profile indexing only for stale/missing records, then executes the deterministic
// female-first plan through direct game-dispatch commands. UI/catalog collection stays behind
// the narrow breedingActions adapter; planner math remains in domain/.
OWEH.register("feature-breeding", helpers => {
  const {
    storageGet, storageSet, getPetsByIds, setStatus, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone,
    isWorkerOwner, workerClient, routes, domain, gameActions, settings, breedingActions
  } = helpers;
  const { colors, petRecord, breedingPlan, breedingScore } = domain;
  // content.js injects pedigree explicitly. The global fallback is deliberate defense-in-depth:
  // manifest load order guarantees domain/pedigree.js is loaded before this feature, so a future
  // helper-wiring regression cannot crash the campaign after a long profile-index pass.
  const pedigree = domain?.pedigree || globalThis.OWEH?.domain?.pedigree;
  if (!pedigree?.pedigreeCompatibility) {
    throw new Error("feature-breeding requires domain.pedigree.pedigreeCompatibility");
  }
  const { BREEDING_STRATEGIES, normalizeBreedingStrategy } = breedingPlan;
  let processing = false;
  let planning = false;
  let continuingStart = false;
  let confirming = false;
  const OVERVIEW_URL = "https://ovipets.com/#!/?src=pets&sub=overview";
  // A preview reflects cooldowns at planning time; after this long it must be rebuilt.
  const PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;

  async function read() {
    return storageGet("owehBreedCampaign", { active: false, femaleIndex: 0, attempted: {}, bredCount: 0 });
  }

  function strategyLabel(strategy) {
    return strategy === BREEDING_STRATEGIES.SAME_FF_TARGET ? "Same-FF target improvement" : "Pure-line";
  }

  function normalizePairLimit(value) {
    const limit = Math.floor(Number(value));
    return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 999) : 0;
  }

  async function startWorker(generation, resumeFromIndex = false, strategyOverride = null) {
    if (planning) return;
    if (!resumeFromIndex) {
      // The worker was claimed by Confirm: execute the plan the user reviewed, never re-plan.
      const confirmed = await read();
      if (confirmed.active && confirmed.confirmedAt) {
        const queueLength = (await storageGet("owehBreedQueue", [])).length;
        reportWorkerPhase(`breeding ${Math.min(Number(confirmed.femaleIndex || 0) + 1, queueLength)}/${queueLength}`);
        process();
        return;
      }
    }
    const strategy = normalizeBreedingStrategy(strategyOverride
      || await storageGet("owehBreedStrategy", BREEDING_STRATEGIES.PURE_LINE));
    // v5.7.0: planning is command-first — the catalog, profiles and partner lists are all
    // fetched as JSONP panels, so the worker tab never navigates (and needs no Overview).
    // `resumeFromIndex` (a start request left by a pre-v5.7.0 profile index) plans normally.
    void resumeFromIndex;
    const cancelled = () => generation != null && workerClient.getGeneration() !== generation;
    planning = true;
    try {
      const target = { ...colors.STRICT_PURE_TARGET };
      const hatchlingRun = await breedingActions.readHatchlingRun();
      if (hatchlingRun.active) {
        setStatus("Stop Hatchery processing before starting the breeding campaign");
        reportWorkerDone();
        return;
      }

      const snapshot = await planningSnapshot(strategy, cancelled);
      if (!snapshot) return;
      const { pets, ownUserId, catalogCount } = snapshot;
      const now = Date.now();
      const history = await storageGet("owehBreedHistory", []);
      reportWorkerPhase("partner lists");
      const gameEligible = await readGameEligible(pets, target, strategy, ownUserId, cancelled);
      if (cancelled()) return;
      const plan = breedingPlan.buildDatabaseBreedPlan(pets, target, history, {
        now,
        strategy,
        gameEligible,
        shortlistSize: breedingScore.DEFAULT_MALE_SHORTLIST_SIZE
      });
      if (!plan.femaleCount) {
        await storageSet({ owehBreedPreview: null });
        setStatus("No blue-heart-free indexed females found across the enclosure snapshot");
        reportWorkerDone();
        return;
      }
      // Planning never breeds. The plan is saved as a preview and the worker is released; only
      // the Confirm button turns it into an active campaign.
      const planStrategy = plan.strategy || strategy;
      const pairable = plan.queue.filter(row => row?.maleId).length;
      await storageSet({
        owehBreedPreview: {
          strategy: planStrategy,
          createdAt: now,
          queue: plan.queue,
          femaleCount: plan.femaleCount,
          pairable,
          maleCount: plan.maleCount,
          unpaired: plan.unpaired,
          species: plan.focusSpecies,
          shortlistSize: plan.shortlistSize,
          catalogCount,
          target
        },
        owehBreedStrategy: planStrategy,
        owehBreedStartRequest: { active: false, strategy: planStrategy }
      });
      setStatus(`${strategyLabel(planStrategy)} plan ready: ${pairable} pair(s) for ${plan.femaleCount} female(s), ${plan.maleCount} male(s), ${plan.unpaired} without a safe pair — nothing bred yet. Review it under Breeding and press Confirm.`);
      reportWorkerDone();
    } finally {
      planning = false;
    }
  }

  // v5.7.0: a catalog this recent (from Update database or an earlier plan) is reused as is;
  // an older one is re-fetched first. Pets in Males discard are never read.
  const CATALOG_FRESH_MS = 10 * 60 * 1000;
  // An incomplete record (usually an unverified pedigree) read this recently is not re-read on
  // every plan; a catalog change (profileStale) always forces a read.
  const PROFILE_RETRY_MS = 60 * 60 * 1000;
  const PLAN_CONCURRENCY = 3;
  const PLAN_SAVE_EVERY = 10;
  const isCullPet = pet => Boolean(breedingPlan.isCullEnclosure?.(pet?.enclosure));

  async function planningSnapshot(strategy, cancelled) {
    const petFetch = helpers.petFetch;
    const [pets, scanStats, enclosureIds, storedOwnUserId] = await Promise.all([
      storageGet("owehPets", {}),
      storageGet("owehEnclosureScanStats", null),
      storageGet("owehEnclosureIds", {}),
      storageGet("owehOwnUserId", null)
    ]);
    const now = Date.now();
    let ownUserId = storedOwnUserId || breedingActions.getOwnUserId();
    const fresh = scanStats && scanStats.partial !== true && now - Number(scanStats.at || 0) < CATALOG_FRESH_MS
      && Object.keys(enclosureIds || {}).length > 0 && Object.values(pets).some(pet => pet?.owned && pet.present !== false);
    let catalogCount;
    if (fresh) {
      catalogCount = Object.values(pets).filter(pet => pet?.owned && pet.present !== false).length;
      setStatus(`${strategyLabel(strategy)} plan: using the pet database (catalog ${Math.round((now - Number(scanStats.at)) / 60000)} min old, ${catalogCount} pets)`);
    } else {
      setStatus(`${strategyLabel(strategy)} plan: reading every enclosure...`);
      const scan = await petFetch.collectCatalog({
        isCancelled: cancelled,
        skipTab: tab => breedingPlan.isCullEnclosure(tab.label),
        onProgress: (index, total, tab) => reportWorkerPhase(`catalog ${index + 1}/${total} · ${tab.label}`)
      });
      if (scan.cancelled || cancelled()) return null;
      if (!scan.catalog.length) {
        setStatus("No pet cards found while scanning all enclosures");
        reportWorkerDone();
        return null;
      }
      // Fail closed on a partial scan: pets in unscanned enclosures would be left out of
      // pairing, so the plan would be built from part of the stock.
      if (scan.partial) {
        setStatus("Breeding cancelled: not every enclosure loaded during the scan, so no plan was built — nothing was bred. Try again.");
        reportWorkerDone();
        return null;
      }
      ownUserId = scan.ownUserId || scan.catalog.find(pet => pet.usr)?.usr || ownUserId;
      breedingActions.setOwnUserId(ownUserId);
      const merged = petRecord.mergeCatalogScan(pets, scan.catalog, { partial: false, now, keepUnseen: isCullPet });
      await storageSet({
        owehOwnUserId: ownUserId,
        ...(Object.keys(merged.changed).length ? { owehPets: merged.changed } : {}),
        owehDatabaseMeta: petRecord.databaseMetaFor(pets, scan.catalog, merged.stale, now)
      });
      catalogCount = scan.catalog.length;
    }
    if (!(await refreshPlanningProfiles(pets, ownUserId, cancelled))) return null;
    return { pets, ownUserId, catalogCount };
  }

  // Fetches the profile of every new/changed/incomplete pet the plan could use (the verified
  // pedigree is kept and not re-fetched). No renames here — Update database owns naming.
  async function refreshPlanningProfiles(pets, ownUserId, cancelled) {
    const petFetch = helpers.petFetch;
    const now = Date.now();
    const queue = Object.values(pets).filter(pet => pet?.owned && pet.present !== false
      && /^\d+$/.test(String(pet.id)) && !isCullPet(pet)
      && (pet.profileStale || (!petRecord.isCompletePetRecord(pet)
        && now - Number(pet.lastProfileScanAt || 0) >= PROFILE_RETRY_MS)));
    if (!queue.length) return true;
    const changed = {};
    const flush = async () => {
      const ids = Object.keys(changed);
      if (!ids.length) return;
      const batch = {};
      for (const id of ids) {
        batch[id] = changed[id];
        delete changed[id];
      }
      await storageSet({ owehPets: batch });
    };
    let cursor = 0;
    let done = 0;
    let errors = 0;
    const worker = async () => {
      while (cursor < queue.length && !cancelled()) {
        const cached = queue[cursor];
        cursor += 1;
        const read = await petFetch.readAndMerge(cached, ownUserId).catch(() => ({ ok: false }));
        if (read.ok) {
          pets[read.pet.id] = read.pet;
          changed[read.pet.id] = read.pet;
        } else {
          errors += 1;
        }
        done += 1;
        reportWorkerPhase(`profiles ${done}/${queue.length}`);
        setStatus(`Breeding plan: reading ${queue.length} new/changed profile(s) ${done}/${queue.length}${errors ? ` · ${errors} error(s)` : ""}`);
        if (Object.keys(changed).length >= PLAN_SAVE_EVERY) await flush();
        await sleep(settings.DEFAULT_REQUEST_DELAY);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PLAN_CONCURRENCY, queue.length) }, worker));
    await flush();
    return !cancelled();
  }

  // v5.5.2: read each plannable female's own Breeding tab (read-only JSONP) for the enclosures
  // that hold candidate males. The partners OviPets lists there already passed the game's
  // relatedness and cooldown checks, so the plan uses that list instead of the local pedigree
  // (which is often unverified). A failed or empty read leaves that female on the local rule.
  // v5.7.0: three females are read at a time, sharing one read budget.
  const GAME_ELIGIBLE_MAX_READS = 400;
  async function readGameEligible(pets, target, strategy, ownUserId, cancelled = () => false) {
    const petFetch = helpers.petFetch;
    if (!petFetch?.readBreedingPartners || !breedingPlan.plannableFemales) return {};
    const enclosureIds = await storageGet("owehEnclosureIds", {});
    const idFor = label => {
      const wanted = breedingPlan.normalizeEnclosureLabel(label);
      const key = Object.keys(enclosureIds || {}).find(name => breedingPlan.normalizeEnclosureLabel(name) === wanted);
      return key === undefined ? null : enclosureIds[key];
    };
    const enclosures = breedingPlan.plannableMaleEnclosures(pets, target, strategy)
      .map(idFor).filter(id => id !== null && id !== undefined && /^\d+$/.test(String(id)));
    const females = breedingPlan.plannableFemales(pets, target, strategy);
    const result = {};
    if (!enclosures.length || !females.length) return result;
    let reads = 0;
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < females.length && !cancelled()) {
        // The budget is reserved before the first await so parallel workers cannot overrun it.
        if (reads + enclosures.length > GAME_ELIGIBLE_MAX_READS) return;
        reads += enclosures.length;
        const female = females[cursor];
        cursor += 1;
        const partners = new Set();
        let failed = false;
        for (const enclosureId of enclosures) {
          try {
            (await petFetch.readBreedingPartners(female.id, enclosureId, ownUserId)).forEach(id => partners.add(String(id)));
          } catch {
            failed = true;
            break;
          }
        }
        if (!failed && partners.size) result[String(female.id)] = [...partners];
        done += 1;
        reportWorkerPhase(`partner lists ${done}/${females.length}`);
        setStatus(`Reading OviPets' own partner lists ${done}/${females.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PLAN_CONCURRENCY, females.length) }, worker));
    return result;
  }

  async function requestStart(strategy = BREEDING_STRATEGIES.PURE_LINE) {
    strategy = normalizeBreedingStrategy(strategy);
    if ((await read()).active) {
      setStatus("A confirmed breeding campaign is still running — press Stop before planning a new one");
      return;
    }
    await storageSet({ owehBreedStrategy: strategy });
    setStatus(`Claiming the shared background tab for the ${strategyLabel(strategy)} breeding campaign...`);
    const response = await requestClaimWorker("breed", OVERVIEW_URL);
    if (!response.ok) {
      if (response.reason === "busy") {
        setStatus(`Shared background tab is busy running "${response.owner}" (${response.phase || "working"}) — stop it first, then try again`);
      } else {
        setStatus(`Could not start breeding campaign${response.error ? `: ${response.error}` : ""}`);
      }
      return;
    }
    setStatus(response.alreadyRunning
      ? "Breeding campaign is already running in the shared background tab"
      : `Planning a ${strategyLabel(strategy)} breeding campaign in the shared background tab — nothing is bred until you confirm`);
  }

  async function confirmPreview() {
    if (confirming) return;
    confirming = true;
    try {
      const preview = await storageGet("owehBreedPreview", null);
      if (!preview?.queue?.length) {
        setStatus("No breeding plan to confirm — press a Plan campaign button first");
        return;
      }
      if (Date.now() - Number(preview.createdAt || 0) > PREVIEW_MAX_AGE_MS) {
        await storageSet({ owehBreedPreview: null });
        setStatus("The breeding plan is older than 15 minutes and was discarded — plan it again");
        return;
      }
      if ((await read()).active) {
        setStatus("A breeding campaign is already running — stop it before confirming another plan");
        return;
      }
      const limit = normalizePairLimit(await storageGet("owehBreedPairLimit", 0));
      const queue = limit ? preview.queue.slice(0, limit) : preview.queue;
      const now = Date.now();
      const campaign = {
        active: true,
        mode: "database-direct-v2",
        strategy: normalizeBreedingStrategy(preview.strategy),
        femaleIndex: 0,
        attempted: {},
        bredCount: 0,
        errors: 0,
        unpaired: preview.unpaired || 0,
        target: preview.target,
        species: preview.species,
        maleCount: preview.maleCount,
        shortlistSize: preview.shortlistSize,
        catalogCount: preview.catalogCount,
        pairLimit: limit || null,
        startedAt: now,
        confirmedAt: now
      };
      await storageSet({
        owehBreedQueue: queue,
        owehBreedCampaign: campaign,
        owehBreedPreview: null,
        owehTargetColors: preview.target
      });
      const response = await requestClaimWorker("breed", OVERVIEW_URL);
      if (!response.ok) {
        // Nothing was dispatched: put the preview back so the user can confirm it later.
        await storageSet({ owehBreedCampaign: { ...campaign, active: false }, owehBreedPreview: preview });
        setStatus(response.reason === "busy"
          ? `Shared background tab is busy running "${response.owner}" (${response.phase || "working"}) — stop it first, then confirm again`
          : `Could not start breeding${response.error ? `: ${response.error}` : ""} — the plan is kept, confirm again`);
        return;
      }
      setStatus(`Confirmed: breeding ${queue.length} female(s)${limit && preview.queue.length > limit ? ` (limit ${limit} of ${preview.queue.length})` : ""} in the shared background tab`);
    } finally {
      confirming = false;
    }
  }

  async function discardPreview() {
    await storageSet({ owehBreedPreview: null });
    setStatus("Breeding plan discarded — nothing was bred");
  }

  async function setPairLimit(value) {
    const limit = normalizePairLimit(value);
    await storageSet({ owehBreedPairLimit: limit });
    return limit;
  }

  async function stop() {
    const campaign = await read();
    if (campaign.active) await storageSet({ owehBreedCampaign: { ...campaign, active: false } });
    // Stop also withdraws an unconfirmed plan so a later click cannot confirm a stale one.
    await storageSet({ owehBreedPreview: null });
    const released = await requestReleaseWorker("breed");
    // The durable flag above is already cleared; a failed release must still be visible.
    if (released?.ok === false) setStatus(`Breeding: Stop could not release the shared background tab (${released.error || "no response"}) — press Stop again`);
    return released;
  }

  function stopLocal() {
    storageGet("owehBreedCampaign", { active: false }).then(campaign => {
      if (campaign.active) storageSet({ owehBreedCampaign: { ...campaign, active: false } });
    });
    setStatus("Breeding campaign stopped");
  }

  async function maybeContinueStart() {
    // The guard is deliberately acquired before the first await so overlapping refresh ticks
    // cannot consume the same persisted start request twice.
    if (!routes.isPetsOverview() || planning || continuingStart) return;
    continuingStart = true;
    try {
      if (!(await isWorkerOwner("breed"))) return;
      const request = await storageGet("owehBreedStartRequest", { active: false });
      if (!request.active) return;
      await storageSet({ owehBreedStartRequest: { ...request, active: false } });
      await startWorker(workerClient.getGeneration(), Boolean(request.resumeFromIndex), request.strategy || null);
    } finally {
      continuingStart = false;
    }
  }

  async function advance(campaign, queue) {
    campaign.femaleIndex += 1;
    if (campaign.femaleIndex >= queue.length) {
      campaign.active = false;
      await storageSet({ owehBreedCampaign: campaign });
      setStatus(`Database breeding complete — ${campaign.bredCount || 0} command-confirmed pairing(s), ${campaign.unpaired || 0} unpaired, ${campaign.errors || 0} errors`);
      reportWorkerDone();
      return false;
    }
    await storageSet({ owehBreedCampaign: campaign });
    return true;
  }

  function secondaryKeyLabel(key) {
    return ({ body2: "Body 2", scales: "Scales", extra1: "Extra 1", extra2: "Extra 2" })[key] || key || null;
  }

  function candidateList(current) {
    if (Array.isArray(current?.maleCandidates) && current.maleCandidates.length) return current.maleCandidates;
    if (!current?.maleId) return [];
    // Compatibility fallback for queue rows created before candidate lists were added. New
    // v5.3.17 campaigns always persist the full ordered male list.
    return [{
      maleId: current.maleId, maleName: current.maleName, pure: current.pure,
      maleUsageBefore: current.maleUsageBefore, maleLineageUseBefore: current.maleLineageUseBefore,
      maleSecondaryBestDistance: current.maleSecondaryBestDistance,
      maleSecondaryBestKey: current.maleSecondaryBestKey,
      maleSecondaryTotalDistance: current.maleSecondaryTotalDistance
    }];
  }

  function applyCandidate(current, candidate, index) {
    current.maleCandidateIndex = index;
    current.maleId = candidate?.maleId || null;
    current.maleName = candidate?.maleName || null;
    current.pure = candidate?.pure || null;
    current.maleUsageBefore = candidate?.maleUsageBefore || 0;
    current.maleLineageUseBefore = candidate?.maleLineageUseBefore || 0;
    current.maleSecondaryBestDistance = Number.isFinite(candidate?.maleSecondaryBestDistance)
      ? candidate.maleSecondaryBestDistance : null;
    current.maleSecondaryBestKey = candidate?.maleSecondaryBestKey || null;
    current.maleSecondaryTotalDistance = Number.isFinite(candidate?.maleSecondaryTotalDistance)
      ? candidate.maleSecondaryTotalDistance : null;
    return current;
  }

  function nextSafeCandidate(current, female, pets) {
    const candidates = candidateList(current);
    const rejected = new Set((current?.rejectedMaleIds || []).map(String));
    const start = Math.max(0, Number(current?.maleCandidateIndex || 0));
    for (let index = start; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const maleId = String(candidate?.maleId || "");
      if (!maleId || rejected.has(maleId)) continue;
      const male = pets[maleId];
      // Re-checked from the database right before dispatch: a male that left the program
      // (not owned, gone, or moved to Males discard since the plan) is never sent.
      if (!male || male.gender !== "Male" || male.onCooldown || male.owned === false || male.present === false || isCullPet(male)) continue;
      // Game-listed candidates came from this female's own Breeding tab at planning time.
      const compatibility = candidate?.gameListed === true
        ? { safe: true, reason: "game-listed", overlapIds: [] }
        : pedigree.pedigreeCompatibility(female, male);
      if (!compatibility.safe) continue;
      return { candidate, index, male, compatibility, total: candidates.length };
    }
    return null;
  }

  async function retryNextMale(campaign, queue, current, male, reason) {
    const rejected = new Set((current.rejectedMaleIds || []).map(String));
    if (male?.id) rejected.add(String(male.id));
    current.rejectedMaleIds = [...rejected];
    current.maleCandidateIndex = Math.max(0, Number(current.maleCandidateIndex || 0) + 1);
    queue[campaign.femaleIndex] = current;
    await storageSet({ owehBreedQueue: queue, owehBreedCampaign: campaign });
    const remaining = Math.max(0, candidateList(current).length - current.maleCandidateIndex);
    if (remaining > 0) {
      setStatus(`${current.name}: OviPets rejected ${male?.name || male?.id || "male"} (${reason}); trying ${remaining} alternate male candidate(s)`);
      setTimeout(() => process(), Math.max(300, settings.getDelayMs()));
      return true;
    }
    return false;
  }

  async function recordBreed(father, mother, eggId, pure, now = Date.now(), strategy = BREEDING_STRATEGIES.PURE_LINE) {
    const history = await storageGet("owehBreedHistory", []);
    history.push({
      fatherId: father.id,
      motherId: mother.id,
      eggId,
      strategy: normalizeBreedingStrategy(strategy),
      score: pure.distance,
      lockedChannels: pure.lockedChannels,
      body1ReachableChannels: pure.body1ReachableChannels,
      body1UnionExactChannels: pure.body1UnionExactChannels,
      body1NewExactChannels: pure.body1NewExactChannels,
      exactParentCopies: pure.exactParentCopies,
      reachableChannels: pure.reachableChannels,
      totalRangeWidth: pure.totalRangeWidth,
      purePossible: pure.purePossible,
      pureProbability: pure.pureProbability,
      at: now
    });
    await storageSet({ owehBreedHistory: history.slice(-1000) });
  }

  async function process() {
    if (processing) return;
    processing = true;
    try {
      const campaign = await read();
      if (!campaign.active || !(await isWorkerOwner("breed"))) return;
      if (campaign.mode !== "database-direct-v2") {
        campaign.active = false;
        await storageSet({ owehBreedCampaign: campaign });
        setStatus("Previous breeding campaign stopped after database upgrade; start a new campaign");
        reportWorkerDone();
        return;
      }
      const queue = await storageGet("owehBreedQueue", []);
      const current = queue[campaign.femaleIndex];
      if (!current) {
        campaign.active = false;
        await storageSet({ owehBreedCampaign: campaign });
        setStatus(`Database breeding complete — ${campaign.bredCount || 0} command-confirmed pairing(s)`);
        reportWorkerDone();
        return;
      }
      const candidates = candidateList(current);
      const candidateIds = candidates.map(item => String(item?.maleId || "")).filter(Boolean);
      const pets = await getPetsByIds([String(current.id), ...candidateIds]);
      const female = pets[current.id];
      const gameVouched = candidates.some(item => item?.gameListed === true);
      if (!female || female.gender !== "Female" || female.onCooldown || (female.pedigreeVerified !== true && !gameVouched)) {
        campaign.unpaired = (campaign.unpaired || 0) + 1;
        setStatus(`${current.name}: female pedigree/state is not safely breedable; skipped without sending a command`);
        await advance(campaign, queue);
        setTimeout(() => process(), Math.max(300, settings.getDelayMs()));
        return;
      }

      const selected = nextSafeCandidate(current, female, pets);
      if (!selected || !selected.candidate?.pure) {
        campaign.unpaired = (campaign.unpaired || 0) + 1;
        setStatus(`${current.name}: no pedigree-verified male candidate remains; skipped without sending a command`);
        await advance(campaign, queue);
        setTimeout(() => process(), Math.max(300, settings.getDelayMs()));
        return;
      }
      const { male, candidate, index: candidateIndex, total: candidateTotal } = selected;
      applyCandidate(current, candidate, candidateIndex);
      queue[campaign.femaleIndex] = current;
      await storageSet({ owehBreedQueue: queue });

      reportWorkerPhase(`breeding ${campaign.femaleIndex + 1}/${queue.length}`);
      const choiceText = candidateTotal > 1 ? ` · male ${candidateIndex + 1}/${candidateTotal}` : "";
      setStatus(`Direct breeding ${campaign.femaleIndex + 1}/${queue.length}: ${female.name} × ${male.name}${choiceText}`);
      const result = await gameActions.breedPairDirect(female.id, male.id, campaign.startedAt || "legacy");
      if (!(await isWorkerOwner("breed"))) return;
      const latest = await read();
      if (!latest.active) return;
      if (result.ok) {
        campaign.bredCount = (campaign.bredCount || 0) + 1;
        female.onCooldown = true;
        female.lastBredAt = Date.now();
        await recordBreed(male, female, null, current.pure, Date.now(), campaign.strategy);
        await storageSet({ owehPets: { [female.id]: female } });
        const secondaryLabel = secondaryKeyLabel(current.maleSecondaryBestKey);
        const secondaryText = Number.isFinite(current.maleSecondaryBestDistance)
          ? ` · best secondary ${secondaryLabel || "slot"} ${current.maleSecondaryBestDistance} off`
          : "";
        if (campaign.strategy === BREEDING_STRATEGIES.SAME_FF_TARGET) {
          const candidateText = Number(current.sameFfCandidateCount || 0)
            ? ` · ${current.sameFfCandidateCount} same-FF candidate(s)` : "";
          setStatus(`Command confirmed ${female.name} × ${male.name} · Same-FF target improvement${secondaryText}${candidateText}`);
        } else {
          const equivalentText = Number(current.maleBody1EquivalentPoolSize || 0) > 1
            ? ` · Body 1 equivalent pool ${current.maleBody1EquivalentPoolSize}`
            : "";
          setStatus(`Command confirmed ${female.name} × ${male.name} · Body 1 ${current.pure.body1ReachableChannels}/3 reachable, +${current.pure.body1NewExactChannels} new FF${secondaryText}${equivalentText}`);
        }
      } else {
        campaign.errors = (campaign.errors || 0) + 1;
        const reason = result.reason || "unknown";
        if (reason === "unable-to-breed-pets" || reason === "command-timeout") {
          if (await retryNextMale(campaign, queue, current, male, reason)) return;
          campaign.unpaired = (campaign.unpaired || 0) + 1;
          setStatus(`${female.name}: all pedigree-verified male candidates were rejected by OviPets`);
        } else {
          setStatus(`Breeding command rejected for ${female.name} × ${male.name}: ${reason}`);
        }
      }
      await advance(campaign, queue);
      setTimeout(() => process(), Math.max(300, settings.getDelayMs()));
    } finally {
      processing = false;
    }
  }

  return {
    api: {
      read,
      requestStart,
      startWorker,
      confirmPreview,
      discardPreview,
      setPairLimit,
      normalizePairLimit,
      stop,
      stopLocal,
      maybeContinueStart,
      process,
      recordBreed,
      isProcessing: () => processing,
      isPlanning: () => planning
    }
  };
});
