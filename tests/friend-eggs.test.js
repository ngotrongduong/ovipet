"use strict";

// jobs/friend-eggs.js: Fast Sweep snapshots one friend's eggs, drains back-to-back batches,
// then reloads the Hatchery once for final verification. Uses a fake clock so waits cost nothing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({ eggCount = 25, sweepActive = true, turnStrategy = "all", initialStore = {} } = {}) {
  const clock = { now: 1000000 };
  const store = { ...initialStore };
  const log = { opened: [], statuses: [], finished: 0, finishOptions: [], stopped: 0, reloads: 0, expired: 0, forcedStops: 0, phases: [] };
  const hatchery = { eggs: Array.from({ length: eggCount }, (_, i) => ({ id: String(7000 + i), href: `#!/?src=pets&sub=profile&usr=555&pet=${7000 + i}` })) };
  let batch = null;
  let pollsUntilDone = 2;
  const page = { friendId: "555", isFriendHatchery: true, owner: true };

  const helpers = {
    storageGet: async (key, fallback) => (key in store ? JSON.parse(JSON.stringify(store[key])) : fallback),
    storageSet: async values => { for (const [k, v] of Object.entries(values)) store[k] = JSON.parse(JSON.stringify(v)); },
    sleep: async ms => { clock.now += ms; },
    setStatus: text => log.statuses.push(text),
    reportWorkerPhase: text => log.phases.push(text),
    waitForGameReady: async () => true,
    runtimeRequest: async message => {
      if (message.type === "eggBatchOpen") {
        log.opened.push(message);
        if (page.busyFor > 0) { page.busyFor -= 1; return { ok: false, reason: "busy" }; }
        if (page.openFails) return { ok: false, reason: page.openFails };
        const opened = message.eggs.slice(0, page.openLimit || message.eggs.length);
        batch = { id: message.batchId, eggs: opened.map(egg => egg.id), polls: 0 };
        return { ok: true, batchId: message.batchId, expected: opened.length };
      }
      if (message.type === "eggBatchStatus") {
        if (!batch || batch.id !== message.batchId) return { ok: false, reason: "unknown-batch" };
        batch.polls += 1;
        if (batch.expired) {
          const results = Object.fromEntries(batch.eggs.map(id => [id, { state: "timeout", reason: "test-expired" }]));
          return { ok: true, expected: batch.eggs.length, resolved: batch.eggs.length, turned: 0, already: 0, failed: batch.eggs.length, systemFailed: 0, timedOut: batch.eggs.length, open: 0, results, done: true };
        }
        const done = batch.polls >= pollsUntilDone;
        if (page.neverDone) return { ok: true, expected: batch.eggs.length, resolved: 0, turned: 0, already: 0, failed: 0, systemFailed: 0, timedOut: 0, open: batch.eggs.length, results: {}, done: false };
        if (done) {
          const resultState = turnStrategy === "stuck" ? "failed" : "turned";
          const results = Object.fromEntries(batch.eggs.map(id => [id, { state: resultState, reason: resultState === "failed" ? "test-stuck" : "ui-confirmed" }]));
          if (turnStrategy === "all") hatchery.eggs = hatchery.eggs.filter(egg => !batch.eggs.includes(egg.id));
          return {
            ok: true, expected: batch.eggs.length, resolved: batch.eggs.length,
            turned: resultState === "turned" ? batch.eggs.length : 0, already: 0,
            failed: resultState === "failed" ? batch.eggs.length : 0,
            systemFailed: resultState === "failed" ? batch.eggs.length : 0, timedOut: 0,
            open: 0, results, done: true
          };
        }
        return { ok: true, expected: batch.eggs.length, resolved: 1, turned: 1, already: 0, failed: 0, systemFailed: 0, timedOut: 0, open: batch.eggs.length - 1, results: {}, done: false };
      }
      if (message.type === "eggBatchExpire") { log.expired += 1; if (batch) batch.expired = true; return { ok: true }; }
      if (message.type === "eggBatchStop") { log.forcedStops += 1; return { ok: true, closed: batch?.eggs?.length || 0 }; }
      return { ok: false, error: "unexpected " + message.type };
    },
    isWorkerOwner: async () => page.owner,
    routes: {
      isFriendHatchery: () => page.isFriendHatchery,
      currentFriendId: () => page.friendId
    },
    hatcheryDom: { getHatcheryEggs: () => hatchery.eggs.map(egg => ({ ...egg })) },
    sweepService: {
      readSweep: async () => ({ active: sweepActive && page.sweepActive !== false, index: 0, maxFriends: 1 }),
      finishFriendSweepStep: async options => { log.finished += 1; log.finishOptions.push(options || {}); },
      stopFriendSweep: async () => { log.stopped += 1; }
    },
    pageActions: { reloadPage: () => { log.reloads += 1; } }
  };
  const sandbox = vm.createContext({ console: { error() {} }, Promise, Date: { now: () => clock.now }, Object, Array, Set, Map, JSON, Math, Number, String, Boolean });
  for (const file of ["core.js", "friend-eggs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
  }
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["friend-eggs"].api, log, store, page, hatchery, clock };
}

