"use strict";

// The Overview can report zero enclosure tabs right after load and add them later; scanning
// the tab list too early made a catalog scan see only the first enclosure (v5.0.4 finding).
// Since v5.5.0 Update database reads the Overview panel by fetch (services/pet-fetch.js), which
// never races the SPA; v5.9.0 removed the navigated collector entirely.
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "services", "overview-catalog.js"), "utf8");
const maintain = fs.readFileSync(path.join(__dirname, "..", "jobs", "maintain.js"), "utf8");

if (!source.includes("async function waitForOverviewShell(timeout = 10000)")) {
  throw new Error("waitForOverviewShell is missing");
}
if (!maintain.includes("petFetch.collectCatalog(")) {
  throw new Error("Update database must read the catalog through the fetched Overview panels");
}

if (source.includes("collectAllOverviewPets")) {
  throw new Error("The navigated Overview catalog scan was removed in v5.9.0");
}

console.log("overview shell wait test passed");
