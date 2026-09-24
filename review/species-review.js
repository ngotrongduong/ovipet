"use strict";

// Species Review page (v5.4.4). Lists every saved "Name the Species" image from owehSpeciesMemory
// (one card per image: its credit-challenge URL key and its visual-fingerprint key share one
// thumbnail), shows what the game confirmed or rejected, and lets the user label unresolved images.
// Labels go through the service worker (speciesReviewLabel), which also teaches the silhouette
// library. The model half is pure so it can be tested in node.
(() => {
  const MEMORY_KEY = "owehSpeciesMemory";
  const INSPECTOR_KEY = "owehSpeciesInspectorV1";
  const ANSWER_ID_KEY = "owehSpeciesAnswerIds";
  const SHAPES_KEY = "owehSpeciesShapes";
  const REFERENCES_PER_SPECIES = 4;

  function eggIdFromKey(key) {
    return String(key || "").match(/\/img\/pet\/(\d+)\/credit-challenge/)?.[1] || null;
  }

  function countMap(target, source) {
    for (const [species, count] of Object.entries(source || {})) {
      target[species] = Math.max(Number(target[species] || 0), Number(count || 0));
    }
    return target;
  }

  function sessionIndex(sessions) {
    const index = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const question = session?.question;
      if (!question) continue;
      const keys = [question.image?.fingerprint, ...(question.image?.sources || []), question.key];
      for (const key of keys) if (key && !index.has(key)) index.set(key, session);
    }
    return index;
  }

  function gameVotes(item) {
    const manual = item.manual?.species || null;
    const votes = {};
    for (const [species, count] of Object.entries(item.votes)) {
      const value = Number(count || 0) - (species === manual ? 1 : 0);
      if (value > 0) votes[species] = value;
    }
    return votes;
  }

  function buildModel({ memory = {}, sessions = [], answerIds = {}, library = {}, shapeApi = null } = {}) {
    const groups = new Map();
    for (const [key, record] of Object.entries(memory || {})) {
      if (!record || typeof record !== "object") continue;
      const id = record.image || key;
      const item = groups.get(id) || {
        id, keys: [], image: record.image || null, url: null, eggId: null,
        votes: {}, wrong: {}, manual: null, updatedAt: 0, options: null, shape: null
      };
      item.keys.push(key);
      const eggId = eggIdFromKey(key);
      if (eggId) { item.url = key; item.eggId = eggId; }
      countMap(item.votes, record.votes);
      countMap(item.wrong, record.wrong);
      if (!item.manual && record.manual?.species) item.manual = record.manual;
      item.updatedAt = Math.max(item.updatedAt, Number(record.updatedAt || 0));
      groups.set(id, item);
    }

    const bySession = sessionIndex(sessions);
    const pool = new Set(Object.keys(answerIds || {}));
    const items = [...groups.values()];
    for (const item of items) {
      const session = item.keys.map(key => bySession.get(key)).find(Boolean);
      if (session) {
        const options = (session.question.options || []).map(option => String(option.text || "").trim()).filter(Boolean);
        if (options.length) item.options = options;
        if (shapeApi?.validShape(session.question.image?.shape)) item.shape = session.question.image.shape;
        if (!item.image && session.question.image?.thumbnail) item.image = session.question.image.thumbnail;
      }
      if (!item.shape && shapeApi?.validShape(item.manual?.shape)) item.shape = item.manual.shape;
      for (const species of [...Object.keys(item.votes), ...Object.keys(item.wrong), ...(item.options || [])]) pool.add(species);
      const confirmed = Object.entries(gameVotes(item)).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      item.confirmed = confirmed;
      item.status = confirmed ? "confirmed" : item.manual?.species ? "manual" : "unresolved";
      item.wrongCount = Object.values(item.wrong).reduce((sum, value) => sum + Number(value || 0), 0);
    }

    const species = [...pool].sort((a, b) => a.localeCompare(b));
    for (const item of items) {
      const eligible = (item.options || species).filter(name => !item.wrong[name]);
      item.eligible = eligible;
      item.guess = null;
      if (!item.confirmed && item.shape && shapeApi && eligible.length) {
        const ranked = shapeApi.rankOptions({ shape: item.shape, options: eligible, library, random: () => 0 });
        if (ranked && ranked.method !== "guess") item.guess = ranked;
      }
    }

    const summary = { images: items.length, confirmed: 0, manual: 0, unresolved: 0, attempts: 0, wrongTries: 0 };
    const perSpecies = Object.fromEntries(species.map(name => [name, {
      confirmed: 0, manual: 0, rejected: 0, shapes: Array.isArray(library?.[name]?.examples) ? library[name].examples.length : 0, references: []
    }]));
    for (const item of items) {
      summary[item.status] += 1;
      summary.wrongTries += item.wrongCount;
      summary.attempts += item.wrongCount + (item.confirmed ? 1 : 0);
      if (item.confirmed && perSpecies[item.confirmed]) {
        perSpecies[item.confirmed].confirmed += 1;
        if (item.image && perSpecies[item.confirmed].references.length < REFERENCES_PER_SPECIES) {
          perSpecies[item.confirmed].references.push(item.image);
        }
      }
      if (item.status === "manual" && perSpecies[item.manual.species]) perSpecies[item.manual.species].manual += 1;
      for (const name of Object.keys(item.wrong)) if (perSpecies[name]) perSpecies[name].rejected += 1;
    }
    return { items, species, perSpecies, summary };
  }

  function filterItems(items, { filter = "unresolved", species = "", sort = "new" } = {}) {
    const selected = items.filter(item => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!species) return true;
      return item.confirmed === species || item.manual?.species === species || Boolean(item.wrong[species]) || item.guess?.species === species;
    });
    const compare = {
      new: (a, b) => b.updatedAt - a.updatedAt,
      old: (a, b) => a.updatedAt - b.updatedAt,
      wrong: (a, b) => b.wrongCount - a.wrongCount || b.updatedAt - a.updatedAt
    }[sort] || ((a, b) => b.updatedAt - a.updatedAt);
    return selected.sort(compare);
  }

  const api = Object.freeze({ buildModel, filterItems, eggIdFromKey });
  globalThis.OWEH_SPECIES_REVIEW = api;
  if (typeof document === "undefined" || typeof chrome === "undefined" || !chrome.storage?.local) return;

  // ---------------------------------------------------------------- page
  const $ = id => document.getElementById(id);
  const view = { filter: "unresolved", species: "", sort: "new", fullImages: true };
  const fullImages = new Map();
  const imageQueue = [];
  let loadingImages = 0;
  let model = null;
  let renderTimer = null;

  try {
    const saved = JSON.parse(localStorage.getItem("owehSpeciesReviewView") || "{}");
    Object.assign(view, saved);
  } catch {}
  const saveView = () => { try { localStorage.setItem("owehSpeciesReviewView", JSON.stringify(view)); } catch {} };

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : String(value));
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  function toast(message, tone = "info") {
    const node = $("toast");
    node.textContent = message;
    node.dataset.tone = tone;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
  }

  const send = message => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, response => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response || { ok: false }));
    } catch (error) {
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });

  function pumpImages() {
    while (loadingImages < 2 && imageQueue.length) {
      const { url, img } = imageQueue.shift();
      if (fullImages.has(url)) { applyFull(img, url); continue; }
      loadingImages += 1;
      send({ type: "speciesImageFetch", url }).then(result => {
        fullImages.set(url, result?.ok && result.dataUrl ? result.dataUrl : null);
        applyFull(img, url);
      }).finally(() => { loadingImages -= 1; pumpImages(); });
    }
  }

  function applyFull(img, url) {
    const data = fullImages.get(url);
    const frame = img.closest(".frame");
    if (data) { img.src = data; frame?.classList.add("full"); }
    else frame?.classList.add("gone");
  }

  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const url = entry.target.dataset.url;
      if (url && view.fullImages) { imageQueue.push({ url, img: entry.target }); pumpImages(); }
    }
  }, { rootMargin: "300px" }) : null;

  function formatDate(ms) {
    if (!ms) return "";
    try { return new Date(ms).toLocaleString(); } catch { return ""; }
  }

  async function label(item, species) {
    const result = await send({ type: "speciesReviewLabel", keys: item.keys, species, shape: item.shape });
    if (!result?.ok) {
      const reason = { "game-confirmed": "the game already confirmed this image", "game-rejected": "the game already rejected that species for this image" }[result?.reason] || result?.reason || result?.error || "failed";
      toast(`Not saved: ${reason}`, "error");
      return;
    }
    if (!species) toast("Label cleared");
    else toast(result.shapeLearned ? `Saved "${species}" and taught its silhouette` : `Saved "${species}" (no silhouette available for this image)`, result.shapeLearned ? "ok" : "warn");
  }

  function speciesButtons(item) {
    const names = model.species;
    return el("div", { class: "answers" }, names.map(name => {
      const rejected = Boolean(item.wrong[name]);
      const offered = !item.options || item.options.includes(name);
      const confirmed = item.confirmed === name;
      const manual = item.manual?.species === name;
      const guess = item.guess?.species === name;
      const classes = ["answer", confirmed && "confirmed", manual && "manual", rejected && "rejected", !offered && "not-offered", guess && "guess"].filter(Boolean).join(" ");
      const locked = Boolean(item.confirmed) || rejected || !offered;
      const title = confirmed ? "Confirmed by the game" : rejected ? `Rejected by the game (${item.wrong[name]}×)` : !offered ? "Not one of the options offered for this image" : manual ? "Your label — click again to clear" : guess ? `Silhouette suggestion (distance ${item.guess.distance ?? "?"})` : "Label this image";
      return el("button", {
        type: "button", class: classes, disabled: locked, title,
        onclick: () => label(item, manual ? "" : name)
      }, [el("span", { text: (confirmed ? "✓ " : rejected ? "✗ " : manual ? "● " : "") + name })]);
    }));
  }

  function card(item) {
    const img = el("img", { src: item.image || "", alt: item.confirmed || item.manual?.species || "Unresolved species image", loading: "lazy" });
    if (item.url) img.dataset.url = item.url;
    const badge = {
      confirmed: el("span", { class: "badge ok", text: `✓ ${item.confirmed}` }),
      manual: el("span", { class: "badge manual", text: `● ${item.manual?.species} (my label)` }),
      unresolved: el("span", { class: "badge open", text: "Unresolved" })
    }[item.status];
    const meta = el("div", { class: "meta" }, [
      badge,
      item.wrongCount ? el("span", { class: "badge bad", text: `${item.wrongCount} wrong` }) : null,
      item.guess ? el("span", { class: "badge hint", title: "Nearest learned silhouette among the remaining options", text: `Shape: ${item.guess.species}${item.guess.distance != null ? ` · ${item.guess.distance}` : ""}` }) : null
    ]);
    const foot = el("div", { class: "foot" }, [
      el("span", { class: "muted", text: item.eggId ? `Egg ${item.eggId}` : "Image" }),
      el("span", { class: "muted", text: formatDate(item.updatedAt) })
    ]);
    const node = el("article", { class: `card ${item.status}` }, [
      el("div", { class: "frame" }, [img]), meta, speciesButtons(item), foot
    ]);
    if (item.url && view.fullImages) {
      if (fullImages.has(item.url)) applyFull(img, item.url);
      else observer?.observe(img);
    }
    return node;
  }

  function renderStats() {
    const s = model.summary;
    const stat = (value, labelText, tone) => el("div", { class: `stat ${tone || ""}` }, [el("strong", { text: String(value) }), el("span", { text: labelText })]);
    $("stats").replaceChildren(
      stat(s.images, "images saved"),
      stat(s.confirmed, "game-confirmed", "ok"),
      stat(s.manual, "my labels", "manual"),
      stat(s.unresolved, "unresolved", "open"),
      stat(s.wrongTries, "wrong tries", "bad")
    );
  }

  function renderPool() {
    $("pool-note").textContent = `${model.species.length} species seen as answer options`;
    $("pool").replaceChildren(...model.species.map(name => {
      const info = model.perSpecies[name];
      return el("button", {
        type: "button", class: `species ${view.species === name ? "active" : ""}`,
        title: "Filter by this species",
        onclick: () => { view.species = view.species === name ? "" : name; saveView(); render(); }
      }, [
        el("div", { class: "refs" }, info.references.length
          ? info.references.map(src => el("img", { src, alt: "" }))
          : [el("span", { class: "muted", text: "no confirmed image yet" })]),
        el("strong", { text: name }),
        el("span", { class: "muted", text: `✓ ${info.confirmed} · ● ${info.manual} · ✗ ${info.rejected} · shapes ${info.shapes}` })
      ]);
    }));
    const select = $("species-filter");
    select.replaceChildren(el("option", { value: "", text: "Any" }), ...model.species.map(name => el("option", { value: name, text: name })));
    select.value = view.species;
  }

  function render() {
    if (!model) return;
    renderStats();
    renderPool();
    for (const button of $("filters").querySelectorAll("button")) button.classList.toggle("active", button.dataset.filter === view.filter);
    $("sort").value = view.sort;
    $("full-images").checked = view.fullImages;
    const items = filterItems(model.items, view);
    $("count").textContent = `${items.length} shown`;
    $("grid").replaceChildren(...items.map(card));
    $("empty").hidden = items.length > 0;
  }

  async function load() {
    const data = await chrome.storage.local.get({ [MEMORY_KEY]: {}, [INSPECTOR_KEY]: {}, [ANSWER_ID_KEY]: {}, [SHAPES_KEY]: {} });
    model = buildModel({
      memory: data[MEMORY_KEY], sessions: data[INSPECTOR_KEY]?.sessions || [], answerIds: data[ANSWER_ID_KEY],
      library: data[SHAPES_KEY], shapeApi: globalThis.OWEH_SPECIES_SHAPE || null
    });
    render();
  }

  $("filters").addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    view.filter = button.dataset.filter;
    saveView();
    render();
  });
  $("species-filter").addEventListener("change", event => { view.species = event.target.value; saveView(); render(); });
  $("sort").addEventListener("change", event => { view.sort = event.target.value; saveView(); render(); });
  $("full-images").addEventListener("change", event => { view.fullImages = event.target.checked; saveView(); render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || ![MEMORY_KEY, INSPECTOR_KEY, ANSWER_ID_KEY, SHAPES_KEY].some(key => key in changes)) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const scroll = window.scrollY;
      load().then(() => window.scrollTo(0, scroll));
    }, 400);
  });
  load();
})();
