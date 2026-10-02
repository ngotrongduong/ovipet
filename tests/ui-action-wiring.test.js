"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "ui/panel.js"), "utf8");

assert.match(panel, /discardPoorEggCandidates/,
  "ui/panel.js must request the poor-egg discard handler");
assert.match(content,
  /uiPanelActions:\s*\{[\s\S]*?discardPoorEggCandidates[\s\S]*?\}/,
  "content.js must inject discardPoorEggCandidates into uiPanelActions");

assert.match(panel,
  /typeof handler !== "function"[\s\S]*?control\.disabled = true/,
  "panel wiring should fail closed when a handler is missing");

console.log("UI action wiring tests passed");
