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
  "../domain/surplus.js",
  "../jobs/runner.js",
  "../features/surplus.js"
];

function load() {
  for (const file of files) delete require.cache[require.resolve(path.join(__dirname, file))];
  delete globalThis.OWEH;
  for (const file of files) require(file);
  return globalThis.OWEH;
}

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
// Far from the target everywhere: no channel is worth more than 1/129.
const FAR = { body1: "#808080", body2: "#808080", scales: "#808080", extra1: "#808080", extra2: "#808080" };

function pet(id, gender, colorPatch = {}, extra = {}) {
  return {
    id, name: `P${id}`, owned: true, present: true, gender, species: "Draconis",
    enclosure: gender === "Male" ? "Males" : "Breeding Stock", generated: false,
    colors: { ...FAR, ...colorPatch }, ...extra
  };
}
const male = (id, colors, extra) => pet(id, "Male", colors, extra);
const female = (id, colors, extra) => pet(id, "Female", colors, extra);
const egg = (id, colors, extra) => pet(id, "", colors, {
  enclosure: "Hatchery", stage: "egg", pedigreeVerified: true, parentIds: ["901", "902"], ...extra
});
const ids = rows => rows.map(row => row.id);

test("surplus domain: channel worth, tolerance and replacement counts", () => {
  const { surplus, colors } = load().domain;
  const target = { ...colors.STRICT_PURE_TARGET };

  const worth = surplus.channelWorth([0, 1, 3, 9, 19]);
  assert.deepEqual(worth.map(value => Math.round(value * 100)), [100, 50, 25, 10, 5]);
  // An exact channel is only matched by an exact one; one step off is not good enough.
  assert.equal(surplus.covers([1], [1], 0.05), true);
  assert.equal(surplus.covers([0.5], [1], 0.05), false);
  // 19 or more off the target is "far": any value replaces it.
  assert.equal(surplus.covers([1 / 130], [1 / 20], 0.05), true);
  assert.equal(surplus.covers([1 / 20], [1 / 10], 0.05), true);
  assert.equal(surplus.covers([1 / 21], [1 / 10], 0.05), false);

  const pets = {
    1: male("1", { body1: "#FFFFFF" }),
    2: male("2", { body1: "#FFFFFF" }),
    // Nothing exact, far everywhere: both Body-1 males replace it.
    3: male("3"),
    // Exact Scales that nobody else has: worse on Body 1, but not replaceable.
    4: male("4", { scales: "#000000" }),
    // One step off on Body 1 red: the exact males still replace it.
    5: male("5", { body1: "#FEFFFF" })
  };
  const result = surplus.planSurplus(pets, target, { minReplacements: 2 });
  assert.deepEqual(ids(result.rows), ["3", "5"], "worst first");
  assert.equal(result.rows[0].replacements, 3, "every kept male that is at least as good is counted");
  assert.deepEqual(result.rows[1].examples.map(item => item.id), ["1", "2"]);
  assert.equal(result.rows[1].colors, "FEFFFF-808080-808080-808080-808080");
  assert.deepEqual(clone(result.summary.surplus), { egg: 0, female: 0, male: 2 });
  assert.deepEqual(clone(result.summary.kept), { egg: 0, female: 0, male: 3 });

  // Asking for more spares keeps more: at 4 only the far male still has enough, at 5 nobody.
  assert.deepEqual(ids(surplus.planSurplus(pets, target, { minReplacements: 4 }).rows), ["3"]);
  assert.equal(surplus.planSurplus(pets, target, { minReplacements: 5 }).rows.length, 0);
  // The default asks for 10.
  assert.equal(surplus.planSurplus(pets, target).summary.minReplacements, 10);

  // Identical pets replace each other: the first two stay, later copies can go.
  const twins = { 1: male("1"), 2: male("2"), 3: male("3"), 4: male("4") };
  assert.deepEqual(ids(surplus.planSurplus(twins, target, { minReplacements: 2 }).rows), ["3", "4"]);

  // Sexes are never compared with each other.
  const mixed = { 1: male("1", { body1: "#FFFFFF" }), 2: male("2", { body1: "#FFFFFF" }), 3: female("3") };
  assert.equal(surplus.planSurplus(mixed, target, { minReplacements: 2 }).rows.length, 0);
});

