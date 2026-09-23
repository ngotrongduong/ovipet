"use strict";

// Resource throttling for extension-owned Full Sweep tabs.
//
// Full OviPets pages carry many pet images, media and webfonts that are useful to a human but
// unnecessary to an automation tab whose only job is to read DOM/buttons and execute the real
// UI flow. Loading them in 10-15 short-lived tabs at once creates avoidable network, renderer
// and image-decoder memory pressure. One tab-scoped DNR session rule blocks only those heavy
// resource types for tabs explicitly registered here. Scripts, HTML, CSS, XHR/fetch and forms
// remain untouched, so the real OviPets UI logic still runs.
//
// Name-the-Species remains functional because its visual fingerprint is fetched through the
// guarded background species-image service; that extension request has no matching owned page
// tabId and therefore is not blocked by this tab-scoped rule.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.lightweightTabs) return;

  const RULE_ID = 5311001;
  const BLOCKED_RESOURCE_TYPES = Object.freeze(["image", "media", "font"]);
  let updateChain = Promise.resolve();

  const diag = (level, event, data = {}) =>
    OWEH_BG.diagnosticLog?.append(level, "lightweight-tabs", event, data).catch(() => {});

  function validTabId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id >= 0 ? id : null;
  }

  function dnrAvailable() {
    return Boolean(chrome?.declarativeNetRequest?.getSessionRules && chrome?.declarativeNetRequest?.updateSessionRules);
  }

  function getSessionRules() {
    if (!dnrAvailable()) return Promise.resolve([]);
    return new Promise(resolve => {
      try {
        chrome.declarativeNetRequest.getSessionRules(rules => {
          const error = chrome.runtime?.lastError;
          if (error) {
            diag("warning", "rules.read-failed", { message: error.message || String(error) });
            resolve([]);
            return;
          }
          resolve(Array.isArray(rules) ? rules : []);
        });
      } catch (error) {
        diag("warning", "rules.read-exception", { message: error?.message || String(error) });
        resolve([]);
      }
    });
  }

  function updateSessionRules(payload) {
    if (!dnrAvailable()) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        chrome.declarativeNetRequest.updateSessionRules(payload, () => {
          const error = chrome.runtime?.lastError;
          if (error) {
            diag("warning", "rules.update-failed", { message: error.message || String(error) });
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (error) {
        diag("warning", "rules.update-exception", { message: error?.message || String(error) });
        resolve(false);
      }
    });
  }

  async function readOwnedTabIds() {
    const rules = await getSessionRules();
    const rule = rules.find(candidate => Number(candidate?.id) === RULE_ID);
    return [...new Set((rule?.condition?.tabIds || []).map(validTabId).filter(id => id != null))];
  }

  async function writeOwnedTabIds(tabIds) {
    const ids = [...new Set((tabIds || []).map(validTabId).filter(id => id != null))].sort((a, b) => a - b);
    const removeRuleIds = [RULE_ID];
    const addRules = ids.length ? [{
      id: RULE_ID,
      priority: 1,
      action: { type: "block" },
      condition: {
        tabIds: ids,
        resourceTypes: [...BLOCKED_RESOURCE_TYPES]
      }
    }] : [];
    return updateSessionRules({ removeRuleIds, addRules });
  }

  function mutate(mutator) {
    const run = updateChain.then(async () => {
      if (!dnrAvailable()) return false;
      const ids = await readOwnedTabIds();
      const next = mutator(ids.slice()) || ids;
      return writeOwnedTabIds(next);
    });
    updateChain = run.catch(() => false);
    return run;
  }

  async function enable(tabId, role = "sweep") {
    const id = validTabId(tabId);
    if (id == null) return false;
    const changed = await mutate(ids => ids.includes(id) ? ids : [...ids, id]);
    if (changed) diag("info", "tab.lightweight-enabled", { tabId: id, role });
    return changed;
  }

  async function disable(tabId, role = "owned-tab") {
    const id = validTabId(tabId);
    if (id == null) return false;
    const changed = await mutate(ids => ids.filter(candidate => candidate !== id));
    if (changed) diag("info", "tab.lightweight-disabled", { tabId: id, role });
    return changed;
  }

  async function reconcile(tabIds = []) {
    const desired = [...new Set((tabIds || []).map(validTabId).filter(id => id != null))];
    const ok = await mutate(() => desired);
    if (ok) diag("info", "rules.reconciled", { count: desired.length });
    return ok;
  }

  OWEH_BG.lightweightTabs = Object.freeze({
    RULE_ID,
    BLOCKED_RESOURCE_TYPES,
    enable,
    disable,
    reconcile,
    readOwnedTabIds,
    dnrAvailable
  });
})();
