"use strict";

// Throttle-proof sleep for tabs doing background work (v5.5.2).
//
// Chrome limits a hidden tab's timers to once per second, and after five minutes hidden
// ("intensive throttling") to about once a minute. A window covered by a fullscreen app or
// another program counts as hidden, so Full sweep stalled until the player clicked its tab.
// Chrome can also freeze background tabs outright.
//
// While this tab runs background work (it owns the shared worker lease, or an egg tab holds
// `holdAwake()`), a hidden sleep is timed by the service worker instead (`wakeAfter`), whose
// timers are not throttled, and the tab holds a Web Lock, which Chrome never freezes. Idle
// tabs keep plain page timers, so nothing changes for a tab the player is only viewing.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before core/wake-sleep.js");

  const WAKE_CHUNK_MS = 20 * 1000;
  const HIDDEN_MIN_SLEEP_MS = 250;
  const LOCK_PREFIX = "oweh-keep-awake-";

  function createWakeSleep({ isBusy = () => false, runtime = globalThis.chrome?.runtime, doc = globalThis.document,
    locks = globalThis.navigator?.locks, setTimer = (fn, ms) => setTimeout(fn, ms) } = {}) {
    let holds = 0;
    let releaseLock = null;
    let lockPending = false;
    let lockRequest = 0;
    const lockName = `${LOCK_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    function busy() {
      try { return holds > 0 || Boolean(isBusy()); } catch { return holds > 0; }
    }

    function syncLock(wanted) {
      if (wanted && !releaseLock && !lockPending && typeof locks?.request === "function") {
        lockPending = true;
        const request = ++lockRequest;
        let mine = null;
        Promise.resolve(locks.request(lockName, () => new Promise(resolve => {
          if (request === lockRequest) lockPending = false;
          if (!busy()) { resolve(); return; }
          mine = resolve;
          releaseLock = resolve;
        }))).catch(() => {}).finally(() => {
          if (request === lockRequest) lockPending = false;
          if (mine && releaseLock === mine) releaseLock = null;
        });
      } else if (!wanted && releaseLock) {
        const release = releaseLock;
        releaseLock = null;
        release();
      }
    }

    // Resolves after `ms`: page timer and service-worker wake race, whichever comes first.
    function sleep(ms) {
      const wait = Math.max(0, Number(ms) || 0);
      const working = busy();
      syncLock(working);
      if (!working || !doc?.hidden || !runtime?.id || typeof runtime.sendMessage !== "function") {
        return new Promise(resolve => setTimer(resolve, wait));
      }
      return new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        setTimer(finish, wait);
        const wakeAt = Date.now() + Math.max(wait, HIDDEN_MIN_SLEEP_MS);
        const step = () => {
          if (done) return;
          const left = wakeAt - Date.now();
          if (left <= 0) { finish(); return; }
          try {
            runtime.sendMessage({ type: "wakeAfter", ms: Math.min(WAKE_CHUNK_MS, left) }, response => {
              // A missing service worker or a reloaded extension falls back to the page timer.
              if (runtime.lastError || response?.ok !== true) return;
              step();
            });
          } catch { /* extension context invalidated: the page timer still resolves */ }
        };
        step();
      });
    }

    // An egg tab calls this while it works; the returned function ends the hold.
    function holdAwake() {
      holds += 1;
      syncLock(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (!busy()) syncLock(false);
      };
    }

    return { sleep, holdAwake, lockHeld: () => Boolean(releaseLock), isBusy: busy };
  }

  OWEH.core = OWEH.core || {};
  OWEH.core.wakeSleep = Object.freeze({ createWakeSleep, WAKE_CHUNK_MS, HIDDEN_MIN_SLEEP_MS });
})();
