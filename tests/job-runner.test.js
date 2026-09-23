"use strict";

// jobs/runner.js: the shared plumbing every one-button job uses (claim, busy message, game
// readiness, cancellation, error handling, releasing the tab when work ends).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(helpers) {
  const sandbox = vm.createContext({ console: { error() {} }, Promise, setTimeout });
  for (const file of ["core.js", "runner.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
  }
  sandbox.OWEH.boot(helpers);
  return sandbox.OWEH.get("runner").api.createJob;
}

function makeHelpers(overrides = {}) {
  const log = { statuses: [], phases: [], done: 0, claims: [], releases: [] };
  const helpers = {
    setStatus: text => log.statuses.push(text),
    reportWorkerPhase: text => log.phases.push(text),
    reportWorkerDone: () => { log.done += 1; },
    waitForGameReady: async () => true,
    requestClaimWorker: async (owner, url) => { log.claims.push({ owner, url }); return { ok: true }; },
    requestReleaseWorker: async owner => { log.releases.push(owner); return { ok: true }; },
    ...overrides
  };
  return { helpers, log };
}

(async () => {
  // Normal run: waits for the game, runs, reports done exactly once.
  {
    const { helpers, log } = makeHelpers();
    const createJob = load(helpers);
    let ran = 0;
    const job = createJob({ owner: "demo", label: "Demo", url: "https://ovipets.com/x", run: async ctx => { ran += 1; ctx.phase("working"); } });
    await job.workerHandler.start(1, {});
    assert.equal(ran, 1);
    assert.equal(log.done, 1, "a finished job must release the shared tab");
    assert.deepEqual([...log.phases], ["working"]);
  }

  // The game never becomes ready: nothing runs, the tab is still released.
  {
    const { helpers, log } = makeHelpers({ waitForGameReady: async () => false });
    const createJob = load(helpers);
    let ran = 0;
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async () => { ran += 1; } });
    await job.workerHandler.start(1, {});
    assert.equal(ran, 0, "a job must not touch anything before the game has loaded");
    assert.equal(log.done, 1);
    assert.ok(log.statuses.some(text => text.includes("did not finish loading")));
  }

  // A throwing job reports the error and still releases the tab.
  {
    const { helpers, log } = makeHelpers();
    const createJob = load(helpers);
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async () => { throw new Error("boom"); } });
    await job.workerHandler.start(1, {});
    assert.equal(log.done, 1);
    assert.ok(log.statuses.some(text => text.includes("failed: boom")));
  }

  // Stop is cooperative and does not double-release (releaseWorker already does it).
  {
    const { helpers, log } = makeHelpers();
    const createJob = load(helpers);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let sawCancel = false;
    let began = false;
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async ctx => { began = true; await gate; sawCancel = ctx.isCancelled(); } });
    const started = job.workerHandler.start(1, {});
    while (!began) await new Promise(resolve => setTimeout(resolve, 1));
    job.workerHandler.stop();
    release();
    await started;
    assert.equal(sawCancel, true, "the job must be able to see that Stop was pressed");
    assert.equal(log.done, 0, "a stopped job must not report done a second time");
  }

  // Stop pressed while waiting for the game: the job must never run afterwards.
  {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { helpers, log } = makeHelpers({ waitForGameReady: () => gate.then(() => true) });
    const createJob = load(helpers);
    let ran = 0;
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async () => { ran += 1; } });
    const started = job.workerHandler.start(1, {});
    job.workerHandler.stop();
    release();
    await started;
    assert.equal(ran, 0, "a job stopped while waiting for the game must not start working");
    assert.equal(log.done, 0);
  }

  // A second Start while running is ignored.
  {
    const { helpers } = makeHelpers();
    const createJob = load(helpers);
    let ran = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async () => { ran += 1; await gate; } });
    const first = job.workerHandler.start(1, {});
    await job.workerHandler.start(2, {});
    release();
    await first;
    assert.equal(ran, 1);
  }

  // manualDone: the driver reports completion, so the runner must not release early.
  {
    const { helpers, log } = makeHelpers();
    const createJob = load(helpers);
    const job = createJob({ owner: "demo", label: "Demo", url: "u", manualDone: true, run: async () => {} });
    await job.workerHandler.start(1, {});
    assert.equal(log.done, 0);
  }

  // Panel button handlers: busy refusal is explained, alreadyRunning is reported, Stop releases by owner.
  {
    const { helpers, log } = makeHelpers({
      requestClaimWorker: async () => ({ ok: false, reason: "busy", owner: "feed", phase: "feeding 3/9" })
    });
    const createJob = load(helpers);
    const job = createJob({ owner: "demo", label: "Demo", url: "u", run: async () => {} });
    await job.request();
    assert.ok(log.statuses.some(text => text.includes('busy running "feed" (feeding 3/9)')));
    await job.stop();
    assert.deepEqual([...log.releases], ["demo"], "Stop must release only its own job");
    const wired = job.buttons("#a", "#b");
    assert.equal(Object.keys(wired).join(","), "#a,#b");
  }

  console.log("job runner tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
