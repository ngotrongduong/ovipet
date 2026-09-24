"use strict";

// Background service worker composition root. Durable state, command journaling and other
// subsystems live under bg/*; this file keeps Chrome event/message routing plus cross-service
// orchestration.
if (typeof importScripts === "function") {
  try {
    importScripts("bg/state-db.js", "bg/diagnostic-log.js", "bg/lightweight-tabs.js", "bg/command-journal.js", "bg/egg-tabs.js", "bg/worker-manager.js", "bg/species-alert.js", "bg/species-image.js", "bg/species-memory.js", "domain/species-shape.js", "bg/species-shapes.js", "bg/state-health.js");
  } catch (error) {
    console.error("[OviPets Helper] background service import failed", error);
  }
}

const stateDb = globalThis.OWEH_BG?.stateDb;
const diagnosticLog = globalThis.OWEH_BG?.diagnosticLog;
const lightweightTabs = globalThis.OWEH_BG?.lightweightTabs;
const commandJournal = globalThis.OWEH_BG?.commandJournal;
const workerManager = globalThis.OWEH_BG?.workerManager;
const speciesAlert = globalThis.OWEH_BG?.speciesAlert;
const speciesImage = globalThis.OWEH_BG?.speciesImage;
const speciesMemory = globalThis.OWEH_BG?.speciesMemory;
const speciesShapes = globalThis.OWEH_BG?.speciesShapes;
const stateHealthService = globalThis.OWEH_BG?.stateHealth;
if (!stateDb || !diagnosticLog || !lightweightTabs || !commandJournal || !workerManager || !speciesAlert || !speciesImage || !speciesMemory || !speciesShapes || !stateHealthService) throw new Error("OviPets background services failed to initialize");
const { migrateLegacyPetsOnce, getAllRows, getAllPets, getPetsByIds, mergePets, putTaskLease, heartbeatTasks, releaseTask } = stateDb;
const { journalBegin, journalUpdate, reconcileBreedCommands } = commandJournal;
const {
  WORKER_HEALTH_ALARM, WORKER_HEALTH_INTERVAL_MINUTES, readSharedWorkerTask, isWorkerLeaseLive,
  mirrorSharedWorkerState, updateSharedWorkerPhase, releaseSharedWorker, acknowledgeWorkerStarted,
  claimWorker, releaseWorker, getWorkerStatus, checkWorkerHealth, closeOwnedWorkerTab
} = workerManager;
const { showSpeciesVerification } = speciesAlert;
const { fetchSpeciesImage } = speciesImage;
const { read: readStateHealth } = stateHealthService;

function diagnostic(level, source, event, data = {}) {
  return diagnosticLog.append(level, source, event, data).catch(() => null);
}

diagnostic("info", "runtime", "service-worker.loaded", { version: chrome.runtime.getManifest?.().version || "unknown" });


const DAILY_MAINTENANCE_ALARM = "oweh-daily-maintenance";
function disableLegacyDailyAlarm() {
  // v4.9.0 makes the combined maintenance/friend-request run explicitly user-started.
  // Clear the old recurring alarm when upgrading from v4.8.x.
  chrome.alarms.clear(DAILY_MAINTENANCE_ALARM);
}

function ensureWorkerHealthAlarm() {
  chrome.alarms.create(WORKER_HEALTH_ALARM, { periodInMinutes: WORKER_HEALTH_INTERVAL_MINUTES });
}

// v5.4.0: back-fill the silhouette library from answers confirmed before it existed (once).
function migrateSpeciesShapes() {
  speciesShapes.migrateFromMemory().then(result => {
    if (result && !result.skipped) diagnostic("info", "species", "shapes.migrated", result);
  }).catch(error => diagnostic("warning", "species", "shapes.migration-failed", { message: error?.message || String(error) }));
}

