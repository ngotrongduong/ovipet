"use strict";

// Production Name-the-Species statistics + compact wrong-only review queue.
// Normal quiz sessions are not retained. Only explicit OviPets rejections are saved; the owner
// can label them on the review page (review/species-review.html).
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesStats) return;

  const KEY = "owehSpeciesStats";
  const WRONG_KEY = "owehSpeciesWrongCases";
  const MAX_WRONG_CASES = 250;
  // Wrong cases of one egg are the same quiz image when their silhouettes are this close: a
  // retry repeats the image and its six options exactly, a later day asks a new one.
  const SAME_IMAGE_DISTANCE = 20;
  const SPECIES_NAME = /^[A-Za-z][A-Za-z -]{1,30}$/;
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

  // Without the matcher (or without both silhouettes) the egg alone has to do.
  function sameImage(first, second) {
    const hamming = globalThis.OWEH_SPECIES_SHAPE?.hamming;
    const a = cleanShape(first);
    const b = cleanShape(second);
    return !hamming || !a || !b || hamming(a, b) <= SAME_IMAGE_DISTANCE;
  }

  // Every saved case of the quiz image `item` belongs to (the answers rejected for it differ).
  // A case without a silhouette stands alone: nothing shows which image it was.
  function imageGroup(cases, item) {
    const eggId = cleanText(item?.eggId, 40);
    const shape = cleanShape(item?.shape);
    return cases.filter(other => other === item
      || (eggId && shape && cleanShape(other?.shape) && cleanText(other?.eggId, 40) === eggId && sameImage(other.shape, shape)));
  }

  const ownerAnswer = item => item?.ownerLabel && !item.ownerLabel.imageChanged ? cleanText(item.ownerLabel.species, 80) : "";

  function clearOwnerLabel(item) {
    if (item.ownerLabel && !item.ownerLabel.imageChanged) {
      item.correctSpecies = "";
      item.resolvedAt = 0;
    }
    delete item.ownerLabel;
    item.reviewedAt = 0;
  }

  // The game contradicted this case's owner label: drop it, and note once which learned
  // silhouette the caller has to take back.
  function overruleOwnerLabel(item, overruled) {
    const label = item.ownerLabel;
    const entry = { species: cleanText(label.species, 80), shape: cleanShape(label.shape) };
    if (label.added && !overruled.some(other => other.species === entry.species && other.shape === entry.shape)) overruled.push(entry);
    clearOwnerLabel(item);
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
        if (previous.ownerLabel) candidate.ownerLabel = { ...previous.ownerLabel };
        if (previous.reviewedAt) candidate.reviewedAt = Number(previous.reviewedAt);
        candidate.shape ||= cleanShape(previous.shape);
        candidate.source ||= cleanText(previous.source, 320);
        candidate.options = candidate.options.length ? candidate.options : cleanOptions(previous.options);
        cases.splice(existingIndex, 1);
      }

      // The game just rejected `wrongSpecies` for this image: an owner label that says so is
      // wrong and goes, and what is already known about the image carries over to this case.
      const overruled = [];
      const group = imageGroup(cases, candidate).filter(item => item !== candidate);
      for (const item of group) {
        if (ownerAnswer(item) === wrongSpecies) overruleOwnerLabel(item, overruled);
      }
      const known = group.find(item => cleanText(item.correctSpecies, 80) && cleanText(item.correctSpecies, 80) !== wrongSpecies);
      if (known && !candidate.correctSpecies) {
        candidate.correctSpecies = cleanText(known.correctSpecies, 80);
        candidate.resolvedAt = Number(known.resolvedAt || now);
        if (known.ownerLabel) {
          candidate.ownerLabel = { ...known.ownerLabel };
          candidate.reviewedAt = Number(known.reviewedAt || now);
        }
      }

      cases.unshift(candidate);
      cases = cases.slice(0, MAX_WRONG_CASES);
      await chrome.storage.local.set({ [WRONG_KEY]: cases });
      return { ok: true, count: cases.length, record: candidate, overruled };
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
      const overruled = [];
      let updated = 0;
      for (const item of cases) {
        const sameEgg = eggId && String(item?.eggId || "") === eggId;
        const sameSource = source && String(item?.source || "") === source;
        if (!(sameEgg || sameSource) || !sameImage(item?.shape, input.shape)) continue;
        if (cleanText(item.wrongSpecies, 80) === correctSpecies) continue;
        // The game's answer beats an owner label of the same image.
        const labelled = ownerAnswer(item);
        if (item.correctSpecies && !labelled) continue;
        if (labelled === correctSpecies) {
          // The game confirms the owner's label: from now on it is the game's answer, and the
          // image can no longer be relabelled. The learned mask stays.
          delete item.ownerLabel;
          item.resolvedAt = now;
          updated += 1;
          continue;
        }
        if (labelled) overruleOwnerLabel(item, overruled);
        item.correctSpecies = correctSpecies;
        item.resolvedAt = now;
        item.lastAt = Math.max(Number(item.lastAt || 0), now);
        updated += 1;
      }
      if (updated) await chrome.storage.local.set({ [WRONG_KEY]: cases });
      return { ok: true, updated, count: cases.length, overruled };
    });
  }

  // An owner label is checked against what the game itself said about that quiz image: it is
  // one of the six options, never a species the game rejected for it, and an image the game
  // resolved is not relabelled. `imageChanged` means the egg shows a newer question now: the
  // label then describes that newer image (message.shape) and no quiz constrains it.
  // An empty species removes the label.
  function judgeLabel(cases, message) {
    const item = cases.find(entry => String(entry?.id || "") === String(message.id || ""));
    if (!item) return { ok: false, reason: "unknown-case" };
    const group = imageGroup(cases, item);
    const gameAnswer = group.find(entry => entry.correctSpecies && !ownerAnswer(entry))?.correctSpecies || "";
    if (gameAnswer) return { ok: false, reason: "resolved-by-game", correctSpecies: gameAnswer };
    const previous = group.map(entry => entry.ownerLabel).find(Boolean) || null;
    const species = cleanText(message.species, 80);
    if (!species) return { ok: true, group, previous, label: null };
    if (!SPECIES_NAME.test(species)) return { ok: false, reason: "invalid-species" };
    const imageChanged = Boolean(message.imageChanged);
    const shape = cleanShape(imageChanged ? message.shape : item.shape);
    if (!shape) return { ok: false, reason: "missing-shape" };
    if (!imageChanged) {
      if (group.some(entry => cleanText(entry.wrongSpecies, 80) === species)) return { ok: false, reason: "rejected-by-game" };
      const options = cleanOptions(item.options);
      if (options.length && !options.includes(species)) return { ok: false, reason: "not-a-quiz-option" };
    }
    return { ok: true, group, previous, label: { species, shape, imageChanged } };
  }

  async function checkLabel(message = {}) {
    const verdict = judgeLabel(await readWrongCases(), message);
    return verdict.ok ? { ok: true, previous: verdict.previous, label: verdict.label } : verdict;
  }

  // Applies to every saved case of that image. message.added: the learned overlay took the
  // silhouette, so a later change of mind knows there is something to take back.
  function labelWrong(message = {}) {
    return serialized(async () => {
      const cases = await readWrongCases();
      const verdict = judgeLabel(cases, message);
      if (!verdict.ok) return verdict;
      const now = Date.now();
      for (const entry of verdict.group) {
        clearOwnerLabel(entry);
        if (!verdict.label) continue;
        entry.ownerLabel = { ...verdict.label, at: now, added: Boolean(message.added) };
        entry.reviewedAt = now;
        if (!verdict.label.imageChanged) {
          entry.correctSpecies = verdict.label.species;
          entry.resolvedAt = now;
        }
      }
      await chrome.storage.local.set({ [WRONG_KEY]: cases });
      return { ok: true, updated: verdict.group.length, label: verdict.label, count: cases.length };
    });
  }

  // reviewedOnly keeps the cases still waiting for an answer.
  function clearWrongCases(message = {}) {
    return serialized(async () => {
      const kept = message.reviewedOnly
        ? (await readWrongCases()).filter(item => !item?.correctSpecies && !item?.reviewedAt)
        : [];
      await chrome.storage.local.set({ [WRONG_KEY]: kept });
      return { ok: true, count: kept.length };
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
    checkLabel,
    labelWrong,
    clearWrongCases,
    WRONG_KEY,
    MAX_WRONG_CASES,
    LEGACY_KEYS
  });
})();
