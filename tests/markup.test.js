"use strict";

// dom/markup.js (v5.5.0): pure parsers for the game's JSONP panels, checked against trimmed
// live samples so the command-first jobs read the same data the navigated pages show.
const assert = require("node:assert/strict");
const path = require("node:path");
const samples = require("./fixtures/markup-samples");

for (const file of ["../jobs/core.js", "../dom/markup.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
require("../jobs/core.js");
require("../dom/markup.js");
const markup = globalThis.OWEH.dom.markup;

// ---- JSONP envelope
assert.equal(markup.unwrapCb(samples.cb("<p>x</p>")), "<p>x</p>");
assert.equal(markup.unwrapCb(` cb({"output":"a"})\n`), "a");
assert.throws(() => markup.unwrapCb("cb({\"error\":1});"), /no output/);
assert.equal(markup.decodeEntities("&lt;p enclosure = &quot;0&quot;&gt;A&amp;B&lt;/p&gt;"), "<p enclosure = \"0\">A&B</p>");

// ---- overview tabs
assert.deepEqual(markup.parseEnclosureTabs(samples.overview).map(tab => [tab.id, tab.label]), [
  ["0", "Newborn"], ["1", "** ** FF"], ["8", "Breeding stock"], ["9", "males"]
]);

// ---- enclosure panel
const pets = markup.parseEnclosurePets(samples.enclosure, { id: "9", label: "males" });
assert.equal(pets.length, 2, "escaped dialog markup is never read as a pet");
assert.deepEqual({ ...pets[0] }, {
  id: "153900436", usr: "4973830", name: "A6EBFF-CE0600-3B0900", onCooldown: false,
  modified: "1776067443", enclosure: "males", enclosureId: "9"
});
assert.equal(pets[1].onCooldown, true, "the ice-blue heart marks a breeding cooldown");
assert.equal(markup.parseEnclosurePets(samples.enclosure)[0].enclosureId, "9", "the section id names the enclosure");

// ---- profiles
const named = markup.parseProfile(samples.namedProfile);
assert.equal(named.id, "157155269");
assert.equal(named.name, "F5FAF2-F20B18-13101B");
assert.equal(named.unnamed, false);
assert.equal(named.gender, "Female");
assert.equal(named.species, "Draconis");
assert.equal(named.hatched, "2016-04-04");
assert.deepEqual({ ...named.colors }, { body1: "#F5FAF2", body2: "#F20B18", scales: "#13101B", extra1: "#E30825", extra2: "#1C002A" });
assert.equal(named.foodPercent, 99);
assert.equal(named.enclosureId, "8");
assert.equal(named.enclosureLabel, "Breeding stock", "option labels are trimmed");
assert.deepEqual({ ...named.enclosureOptions }, { Newborn: "0", "** ** FF": "1", "Breeding stock": "8", males: "9" });
assert.equal(named.canRename, true);
assert.equal(named.canName, false);
assert.equal(named.canFeed, true);

const unnamed = markup.parseProfile(samples.unnamedProfile);
assert.equal(unnamed.id, "530491258");
assert.equal(unnamed.unnamed, true);
assert.equal(unnamed.gender, "Male");
assert.equal(unnamed.canName, true, "a newborn is named with pet_name, not pet_rename");
assert.equal(unnamed.canRename, false);
assert.equal(unnamed.enclosureLabel, "Newborn");
assert.equal(markup.parseProfile("<ui:section title = \"Pets\" id = \"pets\"></ui:section>"), null);

// ---- pedigree
const graph = markup.parsePedigree(samples.pedigree);
assert.equal(graph.verified, true);
assert.deepEqual(graph.nodes.map(node => node.id), [
  "154320984", "155631245", "153775948", "153775998", "153899678", "155335666", "153899555", "153776020"
], "descendants are excluded; ancestors stay breadth-first");
assert.deepEqual(graph.nodes.map(node => node.generation), [1, 1, 2, 2, 2, 2, 3, 3]);
assert.deepEqual(graph.nodes.slice(0, 3).map(node => node.relation), ["parent-1", "parent-2", "ancestor"]);
assert.deepEqual({ ...markup.parsePedigree(samples.pedigreeFoundation) }, { verified: true, nodes: [] },
  "a foundation pet still has a verified (empty) pedigree");
assert.equal(markup.parsePedigree("<ui:section title = \"Pedigree\" id = \"pedigree\"></ui:section>").verified, false);

// ---- hatchery
const hatchery = markup.parseHatchery(samples.hatchery);
assert.deepEqual([...hatchery.eggIds], ["530566971", "530566972", "530566973"], "script and dialog copies are ignored");
assert.deepEqual([...hatchery.turnable], ["530566972"]);
assert.deepEqual([...hatchery.hatchable], ["530566973"]);
assert.deepEqual([...hatchery.unnamedIds], ["530491258"]);

// ---- record compatible with dom/profile.js readPet
const record = markup.petRecord({ id: "157155269", profile: named, pedigree: graph, now: 1000 });
assert.deepEqual(Object.keys(record).sort(), [
  "ancestors", "colors", "foodCheckedAt", "foodPercent", "gender", "id", "name", "parentIds",
  "pedigree", "pedigreeVerified", "species", "updatedAt", "url"
]);
assert.deepEqual([...record.parentIds], ["154320984", "155631245"]);
assert.equal(record.ancestors.length, 8);
assert.equal(record.pedigreeVerified, true);
assert.equal(record.foodCheckedAt, 1000);
assert.equal(record.url, "https://ovipets.com/#!/?src=pets&sub=profile&pet=157155269");
const unverified = markup.petRecord({ id: "1", profile: named, pedigree: { verified: false, nodes: [] } });
assert.equal(unverified.pedigreeVerified, false);
assert.deepEqual([...unverified.ancestors], []);
assert.equal(markup.petRecord({ id: "1", profile: { ...named, colors: { body1: "#000000" } } }), null,
  "a profile without colors is not a record");

console.log("markup tests passed");
