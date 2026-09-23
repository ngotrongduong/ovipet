"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../dom/routes.js", "../dom/profile.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
globalThis.location = { hash: "#!/?src=pets&sub=profile&pet=42", href: "https://ovipets.com/#!/?src=pets&sub=profile&pet=42" };
require("../jobs/core.js");
require("../dom/routes.js");
require("../dom/profile.js");
const profile = globalThis.OWEH.dom.profile;

const cell = textContent => ({ textContent });
const rows = {
  Body: [cell("Body"), cell("#FFFFFF"), cell("#FF0000")],
  Scales: [cell("Scales"), cell("#000000")],
  Extra: [cell("Extra"), cell("#FF0000"), cell("#000000")]
};
const table = {
  querySelector(selector) {
    const id = selector.match(/^tr#(.+)$/)?.[1];
    return id && rows[id] ? { querySelectorAll: () => rows[id] } : null;
  }
};
const overview = {
  Gender: "Female",
  Species: "Raptor",
  Food: "87.5%"
};
const overviewRows = Object.entries(overview).map(([label, value]) => ({
  querySelector(selector) {
    if (selector === ".attr") return { textContent: label };
    if (selector === ".value") return { textContent: value };
    return null;
  }
}));
const ancestors = ["1", "2", "3", "4", "5", "6", "7"].map(id => ({
  getAttribute(name) { return name === "href" ? `#!/?pet=${id}` : null; }
}));
const main = { querySelectorAll: () => [], innerText: "", children: [{}] };
const root = {
  querySelector(selector) {
    if (selector === "fieldset.colors table") return table;
    if (selector === "section#pedigree fieldset.ancestors") return { querySelectorAll: () => ancestors };
    if (selector === "main") return main;
    if (selector === 'main h3 .ui-section-title') return { textContent: "Test Pet" };
    return null;
  },
  querySelectorAll(selector) {
    if (selector === "section#overview fieldset.overview li") return overviewRows;
    if (selector === 'section#pedigree fieldset.ancestors a.pet[href*="pet="]') return ancestors;
    return [];
  }
};

assert.deepEqual(profile.readColors(root), {
  body1: "#FFFFFF", body2: "#FF0000", scales: "#000000", extra1: "#FF0000", extra2: "#000000"
});
const graph = profile.pedigreeAncestorGraph(root);
assert.deepEqual(graph.slice(0, 3).map(node => [node.id, node.generation, node.relation]), [
  ["1", 1, "parent-1"], ["2", 1, "parent-2"], ["3", 2, "ancestor"]
]);
assert.equal(graph[6].generation, 3);


const visibleButton = { isConnected: true, disabled: false, offsetParent: {} };
const hiddenButton = { isConnected: true, disabled: false, offsetParent: null };
const buttonRoot = { querySelectorAll: selector => selector === profile.PROFILE_TURN_SELECTOR ? [hiddenButton, visibleButton] : [] };
assert.equal(profile.getProfileTurnButton(buttonRoot), visibleButton);

const now = 123456;
const pet = profile.readPet(root, location.href, now);
assert.equal(pet.id, "42");
assert.equal(pet.name, "Test Pet");
assert.equal(pet.gender, "Female");
assert.equal(pet.species, "Raptor");
assert.equal(pet.foodPercent, 87.5);
assert.equal(pet.foodCheckedAt, now);
assert.equal(pet.pedigreeVerified, true);
assert.deepEqual(pet.parentIds, ["1", "2"]);
assert.deepEqual(pet.ancestors, ["1", "2", "3", "4", "5", "6", "7"]);
const unverifiedRoot = { ...root, querySelector: selector => selector === "section#pedigree fieldset.ancestors" ? null : root.querySelector(selector) };
const unverifiedPet = profile.readPet(unverifiedRoot, location.href, now);
assert.equal(unverifiedPet.pedigreeVerified, false);
assert.deepEqual(unverifiedPet.ancestors, []);

console.log("profile DOM adapter behavior tests passed");