test("surplus domain: Generated, unchecked, protected, species and Males discard", () => {
  const { surplus, breedingPlan, colors } = load().domain;
  const target = { ...colors.STRICT_PURE_TARGET };
  const base = { 1: male("1", { body1: "#FFFFFF" }), 2: male("2", { body1: "#FFFFFF" }) };

  let result = surplus.planSurplus({
    ...base,
    3: male("3", {}, { generated: true }),
    4: male("4", {}, { generated: undefined }),
    5: male("5"),
    6: male("6")
  }, target, { minReplacements: 2, protectedIds: ["5"] });
  assert.deepEqual(ids(result.rows), ["6"]);
  assert.equal(result.summary.generated, 1, "a Generated pet is never listed");
  assert.equal(result.summary.unchecked, 1, "a pet never checked for Generated is held");
  assert.equal(result.summary.protected, 1, "a pet in a breeding plan is held");
  assert.deepEqual([...surplus.protectedIdsFromQueues([{ id: "f", maleId: "m", maleCandidates: [{ maleId: "n" }] }], null)].sort(), ["f", "m", "n"]);

  // Owner rule: every Generated pet stays as backup stock, however many better pets exist
  // and whichever sex it is — and it still counts as a replacement for others.
  const generated = {};
  for (let index = 1; index <= 12; index += 1) generated[index] = male(String(index), { body1: "#FFFFFF" });
  for (let index = 21; index <= 32; index += 1) generated[index] = female(String(index), { body1: "#FFFFFF" });
  generated[40] = male("40", {}, { generated: true });
  generated[41] = female("41", {}, { generated: true });
  generated[42] = male("42", {}, { generated: true, enclosure: "Males discard" });
  result = surplus.planSurplus(generated, target);
  assert.equal(result.rows.some(row => ["40", "41", "42"].includes(row.id)), false);
  assert.equal(result.summary.generated, 3);
  result = surplus.planSurplus({ 1: male("1", {}, { generated: true }), 2: male("2", {}, { generated: true }), 3: male("3") }, target, { minReplacements: 2 });
  assert.deepEqual(ids(result.rows), ["3"]);

  // Only species already in the breeding program are reviewed, each against its own kind.
  // A record without a species is never compared with anything.
  result = surplus.planSurplus({
    ...base,
    7: male("7", {}, { species: "Stray", enclosure: "Random" }),
    8: male("8", {}, { species: "Other" }),
    9: male("9"),
    10: male("10", {}, { species: "" }),
    11: male("11", {}, { species: "" }),
    12: male("12", {}, { species: "" })
  }, target, { minReplacements: 2 });
  assert.deepEqual(ids(result.rows), ["9"]);
  assert.deepEqual([...result.summary.species], ["Draconis", "Other"]);
  assert.equal(result.summary.incomplete, 3);

  // A pet already moved to Males discard is reviewed, but never counts as a replacement.
  result = surplus.planSurplus({
    1: male("1", { body1: "#FFFFFF" }, { enclosure: "Males discard" }),
    2: male("2", { body1: "#FFFFFF" }, { enclosure: "males discard" }),
    3: male("3"),
    4: male("4")
  }, target, { minReplacements: 2 });
  assert.deepEqual(ids(result.rows), [], "replacements that sit in Males discard do not count");
  result = surplus.planSurplus({ ...base, 3: male("3", {}, { enclosure: "Males discard" }) }, target, { minReplacements: 2 });
  assert.deepEqual(ids(result.rows), ["3"]);

  // Gone or incomplete records are never judged, and a gone pet replaces nobody.
  result = surplus.planSurplus({
    ...base,
    3: male("3", {}, { present: false }),
    4: { ...male("4"), colors: { body1: "#808080" } },
    5: male("5", {}, { owned: false })
  }, target, { minReplacements: 2 });
  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.incomplete, 1);
  result = surplus.planSurplus({ 1: base[1], 2: { ...base[2], present: false }, 3: male("3") }, target, { minReplacements: 2 });
  assert.equal(result.rows.length, 0);

  // Routing guards kept from the male cull: Sort never pulls a discarded male back.
  assert.equal(breedingPlan.desiredProgramEnclosure({ gender: "Male", enclosure: "males discard" }), null);
  assert.equal(breedingPlan.desiredProgramEnclosure({ gender: "Male", enclosure: "Random" }), "Males");
  assert.deepEqual(breedingPlan.plannableMaleEnclosures(
    { m: male("m", {}, { enclosure: "Males discard" }), a: male("a") }, target, breedingPlan.BREEDING_STRATEGIES.SAME_FF_TARGET), ["Males"]);
});

