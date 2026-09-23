"use strict";

// Own-Hatchery egg turn/hatch state machine. Turn Egg remains UI-only: the parent Hatchery
// tab opens up to 10 extension-owned egg profile tabs per batch; each egg tab clicks the real
// Turn Egg button and resolves Name the Species before reporting success. Hatch Egg is different:
// once the own Hatchery exposes its explicit Hatch Egg icon, the parent may send the exact
// OviPets UI dispatcher command directly to save a profile-tab round trip. The MAIN-world bridge
// independently verifies both the own-Hatchery route and the matching visible Hatch Egg PetID.
OWEH.register("feature-own-eggs", helpers => {
  const {
    storageGet, storageSet, sleep, setStatus, runtimeRequest,
    requestReleaseWorker, claimTask, releaseTask,
    routes, hatcheryDom, settings, pageActions, ownEggsService, gameActions
  } = helpers;

  const BATCH_SIZE = 10;
  const MAX_ATTEMPTS = 2;
  const BATCH_TIMEOUT_MS = 2 * 60 * 1000;
  const POLL_MS = 1000;
  const SETTLE_MS = 3000;
  const HATCH_BATCH_SIZE = 50;
  const HATCH_DISPATCH_DELAY_MS = 100;
  const HATCH_SETTLE_MS = 800;

  let processing = false;
  let autoStarting = false;
  let runToken = 0;
  // Set by stop() (user Stop, Stop All, or a safety stop such as exhausted attempts). Hatchery-
  // open auto-start must not undo it on the next DOM refresh: that would ignore the user's Stop
  // and, after a safety stop, restart with fresh attempt counters and reopen the same failing
  // egg tabs forever. Cleared by an explicit Start; a page reload is a fresh Hatchery open.
  let autoStartSuppressed = false;

  function defaultRun() {
    return {
      active: false,
      hatchery: "",
      count: 0,
      hatched: 0,
      attempts: {},
      hatchAttempts: {},
      hatchDispatched: {},
      batchId: null
    };
  }

  async function read() {
    return { ...defaultRun(), ...(await storageGet("owehEggRun", defaultRun())) };
  }

  async function readHatchlingRun() {
    return storageGet("owehHatchlingRun", { active: false, phase: "scan", index: 0 });
  }

  async function start() {
    if (!routes.isOwnHatchery()) {
      return setStatus("Open your own Hatchery first. Friend eggs are handled only by Start full sweep.");
    }
    const hatchlingRun = await readHatchlingRun();
    if (hatchlingRun.active) {
      const hasOwnEggWork = hatcheryDom.getHatcheryEggs().length
        || (hatcheryDom.getHatcheryHatchableEggs?.().length || 0);
      if (hasOwnEggWork) {
        await storageSet({
          owehHatchlingRun: { ...hatchlingRun, active: false, phase: "interrupted-for-eggs" }
        });
        requestReleaseWorker("hatchlings");
      } else {
        return setStatus("Stop Hatchling processing before turning eggs");
      }
    }

    autoStartSuppressed = false;
    const existing = await read();
    if (existing.active && !ownEggsService.ownedByThisTab(existing)) return;
    await storageSet({ owehAutoTurn: true });
    if (!existing.active) {
      if (!(await claimTask("egg-run", { kind: "navigation" }))) {
        return setStatus("Egg processing is owned by another live tab");
      }
      await storageSet({
        owehEggRun: {
          ...defaultRun(), active: true, hatchery: pageActions.currentHash(),
          ownerInstance: ownEggsService.ownerInstance,
          ownerTabId: ownEggsService.getCurrentTabId()
        }
      });
    }
    process();
  }

  async function stop(message = "Egg turn/hatch stopped") {
    runToken += 1;
    autoStartSuppressed = true;
    await storageSet({ owehEggRun: defaultRun(), owehAutoTurn: false });
    await runtimeRequest({ type: "eggBatchStop", source: "own" });
    await releaseTask("egg-run", "stopped");
    ownEggsService.setRunning(false);
    setStatus(message);
  }

  async function ownsRun() {
    const run = await read();
    return run.active && ownEggsService.ownedByThisTab(run) ? run : null;
  }

  async function waitForBatch(batchId, token) {
    const startedAt = Date.now();
    while (token === runToken) {
      if (!(await ownsRun())) return { outcome: "cancelled" };
      const status = await runtimeRequest({ type: "eggBatchStatus", batchId });
      if (!status.ok) return { outcome: "lost", reason: status.reason || status.error };
      const finished = status.turned + status.already;
      setStatus(`Own eggs: ${finished}/${status.expected} confirmed · ${status.open} tab(s) open · ${status.failed} failed · ${status.timedOut || 0} timeout`);
      if (status.done) return { outcome: Number(status.timedOut || 0) > 0 ? "timeout" : "done", status };
      if (Date.now() - startedAt > BATCH_TIMEOUT_MS) {
        await runtimeRequest({ type: "eggBatchExpire", batchId });
        const expired = await runtimeRequest({ type: "eggBatchStatus", batchId });
        return { outcome: "timeout", status: expired.ok ? expired : status };
      }
      await sleep(POLL_MS);
    }
    return { outcome: "cancelled" };
  }

  async function finishBatch(run, waited) {
    if (waited.outcome === "cancelled") return;
    const status = waited.status || {};
    const attempts = { ...(run.attempts || {}) };
    for (const eggId of status.exhaustedIds || []) attempts[String(eggId)] = MAX_ATTEMPTS;
    const next = {
      ...run,
      attempts,
      batchId: null,
      count: Number(run.count || 0) + Number(status.turned || 0)
    };
    await storageSet({ owehEggRun: next });
    setStatus(waited.outcome === "done"
      ? `Own eggs: batch finished (${status.turned || 0} turned, ${status.already || 0} already, ${status.failed || 0} failed) — rechecking Hatchery`
      : `Own eggs: batch ${waited.outcome}${waited.reason ? ` (${waited.reason})` : ""} — rechecking Hatchery`);
    await sleep(SETTLE_MS);
    if (await ownsRun()) pageActions.reloadPage();
  }

  async function dispatchHatchables(run, token) {
    const hatchable = hatcheryDom.getHatcheryHatchableEggs?.() || [];
    if (!hatchable.length) return { handled: false, exhausted: 0 };

    const hatchAttempts = { ...(run.hatchAttempts || {}) };
    const hatchDispatched = { ...(run.hatchDispatched || {}) };
    const eligible = hatchable.filter(egg => Number(hatchAttempts[egg.id] || 0) < MAX_ATTEMPTS);
    if (!eligible.length) return { handled: false, exhausted: hatchable.length };

    const batch = eligible.slice(0, HATCH_BATCH_SIZE);
    let dispatched = 0;
    let failed = 0;
    for (let index = 0; index < batch.length; index += 1) {
      if (token !== runToken || !(await ownsRun())) return { handled: true, cancelled: true };
      const egg = batch[index];
      hatchAttempts[egg.id] = Number(hatchAttempts[egg.id] || 0) + 1;
      const result = await gameActions.hatchOwnEgg(egg.id);
      if (result?.ok) {
        hatchDispatched[egg.id] = true;
        dispatched += 1;
      } else {
        failed += 1;
      }
      setStatus(`Own eggs: Hatch Egg ${index + 1}/${batch.length} · ${dispatched} dispatched · ${failed} failed`);
      if (index < batch.length - 1) await sleep(HATCH_DISPATCH_DELAY_MS);
    }

    const next = {
      ...run,
      hatchAttempts,
      hatchDispatched,
      hatched: Object.keys(hatchDispatched).length
    };
    await storageSet({ owehEggRun: next });
    setStatus(`Own eggs: dispatched Hatch Egg for ${dispatched}/${batch.length} ready egg(s) — rechecking Hatchery`);
    await sleep(HATCH_SETTLE_MS);
    if (await ownsRun()) pageActions.reloadPage();
    return { handled: true, dispatched, failed };
  }

  async function process() {
    if (processing) return;
    processing = true;
    try {
      let run = await ownsRun();
      if (!run || !routes.isOwnHatchery()) return;
      const token = ++runToken;
      await sleep(settings.getPageLoadDelayMs());
      run = await ownsRun();
      if (!run || token !== runToken) return;

      if (run.batchId) {
        await finishBatch(run, await waitForBatch(run.batchId, token));
        return;
      }

      const hatchResult = await dispatchHatchables(run, token);
      if (hatchResult.cancelled || hatchResult.handled) return;

      const eggs = hatcheryDom.getHatcheryEggs();
      if (!eggs.length) {
        if (hatchResult.exhausted) {
          await stop(`Stopped safely — ${hatchResult.exhausted} hatch-ready egg(s) could not be dispatched after ${MAX_ATTEMPTS} tries`);
          return;
        }
        await storageSet({
          owehEggRun: {
            ...defaultRun(),
            count: Number(run.count || 0),
            hatched: Number(run.hatched || 0)
          },
          owehAutoTurn: false
        });
        await releaseTask("egg-run");
        ownEggsService.setRunning(false);
        const hatched = Number(run.hatched || 0);
        if (run.count || hatched) {
          setStatus(`Finished — turned ${Number(run.count || 0)} egg(s) · hatch commands sent ${hatched}`);
        } else {
          setStatus("No turnable or hatch-ready eggs found");
        }
        return;
      }

      const attempts = { ...(run.attempts || {}) };
      const eligible = eggs.filter(egg => Number(attempts[egg.id] || 0) < MAX_ATTEMPTS);
      if (!eligible.length) {
        await stop(`Stopped safely — ${eggs.length} egg(s) could not be confirmed after ${MAX_ATTEMPTS} tries`);
        return;
      }

      const batch = eligible.slice(0, BATCH_SIZE);
      for (const egg of batch) attempts[egg.id] = Number(attempts[egg.id] || 0) + 1;
      const batchId = `own-${Date.now()}`;
      run = { ...run, attempts, batchId, hatchery: pageActions.currentHash() };
      await storageSet({ owehEggRun: run });
      setStatus(`Own eggs: opening ${batch.length} egg tab(s) — real Turn Egg button will be clicked in each tab`);

      const request = {
        type: "eggBatchOpen",
        source: "own",
        batchId,
        eggs: batch.map(egg => ({ id: egg.id, usr: egg.href.match(/[?&]usr=(\d+)/)?.[1] || "" }))
      };
      const opened = await runtimeRequest(request);
      if (opened.ok && Number.isFinite(opened.expected)) {
        for (const egg of batch.slice(opened.expected)) attempts[egg.id] -= 1;
        run.attempts = attempts;
        await storageSet({ owehEggRun: run });
      }
      if (!opened.ok) {
        run.batchId = null;
        await storageSet({ owehEggRun: run });
        await stop(`Could not open egg tabs (${opened.reason || opened.error || "unknown"})`);
        return;
      }
      await finishBatch(run, await waitForBatch(batchId, token));
    } catch (error) {
      console.error("[OviPets Helper] own egg run failed", error);
      await stop(`Own egg run failed: ${error?.message || error}`);
    } finally {
      processing = false;
    }
  }

  async function maybeAutoStart() {
    // Never auto-turn while merely browsing a friend's Hatchery. Friend eggs belong exclusively
    // to the explicit Start full sweep workflow, which opens one owned profile tab per egg.
    if (autoStarting || autoStartSuppressed || !routes.isOwnHatchery()) return;
    autoStarting = true;
    try {
      if (!hatcheryDom.getHatcheryEggs().length
        && !(hatcheryDom.getHatcheryHatchableEggs?.().length || 0)) return;
      const run = await read();
      if (!run.active && !processing && !autoStartSuppressed) start();
    } finally {
      autoStarting = false;
    }
  }

  return {
    api: { read, start, stop, process, maybeAutoStart, isProcessing: () => processing }
  };
});
