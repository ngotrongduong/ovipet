"use strict";

// Pets Overview catalog scan: walks every enclosure tab, reads the visible pet cards and saves
// per-enclosure snapshots/ids. content.js composes it once with explicit dependencies; it keeps
// no module-level state, so every call reads the live page and durable storage afresh.
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
    const {
      storageGet, storageSet, runtimeRequest, sleep, getPageLoadDelayMs,
      overviewDom, isTabActive, normalizeEnclosureLabel
    } = deps;
    const { overviewEnclosureTabs, overviewCards, overviewCardInfo, isOverviewBusy, overviewSignature } = overviewDom;

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

    async function collectAllOverviewPets() {
      const found = new Map();
      const enclosureIds = {};
      const previousSnapshots = await storageGet("owehEnclosureSnapshots", {});
      const previousEnclosureIds = await storageGet("owehEnclosureIds", {});
      const nextSnapshots = {};
      let reusedEnclosures = 0;
      let skippedEnclosures = 0;
      await waitForOverviewShell(Math.max(10000, getPageLoadDelayMs() * 6));
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
        await waitForStableValue(overviewSignature, Math.max(5000, getPageLoadDelayMs() * 4));
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

    return Object.freeze({ waitForOverviewCards, waitForOverviewShell, waitForStableValue, collectAllOverviewPets });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.overviewCatalog = Object.freeze({ DOM_STABLE_MS, fastFingerprint, createOverviewCatalog });
})();
