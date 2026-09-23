"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

for (const scriptSet of manifest.content_scripts || []) {
  for (const relative of [...(scriptSet.js || []), ...(scriptSet.css || [])]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, `manifest references missing file: ${relative}`);
  }
}
if (manifest.background?.service_worker) {
  assert.equal(fs.existsSync(path.join(root, manifest.background.service_worker)), true, "background service worker is missing");
}

const isolated = manifest.content_scripts.find(entry => entry.world !== "MAIN" && entry.js?.includes("content.js"));
assert.ok(isolated, "isolated-world content script set is missing");
const order = isolated.js;
const core = order.indexOf("jobs/core.js");
const storageClient = order.indexOf("core/storage-client.js");
const gameBridge = order.indexOf("core/game-bridge.js");
const workerClient = order.indexOf("core/worker-client.js");
const scheduler = order.indexOf("core/scheduler.js");
const routes = order.indexOf("dom/routes.js");
const profile = order.indexOf("dom/profile.js");
const hatchery = order.indexOf("dom/hatchery.js");
const tabs = order.indexOf("dom/tabs.js");
const overview = order.indexOf("dom/overview.js");
const friends = order.indexOf("dom/friends.js");
const chat = order.indexOf("dom/chat.js");
const colors = order.indexOf("domain/colors.js");
const petRecord = order.indexOf("domain/pet-record.js");
const pedigree = order.indexOf("domain/pedigree.js");
const score = order.indexOf("domain/breeding-score.js");
const plan = order.indexOf("domain/breeding-plan.js");
const gameActions = order.indexOf("core/game-actions.js");
const ownEggs = order.indexOf("features/own-eggs.js");
const petIndex = order.indexOf("features/pet-index.js");
const content = order.indexOf("content.js");
assert.ok(core >= 0 && core < storageClient && storageClient < gameBridge && gameBridge < workerClient
  && workerClient < scheduler && scheduler < routes && routes < profile && profile < hatchery && hatchery < tabs
  && tabs < overview && overview < friends && friends < chat && chat < colors && colors < petRecord && petRecord < pedigree
  && pedigree < score && score < plan && plan < gameActions && gameActions < ownEggs && ownEggs < petIndex && petIndex < content,
  "core/domain modules must load after jobs/core.js and before content.js in dependency order");

console.log("manifest integrity and domain load-order tests passed");
