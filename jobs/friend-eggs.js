"use strict";

// Fast Full-Sweep egg step (v5.3.11). The coordinator snapshots one friend's turnable eggs
// once, drains that snapshot through back-to-back extension-owned profile-tab batches, then
// performs ONE final Hatchery reload/verification pass. This removes the old reload-after-every-
// 10-eggs bottleneck while keeping the 60s tab / 120s batch watchdogs in bg/egg-tabs.js.
// v5.4.0: a running batch is topped up as its tabs resolve (rolling window), so one slow tab no
// longer idles the other slots until the batch ends.
OWEH.register("friend-eggs", helpers => {
  const { storageGet, storageSet, sleep, setStatus, runtimeRequest, waitForGameReady, reportWorkerPhase,
    isWorkerOwner, routes, hatcheryDom, sweepService, pageActions, diagnosticLog } = helpers;

  const MAX_ATTEMPTS = 2;
  const BATCH_TIMEOUT_MS = 2 * 60 * 1000;
  const POLL_FALLBACK_MS = 2000;
  const BATCH_HANDOFF_MS = 150;
  const BUSY_RETRY_MS = 250;
  const BUSY_RETRY_LIMIT = 40;
  const EMPTY_STABLE_MS = 750;
  const SNAPSHOT_MAX_MS = 2500;
  const FRIEND_READY_DELAY_MS = 450;
  const SPEED_LEVELS = [10, 12, 15];
  const SPEED_PROMOTE_STREAK = 5;
  const SLOW_BATCH_MS = 35000;
  const VERY_SLOW_BATCH_MS = 50000;
  const PROMOTE_BATCH_MAX_MS = 25000;

  let processing = false;
  let activeFriendId = null;
  let rerunRequested = false;
  const batchSignals = new Map();
  const batchWaiters = new Map();

  function defaultState(friendId = "") {
    return {
      friendId,
      attempts: {},
      batchId: null,
      batchEggs: [],
      queue: null,
      hadEggs: false,
      initialCount: 0,
      completedCount: 0,
      verificationPasses: 0,
      capturedAt: 0
    };
  }

  function normalizeEgg(egg, friendId) {
    if (!egg?.id) return null;
    return {
      id: String(egg.id),
      usr: String(egg.href?.match(/[?&]usr=(\d+)/)?.[1] || friendId || "")
    };
  }

  async function ownsFriendPage(friendId) {
    if (!routes.isFriendHatchery() || routes.currentFriendId() !== friendId) return false;
    const sweep = await sweepService.readSweep();
    return Boolean(sweep.active) && await isWorkerOwner("sweep");
  }

  // The SPA swaps friends by changing the hash; right after that the old friend's eggs can still
  // be on screen. When cards carry a usr= that disagrees with this friend, wait for them.
  async function waitForFriendContent(friendId) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const stale = hatcheryDom.getHatcheryEggs().some(egg => {
        const usr = egg.href.match(/[?&]usr=(\d+)/)?.[1];
        return usr && usr !== friendId;
      });
      if (!stale) return;
      await sleep(150);
    }
  }

  // Empty Hatcheries used to wait a fixed four seconds. Instead, accept the DOM once the same
  // egg-id snapshot has stayed unchanged for 750ms (bounded by 2.5s). This works for both empty
  // and populated Hatcheries and avoids unnecessary waiting on fast page loads.
  async function stableEggSnapshot(friendId) {
    const end = Date.now() + SNAPSHOT_MAX_MS;
    let previous = null;
    let stableSince = 0;
    let latest = [];
    while (Date.now() < end) {
      if (!(await ownsFriendPage(friendId))) return null;
      latest = hatcheryDom.getHatcheryEggs().map(egg => ({ ...egg }));
      const signature = latest.map(egg => `${egg.id}:${egg.href}`).join("|");
      if (signature === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= EMPTY_STABLE_MS) return latest;
      } else {
        previous = signature;
        stableSince = Date.now();
      }
      await sleep(125);
    }
    return latest;
  }

  function onBatchProgress(message) {
    if (message?.source !== "sweep" || !message?.batchId || !message?.status) return;
    const batchId = String(message.batchId);
    const waiter = batchWaiters.get(batchId);
    if (waiter) {
      batchWaiters.delete(batchId);
      waiter(message.status);
    } else {
      batchSignals.set(batchId, message.status);
    }
  }

  function clearBatchSignal(batchId) {
    batchSignals.delete(String(batchId));
    batchWaiters.delete(String(batchId));
  }

  async function waitForBatchSignal(batchId) {
    if (batchSignals.has(batchId)) {
      const status = batchSignals.get(batchId);
      batchSignals.delete(batchId);
      return status;
    }
    let resolver = null;
    const event = new Promise(resolve => {
      resolver = resolve;
      batchWaiters.set(batchId, resolve);
    });
    const value = await Promise.race([event, sleep(POLL_FALLBACK_MS).then(() => null)]);
    if (batchWaiters.get(batchId) === resolver) batchWaiters.delete(batchId);
    if (value) batchSignals.delete(batchId);
    return value;
  }

  function eggTabCap(value) {
    const cap = Math.floor(Number(value));
    return Number.isFinite(cap) && cap >= 1 ? Math.min(SPEED_LEVELS[SPEED_LEVELS.length - 1], cap) : SPEED_LEVELS[SPEED_LEVELS.length - 1];
  }

  async function speedProfile() {
    const stored = await storageGet("owehEggSpeedProfile", {});
    const existingConcurrency = Number(await storageGet("owehEggTabConcurrency", 10));
    const requested = Number(stored.concurrency || existingConcurrency || 10);
    const level = requested >= 15 ? 15 : requested >= 12 ? 12 : 10;
    // v5.5.2: the player's Egg tabs cap (Eco/Balanced/Fast) bounds the adaptive level so a
    // sweep never opens more tabs than the CPU budget allows; the level itself keeps adapting.
    const cap = eggTabCap(await storageGet("owehEggTabCap", 0));
    return {
      level,
      concurrency: Math.min(level, cap),
      cleanStreak: Math.max(0, Number(stored.cleanStreak || 0)),
      slowStreak: Math.max(0, Number(stored.slowStreak || 0)),
      avgBatchMs: Math.max(0, Number(stored.avgBatchMs || 0)),
      updatedAt: Number(stored.updatedAt || 0)
    };
  }

  async function updateAdaptiveSpeed(status, elapsedMs = 0) {
    if (!status?.expected) return;
    const profile = await speedProfile();
    const currentIndex = Math.max(0, SPEED_LEVELS.indexOf(profile.level));
    const problems = Number(status.timedOut || 0) + Number(status.systemFailed || 0);
    // A rolling batch (v5.4.0) can drain several windows' worth of eggs. Judge it per window of
    // `concurrency` eggs so a long friend is neither called "slow" for its size nor demoted for
    // one timeout among a hundred clean eggs.
    const windowShare = Math.min(1, profile.concurrency / Number(status.expected));
    const windows = Math.max(1, Math.floor(Number(status.expected) / profile.concurrency));
    const problemBudget = Math.floor((windows - 1) / 3);
    const elapsed = Math.max(0, Math.round(Number(elapsedMs || 0) * windowShare));
    const slow = elapsed >= SLOW_BATCH_MS;
    const verySlow = elapsed >= VERY_SLOW_BATCH_MS;
    let nextIndex = currentIndex;
    let cleanStreak = profile.cleanStreak;
    let slowStreak = profile.slowStreak;

    if (problems > problemBudget || verySlow) {
      nextIndex = Math.max(0, currentIndex - 1);
      cleanStreak = 0;
      slowStreak = 0;
    } else if (slow) {
      cleanStreak = 0;
      slowStreak += 1;
      if (slowStreak >= 2) {
        nextIndex = Math.max(0, currentIndex - 1);
        slowStreak = 0;
      }
    } else if (status.done && Number(status.expected) >= profile.concurrency) {
      slowStreak = 0;
      if (!elapsed || elapsed <= PROMOTE_BATCH_MAX_MS) cleanStreak += Math.max(1, windows - problems);
      else cleanStreak = 0;
      if (cleanStreak >= SPEED_PROMOTE_STREAK && currentIndex < SPEED_LEVELS.length - 1) {
        nextIndex = currentIndex + 1;
        cleanStreak = 0;
      }
    }

    const concurrency = SPEED_LEVELS[nextIndex];
    const avgBatchMs = elapsed
      ? Math.round(profile.avgBatchMs ? (profile.avgBatchMs * 0.7 + elapsed * 0.3) : elapsed)
      : profile.avgBatchMs;
    await storageSet({
      owehEggTabConcurrency: concurrency,
      owehEggSpeedProfile: { concurrency, cleanStreak, slowStreak, avgBatchMs, lastBatchMs: elapsed, updatedAt: Date.now() }
    });
    if (concurrency !== profile.level || slow || problems > 0) {
      diagnosticLog?.(concurrency < profile.level ? "warning" : "info", "friend-eggs", "speed.profile-updated", {
        from: profile.level, to: concurrency, timedOut: status.timedOut || 0,
        systemFailed: status.systemFailed || 0, cleanStreak, slowStreak, elapsedMs: elapsed, avgBatchMs
      });
    }
  }

  async function continueAfterEggFailure(friendId, message) {
    diagnosticLog?.("warning", "friend-eggs", "friend-eggs.fail-open", { friendId, message });
    await runtimeRequest({ type: "eggBatchStop", source: "sweep" });
    await storageSet({
      owehFriendEggState: {},
      owehSweepNotice: { text: message, at: Date.now() }
    });
    setStatus(`${message} — continuing to the next friend`);
    if (friendId && await ownsFriendPage(friendId)) {
      await sweepService.finishFriendSweepStep({ skipRemoval: true });
    }
  }

  function showBatchStatus(status) {
    const resolved = Number(status.resolved ?? ((status.turned || 0) + (status.already || 0) + (status.failed || 0)));
    const successful = Number(status.turned || 0) + Number(status.already || 0);
    setStatus(`Friend eggs: ${resolved}/${status.expected} resolved · ${successful} turned/already · ${status.open} open · ${status.failed || 0} failed · ${status.timedOut || 0} timeout`);
    reportWorkerPhase(`eggs ${resolved}/${status.expected}`);
  }

  // Rolling window: whenever tabs of the running batch resolve, hand the free slots to the next
  // queued eggs right away instead of waiting for the slowest tab of the batch. The background
  // is authoritative (it caps unresolved tabs and refuses a finished batch); eggs it did not
  // take are un-charged and stay queued for the next batch.
  async function topUpBatch(friendId, state, status, rolling) {
    if (rolling.disabled || !status?.ok || status.done || !state.batchId) return false;
    const inFlight = Math.max(0, Number(status.expected || 0) - Number(status.resolved || 0));
    const room = rolling.concurrency - inFlight;
    if (room <= 0) return false;
    const inBatch = new Set((state.batchEggs || []).map(egg => String(egg.id)));
    const next = (state.queue || [])
      .filter(egg => !inBatch.has(String(egg.id)) && Number(state.attempts[String(egg.id)] || 0) < MAX_ATTEMPTS)
      .slice(0, room);
    if (!next.length) return false;
    for (const egg of next) state.attempts[String(egg.id)] = Number(state.attempts[String(egg.id)] || 0) + 1;
    state.batchEggs = [...(state.batchEggs || []), ...next];
    await storageSet({ owehFriendEggState: state });
    const reply = await runtimeRequest({
      type: "eggBatchExtend", source: "sweep", batchId: state.batchId, friendId,
      eggs: next.map(egg => ({ id: egg.id, usr: egg.usr || friendId }))
    });
    const added = new Set(reply?.ok ? (reply.addedIds || []).map(String) : []);
    const refused = next.filter(egg => !added.has(String(egg.id)));
    if (refused.length) {
      const refusedIds = new Set(refused.map(egg => String(egg.id)));
      for (const egg of refused) state.attempts[String(egg.id)] -= 1;
      state.batchEggs = state.batchEggs.filter(egg => !refusedIds.has(String(egg.id)));
      await storageSet({ owehFriendEggState: state });
    }
    // An older background without eggBatchExtend, or any hard refusal: fall back to plain batches.
    if (!reply?.ok && reply?.reason !== "done") rolling.disabled = true;
    if (!added.size) return false;
    diagnosticLog?.("info", "friend-eggs", "batch.extended", { friendId, batchId: state.batchId, added: added.size, expected: reply.expected });
    return true;
  }

  async function waitForBatch(batchId, friendId, topUp = null) {
    const startedAt = Date.now();
    let activeAt = startedAt;
    let status = await runtimeRequest({ type: "eggBatchStatus", batchId });
    while (true) {
      if (!(await ownsFriendPage(friendId))) { clearBatchSignal(batchId); return { outcome: "cancelled", elapsedMs: Date.now() - startedAt }; }
      if (!status?.ok) { clearBatchSignal(batchId); return { outcome: "lost", reason: status?.reason || status?.error, elapsedMs: Date.now() - startedAt }; }
      showBatchStatus(status);
      if (status.done) {
        diagnosticLog?.(Number(status.timedOut || 0) > 0 || Number(status.systemFailed || 0) > 0 ? "warning" : "info",
          "friend-eggs", "batch.completed", {
            friendId, batchId, expected: status.expected, turned: status.turned,
            already: status.already, failed: status.failed, timedOut: status.timedOut || 0
          });
        clearBatchSignal(batchId);
        return { outcome: "done", status, elapsedMs: Date.now() - startedAt };
      }
      if (topUp && await topUp(status)) activeAt = Date.now();
      // The 2-minute coordinator watchdog counts from the latest top-up of a rolling batch.
      if (Date.now() - activeAt > BATCH_TIMEOUT_MS) {
        diagnosticLog?.("warning", "friend-eggs", "batch.coordinator-timeout", { friendId, batchId, elapsedMs: Date.now() - startedAt });
        await runtimeRequest({ type: "eggBatchExpire", batchId });
        const expired = await runtimeRequest({ type: "eggBatchStatus", batchId });
        clearBatchSignal(batchId);
        return { outcome: "batch-timeout", status: expired.ok ? expired : status, elapsedMs: Date.now() - startedAt };
      }
      const pushed = await waitForBatchSignal(batchId);
      status = pushed?.ok ? pushed : await runtimeRequest({ type: "eggBatchStatus", batchId });
    }
  }

  function removeBatchFromQueue(queue, batchEggs) {
    const ids = new Set((batchEggs || []).map(egg => String(egg.id)));
    return (queue || []).filter(egg => !ids.has(String(egg.id)));
  }

  async function finishFriend(friendId, state, message = "") {
    await storageSet({ owehFriendEggState: {} });
    if (message) setStatus(message);
    await sweepService.finishFriendSweepStep({ skipRemoval: Boolean(state.hadEggs) });
  }

  async function finishBatch(friendId, state, waited) {
    if (waited.outcome === "cancelled") return;
    const status = waited.status || {};
    const batchEggs = Array.isArray(state.batchEggs) ? state.batchEggs : [];
    state.batchId = null;
    state.batchEggs = [];

    // A completely lost background batch has no trustworthy per-egg result map. Fail open to the
    // next friend rather than risk duplicate child tabs. Normal tab/batch watchdog completions DO
    // have a result map and therefore continue draining the remaining snapshot.
    if (waited.outcome === "lost" || !status?.ok) {
      await continueAfterEggFailure(friendId, `Friend eggs: batch ${waited.outcome}${waited.reason ? ` (${waited.reason})` : ""}`);
      return;
    }

    state.queue = removeBatchFromQueue(state.queue, batchEggs);
    const results = status.results || {};
    const retry = [];
    for (const egg of batchEggs) {
      const result = results[String(egg.id)] || {};
      const resultState = String(result.state || "");
      if (resultState === "exhausted" || resultState === "timeout") state.attempts[String(egg.id)] = MAX_ATTEMPTS;
      // Explicit UI/browser failures get one bounded retry at the END of the in-memory queue.
      // Timeouts are deferred to a later Full Sweep pass because immediately retrying a slow
      // network tab tends to create another timeout storm.
      if (["failed", "aborted", "abandoned"].includes(resultState)
        && Number(state.attempts[String(egg.id)] || 0) < MAX_ATTEMPTS) retry.push(egg);
    }
    if (retry.length) state.queue.push(...retry);
    state.completedCount = Number(state.completedCount || 0) + Number(status.turned || 0) + Number(status.already || 0);
    await updateAdaptiveSpeed(status, waited.elapsedMs || 0);

    const remaining = (state.queue || []).filter(egg => Number(state.attempts[String(egg.id)] || 0) < MAX_ATTEMPTS);
    state.queue = remaining;
    await storageSet({ owehFriendEggState: state });

    if (Number(status.timedOut || 0) > 0) {
      await storageSet({ owehSweepNotice: { text: `Friend eggs: ${status.timedOut} egg tab(s) timed out — remaining queue continues`, at: Date.now() } });
    }

    if (remaining.length) {
      const profile = await speedProfile();
      setStatus(`Friend eggs: batch resolved — ${remaining.length} queued · next batch up to ${profile.concurrency} tabs`);
      await sleep(BATCH_HANDOFF_MS);
      if (await ownsFriendPage(friendId)) rerunRequested = true;
      return;
    }

    // One final reload/verification per friend. Old versions reloaded after every 10 eggs; this
    // retains correctness while reducing a 100-egg friend from ~10 reloads to one.
    if (state.hadEggs && Number(state.verificationPasses || 0) < 1) {
      state.verificationPasses = 1;
      state.queue = null;
      await storageSet({ owehFriendEggState: state });
      setStatus(`Friend eggs: processed snapshot (${state.completedCount || 0}/${state.initialCount || 0} confirmed) — one final Hatchery verification`);
      await sleep(BATCH_HANDOFF_MS);
      if (await ownsFriendPage(friendId)) pageActions.reloadPage();
      return;
    }

    await finishFriend(friendId, state, state.hadEggs
      ? `Friend eggs: friend complete — ${state.completedCount || 0} egg(s) confirmed from the snapshot`
      : "Friend eggs: no turnable eggs found");
  }

  async function process() {
    if (processing) {
      if (routes.currentFriendId() !== activeFriendId) rerunRequested = true;
      return;
    }
    processing = true;
    activeFriendId = routes.currentFriendId();
    try {
      const friendId = activeFriendId;
      if (!friendId || !(await ownsFriendPage(friendId))) return;
      if (!(await waitForGameReady(30000, { delayMs: FRIEND_READY_DELAY_MS }))) {
        await continueAfterEggFailure(friendId, "Friend eggs: OviPets did not finish loading within the allowed time");
        return;
      }
      await waitForFriendContent(friendId);
      if (!(await ownsFriendPage(friendId))) return;

      let state = await storageGet("owehFriendEggState", {});
      if (state.friendId !== friendId) state = defaultState(friendId);
      else state = { ...defaultState(friendId), ...state, attempts: { ...(state.attempts || {}) } };

      // Recovery after a coordinator/content reload: resume exactly the persisted batch first.
      if (state.batchId) {
        const rolling = { concurrency: (await speedProfile()).concurrency, disabled: false };
        await finishBatch(friendId, state, await waitForBatch(state.batchId, friendId, status => topUpBatch(friendId, state, status, rolling)));
        return;
      }

      if (!Array.isArray(state.queue)) {
        const eggs = await stableEggSnapshot(friendId);
        if (eggs == null) return;
        const snapshot = eggs.map(egg => normalizeEgg(egg, friendId)).filter(Boolean);
        state.queue = snapshot;
        state.hadEggs = Boolean(state.hadEggs || snapshot.length);
        if (!state.initialCount) state.initialCount = snapshot.length;
        state.capturedAt = Date.now();
        await storageSet({ owehFriendEggState: state });
        diagnosticLog?.("info", "friend-eggs", "queue.snapshot", {
          friendId, count: snapshot.length, verificationPass: state.verificationPasses || 0
        });
      }

      let eligible = (state.queue || []).filter(egg => Number(state.attempts[String(egg.id)] || 0) < MAX_ATTEMPTS);
      if (!eligible.length) {
        if (state.hadEggs && Number(state.verificationPasses || 0) < 1) {
          state.verificationPasses = 1;
          state.queue = null;
          await storageSet({ owehFriendEggState: state });
          setStatus("Friend eggs: snapshot drained — one final Hatchery verification");
          await sleep(BATCH_HANDOFF_MS);
          if (await ownsFriendPage(friendId)) pageActions.reloadPage();
          return;
        }
        await finishFriend(friendId, state, state.hadEggs
          ? "Friend eggs: final verification complete — moving to the next friend"
          : "Friend eggs: stable empty Hatchery — moving on");
        return;
      }

      const profile = await speedProfile();
      const batch = eligible.slice(0, profile.concurrency);
      for (const egg of batch) state.attempts[String(egg.id)] = Number(state.attempts[String(egg.id)] || 0) + 1;
      const batchId = `${friendId}-${Date.now()}`;
      state.batchId = batchId;
      state.batchEggs = batch;
      await storageSet({ owehFriendEggState: state });
      setStatus(`Friend eggs: opening ${batch.length} tab(s) · ${eligible.length} queued · adaptive limit ${profile.concurrency}`);
      diagnosticLog?.("info", "friend-eggs", "batch.requested", {
        friendId, batchId, count: batch.length, queued: eligible.length, concurrency: profile.concurrency
      });

      const request = {
        type: "eggBatchOpen",
        source: "sweep",
        batchId,
        friendId,
        eggs: batch.map(egg => ({ id: egg.id, usr: egg.usr || friendId }))
      };
      let opened = await runtimeRequest(request);
      for (let tries = 0; !opened.ok && opened.reason === "busy" && tries < BUSY_RETRY_LIMIT; tries += 1) {
        setStatus("Friend eggs: previous child tabs are closing — retrying quickly");
        await sleep(BUSY_RETRY_MS);
        if (!(await ownsFriendPage(friendId))) return;
        opened = await runtimeRequest(request);
      }

      if (opened.ok && Number.isFinite(opened.expected)) {
        const actuallyOpened = Math.max(0, Math.min(batch.length, Number(opened.expected)));
        for (const egg of batch.slice(actuallyOpened)) state.attempts[String(egg.id)] -= 1;
        state.batchEggs = batch.slice(0, actuallyOpened);
        await storageSet({ owehFriendEggState: state });
      }
      if (!opened.ok) {
        diagnosticLog?.("warning", "friend-eggs", "batch.open-failed", { friendId, batchId, reason: opened.reason || opened.error || "unknown" });
        state.batchId = null;
        state.batchEggs = [];
        await storageSet({ owehFriendEggState: state });
        await continueAfterEggFailure(friendId, `Friend eggs: could not open egg tabs (${opened.reason || opened.error || "unknown"})`);
        return;
      }
      const rolling = { concurrency: profile.concurrency, disabled: false };
      await finishBatch(friendId, state, await waitForBatch(batchId, friendId, status => topUpBatch(friendId, state, status, rolling)));
    } catch (error) {
      diagnosticLog?.("error", "friend-eggs", "step.exception", {
        friendId: activeFriendId || routes.currentFriendId(), message: error?.message || String(error), stack: error?.stack || ""
      });
      console.error("[OviPets Helper] friend egg step failed", error);
      const friendId = activeFriendId || routes.currentFriendId();
      await continueAfterEggFailure(friendId, `Friend eggs failed: ${error?.message || error}`);
    } finally {
      processing = false;
      if (rerunRequested) {
        rerunRequested = false;
        await process();
      }
    }
  }

  return { api: { process, onBatchProgress } };
});
