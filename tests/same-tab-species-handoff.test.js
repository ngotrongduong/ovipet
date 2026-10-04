"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const ownEggs = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const eggTab = fs.readFileSync(path.join(__dirname, "..", "jobs", "egg-turn-tab.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
const runtime = `${content}\n${ownEggs}\n${eggTab}\n${panel}`;
const species = fs.readFileSync(path.join(__dirname, "..", "jobs", "species-answer.js"), "utf8");
const staticDb = fs.readFileSync(path.join(__dirname, "..", "data", "species-static.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const bridge = fs.readFileSync(path.join(__dirname, "..", "page-bridge.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

for (const required of [
  "async function monitor()",
  "await requestAttention(container)",
  "Name the Species — choose an answer and press OK",
  'type: "speciesVerificationRequired"',
  'type: "speciesStatsBump"',
  "async function settleTurnResult(result)",
  "async function checkRejected()",
  "egg can no longer be turned",
  "saved for review and retrying without it",
  "OWEH_STATIC_SPECIES",
  "rankOptions"
]) {
  if (!species.includes(required)) throw new Error(`Production Species module behavior missing: ${required}`);
}

for (const forbidden of [
  "owehSpeciesMemory", "owehSpeciesShapes", "owehSpeciesAnswerIds",
  "speciesMemoryLearn", "speciesShapeLearn", "species-inspector"
]) {
  if (species.includes(forbidden)) throw new Error(`Production Species runtime still references learning state: ${forbidden}`);
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
  if (!runtime.includes(required)) throw new Error(`UI-tab Species wiring missing: ${required}`);
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

for (const retired of ["oweh:species-trace-control", "oweh:species-source-request", "SPECIES_TRACE_NETWORK_EVENT"]) {
  if (bridge.includes(retired)) throw new Error(`Retired Species trace hook remains in page bridge: ${retired}`);
}

if (!background.includes('"bg/species-stats.js"')) throw new Error("background must load aggregate Species stats service");
for (const retired of ["speciesMemory", "speciesShapes", "openSpeciesReview", "speciesShapeLearn"]) {
  if (background.includes(retired)) throw new Error(`background still exposes retired Species learner: ${retired}`);
}

if (!staticDb.includes("451") || !staticDb.includes("10")) throw new Error("compiled Species database metadata missing");

const scripts = manifest.content_scripts.find(entry => entry.js.includes("content.js")).js;
if (scripts[scripts.length - 1] !== "content.js") throw new Error("content.js must load after every module");
if (scripts.indexOf("jobs/core.js") !== 0) throw new Error("jobs/core.js must load first");
if (!scripts.includes("data/species-static.js") || !scripts.includes("domain/species-shape.js") || !scripts.includes("jobs/species-answer.js")) {
  throw new Error("static Species database, matcher and answerer must all be loaded");
}
if (scripts.includes("jobs/species-inspector.js") || scripts.includes("jobs/species-seed.js")) {
  throw new Error("retired Species learning jobs must not be loaded");
}
if (scripts.indexOf("data/species-static.js") > scripts.indexOf("jobs/species-answer.js")) {
  throw new Error("static Species database must load before the answerer");
}

console.log("production UI-tab Species verification contract tests passed");
