"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.diagnosticLog) return;

  // V1 kept the entire 5,000-entry log in one chrome.storage.local value and rewrote that full
  // array for EVERY event. Long sweeps therefore became progressively more expensive. V2 keeps
  // the public export format compatible but stores new events in a fixed ring of small chunks.
  // One append reads/writes only metadata + one <=200-entry chunk.
  const STORAGE_KEY = "owehDiagnosticLogV1"; // legacy read compatibility
  const META_KEY = "owehDiagnosticLogV2Meta";
  const CHUNK_PREFIX = "owehDiagnosticLogV2Chunk:";
  const FORMAT = "ovipets-diagnostic-log";
  const FORMAT_VERSION = 1;
  const MAX_ENTRIES = 5000;
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const CHUNK_SIZE = 200;
  const MAX_CHUNKS = Math.ceil(MAX_ENTRIES / CHUNK_SIZE);
  const MAX_STRING = 800;
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let writeChain = Promise.resolve();

  function extensionVersion() {
    try { return chrome.runtime.getManifest?.().version || "unknown"; } catch { return "unknown"; }
  }

  function cleanString(value, max = MAX_STRING) {
    const text = String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function sanitize(value, depth = 0, key = "") {
    if (depth > 4) return "[depth-limit]";
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return cleanString(value);
    if (value instanceof Error) return {
      name: cleanString(value.name, 120),
      message: cleanString(value.message, 800),
      stack: cleanString(value.stack || "", 1600)
    };
    if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitize(item, depth + 1, key));
    if (typeof value !== "object") return cleanString(value);

    const out = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      if (/cookie|authorization|password|passwd|secret|token|html|responsebody|requestbody/i.test(childKey)) {
        out[childKey] = "[redacted]";
        continue;
      }
      out[childKey] = sanitize(childValue, depth + 1, childKey);
    }
    return out;
  }

  function normalizeLegacy(raw) {
    const state = raw && typeof raw === "object" ? raw : {};
    return {
      sequence: Number(state.sequence || 0),
      entries: Array.isArray(state.entries) ? state.entries : []
    };
  }

  function normalizeMeta(raw, legacySequence = 0) {
    const state = raw && typeof raw === "object" ? raw : {};
    return {
      storageVersion: 2,
      sequence: Math.max(Number(state.sequence || 0), Number(legacySequence || 0)),
      slot: Math.max(0, Math.min(MAX_CHUNKS - 1, Number(state.slot || 0))),
      slotsUsed: Math.max(0, Math.min(MAX_CHUNKS, Number(state.slotsUsed || 0))),
      currentCount: Math.max(0, Math.min(CHUNK_SIZE, Number(state.currentCount || 0)))
    };
  }

  function chunkKey(slot) {
    return `${CHUNK_PREFIX}${Number(slot)}`;
  }

  function prune(entries, now = Date.now()) {
    const minAt = now - MAX_AGE_MS;
    return (entries || [])
      .filter(entry => Number(entry?.at || 0) >= minAt)
      .sort((a, b) => Number(a?.at || 0) - Number(b?.at || 0) || Number(a?.id || 0) - Number(b?.id || 0))
      .slice(-MAX_ENTRIES);
  }

  async function readAppendState() {
    const stored = await chrome.storage.local.get({ [META_KEY]: null, [STORAGE_KEY]: null });
    const legacy = normalizeLegacy(stored[STORAGE_KEY]);
    const meta = normalizeMeta(stored[META_KEY], legacy.sequence);
    const current = await chrome.storage.local.get({ [chunkKey(meta.slot)]: [] });
    const chunk = Array.isArray(current[chunkKey(meta.slot)]) ? current[chunkKey(meta.slot)] : [];
    if (!stored[META_KEY]) {
      meta.currentCount = chunk.length;
      meta.slotsUsed = chunk.length ? 1 : 0;
    }
    return { meta, chunk };
  }

  function append(level, source, event, data = {}) {
    const run = writeChain.then(async () => {
      const now = Date.now();
      const { meta, chunk: currentChunk } = await readAppendState();
      let slot = meta.slot;
      let chunk = currentChunk;

      if (chunk.length >= CHUNK_SIZE || meta.currentCount >= CHUNK_SIZE) {
        slot = (slot + 1) % MAX_CHUNKS;
        chunk = [];
        meta.slot = slot;
        meta.currentCount = 0;
        meta.slotsUsed = Math.min(MAX_CHUNKS, Math.max(1, meta.slotsUsed + 1));
      } else if (!meta.slotsUsed) {
        meta.slotsUsed = 1;
      }

      meta.sequence += 1;
      const entry = {
        id: meta.sequence,
        at: now,
        iso: new Date(now).toISOString(),
        level: ["debug", "info", "warning", "error"].includes(String(level)) ? String(level) : "info",
        source: cleanString(source || "runtime", 80),
        event: cleanString(event || "event", 120),
        sessionId,
        version: extensionVersion(),
        data: sanitize(data)
      };
      chunk.push(entry);
      meta.currentCount = chunk.length;
      await chrome.storage.local.set({ [META_KEY]: meta, [chunkKey(slot)]: chunk });
      return entry;
    });
    writeChain = run.catch(() => {});
    return run;
  }

  async function readAllEntries() {
    await writeChain;
    const keys = [STORAGE_KEY, META_KEY, ...Array.from({ length: MAX_CHUNKS }, (_, index) => chunkKey(index))];
    const stored = await chrome.storage.local.get(keys);
    const legacy = normalizeLegacy(stored[STORAGE_KEY]);
    const entries = [...legacy.entries];
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      const chunk = stored[chunkKey(index)];
      if (Array.isArray(chunk)) entries.push(...chunk);
    }
    // IDs continue from the legacy sequence, but de-dupe defensively in case a partial migration
    // or browser restore duplicated a chunk.
    const seen = new Set();
    const unique = [];
    for (const entry of entries) {
      const identity = `${entry?.sessionId || "legacy"}:${entry?.id || 0}:${entry?.at || 0}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push(entry);
    }
    return prune(unique);
  }

  async function getSummary() {
    const entries = await readAllEntries();
    const counts = { debug: 0, info: 0, warning: 0, error: 0 };
    for (const entry of entries) counts[entry.level] = (counts[entry.level] || 0) + 1;
    const last = entries[entries.length - 1] || null;
    return { total: entries.length, counts, last: last ? { at: last.at, iso: last.iso, level: last.level, source: last.source, event: last.event } : null };
  }

  async function exportData() {
    const entries = await readAllEntries();
    const keys = [
      "owehWorker", "owehSweep", "owehEggTabs", "owehFriendEggState", "owehEggRun",
      "owehEggTabConcurrency", "owehEggSpeedProfile", "owehEggTabCap",
      "owehBreedCampaign", "owehPetIndex", "owehHatchlingRun", "owehSweepNotice"
    ];
    const snapshot = await chrome.storage.local.get(keys);
    const counts = { debug: 0, info: 0, warning: 0, error: 0 };
    for (const entry of entries) counts[entry.level] = (counts[entry.level] || 0) + 1;
    const last = entries[entries.length - 1] || null;
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: extensionVersion(),
      retention: { maxEntries: MAX_ENTRIES, maxAgeDays: MAX_AGE_MS / 86400000 },
      storageLayout: { version: 2, chunkSize: CHUNK_SIZE, maxChunks: MAX_CHUNKS },
      environment: { userAgent: cleanString(globalThis.navigator?.userAgent || "unknown", 300) },
      summary: { total: entries.length, counts, last: last ? { at: last.at, iso: last.iso, level: last.level, source: last.source, event: last.event } : null },
      stateSnapshot: sanitize(snapshot),
      entries
    };
  }

  async function clear() {
    await writeChain;
    const patch = {
      [STORAGE_KEY]: { version: FORMAT_VERSION, sequence: 0, entries: [] },
      [META_KEY]: normalizeMeta(null, 0)
    };
    for (let index = 0; index < MAX_CHUNKS; index += 1) patch[chunkKey(index)] = [];
    await chrome.storage.local.set(patch);
    return { ok: true };
  }

  OWEH_BG.diagnosticLog = Object.freeze({
    STORAGE_KEY, META_KEY, CHUNK_PREFIX, FORMAT, FORMAT_VERSION, MAX_ENTRIES, MAX_AGE_MS,
    CHUNK_SIZE, MAX_CHUNKS, append, getSummary, exportData, clear, sanitize
  });
})();
