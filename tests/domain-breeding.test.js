"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of [
  "../jobs/core.js",
  "../domain/colors.js",
  "../domain/pedigree.js",
  "../domain/breeding-score.js",
  "../domain/breeding-plan.js"
]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
require("../jobs/core.js");
require("../domain/colors.js");
require("../domain/pedigree.js");
require("../domain/breeding-score.js");
require("../domain/breeding-plan.js");

const { colors, pedigree, breedingScore, breedingPlan } = globalThis.OWEH.domain;
const target = { ...colors.STRICT_PURE_TARGET };
const exactColors = { ...target };

assert.equal(colors.hex("fff"), "#FFFFFF");
assert.equal(colors.hex("ff0000"), "#FF0000");
assert.equal(colors.slotDistance("#FFFFFF", "#FFFFF7"), 8);
assert.deepEqual(colors.rgb("#0A80FF"), [10, 128, 255]);
assert.equal(colors.rgb("#0A80FF"), colors.rgb("#0A80FF"), "parsed channels are memoized");
assert.ok(Object.isFrozen(colors.rgb("#0A80FF")), "shared cached channels must be immutable");
assert.deepEqual(colors.petPureMetrics({ colors: exactColors }, target), {
  exactChannels: 15,
  usedChannels: 15,
  distance: 0
});
assert.equal(colors.nearestPureColor("#FE0000").name, "Red");

assert.equal(pedigree.ancestorsOverlap(
  { id: "1", pedigreeVerified: true, ancestors: ["7"] },
  { id: "2", pedigreeVerified: true, ancestors: ["7"] }
), true);
assert.equal(pedigree.ancestorsOverlap(
  { id: "1", pedigreeVerified: true, ancestors: ["7"] },
  { id: "2", pedigreeVerified: true, ancestors: ["8"] }
), false);
assert.equal(pedigree.pedigreeCompatibility(
  { id: "1", ancestors: [] },
  { id: "2", pedigreeVerified: true, ancestors: [] }
).reason, "pedigree-unverified", "unknown ancestry must fail closed");
assert.equal(pedigree.pedigreeCompatibility(
  { id: "1", pedigreeVerified: true, ancestors: [] },
  { id: "2", pedigreeVerified: true, ancestors: [] }
).safe, true, "verified foundation pets with empty ancestry may breed");
assert.equal(pedigree.lineageKey({ id: "9", parentIds: ["4", "3"] }), "3:4");

const female = {
  id: "f1", owned: true, present: true, pedigreeVerified: true, gender: "Female", species: "Raptor",
  enclosure: "FF ** **", ancestors: ["fa", "fb"], parentIds: ["fa", "fb"],
  colors: { ...exactColors, body1: "#FFFF00" }
};
const complement = {
  id: "m1", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Raptor",
  enclosure: "Males", ancestors: ["ma", "mb"], parentIds: ["ma", "mb"],
  colors: { ...exactColors, body1: "#00FFFF" }
};
const pair = breedingScore.pairPureMetrics(female, complement, target);
assert.equal(pair.body1PurePossible, true);
assert.equal(pair.body1UnionExactChannels, 3);
assert.equal(pair.body1NewExactChannels, 1);
assert.equal(pair.usedChannels, 15);

const now = 1_000_000;
assert.throws(
  () => breedingPlan.buildDatabaseBreedPlan({ f1: female, m1: complement }, target),
  /requires a finite options\.now/,
  "planner must receive time explicitly so the domain layer stays deterministic"
);
const sameMetricsLessUsed = { ...complement, id: "m2", parentIds: ["mc", "md"], ancestors: ["mc", "md"] };
const related = { ...complement, id: "m0", parentIds: ["fa", "zz"], ancestors: ["fa", "zz"] };
const plan = breedingPlan.buildDatabaseBreedPlan(
  { f1: female, m0: related, m1: complement, m2: sameMetricsLessUsed },
  target,
  [{ fatherId: "m1", at: now - 1000 }],
  { now, shortlistSize: 40 }
);
assert.equal(plan.focusSpecies, "Raptor");
assert.equal(plan.femaleCount, 1);
assert.equal(plan.maleCount, 3);
assert.equal(plan.queue[0].maleId, "m2", "equivalent unused male should win diversity tie-break; related male must be excluded");
assert.equal(plan.queue[0].maleUsageBefore, 0);
assert.ok(plan.queue[0].maleCandidates.length >= 2, "planner must retain ordered fallback males for one female");
assert.equal(plan.queue[0].maleCandidates[0].maleId, "m2");


