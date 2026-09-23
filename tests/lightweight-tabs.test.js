"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let sessionRules = [];
const removedListeners = [];
const chrome = {
  runtime: { lastError: null },
  tabs: { onRemoved: { addListener(fn) { removedListeners.push(fn); } } },
  declarativeNetRequest: {
    getSessionRules(callback) { callback(JSON.parse(JSON.stringify(sessionRules))); },
    updateSessionRules({ removeRuleIds = [], addRules = [] }, callback) {
      sessionRules = sessionRules.filter(rule => !removeRuleIds.includes(rule.id));
      sessionRules.push(...JSON.parse(JSON.stringify(addRules)));
      callback?.();
    }
  }
};
const diagnosticEvents = [];
const context = vm.createContext({ chrome, console, Promise, Object, Array, Set, Number, String, Boolean, globalThis: null });
context.globalThis = context;
context.OWEH_BG = { diagnosticLog: { append(level, source, event, data) { diagnosticEvents.push({ level, source, event, data }); return Promise.resolve(); } } };
const source = fs.readFileSync(path.join(__dirname, "..", "bg", "lightweight-tabs.js"), "utf8");
vm.runInContext(source, context, { filename: "lightweight-tabs.js" });
const api = context.OWEH_BG.lightweightTabs;

(async () => {
  assert.equal(api.dnrAvailable(), true);
  await api.enable(101, "sweep-coordinator");
  await api.enable(102, "sweep-egg");
  assert.equal(sessionRules.length, 1, "all lightweight tabs should share one session rule");
  assert.deepEqual(Array.from(sessionRules[0].condition.tabIds), [101, 102]);
  assert.deepEqual(Array.from(sessionRules[0].condition.resourceTypes), ["image", "media", "font"]);
  assert.equal(sessionRules[0].action.type, "block");

  await api.disable(101);
  assert.deepEqual(Array.from(sessionRules[0].condition.tabIds), [102]);

  await api.disable(102, "test-close");
  assert.equal(sessionRules.length, 0, "disabling the final owned tab should remove the block rule");

  assert.ok(diagnosticEvents.some(entry => entry.event === "tab.lightweight-enabled"));
  console.log("lightweight tab resource-rule tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
