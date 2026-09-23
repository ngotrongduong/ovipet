"use strict";

// The Overview can report zero enclosure tabs right after load and add them later; scanning
// the tab list too early made a catalog scan see only the first enclosure (v5.0.4 finding).
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "services", "overview-catalog.js"), "utf8");
const catalog = fs.readFileSync(path.join(__dirname, "..", "jobs", "catalog.js"), "utf8");

if (!source.includes("async function waitForOverviewShell(timeout = 10000)")) {
  throw new Error("waitForOverviewShell is missing");
}
if (!catalog.includes("await catalogService.waitForOverviewShell(")) {
  throw new Error("Update pet catalog must wait for the Overview shell before scanning");
}

const collectStart = source.indexOf("async function collectAllOverviewPets()");
const tabsSnapshot = source.indexOf("const tabs = overviewEnclosureTabs();", collectStart);
const shellWait = source.indexOf("await waitForOverviewShell", collectStart);
if (collectStart < 0 || shellWait < collectStart || tabsSnapshot < shellWait) {
  throw new Error("Overview shell must be awaited before the enclosure-tab snapshot");
}

console.log("overview shell wait test passed");