test("surplus domain: an egg needs replacements among males and females", () => {
  const { surplus, colors } = load().domain;
  const target = { ...colors.STRICT_PURE_TARGET };
  const stock = {
    1: male("1", { body1: "#FFFFFF" }), 2: male("2", { body1: "#FFFFFF" }),
    3: female("3", { body1: "#FFFFFF" }), 4: female("4", { body1: "#FFFFFF" })
  };
  const pets = {
    ...stock,
    10: egg("10"),
    // Exact Scales: nobody replaces it.
    11: egg("11", { scales: "#000000" }),
    // In the database as an egg, but the Hatchery no longer lists it: not reviewed.
    12: egg("12"),
    // The Hatchery lists it as an egg while the record says it has a sex: contradictory.
    13: male("13")
  };
  let result = surplus.planSurplus(pets, target, { minReplacements: 2, eggIds: ["10", "11", "13", "99"] });
  assert.deepEqual(ids(result.rows), ["10"]);
  assert.equal(result.rows[0].kind, "egg");
  assert.equal(result.rows[0].replacementMales, 2);
  assert.equal(result.rows[0].replacementFemales, 2);
  assert.deepEqual(clone(result.summary.considered), { egg: 2, female: 2, male: 2 });
  assert.equal(result.summary.incomplete, 1);
  assert.equal(result.summary.eggsNotIndexed, 2, "listed eggs without a usable record are reported");

  // Enough males but too few females: the egg may hatch female, so it stays.
  const { 4: dropped, ...fewFemales } = pets;
  result = surplus.planSurplus(fewFemales, target, { minReplacements: 2, eggIds: ["10"] });
  assert.equal(result.rows.filter(row => row.kind === "egg").length, 0);
  assert.equal(result.summary.kept.egg, 1);
  // Without the live egg list no egg is reviewed at all.
  assert.equal(surplus.planSurplus(pets, target, { minReplacements: 2 }).summary.considered.egg, 0);

  // An egg is listed only when its pedigree was read and names parents (a bred egg): whether
  // a generator egg shows the Generated icon is not known.
  result = surplus.planSurplus({
    ...stock,
    20: egg("20", {}, { pedigreeVerified: false }),
    21: egg("21", {}, { parentIds: [], ancestors: [] }),
    22: egg("22", {}, { generated: true }),
    23: egg("23", {}, { parentIds: undefined, ancestors: ["901"] })
  }, target, { minReplacements: 2, eggIds: ["20", "21", "22", "23"] });
  assert.deepEqual(ids(result.rows), ["23"]);
  assert.equal(result.summary.unchecked, 2);
  assert.equal(result.summary.generated, 1);

  // Eggs first, then females, then males; worst first inside each kind.
  result = surplus.planSurplus({
    ...stock, 5: male("5"), 6: female("6"), 7: female("7", { body1: "#FEFFFF" }), 10: egg("10")
  }, target, { minReplacements: 2, eggIds: ["10"] });
  assert.deepEqual(result.rows.map(row => `${row.kind}:${row.id}`), ["egg:10", "female:6", "female:7", "male:5"]);
});

// Three exact males and females, one far male, one far female, one far egg: with 3 spares
// asked for, the far ones are surplus.
const STOCK = () => ({
  1: male("1", { body1: "#FFFFFF" }), 2: male("2", { body1: "#FFFFFF" }), 7: male("7", { body1: "#FFFFFF" }),
  3: female("3", { body1: "#FFFFFF" }), 4: female("4", { body1: "#FFFFFF" }), 11: female("11", { body1: "#FFFFFF" }),
  5: male("5"), 6: female("6"), 10: egg("10")
});

