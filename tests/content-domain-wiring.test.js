"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const isolated = manifest.content_scripts.find(entry => entry.world !== "MAIN" && entry.js?.includes("content.js"));
assert.ok(isolated, "isolated content script set missing");
assert.ok(isolated.js.indexOf("domain/pedigree.js") >= 0, "pedigree module missing from manifest");
assert.ok(isolated.js.indexOf("domain/pedigree.js") < isolated.js.indexOf("features/breeding.js"),
  "pedigree module must load before breeding feature");
assert.ok(isolated.js.indexOf("features/breeding.js") < isolated.js.indexOf("content.js"),
  "breeding feature must register before content boot");

const bootStart = content.indexOf("const modules = OWEH.boot({");
const bootEnd = content.indexOf("});", bootStart);
assert.ok(bootStart >= 0 && bootEnd > bootStart, "OWEH.boot helper block missing");
const bootBlock = content.slice(bootStart, bootEnd);
assert.match(bootBlock, /pedigree:\s*OWEH\.domain\.pedigree/,
  "content boot must inject OWEH.domain.pedigree into feature helpers");

console.log("content/domain dependency wiring tests passed");
