"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

function loadBackground(sandbox, sourceOverrides = {}) {
  const context = vm.createContext({ ...sandbox });
  context.importScripts = (...files) => {
    for (const file of files) {
      const source = sourceOverrides[file] ?? fs.readFileSync(path.join(ROOT, file), "utf8");
      vm.runInContext(source, context, { filename: file });
    }
  };
  const background = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  vm.runInContext(background, context, { filename: "background.js" });
  return context;
}

module.exports = { loadBackground };
