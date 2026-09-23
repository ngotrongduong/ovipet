"use strict";

// Panel action shorthand identifiers are evaluated while content.js builds the OWEH helper bag.
// If one was removed during extraction, the whole content script aborts before the panel can render.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const match = source.match(/uiPanelActions:\s*\{([\s\S]*?)\n\s*\},\n\s*pageActions:/);
if (!match) throw new Error("Could not locate uiPanelActions wiring block");

const block = match[1];
const shorthand = new Set();
for (const part of block.split(",")) {
  const token = part.trim().split(/\s+/).pop();
  if (/^[A-Za-z_$][\w$]*$/.test(token) && !part.includes(":")) shorthand.add(token);
}

// Actions extracted to services/*.js are bound in content.js by destructuring the factory result.
const destructured = new Set();
for (const [, names] of source.matchAll(/const\s*\{([^}]*)\}\s*=/g)) {
  for (const part of names.split(",")) {
    const local = part.split(":").pop().trim();
    if (/^[A-Za-z_$][\w$]*$/.test(local)) destructured.add(local);
  }
}

for (const name of shorthand) {
  const declared = destructured.has(name) || new RegExp(`(?:async\\s+)?function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b`).test(source);
  if (!declared) throw new Error(`uiPanelActions references an undefined shorthand action: ${name}`);
}

if (!shorthand.has("copyBlacklistCsv")) throw new Error("copyBlacklistCsv must remain wired to the panel");
console.log(`content UI action wiring test passed (${shorthand.size} shorthand actions)`);