function featureSetup({ pets = STOCK(), discardResult = () => ({ ok: true }), lands = () => true } = {}) {
  const OWEH = load();
  const store = { owehPets: clone(pets), owehSurplusMinReplacements: 3, owehSurplusLimit: 0 };
  // What OviPets itself lists; tests change it to play a sale, a hatch or a failed read.
  const world = {
    pets: new Set(Object.values(store.owehPets).filter(item => item.gender).map(item => item.id)),
    eggs: new Set(Object.values(store.owehPets).filter(item => !item.gender).map(item => item.id)),
    unnamed: new Set(),
    partial: false,
    hatcherySeen: true,
    owner: true
  };
  const log = { status: [], sent: [], claims: 0, done: 0 };
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
    setStatus: text => log.status.push(text),
    sleep: async () => {},
    isWorkerOwner: async owner => owner === "surplus" && world.owner,
    requestClaimWorker: async () => { log.claims += 1; return { ok: true }; },
    requestReleaseWorker: async () => ({ ok: true }),
    reportWorkerPhase: () => {},
    reportWorkerDone: () => { log.done += 1; },
    waitForGameReady: async () => true,
    domain: { colors: OWEH.domain.colors, breedingPlan: OWEH.domain.breedingPlan, surplus: OWEH.domain.surplus },
    gameActions: {
      discardPet: async id => {
        log.sent.push(id);
        const result = discardResult(id, log.sent.length);
        if (lands(id, result)) {
          world.pets.delete(id);
          world.eggs.delete(id);
        }
        return result;
      }
    },
    settings: { DEFAULT_REQUEST_DELAY: 0 },
    petFetch: {
      readHatchery: async () => ({ hatcherySeen: world.hatcherySeen, eggIds: [...world.eggs], turnable: [], hatchable: [], unnamedIds: [...world.unnamed] }),
      readOwnedPetIds: async () => ({ ids: [...world.pets], partial: world.partial })
    }
  };
  const modules = OWEH.boot(helpers);
  const feature = modules["feature-surplus"];
  return { store, log, world, feature, run: () => feature.workerHandlers.surplus.start(1) };
}

const statuses = store => Object.fromEntries(store.owehSurplusPreview.rows.map(row => [row.id, row.error ? `${row.status}:${row.error}` : row.status]));

// Planned and confirmed: 10 (egg), 6 (female) and 5 (male) are queued.
async function confirmedSetup(options) {
  const env = featureSetup(options);
  await env.feature.api.plan();
  assert.deepEqual(statuses(env.store), { 10: "queued", 6: "queued", 5: "queued" });
  await env.feature.api.confirm();
  return env;
}

test("surplus feature: plan is read-only and takes presence from the live game", async () => {
  const { store, log, world, feature } = featureSetup();
  assert.ok(feature.workerHandlers.surplus, "surplus owns a shared-worker handler");
  for (const selector of ["#oweh-surplus-plan", "#oweh-surplus-dismiss", "#oweh-surplus-confirm", "#oweh-surplus-stop"]) {
    assert.ok(feature.buttons[selector], selector);
  }
  await feature.api.plan();
  assert.equal(log.sent.length, 0, "planning never sends a command");
  assert.deepEqual(statuses(store), { 10: "queued", 6: "queued", 5: "queued" });
  assert.equal(store.owehSurplusPreview.minReplacements, 3);
  assert.equal(store.owehSurplusPreview.confirmedPlan, undefined);
  assert.match(log.status.at(-1), /3 can go \(1 egg\(s\), 1 female\(s\), 1 male\(s\)\)/);

  // More spares asked for than exist: nothing is listed.
  store.owehSurplusMinReplacements = 5;
  await feature.api.plan();
  assert.deepEqual(store.owehSurplusPreview.rows, []);
  assert.match(log.status.at(-1), /nothing to discard/);

  // A male the database still has but OviPets no longer lists (sold, discarded by hand) is
  // not a replacement: the far male now has only two better males and stays. Kept, he is one
  // of the three males that replace the far egg.
  store.owehSurplusMinReplacements = 3;
  world.pets.delete("7");
  await feature.api.plan();
  assert.deepEqual(statuses(store), { 10: "queued", 6: "queued" });

  // The live lists cannot be trusted: nothing is planned.
  for (const broken of [{ partial: true }, { hatcherySeen: false }]) {
    const env = featureSetup();
    Object.assign(env.world, broken);
    await env.feature.api.plan();
    assert.equal(env.store.owehSurplusPreview, undefined);
    assert.match(env.log.status.at(-1), /could not be read completely/);
  }
});

