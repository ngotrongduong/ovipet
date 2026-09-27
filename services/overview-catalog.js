"use strict";

// Overview page waits (shell mounted, cards present, DOM stable) plus the shared fingerprint.
// v5.9.0: the navigated enclosure-by-enclosure catalog scan was removed — Update database and
// the planner read the catalog by fetch (services/pet-fetch.js collectCatalog).
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/overview-catalog.js");

  const DOM_STABLE_MS = 450;

  function fastFingerprint(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createOverviewCatalog(deps) {
    const { sleep, overviewDom } = deps;
    const { overviewEnclosureTabs, overviewCards, isOverviewBusy } = overviewDom;

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

    return Object.freeze({ waitForOverviewCards, waitForOverviewShell, waitForStableValue });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.overviewCatalog = Object.freeze({ DOM_STABLE_MS, fastFingerprint, createOverviewCatalog });
})();