chrome.runtime.onInstalled.addListener(migrateSpeciesShapes);
chrome.runtime.onStartup.addListener(migrateSpeciesShapes);
chrome.runtime.onInstalled.addListener(disableLegacyDailyAlarm);
chrome.runtime.onInstalled.addListener(ensureWorkerHealthAlarm);
chrome.runtime.onStartup.addListener(disableLegacyDailyAlarm);
chrome.runtime.onStartup.addListener(ensureWorkerHealthAlarm);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === WORKER_HEALTH_ALARM) {
    checkWorkerHealth().catch(error => {
      console.warn("OviPets worker health check failed", error);
      diagnostic("error", "worker", "health-check.failed", { message: error?.message || String(error) });
    });
    return;
  }
  if (alarm.name === DAILY_MAINTENANCE_ALARM) {
    chrome.alarms.clear(DAILY_MAINTENANCE_ALARM);
    return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "diagnosticLogAppend") {
    const entry = message.entry || {};
    diagnosticLog.append(entry.level, entry.source, entry.event, { ...(entry.data || {}), senderTabId: sender.tab?.id ?? null })
      .then(saved => sendResponse({ ok: true, id: saved?.id || null }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "diagnosticLogSummary") {
    diagnosticLog.getSummary().then(summary => sendResponse({ ok: true, summary }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "diagnosticLogExport") {
    diagnosticLog.exportData().then(payload => sendResponse({ ok: true, payload }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "diagnosticLogClear") {
    diagnosticLog.clear().then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "stateGetTabIdentity") {
    sendResponse({ ok: true, tabId: sender.tab?.id ?? null });
    return;
  }
  if (message?.type === "claimWorker") {
    claimWorker(message, sender, sendResponse);
    return true;
  }
  if (message?.type === "releaseWorker") {
    releaseWorker(message, sender, sendResponse);
    return true;
  }
  if (message?.type === "getWorkerStatus") {
    getWorkerStatus(message, sender, sendResponse);
    return true;
  }
  if (message?.type === "workerStarted") {
    acknowledgeWorkerStarted(message, sender, sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "workerPhase") {
    updateSharedWorkerPhase(Number(message.generation), String(message.phase || ""), sender.tab?.id);
    return;
  }
  if (message?.type === "workerDone") {
    diagnostic("info", "worker", "worker.done", { generation: message.generation, senderTabId: sender.tab?.id ?? null });
    releaseSharedWorker(Number(message.generation), sender.tab?.id).then(released => {
      if (released?.ownerTabId != null) setTimeout(() => closeOwnedWorkerTab(released.ownerTabId).catch(() => {}), 500);
    });
    return;
  }
  if (message?.type === "petDbGetAll") {
    getAllPets().then(pets => sendResponse({ ok: true, pets }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "petDbGetMany") {
    getPetsByIds(message.ids || []).then(pets => sendResponse({ ok: true, pets }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "petDbMerge") {
    mergePets(message.pets).then(count => sendResponse({ ok: true, count }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "taskClaim") {
    putTaskLease(message.task || {}, sender.tab?.id ?? null).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "taskHeartbeat") {
    heartbeatTasks(message.ids || [], sender.tab?.id ?? null).then(async result => {
      if (result.sharedWorkerTask) await mirrorSharedWorkerState(result.sharedWorkerTask);
      sendResponse({ ok: true });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "taskRelease") {
    releaseTask(message.id, sender.tab?.id ?? null, message.status || "complete")
      .then(released => sendResponse({ ok: true, released }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "commandJournalBegin") {
    journalBegin(message.entry || {}).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "commandJournalUpdate") {
    journalUpdate(message.id, message.patch || {}).then(command => sendResponse({ ok: true, command }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "stateHealth") {
    readStateHealth().then(health => sendResponse({ ok: true, health }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "reconcileBreedCommands") {
    reconcileBreedCommands(message.catalog || []).then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "speciesVerificationRequired") {
    showSpeciesVerification(sender, message.playSound).catch(() => {});
    return;
  }
  // Species knowledge is shared by up to 15 egg tabs; the service worker serializes its writes.
  const speciesMemoryHandlers = {
    speciesMemoryLearn: () => speciesMemory.learn(message),
    speciesStatsBump: () => speciesMemory.bumpStats(message),
    speciesAnswerIdsMerge: () => speciesMemory.mergeAnswerIds(message),
    speciesShapeLearn: () => speciesShapes.learn(message),
    speciesShapeMerge: () => speciesShapes.merge(message),
    speciesShapeRescan: () => speciesShapes.rescanMemory()
  };
  if (speciesMemoryHandlers[message?.type]) {
    speciesMemoryHandlers[message.type]().then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesImageFetch") {
    fetchSpeciesImage(message.url).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  // requestFriendSweepWorker/stopFriendSweepWorker/relaySweepSkip/friendSweepDone are
  // retired — the friend sweep now goes through the generic claimWorker/releaseWorker/
  // workerDone handlers above, shared with every other worker-tab feature (see
  // SHARED_WORKER_TASK_ID). "Next" relays via goToNextFriendFromBackground below, sent
  // straight to owehWorker's current tab instead of a sweep-only worker record.
  if (message?.type === "relaySweepSkip") {
    readSharedWorkerTask().then(current => {
      if (!isWorkerLeaseLive(current) || current.owner !== "sweep") return;
      const tabId = Number(current.ownerTabId);
      const send = attempts => {
        chrome.tabs.sendMessage(tabId, { type: "goToNextFriendFromBackground" }, () => {
          if (chrome.runtime.lastError && attempts > 0) setTimeout(() => send(attempts - 1), 1000);
        });
      };
      send(5);
    });
    return;
  }
  if (typeof handleEggTabMessage === "function" && handleEggTabMessage(message, sender, sendResponse)) return true;
});