test("surplus feature: confirm sends the reviewed rows and records only verified discards", async () => {
  const { store, log, run } = await confirmedSetup();
  assert.equal(log.claims, 1, "Confirm claims the shared worker");
  assert.equal(store.owehSurplusPreview.confirmedPlan, store.owehSurplusPreview.createdAt);
  await run();
  assert.deepEqual(log.sent, ["10", "6", "5"]);
  assert.deepEqual(statuses(store), { 10: "discarded", 6: "discarded", 5: "discarded" });
  for (const id of ["10", "6", "5"]) {
    assert.equal(store.owehPets[id].present, false);
    assert.equal(store.owehPets[id].retentionDiscardReason, "surplus");
  }
  assert.equal(store.owehPets["1"].present, true, "kept pets are untouched");
  assert.equal(store.owehSurplusPreview.running, undefined, "no running flag is stored");
  assert.ok(store.owehSurplusPreview.finishedAt);
  assert.equal(log.done, 1, "the shared worker is released when the job ends");
  assert.match(log.status.at(-1), /3 confirmed gone/);

  // Running again finds nothing queued and sends nothing.
  await run();
  assert.equal(log.sent.length, 3);
});

test("surplus feature: only the plan the user confirmed is ever sent", async () => {
  // Never confirmed.
  const fresh = featureSetup();
  await fresh.feature.api.plan();
  await fresh.run();
  assert.deepEqual(fresh.log.sent, []);
  assert.match(fresh.log.status.at(-1), /was not confirmed/);

  // Confirmed, then rebuilt before the worker tab started: the new list was never reviewed.
  const rebuilt = await confirmedSetup();
  await rebuilt.feature.api.plan();
  await rebuilt.run();
  assert.deepEqual(rebuilt.log.sent, []);
  assert.deepEqual(statuses(rebuilt.store), { 10: "queued", 6: "queued", 5: "queued" });

  // While the surplus job holds the shared worker, Plan and Dismiss refuse to touch the review.
  const live = await confirmedSetup();
  const stamp = live.store.owehSurplusPreview.createdAt;
  live.store.owehWorker = { owner: "surplus", leaseUntil: Date.now() + 30_000 };
  await live.feature.api.plan();
  await live.feature.api.dismiss();
  assert.equal(live.store.owehSurplusPreview.createdAt, stamp);
  assert.match(live.log.status.at(-1), /running right now/);
  // Another feature's lease does not block.
  live.store.owehWorker = { owner: "maintain", leaseUntil: Date.now() + 30_000 };
  await live.feature.api.dismiss();
  assert.equal(live.store.owehSurplusPreview, null);

  // Confirm with nothing queued claims nothing.
  const empty = featureSetup();
  await empty.feature.api.confirm();
  assert.equal(empty.log.claims, 0);
});

test("surplus feature: the limit sends the worst rows first and the rest stays queued", async () => {
  const { store, log, run } = await confirmedSetup();
  store.owehSurplusLimit = 1;
  await run();
  assert.deepEqual(log.sent, ["10"]);
  assert.deepEqual(statuses(store), { 10: "discarded", 6: "queued", 5: "queued" });
  assert.equal(store.owehSurplusPreview.finishedAt, null);
  assert.match(log.status.at(-1), /2 still queued/);

  // No limit stored yet: a first run stays short.
  const first = featureSetup({ pets: { ...STOCK(), 20: male("20"), 21: male("21"), 22: male("22"), 23: male("23"), 24: male("24") } });
  delete first.store.owehSurplusLimit;
  await first.feature.api.plan();
  assert.equal(first.store.owehSurplusPreview.rows.length, 8);
  await first.feature.api.confirm();
  await first.run();
  assert.equal(first.log.sent.length, 5);
});

test("surplus feature: a row that changed since the plan is skipped, never sent", async () => {
  const { store, log, world, run } = await confirmedSetup();
  world.eggs.delete("10");
  world.unnamed.add("10");                         // hatched since the plan
  store.owehPets["6"].generated = true;            // turned out to be Generated
  store.owehPets["5"].colors.body1 = "#FFFFFF";    // record no longer matches the review
  await run();
  assert.deepEqual(log.sent, []);
  assert.deepEqual(statuses(store), { 10: "skipped:no-longer-an-egg", 6: "skipped:generated", 5: "skipped:colors-changed" });
  assert.equal(store.owehPets["10"].present, true);

  const second = await confirmedSetup();
  second.world.pets.delete("5");                    // not in any enclosure any more
  second.store.owehBreedPreview = { queue: [{ id: "6", maleId: "1" }] };
  await second.run();
  assert.deepEqual(second.log.sent, ["10"]);
  assert.deepEqual(statuses(second.store), { 10: "discarded", 6: "skipped:in-breeding-plan", 5: "skipped:gone" });
  assert.equal(second.store.owehPets["5"].present, false, "a pet the Overview no longer lists is recorded as gone");
  assert.equal(second.store.owehPets["5"].retentionDiscardReason, undefined);
});

