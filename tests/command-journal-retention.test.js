"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");

const clock = { now: 200 * 24 * 60 * 60 * 1000 };
const chrome = { storage: { local: { get: async defaults => defaults } } };
const context = vm.createContext({ chrome, indexedDB: createFakeIndexedDB(), Date: { now: () => clock.now }, console, Promise, Set, Map, Object, Array, String, Number, Boolean, Math });
for (const file of ["bg/state-db.js", "bg/command-journal.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
}
const journal = context.OWEH_BG.commandJournal;

async function createAt(id, ageDays, status) {
  const finalNow = 200 * 24 * 60 * 60 * 1000;
  clock.now = finalNow - ageDays * 24 * 60 * 60 * 1000;
  await journal.journalBegin({ id, command: "pet_breed", targetId: id });
  if (status !== "queued") await journal.journalUpdate(id, { status, dispatchedAt: clock.now });
  clock.now = finalNow;
}

(async () => {
  await createAt("queued-old", 2, "queued");
  await createAt("queued-fresh", 0.5, "queued");
  await createAt("confirmed-old", 31, "callback-confirmed");
  await createAt("rejected-old", 31, "rejected");
  await createAt("confirmed-fresh", 29, "game-state-confirmed");
  await createAt("dispatched-mid", 31, "dispatched");
  await createAt("dispatched-old", 91, "dispatched");
  await createAt("unknown-old", 180, "manual-review");

  const finalNow = clock.now;
  const result = await journal.pruneOldCommands(finalNow, true);
  assert.equal(result.pruned, 4);
  const ids = (await journal.getAllCommands()).map(row => row.id).sort();
  assert.deepEqual(ids, ["confirmed-fresh", "dispatched-mid", "queued-fresh", "unknown-old"]);

  const skipped = await journal.pruneOldCommands(finalNow + 60_000, false);
  assert.equal(skipped.skipped, true, "pruning should be rate-limited within the same service-worker lifetime");

  const afterDay = await journal.pruneOldCommands(finalNow + 25 * 60 * 60 * 1000, false);
  assert.equal(afterDay.skipped, false, "pruning may run again after the 24-hour interval");
  assert.equal(afterDay.pruned, 2, "records that cross their retention boundary should be removed on the next daily pass");
  assert.deepEqual((await journal.getAllCommands()).map(row => row.id).sort(), ["dispatched-mid", "unknown-old"]);

  console.log("command journal retention tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
