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
    return Boolean(worker) && worker.owner === expectedOwner && Date.now() < Number(worker.leaseUntil || 0);
  }

  function requestClaimWorker(nextOwner, url, extra = {}) {
    return runtimeRequest({ type: "claimWorker", owner: nextOwner, url, extra });
  }

  function requestReleaseWorker(expectedOwner) {
    return runtimeRequest({ type: "releaseWorker", owner: expectedOwner });
  }

  function reportWorkerPhase(phase) {
    if (generation == null) return;
    void runtimeRequest({ type: "workerPhase", generation, phase });
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
