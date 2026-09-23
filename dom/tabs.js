"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before dom/tabs.js");

  // Pet-page tabs are jQuery UI tabs (docs/dom-audit-2026-09-17.md #6b). The label
  // lives in the tab's span and the route hash does not change when switching tabs.
  function findTab(name, root = document) {
    return [...root.querySelectorAll('ul[role="tablist"] > li[role="tab"]')]
      .find(li => li.querySelector(":scope > a span")?.textContent.trim() === name) || null;
  }

  function isTabActive(tab) {
    return Boolean(tab?.classList?.contains("ui-tabs-active") || tab?.getAttribute?.("aria-selected") === "true");
  }

  OWEH.dom = OWEH.dom || {};
  OWEH.dom.tabs = Object.freeze({ findTab, isTabActive });
})();
