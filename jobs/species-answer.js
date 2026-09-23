"use strict";

// Automatic "Name the Species" answering — one of only two things this extension does on
// its own (the other is passive data collection). When the verification dialog appears, reuse
// a previously confirmed answer for that exact image (never one recorded wrong); otherwise
// (v5.4.0) pick the option whose learned silhouette is closest to the image, falling back to a
// random option that hasn't been ruled out; then click OK, exactly like a human would. Manual alert (tab focus + sound) remains
// only as a fallback when the OK button isn't there yet.
//
// Lives in its own file so the always-on watcher is independent of every job: nothing here
// starts, stops, or depends on any Start/Stop button.
OWEH.register("species-answer", helpers => {
  const { storageGet, storageSet, sleep, setStatus, getPageLoadDelayMs, runtimeRequest } = helpers;

  // { container, species, submittedAt } for the answer currently being submitted.
  let pending = null;
  // The dialog instance we're already handling; reset when it closes (see monitor()).
  let watchedContainer = null;
  let processing = false;
  // { species, method } of the option autoAnswer is about to click, so pending knows how it
  // was chosen ("memory", "shape-match", "shape-unknown", "shape-nearest", "guess").
  let nextChoice = null;

  function dialogElement() {
    return [...document.querySelectorAll('[role="dialog"], .ui-dialog, .ui-dialog-content')]
      .find(candidate => /Name the Species/i.test(candidate.textContent || "")) || null;
  }

  function containerOf(dialog) {
    return dialog?.closest(".ui-dialog") || dialog || null;
  }

  function visibleContainer() {
    const container = containerOf(dialogElement());
    return container && container.offsetParent !== null ? container : null;
  }

  function incorrectContainer() {
    const candidate = [...document.querySelectorAll('[role="dialog"], .ui-dialog, .ui-dialog-content')]
      .find(element => /answer is incorrect/i.test(element.textContent || ""));
    const container = containerOf(candidate);
    return container && container.offsetParent !== null ? container : null;
  }

  function exhaustedContainer() {
    const candidate = [...document.querySelectorAll('[role="dialog"], .ui-dialog, .ui-dialog-content')]
      .find(element => /egg can no longer be turned/i.test(element.textContent || ""));
    const container = containerOf(candidate);
    return container && container.offsetParent !== null ? container : null;
  }

  function dialogOpen() {
    return Boolean(visibleContainer() || incorrectContainer() || exhaustedContainer());
  }

  function incorrectDismissButton(container) {
    if (!container) return null;
    return [...container.querySelectorAll("button")].find(candidate =>
      /^Ok$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null
    ) || container.querySelector?.('[aria-label="Close"], .ui-dialog-titlebar-close') || null;
  }

  async function updateStats(patch) {
    // Every egg tab counts into the same stats object: let the service worker serialize the
    // increment, and fall back to a local read-modify-write only when it cannot be reached.
    let stats = null;
    try {
      const shared = typeof runtimeRequest === "function" ? await runtimeRequest({ type: "speciesStatsBump", patch: patch || {} }) : null;
      if (shared?.ok && shared.stats) stats = shared.stats;
    } catch {}
    if (!stats) {
      stats = await storageGet("owehSpeciesStats", {
        detected: 0, learnedAnswers: 0, manualHandoffs: 0, manualAlerts: 0, correct: 0, wrong: 0
      });
      for (const [key, amount] of Object.entries(patch || {})) {
        stats[key] = Number(stats[key] || 0) + Number(amount || 0);
      }
      stats.lastAt = Date.now();
      await storageSet({ owehSpeciesStats: stats });
    }
    const line = document.querySelector("#oweh-species-stats");
    const shapeText = Number(stats.shapeAnswers || 0) ? ` · shape ${Number(stats.shapeCorrect || 0)}/${Number(stats.shapeAnswers)}` : "";
    const text = `Species checks: ${stats.detected} detected · ${stats.correct} correct · ${stats.manualAlerts} manual prompt(s)${shapeText}`;
    if (line && line.textContent !== text) line.textContent = text;
    return stats;
  }

  function optionElements(container) {
    return [...container.querySelectorAll("button, label, [role=radio]")]
      .filter(element => element.offsetParent !== null)
      .map(element => ({ element, text: element.textContent.trim() }))
      .filter(({ text }) => text && !/^(Ok|Cancel|Close)$/i.test(text));
  }

  function okButton(container) {
    return [...container.querySelectorAll("button")]
      .find(candidate => /^Ok$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null) || null;
  }

  function imageSources(container) {
    const image = container?.querySelector('img[title="Name the Species"]');
    if (!image) return [];
    return [image.currentSrc, image.src, image.getAttribute("src"), image.getAttribute("data-src")]
      .filter(Boolean).map(source => source.split("?")[0].split("#")[0]);
  }

  async function imageFingerprint(container) {
    const image = container?.querySelector('img[title="Name the Species"]');
    if (!image || !image.complete || !image.naturalWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      const values = [];
      for (let index = 0; index < pixels.length; index += 4) {
        values.push((pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000);
      }
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return `visual:${values.map(value => value >= average ? "1" : "0").join("")}`;
    } catch {
      return null;
    }
  }

  // { keys, shape }: exact memory keys plus the Inspector's color-independent silhouette.
  async function questionIdentity(container) {
    const keys = imageSources(container);
    const fingerprint = await imageFingerprint(container);
    if (fingerprint) keys.push(fingerprint);
    let shape = null;
    // The Inspector can fingerprint a lazy/cross-origin challenge image through the guarded
    // background image fetcher. Reuse that exact identity so knowledge learned on one egg can
    // influence a visually identical challenge on another egg.
    try {
      const inspector = OWEH.get("species-inspector")?.api;
      if (inspector?.monitor) await inspector.monitor();
      const identity = await inspector?.getActiveQuestionIdentity?.();
      for (const key of identity?.keys || []) if (key) keys.push(key);
      shape = identity?.shape || null;
    } catch {}
    return { keys: [...new Set(keys)], shape };
  }

  async function memoryKeys(container) {
    return (await questionIdentity(container)).keys;
  }

  // Small (64x64) JPEG thumbnail, not the full-size image, to keep chrome.storage.local's
  // ~5MB quota from filling up as more distinct verification images get recorded.
  async function thumbnail(container) {
    const image = container?.querySelector('img[title="Name the Species"]');
    if (!image || !image.complete || !image.naturalWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      canvas.getContext("2d").drawImage(image, 0, 0, 64, 64);
      return canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      return null;
    }
  }

  // Records what actually happened for this exact verification image — win or lose — under
  // every key that identifies it (source URLs plus the perceptual fingerprint), so repeat
  // sightings get smarter over time. A wrong guess is remembered too, so it's never retried.
  async function recordOutcome(container, species, wasCorrect, reason = "", method = "") {
    if (!species) return;
    const methodPatch = wasCorrect && method === "shape-match" ? { shapeCorrect: 1 } : {};
    // The Inspector is the authoritative learner in normal builds because it can combine DOM,
    // network outcome, Answer IDs and a cross-origin-safe image fingerprint. Its write is
    // idempotent, so the UI observer and network recorder may both report the same outcome.
    try {
      const inspector = OWEH.get("species-inspector")?.api;
      const handled = await inspector?.recordOutcome?.(species, wasCorrect, reason || (wasCorrect ? "turn-confirmed" : "answer-rejected"));
      if (handled?.handled) {
        // pending is cleared before this runs, so each submitted answer reaches here once.
        await updateStats(methodPatch);
        return;
      }
    } catch {}

    // Fallback for stripped-down tests or a partially-loaded extension where the Inspector is
    // unavailable. Keep the old exact-source/fingerprint memory semantics.
    const keys = await memoryKeys(container);
    if (!keys.length) return;
    const memory = await storageGet("owehSpeciesMemory", {});
    const needsThumbnail = keys.some(key => !memory[key]?.image);
    const thumb = needsThumbnail ? await thumbnail(container) : null;
    for (const key of keys) {
      const previous = memory[key] || {};
      const votes = { ...(previous.votes || {}) };
      const wrong = { ...(previous.wrong || {}) };
      if (wasCorrect) votes[species] = (votes[species] || 0) + 1;
      else wrong[species] = (wrong[species] || 0) + 1;
      const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
      memory[key] = {
        species: winner?.[0] || previous.species || null,
        votes,
        wrong,
        hits: totalVotes,
        confidence: winner && totalVotes ? winner[1] / totalVotes : (previous.confidence || 0),
        image: previous.image || thumb || null,
        updatedAt: Date.now()
      };
    }
    await storageSet({ owehSpeciesMemory: memory });
    await updateStats(wasCorrect ? { correct: 1, ...methodPatch } : { wrong: 1 });
  }

  // Tracks the answer being submitted so its outcome can be recorded. Registered once, in
  // the capture phase, so it sees both the human's clicks and our own programmatic ones.
  document.addEventListener("click", event => {
    const option = event.target.closest?.("button, label, [role=radio]");
    const dialog = dialogElement();
    if (!option || !dialog || !/Name the Species/i.test(dialog.textContent || "")) return;
    const choice = option.textContent.trim();
    const container = containerOf(dialog);
    if (/^Ok$/i.test(choice) && pending?.container === container) {
      pending = { ...pending, submittedAt: Date.now() };
      return;
    }
    if (!choice || /^(Ok|Cancel|Close)$/i.test(choice)) return;
    // Selecting a different option is not evidence that the previous answer was wrong.
    // OviPets can reuse the same dialog node across retries/navigation, and only the explicit
    // incorrect Error/network response is authoritative negative evidence.
    const method = nextChoice?.species === choice ? nextChoice.method : "manual";
    nextChoice = null;
    pending = { container, species: choice, submittedAt: 0, method };
  }, true);

  async function requestAttention(container) {
    container?.scrollIntoView?.({ block: "center", inline: "center" });
    const playSound = await storageGet("owehSpeciesAlertSound", true);
    await runtimeRequest({ type: "speciesVerificationRequired", playSound });
  }

  async function autoAnswer(container) {
    const options = optionElements(container);
    if (!options.length || !okButton(container)) return false;
    const { keys, shape } = await questionIdentity(container);
    const memory = await storageGet("owehSpeciesMemory", {});
    const wrongForImage = new Set();
    let confidentSpecies = null;
    for (const key of keys) {
      const record = memory[key];
      if (!record) continue;
      Object.keys(record.wrong || {}).forEach(species => wrongForImage.add(species));
      if (!confidentSpecies && record.species && !record.wrong?.[record.species]) confidentSpecies = record.species;
    }
    const eligible = options.filter(({ text }) => !wrongForImage.has(text));
    const pool = eligible.length ? eligible : options;
    // 1) the exact image was already answered correctly; 2) otherwise the closest learned
    // silhouette among the options (domain/species-shape.js); 3) a random eligible option.
    let choice = pool.find(({ text }) => text === confidentSpecies) || null;
    let method = choice ? "memory" : "guess";
    const shapeApi = OWEH.domain?.speciesShape;
    if (!choice && shapeApi && shape) {
      const library = await storageGet("owehSpeciesShapes", {});
      const ranked = shapeApi.rankOptions({ shape, options: pool.map(({ text }) => text), library });
      choice = pool.find(({ text }) => text === ranked?.species) || null;
      if (choice) method = ranked.method;
    }
    if (!choice) choice = pool[Math.floor(Math.random() * pool.length)];
    if (method === "shape-match") updateStats({ shapeAnswers: 1 }).catch(() => {});
    nextChoice = { species: choice.text, method };
    choice.element.click();
    // Fast path: wait for the real OK control to become usable instead of sleeping for the
    // global page-load delay (historically ~1.5s on every quiz).
    const deadline = Date.now() + 600;
    let ok = okButton(container);
    while ((!ok || ok.disabled) && Date.now() < deadline) {
      await sleep(50);
      ok = okButton(container);
    }
    if (!ok || ok.disabled) return false;
    await sleep(100);
    ok.click();
    setStatus(`Name the Species — auto-selected "${choice.text}" (${method}) and confirmed`);
    return true;
  }

  // Called from refresh() on every coalesced page update. Tracks the dialog's open→close
  // transition instead of a one-time seen-flag: OviPets reuses the same jQuery-UI dialog
  // node across hash navigations, so a permanent "already handled" flag disabled the
  // answerer after its first success (v5.0.0 root cause of sweeps stalling at friend 1).
  async function monitor() {
    if (processing) return;
    const container = visibleContainer();
    if (!container) {
      watchedContainer = null;
      return;
    }
    if (watchedContainer === container) return;
    processing = true;
    watchedContainer = container;
    try {
      await updateStats({ detected: 1 });
      const answered = await autoAnswer(container).catch(() => false);
      if (!answered) {
        await updateStats({ manualAlerts: 1 });
        setStatus("Name the Species — choose an answer and press OK; this queue will continue afterward");
        await requestAttention(container);
      }
    } finally {
      processing = false;
    }
  }

  // Live Edge QA shows two distinct Error dialogs:
  //   1) "The answer is incorrect, please try again." -> record the negative answer, dismiss
  //      the Error, then the egg-tab runner may click Turn Egg again. The question/options stay
  //      the same for that egg and the remembered wrong answer is excluded on the next try.
  //   2) "The egg can no longer be turned." -> terminal for that egg; the owned tab closes.
  async function checkRejected() {
    const exhausted = exhaustedContainer();
    if (exhausted) {
      try { await OWEH.get("species-inspector")?.api?.monitor?.(); } catch {}
      try { await OWEH.get("species-inspector")?.api?.markTerminal?.("egg-can-no-longer-be-turned"); } catch {}
      pending = null;
      watchedContainer = null;
      setStatus("Name the Species — this egg can no longer be turned; closing its owned tab");
      return { rejected: true, terminal: true, reason: "egg-can-no-longer-be-turned" };
    }

    const error = incorrectContainer();
    if (!error) return false;
    try { await OWEH.get("species-inspector")?.api?.monitor?.(); } catch {}
    const rejected = pending;
    pending = null;
    watchedContainer = null;
    if (rejected?.species) await recordOutcome(rejected.container, rejected.species, false, "species-incorrect");

    const dismiss = incorrectDismissButton(error);
    if (dismiss && !dismiss.disabled) dismiss.click();
    let deadline = Date.now() + 1800;
    while (incorrectContainer() && Date.now() < deadline) await sleep(100);

    // Some live jQuery-UI Error dialogs have ignored the first synthetic OK click. If the
    // overlay is still visible, try the title-bar Close button as a second, bounded UI action.
    const stillOpen = incorrectContainer();
    if (stillOpen) {
      const close = stillOpen.querySelector?.('.ui-dialog-titlebar-close, [title="Close"], [aria-label="Close"]');
      if (close && !close.disabled) close.click();
      deadline = Date.now() + 1800;
      while (incorrectContainer() && Date.now() < deadline) await sleep(100);
    }
    if (incorrectContainer()) {
      setStatus("Name the Species — Error dialog is still blocking this egg; closing this owned tab so the sweep can continue");
      return { rejected: true, terminal: false, stuck: true, reason: "species-error-stuck" };
    }

    setStatus(`${rejected?.species || "That answer"} was incorrect; retrying this same egg without repeating it`);
    return { rejected: true, terminal: false, reason: "species-incorrect" };
  }

  // Called by whoever issued the Turn Egg command once the game reports its result: a
  // successful command confirms the submitted answer, a failed one after a submit refutes it.
  async function settleTurnResult(result) {
    if (result?.ok && pending) {
      const answered = pending;
      pending = null;
      await recordOutcome(answered.container, answered.species, true, result.reason || "turn-confirmed", answered.method);
      return;
    }
    // Timeouts/navigation failures are not evidence that the selected species was wrong. The
    // explicit incorrect dialog/network response is the only negative learning signal.
    if (result && !result.ok && result.reason === "species-incorrect" && pending?.submittedAt) {
      const answered = pending;
      pending = null;
      await recordOutcome(answered.container, answered.species, false, "species-incorrect");
      return;
    }
    if (result && !result.ok) pending = null;
  }

  return {
    onRefresh: monitor,
    api: { dialogOpen, monitor, checkRejected, settleTurnResult, updateStats }
  };
});
