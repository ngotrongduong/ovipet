"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../core/storage-client.js", "../core/worker-client.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;

const sent = [];
const runtimeRequests = [];
let workerMirror = null;
globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      sent.push(message);
      if (message.type === "taskClaim") return callback({ ok: true });
      if (message.type === "taskRelease" || message.type === "claimWorker" || message.type === "releaseWorker" || message.type === "taskHeartbeat") {
        runtimeRequests.push(message);
        return callback({ ok: true });
      }
      callback?.({ ok: true });
    }
  },
  storage: {
    local: {
      get(defaults, callback) {
        if (Object.prototype.hasOwnProperty.call(defaults, "owehWorker")) callback({ owehWorker: workerMirror ?? defaults.owehWorker });
        else callback(defaults);
      },
      set(_values, callback) { callback?.(); }
    }
  }
};

require("../jobs/core.js");
require("../core/storage-client.js");
require("../core/worker-client.js");
const worker = globalThis.OWEH.core.workerClient;

(async () => {
  let starts = 0;
  let stops = 0;
  const handler = { start() { starts += 1; }, stop() { stops += 1; } };

  assert.equal(worker.handleStartMessage({ owner: "feed", generation: 10, extra: {} }, handler), true);
  assert.equal(starts, 1);
  assert.equal(worker.getOwner(), "feed");
  assert.equal(worker.getGeneration(), 10);
  assert.equal(sent.filter(message => message.type === "workerStarted").length, 1);

  assert.equal(worker.handleStartMessage({ owner: "feed", generation: 10, extra: {} }, handler), true);
  assert.equal(starts, 1, "duplicate start retry must ACK without invoking the job twice");
  assert.equal(sent.filter(message => message.type === "workerStarted").length, 2);

  assert.equal(worker.handleStartMessage({ owner: "feed", generation: 11 }, handler), false,
    "a different generation must not replace an active local generation");
  assert.equal(starts, 1);

  workerMirror = { owner: "feed", leaseUntil: Date.now() + 10_000 };
  assert.equal(await worker.isWorkerOwner("feed"), true);
  assert.equal(await worker.isWorkerOwner("catalog"), false);

  worker.reportWorkerPhase("halfway");
  assert.deepEqual(sent.at(-1), { type: "workerPhase", generation: 10, phase: "halfway" });

  worker.handleStopMessage({ owner: "feed", generation: 9 }, handler);
  assert.equal(stops, 1);
  assert.equal(worker.getGeneration(), 10, "stale stop must not clear the current generation");
  worker.handleStopMessage({ owner: "feed", generation: 10 }, handler);
  assert.equal(stops, 2);
  assert.equal(worker.getGeneration(), null);

  worker.resync("breed", 20);
  assert.equal(worker.getOwner(), "breed");
  assert.equal(worker.handleStartMessage({ owner: "breed", generation: 20 }, handler), true);
  assert.equal(starts, 2, "resync must not suppress the first real start message after reload");

  worker.reportWorkerDone();
  assert.equal(worker.getOwner(), null);
  assert.equal(worker.getGeneration(), null);
  assert.deepEqual(sent.at(-1), { type: "workerDone", generation: 20 });

  worker.resync("index", 30);
  await worker.heartbeatSharedWorker();
  assert.ok(runtimeRequests.some(message => message.type === "taskHeartbeat" && message.ids[0] === "shared-worker"));

  console.log("worker client behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
