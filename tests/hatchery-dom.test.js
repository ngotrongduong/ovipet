"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

delete require.cache[require.resolve(path.join(__dirname, "../jobs/core.js"))];
delete require.cache[require.resolve(path.join(__dirname, "../dom/hatchery.js"))];
delete globalThis.OWEH;
require("../jobs/core.js");
require("../dom/hatchery.js");
const hatchery = globalThis.OWEH.dom.hatchery;

const nameAnchor = { textContent: "Unnamed" };
const image = {
  getAttribute(name) {
    if (name === "width") return "120";
    if (name === "height") return null;
    if (name === "src") return "/img/pet/123.png?size=80&modified=55";
    return null;
  }
};
let turnIcon;
let hatchIcon;
const card = {
  querySelector(selector) {
    if (selector === 'a.pet[href*="pet="]') return petAnchor;
    if (selector === 'a.pet img[src*="/img/pet/"]') return image;
    if (selector === "a.pet.name") return nameAnchor;
    if (selector === hatchery.HATCHERY_TURN_SELECTOR) return turnIcon;
    if (selector === hatchery.HATCHERY_HATCH_SELECTOR) return hatchIcon;
    return null;
  }
};
const petAnchor = {
  getAttribute(name) { return name === "href" ? "#!/?usr=9&pet=123" : null; },
  closest(selector) { return selector === "li" ? card : null; }
};
turnIcon = {
  closest(selector) { return selector === "li" ? card : null; }
};
hatchIcon = {
  closest(selector) { return selector === "li" ? card : null; }
};
const root = {
  querySelectorAll(selector) {
    if (selector === 'input[name="PetID[]"]') return [{ value: "123" }, { value: "456" }];
    if (selector === hatchery.HATCHERY_TURN_SELECTOR) return [turnIcon];
    if (selector === hatchery.HATCHERY_HATCH_SELECTOR) return [hatchIcon];
    if (selector === 'main a.pet[href*="pet="]') return [petAnchor];
    if (selector === 'a.pet[href*="pet="]') return [petAnchor];
    return [];
  }
};

assert.equal(hatchery.getHatcheryEggCount(root), 2);
assert.deepEqual(hatchery.getHatcheryEggs(root), [{ id: "123", href: "#!/?usr=9&pet=123" }]);
assert.deepEqual(hatchery.getHatcheryHatchableEggs(root), [{ id: "123", href: "#!/?usr=9&pet=123" }]);
assert.deepEqual(hatchery.getHatcheryPetCards(root), [{
  id: "123",
  href: "#!/?usr=9&pet=123",
  usr: "9",
  modified: "55",
  name: "Unnamed",
  turnable: true,
  hatchable: true,
  likelyHatched: true,
  unnamed: true
}]);

console.log("hatchery DOM adapter behavior tests passed");
