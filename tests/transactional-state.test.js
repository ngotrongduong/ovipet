"use strict";

const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const stateDb = fs.readFileSync(path.join(__dirname, "..", "bg", "state-db.js"), "utf8");
const commandJournal = fs.readFileSync(path.join(__dirname, "..", "bg", "command-journal.js"), "utf8");
const workerManagerBg = fs.readFileSync(path.join(__dirname, "..", "bg", "worker-manager.js"), "utf8");
const backgroundRuntime = `${stateDb}\n${commandJournal}\n${workerManagerBg}\n${background}`;
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const storageClient = fs.readFileSync(path.join(__dirname, "..", "core", "storage-client.js"), "utf8");
const gameBridge = fs.readFileSync(path.join(__dirname, "..", "core", "game-bridge.js"), "utf8");
const workerClient = fs.readFileSync(path.join(__dirname, "..", "core", "worker-client.js"), "utf8");
const gameActions = fs.readFileSync(path.join(__dirname, "..", "core", "game-actions.js"), "utf8");
const ownEggs = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const contentPlatform = `${storageClient}\n${gameBridge}\n${workerClient}\n${gameActions}\n${ownEggs}\n${content}`;

for (const required of [
  'indexedDB.open(STATE_DB_NAME, STATE_DB_VERSION)',
  'createObjectStore("pets", { keyPath: "id" })',
  'createObjectStore("commands", { keyPath: "id" })',
  'createObjectStore("tasks", { keyPath: "id" })',
  'legacyPetsMigrated',
  'message?.type === "petDbGetAll"',
  'message?.type === "petDbMerge"',
  'message?.type === "taskClaim"',
  'message?.type === "taskHeartbeat"',
  'message?.type === "taskRelease"',
  'message?.type === "commandJournalBegin"',
  'message?.type === "commandJournalUpdate"',
  // v5 shared worker tab: one more well-known row in the same "tasks" store, reusing the
  // existing atomic lease machinery instead of the old non-atomic owehSweepWorker/
  // owehDailyWorker chrome.storage.local check-then-set pattern.
  'const SHARED_WORKER_TASK_ID = "shared-worker"',
  'message?.type === "claimWorker"',
  'message?.type === "releaseWorker"',
  'message?.type === "getWorkerStatus"'
]) {
  if (!backgroundRuntime.includes(required)) throw new Error(`Transactional background behavior missing: ${required}`);
}

for (const required of [
  'key === "owehPets"',
  'type: "petDbGetAll"',
  'type: "petDbMerge"',
  'ownerTabId: ownEggsService.getCurrentTabId()',
  'type: "taskHeartbeat"',
  'type: "commandJournalBegin"',
  '`breed:${campaignId}:${motherId}:${fatherId}`',
  'async function isWorkerOwner(expectedOwner)',
  'type: "claimWorker"',
  'type: "releaseWorker"'
]) {
  if (!contentPlatform.includes(required)) throw new Error(`Transactional content behavior missing: ${required}`);
}

if (/chrome\.storage\.local\.set\(\{\s*owehPets:/m.test(contentPlatform)) {
  throw new Error("Direct whole-object pet writes must go through the transactional facade");
}

console.log("transactional database, task lease, and command journal tests passed");
