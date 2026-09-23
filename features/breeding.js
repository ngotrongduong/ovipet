"use strict";

// Database-first breeding campaign state machine. Planning scans the cached/visible catalog,
// requests profile indexing only for stale/missing records, then executes the deterministic
// female-first plan through direct game-dispatch commands. UI/catalog collection stays behind
// the narrow breedingActions adapter; planner math remains in domain/.
OWEH.register("feature-breeding", helpers => {
  const {
    storageGet, storageSet, getPetsByIds, setStatus,
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

  async function read() {
    return storageGet("owehBreedCampaign", { active: false, femaleIndex: 0, attempted: {}, bredCount: 0 });
  }

  function strategyLabel(strategy) {
    return strategy === BREEDING_STRATEGIES.SAME_FF_TARGET ? "Same-FF target improvement" : "Pure-line";
  }

  async function startWorker(generation, resumeFromIndex = false, strategyOverride = null) {
    if (planning) return;
    const strategy = normalizeBreedingStrategy(strategyOverride
      || await storageGet("owehBreedStrategy", BREEDING_STRATEGIES.PURE_LINE));
    if (!routes.isPetsOverview()) {
      await storageSet({
        owehBreedStrategy: strategy,
        owehBreedStartRequest: { active: true, strategy, requestedAt: Date.now() }
      });
      setStatus(`Opening Overview to build a full-enclosure ${strategyLabel(strategy)} breeding snapshot...`);
      routes.navigateTo("?src=pets&sub=overview");
      return;
    }
    planning = true;
    try {
      const target = { ...colors.STRICT_PURE_TARGET };
      const [indexState, hatchlingRun] = await Promise.all([
        storageGet("owehPetIndex", { active: false }), breedingActions.readHatchlingRun()
      ]);
      if (indexState.active) {
        setStatus("Wait for the full pet index to finish first");
        reportWorkerDone();
        return;
      }
      if (hatchlingRun.active) {
        setStatus("Stop Hatchery processing before starting the breeding campaign");
        reportWorkerDone();
        return;
      }

      const catalog = resumeFromIndex
        ? await storageGet("owehBreedCatalog", [])
        : await breedingActions.collectAllOverviewPets();
      if (!catalog.length) {
        setStatus("No pet cards found while scanning all enclosures");
        reportWorkerDone();
        return;
      }

      const nextOwnUserId = catalog.find(pet => pet.usr)?.usr || breedingActions.getOwnUserId();
      breedingActions.setOwnUserId(nextOwnUserId);
      const pets = await storageGet("owehPets", {});
      const visibleIds = new Set(catalog.map(item => item.id));
      const missing = [];
      const now = Date.now();
      for (const item of catalog) {
        const cached = pets[item.id];
        if (petRecord.petProfileNeedsRefresh(cached, item, false)) missing.push(item);
        pets[item.id] = {
          ...(cached || {}), ...item, owned: true, present: true,
          catalogModified: item.modified || cached?.catalogModified || null,
          lastSeenAt: now
        };
      }
      for (const pet of Object.values(pets)) {
        if (pet?.owned && pet.id && !visibleIds.has(pet.id)) pet.present = false;
      }
      await storageSet({
        owehOwnUserId: nextOwnUserId,
        owehPets: pets,
        owehBreedCatalog: catalog,
        owehDatabaseMeta: petRecord.databaseMetaFor(pets, catalog, missing.length, now)
      });

      if (missing.length) {
        await storageSet({
          owehPetScanQueue: missing,
          owehPetIndex: {
            active: true, breedPlanning: true, breedStrategy: strategy, index: 0, autoRename: true,
            returnHash: "#!/?src=pets&sub=overview", renamed: 0, indexed: 0
          }
        });
        reportWorkerPhase(`indexing 0/${missing.length}`);
        setStatus(`Breeding snapshot: ${catalog.length} pets; collecting metadata for only ${missing.length} new/changed pet(s)`);
        routes.navigateTo(routes.petProfilePath(missing[0].id, nextOwnUserId));
        return;
      }

      const history = await storageGet("owehBreedHistory", []);
      const plan = breedingPlan.buildDatabaseBreedPlan(pets, target, history, {
        now,
        strategy,
        shortlistSize: breedingScore.DEFAULT_MALE_SHORTLIST_SIZE
      });
      if (!plan.femaleCount) {
        setStatus("No blue-heart-free indexed females found across the enclosure snapshot");
        reportWorkerDone();
        return;
      }
      const campaign = {
        active: true,
        mode: "database-direct-v2",
        strategy: plan.strategy || strategy,
        femaleIndex: 0,
        attempted: {},
        bredCount: 0,
        errors: 0,
        unpaired: plan.unpaired,
        target,
        species: plan.focusSpecies,
        maleCount: plan.maleCount,
        shortlistSize: plan.shortlistSize,
        catalogCount: catalog.length,
        startedAt: now
      };
      await storageSet({
        owehBreedQueue: plan.queue,
        owehBreedCampaign: campaign,
        owehBreedStrategy: campaign.strategy,
        owehBreedStartRequest: { active: false, strategy: campaign.strategy },
        owehTargetColors: target
      });
      reportWorkerPhase(`breeding 0/${plan.femaleCount}`);
      setStatus(`${strategyLabel(campaign.strategy)} campaign ready: ${plan.femaleCount} breedable female(s), ${plan.maleCount} cached male(s), ${plan.unpaired} without a safe pair`);
      process();
    } finally {
      planning = false;
    }
  }

  async function requestStart(strategy = BREEDING_STRATEGIES.PURE_LINE) {
    strategy = normalizeBreedingStrategy(strategy);
    await storageSet({ owehBreedStrategy: strategy });
    setStatus(`Claiming the shared background tab for the ${strategyLabel(strategy)} breeding campaign...`);
    const response = await requestClaimWorker("breed", "https://ovipets.com/#!/?src=pets&sub=overview");
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
      : `${strategyLabel(strategy)} breeding campaign started in the shared background tab`);
  }

  async function stop() {
    const campaign = await read();
    if (campaign.active) await storageSet({ owehBreedCampaign: { ...campaign, active: false } });
    await requestReleaseWorker("breed");
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
      if (!male || male.gender !== "Male" || male.onCooldown) continue;
      const compatibility = pedigree.pedigreeCompatibility(female, male);
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
      if (!female || female.gender !== "Female" || female.onCooldown || female.pedigreeVerified !== true) {
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