test("surplus feature: a row is sent only while its replacements still exist in the game", async () => {
  // Reviewed with three exact males; one of them was sold before Confirm ran. The far male is
  // left with two replacements and stays; the egg and the female still have three each.
  const { store, log, world, run } = await confirmedSetup();
  world.pets.delete("7");
  await run();
  assert.deepEqual(log.sent, ["10", "6"]);
  assert.deepEqual(statuses(store), { 10: "discarded", 6: "discarded", 5: "skipped:no-longer-surplus" });
  assert.equal(store.owehPets["5"].present, true);

  // Two exact females sold: neither the far female nor the egg (sex unknown) may go.
  const females = await confirmedSetup();
  females.world.pets.delete("4");
  females.world.pets.delete("11");
  await females.run();
  assert.deepEqual(females.log.sent, ["5"]);
  assert.deepEqual(statuses(females.store), { 10: "skipped:no-longer-surplus", 6: "skipped:no-longer-surplus", 5: "discarded" });
});

test("surplus feature: nothing is sent when the live lists or the lease cannot be trusted", async () => {
  for (const broken of [{ partial: true }, { hatcherySeen: false }]) {
    const env = await confirmedSetup();
    Object.assign(env.world, broken);
    await env.run();
    assert.deepEqual(env.log.sent, []);
    assert.deepEqual(statuses(env.store), { 10: "queued", 6: "queued", 5: "queued" });
    assert.match(env.log.status.at(-1), /could not be read completely/);
  }

  const stale = await confirmedSetup();
  const age = Date.now() - 16 * 60 * 1000;
  stale.store.owehSurplusPreview.createdAt = age;
  stale.store.owehSurplusPreview.confirmedPlan = age;
  await stale.run();
  assert.deepEqual(stale.log.sent, []);
  assert.equal(stale.store.owehSurplusPreview, null);
  assert.match(stale.log.status.at(-1), /older than 15 minutes/);

  const lost = await confirmedSetup();
  lost.world.owner = false;
  await lost.run();
  assert.deepEqual(lost.log.sent, []);
  assert.match(lost.log.status.at(-1), /no longer holds the shared background tab/);
});

test("surplus feature: a command OviPets does not answer counts as sent and stops the run", async () => {
  // The callback never comes back, and the pets really stay.
  const pets = { ...STOCK(), 20: male("20"), 21: male("21") };
  const silent = await confirmedSetup({ pets: STOCK(), discardResult: () => ({ ok: false, reason: "bridge-timeout" }), lands: () => false });
  silent.store.owehPets = clone(pets);
  for (const id of ["20", "21"]) silent.world.pets.add(id);
  await silent.feature.api.plan();
  await silent.feature.api.confirm();
  await silent.run();
  assert.equal(silent.log.sent.length, 3, "three unanswered commands in a row end the run");
  assert.equal(Object.values(statuses(silent.store)).filter(value => value === "error:bridge-timeout").length, 3);
  assert.equal(Object.values(statuses(silent.store)).filter(value => value === "queued").length, 2);
  assert.match(silent.log.status.at(-1), /did not confirm 3 discard commands in a row/);
  assert.ok(Object.values(silent.store.owehPets).every(item => item.present !== false), "the database is not changed");

  // The callback never comes back but the discard landed: the live lists decide, and every
  // command that went out counts toward the limit.
  const landed = await confirmedSetup({ discardResult: () => ({ ok: false, reason: "command-timeout" }), lands: () => true });
  landed.store.owehSurplusLimit = 2;
  await landed.run();
  assert.deepEqual(landed.log.sent, ["10", "6"]);
  assert.deepEqual(statuses(landed.store), { 10: "discarded", 6: "discarded", 5: "queued" });
  assert.equal(landed.store.owehPets["10"].present, false);

  // A command the bridge refused never left: an error, not counted as sent.
  const refused = await confirmedSetup({ discardResult: () => ({ ok: false, reason: "invalid-command" }), lands: () => false });
  refused.store.owehSurplusLimit = 1;
  await refused.run();
  assert.equal(refused.log.sent.length, 3);
  assert.deepEqual(statuses(refused.store), { 10: "error:invalid-command", 6: "error:invalid-command", 5: "error:invalid-command" });
});

