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
  const {
    overviewEnclosureTabs, overviewCards, overviewCardInfo, isOverviewBusy,
    overviewSignature, overviewEnclosureForPet
  } = OWEH.dom.overview;
  if (!OWEH.dom?.friends || !OWEH.dom?.chat) {
    console.error("[OviPets Helper] dom/friends.js and dom/chat.js must load before content.js — check manifest.json script order");
    return;
  }
  const { friendLinks } = OWEH.dom.friends;
  const {
    NINJA_CHAT_TARGETS, parseCommentTime, chatPostContainer, collectChatCandidates
  } = OWEH.dom.chat;
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
  const CHAT_WINDOW_MS = 24 * 60 * 60 * 1000;
  const DIRECT_COMMAND_INTERVAL_MS = 100;
  const DEFAULT_REQUEST_DELAY = DIRECT_COMMAND_INTERVAL_MS;
  const RECENT_FULL_FOOD_MS = 20 * 60 * 60 * 1000;
  const PET_FEED_DELAY_MS = DIRECT_COMMAND_INTERVAL_MS;
  const DOM_STABLE_MS = 450;
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

  function diagnosticLog(level, source, event, data = {}) {
    if (isExtensionContextInvalidated?.()) {
      return Promise.resolve({ ok: false, error: "extension-context-invalidated", contextInvalidated: true });
    }
    return runtimeRequest({
      type: "diagnosticLogAppend",
      entry: {
        level, source, event,
        data: { ...data, route: typeof location !== "undefined" ? `${location.pathname}${location.hash || ""}`.slice(0, 500) : "" }
      }
    });
  }

  async function exportDiagnosticLog() {
    const result = await runtimeRequest({ type: "diagnosticLogExport" });
    if (!result.ok || !result.payload) throw new Error(result.error || "diagnostic-export-failed");
    const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `ovipets-diagnostic-log-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Diagnostic Log exported (${result.payload.summary?.total || 0} event(s))`);
    return result.payload;
  }

  async function clearDiagnosticLog() {
    const result = await runtimeRequest({ type: "diagnosticLogClear" });
    if (!result.ok) throw new Error(result.error || "diagnostic-clear-failed");
    setStatus("Diagnostic Log cleared");
  }

  async function getDiagnosticSummary() {
    const result = await runtimeRequest({ type: "diagnosticLogSummary" });
    return result.ok ? result.summary : { total: 0, counts: {}, last: null };
  }
  const clampDelay = value => Math.min(30000, Math.max(0, Math.round((Number(value) || 0) * 1000)));
  const clampPageLoadDelay = value => Math.min(10000, Math.max(250, Math.round((Number(value) || 1.5) * 1000)));

  function retentionRecord(pet) {
    const pure = petPureMetrics(pet, STRICT_PURE_TARGET);
    return {
      id: pet.id,
      name: pet.name,
      gender: pet.gender,
      species: pet.species,
      enclosure: pet.enclosure,
      exactChannels: pure.exactChannels,
      usedChannels: pure.usedChannels,
      distance: pure.distance,
      // Review-only score. Exact target channels dominate distance, matching the strict
      // pure-line ordering used by breeding. No pet is removed automatically.
      score: pure.exactChannels * 100000 - (Number.isFinite(pure.distance) ? pure.distance : 99999)
    };
  }

  async function updateRetentionRanking(pets = null) {
    const source = pets || await storageGet("owehPets", {});
    const linePets = Object.values(source)
      .filter(pet => pet?.owned && pet?.colors && isBreedingProgramEnclosure(pet.enclosure));
    const speciesCounts = linePets.reduce((counts, pet) => {
      const key = pet.species || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());
    const focusSpecies = [...speciesCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const ranking = linePets
      .filter(pet => (pet.species || "Unknown") === focusSpecies)
      .map(retentionRecord)
      .filter(item => item.usedChannels > 0)
      .sort((a, b) => b.exactChannels - a.exactChannels
        || a.distance - b.distance
        || String(a.id).localeCompare(String(b.id)));
    const review = [...ranking].reverse().slice(0, Math.min(25, ranking.length));
    await storageSet({ owehRetentionRanking: ranking, owehRetentionReview: review });
    return { ranking, review };
  }

  async function copyRetentionReviewCsv() {
    const { review } = await updateRetentionRanking();
    if (!review.length) return setStatus("No indexed pets available for retention review");
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["id", "name", "gender", "species", "enclosure", "exact_target_channels", "used_channels", "distance", "review_score"],
      ...review.map(item => [item.id, item.name, item.gender, item.species, item.enclosure,
        item.exactChannels, item.usedChannels, item.distance, item.score])
    ];
    try {
      await navigator.clipboard.writeText(rows.map(row => row.map(quote).join(",")).join("\n"));
      setStatus(`Copied ${review.length} lowest-ranked pet(s) as CSV; nothing was removed`);
    } catch {
      setStatus("Could not copy automatically — clipboard access was denied");
    }
  }

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

  function compareHatchMales(a, b) {
    const aHasTarget = a.rank.targetUsed > 0;
    const bHasTarget = b.rank.targetUsed > 0;
    if (aHasTarget !== bHasTarget) return aHasTarget ? -1 : 1;
    if (aHasTarget) {
      const targetOrder = b.rank.targetExact - a.rank.targetExact
        || a.rank.targetDistance - b.rank.targetDistance;
      if (targetOrder) return targetOrder;
    }
    return b.rank.extremeExact - a.rank.extremeExact
      || a.rank.extremeDistance - b.rank.extremeDistance
      || String(a.id || "").localeCompare(String(b.id || ""));
  }

  async function openCompleteFriendsList() {
    const avatarCount = document.querySelectorAll("fieldset.friends a.user.avatar[href]").length;
    const closeButton = [...document.querySelectorAll("button")]
      .some(candidate => /^Close$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
    const hasCompleteList = avatarCount >= 50 || (closeButton && avatarCount > 0);
    if (hasCompleteList) return;
    const button = [...document.querySelectorAll("main button")]
      .find(candidate => /^Friends(?:\s*\(\d+\))?$/i.test(candidate.textContent.trim()));
    if (!button) return;
    button.click();
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (document.querySelectorAll("fieldset.friends a.user.avatar[href]").length >= 50) return;
      await sleep(200);
    }
  }

  async function scanFriends() {
    await openCompleteFriendsList();
    const found = friendLinks();
    if (!found.length) return setStatus("No numeric friend profiles found on this page");
    const blacklist = await friendBlacklist();
    const friends = found.filter(friend => !blacklist[friend.id]);
    const skipped = found.length - friends.length;
    await storageSet({ owehFriendQueue: friends, owehSweep: { active: false, index: 0, maxFriends: friends.length } });
    setStatus(`Found ${friends.length} friend(s) — full list saved; cooldowns will be skipped${skipped ? ` (${skipped} blacklisted friend(s) excluded)` : ""}`);
  }

  async function friendBlacklist() {
    return friendSweepModule?.getBlacklist
      ? friendSweepModule.getBlacklist()
      : storageGet("owehFriendBlacklist", {});
  }

  // Export only a copied CSV; no external API/OAuth connection is required.
  async function copyBlacklistCsv() {
    const [blacklist, queue] = await Promise.all([
      friendBlacklist(),
      storageGet("owehFriendQueue", [])
    ]);
    const names = Object.fromEntries((queue || []).map(friend => [String(friend.id), friend.name || ""]));
    const rows = Object.entries(blacklist || {}).map(([id, entry = {}]) => [
      id,
      names[String(id)] || "",
      entry.reason || "",
      Number.isFinite(Number(entry.at)) && Number(entry.at) > 0 ? new Date(Number(entry.at)).toISOString() : ""
    ]);
    if (!rows.length) {
      setStatus("Blacklist is empty — nothing to copy");
      return;
    }
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "user_id,name,reason,blacklisted_at",
      ...rows.map(row => row.map(quote).join(","))
    ].join("\n");
    try {
      await navigator.clipboard.writeText(csv);
      setStatus(`Copied ${rows.length} blacklisted friend(s) as CSV`);
    } catch {
      setStatus("Could not copy automatically — clipboard access was denied");
    }
  }

  async function expandRecentChatComments(title) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const container = chatPostContainer(title);
      if (!container) return false;
      const button = [...container.querySelectorAll("button")]
        .find(candidate => /Show Previous Comments/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
      if (!button) return true;
      const before = container.querySelectorAll("li").length;
      button.click();
      await sleep(Math.max(pageLoadDelayMs, 1000));
      const updated = chatPostContainer(title);
      if (!updated) return false;
      const after = updated.querySelectorAll("li").length;
      if (after <= before) return true;
      const oldest = [...updated.querySelectorAll(".comments li")]
        .map(parseCommentTime).filter(Number.isFinite).sort((a, b) => a - b)[0];
      if (oldest && Date.now() - oldest >= CHAT_WINDOW_MS) return true;
    }
    return true;
  }

  async function performNinjaChatScan() {
    const ownId = String(await storageGet("owehOwnUserId", ownUserId || "") || "");
    const history = await storageGet("owehFriendRequestHistory", {});
    const containers = [];
    const scanned = [];
    const missing = [];

    for (const title of NINJA_CHAT_TARGETS) {
      let container = chatPostContainer(title);
      if (!container) {
        missing.push(title);
        continue;
      }
      setStatus(`Loading recent ${title} comments...`);
      await expandRecentChatComments(title);
      container = chatPostContainer(title);
      if (!container) {
        missing.push(title);
        continue;
      }
      containers.push(container);
      scanned.push(title);
    }

    if (!containers.length) {
      setStatus(`Could not find ${NINJA_CHAT_TARGETS.join(" or ")} chat posts`);
      return null;
    }

    const queue = collectChatCandidates(containers, {
      now: Date.now(), windowMs: CHAT_WINDOW_MS, ownId, history
    });
    await storageSet({ owehChatQueue: queue });
    const missingText = missing.length ? `; not found: ${missing.join(", ")}` : "";
    setStatus(`Found ${queue.length} unique commenter(s) from ${scanned.join(" + ")} in the last 24 hours${missingText}`);
    return queue;
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

  function buttonWithText(text) {
    return [...document.querySelectorAll("main button, [role=dialog] button")]
      .find(button => button.textContent.trim() === text && button.offsetParent !== null) || null;
  }

  async function waitForButtonText(text, timeout = 5000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const button = buttonWithText(text);
      if (button) return button;
      await sleep(150);
    }
    return null;
  }

  async function openTab(name, timeout = 8000) {
    const tab = findTab(name);
    if (!tab) return false;
    if (!isTabActive(tab)) tab.querySelector("a")?.click();
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (isTabActive(findTab(name))) return true;
      await sleep(100);
    }
    return isTabActive(findTab(name));
  }

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

  async function waitForBreedingCandidates(timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (document.querySelector(BREEDING_CANDIDATE_SELECTOR)) return true;
      await sleep(150);
    }
    return Boolean(document.querySelector(BREEDING_CANDIDATE_SELECTOR));
  }

  function petProfilePath(petId) {
    return buildPetProfilePath(petId, ownUserId);
  }

  async function saveCurrentPet() {
    const pet = readPet();
    if (!pet) return setStatus("Open a pet profile with visible Colors first");
    const pets = await storageGet("owehPets", {});
    const previous = pets[pet.id];
    // Overview can be saved before lazy Pedigree content is mounted. Preserve an already
    // verified pedigree in that manual-save case; never invent verification from an empty
    // current panel. A breeding index refresh will still replace stale records normally.
    if (pet.pedigreeVerified !== true && previous?.pedigreeVerified === true) {
      pet.pedigreeVerified = true;
      pet.ancestors = [...(previous.ancestors || [])];
      pet.pedigree = [...(previous.pedigree || [])];
      pet.parentIds = [...(previous.parentIds || [])];
    }
    pets[pet.id] = { ...(previous || {}), ...pet };
    await storageSet({ owehPets: pets });
    const suggestion = suggestedPetName(pet);
    const suffix = suggestion ? ` — suggested name: ${suggestion}` : "";
    setStatus(`Saved ${pet.name} (${Object.keys(pets).length} pets indexed)${suffix}`);
  }

  // Confirmed flow (docs/dom-audit-2026-09-17.md #3): Rename lives on the Edit tab, opens a
  // generic confirm dialog with input[name="Name"] (no id) and Ok/Cancel buttons.
  async function waitForRenameInput(timeout = 5000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const input = [...document.querySelectorAll('[role="dialog"] input[name="Name"]')]
        .find(el => el.offsetParent !== null);
      if (input) return input;
      await sleep(100);
    }
    return null;
  }

  function visibleDialog(matcher = null) {
    return [...document.querySelectorAll('[role="dialog"]')]
      .find(dialog => dialog.offsetParent !== null && (!matcher || matcher.test(dialog.textContent || ""))) || null;
  }

  function dialogButton(dialog, text) {
    return [...(dialog?.querySelectorAll("button") || [])]
      .find(button => button.textContent.trim() === text && button.offsetParent !== null) || null;
  }

  async function renamePet(pet, desiredName = suggestedPetName(pet)) {
    if (!pet || !desiredName) return { changed: false, reason: "missing-name" };
    if (pet.name === desiredName) return { changed: false, reason: "already-named" };
    const isUnnamed = /^Unnamed$/i.test(String(pet.name || "").trim());
    // Confirmed live 2026-09-18: Rename calls
    // ui_action_cmdExec('pet_rename', `PetID=${id}`, form), with input[name="Name"].
    // Use that same rendered UI dispatcher first; retain the inspected button flow below
    // as a compatibility fallback if the game changes or the dispatcher is unavailable.
    if (!isUnnamed) {
      const direct = await sendGameCommand("pet_rename", pet.id, { Name: desiredName });
      if (direct.ok) return { changed: true, name: desiredName, fast: true };
    }
    // A live newly hatched pet exposes Name in the profile Actions block and keeps its
    // Enclosure select disabled until naming succeeds. Older named pets expose Rename from
    // Edit. Support both flows, preferring the directly visible Name action.
    let renameButton = isUnnamed ? await waitForButtonText("Name", 5000) : buttonWithText("Name");
    if (!renameButton) {
      if (!(await openTab("Edit"))) return { changed: false, reason: "missing-edit-tab" };
      renameButton = await waitForButtonText("Rename", 5000);
    }
    if (!renameButton) return { changed: false, reason: "missing-rename-button" };
    renameButton.click();
    const input = await waitForRenameInput();
    if (!input) return { changed: false, reason: "missing-rename-input" };
    input.value = desiredName;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const dialog = input.closest('[role="dialog"]');
    const ok = dialogButton(dialog, "Ok");
    if (!ok) return { changed: false, reason: "missing-rename-confirm" };
    ok.click();
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const displayed = document.querySelector("main h3 .ui-section-title")?.textContent
        || document.querySelector("main h3")?.textContent
        || "";
      if (!visibleDialog() && displayed.includes(desiredName)) return { changed: true, name: desiredName };
      await sleep(150);
    }
    return { changed: !visibleDialog(), name: desiredName, reason: "unverified" };
  }

  async function applySuggestedName() {
    const pet = readPet();
    const suggestion = pet ? suggestedPetName(pet) : null;
    if (!suggestion) return setStatus("Open a pet profile to get a naming suggestion first");
    const result = await renamePet(pet, suggestion);
    setStatus(result.changed
      ? `Renamed to "${suggestion}"`
      : result.reason === "already-named" ? `Already named "${suggestion}"` : `Rename failed: ${result.reason}`);
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

  async function waitForOverviewCards(timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (overviewCards().length) return true;
      await sleep(150);
    }
    return Boolean(overviewCards().length);
  }

  async function waitForOverviewShell(timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      // OviPets mounts the Overview route first, then adds enclosure tabs and cards
      // asynchronously. Capturing overviewEnclosureTabs() before this point reduces a
      // multi-enclosure account to a one-tab scan for the whole run.
      if (overviewEnclosureTabs().length) return true;
      const busy = isOverviewBusy();
      if (!busy && overviewCards().length) return true;
      await sleep(100);
    }
    return Boolean(overviewEnclosureTabs().length || overviewCards().length);
  }

  async function waitForStableValue(readValue, timeout = 10000, stableMs = DOM_STABLE_MS) {
    const end = Date.now() + timeout;
    let previous = null;
    let stableSince = 0;
    while (Date.now() < end) {
      const current = String(readValue() ?? "");
      if (current && current === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return current;
      } else {
        previous = current;
        stableSince = 0;
      }
      await sleep(100);
    }
    return String(readValue() ?? "");
  }

  function fastFingerprint(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  async function collectAllOverviewPets() {
    const found = new Map();
    const enclosureIds = {};
    const previousSnapshots = await storageGet("owehEnclosureSnapshots", {});
    const previousEnclosureIds = await storageGet("owehEnclosureIds", {});
    const nextSnapshots = {};
    let reusedEnclosures = 0;
    let skippedEnclosures = 0;
    await waitForOverviewShell(Math.max(10000, pageLoadDelayMs * 6));
    const tabs = overviewEnclosureTabs();
    const tabCount = Math.max(tabs.length, 1);
    // Fewer tabs than the last full scan means OviPets has not mounted every enclosure yet.
    let partial = tabs.length < Object.keys(previousEnclosureIds || {}).length;
    for (let index = 0; index < tabCount; index += 1) {
      const currentTabs = overviewEnclosureTabs();
      const tab = currentTabs[index];
      if (tab && !isTabActive(tab)) {
        tab.querySelector("a")?.click();
        const end = Date.now() + 10000;
        while (Date.now() < end && !isTabActive(overviewEnclosureTabs()[index])) await sleep(150);
        if (!isTabActive(overviewEnclosureTabs()[index])) {
          // The previous enclosure's cards are still on screen; reading them now would file
          // those pets under this enclosure. Skip it and report the scan as partial.
          partial = true;
          skippedEnclosures += 1;
          continue;
        }
      }
      await waitForOverviewCards();
      await waitForStableValue(overviewSignature, Math.max(5000, pageLoadDelayMs * 4));
      const currentTab = overviewEnclosureTabs()[index];
      const enclosure = currentTab?.textContent.trim() || "Default";
      const enclosureId = currentTab?.querySelector("[enclosure]")?.getAttribute("enclosure")
        || currentTab?.getAttribute("enclosure")?.match(/(\d+)$/)?.[1]
        || null;
      if (enclosureId !== null) enclosureIds[enclosure] = String(enclosureId);
      const signature = overviewSignature();
      const fingerprint = fastFingerprint(signature);
      const snapshotKey = String(enclosureId ?? normalizeEnclosureLabel(enclosure));
      const previous = previousSnapshots[snapshotKey];
      let records;
      if (previous?.fingerprint === fingerprint && Array.isArray(previous.records)) {
        records = previous.records;
        reusedEnclosures += 1;
      } else {
        records = overviewCards().map(overviewCardInfo).filter(Boolean)
          .map(info => ({ ...info, enclosure, enclosureId }));
      }
      records.forEach(info => found.set(info.id, { ...info, enclosure, enclosureId }));
      nextSnapshots[snapshotKey] = { fingerprint, enclosure, enclosureId, count: records.length, records, scannedAt: Date.now() };
    }
    // A scan that saw no pet at all (Overview not mounted) must not overwrite the saved
    // enclosure ids/snapshots or reconcile breed commands against an empty catalog.
    if (!found.size) return [];
    // A partial scan only adds to what the last full scan knew; it never drops an enclosure.
    const scanned = tabCount - skippedEnclosures;
    await storageSet({
      owehEnclosureIds: partial ? { ...previousEnclosureIds, ...enclosureIds } : enclosureIds,
      owehEnclosureSnapshots: partial ? { ...previousSnapshots, ...nextSnapshots } : nextSnapshots,
      owehEnclosureScanStats: { scanned, skipped: skippedEnclosures, reused: reusedEnclosures, changed: scanned - reusedEnclosures, partial, at: Date.now() }
    });
    const catalog = [...found.values()];
    await runtimeRequest({ type: "reconcileBreedCommands", catalog });
    return catalog;
  }

  function petGenderFromOverview() {
    return readOverviewValue("Gender")
      || document.querySelector('section#overview img[title="Male"], section#overview img[title="Female"]')?.title
      || "";
  }

  async function waitForPetGender(timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const gender = petGenderFromOverview().trim();
      if (/^(?:Female|Male)$/i.test(gender)) return gender;
      await sleep(150);
    }
    return petGenderFromOverview().trim();
  }

  function enclosureSelect() {
    const selects = [...document.querySelectorAll('section#edit select, main select')];
    return document.querySelector('section#edit select[name="Enclosure"]')
      || selects.find(select => /enclosure/i.test(select.name || "") || /enclosure/i.test(select.id || ""))
      || selects.find(select => {
        const fieldsetText = select.closest("fieldset")?.textContent || "";
        const labelText = select.closest("label")?.textContent || "";
        return /\bEnclosure\b/i.test(`${fieldsetText} ${labelText}`);
      })
      || selects.find(select => NEWBORN_ENCLOSURES.some(target =>
        [...select.options].some(option => normalizeEnclosureLabel(option.textContent) === normalizeEnclosureLabel(target))
      ))
      || null;
  }

  async function waitForEnclosureSelect(timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const select = enclosureSelect();
      if (select && select.offsetParent !== null && !select.disabled) return select;
      await sleep(150);
    }
    return null;
  }

  function enclosureOption(select, target) {
    const wanted = normalizeEnclosureLabel(target);
    return [...(select?.options || [])].find(option => normalizeEnclosureLabel(option.textContent) === wanted) || null;
  }

  async function movePetToEnclosure(target) {
    const fast = await fastMovePetToEnclosure(currentPetId(), target);
    if (fast.moved) return fast;
    if (!(await openTab("Edit"))) return { moved: false, reason: "missing-edit-tab" };
    let select = await waitForEnclosureSelect();
    if (!select) return { moved: false, reason: "missing-enclosure-select" };
    let option = enclosureOption(select, target);
    if (!option) return { moved: false, reason: `missing-option:${target}` };
    if (select.value === option.value) return { moved: false, alreadyThere: true };
    const selectedValue = option.value;
    select.value = selectedValue;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      await sleep(200);
      select = enclosureSelect();
      if (!select) continue;
      option = enclosureOption(select, target);
      if (option && select.value === option.value) {
        await sleep(Math.max(500, pageLoadDelayMs));
        return { moved: true };
      }
    }
    return { moved: false, reason: "selection-not-confirmed" };
  }

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
