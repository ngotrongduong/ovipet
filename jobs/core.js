"use strict";

// Tiny module registry shared by every content script of this extension. All files in
// manifest.json's content_scripts.js list run in the same isolated world, so a plain global
// is enough — no build step, no imports. Files under jobs/ call OWEH.register(name, factory)
// when they load; content.js loads LAST and calls OWEH.boot(helpers) once, handing every
// module the same small set of shared helpers (storage, sleep, setStatus, bridge, ...).
//
// A factory returns an object with any of these optional members:
//   api        — functions other code may call (content.js reads it via boot()'s result)
//   buttons    — { "#panel-button-id": { label, handler } } bound by content.js when the panel is built
//   onRefresh  — called from content.js's refresh() on every coalesced page update
//   workerHandlers — { [owner]: { start(generation, extra), stop() } } merged into the
//                shared-worker dispatch table
// A module that throws while starting is skipped (logged) instead of taking the whole
// content script down, so one broken area never hides the rest of the panel.
(() => {
  if (globalThis.OWEH) return;
  const factories = [];
  const instances = {};

  function reportError(name, phase, error) {
    console.error(`[OviPets Helper] module "${name}" ${phase} failed`, error);
    try {
      chrome.runtime.sendMessage({
        type: "diagnosticLogAppend",
        entry: { level: "error", source: "module", event: `module.${phase}.failed`, data: { module: name, message: error?.message || String(error), stack: error?.stack || "" } }
      }, () => { try { void chrome.runtime.lastError; } catch {} });
    } catch {}
  }

  globalThis.OWEH = {
    register(name, factory) {
      factories.push({ name, factory });
    },
    boot(helpers) {
      for (const { name, factory } of factories) {
        if (instances[name]) continue;
        try {
          instances[name] = factory(helpers) || {};
        } catch (error) {
          reportError(name, "start", error);
          instances[name] = {};
        }
      }
      return instances;
    },
    runHook(hook, ...args) {
      for (const [name, instance] of Object.entries(instances)) {
        try {
          const result = instance[hook]?.(...args);
          if (result && typeof result.catch === "function") result.catch(error => reportError(name, hook, error));
        } catch (error) {
          reportError(name, hook, error);
        }
      }
    },
    get(name) {
      return instances[name] || null;
    },
    // Merges one object-valued member (e.g. "workerHandlers", "buttons") across all modules.
    collect(member) {
      const merged = {};
      for (const instance of Object.values(instances)) Object.assign(merged, instance[member] || {});
      return merged;
    }
  };
})();