test("surplus feature: a pet OviPets still lists after the command is not recorded as gone", async () => {
  const { store, log, feature, run } = await confirmedSetup({ lands: () => false });
  await run();
  assert.deepEqual(log.sent, ["10", "6", "5"]);
  assert.deepEqual(statuses(store), { 10: "error:still-present", 6: "error:still-present", 5: "error:still-present" });
  assert.ok(Object.values(store.owehPets).every(item => item.present !== false));

  // An egg that hatched instead of being discarded is still there, as an unnamed newborn.
  const hatched = await confirmedSetup({ lands: () => true });
  hatched.store.owehSurplusLimit = 1;
  const original = hatched.world.eggs.delete.bind(hatched.world.eggs);
  hatched.world.eggs.delete = id => { hatched.world.unnamed.add(id); return original(id); };
  await hatched.run();
  assert.deepEqual(statuses(hatched.store), { 10: "error:still-present", 6: "queued", 5: "queued" });
  assert.equal(hatched.store.owehPets["10"].present, true);

  // Dismiss clears the review without sending anything.
  await feature.api.dismiss();
  assert.equal(store.owehSurplusPreview, null);
  assert.equal(log.sent.length, 3);
});

test("surplus feature: sent rows are settled before a plan can be resumed, replaced, dismissed or expire", async () => {
  // The verification read fails (as after Stop, when the worker tab closes): rows stay "sent".
  const interrupted = async () => {
    const env = await confirmedSetup();
    env.store.owehSurplusLimit = 2;
    const read = env.world;
    let reads = 0;
    Object.defineProperty(read, "hatcherySeen", { get: () => (reads += 1) <= 1, configurable: true });
    await env.run();
    assert.deepEqual(env.log.sent, ["10", "6"]);
    assert.deepEqual(statuses(env.store), { 10: "sent", 6: "sent", 5: "queued" });
    assert.equal(env.store.owehPets["10"].present, true, "not verified, so not recorded as gone");
    assert.match(env.log.status.at(-1), /2 sent but not verified yet/);
    Object.defineProperty(read, "hatcherySeen", { value: true, writable: true, configurable: true });
    return env;
  };

  // The next Confirm settles them first, then continues with the rest.
  let env = await interrupted();
  env.store.owehSurplusLimit = 0;
  await env.run();
  assert.deepEqual(env.log.sent, ["10", "6", "5"]);
  assert.deepEqual(statuses(env.store), { 10: "discarded", 6: "discarded", 5: "discarded" });

  // An expired plan is thrown away only after its sent rows were recorded.
  env = await interrupted();
  const age = Date.now() - 16 * 60 * 1000;
  env.store.owehSurplusPreview.createdAt = age;
  env.store.owehSurplusPreview.confirmedPlan = age;
  await env.run();
  assert.equal(env.store.owehSurplusPreview, null);
  assert.equal(env.store.owehPets["10"].present, false);
  assert.equal(env.store.owehPets["6"].present, false);
  assert.equal(env.store.owehPets["5"].present, true);
  assert.equal(env.log.sent.length, 2);

  // Plan and Dismiss settle them too.
  env = await interrupted();
  await env.feature.api.plan();
  assert.equal(env.store.owehPets["10"].present, false);
  assert.equal(env.store.owehPets["6"].present, false);
  assert.deepEqual(statuses(env.store), { 5: "queued" });
  env = await interrupted();
  await env.feature.api.dismiss();
  assert.equal(env.store.owehSurplusPreview, null);
  assert.equal(env.store.owehPets["6"].present, false);
});

test("surplus feature: Stop ends the run before the next command", async () => {
  let env;
  env = await confirmedSetup({
    discardResult: (id, count) => {
      if (count === 1) env.feature.workerHandlers.surplus.stop();
      return { ok: true };
    }
  });
  await env.run();
  assert.deepEqual(env.log.sent, ["10"], "nothing is sent after Stop");
  assert.equal(statuses(env.store)["6"], "queued");
  assert.equal(statuses(env.store)["5"], "queued");
  assert.match(env.log.status.at(-1), /Discard stopped/);
});
