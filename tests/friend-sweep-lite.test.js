"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "friend-sweep-lite");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const background = read("background.js");
const content = read("content.js");
const css = read("content.css");
const dbSource = read("data/species-static.js");

assert.equal(manifest.name, "OviPets Friend Sweep Lite");
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions.sort(), ["alarms","declarativeNetRequest","storage","tabs","unlimitedStorage"].sort());
assert.equal(manifest.content_scripts.length, 1);
assert.deepEqual(manifest.content_scripts[0].js, ["data/species-static.js","domain/species-shape.js","content.js"]);
for (const file of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css, manifest.background.service_worker]) {
  assert.ok(fs.existsSync(path.join(root, file)), `manifest references a missing file: ${file}`);
}

for (const forbidden of [
  "breeding", "retention", "male-cull", "ninja", "pet database", "species-inspector",
  "openSpeciesReview", "owehSpeciesMemory", "owehSpeciesShapes", "owehSpeciesAnswerIds"
]) {
  assert.equal((background + "\n" + content).toLowerCase().includes(forbidden.toLowerCase()), false,
    `Lite runtime must not include full-extension subsystem: ${forbidden}`);
}

assert.match(background, /SPEED_LEVELS = \[3, 4, 6\]/);
assert.match(background, /TAB_TIMEOUT_MS = 60 \* 1000/);
assert.match(background, /CYCLE_WAIT_MS = 10 \* 60 \* 1000/);
assert.match(background, /resourceTypes: \["image", "media", "font"\]/);
assert.match(background, /credit-challenge/);
assert.match(background, /type === "liteDelay"/);
assert.match(background, /autoDiscardable: false/);
assert.match(background, /isWorker: state\.active/);
assert.match(content, /state\?\.active && !snapshot\.isWorker/);
assert.match(content, /Date\.now\(\) - stableSince >= 1500/);
assert.match(content, /button\[onclick\*="pet_turn_egg"\]/);
assert.match(content, /Name the Species/i);
assert.match(content, /VERIFY_ATTEMPTS = 2/);
assert.match(content, /oweh-lite-export-wrongs/);
assert.match(content, /correct: 1/);
assert.match(content, /wrong: 1/);
assert.ok(css.length < 2500, "Lite UI CSS should remain tiny");

// Name the Species is the full extension's, file for file: the service worker imports the
// shared modules and the page code talks to them with the shared message names.
const imports = background.match(/importScripts\(([^;]+)\);/)[1];
for (const file of ["domain/species-shape.js", "bg/species-stats.js", "bg/species-learned.js"]) {
  assert.ok(imports.includes(`"${file}"`), `service worker must import ${file}`);
  assert.ok(fs.existsSync(path.join(root, file)), `shared file missing: ${file}`);
}
assert.ok(imports.indexOf('"domain/species-shape.js"') < imports.indexOf('"bg/species-stats.js"'));
assert.ok(imports.indexOf('"bg/species-stats.js"') < imports.indexOf('"bg/species-learned.js"'));
assert.match(read("bg/species-stats.js"), /MAX_WRONG_CASES = 250/);

const page = read("review/species-review.html");
for (const match of page.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)) {
  assert.ok(fs.existsSync(path.join(root, "review", match[1])), `review page references a missing file: ${match[1]}`);
}
const handled = new Set([...background.matchAll(/^\s+(species[A-Za-z]+): \(\) =>/gm)].map(match => match[1]));
for (const [name, source] of [["review page", read("review/species-review.js")], ["content script", content]]) {
  for (const match of source.matchAll(/type: "(species[A-Za-z]+)"/g)) {
    assert.ok(handled.has(match[1]), `${name} sends ${match[1]}, which the Lite service worker does not handle`);
  }
}
for (const type of ["speciesStatsBump", "speciesWrongCaseRecord", "speciesWrongCaseResolve", "speciesConfirmedShape", "speciesGuardResume", "speciesWrongReviewOpen"]) {
  assert.ok(content.includes(`type: "${type}"`), `content script should send ${type}`);
}
assert.equal(/liteSpeciesStats|liteSpeciesWrong|OWEH_LITE_SHAPE/.test(background + content), false, "retired Lite-only species names remain");
// The content script reads the keys the shared service-worker module writes.
const learnedModule = read("bg/species-learned.js");
for (const key of ["owehSpeciesLearned_", "owehSpeciesGuard"]) {
  assert.ok(learnedModule.includes(`"${key}"`) && content.includes(`"${key}"`), `storage key must match on both sides: ${key}`);
}
for (const id of ["oweh-lite-review", "oweh-lite-resume"]) assert.ok(content.includes(`id="${id}"`), `panel control missing: ${id}`);

const sandbox = vm.createContext({ console, Object, Array, Set, Number, String, Boolean, Math, globalThis: null });
sandbox.globalThis = sandbox;
vm.runInContext(dbSource, sandbox, { filename: "species-static.js" });
const db = sandbox.OWEH_STATIC_SPECIES;
assert.ok(db.meta.species >= 39, "the built-in library covers the enlarged quiz pool");
assert.ok(db.meta.examples >= 1691);
for (const name of ["Canis", "Draconis", "Equus", "Feline", "Gekko", "Lupus", "Mantis", "Raptor", "Slime", "Vulpes"]) {
  assert.ok(db.library[name].examples.length >= 140, `original species keeps its full sample: ${name}`);
}
for (const name of ["Lepus", "Catus", "Taurus", "Ursa"]) assert.ok(db.library[name]?.examples.length > 0, `new species present: ${name}`);

console.log("Friend Sweep Lite contract tests passed");
