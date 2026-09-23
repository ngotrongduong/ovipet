"use strict";

(() => {
  if (!globalThis.OWEH?.dom?.tabs) throw new Error("dom/tabs.js must load before dom/overview.js");

  const { isTabActive } = OWEH.dom.tabs;

  function overviewEnclosureTabs(root = document) {
    return [...root.querySelectorAll('main ul[role="tablist"] > li[role="tab"][enclosure]')];
  }

  // Confirmed selector (docs/dom-audit-2026-09-17.md #6a).
  function overviewCards(root = document) {
    const activeEnclosure = overviewEnclosureTabs(root).find(isTabActive);
    const panelId = activeEnclosure?.getAttribute("aria-controls");
    const panel = panelId ? root.getElementById(panelId) : root;
    return [...panel.querySelectorAll('input[name="PetID[]"]')]
      .map(input => input.closest("li"))
      .filter(Boolean);
  }

  function overviewCardInfo(card) {
    const link = [...card.querySelectorAll('a.pet[href*="pet="]')].find(anchor => !anchor.classList.contains("name"))
      || card.querySelector('a.pet[href*="pet="]');
    const href = link?.getAttribute("href") || "";
    const id = href.match(/[?&]pet=(\d+)/)?.[1];
    if (!id) return null;
    const usr = href.match(/[?&]usr=(\d+)/)?.[1] || null;
    const name = card.querySelector("a.pet.name")?.textContent?.trim() || id;
    const onCooldown = Boolean(card.querySelector('img[src*="/heart_iceblue.png"]'));
    const imageUrl = card.querySelector('a.pet img[src*="/img/pet/"]')?.getAttribute("src") || "";
    const modified = imageUrl.match(/[?&]modified=(\d+)/)?.[1] || null;
    return { id, usr, name, onCooldown, modified };
  }

  function isOverviewBusy(root = document) {
    return [...root.querySelectorAll('main [class*="load"], main [aria-busy="true"]')]
      .some(element => element.offsetParent !== null);
  }

  function overviewSignature(root = document) {
    const parts = overviewCards(root).map(card => {
      const info = overviewCardInfo(card);
      return info ? `${info.id}:${info.modified || ""}:${Number(info.onCooldown)}:${info.name}` : "";
    }).filter(Boolean).sort();
    if (parts.length) return parts.join("|");
    return isOverviewBusy(root) ? "" : "__empty__";
  }

  function overviewEnclosureForPet(petId, root = document) {
    const input = root.querySelector(`main input[name="PetID[]"][value="${String(petId)}"]`);
    const panel = input?.closest('[role="tabpanel"], .ui-tabs-panel');
    if (!panel?.id) return null;
    return overviewEnclosureTabs(root)
      .find(tab => tab.getAttribute("aria-controls") === panel.id)?.textContent.trim() || null;
  }

  OWEH.dom.overview = Object.freeze({
    overviewEnclosureTabs,
    overviewCards,
    overviewCardInfo,
    isOverviewBusy,
    overviewSignature,
    overviewEnclosureForPet
  });
})();
