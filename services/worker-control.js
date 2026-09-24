"use strict";

// Cross-feature worker control for this tab: Stop All, the task heartbeat, routing of the
// background's shared-worker messages to each feature's start/stop pair, and recovery of the
// worker lease after this tab itself was reloaded. Feature state stays inside each feature; this
// service only calls the stop/start functions it is given.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/worker-control.js");

  const STRAIGHT_JOB_LABELS = Object.freeze({
    maintain: "Update database", ninja: "Scan Ninja", requests: "Send requests"
  });

  function createWorkerControl(deps) {
    const {
      runtimeRequest, storageGetMany, workerClient, releaseFinishedWorker, requestReleaseWorker,
      diagnosticLog, setStatus, instanceId, getCurrentTabId,
      stops, localWorkerHandlers, collectWorkerHandlers, recoverSweepWorker, onEggBatchProgress, goToNextFriend
    } = deps;

    function ownedByThisTab(state) {
      const currentTabId = getCurrentTabId();
      if (state?.ownerTabId != null && currentTabId != null) return Number(state.ownerTabId) === Number(currentTabId);
      return !state?.ownerInstance || state.ownerInstance === instanceId;
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
      await stops.stopFriendSweep();
      await stops.stopBreedCampaign();
      await stops.stopPetIndex();
      await stops.stopHatchlings();
      await stops.stopOwnEggs();
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

    function startHeartbeat(isExtensionContextInvalidated, intervalMs = 15000) {
      let timer = setInterval(() => {
        if (isExtensionContextInvalidated?.()) {
          clearInterval(timer);
          timer = null;
          return;
        }
        sendTaskHeartbeat().catch(error => diagnosticLog("error", "runtime", "heartbeat.failed", { message: error?.message || String(error) }));
      }, intervalMs);
      return () => { clearInterval(timer); timer = null; };
    }

    // v5 shared worker tab dispatch: background.js's claimWorker/releaseWorker send these
    // two generic message types to whichever tab it just attached/is releasing as the
    // shared worker, naming the feature via `owner`. Each feature registers its own
    // start/stop pair instead of background.js needing to know each feature's function
    // names directly (the one-button jobs under jobs/ register their own handlers via
    // OWEH.collect; the features composed by content.js are passed as localWorkerHandlers).
    function handleRuntimeMessage(message, sender, sendResponse) {
      if (message?.type === "startSharedWorker") {
        const handler = ({ ...localWorkerHandlers, ...collectWorkerHandlers() })[message.owner];
        if (!handler?.start) return;
        workerClient.handleStartMessage(message, handler);
        return;
      }
      if (message?.type === "stopSharedWorker") {
        const handler = ({ ...localWorkerHandlers, ...collectWorkerHandlers() })[message.owner];
        workerClient.handleStopMessage(message, handler);
        return;
      }
      if (message?.type === "recoverSharedWorker") {
        workerClient.resync(message.owner, message.generation);
        diagnosticLog("warning", "worker", "worker.recovery-received", { owner: message.owner, generation: message.generation, tabId: getCurrentTabId() });
        if (message.owner === "sweep") {
          Promise.resolve(recoverSweepWorker()).catch(error =>
            diagnosticLog("error", "friend-sweep", "sweep.recovery-failed", { message: error?.message || String(error) }));
        }
        sendResponse?.({ ok: true });
        return;
      }
      if (message?.type === "eggBatchProgress") {
        onEggBatchProgress(message);
        return;
      }
      if (message?.type === "goToNextFriendFromBackground") {
        goToNextFriend();
      }
    }

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
    async function recoverAfterReload() {
      const currentTabId = getCurrentTabId();
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
    }

    return { ownedByThisTab, stopAllAutomation, sendTaskHeartbeat, startHeartbeat, handleRuntimeMessage, recoverAfterReload };
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.workerControl = Object.freeze({ STRAIGHT_JOB_LABELS, createWorkerControl });
})();
