"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const result = spawnSync(process.execPath, [path.join(root, "scripts", "verify-release.js")], {
  cwd: root,
  encoding: "utf8"
});
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
}
assert.equal(result.status, 0, "release consistency script must pass");
assert.match(result.stdout, /Release consistency check passed for v\d+\.\d+\.\d+/);
console.log("release integrity tests passed");
