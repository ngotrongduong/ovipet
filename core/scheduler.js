"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before core/scheduler.js");

  const DEFAULT_REFRESH_DEBOUNCE_MS = 50;

  function isBridgeOwnedMutationNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.dataset?.owehBridgeOwned === "1"
      || element?.closest?.('[data-oweh-bridge-owned="1"]'));
  }

  function shouldIgnoreBridgeMutations(records) {
    let sawNode = false;
    for (const record of records || []) {
      const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
      for (const node of nodes) {
        sawNode = true;
        if (!isBridgeOwnedMutationNode(node)) return false;
      }
    }
    return sawNode;
  }

  function createRefreshScheduler(callback, defaultDelay = DEFAULT_REFRESH_DEBOUNCE_MS) {
    let timer = null;
    const reasons = new Set();

    function schedule(delay = defaultDelay, reason = "dom") {
      reasons.add(reason);
      // Preserve the existing coalescing contract: once one refresh is scheduled, later
      // calls join that same burst instead of repeatedly resetting/accelerating the timer.
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const batchReasons = [...reasons];
        reasons.clear();
        callback({ reasons: batchReasons });
      }, delay);
    }

    function cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      reasons.clear();
    }

    return Object.freeze({ schedule, cancel, isScheduled: () => timer !== null });
  }

  OWEH.core = OWEH.core || {};
  OWEH.core.scheduler = Object.freeze({
    DEFAULT_REFRESH_DEBOUNCE_MS,
    isBridgeOwnedMutationNode,
    shouldIgnoreBridgeMutations,
    createRefreshScheduler
  });
})();
