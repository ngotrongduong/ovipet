"use strict";

// Name the Species: learned overlay, safety pause and owner labels (bg/species-learned.js with
// the wrong-case store of bg/species-stats.js), plus the builder's check of owner labels.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clone = value => JSON.parse(JSON.stringify(value));
const store = {};
const tabs = [];
const chrome = {
  storage: {
    local: {
      async get(defaults) {
        return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? clone(store[key]) : fallback]));
      },
      async set(values) { Object.assign(store, clone(values)); },
      async remove(keys) { for (const key of keys) delete store[key]; }
    }
  },
  runtime: { getURL: file => `chrome-extension://test/${file}` },
  tabs: {
    async query() { return tabs; },
    async create(props) { const tab = { id: tabs.length + 1, windowId: 7, ...props }; tabs.push(tab); return tab; },
    async update(id, props) { const tab = tabs.find(entry => entry.id === id); Object.assign(tab, props, { updated: true }); return tab; }
  },
  windows: { async update() { return {}; } }
};
const sandbox = vm.createContext({ chrome, console, Promise, Object, Array, Number, String, Boolean, Set, Math, Date, Uint8Array, RegExp, globalThis: null });
sandbox.globalThis = sandbox;
for (const file of ["domain/species-shape.js", "bg/species-stats.js", "bg/species-learned.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
}
const learned = sandbox.OWEH_BG.speciesLearned;
const stats = sandbox.OWEH_BG.speciesStats;

// Silhouettes far apart (128+ bits); near() differs from its argument by one bit.
const shape = filled => "f".repeat(filled) + "0".repeat(256 - filled);
const near = value => `${value.slice(0, -1)}1`;
const A = shape(16);
const B = shape(64);
const C = shape(112);
const key = species => learned.PREFIX + species;
const examples = species => store[key(species)]?.examples || [];
const wrongCase = (eggId, wrongSpecies, extra = {}) => ({
  eggId, source: `https://app.ovipets.com/img/pet/${eggId}/credit-challenge`, shape: A,
  options: ["Lepus", "Lotor", "Vulpes", "Catus"], wrongSpecies, method: "shape-match", distance: 120, ...extra
});

(async () => {
  // --- learned overlay ---
  assert.deepEqual(clone(await learned.learn({ species: "Lepus", shape: A })), { ok: true, added: true, count: 1 });
  assert.deepEqual(examples("Lepus"), [A]);
  assert.deepEqual(store[learned.INDEX_KEY], { Lepus: 1 });
  assert.equal((await learned.learn({ species: "Lepus", shape: near(A) })).added, false, "a near-duplicate adds nothing");
  assert.equal((await learned.learn({ species: "<img>", shape: A })).ok, false);
  assert.equal((await learned.learn({ species: "Lepus", shape: "zz" })).ok, false);
  await learned.learn({ species: "Lepus", shape: B });
  assert.deepEqual(clone(await learned.readAll()).Lepus.examples, [A, B]);
  assert.equal((await learned.forget({ species: "Lepus", shape: near(B) })).removed, 0, "forget takes back the exact silhouette only");
  assert.equal((await learned.forget({ species: "Lepus", shape: near(B), refuted: true })).removed, 1, "a species the game rejected loses its near-duplicates");
  assert.equal((await learned.forget({ species: "Lepus", shape: A })).removed, 1);
  assert.deepEqual(store[learned.INDEX_KEY], {});

  // --- safety pause ---
  const wrong = (now, auto = true) => learned.noteAnswers({ patch: { wrong: 1 }, auto }, now);
  const correct = now => learned.noteAnswers({ patch: { correct: 1 } }, now);
  let t = 1_000_000_000_000;
  assert.deepEqual(clone((await learned.readGuard(t)).limits), { streak: 3, perHour: 10 });
  assert.equal((await wrong(t)).tripped, false);
  assert.equal((await wrong(t += 1000)).tripped, false);
  assert.equal((await correct(t += 1000)).guard.streak, 0, "a correct answer ends the streak");
  await wrong(t += 1000);
  await wrong(t += 1000);
  for (let i = 0; i < 5; i += 1) assert.equal((await wrong(t += 1000, false)).tripped, false, "answers clicked by hand never count as wrong");
  const third = await wrong(t += 1000);
  assert.equal(third.tripped, true);
  assert.equal(third.guard.paused.reason, "3 wrong answers in a row");
  assert.equal(store[learned.GUARD_KEY].paused.at, t);
  assert.equal((await wrong(t += 1000)).tripped, false, "already paused: no second alert");
  assert.equal((await learned.status()).guard.paused.reason, "3 wrong answers in a row");
  const resumed = await learned.resume();
  assert.equal(resumed.guard.paused, null);
  assert.deepEqual(clone(store[learned.GUARD_KEY]), { wrongAt: [], streak: 0, paused: null });

  // More than 10 in one hour, never three in a row.
  let last = null;
  for (let i = 0; i < 11; i += 1) {
    last = await wrong(t += 60_000);
    if (i < 10) {
      assert.equal(last.tripped, false, `wrong answer ${i + 1} of the hour`);
      await correct(t += 1000);
    }
  }
  assert.equal(last.tripped, true);
  assert.equal(last.guard.paused.reason, "11 wrong answers within one hour");
  await learned.resume();
  // Wrong answers older than an hour are forgotten.
  for (let i = 0; i < 10; i += 1) { await wrong(t += 1000); await correct(t += 1000); }
  assert.equal((await wrong(t += 61 * 60_000)).tripped, false);
  await learned.resume();

  // 0 switches a limit off; nonsense falls back to the default.
  assert.deepEqual(clone((await learned.setLimits({ limits: { streak: 0, perHour: "" } })).guard.limits), { streak: 0, perHour: 10 });
  for (let i = 0; i < 6; i += 1) assert.equal((await wrong(t += 1000)).tripped, false);
  await learned.setLimits({ limits: { streak: 3, perHour: -4 } });
  assert.deepEqual(clone((await learned.readGuard(t)).limits), { streak: 3, perHour: 10 });
  await learned.resume();

  // --- owner labels, checked against the game's verdicts ---
  const first = (await stats.recordWrong({ case: wrongCase("501", "Vulpes") })).record;
  await stats.recordWrong({ case: wrongCase("501", "Catus", { shape: near(A) }) });
  assert.equal((await learned.labelCase({ id: first.id, species: "Vulpes" })).reason, "rejected-by-game");
  assert.equal((await learned.labelCase({ id: first.id, species: "Catus" })).reason, "rejected-by-game", "rejected on a retry of the same image");
  assert.equal((await learned.labelCase({ id: first.id, species: "Ursa" })).reason, "not-a-quiz-option");
  assert.equal((await learned.labelCase({ id: "nope", species: "Lepus" })).reason, "unknown-case");
  const labelled = await learned.labelCase({ id: first.id, species: "Lepus" });
  assert.equal(labelled.ok, true);
  assert.equal(labelled.updated, 2, "the label covers every saved case of that image");
  assert.ok(store.owehSpeciesWrongCases.every(item => item.correctSpecies === "Lepus" && item.ownerLabel.added === true && item.reviewedAt > 0));
  assert.deepEqual(examples("Lepus"), [A]);

  // A change of mind moves the silhouette.
  await learned.labelCase({ id: first.id, species: "Lotor" });
  assert.deepEqual(examples("Lepus"), []);
  assert.deepEqual(examples("Lotor"), [A]);

  // The game rejects the labelled species: the label goes and reports what to forget.
  const rejectedAgain = await stats.recordWrong({ case: wrongCase("501", "Lotor") });
  assert.deepEqual(clone(rejectedAgain.overruled), [{ species: "Lotor", shape: A }]);
  assert.ok(store.owehSpeciesWrongCases.every(item => !item.ownerLabel && !item.correctSpecies));
  await learned.forget({ ...rejectedAgain.overruled[0], refuted: true });
  assert.deepEqual(examples("Lotor"), []);

  // The game's own answer wins and locks the image; another image of the egg is left alone.
  await learned.labelCase({ id: first.id, species: "Lepus" });
  await stats.recordWrong({ case: wrongCase("501", "Vulpes", { shape: C }) });
  await learned.labelCase({ id: first.id, species: "" });
  assert.deepEqual(examples("Lepus"), [], "removing a label takes its silhouette back");
  await learned.labelCase({ id: first.id, species: "Lepus" });
  // Two overlapping requests for the same label (a double click) still leave one tracked mask.
  await Promise.all([learned.labelCase({ id: first.id, species: "Lotor" }), learned.labelCase({ id: first.id, species: "Lotor" })]);
  assert.equal(store.owehSpeciesWrongCases.find(item => item.id === first.id).ownerLabel.added, true);
  await learned.labelCase({ id: first.id, species: "Lepus" });
  assert.deepEqual(examples("Lotor"), [], "the mask of the replaced label is taken back");
  assert.deepEqual(examples("Lepus"), [A]);

  // The game confirms the owner's label: it becomes the game's answer and is locked.
  const confirmed = await stats.resolveWrong({ case: { eggId: "501", shape: A, correctSpecies: "Lepus" } });
  assert.equal(confirmed.updated, 3);
  assert.deepEqual(clone(confirmed.overruled), []);
  assert.ok(store.owehSpeciesWrongCases.filter(item => item.shape !== C).every(item => item.correctSpecies === "Lepus" && !item.ownerLabel));
  assert.equal(store.owehSpeciesWrongCases.find(item => item.shape === C).correctSpecies, "", "a later image of the same egg is a different question");
  assert.equal((await learned.labelCase({ id: first.id, species: "Lotor" })).reason, "resolved-by-game");
  assert.equal((await learned.labelCase({ id: first.id, species: "" })).reason, "resolved-by-game");
  assert.deepEqual(examples("Lepus"), [A], "the confirmed mask stays learned");

  // A newer picture of the egg: any species, learned from the picture's own silhouette.
  const other = store.owehSpeciesWrongCases.find(item => item.shape === C);
  const newer = await learned.labelCase({ id: other.id, species: "Ursa", imageChanged: true, shape: B });
  assert.equal(newer.ok, true);
  assert.deepEqual(examples("Ursa"), [B]);
  const reviewed = store.owehSpeciesWrongCases.find(item => item.shape === C);
  assert.equal(reviewed.correctSpecies, "", "the missed question itself stays unanswered");
  assert.ok(reviewed.reviewedAt > 0);

  await stats.recordWrong({ case: wrongCase("777", "Catus") });
  assert.equal((await stats.clearWrongCases({ reviewedOnly: true })).count, 1);
  assert.equal(store.owehSpeciesWrongCases[0].eggId, "777");

  // --- review page tab ---
  const opened = await learned.openReview();
  assert.equal(opened.reused, false);
  assert.equal(tabs[0].url, "chrome-extension://test/review/species-review.html");
  assert.equal((await learned.openReview()).reused, true);
  assert.equal(tabs.length, 1);

  // --- library builder: owner labels the game contradicts are refused ---
  const { vetCases } = require("../scripts/build-species-static.js");
  const hamming = sandbox.OWEH_SPECIES_SHAPE.hamming;
  const quiz = (eggId, extra) => ({ eggId, shape: A, options: ["Lepus", "Lotor", "Vulpes"], wrongSpecies: "Vulpes", ...extra });
  const verdict = vetCases([
    quiz("1", { correctSpecies: "Lepus" }),
    quiz("1", { correctSpecies: "Lotor", method: "owner-label" }),
    quiz("2", { correctSpecies: "Vulpes", method: "owner-label" }),
    quiz("3", { correctSpecies: "Ursa", method: "owner-label" }),
    quiz("4", { correctSpecies: "Lepus", method: "owner-label" }),
    quiz("4", { correctSpecies: "Lotor", method: "owner-label" }),
    quiz("5", { correctSpecies: "Lotor", method: "owner-label" }),
    quiz("6", { correctSpecies: "Ursa", method: "owner-label", imageChanged: true, shape: B }),
    quiz("7", {})
  ], hamming);
  assert.deepEqual(verdict.accepted.map(item => `${item.eggId}:${item.correctSpecies}`), ["1:Lepus", "5:Lotor", "6:Ursa"]);
  assert.equal(verdict.refused.length, 5);

  console.log("Species learned overlay, safety pause and owner label tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
