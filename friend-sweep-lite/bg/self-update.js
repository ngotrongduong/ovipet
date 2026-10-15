"use strict";

// Self-update for an unpacked install.
//
// An unpacked extension is read from its folder. When that folder receives a newer release —
// its manifest.json carries another version than the one that is loaded — this module reloads
// the extension by itself at a moment nothing is running, then refreshes the OviPets tabs so
// they get the new page scripts. How the folder got the new files is not its business: a
// developer's edit followed by a version bump, or the updater script that copies a release
// from GitHub.
//
// The version is the signal on purpose. Files change one by one while work is in progress;
// only the version bump at the end says "this is a consistent release".
//
// Shared with Friend Sweep Lite, file for file. The host passes what differs:
//   busy()         -> "" when a reload is safe now, otherwise what it is waiting for (shown to the owner)
//   tabUrls        -> match patterns of the tabs whose page scripts die with the old extension
//   beforeReload() -> optional; what it returns is handed to onApplied after the reload
//   onApplied()    -> runs after the reload, once the tabs are refreshed
(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.selfUpdate) return;

  const ALARM = "oweh-self-update";
  const STATE_KEY = "owehSelfUpdate";
  const ENABLED_KEY = "owehSelfUpdateEnabled";
  // Page code reads this: a tab reload caused by an update is not the owner opening that page,
  // so nothing may auto-start on it.
  const RELOAD_AT_KEY = "owehSelfUpdateReloadAt";
  const CHECK_MINUTES = 1;
  // The same new version must have been on disk this long: its other files may still be copying.
  const SETTLE_MS = 45 * 1000;
  // After a reload that did not load the new version, the same version is not tried again sooner.
  const RETRY_MS = 30 * 60 * 1000;

  let hooks = { busy: async () => "", tabUrls: [], beforeReload: null, onApplied: null, now: null };
  let chain = Promise.resolve();
  // Tests pass their own clock.
  const clock = () => (typeof hooks.now === "function" ? hooks.now() : Date.now());

  function serialized(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  const loadedVersion = () => String(chrome.runtime.getManifest().version || "");

  // Only an unpacked install is read from its folder; a store install updates through the browser.
  async function supported() {
    try {
      return (await chrome.management.getSelf()).installType === "development";
    } catch {
      return false;
    }
  }

  async function enabled() {
    return (await chrome.storage.local.get({ [ENABLED_KEY]: true }))[ENABLED_KEY] !== false;
  }

  // The version in the folder right now, "" when it can not be read (mid-copy, invalid JSON).
  async function diskVersion() {
    try {
      const response = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
      if (!response.ok) return "";
      const version = String(JSON.parse(await response.text())?.version || "");
      return /^\d+(\.\d+){0,3}$/.test(version) ? version : "";
    } catch {
      return "";
    }
  }

  async function readState() {
    const stored = (await chrome.storage.local.get({ [STATE_KEY]: null }))[STATE_KEY];
    return stored && typeof stored === "object" ? stored : {};
  }

  async function writeState(patch) {
    const next = { ...(await readState()), ...patch };
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
  }

  // Only a higher version is a release. The folder showing an older one (a developer looking at
  // an old branch for a minute) must not swap the running extension for a build without this.
  function isNewer(candidate, current) {
    const a = String(candidate).split(".").map(Number);
    const b = String(current).split(".").map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta) return delta > 0;
    }
    return false;
  }

  // The reload refreshes every game tab. If the owner is in one right now — typing a message,
  // answering a quiz by hand — that would throw it away, so it waits for a pause.
  async function ownerIsOnGameTab() {
    try {
      if (!hooks.tabUrls.length || !chrome.idle?.queryState) return false;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: hooks.tabUrls });
      if (!tab) return false;
      if (!(await chrome.windows.get(tab.windowId))?.focused) return false;
      return (await chrome.idle.queryState(60)) === "active";
    } catch {
      return false;
    }
  }

  // One look at the folder. force: the owner pressed "Update now", so neither the settle time,
  // the retry hold nor their own presence holds it back. A running job always does.
  function check({ force = false, now = clock() } = {}) {
    return serialized(async () => {
      const state = await readState();
      const isSupported = await supported();
      if (!isSupported || !(await enabled())) {
        if (state.pending || state.waitingFor || state.supported !== isSupported) {
          await writeState({ pending: null, waitingFor: "", supported: isSupported });
        }
        return { action: "off" };
      }
      const loaded = loadedVersion();
      const disk = await diskVersion();
      if (!disk || !isNewer(disk, loaded)) {
        if (state.pending || state.waitingFor || state.supported !== true || state.loaded !== loaded) {
          await writeState({ pending: null, waitingFor: "", supported: true, loaded });
        }
        return { action: "current" };
      }
      const pending = state.pending?.version === disk ? state.pending : { version: disk, seenAt: now };
      const hold = waitingFor => writeState({ pending, waitingFor, supported: true, loaded });
      if (!force && now - Number(pending.seenAt || 0) < SETTLE_MS) {
        await hold("");
        return { action: "settling", version: disk };
      }
      if (!force && state.attempt?.version === disk && now - Number(state.attempt.at || 0) < RETRY_MS) {
        await hold("the last reload did not load it — reload the extension by hand once");
        return { action: "held", version: disk };
      }
      let waitingFor = "";
      try {
        waitingFor = String(await hooks.busy() || "");
      } catch {
        waitingFor = "the automation state could not be read";
      }
      if (!waitingFor && !force && await ownerIsOnGameTab()) {
        waitingFor = "you to pause for a minute in the OviPets tab (or switch tabs)";
      }
      if (waitingFor) {
        await hold(waitingFor);
        return { action: "waiting", version: disk, waitingFor };
      }
      let resume = null;
      try { resume = await hooks.beforeReload?.() ?? null; } catch {}
      await writeState({
        pending: null, waitingFor: "", supported: true, loaded,
        attempt: { version: disk, at: now },
        applying: { from: loaded, to: disk, at: now, resume }
      });
      chrome.runtime.reload();
      return { action: "reloading", version: disk };
    });
  }

  // First thing after a start: if this start is the reload this module asked for, the open
  // tabs still run the old page scripts, which can no longer reach the extension.
  function finishApply(now = clock()) {
    return serialized(async () => {
      const state = await readState();
      const loaded = loadedVersion();
      if (!state.applying) {
        if (state.loaded !== loaded) await writeState({ loaded });
        return { applied: false };
      }
      const taken = state.applying.to === loaded;
      await writeState({
        applying: null, loaded,
        applied: taken ? { from: state.applying.from, to: loaded, at: now } : state.applied || null
      });
      if (!taken) return { applied: false };
      await chrome.storage.local.set({ [RELOAD_AT_KEY]: now });
      let tabs = [];
      try {
        tabs = hooks.tabUrls.length ? await chrome.tabs.query({ url: hooks.tabUrls }) : [];
      } catch {}
      for (const tab of tabs) {
        try { await chrome.tabs.reload(tab.id); } catch {}
      }
      try { await hooks.onApplied?.({ from: state.applying.from, to: loaded, resume: state.applying.resume ?? null }); } catch {}
      return { applied: true, tabs: tabs.length };
    });
  }

  async function status() {
    const [state, isEnabled] = await Promise.all([readState(), enabled()]);
    return {
      ok: true,
      supported: state.supported === true,
      enabled: isEnabled,
      loaded: loadedVersion(),
      pending: state.pending || null,
      waitingFor: String(state.waitingFor || ""),
      applied: state.applied || null
    };
  }

  async function setEnabled(value) {
    await chrome.storage.local.set({ [ENABLED_KEY]: value !== false });
    await check();
    return status();
  }

  // Called once at the top level of the service worker.
  function start(options = {}) {
    hooks = { ...hooks, ...options, tabUrls: Array.isArray(options.tabUrls) ? options.tabUrls : [] };
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm?.name === ALARM) check().catch(() => {});
    });
    // An alarm does not survive every reload or browser restart, so it is set on each start.
    chrome.alarms.create(ALARM, { periodInMinutes: CHECK_MINUTES });
    return finishApply().then(() => check()).catch(() => null);
  }

  OWEH_BG.selfUpdate = Object.freeze({
    start, check, finishApply, status, setEnabled,
    ALARM, STATE_KEY, ENABLED_KEY, RELOAD_AT_KEY, SETTLE_MS, RETRY_MS
  });
})();
