"use strict";

const fs = require("node:fs");
const path = require("node:path");

// content.js plus every job module: the pet-maintenance jobs moved out of content.js in v5.2.0.
const jobsDir = path.join(__dirname, "..", "jobs");
const domainDir = path.join(__dirname, "..", "domain");
const source = [
  path.join(__dirname, "..", "content.js"),
  ...fs.readdirSync(jobsDir).map(name => path.join(jobsDir, name)),
  ...fs.readdirSync(domainDir).map(name => path.join(domainDir, name))
].map(file => fs.readFileSync(file, "utf8")).join("\n");

for (const required of [
  "const RECENT_FULL_FOOD_MS = 20 * 60 * 60 * 1000",
  "function petProfileNeedsRefresh(cached, item, autoRename = false)",
  "profile(s) are up to date",
  "knownFullRecently",
  "fedRecently",
  "dispatchedRecently",
  "pet.feedDispatchedAt = Date.now()",
  "body1UnionExactChannels",
  "body1NewExactChannels",
  "body1ReachableChannels",
  "body1PurePossible",
  "b.pure.body1NewExactChannels - a.pure.body1NewExactChannels",
  "pet?.present !== false && pet?.owned"
]) {
  if (!source.includes(required)) throw new Error(`Efficiency/ranking behavior missing: ${required}`);
}

const body1Priority = source.indexOf("Number(b.pure.body1PurePossible)");
const wholeTargetPriority = source.indexOf("Number(b.pure.purePossible)", body1Priority);
if (body1Priority < 0 || wholeTargetPriority < 0 || body1Priority >= wholeTargetPriority) {
  throw new Error("Whole-target scoring incorrectly precedes Body 1 complementary scoring");
}

console.log("cache, food skip and complementary pairing tests passed");
