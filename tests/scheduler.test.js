"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

delete require.cache[require.resolve(path.join(__dirname, "../jobs/core.js"))];
delete require.cache[require.resolve(path.join(__dirname, "../core/scheduler.js"))];
delete globalThis.OWEH;
require("../jobs/core.js");
require("../core/scheduler.js");
const schedulerApi = globalThis.OWEH.core.scheduler;

(async () => {
  const batches = [];
  const scheduler = schedulerApi.createRefreshScheduler(batch => batches.push(batch), 5);
  scheduler.schedule(undefined, "dom");
  scheduler.schedule(undefined, "storage");
  assert.equal(scheduler.isScheduled(), true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(batches.length, 1, "a mutation burst must coalesce into one refresh");
  assert.deepEqual(new Set(batches[0].reasons), new Set(["dom", "storage"]));

  const owned = { nodeType: 1, dataset: { owehBridgeOwned: "1" }, closest: () => null };
  const game = { nodeType: 1, dataset: {}, closest: () => null };
  assert.equal(schedulerApi.shouldIgnoreBridgeMutations([{ addedNodes: [owned], removedNodes: [] }]), true);
  assert.equal(schedulerApi.shouldIgnoreBridgeMutations([{ addedNodes: [owned, game], removedNodes: [] }]), false,
    "mixed game + extension mutation batches must still refresh");

  scheduler.schedule(50, "dom");
  scheduler.cancel();
  assert.equal(scheduler.isScheduled(), false);

  console.log("refresh scheduler behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
