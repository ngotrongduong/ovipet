"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before core/scheduler.js");

  const DEFAULT_REFRESH_DEBOUNCE_MS = 50;

  // Extension-owned subtrees: MAIN-world bridge forms plus the helper's own panel/tooltip.
  // Panel status/dashboard text writes used to re-trigger the document-wide observer, so every
  // status line update scheduled another full refresh (storage reads for every feature).
  const OWNED_SELECTOR = '[data-oweh-bridge-owned="1"], [data-oweh-ui="1"]';

  function isOwnedElement(element) {
    return Boolean(element?.dataset?.owehBridgeOwned === "1" || element?.dataset?.owehUi === "1"
      || element?.closest?.(OWNED_SELECTOR));
  }

  function isBridgeOwnedMutationNode(node) {
    return isOwnedElement(node?.nodeType === 1 ? node : node?.parentElement);
  }

  function shouldIgnoreBridgeMutations(records) {
    let sawNode = false;
    for (const record of records || []) {
      const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
      // A removed text node has no parentElement any more, so judge the whole record by the
      // element whose children changed when that element is itself extension-owned.
      if (nodes.length && isOwnedElement(record.target?.nodeType === 1 ? record.target : null)) {
        sawNode = true;
        continue;
      }
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
