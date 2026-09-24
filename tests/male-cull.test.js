"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const files = [
  "../jobs/core.js",
  "../domain/colors.js",
  "../domain/pedigree.js",
  "../domain/breeding-score.js",
  "../domain/breeding-plan.js",
  "../domain/male-cull.js",
  "../jobs/runner.js",
  "../features/male-cull.js"
];

function load() {
  for (const file of files) delete require.cache[require.resolve(path.join(__dirname, file))];
  delete globalThis.OWEH;
  for (const file of files) require(file);
  return globalThis.OWEH;
}

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const EXACT = { body1: "#FFFFFF", body2: "#FF0000", scales: "#000000", extra1: "#FF0000", extra2: "#000000" };

function male(id, parents, colorPatch = {}, extra = {}) {
  return {
    id, name: `M${id}`, owned: true, present: true, gender: "Male", species: "Raptor",
    enclosure: "Males", pedigreeVerified: true, parentIds: parents,
    colors: { ...EXACT, ...colorPatch }, ...extra
  };
}

test("male cull domain: dominance, lineage diversity, protection, coverage", () => {
  const OWEH = load();
  const { maleCull, breedingPlan, colors } = OWEH.domain;
  const target = { ...colors.STRICT_PURE_TARGET };

  const pets = {
    a: male("a", ["p1", "p2"], { extra2: "#010000" }),
    b: male("b", ["p3", "p4"], { extra2: "#010000" }),
    m: male("m", ["p5", "p6"], { body1: "#F0FFFF", extra2: "#010000" }),
    // Better on extra2 than a/b, so nobody covers it even though it is worse on scales.
    s: male("s", ["p7", "p8"], { scales: "#101010" })
  };
  let result = maleCull.planMaleCull(pets, target);
  assert.deepEqual(result.cull.map(row => row.id), ["m"], "m is covered by a and b from two lineages");
  assert.equal(result.cull[0].dominatorLineages, 2);
  assert.deepEqual(result.cull[0].dominators.map(item => item.id).sort(), ["a", "b"]);
  assert.ok(result.keepIds.includes("s"), "a male not covered on every channel stays");

  // Only one lineage covers it: keep for pedigree diversity.
  const sameLineage = { a: pets.a, b: { ...pets.b, parentIds: ["p1", "p2"] }, m: pets.m };
  assert.equal(maleCull.planMaleCull(sameLineage, target).cull.length, 0);
  // A single dominator is not enough.
  assert.equal(maleCull.planMaleCull({ a: pets.a, m: pets.m }, target).cull.length, 0);

  // Identical males: the first two stay as redundancy, the third goes.
  const twins = {
    t1: male("t1", ["x1", "x2"]), t2: male("t2", ["x3", "x4"]), t3: male("t3", ["x5", "x6"])
  };
  assert.deepEqual(maleCull.planMaleCull(twins, target).cull.map(row => row.id), ["t3"]);

  // Protected males (in a breeding plan/queue) are never culled.
  result = maleCull.planMaleCull(pets, target, { protectedIds: ["m"] });
  assert.equal(result.cull.length, 0);
  assert.equal(result.summary.protected, 1);
  const protectedIds = maleCull.protectedMaleIds([{ maleId: "m", maleCandidates: [{ maleId: "b" }] }], null);
  assert.deepEqual([...protectedIds].sort(), ["b", "m"]);

  // Other species are never compared, and species outside the program are not reviewed.
  const mixed = {
    ...pets,
    o1: male("o1", ["q1", "q2"], { body1: "#F0FFFF" }, { species: "Other" }),
    z: male("z", ["q3", "q4"], { body1: "#000000" }, { species: "Stray", enclosure: "Random" })
  };
  result = maleCull.planMaleCull(mixed, target);
  assert.deepEqual(result.cull.map(row => row.id), ["m"]);
  assert.ok(!result.summary.species.includes("Stray"));

  // Males already in Males discard are out of scope.
  const discarded = { ...pets, m: { ...pets.m, enclosure: "males discard" } };
  assert.equal(maleCull.planMaleCull(discarded, target).cull.length, 0);

  // Coverage: a channel no kept male and no female hits exactly is reported missing.
  const gap = {
    g1: male("g1", ["r1", "r2"], { body1: "#F0FFFF" }),
    f1: { id: "f1", owned: true, present: true, gender: "Female", species: "Raptor", enclosure: "Breeding Stock", colors: { ...EXACT, body1: "#F1FFFF" } }
  };
  assert.deepEqual(maleCull.planMaleCull(gap, target).summary.coverage.Raptor.missing, ["body1.R"]);
  assert.deepEqual(maleCull.planMaleCull(pets, target).summary.coverage.Raptor.missing, []);

  // Routing guards: Sort never pulls a discarded male back, and planners skip it.
  assert.equal(breedingPlan.desiredProgramEnclosure({ gender: "Male", enclosure: "males discard" }), null);
  assert.equal(breedingPlan.desiredProgramEnclosure({ gender: "Male", enclosure: "Random" }), "Males");
  const enclosures = breedingPlan.plannableMaleEnclosures(
    { m: { ...pets.m, enclosure: "Males discard" }, a: pets.a }, target, breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET);
  assert.deepEqual(enclosures, ["Males"]);
});

