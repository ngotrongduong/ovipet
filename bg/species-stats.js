"use strict";

// Production Name-the-Species statistics + compact wrong-only review queue.
// Normal quiz sessions are not retained. Only explicit OviPets rejections are saved.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesStats) return;

  const KEY = "owehSpeciesStats";
  const WRONG_KEY = "owehSpeciesWrongCases";
  const MAX_WRONG_CASES = 250;
  const LEGACY_KEYS = Object.freeze([
    "owehSpeciesMemory",
    "owehSpeciesAnswerIds",
    "owehSpeciesShapes",
    "owehSpeciesInspectorV1",
    "owehSpeciesSeedSeen"
  ]);
  let chain = Promise.resolve();

  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  async function read() {
    const stored = (await chrome.storage.local.get({ [KEY]: null }))[KEY] || {};
    return {
      correct: Math.max(0, Number(stored.correct || 0)),
      wrong: Math.max(0, Number(stored.wrong || 0))
    };
  }

  function cleanText(value, max = 300) {
    return String(value || "").trim().slice(0, max);
  }

  function cleanShape(value) {
    const shape = String(value || "").trim().toLowerCase();
    return /^[0-9a-f]{256}$/.test(shape) ? shape : "";
  }

  function cleanOptions(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map(item => cleanText(item, 60)).filter(Boolean))].slice(0, 20);
  }

  function caseIdentity(item = {}) {
    return [
      cleanText(item.eggId, 40),
      cleanText(item.source, 320),
      cleanText(item.wrongSpecies, 80),
      cleanShape(item.shape)
    ].join("|");
  }

  async function readWrongCases() {
    const stored = (await chrome.storage.local.get({ [WRONG_KEY]: [] }))[WRONG_KEY];
    return Array.isArray(stored) ? stored : [];
  }

  function recordWrong(message = {}) {
    return serialized(async () => {
      const input = message.case || message.record || {};
      const wrongSpecies = cleanText(input.wrongSpecies, 80);
      if (!wrongSpecies) return { ok: false, reason: "missing-wrong-species" };

      const now = Math.max(0, Number(input.at || Date.now()));
      const candidate = {
        id: caseIdentity(input),
        firstAt: now,
        lastAt: now,
        count: 1,
        eggId: cleanText(input.eggId, 40),
        source: cleanText(input.source, 320),
        shape: cleanShape(input.shape),
        options: cleanOptions(input.options),
        wrongSpecies,
        method: cleanText(input.method, 60),
        distance: Number.isFinite(Number(input.distance)) ? Number(input.distance) : null,
        correctSpecies: "",
        resolvedAt: 0
      };

      let cases = await readWrongCases();
      const existingIndex = cases.findIndex(item => String(item?.id || "") === candidate.id);
      if (existingIndex >= 0) {
        const previous = cases[existingIndex] || {};
        candidate.firstAt = Number(previous.firstAt || now);
        candidate.count = Math.max(1, Number(previous.count || 1)) + 1;
        candidate.correctSpecies = cleanText(previous.correctSpecies, 80);
        candidate.resolvedAt = Number(previous.resolvedAt || 0);
        candidate.shape ||= cleanShape(previous.shape);
        candidate.source ||= cleanText(previous.source, 320);
        candidate.options = candidate.options.length ? candidate.options : cleanOptions(previous.options);
        cases.splice(existingIndex, 1);
      }
      cases.unshift(candidate);
      cases = cases.slice(0, MAX_WRONG_CASES);
      await chrome.storage.local.set({ [WRONG_KEY]: cases });
      return { ok: true, count: cases.length, record: candidate };
    });
  }

  function resolveWrong(message = {}) {
    return serialized(async () => {
      const input = message.case || message.record || {};
      const eggId = cleanText(input.eggId, 40);
      const source = cleanText(input.source, 320);
      const correctSpecies = cleanText(input.correctSpecies, 80);
      if (!correctSpecies || (!eggId && !source)) return { ok: false, reason: "missing-resolution-key" };

      const now = Math.max(0, Number(input.at || Date.now()));
      const cases = await readWrongCases();
      let updated = 0;
      for (const item of cases) {
        const sameEgg = eggId && String(item?.eggId || "") === eggId;
        const sameSource = source && String(item?.source || "") === source;
        if (!(sameEgg || sameSource) || item.correctSpecies) continue;
        item.correctSpecies = correctSpecies;
        item.resolvedAt = now;
        item.lastAt = Math.max(Number(item.lastAt || 0), now);
        updated += 1;
      }
      if (updated) await chrome.storage.local.set({ [WRONG_KEY]: cases });
      return { ok: true, updated, count: cases.length };
    });
  }

  function clearWrongCases() {
    return serialized(async () => {
      await chrome.storage.local.set({ [WRONG_KEY]: [] });
      return { ok: true };
    });
  }

  function bump(message = {}) {
    return serialized(async () => {
      const current = await read();
      const patch = message.patch || {};
      const stats = {
        correct: current.correct + Math.max(0, Number(patch.correct || 0)),
        wrong: current.wrong + Math.max(0, Number(patch.wrong || 0))
      };
      await chrome.storage.local.set({ [KEY]: stats });
      try { await chrome.storage.local.remove?.(LEGACY_KEYS); } catch {}
      return { ok: true, stats };
    });
  }

  OWEH_BG.speciesStats = Object.freeze({
    read,
    bump,
    readWrongCases,
    recordWrong,
    resolveWrong,
    clearWrongCases,
    WRONG_KEY,
    MAX_WRONG_CASES,
    LEGACY_KEYS
  });
})();
