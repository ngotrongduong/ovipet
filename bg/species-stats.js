"use strict";

// Production Name-the-Species statistics.
// Learning data is compiled into data/species-static.js; runtime persistence is deliberately
// limited to two aggregate counters.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesStats) return;

  const KEY = "owehSpeciesStats";
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

  function bump(message = {}) {
    return serialized(async () => {
      const current = await read();
      const patch = message.patch || {};
      const stats = {
        correct: current.correct + Math.max(0, Number(patch.correct || 0)),
        wrong: current.wrong + Math.max(0, Number(patch.wrong || 0))
      };
      // This write intentionally compacts any legacy Species stats object down to these two keys.
      await chrome.storage.local.set({ [KEY]: stats });
      try { await chrome.storage.local.remove?.(LEGACY_KEYS); } catch {}
      return { ok: true, stats };
    });
  }

  OWEH_BG.speciesStats = Object.freeze({ read, bump, LEGACY_KEYS });
})();