// Near-equivalent Body-1 males: FF FF FA and FF FF FC share the same exact
// endpoint mask and differ by only 2 RGB points in the remaining channel. The
// legacy pair ranking prefers FC because it is closer to FF on Body 1; the new
// campaign rule keeps both eligible and chooses by the LOWEST individual distance
// among Body 2 / Scales / Extra 1 / Extra 2.
const secondary14 = {
  body1: "#FFFFFC", body2: "#F10000", scales: "#0E0000",
  extra1: "#F10000", extra2: "#0E0000"
};
const secondary12 = {
  body1: "#FFFFFA", body2: "#F30000", scales: "#C80000",
  extra1: "#370000", extra2: "#C80000"
};
const maleFC = {
  id: "mFC", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Raptor",
  enclosure: "Males", ancestors: ["fc1", "fc2"], parentIds: ["fc1", "fc2"],
  colors: secondary14
};
const maleFA = {
  id: "mFA", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Raptor",
  enclosure: "Males", ancestors: ["fa1", "fa2"], parentIds: ["fa1", "fa2"],
  colors: secondary12
};
assert.equal(breedingScore.body1EndpointMask(maleFA, target), breedingScore.body1EndpointMask(maleFC, target));
assert.equal(breedingScore.body1NearEquivalent(maleFA, maleFC, target), true);
assert.deepEqual(
  breedingScore.shortlistMales(female, [maleFC, maleFA], target, 1).map(pet => pet.id).sort(),
  ["mFA", "mFC"],
  "near-equivalent Body-1 males must both remain eligible even when the base shortlist limit is one"
);
assert.equal(breedingScore.body1NearEquivalent(
  maleFA, { ...maleFC, colors: { ...maleFC.colors, body1: "#FFFFE9" } }, target
), false, "more than 15 RGB points on the remaining Body-1 channel is not equivalent");
assert.deepEqual(breedingScore.bestSecondaryTargetDistance({ colors: {
  body2: "#EB0000", scales: "#0E0000", extra1: "#D70000", extra2: "#190000"
} }, target), {
  bestDistance: 14,
  bestKey: "scales",
  distances: { body2: 20, scales: 14, extra1: 40, extra2: 25 }
});

const legacyNearEquivalentOrder = [maleFA, maleFC].map(male => ({
  male, pure: breedingScore.pairPureMetrics(female, male, target), usageCount: 0, lineageUse: 0
})).sort((a, b) => breedingScore.comparePairPureMetrics(
  { ...a, otherId: a.male.id }, { ...b, otherId: b.male.id }
));
assert.equal(legacyNearEquivalentOrder[0].male.id, "mFC", "legacy ranking should prefer FC on Body 1");

const diversifiedPlan = breedingPlan.buildDatabaseBreedPlan(
  { f1: female, mFA: maleFA, mFC: maleFC },
  target,
  [],
  { now, shortlistSize: 40 }
);
assert.equal(diversifiedPlan.queue[0].maleId, "mFA", "best secondary distance 12 should beat 14 inside the near-equivalent Body-1 pool");
assert.equal(diversifiedPlan.queue[0].maleSecondaryBestDistance, 12);
assert.equal(diversifiedPlan.queue[0].maleSecondaryBestKey, "body2");
assert.equal(diversifiedPlan.queue[0].maleBody1EquivalentPoolSize, 2);

const outsideTolerance = {
  ...maleFA, id: "mFar", ancestors: ["far1", "far2"], parentIds: ["far1", "far2"],
  colors: { ...maleFA.colors, body1: "#FFFFE8" }
};
const strictBody1Plan = breedingPlan.buildDatabaseBreedPlan(
  { f1: female, mFar: outsideTolerance, mFC: maleFC },
  target,
  [],
  { now, shortlistSize: 40 }
);
assert.equal(strictBody1Plan.queue[0].maleId, "mFC", "outside the 15-point Body-1 tolerance, normal Body-1 ranking must still win");

