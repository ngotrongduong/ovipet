"use strict";

// Full friend-sweep state machine. This module owns the durable sweep cursor, cooldown and
// blacklist policy, worker claim/start/stop lifecycle, per-friend completion/removal flow,
// Next relay, and page-load auto-resume. Friend egg turning itself stays in jobs/friend-eggs.js
// and calls this module through the narrow sweepService contract.
OWEH.register("feature-friend-sweep", helpers => {
  const {
    storageGet, storageSet, sleep, setStatus, runtimeRequest,
    requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone,
    isWorkerOwner, releaseTask, routes, hatcheryDom, gameActions, settings,
    friendDirectory, friendSweepActions, pageActions, diagnosticLog
  } = helpers;

  const FRIEND_COOLDOWN_MS = 10 * 60 * 1000;
  const FRIEND_REMOVAL_TIMEOUT_MS = 45 * 1000;
  const IDLE_RECHECK_MS = 60 * 1000;
  let autoStartedForFriend = null;
  let finishingFriend = false;
  let autoStarting = false;

  function friendEggsApi() {
    return OWEH.get("friend-eggs")?.api || null;
  }

  async function read() {
    return storageGet("owehSweep", { active: false, index: 0, maxFriends: 10, cycle: 1, waitingUntil: 0 });
  }

  async function cooldowns(now = Date.now()) {
    const values = await storageGet("owehFriendCooldowns", {});
    let changed = false;
    for (const [id, until] of Object.entries(values || {})) {
      if (Number(until) <= now) {
        delete values[id];
        changed = true;
      }
    }
    if (changed) await storageSet({ owehFriendCooldowns: values });
    return values || {};
  }

  async function isCoolingDown(userId, now = Date.now()) {
    const values = await cooldowns(now);
    return Number(values[String(userId)] || 0) > now;
  }

  async function setCooldown(userId, now = Date.now()) {
    if (!userId) return;
    const values = await cooldowns(now);
    values[String(userId)] = now + FRIEND_COOLDOWN_MS;
    await storageSet({ owehFriendCooldowns: values });
  }

  async function getBlacklist() {
    return storageGet("owehFriendBlacklist", {});
  }

  async function isBlacklisted(userId) {
    const blacklist = await getBlacklist();
    return Boolean(blacklist[String(userId)]);
  }

  async function blacklist(userId, reason = "", now = Date.now()) {
    if (!userId) return;
    const values = await getBlacklist();
    values[String(userId)] = { at: now, reason };
    await storageSet({ owehFriendBlacklist: values });
  }

  async function nextEligibleIndex(queue, startIndex, maxFriends, now = Date.now()) {
    const limit = Math.min(queue.length, maxFriends);
    if (Math.max(0, startIndex) >= limit) return -1;
    // Read both maps once: the per-friend helpers cost two storage round trips (plus a possible
    // cooldown prune write) for every skipped friend in a long queue.
    const cooldownMap = await cooldowns(now);
    const blacklistMap = await getBlacklist();
    for (let index = Math.max(0, startIndex); index < limit; index += 1) {
      const id = String(queue[index].id);
      if (Number(cooldownMap[id] || 0) > now) continue;
      if (blacklistMap[id]) continue;
      return index;
    }
    return -1;
  }

  async function requestStart() {
    diagnosticLog?.("info", "friend-sweep", "sweep.start-requested", {});
    let queue = await storageGet("owehFriendQueue", []);
    if (!queue.length && friendDirectory.hasVisibleFriends()) {
      await friendDirectory.scanFriends();
      queue = await storageGet("owehFriendQueue", []);
    }
    const cachedOwnId = await storageGet("owehOwnUserId", friendDirectory.getOwnUserId() || "");
    const workerUrl = queue.length || !cachedOwnId
      ? "https://ovipets.com/#!/?src=pets&sub=overview"
      : `https://ovipets.com/#!/?usr=${cachedOwnId}`;
    setStatus(queue.length
      ? `Claiming the shared background tab for ${queue.length} friend(s)...`
      : "Claiming the shared background tab to scan Friends, then sweep...");
    const response = await requestClaimWorker("sweep", workerUrl);
    if (!response.ok) {
      diagnosticLog?.("warning", "friend-sweep", "sweep.start-rejected", { reason: response.reason || response.error || "unknown", owner: response.owner || null, phase: response.phase || null });
      if (response.reason === "busy") {
        setStatus(`Shared background tab is busy running "${response.owner}" (${response.phase || "working"}) — stop it first, then try again`);
      } else {
        setStatus(`Could not start background sweep${response.error ? `: ${response.error}` : ""}`);
      }
      return;
    }
    diagnosticLog?.("info", "friend-sweep", response.alreadyRunning ? "sweep.already-running" : "sweep.worker-started", { queueLength: queue.length, tabId: response.tabId || null, generation: response.generation || null });
    setStatus(response.alreadyRunning
      ? "Friend sweep is already running in the shared background tab"
      : "Friend sweep started in the shared background tab; this tab remains free");
  }

  async function startWorker(_generation, extra = {}) {
    diagnosticLog?.("info", "friend-sweep", "sweep.worker-initializing", { resume: Boolean(extra?.resume) });
    // Unconfirmed egg tabs left open by an earlier sweep are extension-owned; clear them so
    // they cannot block this run's batches.
    await runtimeRequest({ type: "eggBatchStop", source: "sweep" });
    await sleep(Math.max(400, Math.min(settings.getPageLoadDelayMs(), 750)));
    let queue = await storageGet("owehFriendQueue", []);
    if (!queue.length && friendDirectory.hasVisibleFriends()) {
      await friendDirectory.scanFriends();
      queue = await storageGet("owehFriendQueue", []);
    }
    if (!queue.length) {
      setStatus("Scan the friend list first");
      reportWorkerDone();
      return;
    }
    const maxFriends = queue.length;
    const firstIndex = await nextEligibleIndex(queue, 0, maxFriends);
    autoStartedForFriend = null;
    if (firstIndex < 0) {
      const initial = { active: true, index: -1, maxFriends, cycle: 1, waitingUntil: 0 };
      await storageSet({ owehSweep: initial, owehFriendEggState: {} });
      const restart = await waitForNextCycle(queue, initial, { targetCycle: 1, announceCompleted: false });
      if (!restart) return;
      await sleep(100);
      openSweepFriend(restart.queue, restart.index);
      return;
    }
    await storageSet({ owehSweep: { active: true, index: firstIndex, maxFriends, cycle: 1, waitingUntil: 0 }, owehFriendEggState: {} });
    diagnosticLog?.("info", "friend-sweep", "sweep.pass-started", { cycle: 1, index: firstIndex, maxFriends, friendId: queue[firstIndex]?.id || null });
    reportWorkerPhase(`pass 1 · sweeping ${firstIndex + 1}/${maxFriends}`);
    setStatus(`Starting full sweep pass 1: ${maxFriends} friend(s)`);
    routes.navigateTo(queue[firstIndex].hatchery);
  }

  async function recoverWorker() {
    const sweep = await read();
    if (!sweep.active) return false;
    let queue = await storageGet("owehFriendQueue", []);
    if (!queue.length) return false;

    // A recovery is fail-open: abandon any child egg batch that may have been left waiting,
    // then resume from durable sweep state. The coordinator tab itself is never closed here.
    await runtimeRequest({ type: "eggBatchStop", source: "sweep" });
    autoStartedForFriend = null;
    const cycle = Math.max(1, Number(sweep.cycle || 1));
    const index = Number(sweep.index);
    diagnosticLog?.("warning", "friend-sweep", "sweep.recovering", { cycle, index, maxFriends: sweep.maxFriends, waitingUntil: sweep.waitingUntil || 0 });

    if (Number(sweep.waitingUntil || 0) > Date.now()) {
      const restart = await waitForNextCycle(queue, sweep, { targetCycle: cycle + 1, announceCompleted: false });
      if (!restart) return false;
      await sleep(100);
      openSweepFriend(restart.queue, restart.index);
      return true;
    }

    if (index >= 0 && index < queue.length && queue[index]?.hatchery) {
      reportWorkerPhase(`pass ${cycle} · recovering ${index + 1}/${sweep.maxFriends || queue.length}`);
      setStatus(`Full sweep recovered — reopening friend ${index + 1}/${sweep.maxFriends || queue.length}`);
      openSweepFriend(queue, index);
      return true;
    }

    const nextIndex = await nextEligibleIndex(queue, 0, sweep.maxFriends || queue.length);
    if (nextIndex >= 0) {
      const recovered = { ...sweep, index: nextIndex, waitingUntil: 0 };
      await storageSet({ owehSweep: recovered });
      reportWorkerPhase(`pass ${cycle} · recovering ${nextIndex + 1}/${recovered.maxFriends || queue.length}`);
      openSweepFriend(queue, nextIndex);
      return true;
    }
    return false;
  }

  function stopLocal() {
    diagnosticLog?.("warning", "friend-sweep", "sweep.stopped-local", {});
    autoStartedForFriend = null;
    storageSet({
      owehSweep: { active: false, index: 0, maxFriends: 0, cycle: 1, waitingUntil: 0 },
      owehEggRun: { active: false, hatchery: "", count: 0 },
      owehFriendRemoval: { active: false, userId: "" },
      owehFriendEggState: {},
      owehAutoTurn: false
    });
    runtimeRequest({ type: "eggBatchStop", source: "sweep" });
    releaseTask("egg-run", "stopped");
    friendSweepActions.setRunning(false);
    setStatus("Friend sweep stopped");
  }

  async function stop() {
    diagnosticLog?.("warning", "friend-sweep", "sweep.stop-requested", {});
    // Clear durable sweep state even if no live worker lease remains; otherwise a stale
    // active flag can block independent egg turning forever.
    const sweep = await read();
    if (sweep.active) await storageSet({ owehSweep: { active: false, index: 0, maxFriends: 0, cycle: 1, waitingUntil: 0 } });
    await requestReleaseWorker("sweep");
  }

  async function goNext() {
    await runtimeRequest({ type: "eggBatchStop", source: "sweep" });
    const queue = await storageGet("owehFriendQueue", []);
    const sweep = await read();
    const maxFriends = sweep.active ? sweep.maxFriends : queue.length;
    const nextIndex = await nextEligibleIndex(queue, sweep.active ? sweep.index + 1 : 0, maxFriends);
    if (nextIndex < 0 || !queue[nextIndex]) return setStatus("No eligible next friend in the queue");
    await storageSet({ owehSweep: { ...sweep, index: nextIndex, active: sweep.active } });
    routes.navigateTo(queue[nextIndex].hatchery);
  }

  async function requestNext() {
    const sweep = await read();
    if (sweep.active && !(await isWorkerOwner("sweep"))) {
      setStatus("Sweep is running in the shared background tab — sending Next there");
      friendSweepActions.relayNext();
      return;
    }
    await goNext();
  }

  function formatWait(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes && seconds) return `${minutes}m ${seconds}s`;
    if (minutes) return `${minutes}m`;
    return `${seconds}s`;
  }

  async function nextCycleCandidate(queue, maxFriends, now = Date.now()) {
    const limit = Math.min(queue.length, maxFriends);
    const blacklist = await getBlacklist();
    const cooldownMap = await cooldowns(now);
    let earliestUntil = Infinity;
    let hasNonBlacklisted = false;

    for (let index = 0; index < limit; index += 1) {
      const id = String(queue[index].id);
      if (blacklist[id]) continue;
      hasNonBlacklisted = true;
      const until = Number(cooldownMap[id] || 0);
      if (until <= now) return { index, waitMs: 0, hasNonBlacklisted: true };
      earliestUntil = Math.min(earliestUntil, until);
    }

    return {
      index: -1,
      waitMs: Number.isFinite(earliestUntil) ? Math.max(1000, earliestUntil - now) : IDLE_RECHECK_MS,
      hasNonBlacklisted
    };
  }

  async function waitForNextCycle(queue, sweep, options = {}) {
    const cycle = Math.max(1, Number(sweep.cycle || 1));
    const nextCycle = Math.max(1, Number(options.targetCycle || (cycle + 1)));
    const announceCompleted = options.announceCompleted !== false;
    autoStartedForFriend = null;
    await storageSet({ owehFriendEggState: {} });

    while (true) {
      const current = await read();
      if (!current.active || !(await isWorkerOwner("sweep"))) return null;

      // Re-read the queue each time so a manual rescan/edit made while the worker waits is
      // observed without needing to restart Full Sweep.
      queue = await storageGet("owehFriendQueue", queue);
      const candidate = await nextCycleCandidate(queue, current.maxFriends);
      if (candidate.index >= 0 && queue[candidate.index]) {
        diagnosticLog?.("info", "friend-sweep", "sweep.pass-resumed", { cycle: nextCycle, index: candidate.index, maxFriends: current.maxFriends, friendId: queue[candidate.index]?.id || null });
        const restarted = {
          ...current,
          index: candidate.index,
          cycle: nextCycle,
          waitingUntil: 0
        };
        await storageSet({ owehSweep: restarted, owehFriendEggState: {} });
        reportWorkerPhase(`pass ${nextCycle} · sweeping ${candidate.index + 1}/${current.maxFriends}`);
        setStatus(`Full sweep pass ${nextCycle} — opening ${candidate.index + 1}/${current.maxFriends}`);
        return { sweep: restarted, queue, index: candidate.index };
      }

      const waitMs = candidate.waitMs || IDLE_RECHECK_MS;
      diagnosticLog?.("info", "friend-sweep", "sweep.waiting", { cycle, nextCycle, waitMs, hasNonBlacklisted: candidate.hasNonBlacklisted });
      const waitingUntil = Date.now() + waitMs;
      await storageSet({ owehSweep: { ...current, cycle, waitingUntil } });
      if (announceCompleted) {
        reportWorkerPhase(candidate.hasNonBlacklisted
          ? `pass ${cycle} complete · cooldown`
          : `pass ${cycle} complete · no eligible friends`);
        setStatus(candidate.hasNonBlacklisted
          ? `Full sweep pass ${cycle} complete — pass ${nextCycle} starts in about ${formatWait(waitMs)} (Stop to end)`
          : `Full sweep pass ${cycle} complete — no eligible friends right now; waiting for Stop or queue changes`);
      } else {
        reportWorkerPhase(candidate.hasNonBlacklisted
          ? `pass ${nextCycle} · waiting cooldown`
          : `pass ${nextCycle} · no eligible friends`);
        setStatus(candidate.hasNonBlacklisted
          ? `Full sweep is waiting about ${formatWait(waitMs)} before pass ${nextCycle} can start (Stop to end)`
          : `Full sweep has no eligible friends right now; waiting for Stop or queue changes`);
      }
      await sleep(waitMs);
    }
  }

  function openSweepFriend(queue, index) {
    const target = queue[index]?.hatchery;
    if (!target) return;
    autoStartedForFriend = null;
    if (pageActions.currentHash() === target && typeof pageActions.reloadPage === "function") pageActions.reloadPage();
    else routes.navigateTo(target);
  }

  async function advance() {
    const sweep = await read();
    if (!sweep.active || !(await isWorkerOwner("sweep"))) return;
    let queue = await storageGet("owehFriendQueue", []);
    let nextIndex = await nextEligibleIndex(queue, sweep.index + 1, sweep.maxFriends);

    if (nextIndex < 0) {
      const restart = await waitForNextCycle(queue, sweep);
      if (!restart) return;
      queue = restart.queue;
      nextIndex = restart.index;
      await sleep(100);
      openSweepFriend(queue, nextIndex);
      return;
    }

    const cycle = Math.max(1, Number(sweep.cycle || 1));
    await storageSet({ owehSweep: { ...sweep, index: nextIndex, cycle, waitingUntil: 0 } });
    diagnosticLog?.("info", "friend-sweep", "sweep.friend-advance", { cycle, index: nextIndex, maxFriends: sweep.maxFriends, friendId: queue[nextIndex]?.id || null });
    reportWorkerPhase(`pass ${cycle} · sweeping ${nextIndex + 1}/${sweep.maxFriends}`);
    setStatus(`Friend complete — pass ${cycle}, opening ${nextIndex + 1}/${sweep.maxFriends}`);
    await sleep(100);
    openSweepFriend(queue, nextIndex);
  }

  async function finishStep({ skipRemoval = false } = {}) {
    // Synchronous guard acquisition is intentional: two MutationObserver refreshes must not
    // both enter the destructive friend-removal path before the first await completes.
    if (finishingFriend) return;
    finishingFriend = true;
    try {
      const sweep = await read();
      if (!sweep.active || !(await isWorkerOwner("sweep")) || !routes.isFriendHatchery()) return;
      const pendingRemoval = await storageGet("owehFriendRemoval", { active: false });
      const removalIsStale = pendingRemoval.active
        && (Date.now() - (pendingRemoval.startedAt || 0) > FRIEND_REMOVAL_TIMEOUT_MS);
      if (pendingRemoval.active && !removalIsStale) return;
      if (removalIsStale) {
        diagnosticLog?.("warning", "friend-sweep", "friend-removal.timeout", { friendId: pendingRemoval.userId || routes.currentFriendId() });
        setStatus("A previous friend-removal attempt timed out — resuming the sweep");
        await storageSet({ owehFriendRemoval: { active: false, userId: "" } });
      }
      const removeEmpty = await storageGet("owehRemoveEmptyFriends", true);
      if (removeEmpty && !skipRemoval && hatcheryDom.getHatcheryEggCount() === 0) {
        const userId = routes.currentFriendId();
        if (userId) {
          await storageSet({
            owehFriendRemoval: {
              active: true, userId, hatchery: pageActions.currentHash(), startedAt: Date.now()
            }
          });
          setStatus("No eggs found — removing friend with the game's UI command");
          const result = await gameActions.removeFriendDirect(userId);
          if (result.ok) {
            diagnosticLog?.("info", "friend-sweep", "friend.removed-zero-eggs", { friendId: userId });
            await blacklist(userId, "zero eggs — removed by UI command");
            await storageSet({ owehFriendRemoval: { active: false, userId: "" } });
            setStatus("Friend removed because the Hatchery had zero eggs — added to blacklist");
            await advance();
            return;
          }
          await storageSet({ owehFriendRemoval: { active: false, userId: "" } });
          diagnosticLog?.("warning", "friend-sweep", "friend-removal.failed", { friendId: userId, reason: result.reason || "unknown" });
          setStatus(`Direct friend removal failed (${result.reason || "unknown"}); keeping the friend and continuing`);
        }
      }
      await setCooldown(routes.currentFriendId());
      await advance();
    } finally {
      finishingFriend = false;
    }
  }

  async function maybeAutoStart() {
    if (autoStarting || !routes.isFriendHatchery()) return;
    autoStarting = true;
    try {
      // Resume only an already-active sweep. A dormant queue must never turn into a
      // consequential automation merely because the user opened a friend's Hatchery.
      const sweep = await read();
      const id = routes.currentFriendId();
      if (!sweep.active || !(await isWorkerOwner("sweep")) || !id || autoStartedForFriend === id) return;
      autoStartedForFriend = id;
      await sleep(250);
      if (!(sweep.active && routes.currentFriendId() === id)) return;
      const friendEggs = friendEggsApi();
      if (friendEggs) friendEggs.process();
      else {
        setStatus("Friend egg module failed to load — sweep stopped (reload the extension)");
        await stop();
      }
    } finally {
      autoStarting = false;
    }
  }

  return {
    api: {
      read,
      requestStart,
      startWorker,
      recoverWorker,
      stopLocal,
      stop,
      goNext,
      requestNext,
      advance,
      finishStep,
      maybeAutoStart,
      getBlacklist,
      blacklist,
      isBlacklisted,
      setCooldown,
      nextEligibleIndex,
      isFinishing: () => finishingFriend
    }
  };
});
