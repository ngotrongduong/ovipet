"use strict";

// Best eggs (2026-10-05): marks the eggs in the own Hatchery whose colours are closest to the
// pure target (domain/egg-rank.js). Read-only towards the game: it reads the Hatchery egg list
// and egg profiles, never sends a command and never writes a pet record.
//
// Colours come from the pet database where the newborn pass already saved them, then from this
// feature's own small cache (owehEggColors), and only the eggs still unknown are fetched
// (profile only, a few at a time). The result (owehBestEggs) is shown as a list in the panel
// and, on the own Hatchery page, as a mark on each egg card that is put back whenever OviPets
// redraws the page.
OWEH.register("feature-best-eggs", helpers => {
  const { storageGet, storageSet, getPetsByIds, setStatus, routes, domain, petFetch } = helpers;
  const { colors } = domain;
  const eggRank = domain.eggRank || globalThis.OWEH?.domain?.eggRank;
  if (!eggRank?.rankEggs) throw new Error("feature-best-eggs requires domain.eggRank");
  const READ_CONCURRENCY = 5;
  const PROGRESS_EVERY = 20;
  const CARD_SELECTOR = 'main a.pet[href*="pet="]';
  let scanning = false;
  let result = null;

  const keyOf = pet => colors.TARGET_KEYS.every(key => pet?.colors?.[key])
    ? colors.TARGET_KEYS.map(key => String(pet.colors[key]).replace("#", "").toUpperCase()).join("-")
    : null;
  const colorsOf = key => Object.fromEntries(String(key || "").split("-")
    .map((hex, index) => [colors.TARGET_KEYS[index], `#${hex}`]));
  const points = egg => (Math.round(Number(egg.score || 0) * 10) / 10).toFixed(1);
  const describe = egg => `#${egg.rank} of the best eggs · ${points(egg)} of ${eggRank.MAX_SCORE} points · ${egg.exactChannels}/15 channels exact · ${egg.key.replace(/-/g, " · ")}`;

  async function highlight() {
    if (scanning) return;
    scanning = true;
    try {
      setStatus("Best eggs: reading the Hatchery...");
      let hatchery;
      try {
        hatchery = await petFetch.readHatchery();
      } catch (error) {
        setStatus(`Best eggs: could not read the Hatchery (${error?.message || error})`);
        return;
      }
      const eggIds = (hatchery.eggIds || []).map(String);
      if (hatchery.hatcherySeen !== true) {
        setStatus("Best eggs: the Hatchery could not be read — try again");
        return;
      }
      if (!eggIds.length) {
        setStatus("Best eggs: there are no eggs in your Hatchery");
        return;
      }
      const [records, cache, ownUserId, storedCount] = await Promise.all([
        getPetsByIds(eggIds),
        storageGet("owehEggColors", {}),
        storageGet("owehOwnUserId", null),
        storageGet("owehBestEggCount", eggRank.DEFAULT_COUNT)
      ]);
      const keys = {};
      const unknown = [];
      for (const id of eggIds) {
        const key = keyOf(records?.[id]) || (typeof cache?.[id] === "string" ? cache[id] : null);
        if (key) keys[id] = key;
        else unknown.push(id);
      }
      let cursor = 0;
      let done = 0;
      const worker = async () => {
        while (cursor < unknown.length) {
          const id = unknown[cursor];
          cursor += 1;
          const read = await petFetch.readPet(id, ownUserId, { skipPedigree: true }).catch(() => null);
          const key = read?.ok ? keyOf(read.record) : null;
          if (key) keys[id] = key;
          done += 1;
          if (done % PROGRESS_EVERY === 0) setStatus(`Best eggs: reading egg colours ${done}/${unknown.length}...`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, unknown.length) }, worker));

      const ranking = eggRank.rankEggs(
        eggIds.filter(id => keys[id]).map(id => ({ id, colors: colorsOf(keys[id]) })),
        { ...colors.STRICT_PURE_TARGET },
        storedCount
      );
      result = {
        at: Date.now(),
        eggs: eggIds.length,
        scored: ranking.scored,
        unread: eggIds.length - ranking.scored,
        best: ranking.best.map(egg => ({
          id: egg.id, rank: egg.rank, key: keys[egg.id], score: egg.score,
          exactChannels: egg.exactChannels, distance: egg.distance
        }))
      };
      // The cache holds only the eggs still in the Hatchery, so it cannot grow without bound.
      await storageSet({ owehEggColors: keys, owehBestEggs: result });
      apply();
      const weights = Object.values(eggRank.SLOT_WEIGHTS).join("/");
      setStatus(`Best eggs: marked the ${result.best.length} best of ${result.scored} egg(s) — Body 1, Body 2, Scales, Extra 1, Extra 2 weighted ${weights}`
        + (unknown.length ? ` · ${unknown.length - result.unread} newly read` : "")
        + (result.unread ? ` · ${result.unread} could not be read` : "")
        + (routes.isOwnHatchery() ? "" : " · open your Hatchery to see them marked"));
    } finally {
      scanning = false;
    }
  }

  async function clear() {
    result = null;
    await storageSet({ owehBestEggs: null });
    apply();
    setStatus("Best eggs: marks cleared");
  }

  function cardFor(id) {
    for (const anchor of document.querySelectorAll(`main a.pet[href*="pet=${id}"]`)) {
      if (anchor.getAttribute("href")?.match(/[?&]pet=(\d+)/)?.[1] === id) return anchor.closest("li") || anchor.parentElement;
    }
    return null;
  }

  // Marks on the game's own egg cards. Every write is guarded, because this runs again on each
  // page update: a card already marked correctly is left untouched.
  function markCards() {
    const wanted = new Map(routes.isOwnHatchery() ? (result?.best || []).map(egg => [String(egg.id), egg]) : []);
    for (const badge of document.querySelectorAll(".oweh-egg-rank")) {
      const egg = wanted.get(badge.dataset.eggId);
      if (egg && badge.textContent === `#${egg.rank}`) continue;
      if (badge.parentElement?.dataset.owehBestEgg) delete badge.parentElement.dataset.owehBestEgg;
      badge.remove();
    }
    if (!wanted.size || !document.querySelector(CARD_SELECTOR)) return;
    for (const egg of wanted.values()) {
      const card = cardFor(String(egg.id));
      if (!card || card.querySelector(".oweh-egg-rank")) continue;
      const badge = document.createElement("span");
      badge.className = "oweh-egg-rank";
      badge.dataset.owehUi = "1";
      badge.dataset.eggId = String(egg.id);
      badge.textContent = `#${egg.rank}`;
      badge.title = describe(egg);
      card.dataset.owehBestEgg = String(egg.rank);
      card.appendChild(badge);
    }
  }

  // The same result as a short list in the panel, so it is readable from any page.
  function renderList() {
    const box = document.querySelector("#oweh-best-eggs-list");
    if (!box) return;
    const best = result?.best || [];
    const signature = JSON.stringify([result?.at || 0, best.map(egg => [egg.id, egg.rank])]);
    if (box.dataset.signature === signature) return;
    box.dataset.signature = signature;
    box.replaceChildren(...best.map(egg => {
      const line = document.createElement("a");
      line.className = "oweh-best-egg-line";
      line.href = `#!/?src=pets&sub=profile&pet=${egg.id}`;
      line.title = describe(egg);
      const rank = document.createElement("b");
      rank.textContent = `#${egg.rank}`;
      line.append(rank);
      for (const hex of egg.key.split("-")) {
        const swatch = document.createElement("span");
        swatch.className = "oweh-swatch";
        swatch.style.background = `#${hex}`;
        line.append(swatch);
      }
      const text = document.createElement("span");
      text.textContent = `${egg.key.split("-")[0]} · ${points(egg)} pts · ${egg.exactChannels} exact`;
      line.append(text);
      return line;
    }));
  }

  function apply() {
    renderList();
    markCards();
  }

  storageGet("owehBestEggs", null).then(stored => {
    if (stored && !result) result = stored;
    apply();
  }).catch(() => {});

  return {
    api: { highlight, clear, apply },
    onRefresh: apply,
    buttons: {
      "#oweh-best-eggs": { label: "Finding the best eggs", handler: highlight },
      "#oweh-best-eggs-clear": { label: "Clearing best-egg marks", handler: clear }
    }
  };
});
