"use strict";

// v5.10.0 Newborn outcross strategy: females with no FF/00 pair in any target slot are paired
// with a same-species, pedigree-safe male carrying at least two target endpoint pairs; among
// qualifying males the single closest secondary slot (Body 2 / Scales / Extra 1 / Extra 2) wins.
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

const { colors, breedingPlan } = globalThis.OWEH.domain;
const { BREEDING_STRATEGIES } = breedingPlan;
const OUTCROSS = BREEDING_STRATEGIES.NEWBORN_OUTCROSS;
const target = { ...colors.STRICT_PURE_TARGET };
const now = 10_000_000;

assert.equal(OUTCROSS, "newborn-outcross");
assert.equal(breedingPlan.OUTCROSS_MIN_ENDPOINT_PAIRS, 2);
assert.equal(breedingPlan.normalizeBreedingStrategy(OUTCROSS), OUTCROSS);
assert.equal(breedingPlan.normalizeBreedingStrategy("something-else"), BREEDING_STRATEGIES.PURE_LINE);
assert.equal(breedingPlan.targetEndpointPairCount({ colors: target }, target), 15);
// 00 where the target wants FF (and FF where it wants 00) never counts.
assert.equal(breedingPlan.targetEndpointPairCount({ colors: { body1: "#000000", body2: "#00FFFF", scales: "#FFFFFF", extra1: "#00FFFF", extra2: "#FFFFFF" } }, target), 0);

const pet = (id, gender, extra) => ({
  id, name: id, owned: true, present: true, pedigreeVerified: true, gender, species: "Draconis",
  enclosure: gender === "Male" ? "Males" : "Newborn", ancestors: [`${id}-a`, `${id}-b`], parentIds: [`${id}-a`, `${id}-b`],
  ...extra
});

const newbornFemale = pet("nf1", "Female", {
  colors: { body1: "#EE8877", body2: "#C01010", scales: "#331111", extra1: "#AA1111", extra2: "#441111" }
});
const endpointFemale = pet("nfEnd", "Female", {
  colors: { ...newbornFemale.colors, body1: "#FF8877" }
});
const lonelyFemale = pet("nfRaptor", "Female", { species: "Raptor", enclosure: "Breeding Stock", colors: { ...newbornFemale.colors } });

// One target endpoint pair only (Body 1 R = FF) — excluded even though Scales is 3 off.
const maleOnePair = pet("mOne", "Male", {
  colors: { body1: "#FF8877", body2: "#EE1111", scales: "#010101", extra1: "#EE1111", extra2: "#111111" }
});
// Three endpoint pairs, best secondary slot Extra 1 at 20.
const maleFar = pet("mFar", "Male", {
  colors: { body1: "#FFFF88", body2: "#FF1414", scales: "#0A0A0A", extra1: "#F50505", extra2: "#101010" }
});
// Exactly two endpoint pairs (Body 1 R FF, Body 2 G 00), best secondary Scales at 12.
const maleNear = pet("mNear", "Male", {
  enclosure: "Stud",
  colors: { body1: "#FF8877", body2: "#EE0011", scales: "#040404", extra1: "#EE1111", extra2: "#222222" }
});
// Same best secondary distance (12) but four endpoint pairs — wins the tie.
const maleTie = pet("mTie", "Male", {
  colors: { body1: "#FFFF77", body2: "#FF0011", scales: "#040404", extra1: "#EE1111", extra2: "#222222" }
});
const maleWrongEndpoints = pet("mWrong", "Male", {
  colors: { body1: "#000000", body2: "#00FFFF", scales: "#FFFFFF", extra1: "#00FFFF", extra2: "#FFFFFF" }
});
const maleOtherSpecies = pet("mOther", "Male", { species: "Wolf", enclosure: "Wolf males", colors: { ...target } });
const maleRelated = pet("mRel", "Male", { ancestors: ["nf1-a"], parentIds: ["nf1-a"], colors: { ...target } });
const maleCulled = pet("mCull", "Male", { enclosure: "Males discard", colors: { ...target } });
const maleCooling = pet("mCool", "Male", { onCooldown: true, colors: { ...target } });

