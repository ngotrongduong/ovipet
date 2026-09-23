"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const ownEggs = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const eggTab = fs.readFileSync(path.join(__dirname, "..", "jobs", "egg-turn-tab.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
const runtime = `${content}\n${ownEggs}\n${eggTab}\n${panel}`;
const species = fs.readFileSync(path.join(__dirname, "..", "jobs", "species-answer.js"), "utf8");
const inspector = fs.readFileSync(path.join(__dirname, "..", "jobs", "species-inspector.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const eggTabs = fs.readFileSync(path.join(__dirname, "..", "bg", "egg-tabs.js"), "utf8");
const bridge = fs.readFileSync(path.join(__dirname, "..", "page-bridge.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

for (const required of [
  "async function monitor()",
  "await requestAttention(container)",
  "Name the Species — choose an answer and press OK",
  'type: "speciesVerificationRequired"',
  "async function settleTurnResult(result)",
  "async function checkRejected()",
  "egg can no longer be turned",
  "retrying this same egg without repeating it"
]) {
  if (!species.includes(required)) throw new Error(`Species module behavior missing: ${required}`);
}

for (const required of [
  "species?.dialogOpen()",
  "await species?.checkRejected?.()",
  "await species.monitor()",
  "button.click()",
  "resolving Name the Species before this tab may close",
  'report(eggId, "exhausted"',
  'type: "eggBatchOpen"',
  'source: "own"',
  'OWEH.runHook("onRefresh")'
]) {
  if (!runtime.includes(required)) throw new Error(`UI-tab species wiring missing: ${required}`);
}

if (runtime.includes('sendGameCommand("pet_turn_egg"')) {
  throw new Error("Turn Egg must never use the hidden game-command bridge");
}
for (const required of [
  'purpose === "own-hatch"',
  'img[title="Hatch Egg"]',
  'command === "pet_turn_egg" && !ownHatchCommand'
]) {
  if (!bridge.includes(required)) throw new Error(`Own-Hatch direct command guard missing: ${required}`);
}
for (const required of ["network-incorrect", "network-success", "speciesImageFetch", "getActiveQuestionIdentity", "answerId"]) {
  if (!inspector.includes(required)) throw new Error(`Species Inspector learning contract missing: ${required}`);
}

for (const removed of [
  "openManualSpeciesTab", "owehSpeciesManualSessions", "oweh_species_manual=1",
  "activeManualSpeciesEggIds", "manual-species-handoff"
]) {
  if (content.includes(removed) || background.includes(removed) || species.includes(removed)) {
    throw new Error(`Obsolete species handoff remains: ${removed}`);
  }
}

const scripts = manifest.content_scripts.find(entry => entry.js.includes("content.js")).js;
if (scripts[scripts.length - 1] !== "content.js") throw new Error("content.js must load after every module");
if (scripts.indexOf("jobs/core.js") !== 0) throw new Error("jobs/core.js must load first");
if (!scripts.includes("jobs/species-answer.js") || !scripts.includes("jobs/egg-turn-tab.js")) throw new Error("species/egg-tab modules must be loaded");

console.log("UI-tab species verification contract tests passed");
