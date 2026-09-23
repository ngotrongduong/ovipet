"use strict";

const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const scheduler = fs.readFileSync(path.join(__dirname, "..", "core", "scheduler.js"), "utf8");
const refreshSource = `${scheduler}\n${content}`;

for (const required of [
  "const DEFAULT_REFRESH_DEBOUNCE_MS = 50",
  "function createRefreshScheduler(callback",
  "function isBridgeOwnedMutationNode(node)",
  "function shouldIgnoreBridgeMutations(records)",
  "const refreshScheduler = createRefreshScheduler(refresh)",
  "new MutationObserver(records => {",
  "if (shouldIgnoreBridgeMutations(records)) return;",
  'window.addEventListener("hashchange", () => scheduleRefresh(0, "navigation"))'
]) {
  if (!refreshSource.includes(required)) throw new Error(`Refresh throttling behavior missing: ${required}`);
}

if (content.includes("new MutationObserver(refresh)")) {
  throw new Error("MutationObserver must not run the full refresh pipeline for every DOM mutation");
}

console.log("DOM refresh throttling test passed");
