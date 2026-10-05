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
const dbSource = read("species-static.js");

assert.equal(manifest.name, "OviPets Friend Sweep Lite");
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions.sort(), ["alarms","declarativeNetRequest","storage","tabs"].sort());
assert.equal(manifest.content_scripts.length, 1);
assert.deepEqual(manifest.content_scripts[0].js, ["species-static.js","species-shape.js","content.js"]);

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
assert.match(content, /liteSpeciesStats/);
assert.match(content, /liteSpeciesWrongRecord/);
assert.match(content, /liteSpeciesWrongResolve/);
assert.match(content, /oweh-lite-export-wrongs/);
assert.match(background, /MAX_WRONG_CASES = 250/);
assert.match(background, /liteSpeciesWrongGet/);
assert.match(content, /correct: 1/);
assert.match(content, /wrong: 1/);
assert.ok(css.length < 2500, "Lite UI CSS should remain tiny");

const sandbox = vm.createContext({ console, Object, Array, Set, Number, String, Boolean, Math, globalThis: null });
sandbox.globalThis = sandbox;
vm.runInContext(dbSource, sandbox, { filename: "species-static.js" });
const db = sandbox.OWEH_STATIC_SPECIES;
assert.equal(db.meta.species, 10);
assert.equal(db.meta.examples, 451);
assert.deepEqual(Object.fromEntries(Object.entries(db.library).map(([name, row]) => [name, row.examples.length])), {
  Canis: 46, Draconis: 30, Equus: 49, Feline: 45, Gekko: 38,
  Lupus: 40, Mantis: 58, Raptor: 55, Slime: 46, Vulpes: 44
});

console.log("Friend Sweep Lite contract tests passed");