const pets = {
  nf1: newbornFemale, nfEnd: endpointFemale, nfRaptor: lonelyFemale,
  mOne: maleOnePair, mFar: maleFar, mNear: maleNear, mTie: maleTie, mWrong: maleWrongEndpoints,
  mOther: maleOtherSpecies, mRel: maleRelated, mCull: maleCulled, mCool: maleCooling
};

const plan = breedingPlan.buildDatabaseBreedPlan(pets, target, [], { now, strategy: OUTCROSS });
assert.equal(plan.strategy, OUTCROSS);
assert.equal(plan.femaleCount, 2, "only females with no FF/00 pair anywhere are planned");
assert.equal(plan.maleCount, 5, "males need >= 2 target endpoint pairs, off cooldown, outside Males discard");
const row = plan.queue.find(item => item.id === "nf1");
assert.equal(row.strategy, OUTCROSS);
assert.equal(row.enclosure, "Newborn");
assert.equal(row.maleId, "mTie", "equal closest secondary slot: more endpoint pairs wins");
assert.equal(row.maleEndpointPairs, 4);
assert.equal(row.maleSecondaryBestDistance, 12);
assert.equal(row.maleSecondaryBestKey, "scales");
assert.deepEqual(row.maleCandidates.map(item => item.maleId), ["mTie", "mNear", "mFar"],
  "closest secondary slot ranks first (12 beats 20); related, other-species and 1-pair males are excluded");
assert.deepEqual(row.maleCandidates.map(item => item.maleEndpointPairs), [4, 2, 3]);
assert.equal(row.outcrossCandidateCount, 3);
assert.ok(row.pure && Number.isFinite(row.pure.distance));
const lonely = plan.queue.find(item => item.id === "nfRaptor");
assert.equal(lonely.maleId, null, "the Raptor female has no qualifying Raptor male");
assert.equal(plan.unpaired, 1);

// Recent use only breaks ties after the secondary slot and endpoint count.
const busy = breedingPlan.buildDatabaseBreedPlan(
  { nf1: newbornFemale, mTie: maleTie, mNear: maleNear },
  target,
  [{ at: now - 1000, fatherId: "mTie" }, { at: now - 2000, fatherId: "mTie" }],
  { now, strategy: OUTCROSS }
);
assert.equal(busy.queue[0].maleId, "mTie");
assert.equal(busy.queue[0].maleUsageBefore, 2);

// The game's own partner list is authoritative for the outcross plan too.
const gamePlan = breedingPlan.buildDatabaseBreedPlan(
  { nf1: { ...newbornFemale, pedigreeVerified: false }, mTie: maleTie, mFar: maleFar, mRel: maleRelated },
  target, [], { now, strategy: OUTCROSS, gameEligible: { nf1: ["mFar", "mRel"] } }
);
assert.deepEqual(gamePlan.queue[0].maleCandidates.map(item => item.maleId).sort(), ["mFar", "mRel"]);
assert.ok(gamePlan.queue[0].maleCandidates.every(item => item.gameListed === true));
const unverifiedNoList = breedingPlan.buildDatabaseBreedPlan(
  { nf1: { ...newbornFemale, pedigreeVerified: false }, mTie: maleTie }, target, [], { now, strategy: OUTCROSS }
);
assert.equal(unverifiedNoList.femaleCount, 0, "an unverified female without a game list stays out (fail closed)");

// Partner-list reads cover exactly the outcross females and the enclosures of qualifying males.
assert.deepEqual(breedingPlan.plannableFemales(pets, target, OUTCROSS).map(item => item.id).sort(), ["nf1", "nfRaptor"]);
assert.deepEqual(breedingPlan.plannableMaleEnclosures(pets, target, OUTCROSS).sort(), ["Males", "Stud", "Wolf males"]);
// The other strategies are unchanged by the new one.
assert.deepEqual(breedingPlan.plannableMaleEnclosures(pets, target, BREEDING_STRATEGIES.PURE_LINE), ["Males"]);

console.log("newborn outcross domain tests passed");
