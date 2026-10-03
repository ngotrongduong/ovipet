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
    runtimeRequest, storageGet, storageSet, storageGetMany, getPetsByIds, getPetFields,
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
  if (!OWEH.domain?.colors || !OWEH.domain?.pedigree || !OWEH.domain?.breedingScore || !OWEH.domain?.breedingPlan || !OWEH.domain?.retentionPolicy) {
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
  let hatchlingModule = null;
  let breedingModule = null;
  let dashboardModule = null;
  let panelModule = null;
  let ownUserId = null;
  let currentTabId = null;

  if (!OWEH.core?.wakeSleep) {
    console.error("[OviPets Helper] core/wake-sleep.js did not load before content.js — check manifest.json script order");
    return;
  }
  // A hidden tab that owns the worker lease (or an egg tab holding awake) sleeps on the service
  // worker's clock, so Full sweep keeps going behind a fullscreen window or another program.
  const { sleep, holdAwake } = OWEH.core.wakeSleep.createWakeSleep({ isBusy: () => workerClient.hasOwner() });

  if (!OWEH.services?.status || !OWEH.services?.diagnostics || !OWEH.services?.overviewCatalog || !OWEH.services?.petEdit
    || !OWEH.services?.friendDirectory || !OWEH.services?.retention || !OWEH.services?.partnerRanking
    || !OWEH.services?.workerControl || !OWEH.services?.petFetch || !OWEH.dom?.markup) {
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
    waitForStableValue
  } = OWEH.services.overviewCatalog.createOverviewCatalog({
    sleep, overviewDom: OWEH.dom.overview
  });
  // Command-first reads: the JSONP panels the SPA itself loads, parsed without navigating.
  const petFetch = OWEH.services.petFetch.createPetFetch({
    storageGet, storageSet, runtimeRequest, sleep,
    markup: OWEH.dom.markup, fingerprint: OWEH.services.overviewCatalog.fastFingerprint
  });
  const {
    applySuggestedName, saveCurrentPet
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
  const { updateRetentionRanking, maybeDailyRetentionScan, copyRetentionReviewCsv } = OWEH.services.retention.createRetention({
    storageGet, storageSet, setStatus, writeClipboard,
    petPureMetrics, STRICT_PURE_TARGET, isBreedingProgramEnclosure,
    retentionPolicy: OWEH.domain.retentionPolicy
  });

  const DISCARD_TRACE_EVENT = "oweh:discard-action-observed";

  document.addEventListener(DISCARD_TRACE_EVENT, event => {
    try {
      const signature = JSON.parse(String(event.detail || "{}"));
      if (!/^discard-ui(?:-click)?$/.test(String(signature?.evidence || "")) || !signature.command || !signature.sourceId) return;
      storageSet({ owehDiscardCommandSignature: signature });
      setStatus("Discard UI command verified from OviPets — batch poor-egg discard is now available");
    } catch {}
  });

  async function discardPoorEggCandidates() {
    if (!isOwnHatchery()) {
      setStatus("Open your own Hatchery before discarding poor eggs");
      return { ok: false, reason: "own-hatchery-required" };
    }
    const { ranking } = await updateRetentionRanking();
    const poor = new Set((ranking || [])
      .filter(row => row.status === OWEH.domain.retentionPolicy.STATUS.EARLY_CULL_CANDIDATE)
      .map(row => String(row.id)));
    const visibleEggs = getHatcheryPetCards()
      .filter(card => !card.likelyHatched && poor.has(String(card.id)))
      .map(card => String(card.id));
    if (!visibleEggs.length) {
      setStatus("No visible Hatchery eggs qualify for early discard");
      return { ok: true, discarded: 0 };
    }

    const dispatched = [];
    let errors = 0;
    for (const id of visibleEggs) {
      const result = await OWEH.core.gameActions.discardOwnedEgg(id);
      if (!result?.ok) {
        errors += 1;
        if (/signature|target-not-visible/i.test(String(result?.reason || ""))) {
          setStatus("Discard is not verified in this OviPets session — manually discard one test egg through Edit → Send To → Discard, return to Hatchery, then run this again");
          break;
        }
        continue;
      }
      dispatched.push(id);
      await sleep(DIRECT_COMMAND_INTERVAL_MS);
    }

    if (!dispatched.length) return { ok: false, discarded: 0, errors };
    await sleep(500);
    let remaining;
    try {
      const hatchery = await petFetch.readHatchery();
      remaining = new Set(hatchery.eggIds || []);
    } catch {
      setStatus("Discard commands were sent, but Hatchery verification failed — database was not changed");
      return { ok: false, discarded: 0, errors: errors + 1 };
    }

    const confirmed = dispatched.filter(id => !remaining.has(id));
    const failed = dispatched.filter(id => remaining.has(id));
    const changed = {};
    for (const id of confirmed) {
      changed[id] = {
        id,
        present: false,
        retentionDiscardedAt: Date.now(),
        retentionDiscardReason: "early-cull-candidate"
      };
    }
    if (Object.keys(changed).length) await storageSet({ owehPets: changed });
    errors += failed.length;
    await updateRetentionRanking();
    setStatus("Poor egg discard complete — " + confirmed.length + " confirmed discarded"
      + (failed.length ? ", " + failed.length + " still present" : "")
      + (errors > failed.length ? ", " + (errors - failed.length) + " dispatch error(s)" : ""));
    return { ok: errors === 0, discarded: confirmed.length, errors };
  }

  const { rankPartners, hasBreedingCandidates } =OWEH.services.partnerRanking.createPartnerRanking({
    storageGet, setStatus, readPet, rgb, petPureMetrics, petOffTarget, pairPureMetrics,
    comparePairPureMetrics, formatPureProbability, STRICT_PURE_TARGET
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
  const requestStartBreedOutcrossCampaign = () => requireBreeding().requestStart(OWEH.domain.breedingPlan.BREEDING_STRATEGIES.NEWBORN_OUTCROSS);
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

  // v5.7.0: refresh() runs on every DOM mutation of the SPA. The state machines below each
  // start with a storage read just to learn they are idle, so their `active` flags are mirrored
  // here (seeded once, then kept current by storage.onChanged) and an idle machine is skipped
  // without touching storage. Every flag starts true, so nothing is skipped before the seed.
  const ACTIVITY_FLAG_KEYS = Object.freeze({
    owehBreedStartRequest: "breedStart",
    owehBreedCampaign: "breedCampaign",
    owehHatchlingRun: "hatchlingRun"
  });
  const activityFlags = { breedStart: true, breedCampaign: true, hatchlingRun: true };
  function setActivityFlag(key, value) {
    const name = ACTIVITY_FLAG_KEYS[key];
    if (!name) return false;
    const active = Boolean(value?.active);
    const started = active && !activityFlags[name];
    activityFlags[name] = active;
    return started;
  }
  storageGetMany({ owehBreedStartRequest: null, owehBreedCampaign: null, owehHatchlingRun: null })
    .then(values => Object.keys(ACTIVITY_FLAG_KEYS).forEach(key => setActivityFlag(key, values?.[key])))
    .catch(() => {});
  let lastRefreshHash = null;

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
    if (route.petsOverview && activityFlags.breedStart) maybeContinueBreedStart();
    if (activityFlags.breedCampaign) processBreedCampaign();
    if (activityFlags.hatchlingRun) processHatchlingRun();
    panelModule?.updatePetNameSuggestion();
    panelModule?.updateBlacklistCount();
    // Storage changes redraw the dashboard through storage.onChanged; a DOM mutation only
    // matters when it moved the tab to another page.
    if (location.hash !== lastRefreshHash) {
      lastRefreshHash = location.hash;
      scheduleActivityDashboard();
    }
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
    "owehBreedCampaign", "owehBreedQueue",
    "owehHatchlingRun", "owehHatchlingQueue",
    "owehFriendRemoval", "owehDatabaseMeta", "owehSweepNotice", "owehCullPreview"
  ]);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    let started = false;
    for (const key of Object.keys(changes)) {
      if (setActivityFlag(key, changes[key].newValue)) started = true;
    }
    // A machine that just became active gets its first tick now instead of waiting for the
    // next DOM mutation.
    if (started) scheduleRefresh(0, "activity-started");
    if (Object.keys(changes).some(key => activityStorageKeys.has(key))) {
      scheduleActivityDashboard(0);
    }
  });

  // Modules under jobs/ (registered by their own files, loaded before this one). Browser/domain
  // adapters are injected explicitly; only orchestration that still lives in content.js is grouped
  // behind narrow feature services. This keeps jobs from depending on one giant legacy object.
  const modules = OWEH.boot({
    storageGet, storageSet, storageGetMany, getPetsByIds, getPetFields, sleep, holdAwake, setStatus, runtimeRequest, sendGameCommand, diagnosticLog,
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
      breedingPlan: OWEH.domain.breedingPlan,
      retentionPolicy: OWEH.domain.retentionPolicy,
      maleCull: OWEH.domain.maleCull
    },
    gameActions: OWEH.core.gameActions,
    petFetch,
    settings: {
      getDelayMs: () => delayMs,
      getPageLoadDelayMs: () => pageLoadDelayMs,
      RECENT_FULL_FOOD_MS, PET_FEED_DELAY_MS, DEFAULT_REQUEST_DELAY
    },
    catalogService: {
      updateRetentionRanking,
      setOwnUserId: id => { if (id) ownUserId = id; },
      getOwnUserId: () => ownUserId
    },
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
      getOwnUserId: () => ownUserId,
      updateRetentionRanking
    },
    breedingActions: {
      readHatchlingRun: () => hatchlingModule?.read() || storageGet("owehHatchlingRun", { active: false }),
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
      applySuggestedName, requestStartBreedCampaign, requestStartBreedTargetCampaign, requestStartBreedOutcrossCampaign, stopBreedCampaign, copyRetentionReviewCsv, discardPoorEggCandidates,
      confirmBreedPreview, discardBreedPreview, setBreedPairLimit,
      requestStartHatchlingProcessing, stopHatchlingProcessing,
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
      setRunning,
      onRunFinished: () => requestStartHatchlingProcessing()
    },
    claimTask, releaseTask
  });
  // Name-the-Species is now a static production classifier; if it fails to start, egg turning
  // still has an inert stats stub rather than any fallback learner/trace collector.
  friendEggsModule = modules["friend-eggs"]?.api || null;
  friendSweepModule = modules["feature-friend-sweep"]?.api || null;
  ownEggsModule = modules["feature-own-eggs"]?.api || null;
  hatchlingModule = modules["feature-hatchlings"]?.api || null;
  breedingModule = modules["feature-breeding"]?.api || null;
  dashboardModule = modules["ui-dashboard"]?.api || null;
  panelModule = modules["ui-panel"]?.api || null;
  const species = modules["species-answer"]?.api || { updateStats: async () => {} };

  storageGet("owehOwnUserId", null).then(value => {
    if (value) ownUserId = value;
  });
  // Local database-only daily retention scan. This never discards anything; it refreshes the
  // keep/cull review opportunistically once per 24h whenever OviPets is open.
  maybeDailyRetentionScan().catch(() => {});

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
