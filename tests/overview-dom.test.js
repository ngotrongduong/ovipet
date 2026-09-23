"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../dom/tabs.js", "../dom/overview.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
require("../jobs/core.js");
require("../dom/tabs.js");
require("../dom/overview.js");
const tabsApi = globalThis.OWEH.dom.tabs;
const overview = globalThis.OWEH.dom.overview;

const tab = {
  textContent: "Males",
  classList: { contains: value => value === "ui-tabs-active" },
  getAttribute(name) { if (name === "aria-controls") return "panel-1"; if (name === "enclosure") return "12"; return null; },
  querySelector(selector) { return selector === ":scope > a span" ? { textContent: "Males" } : null; }
};
const petLink = {
  classList: { contains: value => value === "name" ? false : false },
  getAttribute(name) { return name === "href" ? "#!/?usr=9&pet=123" : null; }
};
const nameLink = { textContent: "Alpha" };
const image = { getAttribute: name => name === "src" ? "/img/pet/123.png?modified=77" : null };
const card = {
  querySelectorAll(selector) { return selector === 'a.pet[href*="pet="]' ? [petLink] : []; },
  querySelector(selector) {
    if (selector === 'a.pet[href*="pet="]') return petLink;
    if (selector === "a.pet.name") return nameLink;
    if (selector === 'img[src*="/heart_iceblue.png"]') return {};
    if (selector === 'a.pet img[src*="/img/pet/"]') return image;
    return null;
  }
};
const input = { closest: selector => selector === "li" ? card : (selector.includes("tabpanel") ? { id: "panel-1" } : null) };
const panel = { querySelectorAll: selector => selector === 'input[name="PetID[]"]' ? [input] : [] };
const root = {
  querySelectorAll(selector) {
    if (selector === 'ul[role="tablist"] > li[role="tab"]') return [tab];
    if (selector === 'main ul[role="tablist"] > li[role="tab"][enclosure]') return [tab];
    if (selector === 'main [class*="load"], main [aria-busy="true"]') return [];
    return [];
  },
  querySelector(selector) {
    if (selector === 'main input[name="PetID[]"][value="123"]') return input;
    return null;
  },
  getElementById(id) { return id === "panel-1" ? panel : null; }
};

assert.equal(tabsApi.findTab("Males", root), tab);
assert.equal(tabsApi.isTabActive(tab), true);
assert.deepEqual(overview.overviewCards(root), [card]);
assert.deepEqual(overview.overviewCardInfo(card), { id: "123", usr: "9", name: "Alpha", onCooldown: true, modified: "77" });
assert.equal(overview.overviewSignature(root), "123:77:1:Alpha");
assert.equal(overview.overviewEnclosureForPet("123", root), "Males");
assert.equal(overview.isOverviewBusy(root), false);

console.log("overview/tab DOM adapter behavior tests passed");
