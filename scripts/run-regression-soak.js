"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const roundsArg = Number(process.argv[2] || process.env.OWEH_SOAK_ROUNDS || 20);
const rounds = Number.isInteger(roundsArg) && roundsArg > 0 ? roundsArg : 20;
const testsDir = path.join(ROOT, "tests");
const testFiles = fs.readdirSync(testsDir)
  .filter(name => name.endsWith(".test.js"))
  .sort()
  .map(name => path.join("tests", name));

if (!testFiles.length) {
  console.error("No tests/*.test.js files found.");
  process.exit(1);
}

const started = Date.now();
for (let round = 1; round <= rounds; round += 1) {
  const roundStarted = Date.now();
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const elapsed = Date.now() - roundStarted;
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    console.error(`Regression soak failed on round ${round}/${rounds}.`);
    process.exit(result.status || 1);
  }
  console.log(`round ${round}/${rounds}: PASS (${testFiles.length} files, ${elapsed} ms)`);
}

console.log(`Regression soak passed: ${rounds} rounds x ${testFiles.length} test files = ${rounds * testFiles.length} test-file executions in ${Date.now() - started} ms.`);
