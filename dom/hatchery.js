"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before dom/hatchery.js");

  const HATCHERY_TURN_SELECTOR = 'img[title="Turn Egg"]';
  const HATCHERY_HATCH_SELECTOR = 'img[title="Hatch Egg"]';

  function getHatcheryEggCount(root = document) {
    const ids = new Set([...root.querySelectorAll('input[name="PetID[]"]')]
      .map(input => input.value).filter(Boolean));
    if (ids.size) return ids.size;
    return new Set([...root.querySelectorAll('a.pet[href*="pet="]')]
      .map(anchor => anchor.getAttribute("href")?.match(/[?&]pet=(\d+)/)?.[1])
      .filter(Boolean)).size;
  }

  function getHatcheryEggs(root = document) {
    const seen = new Set();
    return [...root.querySelectorAll(HATCHERY_TURN_SELECTOR)].map(turnIcon => {
      const card = turnIcon.closest("li") || turnIcon.parentElement?.parentElement;
      const anchor = card?.querySelector('a.pet[href*="pet="]');
      const href = anchor?.getAttribute("href") || "";
      const id = href.match(/[?&]pet=(\d+)/)?.[1];
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return { id, href };
    }).filter(Boolean);
  }

  function getHatcheryHatchableEggs(root = document) {
    const seen = new Set();
    return [...root.querySelectorAll(HATCHERY_HATCH_SELECTOR)].map(hatchIcon => {
      const card = hatchIcon.closest("li") || hatchIcon.parentElement?.parentElement;
      const anchor = card?.querySelector('a.pet[href*="pet="]');
      const href = anchor?.getAttribute("href") || "";
      const id = href.match(/[?&]pet=(\d+)/)?.[1];
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return { id, href };
    }).filter(Boolean);
  }

  function getHatcheryPetCards(root = document) {
    const found = new Map();
    for (const anchor of root.querySelectorAll('main a.pet[href*="pet="]')) {
      const href = anchor.getAttribute("href") || "";
      const id = href.match(/[?&]pet=(\d+)/)?.[1];
      if (!id || found.has(id)) continue;
      const card = anchor.closest("li") || anchor.parentElement;
      const image = card?.querySelector('a.pet img[src*="/img/pet/"]');
      const renderedSize = Number(image?.getAttribute("width") || image?.getAttribute("height") || 0);
      const sourceSize = Number(image?.getAttribute("src")?.match(/[?&]size=(\d+)/)?.[1] || 0);
      const modified = image?.getAttribute("src")?.match(/[?&]modified=(\d+)/)?.[1] || null;
      const usr = href.match(/[?&]usr=(\d+)/)?.[1] || null;
      const name = card?.querySelector("a.pet.name")?.textContent?.trim() || id;
      found.set(id, {
        id,
        href,
        usr,
        modified,
        name,
        turnable: Boolean(card?.querySelector(HATCHERY_TURN_SELECTOR)),
        hatchable: Boolean(card?.querySelector(HATCHERY_HATCH_SELECTOR)),
        // Confirmed live on 2026-09-18: eggs render at size=80; newly hatched pets at
        // size=120. Gender/Colors are still verified on the profile before any action.
        likelyHatched: Math.max(renderedSize, sourceSize) >= 120 || /^Unnamed$/i.test(name),
        unnamed: /^Unnamed$/i.test(name)
      });
    }
    return [...found.values()];
  }

  OWEH.dom = OWEH.dom || {};
  OWEH.dom.hatchery = Object.freeze({
    HATCHERY_TURN_SELECTOR,
    HATCHERY_HATCH_SELECTOR,
    getHatcheryEggCount,
    getHatcheryEggs,
    getHatcheryHatchableEggs,
    getHatcheryPetCards
  });
})();
