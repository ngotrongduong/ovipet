"use strict";

// Privacy-scoped recorder + learning bridge for the live OviPets "Name the Species" flow.
// It records only quiz-related DOM/image/options, narrowly-filtered same-origin network
// evidence while the quiz is active, and a small set of matching MAIN-world source hints.
// It never records cookies, auth headers, passwords, chat, or unrelated response bodies.
OWEH.register("species-inspector", helpers => {
  const { storageGet, storageSet, setStatus, runtimeRequest } = helpers;
  const STORE_KEY = "owehSpeciesInspectorV1";
  const MEMORY_KEY = "owehSpeciesMemory";
  const ANSWER_ID_KEY = "owehSpeciesAnswerIds";
  const SHAPES_KEY = "owehSpeciesShapes";
  const MAX_SESSIONS = 120;
  const MAX_NETWORK_PER_SESSION = 30;
  const MAX_SOURCE_HINTS = 24;
  const MAX_MEMORY_KEYS = 900;
  const TRACE_CONTROL_EVENT = "oweh:species-trace-control";
  const TRACE_NETWORK_EVENT = "oweh:species-trace-network";
  const SOURCE_REQUEST_EVENT = "oweh:species-source-request";
  const SOURCE_RESULT_EVENT = "oweh:species-source-result";
  const SESSION_IDLE_MS = 45000;

  let activeSessionId = null;
  let activeEggId = null;
  let activeQuestionKey = null;
  let lastSeenAt = 0;
  let sequence = 0;
  let writeChain = Promise.resolve();
  const artifactCache = new Map();

  const now = () => Date.now();

  function visible(candidate) {
    return Boolean(candidate && candidate.offsetParent !== null);
  }

  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"], .ui-dialog, .ui-dialog-content')];
  }

  function speciesDialog() {
    return dialogs().find(candidate => visible(candidate) && /Name the Species/i.test(candidate.textContent || "")) || null;
  }

  function incorrectDialog() {
    return dialogs().find(candidate => visible(candidate) && /answer is incorrect/i.test(candidate.textContent || "")) || null;
  }

  function exhaustedDialog() {
    return dialogs().find(candidate => visible(candidate) && /egg can no longer be turned/i.test(candidate.textContent || "")) || null;
  }

  function containerOf(dialog) {
    return dialog?.closest?.(".ui-dialog") || dialog || null;
  }

  function currentEggId() {
    const match = String(location.hash || "").match(/[?&]pet=(\d+)/);
    return match?.[1] || null;
  }

  function currentUserId() {
    const match = String(location.hash || "").match(/[?&]usr=(\d+)/);
    return match?.[1] || null;
  }

  function canonicalUrl(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    try {
      const url = new URL(text, location.href);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return text.split("?")[0].split("#")[0] || null;
    }
  }

  function safeAttributes(element) {
    const result = {};
    for (const attribute of [...(element?.attributes || [])]) {
      const name = String(attribute.name || "");
      if (!name || /^(style)$/i.test(name)) continue;
      if (/^(value)$/i.test(name) && /^(input|textarea)$/i.test(element.tagName || "")) continue;
      let value = String(attribute.value || "");
      if (value.length > 1000) value = `${value.slice(0, 1000)}…`;
      result[name] = value;
    }
    return result;
  }

  function sanitizeHtml(html) {
    return String(html || "")
      .replace(/\s(value|data-token|csrf|auth|password)=("[^"]*"|'[^']*')/gi, ' $1="[redacted]"')
      .slice(0, 16000);
  }

  function optionSnapshot(container) {
    const inputs = [...container.querySelectorAll?.('input[name="Answer"]') || []];
    const inputById = new Map(inputs.map(input => [String(input.id || input.getAttribute?.("id") || ""), input]));
    return [...container.querySelectorAll("button, label, [role=radio]")]
      .filter(visible)
      .map(element => {
        const text = String(element.textContent || "").trim();
        const forId = String(element.getAttribute?.("for") || element.htmlFor || "");
        const input = inputById.get(forId) || element.querySelector?.('input[name="Answer"]') || null;
        const rawAnswerId = input?.value ?? input?.getAttribute?.("value") ?? null;
        return {
          tag: String(element.tagName || "").toLowerCase(),
          text,
          answerId: rawAnswerId == null ? null : String(rawAnswerId),
          attrs: safeAttributes(element)
        };
      })
      .filter(entry => entry.text && !/^(Ok|Cancel|Close)$/i.test(entry.text));
  }

  function imageElement(container) {
    return container?.querySelector?.('img[title="Name the Species"]') || container?.querySelector?.("img") || null;
  }

  function sourceCandidates(image) {
    if (!image) return [];
    return [image.currentSrc, image.src, image.getAttribute?.("src"), image.getAttribute?.("data-src")]
      .filter(Boolean);
  }

  async function waitForImageReady(image, timeoutMs = 2500) {
    if (!image) return false;
    if (image.complete && image.naturalWidth) return true;
    if (typeof image.addEventListener !== "function") return false;
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(Boolean(image.complete && image.naturalWidth)), timeoutMs);
      image.addEventListener("load", () => finish(true), { once: true });
      image.addEventListener("error", () => finish(false), { once: true });
    });
  }

  function artifactFromRenderableImage(image) {
    if (!image || !image.complete || !image.naturalWidth) return null;
    try {
      const hashCanvas = document.createElement("canvas");
      hashCanvas.width = 16;
      hashCanvas.height = 16;
      const hashContext = hashCanvas.getContext("2d", { willReadFrequently: true });
      hashContext.drawImage(image, 0, 0, 16, 16);
      const pixels = hashContext.getImageData(0, 0, 16, 16).data;
      const values = [];
      for (let index = 0; index < pixels.length; index += 4) {
        values.push((pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000);
      }
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      const fingerprint = `visual:${values.map(value => value >= average ? "1" : "0").join("")}`;

      // Color-independent silhouette (domain/species-shape.js): matches the same species across
      // eggs even though every challenge image has random colors and genes.
      let shape = null;
      const shapeApi = OWEH.domain?.speciesShape;
      if (shapeApi) {
        const shapeCanvas = document.createElement("canvas");
        shapeCanvas.width = shapeApi.SIZE;
        shapeCanvas.height = shapeApi.SIZE;
        const shapeContext = shapeCanvas.getContext("2d", { willReadFrequently: true });
        shapeContext.drawImage(image, 0, 0, shapeApi.SIZE, shapeApi.SIZE);
        shape = shapeApi.shapeFromRgba(shapeContext.getImageData(0, 0, shapeApi.SIZE, shapeApi.SIZE).data);
      }

      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 96;
      thumbCanvas.height = 96;
      thumbCanvas.getContext("2d").drawImage(image, 0, 0, 96, 96);
      const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.55);
      return { fingerprint, thumbnail, shape };
    } catch {
      return null;
    }
  }

  async function decodedImageFromDataUrl(dataUrl) {
    if (!dataUrl) return null;
    try {
      const image = document.createElement("img");
      const loaded = new Promise(resolve => {
        image.addEventListener?.("load", () => resolve(true), { once: true });
        image.addEventListener?.("error", () => resolve(false), { once: true });
      });
      image.src = dataUrl;
      if (image.complete && image.naturalWidth) return image;
      if (!(await loaded)) return null;
      return image;
    } catch {
      return null;
    }
  }

  async function imageArtifact(image) {
    if (!image) return { fingerprint: null, thumbnail: null, method: "none" };

    // Fast/lightweight path: do not wait up to 2.5s for the page's <img> to decode. Full Sweep
    // tabs may deliberately block image resources to save RAM/network, while the guarded
    // background fetcher can still retrieve ONLY the credit-challenge asset for fingerprinting.
    const directNow = artifactFromRenderableImage(image);
    if (directNow) return { ...directNow, method: "dom-canvas" };

    const rawSource = sourceCandidates(image)[0];
    const cacheKey = canonicalUrl(rawSource) || String(rawSource || "");
    if (cacheKey && typeof runtimeRequest === "function") {
      if (!artifactCache.has(cacheKey)) {
        artifactCache.set(cacheKey, (async () => {
          try {
            const response = await runtimeRequest({ type: "speciesImageFetch", url: rawSource });
            if (!response?.ok || !response.dataUrl) return null;
            const decoded = await decodedImageFromDataUrl(response.dataUrl);
            const artifact = artifactFromRenderableImage(decoded);
            return artifact ? { ...artifact, method: "background-fetch" } : null;
          } catch {
            return null;
          }
        })());
      }
      const fetched = await artifactCache.get(cacheKey);
      if (fetched) return fetched;
    }

    // Non-sweep/manual fallback if the guarded fetch is unavailable: give the DOM image a short
    // chance to finish, then use it directly. This keeps old browser/test behavior intact.
    await waitForImageReady(image, 600);
    const directLater = artifactFromRenderableImage(image);
    return directLater ? { ...directLater, method: "dom-canvas" }
      : { fingerprint: null, thumbnail: null, method: "unavailable" };
  }

  function memoryKeysForQuestion(question) {
    const keys = [];
    if (question?.image?.fingerprint) keys.push(question.image.fingerprint);
    for (const source of question?.image?.sources || []) if (source) keys.push(source);
    if (question?.key) keys.push(question.key);
    return [...new Set(keys)];
  }

  async function questionSnapshot(container) {
    const image = imageElement(container);
    const sources = sourceCandidates(image).map(canonicalUrl).filter(Boolean);
    const options = optionSnapshot(container);
    const artifact = await imageArtifact(image);
    const key = artifact.fingerprint || sources[0] || `options:${options.map(entry => entry.text).join("|")}`;
    return {
      key,
      capturedAt: now(),
      image: image ? {
        sources: [...new Set(sources)],
        attrs: safeAttributes(image),
        fingerprint: artifact.fingerprint,
        thumbnail: artifact.thumbnail,
        shape: artifact.shape || null,
        captureMethod: artifact.method
      } : null,
      options,
      dialog: {
        attrs: safeAttributes(container),
        html: sanitizeHtml(container?.outerHTML)
      }
    };
  }

  function blankStore() {
    return { version: 2, sessions: [], updatedAt: 0 };
  }

  async function readStore() {
    const value = await storageGet(STORE_KEY, blankStore());
    return value && typeof value === "object" && Array.isArray(value.sessions) ? value : blankStore();
  }

  function queueWrite(mutator) {
    writeChain = writeChain.then(async () => {
      const store = await readStore();
      await mutator(store);
      store.sessions = store.sessions.slice(-MAX_SESSIONS);
      store.version = 2;
      store.updatedAt = now();
      await storageSet({ [STORE_KEY]: store });
    }).catch(error => console.warn("[OviPets Helper] species inspector write failed", error));
    return writeChain;
  }

  function newSessionId(eggId) {
    sequence += 1;
    return `species:${eggId || "unknown"}:${now()}:${sequence}`;
  }

  function signalTrace(active, sessionId = activeSessionId, eggId = activeEggId) {
    try {
      document.dispatchEvent(new CustomEvent(TRACE_CONTROL_EVENT, {
        detail: JSON.stringify({ active: Boolean(active), sessionId: sessionId || "", eggId: eggId || "" })
      }));
    } catch {}
  }

  function requestSourceHints(sessionId) {
    try {
      document.dispatchEvent(new CustomEvent(SOURCE_REQUEST_EVENT, { detail: JSON.stringify({ sessionId }) }));
    } catch {}
  }

  // Writes shared by every egg tab go through the service worker, which serializes them;
  // a local read-modify-write is only the fallback when the background cannot be reached.
  async function viaBackground(message) {
    if (typeof runtimeRequest !== "function") return null;
    try {
      const response = await runtimeRequest(message);
      return response?.ok ? response : null;
    } catch {
      return null;
    }
  }

  async function updateAnswerIdMap(options) {
    const useful = (options || []).filter(option => option.text && option.answerId != null);
    if (!useful.length) return;
    const shared = await viaBackground({
      type: "speciesAnswerIdsMerge",
      options: useful.map(option => ({ text: String(option.text), answerId: String(option.answerId) }))
    });
    if (shared) return;
    const map = await storageGet(ANSWER_ID_KEY, {});
    for (const option of useful) {
      const species = String(option.text).trim();
      const id = String(option.answerId);
      const previous = map[species] || { ids: {}, preferred: null, updatedAt: 0 };
      const ids = { ...(previous.ids || {}) };
      ids[id] = Number(ids[id] || 0) + 1;
      const preferred = Object.entries(ids).sort((a, b) => b[1] - a[1])[0]?.[0] || id;
      map[species] = { ids, preferred, updatedAt: now() };
    }
    await storageSet({ [ANSWER_ID_KEY]: map });
  }

  async function ensureQuestionSession(container) {
    const snapshot = await questionSnapshot(container);
    const eggId = currentEggId();
    const userId = currentUserId();
    const sameQuestion = activeSessionId && activeEggId === eggId && activeQuestionKey === snapshot.key
      && now() - lastSeenAt < SESSION_IDLE_MS;
    if (!sameQuestion) {
      activeSessionId = newSessionId(eggId);
      activeEggId = eggId;
      activeQuestionKey = snapshot.key;
      await queueWrite(store => {
        store.sessions.push({
          id: activeSessionId,
          eggId,
          userId,
          page: { host: location.host, hash: String(location.hash || "") },
          firstSeenAt: now(),
          lastSeenAt: now(),
          question: snapshot,
          attempts: [],
          errors: [],
          network: [],
          sourceHints: [],
          events: [{ at: now(), type: "question-visible" }]
        });
      });
      await updateAnswerIdMap(snapshot.options);
      requestSourceHints(activeSessionId);
    } else {
      await queueWrite(store => {
        const session = store.sessions.find(item => item.id === activeSessionId);
        if (session) {
          session.lastSeenAt = now();
          if ((!session.question?.image?.fingerprint && snapshot.image?.fingerprint)
            || (!session.question?.image?.shape && snapshot.image?.shape)) session.question = snapshot;
        }
      });
      await updateAnswerIdMap(snapshot.options);
    }
    lastSeenAt = now();
    signalTrace(true);
    return activeSessionId;
  }

  function withSession(sessionId, mutator) {
    if (!sessionId) return Promise.resolve();
    return queueWrite(store => {
      const session = store.sessions.find(item => item.id === sessionId);
      if (!session) return;
      session.lastSeenAt = now();
      mutator(session);
    });
  }

  function recordAttempt(choice, phase, answerId = null) {
    const species = String(choice || "").trim();
    if (!activeSessionId || !species) return;
    withSession(activeSessionId, session => {
      let attempt = session.attempts[session.attempts.length - 1];
      if (!attempt || attempt.result || (phase === "selected" && attempt.species !== species)) {
        attempt = { index: session.attempts.length + 1, species, answerId, selectedAt: now(), submittedAt: 0, result: null };
        session.attempts.push(attempt);
      }
      if (answerId != null && attempt.answerId == null) attempt.answerId = String(answerId);
      if (phase === "submitted") attempt.submittedAt = now();
      session.events.push({ at: now(), type: `answer-${phase}`, species, answerId: answerId == null ? null : String(answerId) });
    });
  }

  function pruneMemory(memory) {
    const entries = Object.entries(memory || {});
    if (entries.length <= MAX_MEMORY_KEYS) return memory;
    const keep = entries
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, MAX_MEMORY_KEYS);
    return Object.fromEntries(keep);
  }

  async function incrementOutcomeStats(correct) {
    const stats = await storageGet("owehSpeciesStats", {
      detected: 0, learnedAnswers: 0, manualHandoffs: 0, manualAlerts: 0, correct: 0, wrong: 0
    });
    if (correct) stats.correct = Number(stats.correct || 0) + 1;
    else stats.wrong = Number(stats.wrong || 0) + 1;
    stats.lastAt = now();
    await storageSet({ owehSpeciesStats: stats });
  }

  // A confirmed answer teaches the silhouette library, so the same species is recognized on
  // every later egg regardless of its colors (see domain/species-shape.js).
  async function learnShape(shape, species) {
    const shapeApi = OWEH.domain?.speciesShape;
    if (!shapeApi?.validShape(shape) || !species) return;
    if (await viaBackground({ type: "speciesShapeLearn", species, shape })) return;
    const { library, added } = shapeApi.addExample(await storageGet(SHAPES_KEY, {}), species, shape);
    if (added) await storageSet({ [SHAPES_KEY]: library });
  }

  async function learnQuestionOutcome(question, species, correct) {
    if (!question || !species) return;
    if (correct) await learnShape(question.image?.shape, species);
    const keys = memoryKeysForQuestion(question);
    if (!keys.length) return;
    const shared = await viaBackground({
      type: "speciesMemoryLearn", keys, species, correct: Boolean(correct), image: question.image?.thumbnail || null
    });
    if (shared) return;
    let memory = await storageGet(MEMORY_KEY, {});
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
        image: previous.image || question.image?.thumbnail || null,
        updatedAt: now()
      };
    }
    memory = pruneMemory(memory);
    await storageSet({ [MEMORY_KEY]: memory });
    await incrementOutcomeStats(correct);
  }

  async function recordOutcome(species, correct, reason = "", options = {}) {
    const text = String(species || "").trim();
    const sessionId = String(options.sessionId || activeSessionId || "");
    if (!sessionId || !text) return { handled: false, newlyResolved: false };
    let question = null;
    let newlyResolved = false;
    let attemptIndex = null;
    await withSession(sessionId, session => {
      question = session.question || null;
      const reversed = [...session.attempts].reverse();
      let attempt = reversed.find(item => item.species === text && !item.result) || null;
      if (!attempt) {
        const same = reversed.find(item => item.species === text && item.result === (correct ? "correct" : "wrong"));
        if (same) {
          attemptIndex = same.index;
          return;
        }
        attempt = {
          index: session.attempts.length + 1,
          species: text,
          answerId: options.answerId == null ? null : String(options.answerId),
          selectedAt: now(),
          submittedAt: now(),
          result: null
        };
        session.attempts.push(attempt);
      }
      attemptIndex = attempt.index;
      if (!attempt.result) {
        attempt.result = correct ? "correct" : "wrong";
        attempt.resolvedAt = now();
        attempt.reason = reason || "";
        if (options.answerId != null && attempt.answerId == null) attempt.answerId = String(options.answerId);
        newlyResolved = true;
        session.events.push({ at: now(), type: correct ? "answer-correct" : "answer-wrong", species: text, reason });
      }
    });
    if (newlyResolved && question) await learnQuestionOutcome(question, text, Boolean(correct));
    return { handled: true, newlyResolved, attemptIndex };
  }

  async function markTerminal(reason = "egg-exhausted") {
    if (!activeSessionId) return;
    await withSession(activeSessionId, session => {
      session.terminal = { at: now(), reason: String(reason || "egg-exhausted") };
      session.events.push({ at: now(), type: "egg-exhausted", reason: String(reason || "egg-exhausted") });
    });
  }

  async function captureErrorDialog(container, type) {
    if (!container || !activeSessionId) return;
    const html = sanitizeHtml(container.outerHTML);
    const text = String(container.textContent || "").trim().slice(0, 2000);
    await withSession(activeSessionId, session => {
      const last = session.errors[session.errors.length - 1];
      if (last && last.text === text && now() - last.at < 1000) return;
      session.errors.push({ at: now(), type, text, attrs: safeAttributes(container), html });
      session.events.push({ at: now(), type: type === "terminal" ? "exhausted-dialog" : "incorrect-dialog" });
    });
    if (type === "terminal") await markTerminal("egg-can-no-longer-be-turned");
  }

  async function monitor() {
    const question = containerOf(speciesDialog());
    if (question) await ensureQuestionSession(question);
    const incorrect = containerOf(incorrectDialog());
    if (incorrect) await captureErrorDialog(incorrect, "incorrect");
    const exhausted = containerOf(exhaustedDialog());
    if (exhausted) await captureErrorDialog(exhausted, "terminal");
    if (!question && !incorrect && !exhausted && activeSessionId && now() - lastSeenAt > SESSION_IDLE_MS) {
      signalTrace(false);
      activeSessionId = null;
      activeEggId = null;
      activeQuestionKey = null;
    }
  }

  function answerIdForTarget(question, target) {
    const text = String(target?.textContent || "").trim();
    const option = (question?.options || []).find(item => item.text === text);
    return option?.answerId ?? null;
  }

  document.addEventListener("click", event => {
    const target = event.target?.closest?.("button, label, [role=radio], a") || event.target;
    const text = String(target?.textContent || "").trim();
    if (/^Turn Egg$/i.test(text)) {
      activeEggId = currentEggId();
      if (!activeSessionId || now() - lastSeenAt > SESSION_IDLE_MS) activeSessionId = newSessionId(activeEggId);
      lastSeenAt = now();
      signalTrace(true, activeSessionId, activeEggId);
      return;
    }
    const questionContainer = containerOf(speciesDialog());
    if (questionContainer && questionContainer.contains?.(target)) {
      if (text && !/^(Ok|Cancel|Close)$/i.test(text)) {
        readStore().then(store => {
          const session = store.sessions.find(item => item.id === activeSessionId);
          recordAttempt(text, "selected", answerIdForTarget(session?.question, target));
        }).catch(() => recordAttempt(text, "selected"));
      } else if (/^Ok$/i.test(text)) {
        const last = activeSessionId;
        if (last) withSession(last, session => {
          const attempt = session.attempts[session.attempts.length - 1];
          if (attempt && !attempt.submittedAt) attempt.submittedAt = now();
          session.events.push({ at: now(), type: "answer-submitted" });
        });
      }
    }
  }, true);

  function parseCommandResponse(value) {
    const text = String(value || "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }

  async function processNetworkDetail(detail) {
    const sessionId = String(detail.sessionId || activeSessionId || "");
    if (!sessionId) return;
    let sessionQuestion = null;
    await withSession(sessionId, session => {
      session.network.push({ ...detail, receivedAt: now() });
      session.network = session.network.slice(-MAX_NETWORK_PER_SESSION);
      sessionQuestion = session.question || null;
    });

    const request = detail.request && typeof detail.request === "object" ? detail.request : {};
    if (String(request.cmd || "") !== "pet_turn_egg") return;
    const result = parseCommandResponse(detail.response);
    if (!result || String(result.cmd || "") !== "pet_turn_egg") return;

    const message = String(result.message || "");
    if (/egg can no longer be turned/i.test(message)) {
      activeSessionId = sessionId;
      await markTerminal("egg-can-no-longer-be-turned");
      return;
    }

    const answerId = request.Answer == null ? null : String(request.Answer);
    const species = (sessionQuestion?.options || []).find(option => String(option.answerId ?? "") === String(answerId ?? ""))?.text || null;
    if (!species) return;
    if (String(result.status || "") === "success") {
      await recordOutcome(species, true, "network-success", { sessionId, answerId });
    } else if (String(result.status || "") === "failed" && /answer is incorrect/i.test(message)) {
      await recordOutcome(species, false, "network-incorrect", { sessionId, answerId });
    }
  }

  document.addEventListener(TRACE_NETWORK_EVENT, event => {
    let detail;
    try { detail = JSON.parse(String(event.detail || "{}")); } catch { return; }
    processNetworkDetail(detail).catch(error => console.warn("[OviPets Helper] species network learning failed", error));
  });

  document.addEventListener(SOURCE_RESULT_EVENT, event => {
    let detail;
    try { detail = JSON.parse(String(event.detail || "{}")); } catch { return; }
    const sessionId = detail.sessionId || activeSessionId;
    if (!sessionId) return;
    withSession(sessionId, session => {
      session.sourceHints = Array.isArray(detail.hints) ? detail.hints.slice(0, MAX_SOURCE_HINTS) : [];
      session.scriptSources = Array.isArray(detail.scriptSources) ? detail.scriptSources.slice(0, 100) : [];
      session.pageRuntime = detail.pageRuntime || null;
      session.events.push({ at: now(), type: "source-hints-captured" });
    });
  });

  async function getActiveQuestionIdentity() {
    if (!activeSessionId) return null;
    await writeChain;
    const store = await readStore();
    const session = store.sessions.find(item => item.id === activeSessionId);
    if (!session?.question) return null;
    return {
      sessionId: activeSessionId,
      eggId: session.eggId || null,
      key: session.question.key || null,
      keys: memoryKeysForQuestion(session.question),
      fingerprint: session.question.image?.fingerprint || null,
      shape: session.question.image?.shape || null,
      sources: session.question.image?.sources || [],
      options: session.question.options || []
    };
  }

  async function getSummary() {
    await writeChain;
    const store = await readStore();
    return store.sessions.reduce((summary, session) => {
      summary.questions += 1;
      summary.attempts += (session.attempts || []).length;
      summary.network += (session.network || []).length;
      summary.wrong += (session.attempts || []).filter(item => item.result === "wrong").length;
      summary.correct += (session.attempts || []).filter(item => item.result === "correct").length;
      return summary;
    }, { questions: 0, attempts: 0, correct: 0, wrong: 0, network: 0 });
  }

  function mergeCountMap(current = {}, incoming = {}) {
    const merged = { ...(current || {}) };
    for (const [key, value] of Object.entries(incoming || {})) {
      merged[key] = Math.max(Number(merged[key] || 0), Number(value || 0));
    }
    return merged;
  }

  function mergeMemoryRecords(current = {}, incoming = {}) {
    const votes = mergeCountMap(current.votes, incoming.votes);
    const wrong = mergeCountMap(current.wrong, incoming.wrong);
    const winner = Object.entries(votes).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const totalVotes = Object.values(votes).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      species: winner?.[0] || incoming.species || current.species || null,
      votes,
      wrong,
      hits: totalVotes,
      confidence: winner && totalVotes ? Number(winner[1]) / totalVotes : Math.max(Number(current.confidence || 0), Number(incoming.confidence || 0)),
      image: current.image || incoming.image || null,
      updatedAt: Math.max(Number(current.updatedAt || 0), Number(incoming.updatedAt || 0), now())
    };
  }

  function mergeAnswerIdRecords(current = {}, incoming = {}) {
    const ids = mergeCountMap(current.ids, incoming.ids);
    const preferred = Object.entries(ids).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0]
      || incoming.preferred || current.preferred || null;
    return {
      ids,
      preferred,
      updatedAt: Math.max(Number(current.updatedAt || 0), Number(incoming.updatedAt || 0), now())
    };
  }

  function incrementCount(record, key, amount = 1) {
    if (!key) return;
    record[key] = Number(record[key] || 0) + Number(amount || 0);
  }

  function mergePortableMemory(target, key, species, correct, image = null, timestamp = 0) {
    if (!key || !species) return;
    const previous = target[key] || {};
    const votes = { ...(previous.votes || {}) };
    const wrong = { ...(previous.wrong || {}) };
    incrementCount(correct ? votes : wrong, species, 1);
    const winner = Object.entries(votes).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const totalVotes = Object.values(votes).reduce((sum, value) => sum + Number(value || 0), 0);
    target[key] = {
      species: winner?.[0] || previous.species || null,
      votes,
      wrong,
      hits: totalVotes,
      confidence: winner && totalVotes ? Number(winner[1]) / totalVotes : Number(previous.confidence || 0),
      image: previous.image || image || null,
      updatedAt: Math.max(Number(previous.updatedAt || 0), Number(timestamp || 0))
    };
  }

  function deriveKnowledgeFromTrace(trace) {
    const memory = {};
    const answerIds = {};
    const stats = { correct: 0, wrong: 0 };
    const shapes = {};
    for (const session of trace?.sessions || []) {
      const question = session?.question || null;
      const attempts = Array.isArray(session?.attempts) ? session.attempts : [];
      const options = Array.isArray(question?.options) ? question.options : [];
      const optionById = new Map(options
        .filter(option => option?.answerId != null && option?.text)
        .map(option => [String(option.answerId), String(option.text).trim()]));
      for (const option of options) {
        if (!option?.text || option.answerId == null) continue;
        const species = String(option.text).trim();
        const id = String(option.answerId);
        const record = answerIds[species] || { ids: {}, preferred: null, updatedAt: 0 };
        incrementCount(record.ids, id, 1);
        record.preferred = Object.entries(record.ids).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || id;
        record.updatedAt = Math.max(Number(record.updatedAt || 0), Number(question?.capturedAt || session?.lastSeenAt || 0));
        answerIds[species] = record;
      }

      for (const network of session?.network || []) {
        const request = network?.request && typeof network.request === "object" ? network.request : {};
        if (String(request.cmd || "") !== "pet_turn_egg") continue;
        const response = parseCommandResponse(network?.response);
        if (!response || String(response.cmd || "") !== "pet_turn_egg") continue;
        const answerId = request.Answer == null ? null : String(request.Answer);
        let species = answerId == null ? null : optionById.get(answerId) || null;
        if (!species) {
          const unresolved = [...attempts].reverse().find(attempt => attempt?.species && (!attempt.result || attempt.answerId == null || String(attempt.answerId) === String(answerId ?? "")));
          species = unresolved?.species ? String(unresolved.species).trim() : null;
        }
        if (!species) continue;

        if (answerId != null) {
          const idRecord = answerIds[species] || { ids: {}, preferred: null, updatedAt: 0 };
          incrementCount(idRecord.ids, answerId, 1);
          idRecord.preferred = Object.entries(idRecord.ids).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || answerId;
          idRecord.updatedAt = Math.max(Number(idRecord.updatedAt || 0), Number(network?.at || network?.receivedAt || 0));
          answerIds[species] = idRecord;
        }

        const message = String(response.message || "");
        const correct = String(response.status || "") === "success";
        const wrong = String(response.status || "") === "failed" && /answer is incorrect/i.test(message);
        if (!correct && !wrong) continue;
        stats[correct ? "correct" : "wrong"] += 1;
        const timestamp = Number(network?.receivedAt || network?.at || session?.lastSeenAt || question?.capturedAt || 0);
        for (const key of memoryKeysForQuestion(question)) {
          mergePortableMemory(memory, key, species, correct, question?.image?.thumbnail || null, timestamp);
        }
        if (correct && question?.image?.shape) OWEH.domain?.speciesShape?.addExample(shapes, species, question.image.shape, timestamp || now());
      }
    }
    return { memory, answerIds, stats, shapes };
  }

  function normalizeImportPayload(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Species database file is not valid JSON data");
    if (payload.format === "ovipets-species-inspector") {
      const derived = deriveKnowledgeFromTrace(payload.trace);
      const memory = { ...(derived.memory || {}) };
      for (const [key, record] of Object.entries(payload.learnedMemory || {})) memory[key] = mergeMemoryRecords(memory[key] || {}, record);
      const answerIds = { ...(derived.answerIds || {}) };
      for (const [species, record] of Object.entries(payload.answerIds || {})) answerIds[species] = mergeAnswerIdRecords(answerIds[species] || {}, record);
      const stats = { ...(derived.stats || {}) };
      for (const [key, value] of Object.entries(payload.stats || {})) {
        if (typeof value === "number" && Number.isFinite(value)) stats[key] = Math.max(Number(stats[key] || 0), value);
        else if (key === "lastAt") stats[key] = Math.max(Number(stats[key] || 0), Number(value || 0));
      }
      const shapes = derived.shapes || {};
      OWEH.domain?.speciesShape?.mergeLibraries(shapes, payload.shapes || {});
      return { memory, answerIds, stats, shapes };
    }
    if (payload.format === "ovipets-species-learning-db") {
      return {
        memory: payload.learnedMemory || payload.memory || {},
        answerIds: payload.answerIds || {},
        stats: payload.stats || {},
        shapes: payload.shapes || {}
      };
    }
    throw new Error(`Unsupported Species database format: ${String(payload.format || "unknown")}`);
  }

  async function importDatabase(payload) {
    await writeChain;
    const incoming = normalizeImportPayload(payload);
    const [currentMemory, currentAnswerIds, currentStats] = await Promise.all([
      storageGet(MEMORY_KEY, {}),
      storageGet(ANSWER_ID_KEY, {}),
      storageGet("owehSpeciesStats", {})
    ]);

    const mergedMemory = { ...(currentMemory || {}) };
    for (const [key, record] of Object.entries(incoming.memory || {})) {
      if (!key || !record || typeof record !== "object") continue;
      mergedMemory[key] = mergeMemoryRecords(mergedMemory[key] || {}, record);
    }

    const mergedAnswerIds = { ...(currentAnswerIds || {}) };
    for (const [species, record] of Object.entries(incoming.answerIds || {})) {
      if (!species || !record || typeof record !== "object") continue;
      mergedAnswerIds[species] = mergeAnswerIdRecords(mergedAnswerIds[species] || {}, record);
    }

    const mergedStats = { ...(currentStats || {}) };
    for (const [key, value] of Object.entries(incoming.stats || {})) {
      if (typeof value === "number" && Number.isFinite(value)) mergedStats[key] = Math.max(Number(mergedStats[key] || 0), value);
      else if (key === "lastAt") mergedStats[key] = Math.max(Number(mergedStats[key] || 0), Number(value || 0));
    }
    mergedStats.lastImportedAt = now();

    await storageSet({
      [MEMORY_KEY]: pruneMemory(mergedMemory),
      [ANSWER_ID_KEY]: mergedAnswerIds,
      owehSpeciesStats: mergedStats
    });
    let shapeSpecies = 0;
    const shapeApi = OWEH.domain?.speciesShape;
    if (shapeApi && Object.keys(incoming.shapes || {}).length) {
      const shared = await viaBackground({ type: "speciesShapeMerge", library: incoming.shapes });
      if (shared) shapeSpecies = Number(shared.species || 0);
      else {
        const { library } = shapeApi.mergeLibraries(await storageGet(SHAPES_KEY, {}), incoming.shapes);
        await storageSet({ [SHAPES_KEY]: library });
        shapeSpecies = Object.keys(library).length;
      }
    }
    setStatus(`Imported Species database — ${Object.keys(mergedMemory).length} learned image key(s), ${Object.keys(mergedAnswerIds).length} species ID mapping(s)`);
    return {
      memoryKeys: Object.keys(mergedMemory).length,
      speciesIds: Object.keys(mergedAnswerIds).length,
      shapeSpecies
    };
  }

  async function exportDatabase() {
    await writeChain;
    const [memory, answerIds, stats, shapes] = await Promise.all([
      storageGet(MEMORY_KEY, {}),
      storageGet(ANSWER_ID_KEY, {}),
      storageGet("owehSpeciesStats", {}),
      storageGet(SHAPES_KEY, {})
    ]);
    const payload = {
      format: "ovipets-species-learning-db",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime?.getManifest?.().version || null,
      learnedMemory: memory,
      answerIds,
      stats,
      shapes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ovipets-species-db-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus(`Exported Species database — ${Object.keys(memory || {}).length} learned image key(s), ${Object.keys(answerIds || {}).length} species ID mapping(s)`);
    return payload;
  }

  async function exportData() {
    await writeChain;
    const [trace, memory, stats, answerIds, shapes] = await Promise.all([
      readStore(),
      storageGet(MEMORY_KEY, {}),
      storageGet("owehSpeciesStats", {}),
      storageGet(ANSWER_ID_KEY, {}),
      storageGet(SHAPES_KEY, {})
    ]);
    const payload = {
      format: "ovipets-species-inspector",
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime?.getManifest?.().version || null,
      trace,
      learnedMemory: memory,
      answerIds,
      stats,
      shapes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ovipets-species-inspector-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    const summary = await getSummary();
    setStatus(`Exported Species Inspector JSON — ${summary.questions} question(s), ${summary.correct} correct, ${summary.wrong} wrong`);
    return payload;
  }

  async function clearData() {
    activeSessionId = null;
    activeEggId = null;
    activeQuestionKey = null;
    artifactCache.clear();
    signalTrace(false);
    await storageSet({ [STORE_KEY]: blankStore() });
    setStatus("Species Inspector trace cleared; learned answer memory was kept");
  }

  return {
    onRefresh: monitor,
    api: {
      monitor,
      recordOutcome,
      markTerminal,
      getActiveQuestionIdentity,
      getSummary,
      exportData,
      exportDatabase,
      importDatabase,
      clearData,
      incorrectDialog: () => containerOf(incorrectDialog()),
      exhaustedDialog: () => containerOf(exhaustedDialog())
    }
  };
});
