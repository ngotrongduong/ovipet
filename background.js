"use strict";

// Background service worker composition root. Durable state, command journaling and other
// subsystems live under bg/*; this file keeps Chrome event/message routing plus cross-service
// orchestration.
if (typeof importScripts === "function") {
  try {
    importScripts("bg/state-db.js", "bg/diagnostic-log.js", "bg/lightweight-tabs.js", "bg/command-journal.js", "bg/egg-tabs.js", "bg/worker-manager.js", "bg/species-alert.js", "bg/species-image.js", "domain/species-shape.js", "bg/species-stats.js", "bg/species-learned.js", "bg/state-health.js", "bg/self-update.js");
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
const speciesStats = globalThis.OWEH_BG?.speciesStats;
const speciesLearned = globalThis.OWEH_BG?.speciesLearned;
const stateHealthService = globalThis.OWEH_BG?.stateHealth;
if (!stateDb || !diagnosticLog || !lightweightTabs || !commandJournal || !workerManager || !speciesAlert || !speciesImage || !speciesStats || !speciesLearned || !stateHealthService) throw new Error("OviPets background services failed to initialize");
const { migrateLegacyPetsOnce, getAllRows, getAllPets, getPetFields, getPetsByIds, mergePets, putTaskLease, heartbeatTasks, releaseTask } = stateDb;
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

// Name the Species: the totals and the safety pause see the same answers. When the pause trips,
// the owner gets the review page and (unless muted) the alert sound once.
async function bumpSpeciesStats(message) {
  const result = await speciesStats.bump(message);
  // The totals are already written: a failing pause check must not make the answerer count the
  // same answer again through its storage fallback.
  const { guard, tripped } = await speciesLearned.noteAnswers(message)
    .catch(() => ({ guard: null, tripped: false }));
  if (tripped) {
    diagnostic("warning", "species", "species.paused", { reason: guard?.paused?.reason || "", streak: guard?.streak || 0, wrongInHour: guard?.wrongAt?.length || 0 });
    speciesLearned.openReview().catch(() => {});
    chrome.storage.local.get({ owehSpeciesAlertSound: true })
      .then(stored => showSpeciesVerification({}, stored.owehSpeciesAlertSound))
      .catch(() => {});
  }
  return { ...result, guard, tripped };
}

// A species the game rejected (or overruled) for an image must not stay learned for it.
async function forgetRefutedSpecies(result, refuted = null) {
  const targets = [...(Array.isArray(result?.overruled) ? result.overruled : [])];
  if (refuted) targets.push(refuted);
  for (const target of targets) {
    await speciesLearned.forget({ ...target, refuted: true }).catch(() => null);
  }
  return result;
}

diagnostic("info", "runtime", "service-worker.loaded", { version: chrome.runtime.getManifest?.().version || "unknown" });


const DAILY_MAINTENANCE_ALARM = "oweh-daily-maintenance";
const WAKE_AFTER_MAX_MS = 20 * 1000;
function disableLegacyDailyAlarm() {
  // v4.9.0 makes the combined maintenance/friend-request run explicitly user-started.
  // Clear the old recurring alarm when upgrading from v4.8.x.
  chrome.alarms.clear(DAILY_MAINTENANCE_ALARM);
}

function ensureWorkerHealthAlarm() {
  chrome.alarms.create(WORKER_HEALTH_ALARM, { periodInMinutes: WORKER_HEALTH_INTERVAL_MINUTES });
}

function dropRetentionRanking() {
  // The retention ranking was removed on 2026-10-05 (Discard surplus replaced it). Free the
  // whole-database ranking it left in extension storage when upgrading.
  chrome.storage.local.remove([
    "owehRetentionRanking", "owehRetentionReview", "owehRetentionSummary", "owehRetentionLastFullScanAt"
  ]).catch(() => {});
}

// Self-update (bg/self-update.js): a newer version in the extension's folder is loaded by the
// extension itself, but never under a running job. What it waits for is shown in the panel.
const selfUpdate = globalThis.OWEH_BG?.selfUpdate;
const REVIEW_PAGE_URL = chrome.runtime.getURL("review/species-review.html");

async function automationBusy() {
  const task = await readSharedWorkerTask();
  if (isWorkerLeaseLive(task)) return `"${task.owner || "a job"}" running in the background tab`;
  const state = await chrome.storage.local.get({
    owehSweep: { active: false }, owehEggRun: { active: false }, owehBreedCampaign: { active: false },
    owehHatchlingRun: { active: false }, owehFriendRemoval: { active: false }
  });
  if (state.owehSweep?.active) return "the friend sweep";
  if (state.owehEggRun?.active) return "the Hatchery run";
  if (state.owehBreedCampaign?.active) return "the breeding campaign";
  if (state.owehHatchlingRun?.active) return "the newborn pass";
  if (state.owehFriendRemoval?.active) return "a friend removal";
  // A reload closes extension pages: not while the owner is looking at the review page.
  const front = await chrome.tabs.query({ active: true }).catch(() => []);
  if (front.some(tab => String(tab.url || "").startsWith(REVIEW_PAGE_URL))) return "the review page (close it or switch tabs)";
  return "";
}

selfUpdate?.start({
  busy: automationBusy,
  tabUrls: ["https://ovipets.com/*", "https://app.ovipets.com/*"],
  // A review page left open in the background is put back afterwards, without taking focus.
  beforeReload: async () => {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return { review: tabs.some(tab => String(tab.url || "").startsWith(REVIEW_PAGE_URL)) };
  },
  onApplied: async ({ from, to, resume }) => {
    diagnostic("info", "runtime", "self-update.applied", { from, to });
    if (resume?.review) await speciesLearned.openReview({ focus: false }).catch(() => null);
  }
});

chrome.runtime.onInstalled.addListener(dropRetentionRanking);
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
  if (message?.type === "wakeAfter") {
    // v5.5.2: a hidden tab's own timers are throttled to 1 Hz and, after five minutes hidden,
    // to about once a minute. The service worker's timers are not, so a hidden worker/egg tab
    // sleeps here instead. One request is capped well under the service worker's idle limit.
    const ms = Math.max(0, Math.min(WAKE_AFTER_MAX_MS, Math.floor(Number(message.ms) || 0)));
    setTimeout(() => sendResponse({ ok: true, ms }), ms);
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
  if (message?.type === "petDbGetFields") {
    getPetFields({ fields: Array.isArray(message.fields) ? message.fields : [], gender: message.gender || null })
      .then(pets => sendResponse({ ok: true, pets }))
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
  if (message?.type === "speciesStatsBump") {
    bumpSpeciesStats(message).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesWrongCaseRecord") {
    const rejected = message.case || message.record || {};
    speciesStats.recordWrong(message)
      .then(result => forgetRefutedSpecies(result, { species: rejected.wrongSpecies, shape: rejected.shape }))
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesWrongCaseResolve") {
    speciesStats.resolveWrong(message).then(forgetRefutedSpecies).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesWrongCasesGet") {
    speciesStats.readWrongCases().then(cases => sendResponse({ ok: true, cases, count: cases.length }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesWrongCasesClear") {
    speciesStats.clearWrongCases(message).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesConfirmedShape") {
    speciesLearned.learn(message).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesOwnerLabel") {
    speciesLearned.labelCase(message).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesLearnedGet") {
    speciesLearned.readAll().then(library => sendResponse({ ok: true, library }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesGuardGet") {
    speciesLearned.status().then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesGuardResume") {
    speciesLearned.resume().then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesGuardLimits") {
    speciesLearned.setLimits(message).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "speciesWrongReviewOpen") {
    speciesLearned.openReview().then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "selfUpdateStatus") {
    selfUpdate.status().then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "selfUpdateEnabled") {
    selfUpdate.setEnabled(message.enabled).then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === "selfUpdateNow") {
    // The owner pressed "Update now": the panel has stopped every job before sending this.
    selfUpdate.check({ force: true }).then(result => sendResponse({ ok: true, ...result }))
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
