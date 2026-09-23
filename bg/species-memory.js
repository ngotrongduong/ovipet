"use strict";

// Serialized writer for Name-the-Species knowledge.
//
// Full Sweep runs up to 15 egg tabs at once and every one of them may learn an answer. Each
// content script used to read the whole owehSpeciesMemory / owehSpeciesStats /
// owehSpeciesAnswerIds object, change it and write it back, so concurrent tabs silently erased
// each other's lessons (a forgotten "wrong" answer is then guessed again). The service worker
// is a single place every tab can reach, so all read-modify-writes of these keys go through
// one promise chain here.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesMemory) return;

  const MEMORY_KEY = "owehSpeciesMemory";
  const STATS_KEY = "owehSpeciesStats";
  const ANSWER_ID_KEY = "owehSpeciesAnswerIds";
  const MAX_MEMORY_KEYS = 900;
  const STAT_FIELDS = ["detected", "learnedAnswers", "manualHandoffs", "manualAlerts", "correct", "wrong"];
  const blankStats = () => Object.fromEntries(STAT_FIELDS.map(field => [field, 0]));

  let chain = Promise.resolve();
  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  async function read(key, fallback) {
    const value = (await chrome.storage.local.get({ [key]: fallback }))[key];
    return value && typeof value === "object" ? value : fallback;
  }

  function pruneMemory(memory) {
    const entries = Object.entries(memory || {});
    if (entries.length <= MAX_MEMORY_KEYS) return memory;
    return Object.fromEntries(entries
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, MAX_MEMORY_KEYS));
  }

  function learnInto(memory, keys, species, correct, image, at) {
    for (const key of keys) {
      const previous = memory[key] || {};
      const votes = { ...(previous.votes || {}) };
      const wrong = { ...(previous.wrong || {}) };
      if (correct) votes[species] = Number(votes[species] || 0) + 1;
      else wrong[species] = Number(wrong[species] || 0) + 1;
      const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const totalVotes = Object.values(votes).reduce((sum, value) => sum + Number(value || 0), 0);
      memory[key] = {
        species: winner?.[0] || previous.species || null,
        votes,
        wrong,
        hits: totalVotes,
        confidence: winner && totalVotes ? Number(winner[1]) / totalVotes : Number(previous.confidence || 0),
        image: previous.image || image || null,
        updatedAt: at
      };
    }
    return memory;
  }

  function addStats(stats, patch, at) {
    for (const [field, amount] of Object.entries(patch || {})) {
      if (!STAT_FIELDS.includes(field)) continue;
      stats[field] = Number(stats[field] || 0) + Number(amount || 0);
    }
    stats.lastAt = at;
    return stats;
  }

  // One learned outcome: memory under every key of the question, plus the correct/wrong counter.
  function learn(message) {
    const keys = [...new Set((Array.isArray(message?.keys) ? message.keys : []).map(String).filter(Boolean))];
    const species = String(message?.species || "").trim();
    if (!keys.length || !species) return Promise.resolve({ ok: false, reason: "invalid-outcome" });
    const correct = Boolean(message.correct);
    const image = typeof message.image === "string" && message.image.startsWith("data:image/") ? message.image : null;
    return serialized(async () => {
      const at = Date.now();
      const memory = pruneMemory(learnInto(await read(MEMORY_KEY, {}), keys, species, correct, image, at));
      const stats = addStats({ ...blankStats(), ...(await read(STATS_KEY, {})) }, correct ? { correct: 1 } : { wrong: 1 }, at);
      await chrome.storage.local.set({ [MEMORY_KEY]: memory, [STATS_KEY]: stats });
      return { ok: true, stats };
    });
  }

  function bumpStats(message) {
    return serialized(async () => {
      const stats = addStats({ ...blankStats(), ...(await read(STATS_KEY, {})) }, message?.patch, Date.now());
      await chrome.storage.local.set({ [STATS_KEY]: stats });
      return { ok: true, stats };
    });
  }

  function mergeAnswerIds(message) {
    const useful = (Array.isArray(message?.options) ? message.options : [])
      .filter(option => option?.text && option.answerId != null);
    if (!useful.length) return Promise.resolve({ ok: true, changed: 0 });
    return serialized(async () => {
      const map = await read(ANSWER_ID_KEY, {});
      const at = Date.now();
      for (const option of useful) {
        const species = String(option.text).trim();
        const id = String(option.answerId);
        const previous = map[species] || { ids: {}, preferred: null, updatedAt: 0 };
        const ids = { ...(previous.ids || {}) };
        ids[id] = Number(ids[id] || 0) + 1;
        const preferred = Object.entries(ids).sort((a, b) => b[1] - a[1])[0]?.[0] || id;
        map[species] = { ids, preferred, updatedAt: at };
      }
      await chrome.storage.local.set({ [ANSWER_ID_KEY]: map });
      return { ok: true, changed: useful.length };
    });
  }

  OWEH_BG.speciesMemory = Object.freeze({ learn, bumpStats, mergeAnswerIds, learnInto, addStats, pruneMemory });
})();
