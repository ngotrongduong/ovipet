"use strict";

const fs = require("fs");
const path = require("path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const ownEggs = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const source = `${content}\n${ownEggs}`;

for (const requirement of [
  "interrupted-for-eggs",
  'requestReleaseWorker("hatchlings")',
  "owehHatchlingQueue",
  "Hatchling processing"
]) {
  if (!source.includes(requirement)) throw new Error(`Hatchery priority requirement missing: ${requirement}`);
}

// v5: the settle-timer auto-start for hatchling processing was removed per the Game
// Owner's explicit decision — every run now needs its own fresh "Process hatchlings"
// press, with no page-load-driven activation of a dormant run.
// The functions themselves are gone (only explanatory comments may still name them for
// history, matching this project's CLAUDE.md convention of documenting removed behavior
// by name) — assert the actual function declarations and their storage/UI surface are
// gone, not just grep for the bare name anywhere including comments.
for (const removed of [
  "HATCHLING_AUTO_START_SETTLE_MS",
  "owehAutoProcessHatchlings",
  "oweh-auto-hatchlings",
  "async function maybeAutoStartHatchlingProcessing",
  "async function maybeAutoClickProfileTurnButton"
]) {
  if (source.includes(removed)) throw new Error(`Removed hatchling/profile auto-start behavior still present: ${removed}`);
}

const startEgg = ownEggs.slice(ownEggs.indexOf("async function start()"), ownEggs.indexOf("async function stop("));
if (!/hatchlingRun\.active[\s\S]+getHatcheryEggs\(\)\.length[\s\S]+active: false/.test(startEgg)) {
  throw new Error("Egg start does not preempt a conflicting Hatchling scan");
}

console.log("hatchery egg-priority tests passed");
