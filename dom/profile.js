"use strict";

(() => {
  if (!globalThis.OWEH?.dom?.routes) throw new Error("dom/routes.js must load before dom/profile.js");

  const { currentPetId } = OWEH.dom.routes;
  const PROFILE_TURN_SELECTOR = 'button[onclick*="pet_turn_egg"]';

  // Confirmed selector (docs/dom-audit-2026-09-17.md #2): Pedigree is lazy-loaded.
  // Scope to fieldset.ancestors so descendants are never counted as ancestors. The
  // observed tree renders breadth-first across three generations.
  function pedigreeAncestorGraph(root = document) {
    const links = [...root.querySelectorAll('section#pedigree fieldset.ancestors a.pet[href*="pet="]')];
    const seen = new Set();
    const nodes = [];
    for (const anchor of links) {
      const id = anchor.getAttribute("href")?.match(/[?&]pet=(\d+)/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const position = nodes.length;
      const generation = position < 2 ? 1 : (position < 6 ? 2 : 3);
      nodes.push({
        id,
        generation,
        relation: position === 0 ? "parent-1" : (position === 1 ? "parent-2" : "ancestor"),
        inferred: true
      });
    }
    return nodes;
  }

  function pedigreeAncestorIds(root = document) {
    return pedigreeAncestorGraph(root).map(node => node.id);
  }

  function isPedigreeLoaded(root = document) {
    // The fieldset is the lazy-loaded Pedigree payload. It may legitimately contain no
    // ancestor links (for example a generated/foundation pet), so container presence —
    // not ancestor count — is the verification signal.
    return Boolean(root.querySelector?.("section#pedigree fieldset.ancestors"));
  }

  // Confirmed selector (docs/dom-audit-2026-09-17.md #5): fieldset.colors table,
  // keyed by row id rather than translated/visible label text.
  function readColors(root = document) {
    const table = root.querySelector("fieldset.colors table");
    if (!table) return {};
    const readRow = id => [...(table.querySelector(`tr#${id}`)?.querySelectorAll("td") || [])]
      .slice(1)
      .map(cell => cell.textContent.match(/#[0-9A-F]{6}/i)?.[0]?.toUpperCase())
      .filter(Boolean);
    const colors = {};
    const [body1, body2] = readRow("Body");
    const [scales] = readRow("Scales");
    const [extra1, extra2] = readRow("Extra");
    if (body1) colors.body1 = body1;
    if (body2) colors.body2 = body2;
    if (scales) colors.scales = scales;
    if (extra1) colors.extra1 = extra1;
    if (extra2) colors.extra2 = extra2;
    return colors;
  }

  function readOverviewValue(label, root = document) {
    const rows = [...root.querySelectorAll("section#overview fieldset.overview li")];
    const row = rows.find(item => item.querySelector(".attr")?.textContent.trim() === label);
    return row?.querySelector(".value")?.textContent.trim() || "";
  }

  function readVisibleSpecies(root = document) {
    const main = root.querySelector("main");
    if (!main) return null;
    const speciesLabel = [...main.querySelectorAll("p, li, dt, td")]
      .find(element => element.textContent.trim().replace(/:$/, "") === "Species");
    const sibling = speciesLabel?.nextElementSibling;
    if (sibling?.textContent.trim()) return sibling.textContent.trim();
    return main.innerText.match(/(?:^|\n)Species:?\s*\n?\s*([A-Za-z]+)/i)?.[1] || null;
  }

  function getProfileTurnButton(root = document) {
    return [...root.querySelectorAll(PROFILE_TURN_SELECTOR)]
      .find(element => element.isConnected && !element.disabled && element.offsetParent !== null) || null;
  }

  function readPet(root = document, href = location.href, now = Date.now()) {
    const id = currentPetId();
    const colors = readColors(root);
    if (!id || Object.keys(colors).length < 3) return null;
    const gender = readOverviewValue("Gender", root)
      || root.querySelector('main img[title="Male"], main img[title="Female"]')?.title
      || "";
    const species = readOverviewValue("Species", root) || readVisibleSpecies(root) || "";
    const foodText = readOverviewValue("Food", root);
    const foodPercent = Number(foodText.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
    const name = root.querySelector('main h3 .ui-section-title')?.textContent?.trim()
      || root.querySelector('main a.pet.name')?.textContent?.trim()
      || id;
    const pedigreeVerified = isPedigreeLoaded(root);
    const pedigree = pedigreeVerified ? pedigreeAncestorGraph(root) : [];
    const ancestors = pedigree.map(node => node.id);
    return {
      id, name, gender, species, colors, ancestors, pedigree, pedigreeVerified,
      parentIds: pedigree.filter(node => node.generation === 1).map(node => node.id),
      url: href, updatedAt: now,
      foodPercent: Number.isFinite(foodPercent) ? foodPercent : null,
      foodCheckedAt: Number.isFinite(foodPercent) ? now : null
    };
  }

  OWEH.dom.profile = Object.freeze({
    PROFILE_TURN_SELECTOR,
    getProfileTurnButton,
    pedigreeAncestorGraph,
    pedigreeAncestorIds,
    isPedigreeLoaded,
    readColors,
    readOverviewValue,
    readVisibleSpecies,
    readPet
  });
})();
