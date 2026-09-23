"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const planner = fs.readFileSync(path.join(__dirname, "..", "domain", "breeding-plan.js"), "utf8");
const petRecord = fs.readFileSync(path.join(__dirname, "..", "domain", "pet-record.js"), "utf8");
const breedingFeature = fs.readFileSync(path.join(__dirname, "..", "features", "breeding.js"), "utf8");
const source = `${content}\n${planner}\n${petRecord}\n${breedingFeature}`;

for (const required of [
  "function buildDatabaseBreedPlan(pets, target, history = [], options = {})",
  "collectAllOverviewPets()",
  "petRecord.petProfileNeedsRefresh(cached, item, false)",
  "owehBreedCatalog",
  "owehDatabaseMeta",
  "schemaVersion: 4",
  "database-direct-v2",
  "SAME_FF_TARGET",
  "same-ff-target",
  "sameFfCandidateCount",
  "ownerInstance: PANEL_INSTANCE",
  // v5: the breed campaign moved onto the shared worker tab, so ownership is derived via
  // isWorkerOwner("breed") against the shared owehWorker lease instead of a per-campaign
  // ownerTabId/ownerInstance pair.
  'await isWorkerOwner("breed")',
  "gameActions.breedPairDirect(female.id, male.id, campaign.startedAt",
  "female.onCooldown = true",
  "function isCompletePetRecord(pet)",
  "pet?.pedigreeVerified === true",
  "Array.isArray(pet?.ancestors)",
  "pedigreeCompatibility",
  "pedigree: OWEH.domain.pedigree",
  "maleCandidates",
  "unable-to-breed-pets",
  "TARGET_KEYS.every(key => pet.colors[key])",
  "No blue-heart-free indexed females",
  "Database breeding complete"
]) {
  if (!source.includes(required)) throw new Error(`Database breeding behavior missing: ${required}`);
}

for (const removed of [
  "collectBreedingCandidatesAcrossEnclosures",
  "processBreedCampaignStep",
  "cacheCandidate(candidateId"
]) {
  if (source.includes(removed)) throw new Error(`Legacy per-female navigation remains: ${removed}`);
}

console.log("database-first breeding tests passed");
