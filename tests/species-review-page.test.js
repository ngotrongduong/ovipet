"use strict";

// Wiring of the Name-the-Species review page, safety pause controls and learned overlay:
// every message a page or content module sends has a background handler, and the files the
// review page loads exist.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const background = read("background.js");
const page = read("review/species-review.html");
const pageScript = read("review/species-review.js");
const panel = read("ui/panel.js");
const answerer = read("jobs/species-answer.js");

for (const match of page.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)) {
  assert.ok(fs.existsSync(path.join(root, "review", match[1])), `review page references a missing file: ${match[1]}`);
}
assert.ok(page.indexOf("domain/species-shape.js") < page.indexOf("species-review.js"), "the matcher must load before the page script");
assert.ok(page.indexOf("data/species-static.js") < page.indexOf("species-review.js"), "the built-in library must load before the page script");
assert.equal(/<script(?![^>]*\bsrc=)/.test(page), false, "extension pages may not use inline scripts");
assert.equal(/\son[a-z]+=/.test(page), false, "extension pages may not use inline event handlers");

const handled = new Set([...background.matchAll(/message\?\.type === "(species[A-Za-z]+)"/g)].map(match => match[1]));
for (const [name, source] of [["review page", pageScript], ["panel", panel], ["answerer", answerer]]) {
  for (const match of source.matchAll(/type: "(species[A-Za-z]+)"/g)) {
    assert.ok(handled.has(match[1]), `${name} sends ${match[1]}, which background.js does not handle`);
  }
}
for (const type of ["speciesOwnerLabel", "speciesLearnedGet", "speciesGuardGet", "speciesGuardResume", "speciesWrongCasesGet"]) {
  assert.ok(pageScript.includes(`type: "${type}"`), `review page should use ${type}`);
}
for (const type of ["speciesConfirmedShape", "speciesStatsBump"]) {
  assert.ok(answerer.includes(`type: "${type}"`), `answerer should send ${type}`);
}

const imports = background.match(/importScripts\(([^;]+)\);/s)[1];
assert.ok(imports.indexOf('"domain/species-shape.js"') >= 0, "the service worker needs the silhouette matcher");
assert.ok(imports.indexOf('"domain/species-shape.js"') < imports.indexOf('"bg/species-stats.js"'));
assert.ok(imports.indexOf('"bg/species-stats.js"') < imports.indexOf('"bg/species-learned.js"'));

for (const id of ["oweh-species-guard", "oweh-wrongs-review", "oweh-species-resume", "oweh-species-streak", "oweh-species-hour"]) {
  assert.ok(panel.includes(`id="${id}"`), `panel control missing: ${id}`);
}
// The answerer reads the same storage keys the background writes.
const learnedModule = read("bg/species-learned.js");
for (const key of ["owehSpeciesLearned_", "owehSpeciesGuard"]) {
  assert.ok(learnedModule.includes(`"${key}"`) && answerer.includes(`"${key}"`), `storage key must match on both sides: ${key}`);
}

console.log("Species review page and pause wiring tests passed");
