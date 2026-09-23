"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const domain = ["colors.js", "pedigree.js", "breeding-score.js", "breeding-plan.js"]
  .map(name => fs.readFileSync(path.join(__dirname, "..", "domain", name), "utf8")).join("\n");
const profileDom = fs.readFileSync(path.join(__dirname, "..", "dom", "profile.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
const plannerSource = `${content}\n${profileDom}\n${domain}\n${panel}`;
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const commandJournal = fs.readFileSync(path.join(__dirname, "..", "bg", "command-journal.js"), "utf8");
const stateHealth = fs.readFileSync(path.join(__dirname, "..", "bg", "state-health.js"), "utf8");
const backgroundRuntime = `${background}\n${commandJournal}\n${stateHealth}`;
const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

for (const required of [
  "const DEFAULT_MALE_SHORTLIST_SIZE = 40",
  "function body1ExactMask(pet, target)",
  "function shortlistMales(female, males, target",
  ".slice(0, Math.max(1, limit))",
  "function recentMaleUsage(history, now,",
  "function lineageKey(pet)",
  "usageCount:",
  "lineageUse:",
  "function pedigreeAncestorGraph(",
  "parentIds:",
  "function waitForStableValue(readValue",
  "function fastFingerprint(text)",
  "owehEnclosureSnapshots",
  "owehEnclosureScanStats",
  'type: "reconcileBreedCommands"',
  'id="oweh-refresh-health"',
  'id="oweh-db-health"'
]) {
  if (!plannerSource.includes(required)) throw new Error(`Scalable planner/UI behavior missing: ${required}`);
}

for (const required of [
  "async function read(now = Date.now())",
  'message?.type === "stateHealth"',
  "uncertainCommands",
  "staleTasks"
  ,"async function reconcileBreedCommands(catalog)"
]) {
  if (!backgroundRuntime.includes(required)) throw new Error(`Database health behavior missing: ${required}`);
}

if (!css.includes(".oweh-health-warning")) throw new Error("Database health warning style missing");

const bodyPriority = plannerSource.indexOf("Number(b.pure.body1PurePossible)");
const usageTieBreak = plannerSource.indexOf("Number(a.usageCount || 0)", bodyPriority);
if (bodyPriority < 0 || usageTieBreak < bodyPriority) {
  throw new Error("Male diversity must remain a tie-break after strict Body 1 progress");
}

console.log("scalable planner, pedigree, fingerprint, stable DOM, and health tests passed");
