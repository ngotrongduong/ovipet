"use strict";

const fs = require("node:fs");
const path = require("node:path");

const jobsDir = path.join(__dirname, "..", "jobs");
const domainDir = path.join(__dirname, "..", "domain");
const coreDir = path.join(__dirname, "..", "core");
const featuresDir = path.join(__dirname, "..", "features");
const source = [
  path.join(__dirname, "..", "content.js"),
  ...fs.readdirSync(jobsDir).map(name => path.join(jobsDir, name)),
  ...fs.readdirSync(coreDir).map(name => path.join(coreDir, name)),
  ...fs.readdirSync(domainDir).map(name => path.join(domainDir, name)),
  ...fs.readdirSync(featuresDir).map(name => path.join(featuresDir, name))
].map(file => fs.readFileSync(file, "utf8")).join("\n");
const bridge = fs.readFileSync(path.join(__dirname, "..", "page-bridge.js"), "utf8");

for (const required of [
  "const DIRECT_COMMAND_INTERVAL_MS = 100",
  "const PET_FEED_DELAY_MS = DIRECT_COMMAND_INTERVAL_MS",
  'sendGameCommand("pet_feed", petId, {}, 3000, true)',
  'sendGameCommand("friend_request", userId, {}, 3000, true)',
  // Direct-command jobs keep their 100 ms command pacing after moving into their own files.
  "await sleep(settings.PET_FEED_DELAY_MS)",
  "await sleep(settings.DEFAULT_REQUEST_DELAY)",
  'const MALES_ENCLOSURE = "Males"',
  'const BREEDING_STOCK_ENCLOSURE = "Breeding Stock"',
  'mode: "database-direct-v2"',
  "isBreedingFemaleEnclosure(pet.enclosure)",
  "breedingPlan.desiredProgramEnclosure(pet, maxDistance)",
  "normalizeEnclosureLabel(MALES_ENCLOSURE)"
]) {
  if (!source.includes(required)) throw new Error(`Concurrent/program behavior missing: ${required}`);
}

if (!bridge.includes('command === "pet_feed" || command === "friend_request"')) {
  throw new Error("Fire-and-forget bridge allow-list is missing");
}
if (source.includes("prepareBestMaleMoves")) {
  throw new Error("Legacy best-male-per-enclosure hatchling routing remains");
}

console.log("concurrent lanes and breeding program tests passed");
