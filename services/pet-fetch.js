"use strict";

// Command-first reads (v5.5.0): fetches the same JSONP panels the OviPets SPA loads
// (`/?src=...&!=cb`) and parses them with OWEH.dom.markup, so the database jobs refresh the
// catalog, profiles and pedigrees without navigating (or even owning) a tab. Nothing here
// mutates the game: writes stay in core/game-actions.js. content.js composes it once.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/pet-fetch.js");

  const PANEL_TIMEOUT_MS = 15000;
  const CATALOG_CONCURRENCY = 2;
  const OVERVIEW_PATH = "/?src=pets&sub=overview";
  const HATCHERY_PATH = "/?src=pets&sub=hatchery";

  const profilePath = (id, usr) => `/?src=pets&sub=profile&usr=${/^\d+$/.test(String(usr || "")) ? usr : 0}&pet=${id}`;
  const pedigreePath = id => `/?src=pets&sub=profile&sec=pedigree&pet=${id}`;
  const breedingPath = (id, enclosureId, usr) => `/?src=pets&sub=profile&sec=breeding&usr=${/^\d+$/.test(String(usr || "")) ? usr : 0}&pet=${id}&enclosure=${enclosureId}`;

  // Snapshots written before v5.8.0 carried every pet record; keep only fingerprint + ids.
  function slimSnapshots(snapshots) {
    const slim = {};
    for (const [key, snapshot] of Object.entries(snapshots || {})) {
      if (!snapshot || typeof snapshot !== "object") continue;
      const { records, ...rest } = snapshot;
      slim[key] = Array.isArray(records) && !Array.isArray(rest.ids)
        ? { ...rest, ids: records.map(pet => pet?.id).filter(Boolean) }
        : rest;
    }
    return slim;
  }

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
    //
    // v5.8.0: a snapshot keeps only the fingerprint and pet ids (the records live in the pet
    // database), and enclosures are read CATALOG_CONCURRENCY at a time.
    async function collectCatalog({ isCancelled = () => false, onProgress = () => {}, skipTab = () => false } = {}) {
      const [storedSnapshots, previousEnclosureIds] = await Promise.all([
        storageGet("owehEnclosureSnapshots", {}),
        storageGet("owehEnclosureIds", {})
      ]);
      const previousSnapshots = slimSnapshots(storedSnapshots);
      const overview = await fetchPanel(OVERVIEW_PATH);
      const tabs = markup.parseEnclosureTabs(overview);
      const ownUserId = ownUserIdFrom(overview, tabs);
      const results = new Array(tabs.length);
      let partial = tabs.length < Object.keys(previousEnclosureIds || {}).length;
      let cancelled = false;
      let cursor = 0;

      async function readTab(index) {
        const tab = tabs[index];
        onProgress(index, tabs.length, tab);
        if (skipTab(tab)) {
          const previous = previousSnapshots[tab.id];
          const pets = (previous?.ids || []).map(id => ({ id, enclosure: tab.label, enclosureId: tab.id }));
          return { tab, skippedTab: true, previous, pets };
        }
        try {
          const panel = tab.panel.startsWith("/") ? tab.panel : `/${tab.panel}`;
          const pets = markup.parseEnclosurePets(await fetchPanel(panel), { id: tab.id, label: tab.label });
          await sleep(pauseMs);
          return { tab, pets };
        } catch {
          return { tab, failed: true, pets: [] };
        }
      }

      const worker = async () => {
        while (cursor < tabs.length) {
          if (isCancelled()) { cancelled = true; return; }
          const index = cursor;
          cursor += 1;
          results[index] = await readTab(index);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CATALOG_CONCURRENCY, tabs.length) }, worker));
      if (cancelled) return { catalog: [], partial: true, ownUserId, cancelled: true };

      const found = new Map();
      const enclosureIds = {};
      const nextSnapshots = {};
      let skipped = 0;
      let reused = 0;
      for (const { tab, pets, failed, skippedTab, previous } of results) {
        if (failed) {
          partial = true;
          skipped += 1;
          continue;
        }
        enclosureIds[tab.label] = tab.id;
        pets.forEach(pet => found.set(pet.id, pet));
        if (skippedTab) {
          if (previous) nextSnapshots[tab.id] = previous;
          continue;
        }
        const signature = pets
          .map(pet => `${pet.id}:${pet.modified || ""}:${Number(pet.onCooldown)}:${pet.name}`)
          .sort().join("|") || "__empty__";
        const print = fingerprint(signature);
        if (previousSnapshots[tab.id]?.fingerprint === print) reused += 1;
        nextSnapshots[tab.id] = {
          fingerprint: print, enclosure: tab.label, enclosureId: tab.id,
          count: pets.length, ids: pets.map(pet => pet.id), scannedAt: Date.now()
        };
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
    //
    // v5.7.0: `skipPedigree` leaves the pedigree panel unread (reported unverified). Only
    // callers that merge through mergePetRecord onto an already-verified record use it — the
    // pedigree of an existing pet never changes, and the merge restores the verified copy.
    async function readPet(id, usr = null, { skipPedigree = false } = {}) {
      const [profileResult, pedigreeResult] = await Promise.allSettled([
        fetchPanel(profilePath(id, usr)),
        skipPedigree ? Promise.reject(new Error("pedigree-skipped")) : fetchPanel(pedigreePath(id))
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

    // v5.7.0: the one "re-read a known pet" path shared by Update database and the breeding
    // planner. Returns the merged record (verified pedigree kept, pedigree panel skipped when
    // already verified) with the bookkeeping fields every database refresh sets.
    async function readAndMerge(cached, usr = null) {
      const read = await readPet(cached.id, usr, { skipPedigree: cached?.pedigreeVerified === true });
      if (!read.ok) return read;
      const { profile, record } = read;
      const pet = mergePetRecord(cached, record);
      Object.assign(pet, {
        onCooldown: cached.onCooldown,
        enclosure: profile.enclosureLabel || cached.enclosure,
        enclosureId: profile.enclosureId || cached.enclosureId,
        catalogModified: cached.catalogModified || cached.modified || null,
        lastProfileScanAt: Date.now(),
        profileStale: false,
        present: true,
        owned: true
      });
      return { ok: true, profile, pet };
    }

    async function readHatchery() {
      return markup.parseHatchery(await fetchPanel(HATCHERY_PATH));
    }

    // v5.5.2: the partners OviPets offers for `id` in one enclosure — the game's own
    // relatedness/cooldown filter, read-only. Throws on a failed fetch so callers fail closed.
    async function readBreedingPartners(id, enclosureId, usr = null) {
      return markup.parseBreedingPartners(await fetchPanel(breedingPath(id, enclosureId, usr)), id);
    }

    return Object.freeze({ fetchPanel, collectCatalog, readPet, readAndMerge, readHatchery, readBreedingPartners, mergePetRecord });
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
