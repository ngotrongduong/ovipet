"use strict";

// Production Name-the-Species answerer.
// The classifier is static. Normal questions are not retained; only explicit OviPets wrong-answer
// rejections are persisted in a compact review queue so rare classifier misses can be improved.
OWEH.register("species-answer", helpers => {
  const { storageGet, storageSet, sleep, setStatus, runtimeRequest } = helpers;

  let pending = null;
  let watchedContainer = null;
  let processing = false;
  let nextChoice = null;
  let activeQuestionKey = "";
  let rejectedChoices = new Set();

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

  function challengeImage(container) {
    return container?.querySelector('img[title="Name the Species"]') || null;
  }

  function canonicalSource(image) {
    const raw = image?.currentSrc || image?.src || image?.getAttribute?.("src") || "";
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return String(raw).split("?")[0].split("#")[0];
    }
  }

  function currentPetId() {
    return String(location.hash || "").match(/[?&]pet=(\d+)/)?.[1] || "";
  }

  function questionKey(container) {
    return `${currentPetId()}|${canonicalSource(challengeImage(container))}`;
  }

  function resetQuestionIfNeeded(container) {
    const key = questionKey(container);
    if (key && key !== activeQuestionKey) {
      activeQuestionKey = key;
      rejectedChoices = new Set();
      pending = null;
      nextChoice = null;
    }
  }

  async function updateStats(patch = {}) {
    let stats = null;
    try {
      const response = typeof runtimeRequest === "function"
        ? await runtimeRequest({ type: "speciesStatsBump", patch: {
          correct: Number(patch.correct || 0),
          wrong: Number(patch.wrong || 0)
        } })
        : null;
      if (response?.ok && response.stats) stats = response.stats;
    } catch {}
    if (!stats) {
      stats = await storageGet("owehSpeciesStats", { correct: 0, wrong: 0 });
      stats = {
        correct: Number(stats?.correct || 0) + Number(patch.correct || 0),
        wrong: Number(stats?.wrong || 0) + Number(patch.wrong || 0)
      };
      await storageSet({ owehSpeciesStats: stats });
    }
    const line = document.querySelector("#oweh-species-stats");
    const meta = globalThis.OWEH_STATIC_SPECIES?.meta;
    const text = `Name the Species: ${Number(stats.correct || 0)} correct · ${Number(stats.wrong || 0)} wrong${meta?.species ? ` · static ${meta.species} species` : ""}`;
    if (line && line.textContent !== text) line.textContent = text;
    return stats;
  }

  function reviewCase(value, extra = {}) {
    if (!value) return null;
    return {
      eggId: String(value.eggId || currentPetId() || ""),
      source: String(value.source || ""),
      shape: String(value.shape || ""),
      options: Array.isArray(value.options) ? [...value.options] : [],
      wrongSpecies: String(value.species || value.wrongSpecies || ""),
      method: String(value.method || ""),
      distance: Number.isFinite(Number(value.distance)) ? Number(value.distance) : null,
      ...extra
    };
  }

  async function recordWrongCase(value) {
    const record = reviewCase(value);
    if (!record?.wrongSpecies) return;
    try { await runtimeRequest({ type: "speciesWrongCaseRecord", case: record }); } catch {}
  }

  async function resolveWrongCase(value) {
    if (!value?.species) return;
    const record = reviewCase(value, { correctSpecies: String(value.species) });
    try { await runtimeRequest({ type: "speciesWrongCaseResolve", case: record }); } catch {}
  }

  async function waitForImage(image, timeoutMs = 500) {
    const end = Date.now() + timeoutMs;
    while (image && (!image.complete || !image.naturalWidth) && Date.now() < end) await sleep(25);
    return Boolean(image?.complete && image?.naturalWidth);
  }

  function shapeFromImage(image) {
    const shapeApi = OWEH.domain?.speciesShape;
    if (!shapeApi || !image?.complete || !image.naturalWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = shapeApi.SIZE;
      canvas.height = shapeApi.SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.clearRect?.(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return shapeApi.shapeFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      return null;
    }
  }

  async function decodedImage(dataUrl) {
    if (!dataUrl) return null;
    return new Promise(resolve => {
      const image = document.createElement("img");
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => resolve(null), { once: true });
      image.src = dataUrl;
    });
  }

  async function challengeShape(container) {
    const image = challengeImage(container);
    if (!image) return null;
    const source = image.currentSrc || image.src || image.getAttribute?.("src");

    const direct = (async () => {
      await waitForImage(image, 350);
      return shapeFromImage(image);
    })();
    const fetched = (async () => {
      if (!source) return null;
      try {
        const response = await runtimeRequest({ type: "speciesImageFetch", url: source });
        if (!response?.ok || !response.dataUrl) return null;
        return shapeFromImage(await decodedImage(response.dataUrl));
      } catch {
        return null;
      }
    })();

    const first = await Promise.race([
      direct.then(shape => ({ source: "direct", shape })),
      fetched.then(shape => ({ source: "fetch", shape }))
    ]);
    if (first.shape) return first.shape;
    return first.source === "direct" ? await fetched : await direct;
  }

  async function requestAttention(container) {
    container?.scrollIntoView?.({ block: "center", inline: "center" });
    const playSound = await storageGet("owehSpeciesAlertSound", true);
    await runtimeRequest({ type: "speciesVerificationRequired", playSound });
  }

  async function autoAnswer(container) {
    resetQuestionIfNeeded(container);
    const options = optionElements(container);
    const okControl = okButton(container);
    if (!options.length || !okControl) return false;

    const eligible = options.filter(({ text }) => !rejectedChoices.has(text));
    const pool = eligible.length ? eligible : options;
    const shape = await challengeShape(container);
    const shapeApi = OWEH.domain?.speciesShape;
    const staticLibrary = globalThis.OWEH_STATIC_SPECIES?.library || {};
    let choice = null;
    let method = "guess";
    let distance = null;

    if (shapeApi && shape) {
      const ranked = shapeApi.rankOptions({
        shape,
        options: pool.map(({ text }) => text),
        library: staticLibrary
      });
      choice = pool.find(({ text }) => text === ranked?.species) || null;
      if (choice) {
        method = ranked.method;
        distance = Number.isFinite(Number(ranked.distance)) ? Number(ranked.distance) : null;
      }
    }

    if (!choice) choice = pool[Math.floor(Math.random() * pool.length)] || pool[0];
    if (!choice) return false;

    nextChoice = {
      species: choice.text,
      method,
      distance,
      shape: shape || "",
      options: options.map(({ text }) => text),
      source: canonicalSource(challengeImage(container)),
      eggId: currentPetId()
    };
    choice.element.click();

    const deadline = Date.now() + 500;
    let ok = okButton(container);
    while ((!ok || ok.disabled) && Date.now() < deadline) {
      await sleep(25);
      ok = okButton(container);
    }
    if (!ok || ok.disabled) return false;
    await sleep(50);
    ok.click();
    setStatus(`Name the Species — "${choice.text}" (${method})`);
    return true;
  }

  document.addEventListener("click", event => {
    const option = event.target.closest?.("button, label, [role=radio]");
    const dialog = dialogElement();
    if (!option || !dialog || !/Name the Species/i.test(dialog.textContent || "")) return;
    const choice = option.textContent.trim();
    const container = containerOf(dialog);
    resetQuestionIfNeeded(container);
    if (/^Ok$/i.test(choice) && pending?.container === container) {
      pending = { ...pending, submittedAt: Date.now() };
      return;
    }
    if (!choice || /^(Ok|Cancel|Close)$/i.test(choice)) return;

    const automatic = nextChoice?.species === choice ? nextChoice : null;
    nextChoice = null;
    pending = {
      container,
      species: choice,
      submittedAt: 0,
      method: automatic?.method || "manual",
      distance: automatic?.distance ?? null,
      shape: automatic?.shape || "",
      options: automatic?.options || optionElements(container).map(item => item.text),
      source: automatic?.source || canonicalSource(challengeImage(container)),
      eggId: automatic?.eggId || currentPetId()
    };
  }, true);

  async function monitor() {
    if (processing) return;
    const container = visibleContainer();
    if (!container) {
      watchedContainer = null;
      return;
    }
    resetQuestionIfNeeded(container);
    if (watchedContainer === container) return;
    processing = true;
    watchedContainer = container;
    try {
      const answered = await autoAnswer(container).catch(() => false);
      if (!answered) {
        setStatus("Name the Species — choose an answer and press OK; this queue will continue afterward");
        await requestAttention(container);
      }
    } finally {
      processing = false;
    }
  }

  async function checkRejected() {
    const exhausted = exhaustedContainer();
    if (exhausted) {
      pending = null;
      watchedContainer = null;
      setStatus("Name the Species — this egg can no longer be turned; closing its owned tab");
      return { rejected: true, terminal: true, reason: "egg-can-no-longer-be-turned" };
    }

    const error = incorrectContainer();
    if (!error) return false;
    const rejected = pending;
    pending = null;
    watchedContainer = null;
    if (rejected?.species) {
      rejectedChoices.add(rejected.species);
      await Promise.all([
        updateStats({ wrong: 1 }),
        recordWrongCase(rejected)
      ]);
    }

    const dismiss = incorrectDismissButton(error);
    if (dismiss && !dismiss.disabled) dismiss.click();
    let deadline = Date.now() + 1500;
    while (incorrectContainer() && Date.now() < deadline) await sleep(75);

    const stillOpen = incorrectContainer();
    if (stillOpen) {
      const close = stillOpen.querySelector?.('.ui-dialog-titlebar-close, [title="Close"], [aria-label="Close"]');
      if (close && !close.disabled) close.click();
      deadline = Date.now() + 1500;
      while (incorrectContainer() && Date.now() < deadline) await sleep(75);
    }
    if (incorrectContainer()) {
      setStatus("Name the Species — Error dialog is still blocking this egg; closing this owned tab so the sweep can continue");
      return { rejected: true, terminal: false, stuck: true, reason: "species-error-stuck" };
    }

    setStatus(`${rejected?.species || "That answer"} was incorrect; saved for review and retrying without it`);
    return { rejected: true, terminal: false, reason: "species-incorrect" };
  }

  async function settleTurnResult(result) {
    if (result?.ok && pending) {
      const accepted = pending;
      pending = null;
      await Promise.all([
        updateStats({ correct: 1 }),
        resolveWrongCase(accepted)
      ]);
      return;
    }
    if (result && !result.ok && result.reason === "species-incorrect" && pending?.submittedAt) {
      const rejected = pending;
      pending = null;
      if (rejected.species) rejectedChoices.add(rejected.species);
      await Promise.all([
        updateStats({ wrong: 1 }),
        recordWrongCase(rejected)
      ]);
      return;
    }
    if (result && !result.ok) pending = null;
  }

  return {
    onRefresh: monitor,
    api: { dialogOpen, monitor, checkRejected, settleTurnResult, updateStats }
  };
});
