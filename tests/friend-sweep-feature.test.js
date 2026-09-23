"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function setup({
  active = false,
  owner = true,
  hash = "#!/?src=pets&sub=hatchery&usr=101",
  queue = [{ id: "101", hatchery: "#!/?src=pets&sub=hatchery&usr=101" }, { id: "202", hatchery: "#!/?src=pets&sub=hatchery&usr=202" }],
  eggCount = 1,
  removeEmpty = true,
  removeResult = { ok: true },
  cooldowns = {},
  blacklist = {},
  index = 0,
  cycle = 1,
  stopDuringLongWait = false
} = {}) {
  const clock = { now: 1_000_000 };
  const store = {
    owehSweep: { active, index, maxFriends: queue.length, cycle, waitingUntil: 0 },
    owehFriendQueue: clone(queue),
    owehFriendCooldowns: clone(cooldowns),
    owehFriendBlacklist: clone(blacklist),
    owehFriendRemoval: { active: false, userId: "" },
    owehFriendEggState: {},
    owehRemoveEmptyFriends: removeEmpty,
    owehOwnUserId: "77"
  };
  const page = { hash };
  const log = {
    status: [], claims: [], releases: [], phases: [], done: 0, navigations: [], reloads: 0,
    runtime: [], taskReleases: [], removeCalls: [], relays: 0, eggProcesses: 0, scans: 0, running: [], reads: {}
  };

  const helpers = {
    storageGet: async (key, fallback) => {
      log.reads[key] = (log.reads[key] || 0) + 1;
      return key in store ? clone(store[key]) : clone(fallback);
    },
    storageSet: async values => { for (const [key, value] of Object.entries(values)) store[key] = clone(value); },
    sleep: async ms => {
      const delay = Number(ms || 0);
      clock.now += delay;
      if (stopDuringLongWait && delay >= 60_000) store.owehSweep.active = false;
      await Promise.resolve();
    },
    setStatus: text => log.status.push(text),
    runtimeRequest: async message => { log.runtime.push(clone(message)); return { ok: true }; },
    requestClaimWorker: async (workerOwner, url) => { log.claims.push([workerOwner, url]); return { ok: true }; },
    requestReleaseWorker: async workerOwner => { log.releases.push(workerOwner); return { ok: true }; },
    reportWorkerPhase: phase => log.phases.push(phase),
    reportWorkerDone: () => { log.done += 1; },
    isWorkerOwner: async expected => owner && expected === "sweep",
    releaseTask: async (id, status) => { log.taskReleases.push([id, status]); return { ok: true }; },
    routes: {
      isFriendHatchery: () => /src=pets&sub=hatchery&usr=\d+/.test(page.hash),
      currentFriendId: () => page.hash.match(/[?&]usr=(\d+)/)?.[1] || null,
      navigateTo: value => { page.hash = value; log.navigations.push(value); }
    },
    hatcheryDom: { getHatcheryEggCount: () => eggCount },
    gameActions: {
      removeFriendDirect: async userId => { log.removeCalls.push(String(userId)); return clone(removeResult); }
    },
    settings: { getPageLoadDelayMs: () => 0 },
    friendDirectory: {
      hasVisibleFriends: () => false,
      scanFriends: async () => { log.scans += 1; },
      getOwnUserId: () => "77"
    },
    friendSweepActions: {
      setRunning: value => log.running.push(Boolean(value)),
      relayNext: () => { log.relays += 1; }
    },
    pageActions: {
      currentHash: () => page.hash,
      reloadPage: () => { log.reloads += 1; }
    }
  };

  const sandbox = vm.createContext({
    console: { error() {} }, Promise, Date: { now: () => clock.now },
    Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  sandbox.OWEH.register("friend-eggs", () => ({ api: { process: () => { log.eggProcesses += 1; } } }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../features/friend-sweep.js"), "utf8"), sandbox, { filename: "friend-sweep.js" });
  const modules = sandbox.OWEH.boot(helpers);
  return { api: modules["feature-friend-sweep"].api, store, page, log, clock };
}

(async () => {
  // Explicit Start also stays alive if every friend is still cooling down from an earlier run:
  // it waits, then starts pass 1 instead of immediately releasing the worker.
  {
    const env = setup({
      active: false,
      cooldowns: { "101": 1_100_000, "202": 1_200_000 },
      hash: "#!/?src=pets&sub=overview"
    });
    await env.api.startWorker();
    assert.equal(env.store.owehSweep.active, true);
    assert.equal(env.store.owehSweep.cycle, 1);
    assert.equal(env.store.owehSweep.index, 0);
    assert.equal(env.log.done, 0);
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=hatchery&usr=101");
    assert.ok(env.log.status.some(text => /waiting/i.test(text)));
  }

  // A saved friend queue is not authority to start consequential automation. Only an already
  // active sweep may auto-resume when a friend Hatchery renders.
  {
    const env = setup({ active: false });
    await env.api.maybeAutoStart();
    assert.equal(env.log.eggProcesses, 0);
    assert.equal(env.store.owehSweep.active, false);
  }

  // Active owner resumes exactly once for the same friend despite repeated refreshes.
  {
    const env = setup({ active: true, owner: true });
    await env.api.maybeAutoStart();
    await env.api.maybeAutoStart();
    assert.equal(env.log.eggProcesses, 1);
  }

  // Next pressed outside the worker owner must relay to the owner instead of navigating the
  // visible tab and rewriting the shared cursor there.
  {
    const env = setup({ active: true, owner: false });
    const before = env.page.hash;
    await env.api.requestNext();
    assert.equal(env.log.relays, 1);
    assert.equal(env.page.hash, before);
    assert.equal(env.store.owehSweep.index, 0);
  }

  // The finish guard is acquired before the first await: overlapping refreshes cannot both
  // enter the permanent zero-egg friend-removal path.
  {
    const env = setup({ active: true, owner: true, eggCount: 0 });
    await Promise.all([env.api.finishStep(), env.api.finishStep()]);
    assert.deepEqual(env.log.removeCalls, ["101"]);
    assert.equal(env.store.owehFriendBlacklist["101"].reason, "zero eggs — removed by UI command");
    assert.equal(env.store.owehSweep.index, 1);
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=hatchery&usr=202");
  }

  // Reaching the end of the queue no longer completes the worker. Full Sweep waits for the
  // earliest cooldown, wraps to the beginning, increments the pass counter and keeps running.
  {
    const env = setup({
      active: true,
      owner: true,
      index: 2,
      queue: [
        { id: "101", hatchery: "#!/?src=pets&sub=hatchery&usr=101" },
        { id: "202", hatchery: "#!/?src=pets&sub=hatchery&usr=202" },
        { id: "303", hatchery: "#!/?src=pets&sub=hatchery&usr=303" }
      ],
      cooldowns: { "101": 1_600_000, "202": 1_700_000, "303": 1_800_000 }
    });
    env.page.hash = "#!/?src=pets&sub=hatchery&usr=303";
    await env.api.advance();
    assert.equal(env.store.owehSweep.active, true);
    assert.equal(env.store.owehSweep.cycle, 2);
    assert.equal(env.store.owehSweep.index, 0);
    assert.equal(env.log.done, 0);
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=hatchery&usr=101");
    assert.ok(env.log.status.some(text => /pass 1 complete/i.test(text)));
    assert.ok(env.log.status.some(text => /pass 2/i.test(text)));
  }

  // A one-friend sweep must reload the same Hatchery when the next pass starts; setting the
  // same SPA hash alone would not trigger a new render/egg scan.
  {
    const env = setup({
      active: true, owner: true, index: 0,
      queue: [{ id: "101", hatchery: "#!/?src=pets&sub=hatchery&usr=101" }],
      cooldowns: { "101": 1_100_000 }
    });
    await env.api.advance();
    assert.equal(env.store.owehSweep.cycle, 2);
    assert.equal(env.log.reloads, 1);
    assert.equal(env.log.done, 0);
  }

  // Stop/durable active=false while the sweep is waiting for cooldown must prevent the next
  // pass from opening any friend. (The real Stop also releases/closes the worker tab.)
  {
    const env = setup({
      active: true, owner: true, index: 1, stopDuringLongWait: true,
      cooldowns: { "101": 1_600_000, "202": 1_700_000 }
    });
    env.page.hash = "#!/?src=pets&sub=hatchery&usr=202";
    await env.api.advance();
    assert.equal(env.store.owehSweep.active, false);
    assert.equal(env.log.navigations.length, 0);
    assert.equal(env.log.reloads, 0);
  }

  // Health recovery must resume from durable pass/index instead of resetting Full Sweep to pass 1.
  {
    const env = setup({ active: true, owner: true, index: 1, cycle: 4, hash: "#!/?src=pets&sub=overview" });
    await env.api.recoverWorker();
    assert.equal(env.store.owehSweep.active, true);
    assert.equal(env.store.owehSweep.cycle, 4, "recovery must preserve the pass counter");
    assert.equal(env.store.owehSweep.index, 1, "recovery must preserve the durable friend cursor");
    assert.equal(env.log.navigations.at(-1), "#!/?src=pets&sub=hatchery&usr=202", "recovery reopens the current friend");
    assert.ok(env.log.phases.some(text => /pass 4 .*recovering 2\/2/.test(text)), `unexpected recovery phase: ${JSON.stringify(env.log.phases)}`);
    assert.ok(env.log.runtime.some(message => message.type === "eggBatchStop" && message.source === "sweep"), "recovery abandons any stuck child batch first");
  }

  // Stop clears durable state even when the worker lease itself is already missing/stale.
  {
    const env = setup({ active: true });
    await env.api.stop();
    assert.equal(env.store.owehSweep.active, false);
    assert.deepEqual(env.log.releases, ["sweep"]);
  }

  // Eligibility scans read the cooldown and blacklist maps once, not twice per skipped friend.
  {
    const queue = Array.from({ length: 200 }, (_, index) => ({ id: String(1000 + index), hatchery: `#!/?src=pets&sub=hatchery&usr=${1000 + index}` }));
    const cooldowns = Object.fromEntries(queue.slice(0, 150).map(friend => [friend.id, 2_000_000]));
    const blacklist = Object.fromEntries(queue.slice(150, 199).map(friend => [friend.id, { at: 1, reason: "zero eggs" }]));
    const env = setup({ active: true, queue, cooldowns, blacklist });
    env.log.reads = {};
    const index = await env.api.nextEligibleIndex(queue, 0, queue.length, 1_000_000);
    assert.equal(index, 199, "only the last friend is neither cooling down nor blacklisted");
    assert.equal(env.log.reads.owehFriendCooldowns, 1);
    assert.equal(env.log.reads.owehFriendBlacklist, 1);
    assert.equal(await env.api.nextEligibleIndex(queue, 0, 199, 1_000_000), -1);
    assert.equal(await env.api.nextEligibleIndex(queue, 0, queue.length, 2_000_001), 0, "expired cooldowns are eligible again");
  }

  console.log("friend sweep feature behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
