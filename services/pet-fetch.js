"use strict";

// Command-first reads (v5.5.0): fetches the same JSONP panels the OviPets SPA loads
// (`/?src=...&!=cb`) and parses them with OWEH.dom.markup, so the database jobs refresh the
// catalog, profiles and pedigrees without navigating (or even owning) a tab. Nothing here
// mutates the game: writes stay in core/game-actions.js. content.js composes it once.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/pet-fetch.js");

  const PANEL_TIMEOUT_MS = 15000;
  const OVERVIEW_PATH = "/?src=pets&sub=overview";
  const HATCHERY_PATH = "/?src=pets&sub=hatchery";

  const profilePath = (id, usr) => `/?src=pets&sub=profile&usr=${/^\d+$/.test(String(usr || "")) ? usr : 0}&pet=${id}`;
  const pedigreePath = id => `/?src=pets&sub=profile&sec=pedigree&pet=${id}`;
  const breedingPath = (id, enclosureId, usr) => `/?src=pets&sub=profile&sec=breeding&usr=${/^\d+$/.test(String(usr || "")) ? usr : 0}&pet=${id}&enclosure=${enclosureId}`;

  function createPetFetch(deps) {
    const {
      storageGet, storageSet, runtimeRequest, sleep, markup, fingerprint,
      fetchImpl = (...args) => globalThis.fetch(...args),
      timeoutMs = PANEL_TIMEOUT_MS,
      pauseMs = 150
    } = deps;

    async function fetchPanel(path, { retries = 1 } = {}) {
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const separator = path.includes("?") ? "&" : "?";
          const response = await fetchImpl(`${path}${separator}!=cb&_=${Date.now()}`, {
            credentials: "include",
            signal: controller?.signal
          });
          if (!response.ok) throw new Error(`panel-http-${response.status}`);
          return markup.unwrapCb(await response.text());
        } catch (error) {
          lastError = error;
          if (attempt < retries) await sleep(500);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      throw lastError || new Error("panel-fetch-failed");
    }

    function ownUserIdFrom(overview, tabs) {
      return overview.match(/\bid\s*=\s*['"]src_pets['"]\s+usr\s*=\s*['"](\d+)['"]/)?.[1]
        || tabs.map(tab => tab.panel.match(/[?&]usr=(\d+)/)?.[1]).find(Boolean)
        || null;
    }

    // Same storage contract as services/overview-catalog.js collectAllOverviewPets: one
    // snapshot per enclosure, a partial scan only adds to what the last full scan knew, and
    // an empty scan changes nothing.
    //
    // v5.6.1: `skipTab(tab)` marks an enclosure that is never fetched (Males discard). Its id is
    // still recorded (moves need it) and its last snapshot is carried forward unread, so its
    // pets stay known instead of being reported gone.
    async function collectCatalog({ isCancelled = () => false, onProgress = () => {}, skipTab = () => false } = {}) {
      const [previousSnapshots, previousEnclosureIds] = await Promise.all([
        storageGet("owehEnclosureSnapshots", {}),
        storageGet("owehEnclosureIds", {})
      ]);
      const overview = await fetchPanel(OVERVIEW_PATH);
      const tabs = markup.parseEnclosureTabs(overview);
      const ownUserId = ownUserIdFrom(overview, tabs);
      const found = new Map();
      const enclosureIds = {};
      const nextSnapshots = {};
      let skipped = 0;
      let reused = 0;
      let partial = tabs.length < Object.keys(previousEnclosureIds || {}).length;
      for (let index = 0; index < tabs.length; index += 1) {
        if (isCancelled()) return { catalog: [], partial: true, ownUserId, cancelled: true };
        const tab = tabs[index];
        onProgress(index, tabs.length, tab);
        if (skipTab(tab)) {
          enclosureIds[tab.label] = tab.id;
          const previous = previousSnapshots[tab.id];
          if (previous) {
            nextSnapshots[tab.id] = previous;
            (previous.records || []).forEach(pet => found.set(pet.id, { ...pet, enclosure: tab.label, enclosureId: tab.id }));
          }
          continue;
        }
        let pets;
        try {
          const panel = tab.panel.startsWith("/") ? tab.panel : `/${tab.panel}`;
          pets = markup.parseEnclosurePets(await fetchPanel(panel), { id: tab.id, label: tab.label });
        } catch {
          partial = true;
          skipped += 1;
          continue;
        }
        enclosureIds[tab.label] = tab.id;
        const signature = pets
          .map(pet => `${pet.id}:${pet.modified || ""}:${Number(pet.onCooldown)}:${pet.name}`)
          .sort().join("|") || "__empty__";
        const print = fingerprint(signature);
        const previous = previousSnapshots[tab.id];
        if (previous?.fingerprint === print) reused += 1;
        pets.forEach(pet => found.set(pet.id, pet));
        nextSnapshots[tab.id] = {
          fingerprint: print, enclosure: tab.label, enclosureId: tab.id,
          count: pets.length, records: pets, scannedAt: Date.now()
        };
        if (index < tabs.length - 1) await sleep(pauseMs);
      }
      if (!found.size) return { catalog: [], partial: true, ownUserId };
      const scanned = tabs.length - skipped;
      await storageSet({
        owehEnclosureIds: partial ? { ...previousEnclosureIds, ...enclosureIds } : enclosureIds,
        owehEnclosureSnapshots: partial ? { ...previousSnapshots, ...nextSnapshots } : nextSnapshots,
        owehEnclosureScanStats: { scanned, skipped, reused, changed: scanned - reused, partial, at: Date.now(), source: "fetch" }
      });
      const catalog = [...found.values()];
      await runtimeRequest({ type: "reconcileBreedCommands", catalog });
      return { catalog, partial, ownUserId };
    }

    // Profile + pedigree in parallel. A failed pedigree read is reported as unverified rather
    // than failing the pet, exactly like a navigated profile whose Pedigree tab never loaded.
    async function readPet(id, usr = null) {
      const [profileResult, pedigreeResult] = await Promise.allSettled([
        fetchPanel(profilePath(id, usr)),
        fetchPanel(pedigreePath(id))
      ]);
      if (profileResult.status !== "fulfilled") {
        return { ok: false, reason: `profile:${profileResult.reason?.message || "fetch"}` };
      }
      const profile = markup.parseProfile(profileResult.value);
      if (!profile) return { ok: false, reason: "missing-profile" };
      const pedigree = pedigreeResult.status === "fulfilled"
        ? markup.parsePedigree(pedigreeResult.value)
        : { verified: false, nodes: [] };
      const url = `https://ovipets.com/#!/?src=pets&sub=profile&usr=${usr || 0}&pet=${id}`;
      const record = markup.petRecord({ id, profile, pedigree, url });
      if (!record) return { ok: false, reason: "missing-colors", profile, pedigree };
      return { ok: true, profile, pedigree, record };
    }

    async function readHatchery() {
      return markup.parseHatchery(await fetchPanel(HATCHERY_PATH));
    }

    // v5.5.2: the partners OviPets offers for `id` in one enclosure — the game's own
    // relatedness/cooldown filter, read-only. Throws on a failed fetch so callers fail closed.
    async function readBreedingPartners(id, enclosureId, usr = null) {
      return markup.parseBreedingPartners(await fetchPanel(breedingPath(id, enclosureId, usr)), id);
    }

    return Object.freeze({ fetchPanel, collectCatalog, readPet, readHatchery, readBreedingPartners, mergePetRecord });
  }

  // A fresh read never downgrades a verified pedigree to an unverified one (the pedigree
  // panel may simply have failed this time); everything else comes from the fresh record.
  function mergePetRecord(previous, record) {
    const merged = { ...(previous || {}), ...record };
    // Generated is permanent; a read that missed the wand icon never clears it.
    if (previous?.generated === true) merged.generated = true;
    if (record.pedigreeVerified !== true && previous?.pedigreeVerified === true) {
      merged.pedigreeVerified = true;
      merged.ancestors = [...(previous.ancestors || [])];
      merged.pedigree = [...(previous.pedigree || [])];
      merged.parentIds = [...(previous.parentIds || [])];
    }
    return merged;
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.petFetch = Object.freeze({ createPetFetch, mergePetRecord, profilePath, pedigreePath, breedingPath });
})();
