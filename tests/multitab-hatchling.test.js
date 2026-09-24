"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const ownEggs = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const petIndex = fs.readFileSync(path.join(__dirname, "..", "features", "pet-index.js"), "utf8");
const friendSweep = fs.readFileSync(path.join(__dirname, "..", "features", "friend-sweep.js"), "utf8");
const hatchlings = fs.readFileSync(path.join(__dirname, "..", "features", "hatchlings.js"), "utf8");
const petEdit = fs.readFileSync(path.join(__dirname, "..", "services", "pet-edit.js"), "utf8");
const workerControl = fs.readFileSync(path.join(__dirname, "..", "services", "worker-control.js"), "utf8");
const runtime = `${content}\n${petEdit}\n${workerControl}\n${ownEggs}\n${petIndex}\n${friendSweep}\n${hatchlings}`;
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const workerManagerBg = fs.readFileSync(path.join(__dirname, "..", "bg", "worker-manager.js"), "utf8");
const backgroundRuntime = `${workerManagerBg}\n${background}`;

for (const required of [
  "requestFriendSweepWorker",
  "startFriendSweepWorker",
  'ownerInstance: PANEL_INSTANCE',
  'await isWorkerOwner("sweep")',
  "ownedByThisTab(run)",
  'message?.type === "startSharedWorker"',
  "reportWorkerDone",
  'waitForButtonText("Name", 5000)',
  "unnamed.has(id) || force",
  "Number(b.unnamed) - Number(a.unnamed)",
  "gameActions.namePet(pet.id, desiredName, { unnamed })",
  "owehPets: { [pet.id]: merged }",
  "ownEggsService.onRunFinished?.("
]) {
  if (!runtime.includes(required)) throw new Error(`Multi-tab/Hatchling behavior missing: ${required}`);
}

for (const required of [
  // v5: the sweep and daily worker tabs were unified into one shared, atomically-claimed
  // worker tab (see SHARED_WORKER_TASK_ID) instead of each feature bookkeeping its own
  // chrome.storage.local record and one-shot cleanup alarm.
  "const SHARED_WORKER_TASK_ID",
  "async function claimWorker",
  "async function releaseWorker",
  'message?.type === "claimWorker"',
  'message?.type === "workerDone"',
  'active: false'
]) {
  if (!backgroundRuntime.includes(required)) throw new Error(`Sweep worker background behavior missing: ${required}`);
}

console.log("multi-tab sweep and Unnamed hatchling tests passed");
