"use strict";

// Release-contract guard for v5.3.11 Fast Sweep. Behavioral queue/adaptive semantics live in
// friend-eggs.test.js and egg-tabs.test.js; this file prevents the tuned fast-path constants and
// event-driven wiring from silently regressing in a later refactor.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const tabs = read("bg/egg-tabs.js");
const friendEggs = read("jobs/friend-eggs.js");
const eggTurn = read("jobs/egg-turn-tab.js");
const species = read("jobs/species-answer.js");
const sweep = read("features/friend-sweep.js");
const workerControl = read("services/worker-control.js");

assert.match(tabs, /EGG_TAB_MAX = 15/);
assert.match(tabs, /EGG_TAB_STAGGER_MS = 175/);
assert.match(tabs, /publishEggBatchProgress/);
assert.match(friendEggs, /SPEED_LEVELS = \[10, 12, 15\]/);
assert.match(friendEggs, /SPEED_PROMOTE_STREAK = 5/);
assert.match(friendEggs, /EMPTY_STABLE_MS = 750/);
assert.match(friendEggs, /POLL_FALLBACK_MS = 2000/);
assert.match(friendEggs, /one final Hatchery verification/i);
assert.match(eggTurn, /POST_CLICK_SETTLE_MS = 250/);
assert.match(eggTurn, /species-incorrect" \? 400 : 750/);
assert.match(species, /Date\.now\(\) \+ 600/);
assert.match(workerControl, /message\?\.type === "eggBatchProgress"/);
assert.match(sweep, /await sleep\(250\)/);

console.log("Fast Sweep v5.3.11 release contract tests passed");
