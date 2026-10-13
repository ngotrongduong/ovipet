"use strict";

// Copies the files Friend Sweep Lite shares with the full extension into friend-sweep-lite/,
// byte for byte, from a checkout of the full extension's working branch:
//
//   node scripts/sync-lite-species.js <path-to-full-extension-checkout>
//
// Lite keeps the same relative layout (domain/, data/, bg/, review/) so the files need no edits:
// Name the Species (the silhouette matcher, the built-in library, the wrong-case store, the
// learned overlay with the safety pause, the review page) and the self-update module. Lite's
// own background.js / content.js only wire them.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SHARED = [
  "domain/species-shape.js",
  "data/species-static.js",
  "bg/species-stats.js",
  "bg/species-learned.js",
  "bg/self-update.js",
  "review/species-review.html",
  "review/species-review.js",
  "review/species-review.css"
];

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/sync-lite-species.js <path-to-full-extension-checkout>");
  process.exit(1);
}
const target = path.join(__dirname, "..", "friend-sweep-lite");
for (const file of SHARED) {
  const from = path.join(source, file);
  if (!fs.existsSync(from)) throw new Error(`missing in the full extension: ${file}`);
  const to = path.join(target, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // LF like the repository, whatever the source checkout's line endings are.
  fs.writeFileSync(to, fs.readFileSync(from, "utf8").replace(/\r\n/g, "\n"));
}
let commit = "unknown";
try { commit = execFileSync("git", ["-C", source, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
fs.writeFileSync(path.join(target, "SHARED_FROM.txt"),
  `Files shared with the full extension, copied unchanged from its commit ${commit}:\n${SHARED.map(file => `- ${file}`).join("\n")}\nRefresh them with: node scripts/sync-lite-species.js <full-extension-checkout>\n`);
console.log(`synced ${SHARED.length} shared files from ${source} (${commit})`);
