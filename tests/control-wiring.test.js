"use strict";

// Every panel button must be wired, either by ui/panel.js or by a job module's
// `buttons` (jobs/*.js), and every wired selector must exist in the panel HTML.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const panelSource = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
const ownEggsSource = fs.readFileSync(path.join(__dirname, "..", "features", "own-eggs.js"), "utf8");
const friendSweepSource = fs.readFileSync(path.join(__dirname, "..", "features", "friend-sweep.js"), "utf8");
const runtimeSource = `${source}\n${ownEggsSource}\n${friendSweepSource}`;
const jobsDir = path.join(__dirname, "..", "jobs");
const jobSources = fs.readdirSync(jobsDir).map(name => fs.readFileSync(path.join(jobsDir, name), "utf8"));

const htmlIds = new Set([...panelSource.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
const contentBindings = [...panelSource.matchAll(/bind(?:Panel)?Action\(panel, ["']#([^"']+)["']/g)].map(match => match[1]);
const jobBindings = jobSources.flatMap(text => [
  ...text.matchAll(/job\.buttons\("#([^"]+)", "#([^"]+)"\)/g)
].flatMap(match => [match[1], match[2]]).concat(
  [...text.matchAll(/^\s+"#([^"]+)": \{ label:/gm)].map(match => match[1])
));
const bindings = [...contentBindings, ...jobBindings];
const missing = [...new Set(bindings.filter(id => !htmlIds.has(id)))];

if (missing.length) throw new Error(`Bindings reference missing controls: ${missing.join(", ")}`);
for (const id of [
  "oweh-catalog-start", "oweh-profiles-start", "oweh-sort-start", "oweh-feed-start",
  "oweh-ninja-start", "oweh-requests-start", "oweh-start-sweep", "oweh-start-breed", "oweh-start-breed-target"
]) {
  if (!bindings.includes(id)) throw new Error(`Critical button is not bound: ${id}`);
}
for (const id of [
  "oweh-catalog-stop", "oweh-profiles-stop", "oweh-sort-stop", "oweh-feed-stop",
  "oweh-ninja-stop", "oweh-requests-stop"
]) {
  if (!bindings.includes(id)) throw new Error(`Every job needs its own Stop button: ${id}`);
}
if (/id="oweh-(run|stop)-daily"|>Run Daily Maintenance</.test(panelSource)) {
  throw new Error("The chained Daily Maintenance button must not come back — every button is one job");
}
// Every job with a Start button in the panel must have a matching Stop button next to it.
for (const start of htmlIds) {
  if (/^oweh-.+-start$/.test(start) && !htmlIds.has(start.replace(/-start$/, "-stop"))) {
    throw new Error(`Start button without a Stop button: ${start}`);
  }
}
// Start full sweep turns friends' eggs in real tabs (v5.3.0), never from the worker tab itself.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const contentScripts = manifest.content_scripts.flatMap(entry => entry.js);
for (const file of ["jobs/friend-eggs.js", "jobs/egg-turn-tab.js"]) {
  if (!contentScripts.includes(file)) throw new Error(`${file} must be loaded by the manifest`);
  if (contentScripts.indexOf(file) > contentScripts.indexOf("content.js")) throw new Error(`${file} must load before content.js`);
}
if (!friendSweepSource.includes('return OWEH.get("friend-eggs")?.api || null;')
  || !friendSweepSource.includes("if (friendEggs) friendEggs.process();")) {
  throw new Error("The sweep must hand friend eggs to jobs/friend-eggs.js");
}
if (/if (sweep.active && currentFriendId() === id) startEggRun()/.test(runtimeSource)) {
  throw new Error("The sweep must not turn friend eggs directly from its own tab (startEggRun)");
}
if (!ownEggsSource.includes('if (autoStarting || autoStartSuppressed || !routes.isOwnHatchery()) return;')) {
  throw new Error("Own-egg auto-start must NEVER activate while browsing a friend Hatchery");
}
if (!ownEggsSource.includes("gameActions.hatchOwnEgg(egg.id)")) {
  throw new Error("Own-Hatchery Hatch Egg must use the dedicated UI-dispatch action");
}
if (!friendSweepSource.includes('runtimeRequest({ type: "eggBatchStop", source: "sweep" })')) {
  throw new Error("Stopping the sweep must close only the sweep egg tabs it opened");
}
// A reload of the worker tab kills a one-button job; the resync must release the orphaned lease.
if (!source.includes("const orphanedJob = workerClient.getOwner() == null && Boolean(STRAIGHT_JOB_LABELS[status.worker.owner])")
  || !source.includes('status.worker.phase !== "starting"')) {
  throw new Error("Worker-tab reload must release an orphaned one-button job lease");
}
if (!source.includes("if (!found.size) return [];")) {
  throw new Error("An empty Overview scan must not overwrite saved enclosure ids");
}
if (!panelSource.includes("existing?.dataset.owehInstance === PANEL_INSTANCE")
  || !panelSource.includes("existing?.remove()")) {
  throw new Error("Stale-panel recovery is missing");
}

console.log(`control wiring tests passed (${bindings.length} actions)`);
