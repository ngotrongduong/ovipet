"use strict";

// Review page for the saved Name-the-Species wrong answers (extension page in its own tab).
//
// One card per quiz image: the saved cases of one egg whose silhouettes match are the same
// question asked again, so their rejected answers are all wrong for it. The owner clicks the
// right species; the background checks the label against the game's own verdicts, stores it on
// the cases and adds the silhouette to the learned overlay the answerer reads.
//
// An egg is asked a new image on a later day. When the picture loaded here no longer matches
// the stored silhouette, the missed question itself can not be shown any more: the owner labels
// the picture they see instead (any species), which teaches that newer silhouette.
(() => {
  const shapeApi = globalThis.OWEH_SPECIES_SHAPE;
  const builtIn = globalThis.OWEH_STATIC_SPECIES?.library || {};
  const SAME_IMAGE_DISTANCE = 20;
  const CHANGED_DISTANCE = 40;
  const CHALLENGE_URL = /^https:\/\/(app\.)?ovipets\.com\/img\/pet\/\d+\/credit-challenge$/;
  const REASONS = {
    "resolved-by-game": "The game already confirmed the species of this image",
    "rejected-by-game": "The game rejected that species for this image",
    "not-a-quiz-option": "That species was not one of the six options",
    "unknown-case": "This case is no longer saved — press Reload",
    "missing-shape": "No silhouette is available for this picture yet",
    "invalid-species": "That is not a species name"
  };
  const state = { cases: [], groups: [], learned: {}, guard: null, totals: { correct: 0, wrong: 0 }, filter: "open" };
  // group key -> what the picture loaded on this page turned out to be
  const live = new Map();
  let ownWriteAt = 0;
  let labelling = false;
  let toastTimer = null;
  const $ = id => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === false || value == null) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
  }

  function request(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: "no response" });
        });
      } catch (error) {
        resolve({ ok: false, error: error?.message || String(error) });
      }
    });
  }

  function toast(text, tone = "") {
    const node = $("toast");
    node.textContent = text;
    node.dataset.tone = tone;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
  }

  function imageUrl(item) {
    const source = String(item?.source || "");
    if (CHALLENGE_URL.test(source)) return source;
    return /^\d+$/.test(String(item?.eggId || "")) ? `https://app.ovipets.com/img/pet/${item.eggId}/credit-challenge` : "";
  }

  function groupCases(cases) {
    const groups = [];
    for (const item of cases) {
      const eggId = String(item?.eggId || "");
      const shape = shapeApi.validShape(item?.shape) ? item.shape : "";
      let group = shape && eggId
        ? groups.find(entry => entry.eggId === eggId && entry.shape && shapeApi.hamming(entry.shape, shape) <= SAME_IMAGE_DISTANCE)
        : null;
      if (!group) {
        group = { key: String(item?.id || `${eggId}|${shape}`), eggId, shape, cases: [] };
        groups.push(group);
      }
      group.cases.push(item);
    }
    for (const group of groups) {
      group.rejected = [...new Set(group.cases.map(item => String(item.wrongSpecies || "")).filter(Boolean))];
      group.options = (group.cases.find(item => Array.isArray(item.options) && item.options.length)?.options || []).map(String);
      group.owner = group.cases.map(item => item.ownerLabel).find(Boolean) || null;
      group.gameAnswer = String(group.cases
        .find(item => item.correctSpecies && !(item.ownerLabel && !item.ownerLabel.imageChanged))?.correctSpecies || "");
      group.lastAt = Math.max(...group.cases.map(item => Number(item.lastAt || item.firstAt || 0)));
      group.source = imageUrl(group.cases[0]);
      group.status = group.gameAnswer ? "game" : group.owner ? "mine" : "open";
    }
    return groups.sort((a, b) => b.lastAt - a.lastAt);
  }

  const examplesOf = name => [...(builtIn[name]?.examples || []), ...(state.learned[name]?.examples || [])];
  const allSpecies = (extra = []) => [...new Set([...Object.keys(builtIn), ...Object.keys(state.learned), ...extra])].sort();

  // What the answerer would say now, among the species still possible for this image.
  function currentAnswer(group) {
    const names = group.options.filter(name => !group.rejected.includes(name));
    if (!group.shape || !names.length) return null;
    return shapeApi.rankOptions({
      shape: group.shape,
      options: names,
      library: Object.fromEntries(names.map(name => [name, { examples: examplesOf(name) }])),
      random: () => 0
    });
  }

  function nearestSpecies(shape) {
    let best = null;
    for (const name of allSpecies()) {
      for (const example of examplesOf(name)) {
        const distance = shapeApi.hamming(shape, example);
        if (!best || distance < best.distance) best = { species: name, distance };
      }
    }
    return best;
  }

  function shapeFromImage(image) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = shapeApi.SIZE;
      canvas.height = shapeApi.SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return shapeApi.shapeFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      return null;
    }
  }

  function drawMask(canvas, shape) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#20262e";
    for (let index = 0; index < shape.length; index += 1) {
      const nibble = parseInt(shape[index], 16);
      for (let bit = 0; bit < 4; bit += 1) {
        if (!(nibble & (8 >> bit))) continue;
        const pixel = index * 4 + bit;
        context.fillRect(pixel % shapeApi.SIZE, Math.floor(pixel / shapeApi.SIZE), 1, 1);
      }
    }
  }

  function setLive(group, info) {
    const previous = live.get(group.key);
    live.set(group.key, info);
    if (previous?.status === info.status && previous?.shape === info.shape) return;
    const card = document.querySelector(`[data-key="${CSS.escape(group.key)}"]`);
    if (card) fillBody(card.querySelector(".body"), group);
  }

  function onImageLoaded(group, image) {
    const shape = shapeFromImage(image);
    if (!shape) return setLive(group, { status: "unknown", shape: "" });
    const changed = !group.shape || shapeApi.hamming(shape, group.shape) > CHANGED_DISTANCE;
    setLive(group, { status: changed ? "changed" : "same", shape });
  }

  // Without CORS the picture can still be shown; it just can not be compared or learned.
  function onImageError(group, image, frame) {
    if (image.getAttribute("crossorigin") != null) {
      image.removeAttribute("crossorigin");
      image.src = group.source;
      return;
    }
    frame.classList.add("gone");
    setLive(group, { status: "gone", shape: "" });
  }

  function speciesPicker(group, names, preselect, buttonText, onPick) {
    const select = el("select", { "aria-label": "Species" },
      el("option", { value: "", text: "Choose the species…" }),
      names.map(name => el("option", { value: name, text: name, selected: name === preselect })));
    return el("div", { class: "pick" }, select, el("button", {
      type: "button", class: "plain", text: buttonText,
      onclick: () => (select.value ? onPick(select.value) : toast("Choose a species first", "error"))
    }));
  }

  function fillBody(body, group) {
    const info = live.get(group.key) || { status: "unknown", shape: "" };
    const changed = info.status === "changed";
    const locked = group.status === "game";
    const answer = changed ? null : currentAnswer(group);
    const ownerSpecies = group.owner?.species || "";
    const card = body.closest(".card");
    if (card) card.className = `card ${group.status}`;

    const meta = el("div", { class: "meta" });
    if (locked) meta.append(el("span", { class: "badge ok", text: `Game confirmed: ${group.gameAnswer}` }));
    else if (group.owner) meta.append(el("span", { class: "badge manual", text: `Your label: ${ownerSpecies}${group.owner.imageChanged ? " (newer picture)" : ""}` }));
    else meta.append(el("span", { class: "badge open", text: "Needs review" }));
    for (const name of group.rejected) meta.append(el("span", { class: "badge bad", title: "The game rejected this answer", text: name }));
    if (answer?.species) {
      const fixed = (locked ? group.gameAnswer : ownerSpecies) === answer.species;
      meta.append(el("span", {
        class: "badge hint",
        title: "What the helper would answer for this image now",
        text: `${fixed ? "Helper now answers" : "Helper would now try"}: ${answer.species}`
      }));
    }

    // A picture that changed can only teach the newer question. An answer already known for the
    // missed one (from the game, or labelled while it was still shown) is kept as it is.
    const settledBefore = locked || Boolean(group.owner && !group.owner.imageChanged);
    const parts = [meta];
    if (changed && !settledBefore) {
      const guess = info.shape ? nearestSpecies(info.shape) : null;
      parts.push(el("p", {
        class: "note",
        text: "This egg shows a newer question now, so the missed one (small silhouette) can not be shown. Label the picture you see: the helper learns that one."
      }));
      parts.push(speciesPicker(group, allSpecies(group.options), group.owner?.imageChanged ? ownerSpecies : guess?.species || "",
        "Save label", species => applyLabel(group, species, { imageChanged: true, shape: info.shape })));
    } else if (group.options.length) {
      if (changed) parts.push(el("p", { class: "note", text: "The egg shows a newer question now; the answer below belongs to the small silhouette." }));
      parts.push(el("div", { class: "answers" }, group.options.map(name => {
        const rejected = group.rejected.includes(name);
        const classes = ["answer"];
        if (rejected) classes.push("rejected");
        else if (locked && name === group.gameAnswer) classes.push("confirmed");
        else if (!locked && !group.owner?.imageChanged && name === ownerSpecies) classes.push("manual");
        else if (answer?.species === name) classes.push("guess");
        return el("button", {
          type: "button", class: classes.join(" "), text: name, disabled: rejected || locked || changed,
          title: rejected ? "The game rejected this answer" : locked || changed ? "" : "Click if this is the species in the picture",
          onclick: () => applyLabel(group, name)
        });
      })));
    } else if (!locked && !changed) {
      parts.push(speciesPicker(group, allSpecies().filter(name => !group.rejected.includes(name)), ownerSpecies,
        "Save label", species => applyLabel(group, species)));
    }
    if (group.owner && !locked) {
      parts.push(el("button", { type: "button", class: "plain", text: "Remove my label", onclick: () => applyLabel(group, "") }));
    }

    const first = group.cases[0] || {};
    const tries = group.cases.reduce((sum, item) => sum + Math.max(1, Number(item.count || 1)), 0);
    parts.push(el("div", { class: "foot" },
      el("span", { text: `egg ${group.eggId || "?"} · ${tries} wrong ${tries === 1 ? "try" : "tries"}` }),
      el("span", { text: `${first.method || "?"}${Number.isFinite(Number(first.distance)) && first.distance != null ? ` ${first.distance} bits` : ""} · ${group.lastAt ? new Date(group.lastAt).toLocaleString() : ""}` })));
    body.replaceChildren(...parts);
  }

  function renderCard(group) {
    const frame = el("div", { class: "frame" });
    if (group.source) {
      const image = el("img", { alt: `Quiz picture of egg ${group.eggId}`, loading: "lazy", crossorigin: "anonymous" });
      image.addEventListener("load", () => onImageLoaded(group, image));
      image.addEventListener("error", () => onImageError(group, image, frame));
      image.src = group.source;
      frame.append(image);
    } else {
      frame.classList.add("gone");
    }
    if (group.shape) {
      const mask = el("canvas", { class: "mask", width: shapeApi.SIZE, height: shapeApi.SIZE, title: "Stored silhouette of the missed question" });
      drawMask(mask, group.shape);
      frame.append(mask);
    }
    const body = el("div", { class: "body" });
    const card = el("article", { class: `card ${group.status}`, "data-key": group.key }, frame, body);
    fillBody(body, group);
    return card;
  }

  function renderHeader() {
    const count = status => state.groups.filter(group => group.status === status).length;
    const learnedSpecies = Object.keys(state.learned).length;
    const learnedShapes = Object.values(state.learned).reduce((sum, record) => sum + (record?.examples?.length || 0), 0);
    const stat = (tone, value, label) => el("div", { class: `stat ${tone}` }, el("strong", { text: String(value) }), el("span", { text: label }));
    $("stats").replaceChildren(
      stat("ok", state.totals.correct, "correct answers"),
      stat("bad", state.totals.wrong, "wrong answers"),
      stat("open", count("open"), "pictures to review"),
      stat("manual", count("mine"), "labelled by you"),
      stat("", learnedShapes, `learned silhouettes · ${learnedSpecies} species`)
    );

    const paused = state.guard?.paused;
    $("pause").hidden = !paused;
    if (paused) {
      $("pause-title").textContent = `Answering is paused — ${paused.reason}`;
      $("pause-text").textContent = `Paused ${new Date(paused.at).toLocaleString()}. The friend sweep / Hatchery run were stopped. Check the newest pictures below, then press Resume and start the sweep or the Hatchery run again.`;
    }
    for (const button of $("filters").querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.filter === state.filter);
    }
  }

  function render() {
    renderHeader();
    const shown = state.groups.filter(group => state.filter === "all" || group.status === state.filter);
    $("grid").replaceChildren(...shown.map(renderCard));
    $("count").textContent = `${shown.length} picture(s) · ${state.cases.length} saved wrong answer(s)`;
    $("empty").hidden = shown.length > 0;
    $("empty").textContent = state.filter === "open"
      ? "Nothing left to review. New wrong answers appear here after the next run."
      : "Nothing to show for this filter.";
    $("reload").classList.remove("attention");
    $("reload").textContent = "Reload";
  }

  // The shared database box: what every install reads, and whether this one also sends.
  function renderShared(status) {
    if (!status?.ok) return;
    const when = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "not yet";
    let summary;
    if (status.lastError) summary = `⚠ ${status.lastError}`;
    else if (status.hubExamples) summary = `${status.hubExamples} silhouettes in ${status.hubSpecies} species · this install ${status.contributing ? "sends and receives" : "receives only (no token)"} · checked ${when}`;
    else summary = status.contributing ? `empty so far — this install creates it at the next sync · checked ${when}` : "not created yet: the first install with a token creates it";
    $("shared-summary").textContent = summary;
    $("shared").classList.toggle("problem", Boolean(status.lastError));
    $("shared-owner").textContent = status.owner || "";
    const detail = [
      `Received ${status.totalReceived} silhouette(s), sent ${status.totalSent}.`,
      status.contributing ? `Token saved (…${status.tokenEnd}).` : "No token: this install only receives."
    ];
    $("shared-detail").replaceChildren(detail.join(" "));
    if (status.url) {
      $("shared-detail").append(" ", el("a", { href: status.url, target: "_blank", rel: "noopener", text: "Open the shared database" }));
    }
    $("shared-remove").disabled = !status.contributing;
  }

  async function sharedAction(message, done) {
    for (const id of ["shared-save", "shared-remove", "shared-sync"]) $(id).disabled = true;
    try {
      const response = await request(message);
      if (!response.ok) toast(response.error || "The shared database could not be reached", "error");
      else toast(done(response), "ok");
      renderShared(await request({ type: "speciesSharedStatus" }));
      await load();
      renderHeader();
    } finally {
      for (const id of ["shared-save", "shared-sync"]) $(id).disabled = false;
    }
  }

  async function load() {
    const [cases, learned, status, stored] = await Promise.all([
      request({ type: "speciesWrongCasesGet" }),
      request({ type: "speciesLearnedGet" }),
      request({ type: "speciesGuardGet" }),
      chrome.storage.local.get({ owehSpeciesStats: null }).catch(() => ({}))
    ]);
    if (!cases.ok) toast(`Could not read the saved wrong answers: ${cases.error || "unknown error"}`, "error");
    state.cases = Array.isArray(cases.cases) ? cases.cases : [];
    state.learned = learned.ok && learned.library ? learned.library : {};
    state.guard = status.ok ? status.guard : null;
    state.totals = {
      correct: Number(stored?.owehSpeciesStats?.correct || 0),
      wrong: Number(stored?.owehSpeciesStats?.wrong || 0)
    };
    state.groups = groupCases(state.cases);
  }

  // After a label only that card is redrawn: the others keep their pictures and place, and a
  // card just labelled stays visible so a misclick can be corrected.
  async function applyLabel(group, species, extra = {}) {
    // One label at a time: a double click must not send the same label twice.
    if (labelling) return;
    labelling = true;
    try {
      ownWriteAt = Date.now();
      const response = await request({ type: "speciesOwnerLabel", id: group.cases[0]?.id, species, ...extra });
      if (!response.ok) {
        toast(REASONS[response.reason] || response.error || "The label could not be saved", "error");
        return;
      }
      toast(species ? `Saved: ${species} — the helper has learned it` : "Label removed", "ok");
      await load();
      ownWriteAt = Date.now();
      const updated = state.groups.find(entry => entry.key === group.key);
      const card = document.querySelector(`[data-key="${CSS.escape(group.key)}"]`);
      if (!updated || !card) {
        render();
        return;
      }
      renderHeader();
      fillBody(card.querySelector(".body"), updated);
    } finally {
      labelling = false;
    }
  }

  function download(name, payload) {
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = el("a", { href, download: `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json` });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  $("filters").addEventListener("click", event => {
    const filter = event.target.closest("button")?.dataset.filter;
    if (!filter) return;
    state.filter = filter;
    render();
  });
  $("reload").addEventListener("click", async () => { await load(); render(); });
  $("resume").addEventListener("click", async () => {
    const response = await request({ type: "speciesGuardResume" });
    if (!response.ok) return toast(response.error || "Could not resume", "error");
    state.guard = response.guard;
    renderHeader();
    toast("Answering resumed — start the friend sweep or the Hatchery run again", "ok");
  });
  $("export-wrongs").addEventListener("click", () => {
    download("ovipets-species-wrongs", {
      exportedAt: new Date().toISOString(), type: "ovipets-species-wrong-cases", count: state.cases.length, cases: state.cases
    });
  });
  $("export-learned").addEventListener("click", () => {
    const cases = Object.entries(state.learned).flatMap(([species, record]) =>
      (record?.examples || []).map(shape => ({ correctSpecies: species, shape, method: "learned" })));
    download("ovipets-species-learned", {
      exportedAt: new Date().toISOString(), type: "ovipets-species-learned", count: cases.length, cases
    });
  });
  $("clear-reviewed").addEventListener("click", async () => {
    const reviewed = state.cases.filter(item => item?.correctSpecies || item?.reviewedAt).length;
    if (!reviewed) return toast("No reviewed case to remove");
    if (!confirm(`Remove ${reviewed} saved wrong answer(s) that already have an answer? The learned silhouettes stay.`)) return;
    ownWriteAt = Date.now();
    const response = await request({ type: "speciesWrongCasesClear", reviewedOnly: true });
    if (!response.ok) return toast(response.error || "Could not remove them", "error");
    await load();
    render();
  });

  $("shared-save").addEventListener("click", () => {
    const token = $("shared-token").value.trim();
    if (!token) return toast("Paste the token first", "error");
    $("shared-token").value = "";
    return sharedAction({ type: "speciesSharedToken", token }, response =>
      `Token saved — ${response.sync?.ok === false ? `but the first sync failed: ${response.sync.error}` : `sent ${response.sync?.sent || 0}, received ${response.sync?.received || 0}`}`);
  });
  $("shared-remove").addEventListener("click", () => {
    if (!confirm("Remove the token? This install keeps receiving the shared silhouettes but stops sending its own.")) return null;
    return sharedAction({ type: "speciesSharedToken", token: "" }, () => "Token removed — this install only receives now");
  });
  $("shared-sync").addEventListener("click", () => sharedAction({ type: "speciesSharedSync" },
    response => `Synced — received ${response.received || 0}, sent ${response.sent || 0}`));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.owehSpeciesGuard || changes.owehSpeciesStats) {
      load().then(renderHeader);
    }
    if (changes.owehSpeciesWrongCases && Date.now() - ownWriteAt > 2000) {
      $("reload").classList.add("attention");
      $("reload").textContent = "Reload (new wrong answers)";
    }
  });

  load().then(render);
  request({ type: "speciesSharedStatus" }).then(renderShared);
})();
