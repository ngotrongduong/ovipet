"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = relative => fs.existsSync(path.join(ROOT, relative));
const fail = message => { throw new Error(message); };

const manifest = JSON.parse(read("manifest.json"));
if (manifest.manifest_version !== 3) fail(`expected Manifest V3, got ${manifest.manifest_version}`);
const version = String(manifest.version || "");
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid manifest version: ${version || "<missing>"}`);

const panel = read("ui/panel.js");
const panelMatch = panel.match(/class="oweh-version">v(\d+\.\d+\.\d+)<\/span>/);
if (!panelMatch) fail("ui/panel.js is missing the canonical oweh-version marker");

const readme = read("README.md");
const readmeMatch = readme.match(/Current release:\s+\*\*v(\d+\.\d+\.\d+)\*\*/);
if (!readmeMatch) fail("README.md is missing `Current release: **vX.Y.Z**`");

const working = read("docs/WORKING_STATE.md");
const workingMatch = working.match(/Current release baseline:\s+v(\d+\.\d+\.\d+)/);
if (!workingMatch) fail("WORKING_STATE.md is missing `Current release baseline: vX.Y.Z`");

for (const [name, candidate] of [
  ["ui/panel.js", panelMatch[1]],
  ["README.md", readmeMatch[1]],
  ["docs/WORKING_STATE.md", workingMatch[1]]
]) {
  if (candidate !== version) fail(`version mismatch: manifest=${version}, ${name}=${candidate}`);
}

for (const scriptSet of manifest.content_scripts || []) {
  for (const relative of [...(scriptSet.js || []), ...(scriptSet.css || [])]) {
    if (!exists(relative)) fail(`manifest references missing file: ${relative}`);
  }
}
if (!manifest.background?.service_worker || !exists(manifest.background.service_worker)) {
  fail("manifest background service worker is missing");
}

const background = read(manifest.background.service_worker);
const importCall = background.match(/importScripts\(([^;]+)\);/s);
if (!importCall) fail("background.js does not declare its service imports");
const imported = [...importCall[1].matchAll(/["']([^"']+\.js)["']/g)].map(match => match[1]);
if (!imported.length) fail("background.js importScripts list is empty");
for (const relative of imported) if (!exists(relative)) fail(`background importScripts references missing file: ${relative}`);

const offscreen = read("offscreen.html");
for (const match of offscreen.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
  if (!exists(match[1])) fail(`offscreen.html references missing script: ${match[1]}`);
}

for (const forbidden of [".claude/settings.local.json", ".claude/scheduled_tasks.lock"]) {
  if (exists(forbidden)) fail(`local-only file must not be packaged: ${forbidden}`);
}
const gitignore = read(".gitignore");
for (const required of [".claude/settings.local.json", ".claude/scheduled_tasks.lock"]) {
  if (!gitignore.includes(required)) fail(`.gitignore must protect local-only file: ${required}`);
}

console.log(`Release consistency check passed for v${version} (${imported.length} background services).`);
