"use strict";

// Name-the-Species: silhouettes learned after the build, and the safety pause.
//
// The built-in library (data/species-static.js) is thin for the species the quiz gained in
// 2026-10. A silhouette the game itself confirmed (the turn went through) or the owner labelled
// on the review page is kept here, one storage key per species, and the answerer reads it next
// to the built-in library. Only color-independent 32x32 alpha masks are stored, as in the
// built-in file: no ids, thumbnails or traces.
//
// The pause: more than `perHour` wrong automatic answers inside one hour, or `streak` in a row,
// stops automatic answering until the owner presses Resume.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesLearned) return;

  const PREFIX = "owehSpeciesLearned_";
  const INDEX_KEY = "owehSpeciesLearnedIndex";
  const GUARD_KEY = "owehSpeciesGuard";
  const LIMITS_KEY = "owehSpeciesGuardLimits";
  const DEFAULT_LIMITS = Object.freeze({ streak: 3, perHour: 10 });
  const HOUR_MS = 60 * 60 * 1000;
  const SPECIES_NAME = /^[A-Za-z][A-Za-z -]{1,30}$/;
  const REVIEW_PAGE = "review/species-review.html";
  let chain = Promise.resolve();

  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  const shapeApi = () => globalThis.OWEH_SPECIES_SHAPE;

  function cleanSpecies(value) {
    const name = String(value || "").trim();
    return SPECIES_NAME.test(name) ? name : "";
  }

  function cleanShape(value) {
    const shape = String(value || "").trim().toLowerCase();
    return shapeApi()?.validShape(shape) ? shape : "";
  }

  function cleanRecord(stored) {
    const examples = Array.isArray(stored?.examples) ? stored.examples.filter(shape => shapeApi().validShape(shape)) : [];
    return { examples, updatedAt: Math.max(0, Number(stored?.updatedAt || 0)) };
  }

  async function readSpecies(species) {
    const key = PREFIX + species;
    return cleanRecord((await chrome.storage.local.get({ [key]: null }))[key]);
  }

  // { species: number of learned silhouettes }
  async function readIndex() {
    const stored = (await chrome.storage.local.get({ [INDEX_KEY]: null }))[INDEX_KEY];
    const index = {};
    for (const [species, count] of Object.entries(stored && typeof stored === "object" ? stored : {})) {
      if (cleanSpecies(species) && Number(count) > 0) index[species] = Math.floor(Number(count));
    }
    return index;
  }

  async function readAll() {
    const names = Object.keys(await readIndex()).sort();
    if (!names.length) return {};
    const stored = await chrome.storage.local.get(Object.fromEntries(names.map(species => [PREFIX + species, null])));
    const library = {};
    for (const species of names) {
      const record = cleanRecord(stored[PREFIX + species]);
      if (record.examples.length) library[species] = record;
    }
    return library;
  }

  // Near-duplicates are skipped and a full species drops its most redundant silhouette
  // (species-shape.addExample), so repeated quizzes of a common outline cost nothing.
  function learn(message = {}) {
    return serialized(async () => {
      const species = cleanSpecies(message.species);
      const shape = cleanShape(message.shape);
      if (!species || !shape) return { ok: false, reason: "invalid-example" };
      const record = await readSpecies(species);
      const library = { [species]: record };
      const { added } = shapeApi().addExample(library, species, shape, Date.now());
      if (!added) return { ok: true, added: false, count: record.examples.length };
      const index = await readIndex();
      index[species] = library[species].examples.length;
      await chrome.storage.local.set({ [PREFIX + species]: library[species], [INDEX_KEY]: index });
      return { ok: true, added: true, count: index[species] };
    });
  }

  // Takes back one exact silhouette (the owner changed or removed a label). With `refuted`, the
  // game has just rejected that species for this image, so every learned near-duplicate of it
  // under that species goes too: a wrong label can not keep producing the same wrong answer.
  function forget(message = {}) {
    return serialized(async () => {
      const species = cleanSpecies(message.species);
      const shape = cleanShape(message.shape);
      if (!species || !shape) return { ok: false, reason: "invalid-example" };
      const record = await readSpecies(species);
      const { hamming, DEDUPE_DISTANCE } = shapeApi();
      const examples = record.examples.filter(example => message.refuted
        ? hamming(example, shape) > DEDUPE_DISTANCE
        : example !== shape);
      const removed = record.examples.length - examples.length;
      if (!removed) return { ok: true, removed: 0, count: examples.length };
      const index = await readIndex();
      if (examples.length) index[species] = examples.length;
      else delete index[species];
      await chrome.storage.local.set({ [PREFIX + species]: { examples, updatedAt: Date.now() }, [INDEX_KEY]: index });
      return { ok: true, removed, count: examples.length };
    });
  }

  // The owner's label for one saved wrong case. The wrong-case store checks it against the
  // game's own verdicts on that image; the silhouette moves from the previous label to the new.
  // One label at a time: the steps span this module's chain and the wrong-case store's, and two
  // overlapping requests (a double click) would otherwise lose track of which mask was added.
  let labelChain = Promise.resolve();
  function labelCase(message = {}) {
    const run = labelChain.then(() => applyLabel(message));
    labelChain = run.catch(() => {});
    return run;
  }

  async function applyLabel(message) {
    const stats = OWEH_BG.speciesStats;
    if (!stats?.checkLabel) return { ok: false, reason: "wrong-case-store-unavailable" };
    const checked = await stats.checkLabel(message);
    if (!checked.ok) return checked;
    const { previous, label } = checked;
    const same = Boolean(previous && label && previous.species === label.species && previous.shape === label.shape);
    if (previous?.added && !same) await forget(previous);
    let added = same ? Boolean(previous.added) : false;
    if (label && !same) added = Boolean((await learn(label)).added);
    const saved = await stats.labelWrong({ ...message, added });
    // The store refused after all (the game resolved the image meanwhile): take the mask back.
    if (!saved.ok && label && added && !same) await forget(label);
    return saved;
  }

  function cleanLimits(value) {
    const limit = (input, fallback) => {
      const number = Math.floor(Number(input));
      return input != null && input !== "" && Number.isFinite(number) && number >= 0 ? Math.min(number, 1000) : fallback;
    };
    return { streak: limit(value?.streak, DEFAULT_LIMITS.streak), perHour: limit(value?.perHour, DEFAULT_LIMITS.perHour) };
  }

  function cleanGuard(value, now) {
    const wrongAt = (Array.isArray(value?.wrongAt) ? value.wrongAt : []).map(Number)
      .filter(at => Number.isFinite(at) && at > now - HOUR_MS && at <= now).slice(-1000);
    const paused = Number(value?.paused?.at) > 0
      ? {
        at: Number(value.paused.at),
        reason: String(value.paused.reason || "").slice(0, 160),
        streak: Math.max(0, Number(value.paused.streak || 0)),
        wrongInHour: Math.max(0, Number(value.paused.wrongInHour || 0))
      }
      : null;
    return { wrongAt, streak: Math.max(0, Math.floor(Number(value?.streak || 0))), paused };
  }

  async function readGuard(now = Date.now()) {
    const stored = await chrome.storage.local.get({ [GUARD_KEY]: null, [LIMITS_KEY]: null });
    return { ...cleanGuard(stored[GUARD_KEY], now), limits: cleanLimits(stored[LIMITS_KEY]) };
  }

  // message.patch is the same { correct, wrong } the totals receive. An answer the owner clicked
  // by hand (auto === false) never counts as wrong here; any correct answer ends the streak.
  function noteAnswers(message = {}, now = Date.now()) {
    return serialized(async () => {
      const guard = await readGuard(now);
      const patch = message.patch || {};
      const correct = Math.max(0, Number(patch.correct || 0));
      const wrong = message.auto === false ? 0 : Math.max(0, Math.floor(Number(patch.wrong || 0)));
      if (!wrong && (!correct || guard.streak === 0)) return { guard, tripped: false };

      let { streak, paused } = guard;
      const wrongAt = [...guard.wrongAt];
      if (correct) streak = 0;
      for (let index = 0; index < wrong; index += 1) {
        wrongAt.push(now);
        streak += 1;
      }
      let tripped = false;
      if (!paused && wrong) {
        const { limits } = guard;
        let reason = "";
        if (limits.streak > 0 && streak >= limits.streak) reason = `${streak} wrong answers in a row`;
        else if (limits.perHour > 0 && wrongAt.length > limits.perHour) reason = `${wrongAt.length} wrong answers within one hour`;
        if (reason) {
          paused = { at: now, reason, streak, wrongInHour: wrongAt.length };
          tripped = true;
        }
      }
      await chrome.storage.local.set({ [GUARD_KEY]: { wrongAt, streak, paused } });
      return { guard: { wrongAt, streak, paused, limits: guard.limits }, tripped };
    });
  }

  // Resume starts a fresh window: the answers that caused the pause must not trip it again.
  function resume() {
    return serialized(async () => {
      const cleared = { wrongAt: [], streak: 0, paused: null };
      await chrome.storage.local.set({ [GUARD_KEY]: cleared });
      return { ok: true, guard: { ...cleared, limits: (await readGuard()).limits } };
    });
  }

  function setLimits(message = {}) {
    return serialized(async () => {
      const limits = cleanLimits(message.limits);
      await chrome.storage.local.set({ [LIMITS_KEY]: limits });
      return { ok: true, guard: await readGuard() };
    });
  }

  async function status() {
    const [guard, learned] = await Promise.all([readGuard(), readIndex()]);
    return { ok: true, guard, learned };
  }

  async function openReview() {
    const url = chrome.runtime.getURL(REVIEW_PAGE);
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const existing = tabs.find(tab => String(tab.url || "").split("#")[0] === url);
    const tab = existing
      ? await chrome.tabs.update(existing.id, { active: true })
      : await chrome.tabs.create({ url, active: true });
    if (Number.isInteger(tab?.windowId)) await chrome.windows?.update(tab.windowId, { focused: true }).catch(() => {});
    return { ok: true, tabId: tab?.id ?? null, reused: Boolean(existing) };
  }

  OWEH_BG.speciesLearned = Object.freeze({
    learn, forget, labelCase, readAll, readIndex,
    readGuard, noteAnswers, resume, setLimits, status, openReview,
    PREFIX, INDEX_KEY, GUARD_KEY, LIMITS_KEY, DEFAULT_LIMITS
  });
})();
