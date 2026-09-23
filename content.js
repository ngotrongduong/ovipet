(() => {
  "use strict";

  if (!globalThis.OWEH) {
    console.error("[OviPets Helper] jobs/core.js did not load before content.js — check the content_scripts order in manifest.json");
    return;
  }

  const PANEL_ID = "ovipets-hatchery-helper";
  const TOOLTIP_ID = "ovipets-hatchery-helper-tooltip";
  if (!OWEH.core?.storage) {
    console.error("[OviPets Helper] core/storage-client.js did not load before content.js — check manifest.json script order");
    return;
  }
  const {
    runtimeRequest, storageGet, storageSet, storageGetMany, getPetsByIds,
    isExtensionContextInvalidated
  } = OWEH.core.storage;
  if (!OWEH.core?.gameBridge) {
    console.error("[OviPets Helper] core/game-bridge.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { sendGameCommand, pingGameBridge } = OWEH.core.gameBridge;
  if (!OWEH.core?.workerClient) {
    console.error("[OviPets Helper] core/worker-client.js did not load before content.js — check manifest.json script order");
    return;
  }
  const workerClient = OWEH.core.workerClient;
  const {
    claimTask, releaseTask, isWorkerOwner, requestClaimWorker, requestReleaseWorker,
    reportWorkerPhase, reportWorkerDone: releaseFinishedWorker
  } = workerClient;
  if (!OWEH.core?.scheduler) {
    console.error("[OviPets Helper] core/scheduler.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { createRefreshScheduler, shouldIgnoreBridgeMutations } = OWEH.core.scheduler;
  if (!OWEH.dom?.routes) {
    console.error("[OviPets Helper] dom/routes.js did not load before content.js — check manifest.json script order");
    return;
  }
  const {
    currentPetId, currentFriendId, isFriendHatchery, isHatchery, isOwnHatchery,
    isOviPetsChatPage, isPetsOverview, classifyRoute, navigateTo, petProfilePath: buildPetProfilePath
  } = OWEH.dom.routes;
  if (!OWEH.dom?.profile) {
    console.error("[OviPets Helper] dom/profile.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { readOverviewValue, readVisibleSpecies, readPet, getProfileTurnButton } = OWEH.dom.profile;
  if (!OWEH.dom?.hatchery) {
    console.error("[OviPets Helper] dom/hatchery.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { getHatcheryEggCount, getHatcheryEggs, getHatcheryPetCards } = OWEH.dom.hatchery;
  if (!OWEH.dom?.tabs || !OWEH.dom?.overview) {
    console.error("[OviPets Helper] dom/tabs.js and dom/overview.js must load before content.js — check manifest.json script order");
    return;
  }
  const { findTab, isTabActive } = OWEH.dom.tabs;
  if (!OWEH.dom?.friends || !OWEH.dom?.chat) {
    console.error("[OviPets Helper] dom/friends.js and dom/chat.js must load before content.js — check manifest.json script order");
    return;
  }
  const { friendLinks } = OWEH.dom.friends;
  if (!OWEH.domain?.colors || !OWEH.domain?.pedigree || !OWEH.domain?.breedingScore || !OWEH.domain?.breedingPlan) {
    console.error("[OviPets Helper] domain modules did not load before content.js — check manifest.json script order");
    return;
  }
  const {
    TARGET_KEYS, STRICT_PURE_TARGET, rgb, suggestedPetName, petOffTarget, petPureMetrics
  } = OWEH.domain.colors;
  if (!OWEH.domain?.petRecord) {
    console.error("[OviPets Helper] domain/pet-record.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { petProfileNeedsRefresh, isCompletePetRecord, databaseMetaFor } = OWEH.domain.petRecord;
  const { ancestorsOverlap } = OWEH.domain.pedigree;
  const {
    DEFAULT_MALE_SHORTLIST_SIZE: BREED_MALE_SHORTLIST_SIZE, pairPureMetrics,
    comparePairPureMetrics, formatPureProbability
  } = OWEH.domain.breedingScore;
  const {
    MALES_ENCLOSURE, DEFAULT_BREEDING_STOCK_MAX_DISTANCE, NEWBORN_ENCLOSURES,
    normalizeEnclosureLabel, isBreedingProgramEnclosure, desiredProgramEnclosure, buildDatabaseBreedPlan
  } = OWEH.domain.breedingPlan;
  if (!OWEH.core?.gameActions) {
    console.error("[OviPets Helper] core/game-actions.js did not load before content.js — check manifest.json script order");
    return;
  }
  const {
    fastMovePetToEnclosure, feedPet, requestFriend, removeFriendDirect, breedPairDirect
  } = OWEH.core.gameActions;
  // A Chrome extension reload destroys the old isolated-world listeners but leaves DOM
  // nodes that the old content script inserted into a long-lived OviPets SPA page. A
  // per-injection marker lets the new script detect and replace that dead panel instead
  // of returning early and leaving every visible button inert.
  const PANEL_INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const DEFAULT_DELAY = 0;
  const DEFAULT_PAGE_LOAD_DELAY = 1500;
  const DIRECT_COMMAND_INTERVAL_MS = 100;
  const DEFAULT_REQUEST_DELAY = DIRECT_COMMAND_INTERVAL_MS;
  const RECENT_FULL_FOOD_MS = 20 * 60 * 60 * 1000;
  const PET_FEED_DELAY_MS = DIRECT_COMMAND_INTERVAL_MS;
  let delayMs = DEFAULT_DELAY;
  let pageLoadDelayMs = DEFAULT_PAGE_LOAD_DELAY;
  let friendEggsModule = null;
  let friendSweepModule = null;
  let ownEggsModule = null;
  let petIndexModule = null;
  let hatchlingModule = null;
  let breedingModule = null;
  let dashboardModule = null;
  let panelModule = null;
  let ownUserId = null;
  let currentTabId = null;
  let taskHeartbeatTimer = null;
  let lastDiagnosticStatusText = "";
  let lastStatusText = "";

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  if (!OWEH.services?.diagnostics || !OWEH.services?.overviewCatalog || !OWEH.services?.petEdit
    || !OWEH.services?.friendDirectory || !OWEH.services?.retention) {
    console.error("[OviPets Helper] services/*.js did not load before content.js — check manifest.json script order");
    return;
  }
  const writeClipboard = text => navigator.clipboard.writeText(text);
  const {
    diagnosticLog, exportDiagnosticLog, clearDiagnosticLog, getDiagnosticSummary
  } = OWEH.services.diagnostics.createDiagnostics({ runtimeRequest, isExtensionContextInvalidated, setStatus });
  const {
    waitForOverviewShell, waitForStableValue, collectAllOverviewPets
  } = OWEH.services.overviewCatalog.createOverviewCatalog({
    storageGet, storageSet, runtimeRequest, sleep, getPageLoadDelayMs: () => pageLoadDelayMs,
    overviewDom: OWEH.dom.overview, isTabActive, normalizeEnclosureLabel
  });
  const {
    openTab, renamePet, applySuggestedName, saveCurrentPet, waitForPetGender, movePetToEnclosure
  } = OWEH.services.petEdit.createPetEdit({
    sleep, setStatus, storageGet, storageSet, getPageLoadDelayMs: () => pageLoadDelayMs,
    sendGameCommand, fastMovePetToEnclosure, currentPetId, findTab, isTabActive, readOverviewValue, readPet,
    suggestedPetName, normalizeEnclosureLabel, NEWBORN_ENCLOSURES
  });
  const {
    scanFriends, copyBlacklistCsv, performNinjaChatScan
  } = OWEH.services.friendDirectory.createFriendDirectory({
    storageGet, storageSet, sleep, setStatus, getPageLoadDelayMs: () => pageLoadDelayMs,
    getOwnUserId: () => ownUserId, getBlacklist: () => friendBlacklist(), writeClipboard,
    friendLinks, chatDom: OWEH.dom.chat
  });
  const { updateRetentionRanking, copyRetentionReviewCsv } = OWEH.services.retention.createRetention({
    storageGet, storageSet, setStatus, writeClipboard, petPureMetrics, STRICT_PURE_TARGET, isBreedingProgramEnclosure
  });

  function hatchMaleMetrics(pet, target) {
    const targeted = petPureMetrics(pet, target);
    const body = pet?.colors?.body1 ? rgb(pet.colors.body1) : [];
    const extremeExact = body.filter(value => value === 0 || value === 255).length;
    const extremeDistance = body.reduce((sum, value) => sum + Math.min(value, 255 - value), 0);
    return {
      targetExact: targeted.exactChannels,
      targetUsed: targeted.usedChannels,
      targetDistance: targeted.distance,
      extremeExact,
      extremeDistance
    };
  }

  async function friendBlacklist() {
    return friendSweepModule?.getBlacklist
      ? friendSweepModule.getBlacklist()
      : storageGet("owehFriendBlacklist", {});
  }

  async function readSweep() {
    return friendSweepModule?.read
      ? friendSweepModule.read()
      : storageGet("owehSweep", { active: false, index: 0, maxFriends: 10 });
  }

  function ownedByThisTab(state) {
    if (state?.ownerTabId != null && currentTabId != null) return Number(state.ownerTabId) === Number(currentTabId);
    return !state?.ownerInstance || state.ownerInstance === PANEL_INSTANCE;
  }

  // "Stop All", next to the activity card that already aggregates every running job.
  // Additive, not a replacement for the scoped per-feature Stop buttons: releases
  // whichever single feature currently holds the shared worker tab (no owner passed, so
  // background.js releases whatever is actually claimed) plus the two lanes that still
  // run in this same tab rather than the shared worker (egg-turning, and Ninja Please's
  // send lane).
  // The unconditional reset: calls every feature's own Stop function directly (each one
  // clears its own storage flag unconditionally, not just when a live shared-worker claim
  // exists — see the comment on stopFriendSweep) rather than only asking background.js to
  // release whatever it currently thinks is claimed. The one-button jobs under jobs/ keep no
  // storage flag at all, so the final generic release below is what stops them. Sequential,
  // not Promise.all, so no two stops ever race on the same storage key.
  async function stopAllAutomation() {
    diagnosticLog("warning", "control", "automation.stop-all", {});
    await stopFriendSweep();
    await stopBreedCampaign();
    await petIndexModule?.stop();
    await stopHatchlingProcessing();
    await ownEggsModule?.stop("Egg turn/hatch stopped");
    await runtimeRequest({ type: "eggBatchStop" });
    await requestReleaseWorker();
    setStatus("Stop All: cleared every automation flag and released the shared background tab");
  }

  async function sendTaskHeartbeat() {
    const state = await storageGetMany({ owehEggRun: { active: false } });
    const ids = [];
    if (state.owehEggRun.active && ownedByThisTab(state.owehEggRun)) ids.push("egg-run");
    if (ids.length) await runtimeRequest({ type: "taskHeartbeat", ids });
    await workerClient.heartbeatSharedWorker();
  }

  function requireFriendSweep() {
    if (!friendSweepModule) throw new Error("features/friend-sweep.js did not initialize");
    return friendSweepModule;
  }

  const requestFriendSweepWorker = () => requireFriendSweep().requestStart();
  const startFriendSweepWorker = (generation, extra = {}) => requireFriendSweep().startWorker(generation, extra);
  const stopFriendSweepLocal = () => requireFriendSweep().stopLocal();
  const stopFriendSweep = () => requireFriendSweep().stop();
  const goToNextFriend = () => requireFriendSweep().goNext();
  const requestGoToNextFriend = () => requireFriendSweep().requestNext();
  const finishFriendSweepStep = options => requireFriendSweep().finishStep(options);
  const maybeAutoStartSweep = () => requireFriendSweep().maybeAutoStart();

  // Every job and every extension-opened tab must call this before reading data or sending
  // anything: the page has finished loading, <main> has content, the game's dispatcher is
  // reachable, the content has stopped changing, and at least pageLoadDelayMs has passed.
  // Returns false (never throws) if the game isn't ready within the timeout.
  async function waitForGameReady(timeout = 30000, options = {}) {
    const end = Date.now() + timeout;
    const requestedDelay = Number(options?.delayMs);
    const readyDelayMs = Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : pageLoadDelayMs;
    while (Date.now() < end) {
      const main = document.querySelector("main");
      if (document.readyState === "complete" && main && main.children.length && (await pingGameBridge()).ok) {
        await sleep(readyDelayMs);
        await waitForStableValue(() => document.querySelector("main")?.getElementsByTagName("*").length,
          Math.max(2000, Math.max(readyDelayMs, 250) * 3));
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  function setStatus(text) {
    const el = document.querySelector("#oweh-status");
    if (el && el.textContent !== text) el.textContent = text;
    const value = String(text || "");
    if (value) lastStatusText = value;
    const diagnosticValue = value
      .replace(/\b0\s+(?:failed|timeouts?|errors?|aborted)\b/ig, "")
      .replace(/\b0\s+timed\s+out\b/ig, "");
    if (value && value !== lastDiagnosticStatusText && /(failed|stopped|timeout|timed out|interrupted|could not|error|busy|lost|aborted)/i.test(diagnosticValue)) {
      lastDiagnosticStatusText = value;
      diagnosticLog("warning", "status", "status.alert", { text: value });
    }
  }

  // The shared worker tab closes as soon as its job reports done, taking its final status line
  // with it. Publish that line through the cross-tab notice first so the tab where the user
  // pressed the button can show why the job ended (e.g. "no breedable females").
  function reportWorkerDone() {
    if (workerClient.getOwner() != null && lastStatusText) {
      void storageSet({ owehSweepNotice: { text: lastStatusText, at: Date.now() } });
    }
    releaseFinishedWorker();
  }

  function setRunning(value) {
    panelModule?.setEggRunning(Boolean(value));
  }

  const STRAIGHT_JOB_LABELS = {
    catalog: "Update catalog", sort: "Sort pets", feed: "Feed pets", ninja: "Scan Ninja", requests: "Send requests"
  };

  function requireDashboard() {
    if (!dashboardModule) throw new Error("ui/dashboard.js did not initialize");
    return dashboardModule;
  }

  const refreshDatabaseHealth = force => requireDashboard().refreshHealth(force);
  const updateActivityDashboard = () => requireDashboard().update();
  const scheduleActivityDashboard = delay => requireDashboard().schedule(delay);

  // Confirmed selector (docs/dom-audit-2026-09-17.md #4).
  const BREEDING_CANDIDATE_SELECTOR = "section#breeding a[onclick*=\"ui_action_cmdExec('pet_breed'\"]";

  function breedingCandidates(parentId) {
    return [...document.querySelectorAll(BREEDING_CANDIDATE_SELECTOR)].map(anchor => {
      const onclick = anchor.getAttribute("onclick") || "";
      const mother = onclick.match(/MotherID=(\d+)/)?.[1];
      const father = onclick.match(/FatherID=(\d+)/)?.[1];
      const otherId = mother === parentId ? father : mother;
      return otherId ? { anchor, otherId } : null;
    }).filter(Boolean);
  }

  function petProfilePath(petId) {
    return buildPetProfilePath(petId, ownUserId);
  }

  function targetValues() {
    return { ...STRICT_PURE_TARGET };
  }

  async function rankPartners() {
    const parent = readPet();
    const target = targetValues();
    const pets = await storageGet("owehPets", {});
    if (!parent) return setStatus("Open the parent profile with its Colors table visible");
    if (!Object.values(target).some(Boolean)) return setStatus("Enter at least one target color");
    const ranked = breedingCandidates(parent.id).map(({ anchor, otherId }) => {
      const partner = pets[otherId];
      return {
        anchor,
        partner,
        otherId,
        pure: pairPureMetrics(parent, partner, target),
        offTarget: petOffTarget(partner, target),
        inbred: ancestorsOverlap(parent, partner)
      };
    }).sort(comparePairPureMetrics);
    const best = ranked.find(x => Number.isFinite(x.pure.distance) && !x.inbred);
    document.querySelectorAll(".oweh-recommended, .oweh-warning").forEach(e => e.remove());
    ranked.forEach((item, index) => {
      item.anchor.style.outline = item.inbred
        ? "3px solid #d9534f"
        : (index < 3 && Number.isFinite(item.pure.distance) ? "3px solid #ffd166" : "");
      if (item.inbred) {
        const warning = document.createElement("span");
        warning.className = "oweh-warning";
        warning.textContent = "Shares a visible ancestor — likely won't breed";
        item.anchor.appendChild(warning);
        return;
      }
      if (item === best) {
        const offText = Number.isFinite(item.offTarget) ? ` · ${item.offTarget} off target` : "";
        const badge = document.createElement("span");
        badge.className = "oweh-recommended";
        const chance = item.pure.purePossible
          ? formatPureProbability(item.pure.pureProbability)
          : `${item.pure.reachableChannels}/${item.pure.usedChannels} target channels reachable`;
        badge.textContent = `Best pair · Body 1 ${item.pure.body1ReachableChannels}/3 reachable, +${item.pure.body1NewExactChannels} new FF · ${chance} · ${item.pure.lockedChannels} locked${offText}`;
        item.anchor.appendChild(badge);
      }
    });
    setStatus(best ? `Best indexed partner: ${best.partner?.name || "unknown"}` : "No matching partner has been indexed yet");
  }

  // --- Full pet indexing, color-code naming, and strict female-first breeding ----------

  function requireHatchlings() {
    if (!hatchlingModule) throw new Error("features/hatchlings.js did not initialize");
    return hatchlingModule;
  }

  const readHatchlingRun = () => hatchlingModule?.read
    ? hatchlingModule.read()
    : storageGet("owehHatchlingRun", { active: false, phase: "scan", index: 0 });
  const startHatchlingProcessing = (generation, force = true) => requireHatchlings().startWorker(generation, force);
  const requestStartHatchlingProcessing = () => requireHatchlings().requestStart();
  const stopHatchlingProcessing = () => requireHatchlings().stop();
  const stopHatchlingProcessingLocal = () => requireHatchlings().stopLocal();
  const processHatchlingRun = () => requireHatchlings().process();

  function requireBreeding() {
    if (!breedingModule) throw new Error("features/breeding.js did not initialize");
    return breedingModule;
  }

  const readBreedCampaign = () => breedingModule?.read
    ? breedingModule.read()
    : storageGet("owehBreedCampaign", { active: false, femaleIndex: 0, attempted: {}, bredCount: 0 });
  const startBreedCampaign = (generation, resumeFromIndex = false) => requireBreeding().startWorker(generation, resumeFromIndex);
  const requestStartBreedCampaign = () => requireBreeding().requestStart(OWEH.domain.breedingPlan.BREEDING_STRATEGIES.PURE_LINE);
  const requestStartBreedTargetCampaign = () => requireBreeding().requestStart(OWEH.domain.breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET);
  const stopBreedCampaign = () => requireBreeding().stop();
  const confirmBreedPreview = () => requireBreeding().confirmPreview();
  const discardBreedPreview = () => requireBreeding().discardPreview();
  const setBreedPairLimit = value => requireBreeding().setPairLimit(value);
  const stopBreedCampaignLocal = () => requireBreeding().stopLocal();
  const maybeContinueBreedStart = () => requireBreeding().maybeContinueStart();
  const processBreedCampaign = () => requireBreeding().process();

  function isPanelContextVisible(jobCount) {
    return Boolean(getHatcheryEggs().length || getProfileTurnButton() || currentPetId() || currentFriendId()
      || document.querySelector(BREEDING_CANDIDATE_SELECTOR) || friendLinks().length || isHatchery()
      || isOviPetsChatPage() || isPetsOverview() || jobCount > 0);
  }

  function refresh() {
    const route = classifyRoute();
    panelModule?.sync(dashboardModule?.getJobCount() || 0);
    OWEH.runHook("onRefresh");
    // These four functions already had equivalent route guards internally. Checking the
    // route once here avoids unnecessary storage/selector work on unrelated pages without
    // changing any active automation state machine.
    if (route.hatchery || route.petProfile) ownEggsModule?.process();
    if (route.hatchery) ownEggsModule?.maybeAutoStart();
    if (route.friendHatchery) maybeAutoStartSweep();
    petIndexModule?.process();
    if (route.petsOverview) maybeContinueBreedStart();
    processBreedCampaign();
    processHatchlingRun();
    panelModule?.updatePetNameSuggestion();
    panelModule?.updateBlacklistCount();
    scheduleActivityDashboard();
  }

  const refreshScheduler = createRefreshScheduler(refresh);
  const scheduleRefresh = (delay, reason) => refreshScheduler.schedule(delay, reason);

  // v5 shared worker tab dispatch: background.js's claimWorker/releaseWorker send these
  // two generic message types to whichever tab it just attached/is releasing as the
  // shared worker, naming the feature via `owner`. Each feature registers its own
  // start/stop pair here instead of background.js needing to know each feature's
  // function names directly (the one-button jobs under jobs/ register their own handlers via
  // OWEH.collect; the features still living in this file are listed here).
  const workerHandlers = {
    sweep: { start: startFriendSweepWorker, stop: stopFriendSweepLocal },
    breed: { start: generation => startBreedCampaign(generation, false), stop: stopBreedCampaignLocal },
    hatchlings: { start: generation => startHatchlingProcessing(generation, true), stop: stopHatchlingProcessingLocal }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "startSharedWorker") {
      const handler = ({ ...workerHandlers, ...OWEH.collect("workerHandlers") })[message.owner];
      if (!handler?.start) return;
      workerClient.handleStartMessage(message, handler);
      return;
    }
    if (message?.type === "stopSharedWorker") {
      const handler = ({ ...workerHandlers, ...OWEH.collect("workerHandlers") })[message.owner];
      workerClient.handleStopMessage(message, handler);
      return;
    }
    if (message?.type === "recoverSharedWorker") {
      workerClient.resync(message.owner, message.generation);
      diagnosticLog("warning", "worker", "worker.recovery-received", { owner: message.owner, generation: message.generation, tabId: currentTabId });
      if (message.owner === "sweep") {
        Promise.resolve(requireFriendSweep().recoverWorker?.()).catch(error =>
          diagnosticLog("error", "friend-sweep", "sweep.recovery-failed", { message: error?.message || String(error) }));
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (message?.type === "eggBatchProgress") {
      OWEH.get("friend-eggs")?.api?.onBatchProgress?.(message);
      OWEH.get("feature-own-eggs")?.api?.onBatchProgress?.(message);
      return;
    }
    if (message?.type === "goToNextFriendFromBackground") {
      goToNextFriend();
    }
  });

  const activityStorageKeys = new Set([
    "owehEggRun", "owehSweep", "owehWorker",
    "owehBreedCampaign", "owehBreedQueue", "owehPetIndex", "owehPetScanQueue",
    "owehHatchlingRun", "owehHatchlingQueue",
    "owehFriendRemoval", "owehDatabaseMeta", "owehSweepNotice"
  ]);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.keys(changes).some(key => activityStorageKeys.has(key))) {
      scheduleActivityDashboard(0);
    }
  });

  // Modules under jobs/ (registered by their own files, loaded before this one). Browser/domain
  // adapters are injected explicitly; only orchestration that still lives in content.js is grouped
  // behind narrow feature services. This keeps jobs from depending on one giant legacy object.
  const modules = OWEH.boot({
    storageGet, storageSet, storageGetMany, getPetsByIds, sleep, setStatus, runtimeRequest, sendGameCommand, diagnosticLog,
    waitForGameReady, waitForStableValue, getPageLoadDelayMs: () => pageLoadDelayMs,
    requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone, isWorkerOwner, workerClient,
    routes: OWEH.dom.routes,
    profileDom: OWEH.dom.profile,
    hatcheryDom: OWEH.dom.hatchery,
    domain: {
      colors: OWEH.domain.colors,
      petRecord: OWEH.domain.petRecord,
      pedigree: OWEH.domain.pedigree,
      breedingScore: OWEH.domain.breedingScore,
      breedingPlan: OWEH.domain.breedingPlan
    },
    gameActions: OWEH.core.gameActions,
    settings: {
      getDelayMs: () => delayMs,
      getPageLoadDelayMs: () => pageLoadDelayMs,
      RECENT_FULL_FOOD_MS, PET_FEED_DELAY_MS, DEFAULT_REQUEST_DELAY
    },
    catalogService: {
      waitForOverviewShell, collectAllOverviewPets, updateRetentionRanking,
      setOwnUserId: id => { if (id) ownUserId = id; },
      getOwnUserId: () => ownUserId
    },
    profileIndexService: {
      stopPetIndexCampaign: () => petIndexModule?.stop(),
      stopPetIndexCampaignLocal: () => petIndexModule?.stopLocal()
    },
    petIndexActions: { openTab, renamePet, updateRetentionRanking },
    ninjaService: { performNinjaChatScan },
    sweepService: { readSweep, finishFriendSweepStep, stopFriendSweep },
    friendDirectory: {
      hasVisibleFriends: () => friendLinks().length > 0,
      scanFriends,
      getOwnUserId: () => ownUserId
    },
    friendSweepActions: {
      setRunning,
      relayNext: () => runtimeRequest({ type: "relaySweepSkip" })
    },
    hatchlingActions: {
      readOwnEggRun: () => ownEggsModule?.read() || storageGet("owehEggRun", { active: false }),
      readSweep: () => friendSweepModule?.read() || storageGet("owehSweep", { active: false }),
      readBreedCampaign,
      ownedByThisTab,
      getOwnUserId: () => ownUserId,
      setOwnUserId: id => { if (id) ownUserId = id; },
      openTab, waitForPetGender, readPet, renamePet, movePetToEnclosure, updateRetentionRanking,
      rankMale: hatchMaleMetrics
    },
    breedingActions: {
      readHatchlingRun: () => hatchlingModule?.read() || storageGet("owehHatchlingRun", { active: false }),
      collectAllOverviewPets,
      getOwnUserId: () => ownUserId,
      setOwnUserId: id => { if (id) ownUserId = id; }
    },
    uiDashboardActions: { panelId: PANEL_ID, isPanelVisible: jobCount => panelModule?.isVisible(jobCount) ?? isPanelContextVisible(jobCount) },
    uiPanelActions: {
      panelId: PANEL_ID, tooltipId: TOOLTIP_ID, instanceId: PANEL_INSTANCE,
      stopAllAutomation, saveCurrentPet, refreshDatabaseHealth, rankPartners,
      startOwnEggs: () => ownEggsModule?.start(),
      stopOwnEggs: () => ownEggsModule?.stop("Egg turn/hatch stopped"),
      scanFriends, requestFriendSweepWorker, requestGoToNextFriend, stopFriendSweep, copyBlacklistCsv,
      applySuggestedName, requestStartBreedCampaign, requestStartBreedTargetCampaign, stopBreedCampaign, copyRetentionReviewCsv,
      confirmBreedPreview, discardBreedPreview, setBreedPairLimit,
      requestStartHatchlingProcessing, stopHatchlingProcessing,
      exportSpeciesInspector: () => OWEH.get("species-inspector")?.api?.exportData?.(),
      exportSpeciesDatabase: () => OWEH.get("species-inspector")?.api?.exportDatabase?.(),
      importSpeciesDatabase: payload => OWEH.get("species-inspector")?.api?.importDatabase?.(payload),
      clearSpeciesInspector: () => OWEH.get("species-inspector")?.api?.clearData?.(),
      getSpeciesInspectorSummary: () => OWEH.get("species-inspector")?.api?.getSummary?.() || Promise.resolve({ questions: 0, attempts: 0, correct: 0, wrong: 0, network: 0 }),
      exportDiagnosticLog, clearDiagnosticLog, getDiagnosticSummary,
      getPetNameSuggestion: () => {
        const pet = currentPetId() ? readPet() : null;
        return pet ? suggestedPetName(pet) : null;
      },
      friendBlacklist, isContextVisible: isPanelContextVisible,
      targetColors: STRICT_PURE_TARGET, defaultDelayMs: DEFAULT_DELAY,
      defaultPageLoadDelayMs: DEFAULT_PAGE_LOAD_DELAY,
      defaultBreedingStockMaxDistance: DEFAULT_BREEDING_STOCK_MAX_DISTANCE,
      setDelayMs: value => { delayMs = value; },
      setPageLoadDelayMs: value => { pageLoadDelayMs = value; }
    },
    pageActions: { currentHash: () => location.hash, reloadPage: () => location.reload() },
    ownEggsService: {
      ownerInstance: PANEL_INSTANCE,
      getCurrentTabId: () => currentTabId,
      ownedByThisTab,
      setRunning
    },
    claimTask, releaseTask
  });
  // If the species module failed to start, egg turning must still work — fall back to inert
  // stubs (the module's own error is already logged by OWEH.boot).
  friendEggsModule = modules["friend-eggs"]?.api || null;
  friendSweepModule = modules["feature-friend-sweep"]?.api || null;
  ownEggsModule = modules["feature-own-eggs"]?.api || null;
  petIndexModule = modules["feature-pet-index"]?.api || null;
  hatchlingModule = modules["feature-hatchlings"]?.api || null;
  breedingModule = modules["feature-breeding"]?.api || null;
  dashboardModule = modules["ui-dashboard"]?.api || null;
  panelModule = modules["ui-panel"]?.api || null;
  const species = modules["species-answer"]?.api || { updateStats: async () => {} };

  storageGet("owehOwnUserId", null).then(value => {
    if (value) ownUserId = value;
  });

  runtimeRequest({ type: "stateGetTabIdentity" }).then(async result => {
    if (result.ok) currentTabId = result.tabId;
    // Resync currentWorkerOwner/currentWorkerGeneration after a reload of the worker tab
    // itself (extension update, manual refresh, crash-restart). Those are plain in-memory
    // variables that reset to null on every script reload, which would otherwise leave
    // isWorkerOwner() permanently false here even though background.js's lease still
    // correctly lists this exact tab as the current owner — silently stalling whatever
    // feature was mid-run, the same failure shape this shared-worker redesign exists to
    // fix. Only resync (never re-invoke a feature's .start()) — the feature's own
    // progress record (owehSweep/owehBreedCampaign/etc.) already reflects where it
    // was, and the passive refresh()-driven functions pick it back up once ownership
    // checks pass again.
    const status = await runtimeRequest({ type: "getWorkerStatus" });
    if (status.ok && status.active && status.worker && Number(status.worker.tabId) === Number(currentTabId)) {
      // No start message reached THIS script instance, so a reload killed the job. One-button
      // jobs have no progress record to resume from; releasing the lease is the only way it
      // stops reading "busy" (heartbeats would keep renewing it). "starting" is excluded: the
      // fresh tab's start message may simply not have arrived yet.
      const orphanedJob = workerClient.getOwner() == null && Boolean(STRAIGHT_JOB_LABELS[status.worker.owner])
        && status.worker.phase !== "starting";
      workerClient.resync(status.worker.owner, status.worker.generation);
      if (orphanedJob) {
        diagnosticLog("error", "worker", "worker.orphaned-after-reload", { owner: status.worker.owner, generation: status.worker.generation, phase: status.worker.phase, tabId: currentTabId });
        releaseFinishedWorker();
        setStatus(`"${STRAIGHT_JOB_LABELS[status.worker.owner]}" was interrupted by a page reload and released the shared background tab — press its button again`);
      }
    }
    refresh();
  });
  taskHeartbeatTimer = setInterval(() => {
    if (isExtensionContextInvalidated?.()) {
      clearInterval(taskHeartbeatTimer);
      taskHeartbeatTimer = null;
      return;
    }
    sendTaskHeartbeat().catch(error => diagnosticLog("error", "runtime", "heartbeat.failed", { message: error?.message || String(error) }));
  }, 15000);
  window.addEventListener("error", event => {
    diagnosticLog("error", "runtime", "runtime.window-error", {
      message: event.message || event.error?.message || "window error",
      filename: event.filename || "", lineno: event.lineno || 0, colno: event.colno || 0, stack: event.error?.stack || ""
    });
  });
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    diagnosticLog("error", "runtime", "runtime.unhandled-rejection", { message: reason?.message || String(reason || "unknown"), stack: reason?.stack || "" });
  });
  window.addEventListener("pagehide", () => {
    clearInterval(taskHeartbeatTimer);
    refreshScheduler.cancel();
    dashboardModule?.cancel();
  }, { once: true });

  panelModule?.ensure();
  species.updateStats({});
  refresh();
  new MutationObserver(records => {
    if (shouldIgnoreBridgeMutations(records)) return;
    scheduleRefresh(undefined, "dom");
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => scheduleRefresh(0, "navigation"));
})();
