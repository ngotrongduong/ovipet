"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const jobFiles = ["catalog.js", "profiles.js", "sort.js", "feed.js", "ninja.js", "requests.js", "friend-eggs.js", "egg-turn-tab.js"];
for (const name of jobFiles) {
  const source = fs.readFileSync(path.join(root, "jobs", name), "utf8");
  assert.equal(/\blegacy\b/.test(source), false, `${name} must not depend on the legacy helper bag`);
}

const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
assert.equal(/\blegacy\s*:/.test(content), false, "content.js must not inject a legacy helper bag");
for (const required of [
  "routes: OWEH.dom.routes",
  "profileDom: OWEH.dom.profile",
  "hatcheryDom: OWEH.dom.hatchery",
  "gameActions: OWEH.core.gameActions",
  "catalogService:",
  "profileIndexService:",
  "ninjaService:",
  "sweepService:"
]) {
  assert.ok(content.includes(required), `explicit job dependency missing: ${required}`);
}

console.log("job dependency contract tests passed");
