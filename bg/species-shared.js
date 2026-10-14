"use strict";

// Name the Species: one database shared by every install — the full extension and Friend Sweep
// Lite, on any PC — so that what one of them learns, all of them answer.
//
// It is a public GitHub gist of the repository owner, one file per species:
//   species-<Name>.json = { format, species, examples: [mask], refuted: [mask], updatedAt }
// Masks only: 32x32 alpha silhouettes, as everywhere else. No ids, no pictures.
//
// Every install reads it (no account needed) and merges what it lacks into its learned
// silhouettes (bg/species-learned.js). An install that holds the owner's GitHub token (gist
// permission only, it can not touch any repository) also sends what it learned and what the game
// rejected; a rejection removes that species' near-duplicates in the gist and in every install.
//
// A merge is always a union, so two installs writing at the same moment lose nothing for long:
// whatever is missing from the gist is sent again at the next sync.
//
// Shared with Friend Sweep Lite, file for file.
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesShared) return;

  const OWNER = "ngotrongduong";
  const DESCRIPTION = "OviPets Name the Species - shared silhouette database";
  const FORMAT = "ovipets-species-shared/1";
  const FILE_PREFIX = "species-";
  const API = "https://api.github.com";
  const RAW_ORIGIN = "https://gist.githubusercontent.com/";
  const STATE_KEY = "owehSpeciesShared";
  const TOKEN_KEY = "owehSpeciesShareToken";
  const ALARM = "oweh-species-shared";
  const SYNC_MINUTES = 60;
  const MAX_REFUTED = 300;
  const SPECIES_NAME = /^[A-Za-z][A-Za-z -]{1,30}$/;
  const TOKEN_SHAPE = /^(ghp_[A-Za-z0-9]{30,60}|github_pat_[A-Za-z0-9_]{40,120})$/;
  const ABOUT = [
    "# OviPets — Name the Species, shared silhouettes",
    "",
    "Written and read by the OviPets Hatchery Helper and Friend Sweep Lite extensions.",
    "One file per species: `examples` are 32x32 alpha masks (hex) of pictures whose species the game",
    "confirmed or the owner labelled; `refuted` are masks the game rejected for that species.",
    "No pet ids, user ids or pictures are stored."
  ].join("\n");

  let chain = Promise.resolve();
  let fetcher = (...args) => fetch(...args);
  let clock = () => Date.now();

  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  const shapeApi = () => globalThis.OWEH_SPECIES_SHAPE;
  const learned = () => OWEH_BG.speciesLearned;
  const nearAny = (shape, list) => list.some(other => shapeApi().hamming(shape, other) <= shapeApi().DEDUPE_DISTANCE);

  async function readState() {
    const stored = (await chrome.storage.local.get({ [STATE_KEY]: null }))[STATE_KEY];
    return stored && typeof stored === "object" ? stored : {};
  }

  async function writeState(patch) {
    const next = { ...(await readState()), ...patch };
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
  }

  async function readToken() {
    const token = String((await chrome.storage.local.get({ [TOKEN_KEY]: "" }))[TOKEN_KEY] || "");
    return TOKEN_SHAPE.test(token) ? token : "";
  }

  // The token goes to api.github.com only.
  async function api(path, { token = "", method = "GET", body = null } = {}) {
    const response = await fetcher(`${API}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      const error = new Error(`GitHub answered ${response.status} to ${method} ${path.split("?")[0]}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  const fileName = species => `${FILE_PREFIX}${species}.json`;

  function cleanList(list, max) {
    const valid = (Array.isArray(list) ? list : []).map(value => String(value || "").toLowerCase()).filter(shape => shapeApi().validShape(shape));
    return [...new Set(valid)].slice(-max);
  }

  // Anything that is not a well-formed file for the species its name says is ignored.
  function parseFile(name, content) {
    const species = name.slice(FILE_PREFIX.length, -".json".length);
    if (!SPECIES_NAME.test(species)) return null;
    let data;
    try { data = JSON.parse(String(content || "")); } catch { return null; }
    if (data?.format !== FORMAT || data.species !== species) return null;
    return {
      species,
      examples: cleanList(data.examples, shapeApi().MAX_EXAMPLES),
      refuted: cleanList(data.refuted, MAX_REFUTED)
    };
  }

  // The owner's public gist with our description. Should two installs ever have created one at
  // the same moment, all of them settle on the oldest; the other's content is sent again by
  // its install at the next sync. A gist this install has just created may not be listed yet.
  async function findGist(token) {
    const state = await readState();
    const list = await api(`/users/${OWNER}/gists?per_page=100`, { token });
    const matches = (Array.isArray(list) ? list : [])
      .filter(gist => gist?.description === DESCRIPTION && /^[0-9a-f]+$/i.test(String(gist?.id || "")))
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const id = matches[0] ? String(matches[0].id) : String(state.gistId || "");
    if (id !== String(state.gistId || "")) await writeState({ gistId: id });
    return id;
  }

  // { species: { examples, refuted } }. A file too big for the API answer is read from its raw URL.
  async function readHub(gistId, token) {
    const gist = await api(`/gists/${gistId}`, { token });
    const hub = {};
    for (const [name, file] of Object.entries(gist?.files || {})) {
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(".json")) continue;
      let content = file?.content;
      if (file?.truncated && String(file.raw_url || "").startsWith(RAW_ORIGIN)) {
        const response = await fetcher(file.raw_url, { cache: "no-store" });
        content = response.ok ? await response.text() : "";
      }
      const record = parseFile(name, content);
      if (record) hub[record.species] = record;
    }
    return hub;
  }

  function digest(record) {
    let hash = 5381;
    for (const text of [...record.examples, "|", ...record.refuted]) {
      for (let index = 0; index < text.length; index += 16) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
    }
    return `${record.examples.length}:${record.refuted.length}:${hash}`;
  }

  // The gist into this install: rejections first (they also remove local near-duplicates), then
  // the silhouettes it does not have yet. A species unchanged since the last look is skipped.
  async function applyHub(hub, seen) {
    let added = 0;
    let removed = 0;
    const next = {};
    for (const [species, record] of Object.entries(hub)) {
      next[species] = digest(record);
      if (seen[species] === next[species]) continue;
      if (record.refuted.length) removed += (await learned().refute({ species, shapes: record.refuted })).removed || 0;
      if (record.examples.length) added += (await learned().learnMany({ species, shapes: record.examples })).added || 0;
    }
    return { added, removed, seen: next };
  }

  // This install into the gist: its learned silhouettes the gist lacks (not near one there, not
  // rejected), and its rejections the gist lacks. Only changed species files are written.
  async function sendLocal(hub, gistId, token) {
    const local = await learned().readAll();
    const localRefuted = await learned().readRefuted();
    const files = {};
    const after = {};
    let sent = 0;
    for (const species of new Set([...Object.keys(local), ...Object.keys(localRefuted)])) {
      const record = hub[species] || { examples: [], refuted: [] };
      const newRefuted = (localRefuted[species] || []).filter(shape => !record.refuted.includes(shape));
      const refuted = [...record.refuted, ...newRefuted].slice(-MAX_REFUTED);
      const additions = (local[species]?.examples || []).filter(shape => !nearAny(shape, record.examples) && !nearAny(shape, refuted));
      if (!additions.length && !newRefuted.length) continue;
      const library = { [species]: { examples: record.examples.filter(shape => !nearAny(shape, refuted)) } };
      for (const shape of additions) {
        if (shapeApi().addExample(library, species, shape, clock()).added) sent += 1;
      }
      after[species] = library[species].examples.length;
      files[fileName(species)] = {
        content: JSON.stringify({
          format: FORMAT, species, examples: library[species].examples, refuted, updatedAt: new Date(clock()).toISOString()
        })
      };
    }
    const count = Object.keys(files).length;
    if (!count) return { sent: 0, files: 0, gistId, after };
    if (gistId) {
      await api(`/gists/${gistId}`, { token, method: "PATCH", body: { files } });
      return { sent, files: count, gistId, after };
    }
    const created = await api("/gists", {
      token, method: "POST",
      body: { description: DESCRIPTION, public: true, files: { "about.md": { content: ABOUT }, ...files } }
    });
    await writeState({ gistId: String(created?.id || "") });
    return { sent, files: count, gistId: String(created?.id || ""), after };
  }

  function explain(error) {
    if (error?.status === 401) return "GitHub does not accept the saved token any more — create a new one and save it again";
    if (error?.status === 403) return "GitHub refused: the token may lack the gist permission, or too many requests — it tries again in an hour";
    if (error?.status === 404) return "the shared database was not found";
    return error?.message || String(error);
  }

  // Read the gist, merge it in, and (with a token) send what this install has that it lacks.
  // force: the owner asked, or a token was just saved; otherwise at most once an hour.
  function sync({ force = false } = {}) {
    return serialized(async () => {
      const now = clock();
      const state = await readState();
      if (!force && now - Number(state.lastSyncAt || 0) < (SYNC_MINUTES - 1) * 60 * 1000) return { ok: true, action: "recent" };
      const token = await readToken();
      try {
        let gistId = await findGist(token);
        let hub = {};
        if (gistId) {
          try {
            hub = await readHub(gistId, token);
          } catch (error) {
            if (error.status !== 404) throw error;
            // Deleted or renamed: look for it again next time.
            await writeState({ gistId: "" });
            gistId = "";
          }
        }
        const applied = await applyHub(hub, state.seen || {});
        const sent = token ? await sendLocal(hub, gistId, token) : { sent: 0, files: 0, after: {} };
        const sizes = Object.fromEntries(Object.entries(hub).map(([species, record]) => [species, record.examples.length]));
        Object.assign(sizes, sent.after);
        await writeState({
          lastSyncAt: now, lastError: "", seen: applied.seen,
          hubSpecies: Object.keys(sizes).length,
          hubExamples: Object.values(sizes).reduce((sum, size) => sum + size, 0),
          lastReceived: applied.added, lastRemoved: applied.removed, lastSent: sent.sent,
          totalReceived: Number(state.totalReceived || 0) + applied.added,
          totalSent: Number(state.totalSent || 0) + sent.sent
        });
        return { ok: true, action: "synced", received: applied.added, removed: applied.removed, sent: sent.sent };
      } catch (error) {
        await writeState({ lastSyncAt: now, lastError: explain(error) });
        return { ok: false, error: explain(error) };
      }
    });
  }

  async function status() {
    const [state, token] = await Promise.all([readState(), readToken()]);
    const gistId = String(state.gistId || "");
    return {
      ok: true,
      owner: OWNER,
      url: gistId ? `https://gist.github.com/${OWNER}/${gistId}` : "",
      contributing: Boolean(token),
      tokenEnd: token ? token.slice(-4) : "",
      lastSyncAt: Number(state.lastSyncAt || 0),
      lastError: String(state.lastError || ""),
      hubSpecies: Number(state.hubSpecies || 0),
      hubExamples: Number(state.hubExamples || 0),
      lastReceived: Number(state.lastReceived || 0),
      lastSent: Number(state.lastSent || 0),
      totalReceived: Number(state.totalReceived || 0),
      totalSent: Number(state.totalSent || 0)
    };
  }

  // The owner pastes their token on the review page. It must be theirs (the gist is found by
  // its owner's name) and is checked with GitHub before it is kept. An empty value removes it.
  function setToken(message = {}) {
    return serialized(async () => {
      const token = String(message.token || "").trim();
      if (!token) {
        await chrome.storage.local.set({ [TOKEN_KEY]: "" });
        return { ok: true, removed: true };
      }
      if (!TOKEN_SHAPE.test(token)) return { ok: false, error: "that does not look like a GitHub token (ghp_… or github_pat_…)" };
      let login = "";
      try {
        login = String((await api("/user", { token }))?.login || "");
      } catch (error) {
        return { ok: false, error: error?.status === 401 ? "GitHub did not accept this token" : `the token could not be checked: ${explain(error)}` };
      }
      if (login.toLowerCase() !== OWNER) return { ok: false, error: `this token belongs to "${login}", not to ${OWNER}` };
      await chrome.storage.local.set({ [TOKEN_KEY]: token });
      return { ok: true, saved: true };
    }).then(async result => {
      if (!result.ok || result.removed) return { ...result, ...(await status()), ok: result.ok };
      const synced = await sync({ force: true });
      return { ...(await status()), ok: true, saved: true, sync: synced };
    });
  }

  // Called once at the top level of the service worker.
  function start(options = {}) {
    if (typeof options.fetch === "function") fetcher = options.fetch;
    if (typeof options.now === "function") clock = options.now;
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm?.name === ALARM) sync().catch(() => {});
    });
    // Created only when missing: a service worker that starts often must not keep pushing it back.
    Promise.resolve(chrome.alarms.get?.(ALARM)).then(existing => {
      if (!existing) chrome.alarms.create(ALARM, { periodInMinutes: SYNC_MINUTES });
    }).catch(() => {});
    return sync().catch(() => null);
  }

  OWEH_BG.speciesShared = Object.freeze({
    start, sync, status, setToken,
    OWNER, DESCRIPTION, FORMAT, STATE_KEY, TOKEN_KEY, ALARM
  });
})();
