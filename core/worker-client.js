"use strict";

(() => {
  if (!globalThis.OWEH?.core?.storage) {
    throw new Error("core/storage-client.js must load before core/worker-client.js");
  }

  const { runtimeRequest, storageGet } = OWEH.core.storage;
  let owner = null;
  let generation = null;
  let startedGeneration = null;

  function getOwner() { return owner; }
  function getGeneration() { return generation; }
  function hasOwner() { return owner != null; }

  function resync(nextOwner, nextGeneration) {
    owner = nextOwner ?? null;
    generation = nextGeneration ?? null;
    // A reload/resync never proves that this script instance has actually received a
    // startSharedWorker message, so keep startedGeneration empty. The first real start
    // message must still invoke the handler once.
    startedGeneration = null;
  }

  function clearLocal() {
    cancelPendingPhase();
    owner = null;
    generation = null;
    startedGeneration = null;
  }

  async function claimTask(id, detail = {}) {
    const result = await runtimeRequest({ type: "taskClaim", task: { id, ...detail } });
    return result.ok;
  }

  function releaseTask(id, status = "complete") {
    return runtimeRequest({ type: "taskRelease", id, status });
  }

  async function isWorkerOwner(expectedOwner) {
    if (owner !== expectedOwner) return false;
    const worker = await storageGet("owehWorker", null);
    if (!worker || worker.owner !== expectedOwner || Date.now() >= Number(worker.leaseUntil || 0)) return false;
    // Same owner name is not enough: after this tab's lease expired, a newer claim by the same
    // feature (another tab/generation) must not read as ours.
    return worker.generation == null || generation == null || Number(worker.generation) === Number(generation);
  }

  function requestClaimWorker(nextOwner, url, extra = {}) {
    return runtimeRequest({ type: "claimWorker", owner: nextOwner, url, extra });
  }

  function requestReleaseWorker(expectedOwner) {
    return runtimeRequest({ type: "releaseWorker", owner: expectedOwner });
  }

  // v5.7.0: every phase report is an IndexedDB write plus a storage mirror that makes every
  // OviPets tab redraw its dashboard. Jobs report per pet (every ~100 ms while feeding), so
  // reports are coalesced: the first goes out at once, later ones within the window collapse
  // into one trailing report carrying the latest text. The lease (45 s) is never at risk.
  const PHASE_MIN_INTERVAL_MS = 1000;
  let lastPhaseAt = 0;
  let pendingPhase = null;
  let phaseTimer = null;

  function cancelPendingPhase() {
    if (phaseTimer !== null) clearTimeout(phaseTimer);
    phaseTimer = null;
    pendingPhase = null;
  }

  function sendPhase(phaseGeneration, phase) {
    lastPhaseAt = Date.now();
    void runtimeRequest({ type: "workerPhase", generation: phaseGeneration, phase });
  }

  function reportWorkerPhase(phase) {
    if (generation == null) return;
    const wait = PHASE_MIN_INTERVAL_MS - (Date.now() - lastPhaseAt);
    if (wait <= 0 && phaseTimer === null) {
      sendPhase(generation, phase);
      return;
    }
    pendingPhase = { generation, phase };
    if (phaseTimer !== null) return;
    phaseTimer = setTimeout(() => {
      phaseTimer = null;
      const next = pendingPhase;
      pendingPhase = null;
      // A report queued for a generation that has since ended is dropped, never replayed.
      if (next && next.generation === generation) sendPhase(next.generation, next.phase);
    }, Math.max(0, wait));
  }

  function reportWorkerDone() {
    const finishedGeneration = generation;
    clearLocal();
    if (finishedGeneration == null) return;
    void runtimeRequest({ type: "workerDone", generation: finishedGeneration });
  }

  async function heartbeatSharedWorker() {
    if (owner == null) return;
    await runtimeRequest({ type: "taskHeartbeat", ids: ["shared-worker"] });
  }

  function handleStartMessage(message, handler) {
    if (!message || generation != null && generation !== message.generation) return false;
    const duplicate = startedGeneration === message.generation && owner === message.owner;
    owner = message.owner;
    generation = message.generation;
    if (!duplicate) {
      startedGeneration = message.generation;
      try {
        const result = handler?.start?.(message.generation, message.extra || {});
        Promise.resolve(result).catch(error => console.error(`[OviPets Helper] worker "${message.owner}" failed to start`, error));
      } catch (error) {
        startedGeneration = null;
        console.error(`[OviPets Helper] worker "${message.owner}" failed to start`, error);
        return false;
      }
    }
    void runtimeRequest({ type: "workerStarted", owner: message.owner, generation: message.generation });
    return true;
  }

  function handleStopMessage(message, handler) {
    handler?.stop?.();
    if (generation === message?.generation) clearLocal();
  }

  OWEH.core.workerClient = Object.freeze({
    getOwner,
    getGeneration,
    hasOwner,
    resync,
    clearLocal,
    claimTask,
    releaseTask,
    isWorkerOwner,
    requestClaimWorker,
    requestReleaseWorker,
    reportWorkerPhase,
    reportWorkerDone,
    heartbeatSharedWorker,
    handleStartMessage,
    handleStopMessage
  });
})();
