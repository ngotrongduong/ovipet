"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "ui/panel.js"), "utf8");

// The one discard flow is features/surplus.js: its buttons reach the panel through
// OWEH.collect("buttons"), so each selector it exports must exist in the panel markup.
const surplus = fs.readFileSync(path.join(root, "features/surplus.js"), "utf8");
for (const id of ["oweh-surplus-plan", "oweh-surplus-dismiss", "oweh-surplus-confirm", "oweh-surplus-stop"]) {
  assert.ok(surplus.includes(`"#${id}"`), `features/surplus.js must export the ${id} handler`);
  assert.ok(panel.includes(`id="${id}"`), `ui/panel.js must render ${id}`);
}
for (const id of ["oweh-surplus-keep", "oweh-surplus-limit", "oweh-surplus-preview", "oweh-view-surplus"]) {
  assert.ok(panel.includes(`id="${id}"`), `ui/panel.js must render ${id}`);
}
assert.match(panel, /OWEH\.collect\("buttons"\)/);
assert.match(content, /surplus: OWEH\.domain\.surplus/, "content.js must inject the surplus domain");
for (const retired of ["discardPoorEggCandidates", "oweh-discard-poor-eggs", "oweh-cull-", "maleCull"]) {
  assert.equal(panel.includes(retired) || content.includes(retired), false, `retired discard path remains: ${retired}`);
}

assert.match(panel,
  /typeof handler !== "function"[\s\S]*?control\.disabled = true/,
  "panel wiring should fail closed when a handler is missing");

console.log("UI action wiring tests passed");