(async () => {
  // 25 eggs -> 10, 10, 5 from one snapshot; only one final verification reload.
  {
    const env = setup();
    for (let round = 0; round < 6 && !env.log.finished; round += 1) await env.api.process();
    assert.deepEqual(env.log.opened.map(request => request.eggs.length), [10, 10, 5], "three batches of 10, 10 and 5");
    assert.equal(env.log.reloads, 1, "the Hatchery reloads only once for final verification");
    assert.equal(env.log.finished, 1, "the sweep moves on exactly once, after the eggs are gone");
    assert.equal(env.log.stopped, 0);
    assert.ok(env.log.opened.every(request => request.eggs.every(egg => egg.usr === "555")), "egg tabs are built for this friend");
    const ids = env.log.opened.flatMap(request => request.eggs.map(egg => egg.id));
    assert.equal(new Set(ids).size, 25, "every egg is sent once, none twice");
    assert.deepEqual(env.store.owehFriendEggState, {}, "the per-friend state is cleared when the friend is done");
  }

  // Eggs that stay turnable are tried at most twice, then the sweep moves on (never loops).
  {
    const env = setup({ eggCount: 3, turnStrategy: "stuck" });
    for (let round = 0; round < 8 && !env.log.finished; round += 1) await env.api.process();
    assert.equal(env.log.opened.length, 2, "an egg is retried once, not forever");
    assert.equal(env.log.finished, 1);
    assert.ok(env.log.statuses.some(text => /final verification|friend complete/i.test(text)), "bounded second pass finishes the friend");
  }

  // No turnable eggs: straight to the sweep's own next step (zero-egg removal lives there).
  {
    const env = setup({ eggCount: 0 });
    await env.api.process();
    assert.equal(env.log.opened.length, 0);
    assert.equal(env.log.finished, 1);
  }

  // Stop / not the owner: does nothing, opens nothing.
  {
    const env = setup({ sweepActive: false });
    await env.api.process();
    assert.equal(env.log.opened.length, 0);
    assert.equal(env.log.finished, 0);
    const other = setup();
    other.page.owner = false;
    await other.api.process();
    assert.equal(other.log.opened.length, 0, "a tab that does not own the sweep never opens egg tabs");
  }

  // A friend Hatchery that is not this friend's page (Next was pressed): no batch.
  {
    const env = setup();
    env.page.isFriendHatchery = false;
    await env.api.process();
    assert.equal(env.log.opened.length, 0);
  }

  // Background refuses a batch: Full Sweep is fail-open. Clean this friend and continue instead of stopping.
  {
    const env = setup();
    env.page.openFails = "random-open-error";
    await env.api.process();
    assert.equal(env.log.stopped, 0, "an egg batch error must not stop continuous Full Sweep");
    assert.equal(env.log.finished, 1, "the sweep advances to the next friend");
    assert.equal(env.log.finishOptions[0].skipRemoval, true, "a failed egg step must never remove the friend as empty");
    assert.ok(env.log.statuses.at(-1).includes("continuing to the next friend"));
    assert.equal(env.store.owehFriendEggState?.batchId ?? null, null, "a failed open must not leave a phantom in-flight batch");
  }

  // Previous friend's tabs still finishing: wait and retry instead of aborting the sweep.
  {
    const env = setup({ eggCount: 2 });
    env.page.busyFor = 2;
    await env.api.process();
    assert.equal(env.log.stopped, 0, "busy is retried, not fatal");
    assert.equal(env.log.opened.length, 3, "two busy answers, then success");
    assert.ok(env.log.statuses.some(text => text.includes("previous child tabs are closing")));
  }

  // A batch that never reports is expired after 2 minutes, force-cleaned, and the sweep advances.
  {
    const env = setup({ eggCount: 2 });
    env.page.neverDone = true;
    await env.api.process();
    await env.api.process(); // simulate the one final verification reload landing
    assert.equal(env.log.expired, 1, "the coordinator gives up at the 2-minute watchdog");
    assert.equal(env.log.forcedStops, 0, "background expiry itself resolves/closes the owned tabs; no extra stop is needed");
    assert.equal(env.log.reloads, 1, "after deferred timeout eggs, only the single final verification reload occurs");
    assert.equal(env.log.finished, 1, "continuous Full Sweep moves to the next friend");
  }

  // A stale saved batch id that background no longer knows is a soft failure: do not duplicate
  // tabs; clean state and advance to the next friend.
  {
    const env = setup({ eggCount: 4, initialStore: { owehFriendEggState: { friendId: "555", attempts: { 7000: 1 }, batchId: "555-earlier" } } });
    await env.api.process();
    assert.equal(env.log.opened.length, 0, "a stale in-flight batch id never opens a duplicate batch");
    assert.equal(env.log.reloads, 0);
    assert.equal(env.log.finished, 1, "lost batch status cannot stall Full Sweep");
    assert.deepEqual(env.store.owehFriendEggState, {});
  }

  // Resuming after a reload mid-batch waits for the same batch instead of opening another.
  {
    const first = setup({ eggCount: 4 });
    first.page.neverDone = true;
    // Simulate the reload landing while waiting: sweep ownership disappears once, then returns.
    let calls = 0;
    const original = first.page;
    Object.defineProperty(original, "owner", { get() { calls += 1; return calls < 20 ? true : false; } });
    await first.api.process();
    assert.equal(first.log.opened.length, 1);
    assert.ok(first.store.owehFriendEggState.batchId, "an interrupted wait keeps its batch id for the next page load");
    assert.equal(first.log.reloads, 0, "a cancelled wait does not reload");
  }

  // Stale content right after the hash changed: eggs whose usr= belongs to another friend are waited out.
  {
    const env = setup({ eggCount: 2 });
    env.hatchery.eggs = env.hatchery.eggs.map(egg => ({ ...egg, href: egg.href.replace("usr=555", "usr=999") }));
    await env.api.process();
    assert.equal(env.log.opened.length, 1, "after the wait it proceeds");
    assert.ok(env.log.opened[0].eggs.every(egg => egg.usr === "999"), "each tab uses the usr= its card carries");
  }

  // A friend that had eggs during this visit is never removed as empty; an empty list on a
  // first look is re-read once before the sweep believes it.
  {
    const env = setup({ eggCount: 3 });
    for (let round = 0; round < 4 && !env.log.finished; round += 1) await env.api.process();
    assert.equal(env.log.finishOptions[0].skipRemoval, true, "eggs existed, so the friend must not be removed as empty");
    const empty = setup({ eggCount: 0 });
    const before = empty.clock.now;
    await empty.api.process();
    assert.ok(empty.clock.now - before >= 750 && empty.clock.now - before < 4000, "empty Hatchery uses a stable-DOM wait instead of the old fixed 4s delay");
    assert.equal(empty.log.finishOptions[0].skipRemoval, false, "a genuinely empty Hatchery may still be handled by the sweep's own rule");
  }

  // Next pressed while the previous friend's step is still running: the new friend is not lost.
  {
    const env = setup({ eggCount: 2 });
    const first = env.api.process();
    env.page.friendId = "777"; // the page moved to another friend while the first call is in flight
    await env.api.process(); // returns at once (busy) but must be remembered
    await first;
    for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
    assert.ok(env.log.opened.some(request => request.friendId === "777"), "the friend the page moved to still gets its egg step");
  }

  // Background opened fewer tabs than asked: un-opened eggs stay queued and are picked up by the next fast batch without double-charging.
  {
    const env = setup({ eggCount: 4 });
    env.page.openLimit = 2;
    await env.api.process();
    assert.equal(env.log.opened[0].eggs.length, 4);
    assert.ok(env.log.opened.length >= 2, "the remaining un-opened eggs are immediately queued into a follow-up batch");
    const attempts = env.store.owehFriendEggState.attempts;
    assert.deepEqual([attempts[7000], attempts[7001], attempts[7002], attempts[7003]], [1, 1, 1, 1], "each egg is charged exactly once when it actually receives a later batch slot");
  }

  // Fail-open reasons are still stored for diagnostics even though the sweep continues.
  {
    const env = setup();
    env.page.openFails = "network-broken";
    await env.api.process();
    assert.ok(env.store.owehSweepNotice.text.includes("network-broken"));
    assert.equal(env.log.stopped, 0);
    assert.equal(env.log.finished, 1);
  }

  // Adaptive Fast Sweep promotes 10 -> 12 -> 15 only after five clean full batches at each
  // level. A large friend therefore gains throughput without starting aggressively at 15.
  {
    const env = setup({ eggCount: 130 });
    await env.api.process();
    await env.api.process(); // final verification reload
    assert.deepEqual(env.log.opened.map(request => request.eggs.length),
      [10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 15, 5],
      "adaptive concurrency should graduate from 10 to 12 to 15");
    assert.equal(env.store.owehEggTabConcurrency, 15);
    assert.equal(env.log.reloads, 1, "130 eggs still require only one final Hatchery reload");
    assert.equal(env.log.finished, 1);
  }

  console.log("friend eggs tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