// Strategy 2 — Same-FF target improvement. This strategy scans the complete
// enclosure snapshot rather than only breeding-program enclosures. For each
// breedable female it requires the male to carry the exact same Body-1 FF mask,
// then chooses by the single closest target slot among Body 2 / Scales / Extra 1 / Extra 2.
const lineFemale = {
  id: "lf1", owned: true, present: true, pedigreeVerified: true, gender: "Female", species: "Draconis",
  enclosure: "Any enclosure", ancestors: ["lf-a", "lf-b"], parentIds: ["lf-a", "lf-b"],
  colors: { ...exactColors, body1: "#FF8877", body2: "#C00000", scales: "#330000", extra1: "#AA0000", extra2: "#440000" }
};
const lineMale14 = {
  id: "lm14", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Draconis",
  enclosure: "Not Males", ancestors: ["m14-a", "m14-b"], parentIds: ["m14-a", "m14-b"],
  colors: { body1: "#FF2211", body2: "#EB0000", scales: "#0E0000", extra1: "#D70000", extra2: "#190000" }
};
const lineMale12 = {
  id: "lm12", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Draconis",
  enclosure: "Another enclosure", ancestors: ["m12-a", "m12-b"], parentIds: ["m12-a", "m12-b"],
  colors: { body1: "#FFCC33", body2: "#F30000", scales: "#C80000", extra1: "#370000", extra2: "#C80000" }
};
const wrongFfMale = {
  id: "lmWrong", owned: true, present: true, pedigreeVerified: true, gender: "Male", species: "Draconis",
  enclosure: "Males", ancestors: ["mw-a", "mw-b"], parentIds: ["mw-a", "mw-b"],
  colors: { ...exactColors, body1: "#22FF11" }
};
const otherSpeciesMale = {
  ...lineMale12, id: "lmOtherSpecies", species: "Raptor", ancestors: ["os-a"], parentIds: ["os-a"]
};
const relatedSameFfMale = {
  ...lineMale12, id: "lmRelated", ancestors: ["lf-a"], parentIds: ["lf-a"]
};
const sameFfPlan = breedingPlan.buildDatabaseBreedPlan(
  { lf1: lineFemale, lm14: lineMale14, lm12: lineMale12, lmWrong: wrongFfMale, lmOtherSpecies: otherSpeciesMale, lmRelated: relatedSameFfMale },
  target,
  [],
  { now, strategy: breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET, shortlistSize: 1 }
);
assert.equal(sameFfPlan.strategy, breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET);
assert.equal(sameFfPlan.femaleCount, 1, "Same-FF strategy must consider a breedable female outside program enclosures");
assert.equal(sameFfPlan.maleCount, 5, "Same-FF strategy scans males across the complete enclosure snapshot");
assert.equal(sameFfPlan.queue[0].maleId, "lm12", "best secondary slot 12 must beat 14 when the Body-1 FF mask matches");
assert.equal(sameFfPlan.queue[0].maleSecondaryBestDistance, 12);
assert.equal(sameFfPlan.queue[0].maleSecondaryBestKey, "body2");
assert.equal(sameFfPlan.queue[0].sameFfCandidateCount, 2, "wrong FF mask, other species and related males must be excluded");
assert.equal(sameFfPlan.queue[0].sameFfMask, breedingScore.body1ExactMask(lineFemale, target));
assert.deepEqual(sameFfPlan.queue[0].maleCandidates.map(item => item.maleId), ["lm12", "lm14"]);

const noFfFemale = { ...lineFemale, id: "lfNo", colors: { ...lineFemale.colors, body1: "#EE8877" }, ancestors: ["n1"], parentIds: ["n1"] };
const noFfPlan = breedingPlan.buildDatabaseBreedPlan(
  { lfNo: noFfFemale, lm12: lineMale12 }, target, [],
  { now, strategy: breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET }
);
assert.equal(noFfPlan.queue[0].maleId, null, "a female without a target FF pair has no Same-FF line to reinforce");
assert.equal(noFfPlan.unpaired, 1);

assert.equal(breedingPlan.classifyNewbornName("FFFFFF-anything").target, "FF FF FF");
assert.equal(breedingPlan.desiredProgramEnclosure({ gender: "Male" }), "Males");

console.log("pure breeding domain behavior tests passed");