function featureSetup({ enclosureIds = { "males discard": "10" }, moveResult = { moved: true } } = {}) {
  const OWEH = load();
  const store = {
    owehPets: {
      a: male("a", ["p1", "p2"]), b: male("b", ["p3", "p4"]), m: male("m", ["p5", "p6"], { body1: "#F0FFFF" })
    },
    owehEnclosureIds: enclosureIds
  };
  const log = { status: [], moves: [], done: 0 };
  const helpers = {
    storageGet: async (key, fallback) => key in store ? clone(store[key]) : clone(fallback),
    storageGetMany: async () => ({}),
    storageSet: async values => {
      for (const [key, value] of Object.entries(values)) {
        if (key === "owehPets") {
          for (const [id, record] of Object.entries(value)) store.owehPets[id] = { ...store.owehPets[id], ...clone(record) };
        } else store[key] = clone(value);
      }
    },
    getPetsByIds: async ids => Object.fromEntries(ids.filter(id => store.owehPets[id]).map(id => [id, clone(store.owehPets[id])])),
    setStatus: text => log.status.push(text),
    sleep: async () => {},
    requestClaimWorker: async () => ({ ok: true }),
    requestReleaseWorker: async () => ({ ok: true }),
    reportWorkerPhase: () => {},
    reportWorkerDone: () => { log.done += 1; },
    waitForGameReady: async () => true,
    domain: { colors: OWEH.domain.colors, breedingPlan: OWEH.domain.breedingPlan, maleCull: OWEH.domain.maleCull },
    gameActions: {
      fastMovePetToEnclosure: async (id, target) => { log.moves.push([id, target]); return clone(moveResult); }
    },
    settings: { getDelayMs: () => 0 }
  };
  const modules = OWEH.boot(helpers);
  return { store, log, feature: modules["feature-male-cull"] };
}

test("male cull feature: plan saves a review, confirm moves only reviewed males", async () => {
  const { store, log, feature } = featureSetup();
  assert.ok(feature.workerHandlers.cull, "cull owns a shared-worker handler");
  assert.ok(feature.buttons["#oweh-cull-plan"] && feature.buttons["#oweh-cull-confirm"] && feature.buttons["#oweh-cull-stop"]);
  await feature.api.plan();
  assert.equal(log.moves.length, 0, "planning never moves a pet");
  assert.deepEqual(store.owehCullPreview.rows.map(row => [row.id, row.status]), [["m", "queued"]]);
  assert.equal(store.owehCullPreview.enclosureMissing, false);

  await feature.workerHandlers.cull.start(1);
  assert.deepEqual(log.moves, [["m", "Males discard"]]);
  assert.equal(store.owehPets.m.enclosure, "Males discard");
  assert.equal(store.owehPets.m.enclosureId, "10");
  assert.equal(store.owehCullPreview.rows[0].status, "moved");
  assert.equal(store.owehCullPreview.running, false);
  assert.equal(log.done, 1, "the shared worker is released when the job ends");

  // Running again finds nothing queued and moves nothing.
  await feature.workerHandlers.cull.start(2);
  assert.equal(log.moves.length, 1);
});

test("male cull feature: missing Males discard enclosure moves nothing", async () => {
  const { store, log, feature } = featureSetup({ enclosureIds: { Males: "3" } });
  await feature.api.plan();
  assert.equal(store.owehCullPreview.enclosureMissing, true);
  await feature.workerHandlers.cull.start(1);
  assert.equal(log.moves.length, 0);
  assert.match(log.status.at(-1), /Males discard/);
  assert.equal(store.owehCullPreview.rows[0].status, "queued");
});

test("male cull feature: failed move is recorded, discard clears the review", async () => {
  const { store, log, feature } = featureSetup({ moveResult: { moved: false, reason: "command-timeout" } });
  await feature.api.plan();
  await feature.workerHandlers.cull.start(1);
  assert.equal(store.owehCullPreview.rows[0].status, "error");
  assert.equal(store.owehCullPreview.rows[0].error, "command-timeout");
  assert.equal(store.owehPets.m.enclosure, "Males", "a failed move never rewrites the database");
  await feature.api.discard();
  assert.equal(store.owehCullPreview, null);
  assert.equal(log.moves.length, 1);
});
