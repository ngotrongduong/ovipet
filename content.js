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
    isOviPetsChatPage, isPetsOverview, classifyRoute
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
    STRICT_PURE_TARGET, rgb, suggestedPetName, petOffTarget, petPureMetrics
  } = OWEH.domain.colors;
  if (!OWEH.domain?.petRecord) {
    console.error("[OviPets Helper] domain/pet-record.js did not load before content.js — check manifest.json script order");
    return;
  }
  const { petProfileNeedsRefresh, isCompletePetRecord, databaseMetaFor } = OWEH.domain.petRecord;
  const { ancestorsOverlap } = OWEH.domain.pedigree;
  const { pairPureMetrics, comparePairPureMetrics, formatPureProbability } = OWEH.domain.breedingScore;
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

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  if (!OWEH.services?.status || !OWEH.services?.diagnostics || !OWEH.services?.overviewCatalog || !OWEH.services?.petEdit
    || !OWEH.services?.friendDirectory || !OWEH.services?.retention || !OWEH.services?.partnerRanking
    || !OWEH.services?.workerControl) {
    console.error("[OviPets Helper] services/*.js did not load before content.js — check manifest.json script order");
    return;
  }
  const writeClipboard = text => navigator.clipboard.writeText(text);
  // setStatus logs alerts through diagnosticLog, which is created just below (and itself reports
  // through setStatus), so the status service reaches it lazily.
  const { setStatus, reportWorkerDone } = OWEH.services.status.createStatus({
    diagnosticLog: (...args) => diagnosticLog(...args), storageSet, workerClient, releaseFinishedWorker
  });
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

  const { rankPartners, hasBreedingCandidates, hatchMaleMetrics } = OWEH.services.partnerRanking.createPartnerRanking({
    storageGet, setStatus, readPet, rgb, petPureMetrics, petOffTarget, pairPureMetrics,
    comparePairPureMetrics, formatPureProbability, ancestorsOverlap, STRICT_PURE_TARGET
  });

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

  function setRunning(value) {
    panelModule?.setEggRunning(Boolean(value));
  }

  function requireDashboard() {
    if (!dashboardModule) throw new Error("ui/dashboard.js did not initialize");
    return dashboardModule;
  }

  const refreshDatabaseHealth = force => requireDashboard().refreshHealth(force);
  const updateActivityDashboard = () => requireDashboard().update();
  const scheduleActivityDashboard = delay => requireDashboard().schedule(delay);

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
      || hasBreedingCandidates() || friendLinks().length || isHatchery()
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

  const {
    ownedByThisTab, stopAllAutomation, startHeartbeat, handleRuntimeMessage, recoverAfterReload
  } = OWEH.services.workerControl.createWorkerControl({
    runtimeRequest, storageGetMany, workerClient, releaseFinishedWorker, requestReleaseWorker,
    diagnosticLog, setStatus, instanceId: PANEL_INSTANCE, getCurrentTabId: () => currentTabId,
    stops: {
      stopFriendSweep, stopBreedCampaign, stopHatchlings: stopHatchlingProcessing,
      stopPetIndex: () => petIndexModule?.stop(),
      stopOwnEggs: () => ownEggsModule?.stop("Egg turn/hatch stopped")
    },
    localWorkerHandlers: {
      sweep: { start: startFriendSweepWorker, stop: stopFriendSweepLocal },
      breed: { start: generation => startBreedCampaign(generation, false), stop: stopBreedCampaignLocal },
      hatchlings: { start: generation => startHatchlingProcessing(generation, true), stop: stopHatchlingProcessingLocal }
    },
    collectWorkerHandlers: () => OWEH.collect("workerHandlers"),
    recoverSweepWorker: () => requireFriendSweep().recoverWorker?.(),
    onEggBatchProgress: message => {
      OWEH.get("friend-eggs")?.api?.onBatchProgress?.(message);
      OWEH.get("feature-own-eggs")?.api?.onBatchProgress?.(message);
    },
    goToNextFriend
  });

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

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
    await recoverAfterReload();
    refresh();
  });
  const stopHeartbeat = startHeartbeat(isExtensionContextInvalidated);
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
    stopHeartbeat();
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
