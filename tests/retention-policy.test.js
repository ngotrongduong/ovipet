"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of [
  "../jobs/core.js",
  "../domain/colors.js",
  "../domain/pedigree.js",
  "../domain/breeding-score.js",
  "../domain/breeding-plan.js",
  "../domain/retention-policy.js"
]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
require("../jobs/core.js");
require("../domain/colors.js");
require("../domain/pedigree.js");
require("../domain/breeding-score.js");
require("../domain/breeding-plan.js");
require("../domain/retention-policy.js");

const { colors, retentionPolicy } = globalThis.OWEH.domain;
const target = { ...colors.STRICT_PURE_TARGET };

function pet(id, gender, colorsPatch, extra = {}) {
  return {
    id,
    name: id,
    owned: true,
    present: true,
    gender,
    species: "Raptor",
    enclosure: gender ? (gender === "Male" ? "Males" : "Breeding Stock") : "Hatchery",
    pedigreeVerified: true,
    ancestors: [id + "-a", id + "-b"],
    parentIds: [id + "-a", id + "-b"],
    generated: false,
    colors: { ...target, ...colorsPatch },
    ...extra
  };
}

const badColors = {
  body1: "#808080",
  body2: "#808080",
  scales: "#808080",
  extra1: "#808080",
  extra2: "#808080"
};
const nearNoEndpoints = {
  body1: "#FDFDF0",
  body2: "#FD0202",
  scales: "#020202",
  extra1: "#FD0202",
  extra2: "#020202"
};

assert.deepEqual(retentionPolicy.endpointMetrics({ colors: nearNoEndpoints }, target), {
  complete: true,
  endpointPairs: 0,
  body1EndpointPairs: 0,
  body1Distance: 19,
  body1MaxDistance: 15,
  fullDistance: 43,
  fullMaxDistance: 15
});
assert.equal(retentionPolicy.isNearTarget(retentionPolicy.endpointMetrics({ colors: nearNoEndpoints }, target)), true);

const pets = {
  exactM1: pet("exactM1", "Male", {}, { ancestors: ["m1a"], parentIds: ["m1a"] }),
  exactM2: pet("exactM2", "Male", {}, { ancestors: ["m2a"], parentIds: ["m2a"] }),
  exactF: pet("exactF", "Female", {}, { ancestors: ["f1a"], parentIds: ["f1a"] }),
  generatedBad: pet("generatedBad", "Male", badColors, {
    generated: true, ancestors: ["g1a"], parentIds: ["g1a"]
  }),
  near: pet("near", "Female", nearNoEndpoints, {
    ancestors: ["m1a", "m2a"], parentIds: ["m1a", "m2a"]
  }),
  badAdult: pet("badAdult", "Male", badColors, {
    ancestors: ["bad-a"], parentIds: ["bad-a"]
  }),
  badEgg: pet("badEgg", "", badColors, {
    pedigreeVerified: true, ancestors: ["egg-a"], parentIds: ["egg-a"], stage: "egg"
  }),
  protectedBad: pet("protectedBad", "Female", badColors, {
    ancestors: ["protected-a"], parentIds: ["protected-a"]
  })
};

const plan = retentionPolicy.buildRetentionPlan(pets, target, { protectedIds: ["protectedBad"] });
const byId = Object.fromEntries(plan.rows.map(row => [String(row.id), row]));

assert.equal(byId.generatedBad.status, retentionPolicy.STATUS.PROTECTED);
assert.equal(byId.generatedBad.reason, "generated");
assert.equal(byId.protectedBad.status, retentionPolicy.STATUS.PROTECTED);
assert.equal(byId.protectedBad.reason, "active-plan");

assert.equal(byId.near.endpointPairs, 0, "FDFDF0-style rescue has no exact target endpoint");
assert.equal(byId.near.nearTarget, true);
assert.equal(byId.near.status, retentionPolicy.STATUS.NEAR_TARGET_KEEP,
  "near-target pet survives even without any FF/00 target pair");

assert.equal(byId.badAdult.status, retentionPolicy.STATUS.REVIEW_CULL_CANDIDATE,
  "poor adult is review-cull only after two male lineages dominate it");
assert.ok(byId.badAdult.dominatorLineages >= 2);

assert.equal(byId.badEgg.status, retentionPolicy.STATUS.EARLY_CULL_CANDIDATE,
  "poor egg is early-cull only when redundant coverage exists from both sexes");
assert.ok(byId.badEgg.dominatorSexes.includes("male"));
assert.ok(byId.badEgg.dominatorSexes.includes("female"));
assert.ok(plan.cullCandidateIds.includes("badEgg"));

const noFemaleCoverage = retentionPolicy.buildRetentionPlan(
  { exactM1: pets.exactM1, exactM2: pets.exactM2, badEgg: pets.badEgg },
  target
);
assert.notEqual(
  noFemaleCoverage.rows.find(row => row.id === "badEgg").status,
  retentionPolicy.STATUS.EARLY_CULL_CANDIDATE,
  "unknown-sex egg is never early-culled from male-only redundancy"
);

assert.deepEqual(
  [...retentionPolicy.protectedIdsFromQueues([
    { id: "f1", maleId: "m1", maleCandidates: [{ maleId: "m2" }] }
  ])].sort(),
  ["f1", "m1", "m2"]
);

console.log("retention policy tests passed");
